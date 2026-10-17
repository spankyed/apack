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
  pid?: number
  exitCode?: number
  mainStatus?: string
  tasks: ClaudeNativeTerminalTask[]
  problem?: string
}
