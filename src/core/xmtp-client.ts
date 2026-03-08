/**
 * Internal XMTP client wrapper around @xmtp/node-sdk.
 * Uses dbPath: null (no local DB); builds EOA signer from chain client.
 */
import { Client } from '@xmtp/node-sdk';
import type { Identifier } from '@xmtp/node-sdk';
import type { ChainClient } from './chain-client.js';
import type { XMTPInboxInfo } from '../models/xmtp.js';
import type { XMTPInstallationKey } from '../models/xmtp.js';
import {
  XMTPAlreadyConnectedError,
  XMTPLoadError,
  XMTPMaxInstallationsError,
  XMTPReceiverNotRegisteredError,
  XMTPWalletRequiredError,
} from './xmtp-errors.js';

const IDENTIFIER_KIND_ETHEREUM = 0 as const;

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const len = s.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Build XMTP Identifier from wallet address (for canMessage, createDm, etc.). */
export function toIdentifier(address: string): Identifier {
  return { identifier: address, identifierKind: IDENTIFIER_KIND_ETHEREUM };
}

/**
 * Ensure the peer has a registered inbox; throw XMTPReceiverNotRegisteredError if not.
 */
export async function ensurePeerCanMessage(
  client: InstanceType<typeof Client>,
  peerAddress: string
): Promise<void> {
  const identifier = toIdentifier(peerAddress);
  const map = await client.canMessage([identifier]);
  const key = peerAddress.toLowerCase();
  const can =
    map.get(peerAddress) ??
    map.get(identifier.identifier) ??
    map.get(key) ??
    false;
  if (!can) {
    throw new XMTPReceiverNotRegisteredError();
  }
}

/** Hex string (0x + 64 chars) or 32-byte key for DB encryption. */
export type XmtpDbEncryptionKey = Uint8Array | `0x${string}`;

export type XmtpClientOptions = {
  env?: 'local' | 'dev' | 'production';
  /**
   * When set with register: use a temp DB path, then read and delete the file and expose the blob.
   * When set with load and dbBlob: write blob to temp path and build client from it.
   * Node only (uses fs/path/os). Persist the blob from getXMTPDatabaseBlob() and pass it back as dbBlob when loading.
   */
  dbEncryptionKey?: XmtpDbEncryptionKey;
  /** Optional path for create (default: temp file). Ignored if dbEncryptionKey not set. */
  dbPath?: string;
  /** Persisted DB blob for restore (load only). Write to temp path then Client.build(). */
  dbBlob?: Uint8Array;
};

/** Serialized installation key format (internal). */
export interface InstallationKeyPayload {
  version: number;
  walletAddress: string;
  env?: 'local' | 'dev' | 'production';
}

function serializeInstallationKey(payload: InstallationKeyPayload): XMTPInstallationKey {
  return JSON.stringify(payload);
}

function parseInstallationKey(key: XMTPInstallationKey): InstallationKeyPayload {
  try {
    const parsed = JSON.parse(key) as InstallationKeyPayload;
    if (typeof parsed.walletAddress !== 'string' || !parsed.walletAddress) {
      throw new XMTPLoadError('Invalid installation key: missing walletAddress');
    }
    if (parsed.version !== 1) {
      throw new XMTPLoadError('Invalid installation key: unsupported version');
    }
    return parsed;
  } catch (e) {
    if (e instanceof XMTPLoadError) throw e;
    throw new XMTPLoadError('Invalid installation key: invalid format');
  }
}

export type XMTPClientWrapperState = {
  client: InstanceType<typeof Client>;
  installationKey: XMTPInstallationKey;
  /** Set when register used dbEncryptionKey (read-from-path workaround). Persist this and pass as dbBlob when loading. */
  dbBlob?: Uint8Array;
  /** Set when register used dbEncryptionKey and we kept the DB on disk. Use readDbFromPath(this.dbPath) to capture blob after send/sync. */
  dbPath?: string;
};

/**
 * Build an EOA signer for XMTP from the SDK's chain client.
 * Throws XMTPWalletRequiredError if no signer/address available.
 */
export async function buildXmtpEoaSigner(chainClient: ChainClient): Promise<{
  type: 'EOA';
  getIdentifier: () => Promise<Identifier>;
  signMessage: (message: string) => Promise<Uint8Array>;
}> {
  const address = await chainClient.getAddress();
  if (!address) {
    throw new XMTPWalletRequiredError();
  }
  return {
    type: 'EOA',
    async getIdentifier() {
      return toIdentifier(address);
    },
    async signMessage(message: string) {
      const hex = await chainClient.signMessage(message);
      return hexToBytes(hex);
    },
  };
}

const DEFAULT_ENV: 'local' | 'dev' | 'production' = 'production';

const SALT_SUFFIXES = ['.sqlcipher_salt', '.sqlitecipher_salt'] as const;

