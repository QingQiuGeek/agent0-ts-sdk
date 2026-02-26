/**
 * XMTP integration tests: real wallet + XMTP dev network.
 *
 * Jest cannot load the ESM-only @xmtp/node-sdk, so this describe is always skipped.
 * To run with a real wallet, use the standalone script instead:
 *
 *   npm run build
 *   npm run test:xmtp-integration:run
 *
 * Requires in .env or environment:
 *   - CHAIN_ID, RPC_URL (for wallet/signing)
 *   - XMTP_TEST_PRIVATE_KEY (hex EOA private key)
 */

describe.skip('XMTP integration (real wallet) — use npm run test:xmtp-integration:run', () => {
  it('placeholder', () => {});
});
