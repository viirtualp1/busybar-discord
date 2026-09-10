import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Bitmap } from 'busybar-kit/preview';
import { AvatarStore } from '../src/avatars/store.js';
import { BarDisplay } from '../src/bar/display.js';
import type { Frame } from '../src/view/frame.js';

/** A real, if tiny, PNG — the store decodes whatever the CDN hands it. */
const PNG = new Bitmap(8, 8, { r: 120, g: 90, b: 200, a: 255 }).toPng();

const scratches: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'busybar-discord-'));
  scratches.push(dir);

  return dir;
}

after(() => {
  for (const dir of scratches) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A Bar that writes down what it was asked, and answers instantly. */
function fakeBar() {
  const calls: string[] = [];
  const bar = {
    SystemStatusGet: () => Promise.resolve({}),
    AssetsUpload: () => Promise.resolve({}),
    DisplayClear: () => {
      calls.push('clear');

      return Promise.resolve({});
    },
    DisplayDraw: () => {
      calls.push('draw');

      return Promise.resolve({});
    },
  };

  return { bar, calls };
}

function frame(ids: string[]): Frame {
  return {
    kind: 'call',
    channel: 'general',
    hidden: 0,
    selfMuted: false,
    selfDeafened: false,
    tiles: ids.map((id) => ({
      userId: id,
      name: `user${id}`,
      ring: 'idle' as const,
      avatar: null,
      streaming: false,
    })),
  };
}

function displayFor(minDrawMs = 0) {
  const { bar, calls } = fakeBar();
  // The constructor only ever uses these four methods.
  const display = new BarDisplay(bar as never, 40, minDrawMs);

  return { display, calls };
}

test('an unchanged frame is never sent twice', async () => {
  const { display, calls } = displayFor();

  await display.push(frame(['1']));
  await display.push(frame(['1']));

  assert.equal(calls.filter((call) => call === 'draw').length, 1);
});

test('an avatar arriving does not wipe the screen', async () => {
  // This is the startup burst: the rings go up first, then each picture lands
  // as its upload finishes. Clearing for each one means wiping and redrawing
  // everything once per avatar, exactly when the device is busiest.
  const { display, calls } = displayFor();
  const bare = frame(['1', '2']);
  const withOne: Frame =
    bare.kind === 'call'
      ? {
          ...bare,
          tiles: bare.tiles.map((tile, index) =>
            index === 0 ? { ...tile, avatar: 'a.png' } : tile,
          ),
        }
      : bare;

  await display.push(bare);
  await display.push(withOne);

  assert.equal(calls.filter((call) => call === 'clear').length, 0, calls.join(','));
  assert.equal(calls.filter((call) => call === 'draw').length, 2);
});

test('somebody leaving does wipe it, or they would stay on screen', async () => {
  const { display, calls } = displayFor();

  await display.push(frame(['1', '2']));
  await display.push(frame(['1']));

  assert.equal(calls.filter((call) => call === 'clear').length, 1);
});

test('a burst of changes becomes one draw, not one draw each', async () => {
  const { display, calls } = displayFor(50);

  // Five speaking events in the same instant, as five people interrupting each
  // other produce. Only the first and the newest state are worth sending.
  const pushes = [
    display.push(frame(['1'])),
    display.push(frame(['1', '2'])),
    display.push(frame(['1', '2', '3'])),
    display.push(frame(['1', '2', '3', '4'])),
  ];
  await Promise.all(pushes);

  const draws = calls.filter((call) => call === 'draw').length;
  assert.ok(draws <= 2, `expected the burst to coalesce, got ${draws} draws`);
});

test('the rate limit is a floor between draws, not a cap on how many', async () => {
  const { display, calls } = displayFor(30);
  const started = Date.now();

  await display.push(frame(['1']));
  await display.push(frame(['1', '2']));

  assert.equal(calls.filter((call) => call === 'draw').length, 2);
  assert.ok(Date.now() - started >= 30, 'the second one waited its turn');
});

test('uploads go up one at a time, however many are wanted at once', async () => {
  let inFlight = 0;
  let peak = 0;
  const store = new AvatarStore({
    dir: scratch(),
    fetchImage: () => Promise.resolve(PNG),
    upload: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    },
  });

  // A crowded strip's worth of pictures, all wanted in the same instant.
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      store.ensure({ userId: String(index), hash: null, size: 12 }),
    ),
  );

  assert.equal(peak, 1, `${peak} uploads were in flight at once`);
});

test('one upload failing does not take the queue behind it down', async () => {
  const done: string[] = [];
  const store = new AvatarStore({
    dir: scratch(),
    fetchImage: () => Promise.resolve(PNG),
    upload: (file) => {
      if (file.startsWith('1-')) {
        return Promise.reject(new Error('device said no'));
      }
      done.push(file);

      return Promise.resolve();
    },
  });

  const paths = await Promise.all(
    ['0', '1', '2'].map((id) => store.ensure({ userId: id, hash: null, size: 12 })),
  );

  assert.equal(paths[1], null, 'the one that failed reports it');
  assert.equal(done.length, 2, 'the other two still went up');
});

test('a reconnect puts the pictures back without re-fetching them', async () => {
  let fetches = 0;
  const uploads: string[] = [];
  const store = new AvatarStore({
    dir: scratch(),
    fetchImage: () => {
      fetches += 1;

      return Promise.resolve(PNG);
    },
    upload: (file) => {
      uploads.push(file);

      return Promise.resolve();
    },
  });

  await store.ensure({ userId: '1', hash: null, size: 12 });
  await store.ensure({ userId: '1', hash: null, size: 12 });
  assert.equal(uploads.length, 1, 'already up there, so not sent again');

  store.forgetUploads();
  await store.ensure({ userId: '1', hash: null, size: 12 });

  assert.equal(uploads.length, 2, 'sent again after the device went away');
  assert.equal(fetches, 1, 'but read off the disk rather than fetched a second time');
});
