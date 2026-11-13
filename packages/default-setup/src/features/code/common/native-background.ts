import type { ClaudeNativeTerminalTask } from './native-terminal.ts'

/** Original session totals belong to the child snapshot; they are never parent billing deltas. */
export interface ClaudeBackgroundStatus {
  jobId: string
  sessionId: string
  pid: number
  observedAt: number
  model: string
  turns: number
  startedAt: number
  context?: { tokens: number; window: number; percent: number }
  totalCostUsd?: number
  statusLine?: string
  agents?: ClaudeNativeTerminalTask[]
}

/** Original background job identity is distinct from the parent app conversation. */
export interface ClaudeBackgroundSession {
  id: string
  sessionId: string
  cwd: string
  name?: string
  pid?: number
  state: 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
  status?: 'idle' | 'waiting' | 'busy'
  waitingFor?: string
}
export type ClaudeBackgroundSessionRequest = { operation: 'refresh' } | { operation: 'stop'; id: string; pid: number }

/** Explicit original turn cancellation; never a whole-worker Stop request. */
export interface ClaudeBackgroundTurnInterruptRequest { operation: 'interrupt'; target: ClaudeBackgroundUiTarget; turnId: string }

/** Native next-turn reply; an acknowledgement means queued, not a stored transcript receipt. */
export interface ClaudeBackgroundReplyRequest { operation: 'reply'; id: string; pid: number; text: string }

export interface ClaudeBackgroundReview {
  revision: string
  title: string
  paragraphs: string[]
  confirmLabel: string
  cancelLabel: string
  defaultFocus: 'confirm' | 'cancel'
}
export interface ClaudeBackgroundReviewState {
  status: 'loading' | 'ready' | 'pending' | 'error'
  review?: ClaudeBackgroundReview
  problem?: string
}

/** An attach client is separate from the background worker it displays. */
export interface ClaudeBackgroundAttachmentSnapshot {
  terminalSession: import('./native-terminal.ts').ClaudeNativeTerminalSession
  id: string
  jobId: string
  sessionId: string
  cwd: string
  /**
   * The attach client's process id, **`null` when the host did not say** — it answers one for a session it
   * just started and not for one it took up again. A diagnostic: nothing addresses the client by it.
   */
  clientPid: number | null
  status: 'live' | 'exited'
  exitCode?: number
  output: { sequence: number; text: string }[]
}

/** Exact app-owned worker incarnation selected by a desktop composer. */
export interface ClaudeBackgroundUiTarget {
  ownerId: string
  parentSessionId: string
  sessionId: string
  jobSessionId: string
  jobId: string
  pid: number
  processStart: string
}
