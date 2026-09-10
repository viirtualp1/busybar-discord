import { FRONT } from 'busybar-kit/device';

/**
 * Where one avatar goes.
 *
 * The ring is a rounded rectangle of `box` pixels a side with its radius set to
 * half of that, which the device draws as a circle. The avatar sits one pixel
 * inside it, so the ring reads as an outline around the face rather than a box
 * around a box.
 */
export type Slot = {
  /** Top-left of the ring. */
  x: number;
  y: number;
  /** Side of the ring, in pixels. */
  box: number;
  /** Side of the avatar image inside it. */
  avatar: number;
};

export type Row = {
  slots: Slot[];
  box: number;
  gap: number;
  /** Left edge of the first ring — the row is centred in the space it has. */
  left: number;
};

/**
 * How avatars share a strip.
 *
 * This is the flex row, and it behaves like one: every avatar has the same
 * basis (`maxBox`), they shrink together when the row would overflow, and the
 * gap between them is the first thing to give. What it will not do is shrink
 * past `minBox` — below that a face is no longer a face, and the caller is
 * expected to show fewer of them instead. `capacity()` says how many that is.
 */
export type RowStyle = {
  /** Left edge of the band the row lives in. */
  left: number;
  width: number;
  /** Top of the band the row is centred in. */
  top: number;
  /** Height of that band. Caps how big a square avatar can be. */
  height: number;
  maxBox: number;
  minBox: number;
  maxGap: number;
  minGap: number;
};

/** The most avatars that fit at their smallest. */
export function capacity(style: RowStyle): number {
  const box = Math.min(style.minBox, style.height);

  return Math.max(1, Math.floor((style.width + style.minGap) / (box + style.minGap)));
}

/**
 * Lays `count` avatars across the strip, as large as they will go.
 *
 * Growing is capped by the height, not the width: the avatars are square and
 * the front strip is sixteen pixels tall, so one person alone does not get a
 * seventy-pixel face. What the spare width buys instead is a name beside them,
 * which is the caller's business — see `fits()`.
 */
export function layoutRow(count: number, style: RowStyle): Row {
  const ceiling = Math.min(style.maxBox, style.height);
  const floor = Math.min(style.minBox, ceiling);

  for (let box = ceiling; box > floor; box -= 1) {
    const row = pack(count, box, style);
    if (row) {
      return row;
    }
  }

  // At the floor the row is laid out whether it fits or not: a caller that
  // ignored `capacity()` gets a crowded strip rather than an exception.
  return pack(count, floor, style) ?? overflowing(count, floor, style);
}

function pack(count: number, box: number, style: RowStyle): Row | null {
  if (count <= 0) {
    return { slots: [], box, gap: 0, left: style.left };
  }

  const spare = style.width - count * box;
  const gaps = count - 1;
  if (gaps > 0 && spare < style.minGap * gaps) {
    return null;
  }

  const gap = gaps > 0 ? Math.min(style.maxGap, Math.floor(spare / gaps)) : 0;

  return {
    slots: place(count, box, gap, style),
    box,
    gap,
    left: leftOf(count, box, gap, style),
  };
}

function overflowing(count: number, box: number, style: RowStyle): Row {
  const gap = style.minGap;

  return {
    slots: place(count, box, gap, style),
    box,
    gap,
    left: leftOf(count, box, gap, style),
  };
}

function leftOf(count: number, box: number, gap: number, style: RowStyle): number {
  const total = count * box + gap * Math.max(0, count - 1);

  return style.left + Math.max(0, Math.round((style.width - total) / 2));
}

function place(count: number, box: number, gap: number, style: RowStyle): Slot[] {
  const left = leftOf(count, box, gap, style);
  const y = style.top + Math.max(0, Math.floor((style.height - box) / 2));

  return Array.from({ length: count }, (_, index) => ({
    x: left + index * (box + gap),
    y,
    box,
    // One pixel of ring on each side, and never smaller than a single pixel.
    avatar: Math.max(1, box - 2),
  }));
}

/**
 * The front strip, where the avatars are the whole picture.
 *
 * Fourteen pixels is the largest square that leaves a pixel of margin top and
 * bottom on a sixteen-pixel strip; nine is the smallest circle that still
 * reads as a head rather than a dot.
 */
export const FRONT_ROW: RowStyle = {
  left: 0,
  width: FRONT.width,
  top: 0,
  height: FRONT.height,
  maxBox: 14,
  minBox: 9,
  maxGap: 3,
  minGap: 1,
};
