import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RgbaImage } from 'busybar-kit/image';
import { avatarUrl, circleAvatar, defaultAvatarUrl } from '../src/avatars/render.js';

function solid(size: number, rgba: number[]): RgbaImage {
  const data = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(rgba, offset);
  }

  return { width: size, height: size, data };
}

function alphaAt(bitmap: { data: Uint8Array; width: number }, x: number, y: number) {
  return bitmap.data[(y * bitmap.width + x) * 4 + 3] ?? 0;
}

test('the corners are clear, so the ring drawn over them survives', () => {
  const avatar = circleAvatar(solid(64, [200, 80, 80, 255]), 12);

  assert.equal(alphaAt(avatar, 0, 0), 0, 'top left');
  assert.equal(alphaAt(avatar, 11, 0), 0, 'top right');
  assert.equal(alphaAt(avatar, 0, 11), 0, 'bottom left');
  assert.equal(alphaAt(avatar, 11, 11), 0, 'bottom right');
});

test('the middle is opaque and the picture is in it', () => {
  const avatar = circleAvatar(solid(64, [200, 80, 80, 255]), 12);
  const offset = (6 * 12 + 6) * 4;

  assert.equal(avatar.data[offset + 3], 255);
  assert.equal(avatar.data[offset], 200);
  assert.equal(avatar.data[offset + 1], 80);
});

test('the edge fades rather than stopping, which is what makes it look round', () => {
  const avatar = circleAvatar(solid(64, [255, 255, 255, 255]), 12);
  const alphas = Array.from(
    { length: 12 * 12 },
    (_, pixel) => avatar.data[pixel * 4 + 3] ?? 0,
  );
  const partial = alphas.filter((alpha) => alpha > 0 && alpha < 255);

  assert.ok(
    partial.length >= 8,
    `expected a feathered edge, found ${partial.length} pixels`,
  );
  assert.ok(
    alphas.includes(0) && alphas.includes(255),
    'and still a hard outside and a solid inside',
  );
});

test('gain lifts a dark avatar without pushing a light one past white', () => {
  const dark = circleAvatar(solid(64, [60, 60, 60, 255]), 12, { gain: 1.5 });
  const light = circleAvatar(solid(64, [250, 250, 250, 255]), 12, { gain: 1.5 });
  const middle = (bitmap: { data: Uint8Array }) => bitmap.data[(6 * 12 + 6) * 4] ?? 0;

  assert.equal(middle(dark), 90);
  assert.equal(middle(light), 255, 'clamped, not wrapped');
});

test('an odd size still comes out centred', () => {
  const avatar = circleAvatar(solid(64, [255, 255, 255, 255]), 11);

  assert.equal(alphaAt(avatar, 5, 0), alphaAt(avatar, 5, 10), 'top and bottom match');
  assert.equal(alphaAt(avatar, 0, 5), alphaAt(avatar, 10, 5), 'left and right match');
});

test('an account with no avatar gets one of Discord’s own', () => {
  const url = defaultAvatarUrl('80351110224678912');

  assert.ok(url.startsWith('https://cdn.discordapp.com/embed/avatars/'));
  assert.ok(/\/[0-5]\.png$/.test(url), url);
});

test('a very old account is indexed by its discriminator instead', () => {
  assert.ok(defaultAvatarUrl('80351110224678912', '1234').endsWith('/4.png'));
});

test('a nonsense id does not throw on the way to a URL', () => {
  assert.ok(defaultAvatarUrl('').includes('/embed/avatars/'));
});

test('a real avatar is asked for as a PNG, at a size worth cropping from', () => {
  const url = avatarUrl('1', 'abc', 128);

  assert.ok(url.includes('/avatars/1/abc.png'));
  assert.ok(url.endsWith('size=128'));
});
