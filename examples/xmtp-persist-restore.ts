/**
 * XMTP persist-and-restore example using a persistent DB (SDK as intended).
 *
 * 1. Create Alice inbox with a persistent DB path (+ optional encryption key).
 * 2. Bob registers; Alice and Bob exchange messages.
 * 3. Verify messages (Alice's view).
 * 4. Create a second SDK instance for Alice with the same path and installation key.
 * 5. Restored Alice lists conversations and reads history from the same DB file.
 *
 * Run:  npx tsx examples/xmtp-persist-restore.ts
 *
 * Environment: RPC_URL optional. PRIVATE_KEY_ALICE / PRIVATE_KEY_BOB optional (random keys if unset).
 */

import './_env';
import { SDK } from '../src/index';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const CHAIN_ID = 84532;
const DEFAULT_RPC = 'https://base-sepolia.drpc.org';

function randomPrivateKey(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i]! as number).toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

/** Fixed key for this example so both SDK instances open the same DB. In production use a secret and persist it. */
function exampleDbKey(): Uint8Array {
  const str = 'alice-xmtp-demo-key-32-bytes!!!!';
  return new Uint8Array(new TextEncoder().encode(str).subarray(0, 32));
}

async function main(): Promise<void> {
  const keyAlice = (process.env.PRIVATE_KEY_ALICE ?? '').trim() || randomPrivateKey();
  const keyBob = (process.env.PRIVATE_KEY_BOB ?? '').trim() || randomPrivateKey();
  const rpcUrl = (process.env.RPC_URL ?? DEFAULT_RPC).trim() || DEFAULT_RPC;

  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'alice-xmtp.db3');
  // Remove existing DB so we start fresh with our fixed key (previous runs may have used a different key).
  for (const p of [dbPath, dbPath + '.sqlcipher_salt', dbPath + '-wal', dbPath + '-shm']) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  const dbEncryptionKey = exampleDbKey();

  console.log('--- 1. Create Alice inbox (persistent DB) ---');
  const sdkAlice = new SDK({
    chainId: CHAIN_ID,
    rpcUrl,
    privateKey: keyAlice,
    xmtpDbPath: dbPath,
    xmtpDbEncryptionKey: dbEncryptionKey,
  });
  await sdkAlice.registerXMTPInbox();
  const installationKey = sdkAlice.getXMTPInstallationKey();
  if (!installationKey) throw new Error('Expected installation key');
  const aliceAddress = sdkAlice.getXMTPInboxInfo()!.walletAddress;
  console.log('Alice wallet:', aliceAddress);
  console.log('DB path:', dbPath);

  console.log('\n--- 2. Bob registers; Alice sends a message to Bob ---');
  const sdkBob = new SDK({ chainId: CHAIN_ID, rpcUrl, privateKey: keyBob });
  await sdkBob.registerXMTPInbox();
  const bobAddress = sdkBob.getXMTPInboxInfo()!.walletAddress;
  console.log('Bob wallet:', bobAddress);

  await sdkAlice.messageXMTP(bobAddress, 'Hello from Alice (persist-restore demo)');
  console.log('Alice sent.');
  await sdkBob.messageXMTP(aliceAddress, 'Hi Alice, Bob here');
  console.log('Bob replied.');

  console.log('\n--- 3. Verify messages (Alice before restore) ---');
  await new Promise((r) => setTimeout(r, 2000));
  const convBefore = await sdkAlice.loadXMTPConversation(bobAddress);
  const historyBefore = await convBefore.history({ limit: 10 });
  console.log('Alice conversation with Bob:', historyBefore.length, 'messages');
  historyBefore.forEach((m) => console.log(' -', m.content));
  if (historyBefore.length === 0) throw new Error('No messages; cannot verify.');

  console.log('\n--- 4. New SDK instance for Alice (same path + key) ---');
  const sdkAliceRestored = new SDK({
    chainId: CHAIN_ID,
    rpcUrl,
    privateKey: keyAlice,
    xmtpInstallationKey: installationKey,
    xmtpDbPath: dbPath,
    xmtpDbEncryptionKey: dbEncryptionKey,
  });
  await sdkAliceRestored.loadXMTPInbox();
  console.log('Restored Alice inbox:', sdkAliceRestored.getXMTPInboxInfo()!.walletAddress);

  console.log('\n--- 5. Restored Alice: list conversations and read history ---');
  const conversations = await sdkAliceRestored.XMTPConversations();
  console.log('Conversations count:', conversations.length);
  const convRestored = await sdkAliceRestored.loadXMTPConversation(bobAddress);
  const historyRestored = await convRestored.history({ limit: 10 });
  console.log('Restored Alice conversation with Bob:', historyRestored.length, 'messages');
  historyRestored.forEach((m) => console.log(' -', m.content));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
