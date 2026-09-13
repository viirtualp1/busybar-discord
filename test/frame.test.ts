import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Member, Room } from '../src/discord/voice.js';
import { frontElements } from '../src/view/elements.js';
import { HARD_MAX_TILES, sameFrame, toFrame } from '../src/view/frame.js';
import { RING } from '../src/view/colors.js';

function member(id: string, extra: Partial<Member> = {}): Member {
  return {
    id,
    name: `user${id}`,
    avatar: `hash${id}`,
    bot: false,
    muted: false,
    deafened: false,
    streaming: false,
    video: false,
    joinedAt: Number(id),
    speakingSince: 0,
    silentSince: 0,
    spokenMs: 0,
    ...extra,
  };
}

function room(members: Member[]): Room {
  return { channelId: 'c1', channelName: 'general', guildId: 'g1', members };
}

const silent = () => false;
const options = { maxTiles: 5, hideBots: true };

test('no call is a frame of its own, not an empty row', () => {
  assert.deepEqual(toFrame(null, null, silent, options), { kind: 'away' });
});

test('a ring is green for speech, red for muted, dim otherwise', () => {
  const people = [member('1'), member('2', { muted: true }), member('3')];
  const frame = toFrame(room(people), null, (who) => who.id === '1', options);

  assert.equal(frame.kind, 'call');
  assert.deepEqual(frame.kind === 'call' ? frame.tiles.map((tile) => tile.ring) : [], [
    'speaking',
    'muted',
    'idle',
  ]);
});

test('speech wins over muted, because it is the state that just changed', () => {
  // Being muted by the server while talking is a real moment, and the useful
  // thing to show in it is that the person is still trying to speak.
  const frame = toFrame(room([member('1', { muted: true })]), null, () => true, options);

  assert.equal(frame.kind === 'call' ? frame.tiles[0]?.ring : '', 'speaking');
});

test('deafened outranks muted — they cannot hear you either', () => {
  const frame = toFrame(
    room([member('1', { muted: true, deafened: true })]),
    null,
    silent,
    options,
  );

  assert.equal(frame.kind === 'call' ? frame.tiles[0]?.ring : '', 'deafened');
});

test('bots are left out of the row and out of the count', () => {
  const frame = toFrame(
    room([member('1'), member('2', { bot: true }), member('3')]),
    null,
    silent,
    options,
  );

  assert.equal(frame.kind === 'call' ? frame.tiles.length : 0, 2);
  assert.equal(frame.kind === 'call' ? frame.hidden : -1, 0);
});

test('a crowd is capped, and the rest are counted', () => {
  const people = Array.from({ length: 9 }, (_, index) => member(String(index + 1)));
  const frame = toFrame(room(people), null, silent, { maxTiles: 5, hideBots: true });

  assert.equal(frame.kind === 'call' ? frame.tiles.length : 0, 5);
  assert.equal(frame.kind === 'call' ? frame.hidden : 0, 4);
});

test('a setting asking for more than the strip holds is clamped, not obeyed', () => {
  const people = Array.from({ length: 20 }, (_, index) => member(String(index + 1)));
  const frame = toFrame(room(people), null, silent, { maxTiles: 99, hideBots: true });

  assert.equal(frame.kind === 'call' ? frame.tiles.length : 0, HARD_MAX_TILES);
});

test('your own mute comes from the client, not from the roster', () => {
  // The roster catches up a moment later, and the moment shows.
  const frame = toFrame(
    room([member('me', { muted: false })]),
    { userId: 'me', muted: true, deafened: false },
    silent,
    options,
  );

  assert.equal(frame.kind === 'call' ? frame.selfMuted : false, true);
});

test('identical frames compare equal, so an unchanged one is never sent', () => {
  const people = [member('1'), member('2')];
  const first = toFrame(room(people), null, silent, options);
  const second = toFrame(room(people), null, silent, options);

  assert.ok(sameFrame(first, second));
  assert.ok(
    !sameFrame(
      first,
      toFrame(room(people), null, () => true, options),
    ),
  );
});

test('the avatar is drawn before the ring, so the circle is not bitten into', () => {
  const frame = toFrame(room([member('1')]), null, silent, options);
  const withArt =
    frame.kind === 'call'
      ? {
          ...frame,
          tiles: frame.tiles.map((tile) => ({
            ...tile,
            avatar: 'a.png',
          })),
        }
      : frame;

  const types = frontElements(withArt).map((element) => element.type);
  assert.deepEqual(types, ['image', 'rectangle']);
});

test('a ring is drawn even before the picture arrives', () => {
  const frame = toFrame(room([member('1')]), null, silent, options);
  const elements = frontElements(frame);

  assert.equal(elements.length, 1);
  assert.equal(elements[0]?.type, 'rectangle');
});

test('the ring is a circle — radius half the box — and green when speaking', () => {
  const frame = toFrame(room([member('1')]), null, () => true, options);
  const ring = frontElements(frame)[0];

  assert.ok(ring && ring.type === 'rectangle');
  if (ring.type === 'rectangle') {
    assert.equal(ring.radius, Math.floor(ring.width / 2));
    assert.equal(ring.border_color, RING.speaking);
    assert.equal(ring.border_width, 1, 'one pixel — the colour carries the meaning');
  }
});

test('the outline is one pixel whatever the state, so the face keeps the rest', () => {
  const states = [
    toFrame(room([member('1')]), null, () => true, options),
    toFrame(room([member('1', { muted: true })]), null, silent, options),
    toFrame(room([member('1')]), null, silent, options),
  ];

  for (const frame of states) {
    const ring = frontElements(frame).at(-1);
    assert.ok(ring && ring.type === 'rectangle');
    if (ring.type === 'rectangle') {
      assert.equal(ring.border_width, 1);
    }
  }
});

test('every element id is unique, or they would overwrite each other', () => {
  const people = [member('1'), member('2'), member('3')];
  const frame = toFrame(room(people), null, silent, options);
  const withArt =
    frame.kind === 'call'
      ? {
          ...frame,
          tiles: frame.tiles.map((tile) => ({
            ...tile,
            avatar: 'a.png',
          })),
        }
      : frame;

  const ids = frontElements(withArt).map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('everything lands on the front strip', () => {
  const people = [member('1'), member('2'), member('3'), member('4'), member('5')];
  const frame = toFrame(room(people), null, silent, options);

  assert.ok(frontElements(frame).every((element) => element.display === 'front'));
});

test('the away frame draws nothing, so it lays no claim to the screen', () => {
  const away = toFrame(null, null, silent, options);

  assert.equal(frontElements(away).length, 0);
});
