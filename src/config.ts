import { loadBarConfig, loadEnvFile, type BarConfig } from 'busybar-kit/config';
import { TOKEN_FILE } from './discord/auth.js';
import { DEFAULT_MAX_TILES, HARD_MAX_TILES } from './view/frame.js';

export { loadEnvFile };

/** Which of the Bar's buttons toggles the microphone. */
export const MUTE_BUTTONS = ['start', 'ok', 'back', 'none'] as const;
export type MuteButton = (typeof MUTE_BUTTONS)[number];

export type Config = BarConfig & {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  tokenFile: string;
  /** Where circled avatars are kept between runs. */
  cacheDir: string;
  maxTiles: number;
  hideBots: boolean;
  muteButton: MuteButton;
  input: boolean;
  frameMs: number;
  /** Brightness lift on the avatars; 1 leaves them as they came. */
  avatarGain: number;
  requestTimeoutMs: number;
  reconnectMs: number;
};

export type LoadedConfig = {
  config: Config;
  warnings: string[];
};

/**
 * Read-only would be enough for the picture; the microphone is why `write` is
 * here. Drop it in `DISCORD_SCOPES` if Discord will not grant it and the app
 * still shows everything, just without the button.
 */
export const DEFAULT_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];

export const DEFAULTS = {
  redirectUri: 'http://localhost',
  cacheDir: 'avatars',
  maxTiles: DEFAULT_MAX_TILES,
  /**
   * Speaking events arrive on their own, so this is only the floor under how
   * fast the hold can expire — not a poll, and not the draw rate either: what
   * actually reaches the device is capped by MIN_DRAW_MS.
   */
  frameMs: 200,
  avatarGain: 1.15,
  requestTimeoutMs: 10_000,
  reconnectMs: 5000,
} as const;

const LIMITS = {
  maxTiles: { min: 1, max: HARD_MAX_TILES },
  frameMs: { min: 50, max: 2000 },
  avatarGain: { min: 0.5, max: 2 },
  requestTimeoutMs: { min: 1000, max: 30_000 },
  reconnectMs: { min: 1000, max: 60_000 },
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const warnings: string[] = [];
  const { bar, env: reader } = loadBarConfig(env, warnings);
  const { read, number } = reader;

  const clientId = read('DISCORD_CLIENT_ID');
  const clientSecret = read('DISCORD_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    warnings.push(
      'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are both needed — make an application at ' +
        'https://discord.com/developers/applications and copy them from its OAuth2 page',
    );
  }

  return {
    warnings,
    config: {
      ...bar,
      clientId,
      clientSecret,
      scopes: scopes(read('DISCORD_SCOPES')),
      redirectUri: read('DISCORD_REDIRECT_URI') || DEFAULTS.redirectUri,
      tokenFile: read('DISCORD_TOKEN_FILE') || TOKEN_FILE,
      cacheDir: read('AVATAR_CACHE_DIR') || DEFAULTS.cacheDir,
      maxTiles: number('MAX_AVATARS', DEFAULTS.maxTiles, LIMITS.maxTiles),
      hideBots: flag(read('HIDE_BOTS'), true),
      muteButton: muteButton(read('MUTE_BUTTON'), warnings),
      input: flag(read('BAR_INPUT'), true),
      frameMs: number('FRAME_MS', DEFAULTS.frameMs, LIMITS.frameMs),
      avatarGain: number('AVATAR_GAIN', DEFAULTS.avatarGain, LIMITS.avatarGain, false),
      requestTimeoutMs: number(
        'REQUEST_TIMEOUT_MS',
        DEFAULTS.requestTimeoutMs,
        LIMITS.requestTimeoutMs,
      ),
      reconnectMs: number('RECONNECT_MS', DEFAULTS.reconnectMs, LIMITS.reconnectMs),
    },
  };
}

function scopes(value: string): string[] {
  const listed = value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return listed.length > 0 ? listed : DEFAULT_SCOPES;
}

/**
 * START is the default because the window manager does not use it: it takes OK
 * to cycle apps and BACK to hand the choice back, and leaves the third button
 * alone. Anything else here will be heard by the window manager too.
 */
function muteButton(value: string, warnings: string[]): MuteButton {
  const wanted = value.toLowerCase().trim();
  if (!wanted) {
    return 'start';
  }
  if ((MUTE_BUTTONS as readonly string[]).includes(wanted)) {
    return wanted as MuteButton;
  }

  warnings.push(
    `MUTE_BUTTON=${value} is not one of ${MUTE_BUTTONS.join(', ')}, using start`,
  );

  return 'start';
}

function flag(value: string, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return !/^(0|false|no|off)$/i.test(value.trim());
}
