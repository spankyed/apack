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
  id: string
  jobId: string
  sessionId: string
  cwd: string
  clientPid: number
  status: 'live' | 'exited'
  exitCode?: number
  output: { sequence: number; text: string }[]
}
