import { connect, type Socket } from 'node:net';

/**
 * The pipe the Discord desktop app listens on.
 *
 * There is no network here and no bot: the client already knows who is in the
 * call, and it says so to anything that connects. Frames are an 8-byte header —
 * opcode and length, both little-endian — followed by JSON.
 */
export const OP = {
  handshake: 0,
  frame: 1,
  close: 2,
  ping: 3,
  pong: 4,
} as const;

export type Op = (typeof OP)[keyof typeof OP];

const HEADER_BYTES = 8;

/** Ten sockets, because a second Discord (stable and canary) takes the next. */
const INSTANCES = 10;

/**
 * Where to look, in order. Windows has named pipes; everywhere else it is a
 * unix socket in the runtime directory, which the sandboxed builds move.
 */
export function socketPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const paths: string[] = [];

  if (process.platform === 'win32') {
    for (let instance = 0; instance < INSTANCES; instance += 1) {
      paths.push(`\\\\.\\pipe\\discord-ipc-${instance}`);
    }

    return paths;
  }

  const base =
    env['XDG_RUNTIME_DIR'] ?? env['TMPDIR'] ?? env['TMP'] ?? env['TEMP'] ?? '/tmp';
  const dirs = [
    '',
    'snap.discord/',
    'app/com.discordapp.Discord/',
    '.flatpak/dev.vencord.Vesktop/xdg-run/',
  ];

  for (const dir of dirs) {
    for (let instance = 0; instance < INSTANCES; instance += 1) {
      paths.push(`${base.replace(/\/$/, '')}/${dir}discord-ipc-${instance}`);
    }
  }

  return paths;
}

export type IpcMessage = { op: Op; payload: unknown };

export type IpcOptions = {
  onMessage: (message: IpcMessage) => void;
  onClose: (reason: string) => void;
};

/**
 * One connection to the client, framing in both directions.
 *
 * Deliberately dumb: it knows about bytes and nothing about commands. What the
 * payloads mean is `rpc.ts`'s problem.
 */
export class IpcConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly options: IpcOptions,
  ) {
    socket.on('data', (chunk: Buffer) => this.take(chunk));
    socket.on('error', (error: Error) => this.finish(error.message));
    socket.on('close', () => this.finish('the Discord client closed the connection'));
  }

  /**
   * Opens the first socket that answers.
   *
   * Every path is tried in turn rather than in parallel: the low-numbered
   * instance is the one that has been running longest, and a second client is
   * a fallback, not a race.
   */
  static async open(
    options: IpcOptions,
    env?: NodeJS.ProcessEnv,
  ): Promise<IpcConnection> {
    const tried: string[] = [];

    for (const path of socketPaths(env)) {
      const socket = await dial(path);
      if (socket) {
        return new IpcConnection(socket, options);
      }
      tried.push(path);
    }

    throw new Error(
      `no Discord client is listening (tried ${tried.length} sockets) — is the desktop app running?`,
    );
  }

  send(op: Op, payload: unknown): void {
    if (this.closed) {
      return;
    }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.destroy();
  }

  private take(chunk: Buffer): void {
    this.buffer =
      this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

    // A frame can arrive split across chunks, or several to a chunk; both are
    // the same loop as long as nothing is consumed until it is whole.
    while (this.buffer.length >= HEADER_BYTES) {
      const op = this.buffer.readInt32LE(0) as Op;
      const length = this.buffer.readInt32LE(4);
      const end = HEADER_BYTES + length;
      if (length < 0 || this.buffer.length < end) {
        return;
      }

      const body = this.buffer.subarray(HEADER_BYTES, end).toString('utf8');
      this.buffer = this.buffer.subarray(end);

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        // A frame we cannot read is not a reason to drop the connection; the
        // next one is very likely fine.
        continue;
      }

      if (op === OP.ping) {
        this.send(OP.pong, payload);
        continue;
      }

      this.options.onMessage({ op, payload });
    }
  }

  private finish(reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.options.onClose(reason);
  }
}

function dial(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const give = (value: Socket | null) => {
      socket.removeAllListeners('connect');
      socket.removeAllListeners('error');
      if (!value) {
        socket.destroy();
      }
      resolve(value);
    };

    socket.once('connect', () => give(socket));
    socket.once('error', () => give(null));
  });
}
