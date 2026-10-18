/** Native task ids and terminal owners are independent of apack thread ids. */
export interface ClaudeNativeTerminalTask {
  id: string
  name: string
  status: string
  statusText?: string
}
export interface ClaudeNativeTerminalState {
  ownerId: string
  sessionId: string
  cwd: string
  status: 'starting' | 'live' | 'exited' | 'error'
  /** Process attached to the PTY; may be a configured launcher. */
  pid?: number
  /** Authenticated native executable beneath that launcher. */
  nativePid?: number
  exitCode?: number
  busy: boolean
  lastTurn?: { id: string; reason: 'answer' | 'aborted' | 'refusal' | 'error' }
  session?: import('../be/services/claude-code/terminal-session.ts').ClaudeNativeSessionMetadata
  mainStatus?: string
  tasks: ClaudeNativeTerminalTask[]
  problem?: string
}

export interface ClaudeNativeTaskDetails {
  taskId: string
  name: string
  status: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  truncated: boolean
}
