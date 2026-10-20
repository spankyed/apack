/** Native task ids and terminal owners are independent of apack thread ids. */
export interface ClaudeNativeTerminalTask {
  kind?: 'workflow'
  settled?: boolean
  canPause?: boolean
  canResume?: boolean
  canStop?: boolean
  id: string
  name: string
  status: string
  statusText?: string
}
export type ClaudeNativeTerminalView = { kind: 'main'; revision: number } | { kind: 'agent'; revision: number; registryId: string; taskId?: string }

/** One observed Agent selection in one native process. A mount cannot change targets. */
export interface ClaudeNativeAgentUiTarget {
  ownerId: string
  sessionId: string
  revision: number
  taskId: string
}

export interface ClaudeNativeFocusProjection {
  sessionId: string
  viewRevision: number
  producerId: string
  active: boolean
  hidden: string[]
}

export interface ClaudeNativeTerminalState {
  /** Original native selected view, independent of the app thread. Undefined until observed. */
  view?: ClaudeNativeTerminalView
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
  /** Native pending-work counts, independent of prompt submission readiness. */
  activity?: { pendingAgents: number; pendingWorkflows: number }
  focus?: ClaudeNativeFocusProjection
  lastTurn?: { id: string; reason: 'answer' | 'aborted' | 'refusal' | 'error' }
  session?: import('../be/services/claude-code/terminal-session.ts').ClaudeNativeSessionMetadata
  mainStatus?: string
  tasks: ClaudeNativeTerminalTask[]
  problem?: string
}

export interface ClaudeNativeTaskDetails {
  handback?: import('./native-handback.ts').ClaudeAgentHandback
  workflow?: { settled: boolean; canPause: boolean; canResume: boolean; canStop: boolean; name?: string; runId?: string; agentCount: number; phaseCount: number; progress: { type: 'workflow_phase' | 'workflow_agent' | 'workflow_log'; index?: number; phaseIndex?: number; tokens?: number; toolCalls?: number; title?: string; kind?: string; label?: string; state?: string; phaseTitle?: string; agentId?: string; model?: string; error?: string; resultPreview?: string; message?: string; cached?: boolean; skipped?: boolean; controlToken?: string }[]; logs: string[]; output?: string; outputUnavailable: boolean; truncated: boolean }
  taskId: string
  name: string
  status: string
  canInput: boolean
  canMessage: boolean
  metadata?: {
    prompt?: string
    promptTruncated: boolean
    model?: string
    effort?: string
    elapsedMs?: number
    tokenCount?: number
    toolUseCount?: number
    error?: string
    errorTruncated: boolean
  }
  messages: { uuid: string; role: 'user' | 'assistant'; text: string; renderText?: string; apiMessageId?: string; origin?: { kind: string; name?: string; asUser?: boolean; server?: string } }[]
  truncated: boolean
}

export interface ClaudeNativeTaskInputReceipt { messageId: string; mode: 'queued' | 'resumed' }

export interface ClaudeNativeAgentInputReview { text: string; removed: number }

export interface ClaudeNativeAgentCommandConfirmation {
  id: string
  title: string
  confirmLabel: string
  commandName?: string
}

export interface ClaudeNativeWorkflowWorkerTarget { agentId: string; token: string }
export interface ClaudeNativeWorkflowWorkerReceipt { agentId: string; operation: 'skip_worker' | 'retry_worker'; accepted: true }
