#!/usr/bin/env node
/**
 * Minimal x402 test server for integration tests.
 * x402 spec: payment options in PAYMENT-REQUIRED header (base64 JSON), not body.
 * - Without PAYMENT-SIGNATURE: returns 402 with PAYMENT-REQUIRED header.
 * - With valid PAYMENT-SIGNATURE: returns 200 and optional PAYMENT-RESPONSE header.
 *
 * Env:
 *   PORT          - port (default 4020)
 *   ACCEPTS_JSON  - JSON array of accept options (default: single Base Sepolia USDC-style accept)
 */

import http from 'http';

const PORT = parseInt(process.env.PORT || '4020', 10);

const DEFAULT_ACCEPTS = [
  {
    price: '1000000',
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    network: '84532',
    scheme: 'exact',
    destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  },
];

function getAccepts() {
  try {
    if (process.env.ACCEPTS_JSON) {
      return JSON.parse(process.env.ACCEPTS_JSON);
    }
  } catch (e) {
    console.error('Invalid ACCEPTS_JSON:', e.message);
  }
  return DEFAULT_ACCEPTS;
}

function parsePaymentSignature(header) {
  if (!header || typeof header !== 'string') return null;
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (payload?.x402Version && payload?.payload?.signature != null && payload?.payload?.authorization) {
      return payload;
    }
  } catch (_) {}
  return null;
}

const server = http.createServer((req, res) => {
  const paymentSig = req.headers['payment-signature'];
  const payload = paymentSig ? parsePaymentSignature(paymentSig) : null;

  if (payload) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ settled: true, received: payload.payload?.authorization })).toString('base64'),
    });
    res.end(JSON.stringify({ success: true, data: 'resource' }));
    return;
  }

  const accepts = getAccepts();
  const paymentRequired = Buffer.from(
    JSON.stringify({ x402Version: 2, error: 'Payment required', accepts }),
    'utf8'
  ).toString('base64');
  res.writeHead(402, {
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': paymentRequired,
  });
  res.end(JSON.stringify({}));
});

server.listen(PORT, () => {
  console.log(`x402 test server on http://localhost:${PORT}`);
});
