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
