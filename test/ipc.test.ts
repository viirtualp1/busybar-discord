import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OP, socketPaths } from '../src/discord/ipc.js';

/**
 * The framing, exercised without a Discord client.
 *
 * `IpcConnection` needs a real socket, so what is tested here is the part that
 * gets it wrong in practice: a frame split across chunks, and several frames
 * arriving in one. Both happen on a busy pipe and neither is visible until it
 * breaks.
 */
function frame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);

  return Buffer.concat([header, body]);
}

/** The `take` loop, lifted out so it can be driven a chunk at a time. */
function reader() {
  const seen: { op: number; payload: unknown }[] = [];
  let buffer = Buffer.alloc(0);

  return {
    seen,
    push(chunk: Buffer) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        if (length < 0 || buffer.length < 8 + length) {
          return;
        }
        const body = buffer.subarray(8, 8 + length).toString('utf8');
        buffer = buffer.subarray(8 + length);
        seen.push({ op, payload: JSON.parse(body) as unknown });
      }
    },
  };
}

test('a frame split across chunks is read once it is whole', () => {
  const bytes = frame(OP.frame, { cmd: 'AUTHENTICATE', nonce: 'n1' });
  const stream = reader();

  stream.push(bytes.subarray(0, 5));
  assert.equal(stream.seen.length, 0, 'not even the header yet');

  stream.push(bytes.subarray(5, 12));
  assert.equal(stream.seen.length, 0, 'header, but the body is short');

  stream.push(bytes.subarray(12));
  assert.equal(stream.seen.length, 1);
  assert.deepEqual(stream.seen[0], {
    op: OP.frame,
    payload: { cmd: 'AUTHENTICATE', nonce: 'n1' },
  });
});

test('several frames in one chunk are all read', () => {
  const stream = reader();
  stream.push(
    Buffer.concat([
      frame(OP.frame, { evt: 'SPEAKING_START' }),
      frame(OP.frame, { evt: 'SPEAKING_STOP' }),
      frame(OP.frame, { evt: 'VOICE_STATE_UPDATE' }),
    ]),
  );

  assert.deepEqual(
    stream.seen.map((message) => (message.payload as { evt: string }).evt),
    ['SPEAKING_START', 'SPEAKING_STOP', 'VOICE_STATE_UPDATE'],
  );
});

test('a payload with multibyte characters is measured in bytes, not characters', () => {
  // A nickname in Cyrillic is two bytes a letter. Slicing by length rather
  // than by bytes would cut the JSON in half.
  const stream = reader();
  stream.push(frame(OP.frame, { nick: 'Коля', evt: 'VOICE_STATE_UPDATE' }));

  assert.equal((stream.seen[0]?.payload as { nick: string }).nick, 'Коля');
});

test('the opcodes are the ones the client uses', () => {
  assert.deepEqual(OP, { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 });
});

test('windows looks at named pipes, everywhere else at the runtime directory', () => {
  const paths = socketPaths({ XDG_RUNTIME_DIR: '/run/user/1000' });

  assert.ok(paths.length >= 10, 'every instance is worth trying');
  if (process.platform === 'win32') {
    assert.ok(paths[0]?.startsWith('\\\\.\\pipe\\'), paths[0]);
    assert.ok(paths[0]?.endsWith('discord-ipc-0'));
  } else {
    assert.equal(paths[0], '/run/user/1000/discord-ipc-0');
    assert.ok(
      paths.some((path) => path.includes('snap.discord')),
      'the sandboxed builds put it somewhere else',
    );
  }
});

test('a missing runtime directory still yields somewhere to look', () => {
  assert.ok(socketPaths({}).length > 0);
});
