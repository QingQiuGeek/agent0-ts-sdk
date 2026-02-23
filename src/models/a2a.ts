/**
 * A2A (Agent-to-Agent) types per docs/sdk-messaging-tasks-x402-spec.md §2 and §5.
 */

/** Options for messageA2A (blocking, contextId, taskId; credential and payment in later phases). */
export interface MessageA2AOptions {
  blocking?: boolean;
  contextId?: string;
  taskId?: string;
}

/**
 * Part: smallest unit of content in a Message or Artifact.
 * Per A2A Protocol: text, url, data, or raw.
 */
export interface Part {
  text?: string;
  url?: string;
  data?: string;
  raw?: string;
  [key: string]: unknown;
}

/**
 * Direct message response from an A2A server (no task created).
 * No `task` or `taskId`; discriminate from TaskResponse by shape.
 */
export interface MessageResponse {
  content?: string;
  parts?: Part[];
  contextId?: string;
}

/**
 * Task state returned by task.query() or after cancel.
 * Server-specific status values; common: open, working, completed, failed, canceled, rejected.
 */
export interface TaskState {
  state?: string;
  [key: string]: unknown;
}

/**
 * Task handle: read-only taskId, contextId, and methods query, message, cancel.
 * Returned by response.task and by agent.loadTask(taskId).
 */
export interface AgentTask {
  readonly taskId: string;
  readonly contextId: string;
  query(options?: { historyLength?: number }): Promise<{ taskId: string; contextId: string; status?: TaskState; artifacts?: unknown[]; messages?: unknown[] }>;
  message(content: string | { parts: Part[] }): Promise<MessageResponse | TaskResponse>;
  cancel(): Promise<{ taskId: string; contextId: string; status?: TaskState }>;
}

/**
 * Response when the server created a task.
 * Discriminate from MessageResponse by 'task' in response.
 */
export interface TaskResponse {
  taskId: string;
  contextId: string;
  task: AgentTask;
  /** Optional task snapshot from send response */
  status?: TaskState;
}
