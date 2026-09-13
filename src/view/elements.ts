import type { ImageElement, RectangleElement, TextElement } from '@busy-app/busy-lib';
import { FRONT } from 'busybar-kit/device';
import { RING, TEXT, TRANSPARENT } from './colors.js';
import type { Frame, Tile } from './frame.js';
import { FRONT_ROW, layoutRow, type Slot } from './layout.js';

export type AnyElement = TextElement | RectangleElement | ImageElement;

/**
 * The frame, as things the device can draw.
 *
 * Every element is sent every time. The alternative — sending only what
 * changed — is tempting when the only change is one ring going green, but the
 * window manager keeps the last frame it saw in order to replay it, and a
 * replay of a partial frame is a broken screen. Ten elements cost nothing;
 * being wrong on a handover costs the whole display.
 *
 * The front strip is the whole app. The back panel is deliberately left alone:
 * it doubled what every frame cost the device for a surface nobody looks at
 * unless the Bar is turned round, and the Bar could not keep up.
 *
 * Out of a call there is nothing to draw at all. A "no call" card would still
 * be a frame, and under the window manager any frame is a claim on the screen —
 * enough to keep music or a match hidden behind a message that says nothing is
 * happening. The display hands the screen back instead.
 */
export function frontElements(frame: Frame): AnyElement[] {
  if (frame.kind === 'away') {
    return [];
  }

  const row = layoutRow(frame.tiles.length, FRONT_ROW);
  const elements: AnyElement[] = [];

  frame.tiles.forEach((tile, index) => {
    const slot = row.slots[index];
    if (slot) {
      elements.push(...avatarElements(tile, slot));
    }
  });

  if (frame.hidden > 0) {
    elements.push(
      text({
        id: 'more',
        display: 'front',
        align: 'mid_right',
        x: FRONT.width - 1,
        y: Math.round(FRONT.height / 2),
        text: `+${frame.hidden}`,
        font: 'tiny',
        color: TEXT.channel,
      }),
    );
  }

  return elements;
}

/**
 * One person: their face, and a ring around it.
 *
 * The ring is a rectangle with its corner radius set to half its side, which
 * is how the device is asked for a circle. It comes second on purpose. An
 * avatar is a square picture and the ring is round, so the picture's corners
 * fall outside the outline — drawn after, they would cut four bites out of it.
 * Drawn before, the ring is laid back over the top and the circle closes.
 *
 * The ring is emitted whether the avatar has arrived or not. An empty circle
 * still says somebody is there, so a slow CDN cannot leave a hole in the row.
 */
function avatarElements(tile: Tile, slot: Slot): AnyElement[] {
  const elements: AnyElement[] = [];

  if (tile.avatar) {
    elements.push({
      id: `a-${tile.userId}`,
      type: 'image',
      display: 'front',
      align: 'top_left',
      x: slot.x + 1,
      y: slot.y + 1,
      path: tile.avatar,
      opacity: 100,
      timeout: 0,
    });
  }

  elements.push({
    id: `r-${tile.userId}`,
    type: 'rectangle',
    display: 'front',
    align: 'top_left',
    x: slot.x,
    y: slot.y,
    width: slot.box,
    height: slot.box,
    radius: Math.floor(slot.box / 2),
    fill: 'none',
    fill_colors: [TRANSPARENT],
    // One pixel, always. Colour carries the meaning here, so a thicker line
    // says nothing extra and takes the space out of the face.
    border_width: RING_WIDTH,
    border_color: RING[tile.ring],
    timeout: 0,
  });

  return elements;
}

/** How much of the circle is outline rather than face. */
export const RING_WIDTH = 1;

function text(element: Omit<TextElement, 'type' | 'timeout'>): TextElement {
  return { ...element, type: 'text', timeout: 0 };
}
