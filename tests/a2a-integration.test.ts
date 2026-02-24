/**
 * A2A integration tests: real A2A server + SDK Agent.messageA2A and task methods.
 *
 * Run with: RUN_A2A_INTEGRATION=1 npm test -- --testPathPattern=a2a-integration
 * Or:       npm run test:a2a-integration
 */

import { spawn } from 'child_process';
import type { RegistrationFile } from '../src/models/interfaces.js';
import { EndpointType, TrustModel } from '../src/models/enums.js';
import { Agent } from '../src/core/agent.js';
import type { SDK } from '../src/core/sdk.js';

const INTEGRATION_PORT = 4030;
const SERVER_PATH = 'tests/a2a-server/server.mjs';
const BASE_URL = `http://localhost:${INTEGRATION_PORT}`;

let serverProcess: ReturnType<typeof spawn> | null = null;

async function waitForServer(url: string, maxAttempts = 25): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('A2A server did not become ready');
}

function makeAgentWithA2AEndpoint(baseUrl: string): Agent {
  const regFile: RegistrationFile = {
    name: 'Integration Test Agent',
    description: 'Test',
    endpoints: [
      { type: EndpointType.A2A, value: baseUrl, meta: { version: '0.3' } },
    ],
    trustModels: [TrustModel.REPUTATION],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 0,
  };
  const stubSdk = {
    getX402RequestDeps: () => ({
      fetch: globalThis.fetch,
      buildPayment: async () => {
        throw new Error('402 not expected in this test');
      },
    }),
  } as unknown as SDK;
  return new Agent(stubSdk, regFile);
}

const runIntegration = process.env.RUN_A2A_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('A2A integration (server)', () => {
  beforeAll(async () => {
    serverProcess = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(INTEGRATION_PORT) },
      stdio: 'pipe',
    });
    await waitForServer(BASE_URL);
  }, 15000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  it('messageA2A returns message response (echo)', async () => {
    const agent = makeAgentWithA2AEndpoint(BASE_URL);
    const result = await agent.messageA2A('hello');

    expect('x402Required' in result && result.x402Required).toBe(false);
    expect('task' in result).toBe(false);
    if (!('task' in result) && !('x402Required' in result)) {
      expect(result.content).toContain('Echo: hello');
      expect(result.contextId).toBeDefined();
    }
  }, 10000);

  it('messageA2A with "task" in text returns task, then query/message/cancel work', async () => {
    const agent = makeAgentWithA2AEndpoint(BASE_URL);
    const result = await agent.messageA2A('create task');

    expect('x402Required' in result && result.x402Required).toBe(false);
    expect('task' in result).toBe(true);
    if (!('task' in result)) return;

    const { task } = result;
    expect(task.taskId).toBeDefined();
    expect(task.contextId).toBeDefined();

    const queryResult = await task.query({ historyLength: 5 });
    expect('x402Required' in queryResult).toBe(false);
    if (!('x402Required' in queryResult)) {
      expect(queryResult.taskId).toBe(task.taskId);
      expect(queryResult.status).toEqual({ state: 'open' });
    }

    const msgResult = await task.message('follow up');
    expect('x402Required' in msgResult).toBe(false);
    expect('task' in msgResult).toBe(false);
    if (!('x402Required' in msgResult) && !('task' in msgResult)) {
      expect(msgResult.content).toContain('Echo: follow up');
    }

    const cancelResult = await task.cancel();
    expect('x402Required' in cancelResult).toBe(false);
    if (!('x402Required' in cancelResult)) {
      expect(cancelResult.taskId).toBe(task.taskId);
      expect(cancelResult.status).toEqual({ state: 'canceled' });
    }
  }, 15000);
});
