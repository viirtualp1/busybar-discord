#!/usr/bin/env node
import { BarInput } from 'busybar-kit/input';
import { errorMessage } from 'busybar-kit/errors';
import { App } from './app.js';
import { AvatarStore } from './avatars/store.js';
import { BarDisplay, createBusyBar } from './bar/display.js';
import { loadConfig, loadEnvFile } from './config.js';
import { DiscordClient } from './discord/client.js';

loadEnvFile();
const { config, warnings } = loadConfig();

console.log('busybar-discord');
for (const warning of warnings) {
  console.warn(warning);
}

if (!config.clientId || !config.clientSecret) {
  process.exit(1);
}

const bar = createBusyBar({
  addr: config.busyAddr,
  token: config.busyToken,
  httpPassword: config.busyHttpPassword,
  timeoutMs: config.requestTimeoutMs,
});
const display = new BarDisplay(bar, config.drawPriority);

const avatars = new AvatarStore({
  dir: config.cacheDir,
  gain: config.avatarGain,
  upload: (file, png) => display.uploadAsset(file, png),
  onWarning: (message) => console.warn(`[discord] ${message}`),
});

const discord = new DiscordClient({
  auth: {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes,
    redirectUri: config.redirectUri,
    file: config.tokenFile,
    onNotice: (message) => console.log(`[discord] ${message}`),
  },
  reconnectMs: config.reconnectMs,
  onChange: () => app.wake(),
  onNotice: (message) => console.log(`[discord] ${message}`),
  onWarning: (message) => console.warn(`[discord] ${message}`),
});

const app = new App({ config, display, discord, avatars });

if (config.input && config.muteButton !== 'none') {
  const credential = config.busyToken || config.busyHttpPassword;
  app.attachInput(
    new BarInput({
      addr: config.busyAddr,
      ...(credential ? { credential } : {}),
      onEvent: (event) => app.handleInput(event),
      onWarning: (warning) => console.warn(`[discord] ${warning}`),
    }),
  );
  console.log(`[discord] ${config.muteButton.toUpperCase()} toggles your microphone`);
}

let exiting = false;
async function shutdown(code: number): Promise<void> {
  if (exiting) {
    return;
  }
  exiting = true;
  await app.stop();
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('unhandledRejection', (reason) => {
  console.warn(`Unhandled rejection: ${errorMessage(reason)}`);
});
process.on('uncaughtException', (error) => {
  console.error(`Fatal: ${errorMessage(error)}`);
  void shutdown(1);
});

try {
  await app.start();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
await app.wait();
