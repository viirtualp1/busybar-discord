#!/usr/bin/env node
/**
 * The frame the Bar would draw, as a PNG, with nothing plugged in.
 *
 * The whole question this app has to answer is whether five faces are still
 * faces on a seventy-two pixel strip. Waiting for five people to be in a call
 * to find out is not a workflow, so the roster is an argument instead:
 *
 *   npm run shot -- --people 3
 *   npm run shot -- --all      # one sheet per size
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Bitmap,
  renderFront,
  renderOnto,
  type AnyElement as RasterElement,
} from 'busybar-kit/preview';
import { circleAvatar } from './avatars/render.js';
import { fixtureAvatar, fixtureRoom } from './fixtures.js';
import { VoiceRoom } from './discord/voice.js';
import { frontElements, type AnyElement } from './view/elements.js';
import { toFrame, HARD_MAX_TILES, type Frame } from './view/frame.js';
import { FRONT_ROW, layoutRow } from './view/layout.js';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);

  return index >= 0 ? args[index + 1] : undefined;
};

const scale = Number(option('--scale') ?? 8);
const outDir = option('--out') ?? 'preview';
const speaking = Number(option('--speaking') ?? 0);
const gain = Number(option('--gain') ?? 1.15);

mkdirSync(outDir, { recursive: true });

const counts = args.includes('--all')
  ? Array.from({ length: HARD_MAX_TILES }, (_, index) => index + 1)
  : [Math.max(0, Number(option('--people') ?? 3))];

for (const count of counts) {
  const room = count === 0 ? null : fixtureRoom(count, speaking);
  const voice = new VoiceRoom();
  const frame = toFrame(room, null, (member) => voice.speaking(member), {
    maxTiles: HARD_MAX_TILES,
    hideBots: true,
  });

  // The asset paths are made up here; nothing is uploaded, and the pictures
  // are composited below since the raster cannot follow a path.
  const withPaths: Frame =
    frame.kind === 'call'
      ? {
          ...frame,
          tiles: frame.tiles.map((tile) => ({ ...tile, avatar: `${tile.userId}.png` })),
        }
      : frame;

  write(`front-${count}`, compose(withPaths));
}

console.log(`Wrote ${counts.length} PNG(s) to ${outDir}/`);

/**
 * The strip, in the order the device builds it.
 *
 * An image element is a path into the device's own asset store, which nothing
 * here can follow, so the pictures are pasted in at the coordinates the element
 * would have used. Everything else is drawn over the top — which is the whole
 * point, since the ring has to close over the avatar's corners.
 */
function compose(frame: Frame): Bitmap {
  const panel = paste(renderFront([]), frame);

  return renderOnto(panel, rasterable(frontElements(frame)), 'front');
}

function rasterable(elements: AnyElement[]): RasterElement[] {
  return elements.filter((element): element is RasterElement => element.type !== 'image');
}

/** Draws the avatars where the device would draw the assets. */
function paste(panel: Bitmap, frame: Frame): Bitmap {
  if (frame.kind !== 'call') {
    return panel;
  }

  const row = layoutRow(frame.tiles.length, FRONT_ROW);
  frame.tiles.forEach((tile, index) => {
    const slot = row.slots[index];
    if (!slot || !tile.avatar) {
      return;
    }
    panel.blit(
      circleAvatar(fixtureAvatar(index), slot.avatar, { gain }),
      slot.x + 1,
      slot.y + 1,
    );
  });

  return panel;
}

function write(name: string, bitmap: Bitmap): void {
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, bitmap.scale(scale).toPng());
  console.log(`  ${path}`);
}
