import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVoiceState, SPEAKING_HOLD_MS, VoiceRoom } from '../src/discord/voice.js';

const START = 1_800_000_000_000;

/** A room whose clock we drive, so the debounce can be tested without waiting. */
function room() {
  let now = START;
  const voice = new VoiceRoom(() => now);
  voice.enter({ id: 'c1', name: 'general', guild_id: 'g1' });

  return {
    voice,
    tick: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

function state(id: string, extra: Record<string, unknown> = {}) {
  return {
    user: { id, username: `user${id}`, global_name: `User ${id}`, avatar: `hash${id}` },
    voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false },
    ...extra,
  };
}

test('a voice state becomes a member', () => {
  const { voice } = room();
  voice.upsert(state('1'));

  const member = voice.snapshot()?.members[0];
  assert.equal(member?.id, '1');
  assert.equal(member?.name, 'User 1');
  assert.equal(member?.avatar, 'hash1');
  assert.equal(member?.muted, false);
});

test('a server nickname wins over the account name', () => {
  const parsed = parseVoiceState({ ...state('1'), nick: 'Kolya' });

  assert.equal(parsed?.name, 'Kolya');
});

test('muted by yourself and muted by the server look the same', () => {
  const mine = parseVoiceState(state('1', { voice_state: { self_mute: true } }));
  const theirs = parseVoiceState(state('1', { voice_state: { mute: true } }));

  assert.equal(mine?.muted, true);
  assert.equal(theirs?.muted, true);
});

test('a payload without a user is ignored rather than half-read', () => {
  assert.equal(parseVoiceState({ voice_state: {} }), null);
  assert.equal(parseVoiceState(null), null);
  assert.equal(parseVoiceState('nonsense'), null);
});

test('an update keeps the arrival time, so nobody jumps position', () => {
  const { voice, tick } = room();
  voice.upsert(state('1'));
  const joinedAt = voice.snapshot()?.members[0]?.joinedAt;

  tick(60_000);
  voice.upsert(state('1', { voice_state: { self_mute: true } }));

  const member = voice.snapshot()?.members[0];
  assert.equal(member?.joinedAt, joinedAt);
  assert.equal(member?.muted, true);
});

test('the row is ordered by arrival, not by who is talking', () => {
  const { voice, tick } = room();
  voice.upsert(state('1'));
  tick(1000);
  voice.upsert(state('2'));
  tick(1000);
  voice.upsert(state('3'));

  voice.startSpeaking({ user_id: '3' });

  assert.deepEqual(
    voice.snapshot()?.members.map((member) => member.id),
    ['1', '2', '3'],
  );
});

test('speech lights the ring immediately', () => {
  const { voice } = room();
  voice.upsert(state('1'));
  voice.startSpeaking({ user_id: '1' });

  const member = voice.snapshot()?.members[0];
  assert.ok(member && voice.speaking(member));
});

test('a gap between words does not put the ring out', () => {
  const { voice, tick, at } = room();
  voice.upsert(state('1'));
  voice.startSpeaking({ user_id: '1' });
  tick(500);
  voice.stopSpeaking({ user_id: '1' });

  const member = voice.snapshot()?.members[0];
  assert.ok(member);
  assert.ok(voice.speaking(member, at()), 'still lit the instant speech stops');

  tick(SPEAKING_HOLD_MS - 1);
  assert.ok(voice.speaking(member, at()), 'still lit inside the hold');

  tick(2);
  assert.equal(voice.speaking(member, at()), false, 'out once the hold expires');
});

test('speaking time adds up across turns', () => {
  const { voice, tick } = room();
  voice.upsert(state('1'));

  voice.startSpeaking({ user_id: '1' });
  tick(4000);
  voice.stopSpeaking({ user_id: '1' });
  tick(10_000);
  voice.startSpeaking({ user_id: '1' });
  tick(1000);
  voice.stopSpeaking({ user_id: '1' });

  assert.equal(voice.snapshot()?.members[0]?.spokenMs, 5000);
});

test('a repeated start does not restart the clock', () => {
  const { voice, tick } = room();
  voice.upsert(state('1'));

  voice.startSpeaking({ user_id: '1' });
  tick(3000);
  voice.startSpeaking({ user_id: '1' });
  tick(1000);
  voice.stopSpeaking({ user_id: '1' });

  assert.equal(voice.snapshot()?.members[0]?.spokenMs, 4000);
});

test('a stop for somebody who was never speaking changes nothing', () => {
  const { voice } = room();
  voice.upsert(state('1'));
  voice.stopSpeaking({ user_id: '1' });
  voice.stopSpeaking({ user_id: 'someone-else' });

  const member = voice.snapshot()?.members[0];
  assert.equal(member?.spokenMs, 0);
  assert.ok(member && !voice.speaking(member));
});

test('leaving clears the room rather than freezing it', () => {
  const { voice } = room();
  voice.upsert(state('1'));
  voice.upsert(state('2'));

  voice.enter(null);

  assert.equal(voice.joined, false);
  assert.equal(voice.snapshot(), null);
});

test('moving to another channel does not carry the old one over', () => {
  const { voice } = room();
  voice.upsert(state('1'));
  voice.enter({ id: 'c2', name: 'gaming' });
  voice.upsert(state('9'));

  const snapshot = voice.snapshot();
  assert.equal(snapshot?.channelName, 'gaming');
  assert.deepEqual(
    snapshot?.members.map((member) => member.id),
    ['9'],
  );
});

test('someone leaving is removed, everyone else stays put', () => {
  const { voice } = room();
  voice.upsert(state('1'));
  voice.upsert(state('2'));
  voice.remove({ user: { id: '1' } });

  assert.deepEqual(
    voice.snapshot()?.members.map((member) => member.id),
    ['2'],
  );
});
