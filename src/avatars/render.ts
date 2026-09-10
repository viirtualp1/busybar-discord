import { Bitmap, type Rgba } from 'busybar-kit/preview';
import { toRgbaTile, type RgbaImage } from 'busybar-kit/image';

/**
 * A Discord avatar, as a circle.
 *
 * Two things have to be true for the ring around it to survive. The corners
 * outside the circle are left transparent, so a device that honours an alpha
 * channel never paints over the outline; and the picture is drawn before the
 * ring, so a device that ignores alpha has the outline put back on top. Either
 * way what you see is a face in a circle rather than a face in a box.
 */
export type AvatarStyle = {
  /**
   * Paint the corners this colour instead of leaving them clear. Only useful
   * for the preview, which composites onto a panel of its own.
   */
  matte?: Rgba;
  /**
   * Lift applied to the whole picture, 1 being untouched.
   *
   * Avatars are photographs and the panel is small: at twelve pixels a dark
   * one is a dark smudge. A little gain buys back the difference between two
   * people without turning either into a white blob.
   */
  gain?: number;
};

const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function circleAvatar(
  image: RgbaImage,
  size: number,
  style: AvatarStyle = {},
): Bitmap {
  const gain = style.gain ?? 1;
  const tile = toRgbaTile(image, size);
  const bitmap = new Bitmap(size, size, style.matte ?? CLEAR);

  // Measured from pixel centres, so an even diameter comes out symmetrical.
  const centre = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coverage = inside(x - centre, y - centre, radius);
      if (coverage <= 0) {
        continue;
      }

      const offset = (y * size + x) * 4;
      bitmap.set(x, y, {
        r: lift(tile.data[offset] ?? 0, gain),
        g: lift(tile.data[offset + 1] ?? 0, gain),
        b: lift(tile.data[offset + 2] ?? 0, gain),
        // The edge fades out rather than stopping, which is what makes a
        // twelve-pixel circle read as round instead of as an octagon.
        a: Math.round(255 * coverage),
      });
    }
  }

  return bitmap;
}

/** How much of this pixel the circle covers, 0..1. */
function inside(dx: number, dy: number, radius: number): number {
  const distance = Math.hypot(dx, dy);
  const edge = radius - 0.5;

  if (distance <= edge - 0.5) {
    return 1;
  }
  if (distance >= edge + 0.5) {
    return 0;
  }

  return edge + 0.5 - distance;
}

function lift(channel: number, gain: number): number {
  return gain === 1 ? channel : Math.min(255, Math.round(channel * gain));
}

/**
 * The avatar Discord shows for an account that never set one.
 *
 * Since usernames stopped having discriminators the index comes out of the id
 * itself. The old scheme is kept for accounts that still carry a real
 * discriminator, which is a handful of very old ones.
 */
export function defaultAvatarUrl(userId: string, discriminator?: string): string {
  const legacy = discriminator && discriminator !== '0' ? Number(discriminator) : NaN;
  const index = Number.isFinite(legacy)
    ? legacy % 5
    : Number((BigInt(userId || '0') >> 22n) % 6n);

  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Where a real avatar lives. `size` must be a power of two Discord serves. */
export function avatarUrl(userId: string, hash: string, size = 64): string {
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=${size}`;
}
