#!/usr/bin/env node
/**
 * Minimal A2A test server for integration tests.
 * Implements: POST /message:send, GET /tasks/:id, POST /tasks/:id:cancel.
 *
 * Env:
 *   PORT           - port (default 4030)
 *   RESPOND_WITH   - "message" (default) or "task" for first message:send
 *
 * Run: node tests/a2a-server/server.mjs
 */

import http from 'http';

const PORT = parseInt(process.env.PORT || '4030', 10);
const RESPOND_WITH = process.env.RESPOND_WITH || 'message';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (ch) => chunks.push(ch));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getTaskIdFromPath(pathname, forCancel = false) {
  const normalized = forCancel ? pathname.replace(/:cancel$/, '') : pathname;
  const match = normalized.match(/^\/tasks\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // GET / health (for integration test readiness)
    if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
      return send(res, 200, { ok: true });
    }

    // POST /message:send
    if (req.method === 'POST' && pathname === '/message:send') {
      const body = await parseBody(req);
      const message = body.message || {};
      const parts = message.parts || [];
      const firstText = (parts[0] && parts[0].text) || '';
      const contextId = message.contextId || body.message?.contextId || `ctx-${Date.now()}`;

      const respondWithTask = RESPOND_WITH === 'task' || firstText.toLowerCase().includes('task');
      if (respondWithTask) {
        const taskId = `task-${Date.now()}`;
        return send(res, 200, {
          taskId,
          contextId,
          task: {
            id: taskId,
            contextId,
            status: { state: 'open' },
          },
        });
      }

      const echo = firstText ? `Echo: ${firstText}` : 'OK';
      return send(res, 200, {
        message: {
          content: echo,
          parts: [{ text: echo }],
          contextId,
        },
      });
    }

    // GET /tasks/:id
    if (req.method === 'GET' && pathname.startsWith('/tasks/') && !pathname.endsWith(':cancel')) {
      const taskId = getTaskIdFromPath(pathname, false);
      if (!taskId) return send(res, 404, { error: 'not found' });
      return send(res, 200, {
        id: taskId,
        taskId,
        contextId: `ctx-${taskId}`,
        status: { state: 'open' },
        messages: [],
        artifacts: [],
      });
    }

    // POST /tasks/:id:cancel
    if (req.method === 'POST' && pathname.includes(':cancel')) {
      const taskId = getTaskIdFromPath(pathname, true);
      if (!taskId) return send(res, 404, { error: 'not found' });
      return send(res, 200, {
        id: taskId,
        taskId,
        contextId: `ctx-${taskId}`,
        status: { state: 'canceled' },
      });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: String(err.message) });
  }
});

server.listen(PORT, () => {
  console.log(`A2A test server on http://localhost:${PORT}`);
});
