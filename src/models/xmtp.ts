/**
 * XMTP types for SDK (spec §3).
 */

/**
 * Opaque installation key for loading an existing inbox.
 * Produced by registerXMTPInbox() or getXMTPInstallationKey(); format is internal.
 */
export type XMTPInstallationKey = string;

/**
 * Info about the currently loaded XMTP inbox.
 * Returned by sdk.getXMTPInboxInfo().
 */
export interface XMTPInboxInfo {
  /** Associated wallet address (WA) on the XMTP network. */
  walletAddress: string;
  /** Public key(s) for the installation. */
  publicKeys: Uint8Array | Uint8Array[];
  /** Private key(s) or key material; handle securely. */
  privateKeys: Uint8Array | Uint8Array[];
  /** Installation ID. */
  installationId: string;
  /** Inbox ID. */
  inboxId: string;
}
