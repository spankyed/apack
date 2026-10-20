import type { ComputedRef, InjectionKey } from 'vue'
import type { ClaudeTerminalTaskState } from '#features/threads/be/claude-terminal-views.ts'
export interface ClaudeTaskIdentity { kind?: 'workflow'; id: string; ownerId: string; sessionId: string }
export const claudeTaskControls: InjectionKey<{
  foregroundAvailable: ComputedRef<boolean>
  ownerId: ComputedRef<string | undefined>
  state: ComputedRef<ClaudeTerminalTaskState | undefined>
  operate(task: ClaudeTaskIdentity, operation: 'inspect' | 'stop' | 'send' | 'input' | 'foreground' | 'background' | 'skip_worker' | 'retry_worker', text?: string, worker?: import('#features/code/common/native-terminal.ts').ClaudeNativeWorkflowWorkerTarget): number | undefined
}> = Symbol('Claude native task controls')
