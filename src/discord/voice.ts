/**
 * Who is in the call, as the client keeps telling us.
 *
 * Nothing here talks to a socket. Events go in, a roster comes out, and the
 * whole thing is a plain state machine — which is what makes the interesting
 * part (how a room behaves as people join, mute and talk over each other)
 * testable without Discord running.
 */
export type Member = {
  id: string;
  /** Server nickname if there is one, otherwise the display name. */
  name: string;
  /** Avatar hash, or null for someone who never set one. */
  avatar: string | null;
  bot: boolean;
  /** Muted by themselves or by the server; the ring does not care which. */
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  video: boolean;
  /** Epoch ms this member was first seen in the channel. */
  joinedAt: number;
  /** Epoch ms speech began, or 0 when silent. */
  speakingSince: number;
  /** Epoch ms speech stopped, for the debounce. */
  silentSince: number;
  /** Total ms of speech in this session. */
  spokenMs: number;
};

export type Room = {
  channelId: string;
  channelName: string;
  guildId: string | null;
  members: Member[];
};

export type SelfState = {
  userId: string;
  muted: boolean;
  deafened: boolean;
};

/**
 * How long a stop is ignored before the ring goes out.
 *
 * Speech is full of gaps — between words, between breaths — and Discord
 * reports every one of them. Without this the ring strobes at conversational
 * speed, which is unreadable and unpleasant to sit next to.
 */
export const SPEAKING_HOLD_MS = 350;

export class VoiceRoom {
  private members = new Map<string, Member>();
  private channelId = '';
  private channelName = '';
  private guildId: string | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get joined(): boolean {
    return this.channelId !== '';
  }

  /** Everyone in the channel, in the order they should be drawn. */
  snapshot(): Room | null {
    if (!this.joined) {
      return null;
    }

    return {
      channelId: this.channelId,
      channelName: this.channelName,
      guildId: this.guildId,
      members: [...this.members.values()].sort(byArrival),
    };
  }

  /** Whether to light this member's ring, allowing for the hold. */
  speaking(member: Member, at = this.now()): boolean {
    if (member.speakingSince > 0) {
      return true;
    }

    return member.silentSince > 0 && at - member.silentSince < SPEAKING_HOLD_MS;
  }

  /**
   * Moves to a channel, forgetting the last one.
   *
   * Passing `null` is leaving, which has to clear the roster: the members of a
   * channel you are no longer in are not people who left, and showing them
   * would be a frozen picture of a call that ended.
   */
  enter(channel: { id: string; name?: string; guild_id?: string | null } | null): void {
    this.members.clear();
    this.channelId = channel?.id ?? '';
    this.channelName = channel?.name ?? '';
    this.guildId = channel?.guild_id ?? null;
  }

  /** A `VOICE_STATE_CREATE` or `VOICE_STATE_UPDATE` payload. */
  upsert(payload: unknown): void {
    const parsed = parseVoiceState(payload);
    if (!parsed) {
      return;
    }

    const existing = this.members.get(parsed.id);
    this.members.set(parsed.id, {
      ...parsed,
      joinedAt: existing?.joinedAt ?? this.now(),
      speakingSince: existing?.speakingSince ?? 0,
      silentSince: existing?.silentSince ?? 0,
      spokenMs: existing?.spokenMs ?? 0,
    });
  }

  /** A `VOICE_STATE_DELETE` payload. */
  remove(payload: unknown): void {
    const id = userId(payload);
    if (id) {
      this.members.delete(id);
    }
  }

  startSpeaking(payload: unknown): void {
    const member = this.find(payload);
    if (!member || member.speakingSince > 0) {
      return;
    }
    member.speakingSince = this.now();
    member.silentSince = 0;
  }

  stopSpeaking(payload: unknown): void {
    const member = this.find(payload);
    if (!member || member.speakingSince === 0) {
      return;
    }
    const at = this.now();
    member.spokenMs += Math.max(0, at - member.speakingSince);
    member.speakingSince = 0;
    member.silentSince = at;
  }

  private find(payload: unknown): Member | undefined {
    const id = userId(payload);

    return id ? this.members.get(id) : undefined;
  }
}

/**
 * Oldest first, so a face does not move because somebody else started talking.
 *
 * Sorting by who is loudest would be livelier and much worse: the row would
 * reshuffle mid-conversation and you would lose track of which circle is which
 * person, which is the one thing the display is for.
 */
function byArrival(left: Member, right: Member): number {
  return left.joinedAt - right.joinedAt || left.id.localeCompare(right.id);
}

type ParsedMember = Omit<
  Member,
  'joinedAt' | 'speakingSince' | 'silentSince' | 'spokenMs'
>;

/**
 * Reads one voice state, defensively.
 *
 * These payloads come off a socket owned by another program, and Discord adds
 * fields without asking. Anything unrecognised is left alone; anything missing
 * takes the quietest default.
 */
export function parseVoiceState(payload: unknown): ParsedMember | null {
  const record = asRecord(payload);
  const user = asRecord(record?.['user']);
  const id = user && typeof user['id'] === 'string' ? user['id'] : '';
  if (!user || !id) {
    return null;
  }

  const state = asRecord(record?.['voice_state']) ?? {};
  const nick = typeof record?.['nick'] === 'string' ? record['nick'].trim() : '';

  return {
    id,
    name: nick || displayName(user) || id,
    avatar: typeof user['avatar'] === 'string' && user['avatar'] ? user['avatar'] : null,
    bot: user['bot'] === true,
    // `mute` is the server's doing and `self_mute` is yours; a ring cannot
    // show the difference and nobody watching needs it to.
    muted: state['mute'] === true || state['self_mute'] === true,
    deafened: state['deaf'] === true || state['self_deaf'] === true,
    streaming: record?.['self_stream'] === true,
    video: record?.['self_video'] === true,
  };
}

function displayName(user: Record<string, unknown>): string {
  for (const key of ['global_name', 'display_name', 'username']) {
    const value = user[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

/** `SPEAKING_START` carries a bare id; a voice state nests it under `user`. */
function userId(payload: unknown): string | null {
  const record = asRecord(payload);
  const direct = record?.['user_id'];
  if (typeof direct === 'string') {
    return direct;
  }
  const user = asRecord(record?.['user']);

  return typeof user?.['id'] === 'string' ? user['id'] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
