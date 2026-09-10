import { authenticate, type AuthOptions } from './auth.js';
import { RpcClient, type RpcEvent } from './rpc.js';
import { VoiceRoom, type SelfState } from './voice.js';

/**
 * Everything the app needs from Discord, behind one object.
 *
 * The client is the source of truth and it is chatty: this subscribes to the
 * handful of events that matter, keeps the room in step with them, and says so
 * when something changed. It also reconnects, because a desktop app that gets
 * restarted mid-call is a Tuesday.
 */
export type DiscordOptions = {
  auth: AuthOptions;
  onChange: () => void;
  onNotice: (message: string) => void;
  onWarning: (message: string) => void;
  reconnectMs?: number;
};

/** Events that only make sense for the channel you are actually in. */
const CHANNEL_EVENTS = [
  'VOICE_STATE_CREATE',
  'VOICE_STATE_UPDATE',
  'VOICE_STATE_DELETE',
  'SPEAKING_START',
  'SPEAKING_STOP',
] as const;

const DEFAULT_RECONNECT_MS = 5000;

export class DiscordClient {
  readonly room: VoiceRoom;
  private rpc: RpcClient | null = null;
  private self: SelfState | null = null;
  private subscribedTo = '';
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private connected = false;

  constructor(private readonly options: DiscordOptions) {
    this.room = new VoiceRoom();
  }

  get online(): boolean {
    return this.connected;
  }

  get me(): SelfState | null {
    return this.self;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.open();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.rpc?.close();
    this.rpc = null;
    this.connected = false;
  }

  /**
   * Toggles your own microphone.
   *
   * This is the one thing the app writes rather than reads, and it is why the
   * `rpc.voice.write` scope is asked for. The reply carries the settings as
   * they now are, so the display does not have to guess or wait for the event
   * to come back around.
   */
  async toggleMute(): Promise<boolean | null> {
    const rpc = this.rpc;
    if (!rpc || !this.self) {
      return null;
    }

    const wanted = !this.self.muted;
    try {
      const settings = await rpc.command('SET_VOICE_SETTINGS', { mute: wanted });
      this.readVoiceSettings(settings);
      this.options.onChange();

      return this.self.muted;
    } catch (error) {
      this.options.onWarning(`could not change the microphone: ${message(error)}`);

      return null;
    }
  }

  private async open(): Promise<void> {
    const rpc = new RpcClient({
      clientId: this.options.auth.clientId,
      onEvent: (event) => this.onEvent(event),
      onClose: (reason) => this.onClose(reason),
      onWarning: this.options.onWarning,
    });

    try {
      await rpc.connect();
      this.rpc = rpc;

      const user = await authenticate(rpc, this.options.auth);
      this.self = { userId: selfId(user), muted: false, deafened: false };

      await rpc.subscribe('VOICE_CHANNEL_SELECT');
      await rpc.subscribe('VOICE_SETTINGS_UPDATE');
      this.readVoiceSettings(await rpc.command('GET_VOICE_SETTINGS'));
      await this.followSelectedChannel();

      this.connected = true;
      this.options.onNotice(`Discord connected as ${nameOf(user)}`);
      this.options.onChange();
    } catch (error) {
      rpc.close();
      this.rpc = null;
      this.connected = false;
      this.options.onWarning(message(error));
      this.retry();
    }
  }

  /** Where the client says you are right now, which may be nowhere. */
  private async followSelectedChannel(): Promise<void> {
    const rpc = this.rpc;
    if (!rpc) {
      return;
    }

    const channel = await rpc.command('GET_SELECTED_VOICE_CHANNEL').catch(() => null);
    const id = channel && typeof channel['id'] === 'string' ? channel['id'] : '';
    if (!channel || !id) {
      await this.leaveChannel();
      this.options.onChange();

      return;
    }

    await this.joinChannel({
      id,
      name: typeof channel['name'] === 'string' ? channel['name'] : '',
      guildId: typeof channel['guild_id'] === 'string' ? channel['guild_id'] : null,
    });

    for (const state of asArray(channel['voice_states'])) {
      this.room.upsert(state);
    }
    this.options.onChange();
  }

  private async joinChannel(channel: {
    id: string;
    name: string;
    guildId: string | null;
  }): Promise<void> {
    if (this.subscribedTo === channel.id) {
      return;
    }

    await this.leaveChannel();
    this.room.enter({ id: channel.id, name: channel.name, guild_id: channel.guildId });

    const rpc = this.rpc;
    if (!rpc) {
      return;
    }

    for (const event of CHANNEL_EVENTS) {
      await rpc.subscribe(event, { channel_id: channel.id }).catch((error: unknown) => {
        this.options.onWarning(`could not follow ${event}: ${message(error)}`);
      });
    }
    this.subscribedTo = channel.id;
  }

  private async leaveChannel(): Promise<void> {
    const previous = this.subscribedTo;
    this.subscribedTo = '';
    this.room.enter(null);

    const rpc = this.rpc;
    if (!previous || !rpc) {
      return;
    }

    for (const event of CHANNEL_EVENTS) {
      // Unsubscribing from a channel we have already left is not worth a
      // warning: the client forgets the subscription when the channel goes.
      await rpc.unsubscribe(event, { channel_id: previous }).catch(() => undefined);
    }
  }

  private onEvent(event: RpcEvent): void {
    switch (event.evt) {
      case 'VOICE_CHANNEL_SELECT':
        void this.followSelectedChannel().catch((error: unknown) => {
          this.options.onWarning(message(error));
        });

        return;

      case 'VOICE_STATE_CREATE':
      case 'VOICE_STATE_UPDATE':
        this.room.upsert(event.data);
        break;

      case 'VOICE_STATE_DELETE':
        this.room.remove(event.data);
        break;

      case 'SPEAKING_START':
        this.room.startSpeaking(event.data);
        break;

      case 'SPEAKING_STOP':
        this.room.stopSpeaking(event.data);
        break;

      case 'VOICE_SETTINGS_UPDATE':
        this.readVoiceSettings(event.data);
        break;

      default:
        return;
    }

    this.options.onChange();
  }

  private readVoiceSettings(settings: Record<string, unknown>): void {
    if (!this.self) {
      return;
    }
    this.self = {
      userId: this.self.userId,
      muted: settings['mute'] === true,
      deafened: settings['deaf'] === true,
    };
  }

  private onClose(reason: string): void {
    this.rpc = null;
    this.connected = false;
    this.subscribedTo = '';
    this.room.enter(null);
    this.options.onChange();

    if (this.running) {
      this.options.onWarning(`Discord disconnected: ${reason}`);
      this.retry();
    }
  }

  private retry(): void {
    if (!this.running || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.open();
    }, this.options.reconnectMs ?? DEFAULT_RECONNECT_MS);
    this.timer.unref();
  }
}

/** `AUTHENTICATE` answers with the account it authenticated, nested. */
function selfId(reply: Record<string, unknown>): string {
  const user = asRecord(reply['user']);
  const id = user?.['id'];

  return typeof id === 'string' ? id : '';
}

function nameOf(reply: Record<string, unknown>): string {
  const user = asRecord(reply['user']);
  for (const key of ['global_name', 'username']) {
    const name = user?.[key];
    if (typeof name === 'string' && name) {
      return name;
    }
  }

  return 'you';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
