import { randomUUID } from 'node:crypto';
import { IpcConnection, OP } from './ipc.js';

/**
 * Commands and events, over the pipe.
 *
 * Every command carries a nonce and the reply comes back with the same one, so
 * calls are ordinary promises. Events arrive unasked once subscribed to, and
 * have no nonce at all — that is how the two are told apart.
 */
export type RpcEvent = { evt: string; data: Record<string, unknown> };

export type RpcOptions = {
  clientId: string;
  onEvent: (event: RpcEvent) => void;
  onClose: (reason: string) => void;
  onWarning?: (message: string) => void;
  /** How long a command may go unanswered before it is given up on. */
  timeoutMs?: number;
};

type Pending = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type Frame = {
  cmd?: string;
  args?: Record<string, unknown>;
  evt?: string | null;
  nonce?: string | null;
  data?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `AUTHORIZE` is the exception: it puts a consent dialog in front of a person,
 * and people are slower than sockets.
 */
const AUTHORIZE_TIMEOUT_MS = 120_000;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export class RpcClient {
  private connection: IpcConnection | null = null;
  private readonly pending = new Map<string, Pending>();
  private ready: ((frame: Frame) => void) | null = null;

  constructor(private readonly options: RpcOptions) {}

  /** Connects and shakes hands. Resolves with whatever `READY` carried. */
  async connect(): Promise<Record<string, unknown>> {
    const handshake = new Promise<Frame>((resolve, reject) => {
      this.ready = resolve;
      setTimeout(
        () => reject(new RpcError('the Discord client never said READY')),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ).unref();
    });

    this.connection = await IpcConnection.open({
      onMessage: ({ op, payload }) => {
        if (op === OP.close) {
          this.fail('the Discord client hung up');

          return;
        }
        this.dispatch(payload as Frame);
      },
      onClose: (reason) => this.fail(reason),
    });

    this.connection.send(OP.handshake, { v: 1, client_id: this.options.clientId });
    const frame = await handshake;

    return frame.data ?? {};
  }

  command(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.send({ cmd, args });
  }

  subscribe(
    evt: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.send({ cmd: 'SUBSCRIBE', evt, args });
  }

  unsubscribe(
    evt: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.send({ cmd: 'UNSUBSCRIBE', evt, args });
  }

  close(): void {
    this.connection?.close();
    this.connection = null;
    this.settleAll(new RpcError('the connection was closed'));
  }

  private send(frame: Frame): Promise<Record<string, unknown>> {
    const connection = this.connection;
    if (!connection) {
      return Promise.reject(new RpcError('not connected'));
    }

    const nonce = randomUUID();
    const budget =
      frame.cmd === 'AUTHORIZE'
        ? AUTHORIZE_TIMEOUT_MS
        : (this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new RpcError(`${frame.cmd ?? 'command'} went unanswered`));
      }, budget);
      timer.unref();

      this.pending.set(nonce, { resolve, reject, timer });
      connection.send(OP.frame, { ...frame, nonce });
    });
  }

  private dispatch(frame: Frame): void {
    if (frame.evt === 'READY' && this.ready) {
      const ready = this.ready;
      this.ready = null;
      ready(frame);

      return;
    }

    const nonce = frame.nonce;
    if (typeof nonce === 'string') {
      this.settle(nonce, frame);

      return;
    }

    if (typeof frame.evt === 'string') {
      this.options.onEvent({ evt: frame.evt, data: frame.data ?? {} });
    }
  }

  private settle(nonce: string, frame: Frame): void {
    const waiting = this.pending.get(nonce);
    if (!waiting) {
      this.options.onWarning?.(`a reply arrived for a command that had given up`);

      return;
    }
    this.pending.delete(nonce);
    clearTimeout(waiting.timer);

    if (frame.evt === 'ERROR') {
      const data = frame.data ?? {};
      const message = typeof data['message'] === 'string' ? data['message'] : 'refused';
      const code = typeof data['code'] === 'number' ? data['code'] : undefined;
      waiting.reject(new RpcError(message, code));

      return;
    }

    waiting.resolve(frame.data ?? {});
  }

  private fail(reason: string): void {
    this.connection = null;
    this.settleAll(new RpcError(reason));
    this.options.onClose(reason);
  }

  private settleAll(error: RpcError): void {
    for (const [nonce, waiting] of this.pending) {
      this.pending.delete(nonce);
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
  }
}
