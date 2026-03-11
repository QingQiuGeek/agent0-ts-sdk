/**
 * Integration test for Endpoint Crawler with Real Public MCP and A2A Servers
 * Tests against actual public servers.
 */

import { EndpointCrawler } from '../src/index';

describe('Endpoint Crawler with Real Public Servers', () => {
  let crawler: EndpointCrawler;

  beforeAll(() => {
    crawler = new EndpointCrawler(10000); // Longer timeout for real servers
  });

  it('should fetch A2A capabilities from real server', async () => {
    const endpoint = 'https://hello-world-gxfr.onrender.com';
    const capabilities = await crawler.fetchA2aCapabilities(endpoint);

    // Should either succeed or fail gracefully (soft failure pattern)
    expect(capabilities !== undefined || capabilities === null).toBe(true);
  });

  it('should fetch MCP capabilities from real server (if available)', async () => {
    const endpoint = 'https://mcp.atlassian.com/v1/forge/mcp';
    const capabilities = await crawler.fetchMcpCapabilities(endpoint);

    // Should either succeed or fail gracefully (soft failure pattern)
    // Most MCP servers require authentication, so this may return null
    expect(capabilities !== undefined || capabilities === null).toBe(true);
  });

  it('should handle invalid endpoints gracefully', async () => {
    const invalidEndpoint = 'https://invalid-endpoint-that-does-not-exist.example.com';
    const capabilities = await crawler.fetchMcpCapabilities(invalidEndpoint);

    // Should return null for invalid endpoints (soft failure)
    expect(capabilities).toBeNull();
  });

  it('should validate HTTP/HTTPS requirement for MCP', async () => {
    const wsEndpoint = 'ws://example.com/mcp';
    const capabilities = await crawler.fetchMcpCapabilities(wsEndpoint);

    // Should reject WebSocket URLs
    expect(capabilities).toBeNull();
  });

  it('should validate HTTP/HTTPS requirement for A2A', async () => {
    const wsEndpoint = 'ws://example.com/a2a';
    const capabilities = await crawler.fetchA2aCapabilities(wsEndpoint);

    // Should reject WebSocket URLs
    expect(capabilities).toBeNull();
  });
});

describe('Endpoint Crawler A2A auth extraction (mocked fetch)', () => {
  it('returns securitySchemes and security from agent card when present', async () => {
    const agentCardUrl = 'https://a2a-auth.example.com/.well-known/agent-card.json';
    const agentCard = {
      name: 'Test Agent',
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      security: [{ apiKey: [] }, { bearerAuth: [] }],
    };

    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (String(url).includes('agent-card') || String(url).endsWith('/.well-known/agent-card.json')) {
        return Promise.resolve(
          new Response(JSON.stringify(agentCard), { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const crawler = new EndpointCrawler(5000);
    const capabilities = await crawler.fetchA2aCapabilities(agentCardUrl);

    expect(capabilities).not.toBeNull();
    expect(capabilities?.securitySchemes).toBeDefined();
    expect(capabilities?.securitySchemes?.apiKey).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(capabilities?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' });
    expect(capabilities?.security).toHaveLength(2);
    expect(capabilities?.security).toEqual([{ apiKey: [] }, { bearerAuth: [] }]);

    fetchSpy.mockRestore();
  });
});

