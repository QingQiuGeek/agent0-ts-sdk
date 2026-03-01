/**
 * x402-types unit tests: parse402AcceptsFromHeader (PAYMENT-REQUIRED header only; x402 spec).
 * Imports only from x402-types to avoid pulling in SDK/XMTP.
 */

import { parse402AcceptsFromHeader } from '../src/core/x402-types.js';

describe('parse402AcceptsFromHeader', () => {
  it('parses base64 PAYMENT-REQUIRED header with accepts', () => {
    const payload = {
      x402Version: 2,
      error: 'Payment required',
      accepts: [
        { scheme: 'exact', network: 'eip155:8453', amount: '1000', asset: '0x83...', payTo: '0xf89...' },
      ],
    };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const out = parse402AcceptsFromHeader(b64);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      price: '1000',
      token: '0x83...',
      destination: '0xf89...',
      network: 'eip155:8453',
      scheme: 'exact',
    });
  });

  it('returns [] for null or empty string', () => {
    expect(parse402AcceptsFromHeader(null)).toEqual([]);
    expect(parse402AcceptsFromHeader('')).toEqual([]);
  });

  it('returns [] for invalid base64 or non-JSON', () => {
    expect(parse402AcceptsFromHeader('not-valid-base64!!!')).toEqual([]);
    expect(parse402AcceptsFromHeader(Buffer.from('{}', 'utf8').toString('base64'))).toEqual([]); // no accepts
  });
});
