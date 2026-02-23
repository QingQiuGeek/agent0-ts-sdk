/**
 * A2A (Agent-to-Agent) HTTP client: message:send, task query/cancel, response parsing.
 * Used by Agent.messageA2A(); protocol details live here for testability and reuse.
 */

import type {
  Part,
  MessageResponse,
  TaskResponse,
  AgentTask,
  MessageA2AOptions,
  TaskState,
} from '../models/a2a.js';

const ERR_402 = 'A2A server returned 402 Payment Required; x402 handling will be added in a later phase';
const ERR_NEITHER = 'A2A response contained neither task nor message';

function a2aHeaders(a2aVersion: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'A2A-Version': a2aVersion };
}

type CreateTaskHandleFn = (baseUrl: string, a2aVersion: string, taskId: string, contextId: string) => AgentTask;

/**
 * Parse JSON response from POST /message:send into MessageResponse or TaskResponse.
 */
export function parseMessageSendResponse(
  data: Record<string, unknown>,
  createTaskHandle: CreateTaskHandleFn,
  baseUrl: string,
  a2aVersion: string
): MessageResponse | TaskResponse {
  if (data.task != null && typeof data.task === 'object') {
    const taskObj = data.task as Record<string, unknown>;
    const taskId = String(taskObj.id ?? taskObj.taskId ?? '');
    const contextId = String(taskObj.contextId ?? '');
    if (!taskId) throw new Error('A2A task response missing task id');
    const task = createTaskHandle(baseUrl, a2aVersion, taskId, contextId);
    return {
      taskId,
      contextId,
      task,
      status: taskObj.status as TaskState | undefined,
    };
  }
  if (data.message != null && typeof data.message === 'object') {
    const msg = data.message as Record<string, unknown>;
    const partsOut = msg.parts as Part[] | undefined;
    return {
      content: typeof msg.content === 'string' ? msg.content : undefined,
      parts: Array.isArray(partsOut) ? partsOut : undefined,
      contextId: typeof msg.contextId === 'string' ? msg.contextId : undefined,
    };
  }
  throw new Error(ERR_NEITHER);
}

/**
 * POST to /message:send, handle 402/!ok, parse JSON into MessageResponse | TaskResponse.
 */
export async function postAndParseMessageSend(
  baseUrl: string,
  a2aVersion: string,
  body: Record<string, unknown>,
  createTaskHandle: CreateTaskHandleFn
): Promise<MessageResponse | TaskResponse> {
  const res = await fetch(`${baseUrl}/message:send`, {
    method: 'POST',
    headers: a2aHeaders(a2aVersion),
    body: JSON.stringify(body),
  });
  if (res.status === 402) throw new Error(ERR_402);
  if (!res.ok) throw new Error(`A2A request failed: HTTP ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Record<string, unknown>;
  return parseMessageSendResponse(data, createTaskHandle, baseUrl, a2aVersion);
}

/**
 * Build an AgentTask handle that can query, message, and cancel.
 */
export function createTaskHandle(
  baseUrl: string,
  a2aVersion: string,
  taskId: string,
  contextId: string
): AgentTask {
  const headers = () => a2aHeaders(a2aVersion);
  const task: AgentTask = {
    taskId,
    contextId,
    async query(options?: { historyLength?: number }) {
      const params = new URLSearchParams();
      if (options?.historyLength !== undefined) params.set('historyLength', String(options.historyLength));
      const q = params.toString();
      const url = `${baseUrl}/tasks/${encodeURIComponent(taskId)}${q ? `?${q}` : ''}`;
      const res = await fetch(url, { method: 'GET', headers: headers() });
      if (!res.ok) throw new Error(`Get task failed: HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      return {
        taskId: String(data.id ?? data.taskId ?? taskId),
        contextId: String(data.contextId ?? contextId),
        status: data.status as TaskState | undefined,
        artifacts: data.artifacts as unknown[] | undefined,
        messages: data.messages as unknown[] | undefined,
      };
    },
    async message(content: string | { parts: Part[] }) {
      const parts: Part[] =
        typeof content === 'string' ? [{ text: content }] : Array.isArray(content.parts) ? content.parts : [];
      const message: Record<string, unknown> = {
        role: 'ROLE_USER',
        parts,
        taskId,
        contextId,
        messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      };
      const body = { message };
      return postAndParseMessageSend(baseUrl, a2aVersion, body, createTaskHandle);
    },
    async cancel() {
      const res = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}:cancel`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Cancel task failed: HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      return {
        taskId: String(data.id ?? data.taskId ?? taskId),
        contextId: String(data.contextId ?? contextId),
        status: data.status as TaskState | undefined,
      };
    },
  };
  return task;
}

export interface SendMessageParams {
  baseUrl: string;
  a2aVersion: string;
  content: string | { parts: Part[] };
  options?: MessageA2AOptions;
}

/**
 * Send a message to the A2A endpoint. Returns MessageResponse or TaskResponse per spec §2.1.
 */
export async function sendMessage(params: SendMessageParams): Promise<MessageResponse | TaskResponse> {
  const { baseUrl, a2aVersion, content, options } = params;
  const parts: Part[] =
    typeof content === 'string'
      ? [{ text: content }]
      : Array.isArray(content.parts)
        ? content.parts
        : [];

  const message: Record<string, unknown> = {
    role: 'ROLE_USER',
    parts,
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
  if (options?.contextId) message.contextId = options.contextId;
  if (options?.taskId) message.taskId = options.taskId;

  const body: Record<string, unknown> = { message };
  if (options?.blocking !== undefined) {
    body.configuration = { blocking: options.blocking };
  }

  return postAndParseMessageSend(baseUrl, a2aVersion, body, createTaskHandle);
}
