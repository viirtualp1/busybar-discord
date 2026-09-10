import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng } from 'busybar-kit/image';
import { avatarUrl, circleAvatar, defaultAvatarUrl } from './render.js';

/**
 * Avatars, fetched once and kept.
 *
 * Three layers, and each one exists to avoid the layer above it: the device
 * already has the asset, or the disk already has the PNG, or Discord's CDN has
 * to be asked. Steady state touches none of them — the ring changes colour
 * many times a minute, the picture behind it does not change at all.
 */
export type AvatarRequest = {
  userId: string;
  /** Avatar hash, or null for the default one. */
  hash: string | null;
  size: number;
};

export type AvatarStoreOptions = {
  /** Where PNGs are kept between runs. */
  dir: string;
  upload: (file: string, png: Buffer) => Promise<void>;
  fetchImage?: (url: string) => Promise<Buffer>;
  onWarning?: (message: string) => void;
  gain?: number;
};

/** What Discord is asked for. Larger than any slot, so the crop has something to work with. */
const SOURCE_SIZE = 128;

export class AvatarStore {
  private readonly uploaded = new Set<string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly failed = new Map<string, number>();
  /**
   * Uploads go up one at a time, and this is the tail of the queue.
   *
   * A full call is five pictures wanted in the same instant, at startup, when
   * the display is also being drawn for the first time. Sent together that is
   * five concurrent uploads at a small embedded device, which is one of the
   * ways to stop it answering at all. Sent in turn nobody notices.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: AvatarStoreOptions) {}

  /**
   * Forgets what the device is holding, without touching the disk cache.
   *
   * Assets do not survive the Bar going away, so after a reconnect it has none
   * of ours — but the PNGs are still on disk, so putting them back costs an
   * upload each and no fetching or drawing at all.
   */
  forgetUploads(): void {
    this.uploaded.clear();
    this.failed.clear();
  }

  /**
   * The asset path for this avatar, uploading it if the device has not seen it.
   *
   * Returns null when the picture could not be had at all, which the caller
   * draws around rather than failing over — a missing face is a worse frame,
   * not a broken one.
   */
  async ensure(request: AvatarRequest): Promise<string | null> {
    const key = keyOf(request);
    if (this.uploaded.has(key)) {
      return file(key);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    // A CDN that just refused is not asked again on the very next frame.
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_MS) {
      return null;
    }

    const work = this.load(key, request).finally(() => this.pending.delete(key));
    this.pending.set(key, work);

    return work;
  }

  /** Everything the device is holding for us, for a clear-and-redraw decision. */
  get known(): ReadonlySet<string> {
    return this.uploaded;
  }

  private async load(key: string, request: AvatarRequest): Promise<string | null> {
    try {
      // Fetching and drawing the circle happen wherever they like — they cost
      // the device nothing. Only the upload joins the queue.
      const png = this.cached(key) ?? (await this.render(key, request));
      await this.enqueue(() => this.options.upload(file(key), png));
      this.uploaded.add(key);
      this.failed.delete(key);

      return file(key);
    } catch (error) {
      this.failed.set(key, Date.now());
      this.options.onWarning?.(`avatar for ${request.userId}: ${message(error)}`);

      return null;
    }
  }

  /** Runs `work` after everything already queued, whether that failed or not. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    // The tail must not reject, or every upload behind it inherits the failure.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }

  private cached(key: string): Buffer | null {
    const path = this.path(key);
    if (!existsSync(path)) {
      return null;
    }

    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  private async render(key: string, request: AvatarRequest): Promise<Buffer> {
    const url = request.hash
      ? avatarUrl(request.userId, request.hash, SOURCE_SIZE)
      : defaultAvatarUrl(request.userId);

    const bytes = await (this.options.fetchImage ?? fetchImage)(url);
    const png = circleAvatar(decodePng(bytes), request.size, {
      ...(this.options.gain === undefined ? {} : { gain: this.options.gain }),
    }).toPng();

    try {
      mkdirSync(this.options.dir, { recursive: true });
      writeFileSync(this.path(key), png);
    } catch {
      // The disk cache is an optimisation. Losing it costs one fetch next run.
    }

    return png;
  }

  private path(key: string): string {
    return resolve(join(this.options.dir, file(key)));
  }
}

const RETRY_MS = 60_000;

/**
 * One file per avatar per size, named so it cannot collide.
 *
 * The hash is in the name because a new avatar is a new picture; the old file
 * stops being asked for and the set stays bounded by the people you actually
 * talk to.
 */
function keyOf(request: AvatarRequest): string {
  return [request.userId, request.hash ?? 'default', request.size].join('-');
}

function file(key: string): string {
  return `${key}.png`;
}

async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${response.status} from the Discord CDN`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
