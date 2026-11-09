/**
 * Type definitions for the Codex app-server integration.
 *
 * The app-server uses JSON-RPC 2.0 (jsonrpc field omitted on wire)
 * over JSONL on stdin/stdout. Three message types on the wire:
 * 1. Responses to our requests (id, result/error, no method)
 * 2. Server-initiated requests (id AND method) — approval requests
 * 3. Notifications (method, no id) — streaming events
 */

// ─── Service status ─────────────────────────────────────────────────────────

export type ServerStatus = 'stopped' | 'starting' | 'ready' | 'error'

// ─── Approval ───────────────────────────────────────────────────────────────

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

// ─── Thread/Turn params ─────────────────────────────────────────────────────

export interface ThreadStartParams {
  cwd?: string
  model?: string
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalsReviewer?: 'user' | 'auto_review'
}

export interface ThreadReadParams {
  includeTurns?: boolean
}

export interface ThreadForkParams extends ThreadStartParams {
  threadId: string
}

export interface ThreadRollbackParams {
  threadId: string
  numTurns: number
}

export interface ThreadListParams {
  cursor?: string | null
  limit?: number | null
  sortKey?: string | null
  sortDirection?: 'asc' | 'desc' | null
  modelProviders?: string[] | null
  sourceKinds?: string[] | null
  archived?: boolean | null
  cwd?: string | string[] | null
  useStateDbOnly?: boolean
  searchTerm?: string | null
}

export interface ConfigReadParams {
  includeLayers: boolean
  cwd?: string | null
}

export interface ConfigValueWriteParams {
  keyPath: string
  value: any
  mergeStrategy?: 'replace' | 'upsert'
  filePath?: string | null
  expectedVersion?: string | null
}

export interface TurnStartParams {
  threadId: string
  input: Array<{ type: 'text'; text: string }>
  cwd?: string
  collaborationMode?: {
    mode: 'plan' | 'code' | 'execute' | 'default' | 'custom' | 'pair_programming'
    settings: { model?: string; developer_instructions?: string | null }
  }
  approvalsReviewer?: 'user' | 'auto_review'
  model?: string
}

// ─── Consumer handlers (per-thread notification routing) ────────────────────

export interface ConsumerHandlers {
  /** Called for streaming notifications (item/started, item/completed, item/agentMessage/delta, turn/completed, etc.) */
  onNotification(method: string, params: any): void
  /** Called for server-initiated approval requests. Response sent separately via respondToApproval. */
  onApproval(method: string, requestId: number, params: any): void
  /** Called when the app-server process exits unexpectedly. Consumer should clean up thread state. */
  onCrash?(error: string): void
  /**
   * Called when this consumer is unregistered, so what a turn was holding is released.
   *
   * **Unregistering is one of the ways a turn ends, and the only one with no notification.** `killTurn`
   * interrupts the turn and unregisters, so `turn/completed` never arrives and the consumer's own
   * `finalize` never runs — which left the assistant message with a stale tail and no
   * `responseTimestamp`. A consumer's writers have a lifetime, so the registration owns their release.
   */
  onUnregistered?(): void
}

// ─── Turn handle (stored per app thread for pause/abort) ────────────────────

export interface CodexTurnHandle {
  /** Codex app-server thread ID */
  codexThreadId: string
  /** Active turn ID */
  turnId: string
  /** Interrupt the running turn */
  abort(): Promise<void>
}

/** A page of the app server's MCP server statuses */
export type ListMcpServersParams = { cursor?: string | null; limit?: number | null; detail?: 'full' | 'toolsAndAuthOnly' | null }
