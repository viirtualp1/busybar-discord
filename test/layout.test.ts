import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRONT } from 'busybar-kit/device';
import { capacity, FRONT_ROW, layoutRow, type Row } from '../src/view/layout.js';

/** Right edge of the last avatar. */
function right(row: Row): number {
  const last = row.slots.at(-1);

  return last ? last.x + last.box : 0;
}

test('one person gets the biggest circle the strip is tall enough for', () => {
  const row = layoutRow(1, FRONT_ROW);

  assert.equal(row.box, 14, 'capped by the 16px strip, not by the 72px width');
  assert.equal(row.slots[0]?.y, 1, 'a pixel of margin above and below');
  assert.equal(row.slots[0]?.x, 29, 'centred');
});

test('avatars shrink together rather than overflowing', () => {
  for (let count = 1; count <= capacity(FRONT_ROW); count += 1) {
    const row = layoutRow(count, FRONT_ROW);

    assert.ok(
      right(row) <= FRONT.width,
      `${count} avatars ran off the strip: ${right(row)} > ${FRONT.width}`,
    );
    assert.ok(row.box >= FRONT_ROW.minBox, `${count} avatars shrank past the floor`);
  }
});

test('the gap gives before the avatars do', () => {
  // Four still fit at full size with the gap at its cap. The fifth is what
  // makes the row tight, and it is the gap that collapses to pay for it.
  const four = layoutRow(4, FRONT_ROW);
  const five = layoutRow(5, FRONT_ROW);

  assert.equal(four.box, 14);
  assert.equal(four.gap, FRONT_ROW.maxGap, 'nothing is squeezed yet');
  assert.ok(five.gap < four.gap, 'the space between them closed up first');
  assert.ok(four.box - five.box <= 1, 'and the avatars barely moved');
});

test('five people — the busy case — still fit at a readable size', () => {
  const row = layoutRow(5, FRONT_ROW);

  assert.equal(row.slots.length, 5);
  assert.ok(row.box >= 12, `five avatars came out at ${row.box}px`);
  assert.ok(row.gap >= FRONT_ROW.minGap, 'the rings still have daylight between them');
  assert.ok(right(row) <= FRONT.width);
});

test('every row is centred, so the strip stays balanced as people come and go', () => {
  for (let count = 1; count <= 5; count += 1) {
    const row = layoutRow(count, FRONT_ROW);
    const margin = FRONT.width - right(row);

    assert.ok(
      Math.abs(margin - row.left) <= 1,
      `${count}: ${row.left}px on the left, ${margin}px on the right`,
    );
  }
});

test('avatars are always one pixel inside their ring', () => {
  for (let count = 1; count <= 5; count += 1) {
    for (const slot of layoutRow(count, FRONT_ROW).slots) {
      assert.equal(slot.avatar, slot.box - 2);
    }
  }
});

test('rings never touch', () => {
  for (let count = 2; count <= capacity(FRONT_ROW); count += 1) {
    const { slots } = layoutRow(count, FRONT_ROW);
    for (let index = 1; index < slots.length; index += 1) {
      const previous = slots[index - 1];
      const current = slots[index];
      assert.ok(
        previous && current && current.x >= previous.x + previous.box + 1,
        `${count} avatars: ring ${index} runs into the one before it`,
      );
    }
  }
});

test('a crowd beyond capacity is laid out anyway, not thrown', () => {
  const row = layoutRow(capacity(FRONT_ROW) + 3, FRONT_ROW);

  assert.equal(row.slots.length, capacity(FRONT_ROW) + 3);
  assert.equal(row.box, FRONT_ROW.minBox, 'shrunk as far as it is allowed to');
});

test('nobody in the channel is an empty row, not a crash', () => {
  assert.deepEqual(layoutRow(0, FRONT_ROW).slots, []);
});
