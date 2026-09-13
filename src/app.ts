import { type BarInput, type InputEvent } from 'busybar-kit/input';
import { errorMessage, isForbidden, isLowPriority } from 'busybar-kit/errors';
import { type AvatarStore } from './avatars/store.js';
import type { Config } from './config.js';
import { type DiscordClient } from './discord/client.js';
import type { Member } from './discord/voice.js';
import { type BarDisplay } from './bar/display.js';
import { toFrame, type Frame, type Tile } from './view/frame.js';
import { FRONT_ROW, layoutRow } from './view/layout.js';

export type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

/** How long to wait between asking an absent Bar whether it is back. */
const BAR_RETRY_MS = 3000;

/**
 * The button that toggles your microphone. Not a setting: the window manager
 * takes OK to cycle apps and BACK to hand the choice back, so START is the only
 * one left, and offering the other two only offered a way to break those.
 */
export const MUTE_BUTTON = 'start';

export type AppDeps = {
  config: Config;
  display: BarDisplay;
  discord: DiscordClient;
  avatars: AvatarStore;
  input?: BarInput;
  logger?: Logger;
};

/**
 * The loop.
 *
 * Discord pushes, the display pulls. Events wake the app rather than being
 * drawn from directly, because half a dozen of them can land between two
 * frames and only the last state matters — and because a ring going out is
 * decided by the clock, not by an event, so there has to be a tick regardless.
 */
export class App {
  private readonly config: Config;
  private readonly display: BarDisplay;
  private readonly discord: DiscordClient;
  private readonly avatars: AvatarStore;
  private readonly logger: Logger;
  private input: BarInput | null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rendering = false;
  private lastError = '';
  private muting = false;
  private done: (() => void) | null = null;
  private finished: Promise<void> = Promise.resolve();

  constructor(deps: AppDeps) {
    this.config = deps.config;
    this.display = deps.display;
    this.discord = deps.discord;
    this.avatars = deps.avatars;
    this.logger = deps.logger ?? console;
    this.input = deps.input ?? null;
  }

  /**
   * Something changed — draw it now rather than at the next tick.
   *
   * The tick exists for the one thing no event announces: a speaking hold
   * expiring. Everything else arrives as an event, and waiting a frame to act
   * on it would put a visible delay under every ring.
   */
  wake(): void {
    if (!this.running || this.rendering) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.tick();
  }

  attachInput(input: BarInput): void {
    this.input = input;
  }

  /**
   * The Bar's own button, pointed at your microphone.
   *
   * Only the press edge acts — the release would toggle it straight back — and
   * a press while the last one is still in flight is dropped rather than
   * queued, since holding the button should not queue up four toggles.
   */
  handleInput(event: InputEvent): void {
    if (event.kind !== 'button' || event.action !== 'press') {
      return;
    }
    if (event.button !== MUTE_BUTTON || this.muting) {
      return;
    }

    this.muting = true;
    void this.discord
      .toggleMute()
      .then((muted) => {
        if (muted !== null) {
          this.logger.info(`[discord] microphone ${muted ? 'muted' : 'live'}`);
        }
      })
      .finally(() => {
        this.muting = false;
      });
  }

  /** Resolves once the app has stopped, so the entry point has something to await. */
  wait(): Promise<void> {
    return this.finished;
  }

  async start(): Promise<void> {
    this.running = true;
    this.finished = new Promise<void>((resolve) => {
      this.done = resolve;
    });
    this.input?.start();
    await this.discord.start();
    await this.connectBar();
    this.tick();
  }

  /**
   * Waits until the Bar answers, before anything is drawn at it.
   *
   * Without this the first thing an absent Bar produces is a wall of ten-second
   * timeouts — one per draw, one per avatar upload — none of which says what is
   * actually wrong. One line naming the address it is trying is worth more than
   * all of them.
   */
  private async connectBar(): Promise<void> {
    while (this.running) {
      try {
        await this.display.ping();
        this.logger.info(`[discord] BUSY Bar connected (${this.config.busyAddr})`);
        this.display.markStale();
        // Assets do not survive the device going away, so what it was holding
        // for us has to go back up.
        this.avatars.forgetUploads();

        return;
      } catch (error) {
        const hint = isForbidden(error)
          ? ' — set BUSY_HTTP_PASSWORD to the HTTP Access password'
          : '';
        this.warnOnce(
          `[discord] waiting for BUSY Bar at ${this.config.busyAddr}: ${errorMessage(error)}${hint}`,
        );
        await new Promise((resolve) => setTimeout(resolve, BAR_RETRY_MS));
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.input?.stop();
    this.discord.stop();

    // Leaving the last frame up would be a picture of a call that has ended,
    // sitting there until something else happens to take the screen.
    try {
      await this.display.clear();
    } catch (error) {
      this.logger.warn(`[discord] could not clear the display: ${errorMessage(error)}`);
    }

    this.done?.();
    this.done = null;
  }

  private tick(): void {
    if (!this.running) {
      return;
    }

    this.rendering = true;
    void this.render()
      .catch((error: unknown) => this.report(error))
      .finally(() => {
        this.rendering = false;
        if (this.running) {
          this.timer = setTimeout(() => this.tick(), this.config.frameMs);
          this.timer.unref();
        }
      });
  }

  private async render(): Promise<void> {
    const room = this.discord.room.snapshot();
    const speaking = (member: Member) => this.discord.room.speaking(member);
    const bare = toFrame(room, this.discord.me, speaking, {
      maxTiles: this.config.maxTiles,
      hideBots: this.config.hideBots,
    });

    // A frame that changed nothing is not sent, but the avatars behind it may
    // still be arriving, so they are resolved either way.
    const frame = await this.withAvatars(bare, room?.members ?? []);
    await this.display.push(frame);
    this.lastError = '';
  }

  /**
   * Fills in the asset paths, once the pictures exist.
   *
   * The size comes out of the layout — five people get a smaller circle than
   * two do — so the request depends on how many are in the call, which is why
   * this happens here rather than when somebody joins.
   */
  private async withAvatars(frame: Frame, members: Member[]): Promise<Frame> {
    if (frame.kind !== 'call' || frame.tiles.length === 0) {
      return frame;
    }

    const size = layoutRow(frame.tiles.length, FRONT_ROW).slots[0]?.avatar ?? 0;
    const hashes = new Map(members.map((member) => [member.id, member.avatar]));

    const tiles = await Promise.all(
      frame.tiles.map(async (tile): Promise<Tile> => ({
        ...tile,
        avatar: await this.avatars.ensure({
          userId: tile.userId,
          hash: hashes.get(tile.userId) ?? null,
          size,
        }),
      })),
    );

    return { ...frame, tiles };
  }

  private report(error: unknown): void {
    if (isLowPriority(error)) {
      // Another app owns the screen. Perfectly normal under the window
      // manager, and not worth a line every frame.
      return;
    }

    this.warnOnce(`[discord] draw failed: ${errorMessage(error)}`);
  }

  /**
   * Says it once.
   *
   * These repeat every frame while whatever is wrong stays wrong, and a
   * thousand identical lines hide the one line before them that explained it.
   */
  private warnOnce(text: string): void {
    if (text === this.lastError) {
      return;
    }
    this.lastError = text;
    this.logger.warn(text);
  }
}
