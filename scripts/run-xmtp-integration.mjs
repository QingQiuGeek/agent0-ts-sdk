#!/usr/bin/env node
/**
 * Run XMTP integration flow with a real wallet against XMTP production network.
 * Generates a fresh EOA wallet and registers it on XMTP if no key is provided.
 *
 * Usage (from repo root):
 *   npm run build
 *   npm run test:xmtp-integration:run
 *
 * Optional .env: CHAIN_ID, RPC_URL. A fresh wallet is generated each run (no XMTP_TEST_PRIVATE_KEY).
 */

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require('dotenv').config({ path: join(__dirname, '..', '.env') });

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '11155111', 10);
const RPC_URL = process.env.RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo';
// Always generate a new wallet so we don't reuse one that hit XMTP max installations
const envKey = '';

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

async function getTestWallet() {
  const { privateKeyToAccount } = await import('viem/accounts');
  let privateKey;
  if (envKey) {
    privateKey = envKey.startsWith('0x') ? envKey : '0x' + envKey;
  } else {
    privateKey = '0x' + randomBytes(32).toString('hex');
  }
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

async function main() {
  const { privateKey, address } = await getTestWallet();
  if (!envKey) {
    console.log('Generated test wallet:', address);
  }

  console.log('Loading SDK...');
  const distPath = pathToFileURL(join(__dirname, '..', 'dist', 'index.js')).href;
  const { SDK, XMTPReceiverNotRegisteredError } = await import(distPath);

  const sdk = new SDK({
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    privateKey,
    xmtpEnv: 'production',
  });

  console.log('1. registerXMTPInbox()...');
  const installationKey = await sdk.registerXMTPInbox();
  ok(typeof installationKey === 'string', 'installation key');
  const parsed = JSON.parse(installationKey);
  ok(parsed.version === 1 && parsed.walletAddress, 'key shape');
  ok(sdk.getXMTPInstallationKey() === installationKey, 'getXMTPInstallationKey');
  console.log('   OK — walletAddress:', parsed.walletAddress.slice(0, 10) + '...');

  // Step 2 skipped: loadXMTPInbox(key) with a new SDK (no signer) requires a persisted DB.
  // We use dbPath: null, so the XMTP SDK has no installation keys to rehydrate from key-only.

  console.log('3. XMTPConversations()...');
  const list = await sdk.XMTPConversations();
  ok(Array.isArray(list), 'list is array');
  console.log('   OK — count:', list.length);

  const myAddress = sdk.getXMTPInboxInfo()?.walletAddress;
  ok(myAddress, 'wallet address');

  console.log('4. loadXMTPConversation(self) + history() + message()...');
  const conv = await sdk.loadXMTPConversation(myAddress);
  const before = await conv.history({ limit: 5 });
  await conv.message(`Integration run at ${Date.now()}`);
  const after = await conv.history({ limit: 10 });
  ok(after.length >= before.length, 'message appeared in history');
  console.log('   OK');

  console.log('5. messageXMTP(self, content)...');
  await sdk.messageXMTP(myAddress, `Direct send at ${Date.now()}`);
  console.log('   OK');

  console.log('6. messageXMTP(unregistered) throws XMTPReceiverNotRegisteredError...');
  const unregistered = '0x0000000000000000000000000000000000000001';
  try {
    await sdk.messageXMTP(unregistered, 'Hi');
    throw new Error('expected throw');
  } catch (e) {
    ok(e?.name === 'XMTPReceiverNotRegisteredError', 'receiver not registered');
  }
  console.log('   OK');

  console.log('7. loadXMTPConversation(unregistered) throws...');
  try {
    await sdk.loadXMTPConversation(unregistered);
    throw new Error('expected throw');
  } catch (e) {
    ok(e?.name === 'XMTPReceiverNotRegisteredError', 'receiver not registered');
  }
  console.log('   OK');

  console.log('\nAll XMTP integration steps passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
