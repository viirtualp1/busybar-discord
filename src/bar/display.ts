import { BusyBar, type DisplayDrawParams } from '@busy-app/busy-lib';
import { errorMessage } from 'busybar-kit/errors';
import type { Frame } from '../view/frame.js';
import { frontElements } from '../view/elements.js';

export const APP_NAME = 'discord';

export type BarConnection = {
  addr: string;
  token: string;
  httpPassword: string;
  timeoutMs?: number;
};

export function createBusyBar(connection: BarConnection): BusyBar {
  return new BusyBar({
    addr: connection.addr,
    timeout: connection.timeoutMs ?? 5000,
    ...(connection.token ? { token: connection.token } : {}),
    ...(connection.httpPassword ? { HTTPAccessPassword: connection.httpPassword } : {}),
  });
}

/**
 * Shortest gap between two draws.
 *
 * This is a rate limit on the device, not a frame rate. Speech produces events
 * many times a second — five people interrupting each other produce five times
 * that — and every one of them changes the picture, so without a floor here
 * each becomes its own HTTP request. The Bar is a small embedded thing on the
 * end of Wi-Fi; asked that often it stops answering, which is indistinguishable
 * from it having crashed.
 */
export const MIN_DRAW_MS = 250;

/**
 * The display, kept in step with the frame.
 *
 * Draws are serialised, coalesced and rate limited: a burst of speaking events
 * between two requests becomes one request carrying the latest state, because
 * the device only ever needed the last one.
 */
export class BarDisplay {
  private drawing = false;
  private stopped = false;
  private queued: Frame | null = null;
  private lastKey = '';
  /**
   * The ids that are on the device, or null for "no idea".
   *
   * The difference matters. An empty list means the screen is known to be
   * empty; null means this process has not drawn yet and something from a
   * previous run — a previous *version* — may still be up there. Elements
   * persist by id, so anything we no longer mention would stay for as long as
   * the Bar does.
   */
  private lastIds: string[] | null = null;
  private lastDrawAt = 0;

  constructor(
    private readonly bar: BusyBar,
    private readonly priority: number,
    private readonly minDrawMs: number = MIN_DRAW_MS,
  ) {}

  async ping(): Promise<void> {
    await this.bar.SystemStatusGet();
  }

  async uploadAsset(file: string, png: Buffer): Promise<void> {
    await this.bar.AssetsUpload({ application_name: APP_NAME, file, data: png });
  }

  /** Forgets what is on screen, so the next frame is drawn in full. */
  markStale(): void {
    this.lastKey = '';
    this.lastIds = null;
  }

  stop(): void {
    this.stopped = true;
    this.queued = null;
  }

  async push(frame: Frame): Promise<void> {
    if (this.stopped) {
      return;
    }

    const key = JSON.stringify(frame);
    if (key === this.lastKey) {
      return;
    }

    this.queued = frame;
    if (this.drawing) {
      return;
    }

    this.drawing = true;
    try {
      while (this.queued && !this.stopped) {
        await this.pace();
        if (this.stopped) {
          return;
        }

        const next = this.queued;
        this.queued = null;
        await this.draw(next);
        this.lastDrawAt = Date.now();
        this.lastKey = JSON.stringify(next);
      }
    } catch (error) {
      this.markStale();
      throw error;
    } finally {
      this.drawing = false;
    }
  }

  /** Hands the screen back without tearing anything down. */
  async blank(): Promise<void> {
    this.queued = null;
    this.markStale();
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  async clear(): Promise<void> {
    this.stop();
    this.markStale();
    await this.bar.DisplayClear({ application_name: APP_NAME });
  }

  /**
   * Waits out the rest of the rate limit.
   *
   * Anything that arrives meanwhile replaces what is queued rather than adding
   * to it, so waiting costs nothing but the wait — the frame that goes out is
   * still the newest one.
   */
  private async pace(): Promise<void> {
    const since = Date.now() - this.lastDrawAt;
    if (since >= this.minDrawMs) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, this.minDrawMs - since));
  }

  private async draw(frame: Frame): Promise<void> {
    // Out of a call the screen is released, not painted: a clear is the DELETE
    // the window manager reads as "nothing to show", so whatever else is
    // running gets the screen. Once is enough — an unchanged frame never
    // reaches here twice.
    if (frame.kind === 'away') {
      if (this.lastIds === null || this.lastIds.length > 0) {
        await this.bar.DisplayClear({ application_name: APP_NAME });
      }
      this.lastIds = [];

      return;
    }

    const elements = frontElements(frame);
    const ids = elements.map((element) => element.id);

    // Elements persist on the device by id, so one this frame does not mention
    // stays on screen: everything is drawn every time, which covers changes but
    // not disappearances. Somebody leaving the call is a disappearance, and a
    // clear is the only way to be rid of them — as is the first draw of a run,
    // where whatever the last run left behind is still up and unaccounted for.
    //
    // Those two cases only. Ids arriving — which is what happens as the avatars
    // come in, one upload at a time — need no clear at all, and clearing for
    // them means wiping and redrawing the whole screen once per avatar, right
    // when the device is busiest.
    if (this.lastIds === null || this.lastIds.some((id) => !ids.includes(id))) {
      await this.bar.DisplayClear({ application_name: APP_NAME });
    }
    this.lastIds = ids;

    const payload: DisplayDrawParams = {
      application_name: APP_NAME,
      priority: this.priority,
      elements,
    };

    await this.bar.DisplayDraw(payload);
  }
}

export { errorMessage };