/** Node-only: read file at path, return buffer. Returns undefined if file missing. */
async function readFileIfExists(filePath: string): Promise<Uint8Array | undefined> {
  const fs = await import('node:fs').then((m) => m.default ?? m);
  try {
    const buf = fs.readFileSync(filePath) as Buffer;
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

/** Node-only: read file at path, delete it, return buffer. Returns undefined if file missing. */
async function readFileAndDeleteIfExists(filePath: string): Promise<Uint8Array | undefined> {
  const fs = await import('node:fs').then((m) => m.default ?? m);
  try {
    const buf = fs.readFileSync(filePath) as Buffer;
    fs.unlinkSync(filePath);
    return new Uint8Array(buf);
  } catch {
    return undefined;
  }
}

/** Pack db, optional salt, optional wal, optional shm. Each chunk: 4-byte len (big-endian) then bytes. */
function packDbAndSalt(db: Uint8Array, salt: Uint8Array | undefined, wal: Uint8Array | undefined, shm: Uint8Array | undefined): Uint8Array {
  const chunks: Uint8Array[] = [db, salt ?? new Uint8Array(0), wal ?? new Uint8Array(0), shm ?? new Uint8Array(0)];
  let len = 0;
  for (const c of chunks) len += 4 + c.length;
  const out = new Uint8Array(len);
  const view = new DataView(out.buffer);
  let off = 0;
  for (const c of chunks) {
    view.setUint32(off, c.length, false);
    out.set(c, off + 4);
    off += 4 + c.length;
  }
  return out;
}

/** Unpack blob into db, salt, wal, shm (each optional by length). */
function unpackDbAndSalt(blob: Uint8Array): { db: Uint8Array; salt: Uint8Array | undefined; wal: Uint8Array | undefined; shm: Uint8Array | undefined } {
  if (blob.length < 4) throw new XMTPLoadError('Invalid db blob: too short');
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let off = 0;
  const readChunk = (): Uint8Array | undefined => {
    if (off + 4 > blob.length) return undefined;
    const len = view.getUint32(off, false);
    off += 4;
    if (len === 0) return undefined;
    if (off + len > blob.length) throw new XMTPLoadError('Invalid db blob: length mismatch');
    const out = blob.slice(off, off + len);
    off += len;
    return out;
  };
  const db = readChunk();
  if (!db) throw new XMTPLoadError('Invalid db blob: missing db');
  return {
    db,
    salt: readChunk(),
    wal: readChunk(),
    shm: readChunk(),
  };
}

/** Node-only: read DB, salt, wal, shm; delete all; return packed blob. */
async function readDbAndSaltThenDelete(dbPath: string): Promise<Uint8Array> {
  const pathMod = await import('node:path').then((m) => m.default ?? m);
  const fs = await import('node:fs').then((m) => m.default ?? m);
  const dir = pathMod.dirname(dbPath);
  const base = pathMod.basename(dbPath);
  const db = await readFileAndDeleteIfExists(dbPath);
  if (!db) throw new XMTPLoadError(`DB file not found: ${dbPath}`);
  let salt: Uint8Array | undefined;
  for (const suffix of SALT_SUFFIXES) {
    salt = await readFileAndDeleteIfExists(dbPath + suffix);
    if (salt !== undefined) break;
  }
  if (!salt) {
    const siblings = fs.readdirSync(dir).filter((f: string) => f.startsWith(base));
    for (const name of siblings) {
      if (name !== base && (name.includes('salt') || name.endsWith('_salt'))) {
        salt = await readFileAndDeleteIfExists(pathMod.join(dir, name));
        if (salt !== undefined) break;
      }
    }
  }
  const wal = await readFileAndDeleteIfExists(dbPath + '-wal');
  const shm = await readFileAndDeleteIfExists(dbPath + '-shm');
  return packDbAndSalt(db, salt, wal, shm);
}

/** Node-only: read DB, salt, wal, shm from path (no delete). Use to capture current DB state after send/sync. */
export async function readDbFromPath(dbPath: string): Promise<Uint8Array> {
  const pathMod = await import('node:path').then((m) => m.default ?? m);
  const fs = await import('node:fs').then((m) => m.default ?? m);
  const dir = pathMod.dirname(dbPath);
  const base = pathMod.basename(dbPath);
  const db = await readFileIfExists(dbPath);
  if (!db) throw new XMTPLoadError(`DB file not found: ${dbPath}`);
  let salt: Uint8Array | undefined;
  for (const suffix of SALT_SUFFIXES) {
    salt = await readFileIfExists(dbPath + suffix);
    if (salt !== undefined) break;
  }
  if (!salt) {
    const siblings = fs.readdirSync(dir).filter((f: string) => f.startsWith(base));
    for (const name of siblings) {
      if (name !== base && (name.includes('salt') || name.endsWith('_salt'))) {
        salt = await readFileIfExists(pathMod.join(dir, name));
        if (salt !== undefined) break;
      }
    }
  }
  const wal = await readFileIfExists(dbPath + '-wal');
  const shm = await readFileIfExists(dbPath + '-shm');
  return packDbAndSalt(db, salt, wal, shm);
}

/** Node-only: unpack blob, write db/salt/wal/shm to temp files, return DB path. */
async function unpackAndWriteToTemp(blob: Uint8Array, prefix: string): Promise<string> {
  const fs = await import('node:fs').then((m) => m.default ?? m);
  const path = await import('node:path').then((m) => m.default ?? m);
  const os = await import('node:os').then((m) => m.default ?? m);
  const { db, salt, wal, shm } = unpackDbAndSalt(blob);
  const dir = os.tmpdir();
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db3`;
  const dbPath = path.join(dir, name);
  fs.writeFileSync(dbPath, db);
  if (salt && salt.length > 0) fs.writeFileSync(dbPath + '.sqlcipher_salt', salt);
  if (wal && wal.length > 0) fs.writeFileSync(dbPath + '-wal', wal);
  if (shm && shm.length > 0) fs.writeFileSync(dbPath + '-shm', shm);
  return dbPath;
}

/** Node-only: create a temp path for the DB (caller uses it with Client.create). */
async function tempDbPath(prefix: string): Promise<string> {
  const path = await import('node:path').then((m) => m.default ?? m);
  const os = await import('node:os').then((m) => m.default ?? m);
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db3`;
  return path.join(os.tmpdir(), name);
}

/**
 * Load an existing XMTP inbox from a previously saved installation key.
 * - If options.dbPath is set: build from that path (persistent DB). Optional dbEncryptionKey.
 * - If options.dbBlob and options.dbEncryptionKey are set (Node only): write blob to temp and build (serverless restore).
 * - Otherwise: dbPath null (no persistence).
 */
export async function loadXMTPInboxFromKey(
  installationKey: XMTPInstallationKey,
  options?: XmtpClientOptions
): Promise<XMTPClientWrapperState> {
  const payload = parseInstallationKey(installationKey);
  const env = options?.env ?? payload.env ?? DEFAULT_ENV;
  const identifier = toIdentifier(payload.walletAddress);
  const dbEncryptionKey = options?.dbEncryptionKey;
  const dbBlob = options?.dbBlob;
  const dbPath = options?.dbPath;

  let client: InstanceType<typeof Client>;
  if (dbBlob && dbEncryptionKey) {
    const restoredPath = await unpackAndWriteToTemp(dbBlob, 'xmtp-restore');
    client = await Client.build(identifier, {
      dbPath: restoredPath,
      dbEncryptionKey: dbEncryptionKey as Uint8Array | `0x${string}`,
      env,
      loggingLevel: 'Off',
    });
    try {
      await client.sendSyncRequest();
    } catch {
      // optional
    }
  } else if (dbPath) {
    client = await Client.build(identifier, {
      dbPath,
      dbEncryptionKey: dbEncryptionKey as Uint8Array | `0x${string}` | undefined,
      env,
      loggingLevel: 'Off',
    });
  } else {
    client = await Client.build(identifier, {
      dbPath: null,
      env,
      loggingLevel: 'Off',
    });
  }
  try {
    await client.conversations.sync();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dbBlob && !dbPath) throw new XMTPLoadError(`Inbox not found or invalid for key: ${msg}`);
  }
  const key = serializeInstallationKey({
    version: 1,
    walletAddress: payload.walletAddress,
    env,
  });
  return { client, installationKey: key };
}

/**
 * Register a new XMTP inbox using the chain client's signer.
 * When options.dbPath is set (and optionally dbEncryptionKey), the DB is written to that path and persists.
 * Throws if already connected, or no wallet, or max installations.
 */
export async function registerXMTPInboxWithSigner(
  chainClient: ChainClient,
  options?: XmtpClientOptions
): Promise<XMTPClientWrapperState> {
  const signer = await buildXmtpEoaSigner(chainClient);
  const env = options?.env ?? DEFAULT_ENV;
  const dbEncryptionKey = options?.dbEncryptionKey;
  const dbPath = options?.dbPath ?? (dbEncryptionKey ? await tempDbPath('xmtp-create') : null);

  try {
    const client = await Client.create(signer, {
      dbPath: dbPath ?? null,
      dbEncryptionKey: dbEncryptionKey as Uint8Array | `0x${string}` | undefined,
      env,
      loggingLevel: 'Off',
    });
    const walletAddress = client.accountIdentifier?.identifier ?? '';
    const installationKey = serializeInstallationKey({
      version: 1,
      walletAddress,
      env,
    });
    return { client, installationKey };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/max(imum)?\s*(number\s*of\s*)?installation|installation\s*(limit|maximum|reached)/i.test(msg)) {
      throw new XMTPMaxInstallationsError(msg);
    }
    throw e;
  }
}

/**
 * Get inbox info from a loaded client state.
 * privateKeys are not exposed by the XMTP Node SDK; we return installationIdBytes as public key material.
 */
export function getXMTPInboxInfoFromState(state: XMTPClientWrapperState): XMTPInboxInfo {
  const c = state.client;
  const walletAddress = c.accountIdentifier?.identifier ?? '';
  return {
    walletAddress,
    publicKeys: [c.installationIdBytes],
    privateKeys: [],
    installationId: c.installationId,
    inboxId: c.inboxId,
  };
}
