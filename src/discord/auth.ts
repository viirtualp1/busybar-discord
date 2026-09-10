import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RpcClient } from './rpc.js';

/**
 * Getting permission to watch a voice channel, once.
 *
 * The desktop client will not tell an unknown application anything, so the
 * first run puts a consent dialog in front of you and trades the code it
 * returns for a token. That token is kept on disk and refreshed, so the dialog
 * happens once rather than every start.
 */
const TOKEN_URL = 'https://discord.com/api/oauth2/token';

/** Refresh this long before expiry rather than finding out the hard way. */
const EARLY_MS = 24 * 3_600_000;

export const TOKEN_FILE = 'discord-token.json';

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
};

export type AuthOptions = {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  /** Where the token is kept. */
  file: string;
  onNotice?: (message: string) => void;
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Hands the client a token it will accept, however that has to happen.
 *
 * Three ways in, cheapest first: the token on disk, the refresh token beside
 * it, and only then the dialog. A stored token whose scopes no longer cover
 * what the app asks for is treated as no token at all — otherwise adding a
 * feature silently keeps failing against yesterday's grant.
 */
export async function authenticate(
  rpc: RpcClient,
  options: AuthOptions,
): Promise<Record<string, unknown>> {
  const stored = readTokens(options.file);

  if (stored && covers(stored.scopes, options.scopes)) {
    const fresh =
      stored.expiresAt - EARLY_MS > Date.now()
        ? stored
        : await refresh(stored, options).catch(() => null);

    if (fresh) {
      const user = await tryAuthenticate(rpc, fresh.accessToken);
      if (user) {
        writeTokens(options.file, fresh);

        return user;
      }
    }
  }

  options.onNotice?.(
    'Discord is asking you to approve this app — look for the dialog in the desktop client',
  );
  const tokens = await authorize(rpc, options);
  const user = await tryAuthenticate(rpc, tokens.accessToken);
  if (!user) {
    throw new AuthError('Discord accepted the login and then refused the token');
  }
  writeTokens(options.file, tokens);

  return user;
}

async function tryAuthenticate(
  rpc: RpcClient,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await rpc.command('AUTHENTICATE', { access_token: accessToken });
  } catch {
    // Expired, revoked, or issued to a different application. Either way the
    // answer is the same: start again.
    return null;
  }
}

async function authorize(rpc: RpcClient, options: AuthOptions): Promise<Tokens> {
  const reply = await rpc
    .command('AUTHORIZE', {
      client_id: options.clientId,
      scopes: options.scopes,
    })
    .catch((error: unknown) => {
      throw new AuthError(
        error instanceof Error ? error.message : String(error),
        scopeHint(options),
      );
    });

  const code = reply['code'];
  if (typeof code !== 'string') {
    throw new AuthError('Discord approved the app but returned no code');
  }

  return exchange(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: options.redirectUri,
    },
    options,
  );
}

function refresh(tokens: Tokens, options: AuthOptions): Promise<Tokens> {
  return exchange(
    { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
    options,
  );
}

async function exchange(
  body: Record<string, string>,
  options: AuthOptions,
): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      ...body,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new AuthError(
      `Discord refused the token exchange (${response.status}): ${text.slice(0, 200)}`,
      exchangeHint(response.status, text, options),
    );
  }

  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!parsed.access_token || !parsed.refresh_token) {
    throw new AuthError('Discord returned a token exchange without a token in it');
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 604_800) * 1000,
    scopes: parsed.scope ? parsed.scope.split(/\s+/).filter(Boolean) : options.scopes,
  };
}

export function readTokens(file: string, cwd = process.cwd()): Tokens | null {
  const path = resolve(cwd, file);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const value = raw as Partial<Tokens>;
    if (typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string') {
      return null;
    }

    return {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : 0,
      scopes: Array.isArray(value.scopes) ? value.scopes.filter(isString) : [],
    };
  } catch {
    return null;
  }
}

export function writeTokens(file: string, tokens: Tokens, cwd = process.cwd()): void {
  const path = resolve(cwd, file);
  writeFileSync(path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  try {
    // Only meaningful where the mode is honoured, and harmless where it is not.
    chmodSync(path, 0o600);
  } catch {
    // A token we cannot lock down is still a token; the file lives beside the
    // app's own .env, which is no better protected.
  }
}

function covers(granted: string[], wanted: string[]): boolean {
  return wanted.every((scope) => granted.includes(scope));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * The two ways the exchange goes wrong, named.
 *
 * Discord's own message for a redirect it does not recognise is
 * `invalid_request`, which tells you nothing at all — and the redirect is the
 * step people skip, because nothing ever listens on it. It exists only because
 * the OAuth spec makes the exchange quote one back, and Discord checks that it
 * is a redirect the application has registered.
 */
function exchangeHint(
  status: number,
  body: string,
  options: AuthOptions,
): string | undefined {
  if (status === 401) {
    return 'check DISCORD_CLIENT_SECRET — it belongs to the same application as the client id';
  }

  if (status === 400 && /redirect|invalid_request|invalid_grant/i.test(body)) {
    return (
      `add ${options.redirectUri} to the application's Redirects, on the same OAuth2 page ` +
      'the client id came from, and press Save Changes. Nothing listens on it — Discord ' +
      'only checks that the value is one you registered.'
    );
  }

  return undefined;
}

/**
 * The failure everyone hits first, spelled out.
 *
 * RPC scopes are not handed to just anybody: Discord whitelists them per
 * application. The owner of an application is always on that list for their
 * own app, which is why this works for a private setup and not for a published
 * one.
 */
function scopeHint(options: AuthOptions): string {
  return (
    `Discord would not grant ${options.scopes.join(', ')}. ` +
    'RPC scopes only work for the account that owns the application — sign in to ' +
    'the Discord developer portal with the same account, or ask its owner to run this.'
  );
}
