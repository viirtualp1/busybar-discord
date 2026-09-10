#!/usr/bin/env node
/**
 * The consent dialog, on its own.
 *
 * The app does this on first run anyway, but doing it here first means the one
 * step that needs a human — clicking Authorize in the Discord window — is not
 * buried in a display loop that is also trying to reach a Bar. It writes the
 * same token file, so the app finds it and never asks again.
 */
import { authenticate } from './discord/auth.js';
import { RpcClient } from './discord/rpc.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const { config, warnings } = loadConfig();

for (const warning of warnings) {
  console.warn(warning);
}

if (!config.clientId || !config.clientSecret) {
  process.exit(1);
}

const rpc = new RpcClient({
  clientId: config.clientId,
  onEvent: () => undefined,
  onClose: (reason) => {
    console.error(reason);
    process.exit(1);
  },
});

try {
  await rpc.connect();
  console.log('Connected to the Discord client.');

  const user = await authenticate(rpc, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: config.scopes,
    redirectUri: config.redirectUri,
    file: config.tokenFile,
    onNotice: (message) => console.log(message),
  });

  const account = user['user'];
  const username =
    typeof account === 'object' && account !== null
      ? (account as Record<string, unknown>)['username']
      : undefined;
  const name = typeof username === 'string' ? username : 'you';

  console.log(`Signed in as ${name}. The token is in ${config.tokenFile}.`);
  console.log('Start the app with: npm start');
  rpc.close();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && 'hint' in error && typeof error.hint === 'string') {
    console.error(error.hint);
  }
  process.exit(1);
}
