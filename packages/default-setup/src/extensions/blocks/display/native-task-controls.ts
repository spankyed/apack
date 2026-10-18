import type { ComputedRef, InjectionKey } from 'vue'
import type { ClaudeTerminalTaskState } from '#features/threads/be/claude-terminal-views.ts'
export interface ClaudeTaskIdentity { id: string; ownerId: string; sessionId: string }
export const claudeTaskControls: InjectionKey<{
  ownerId: ComputedRef<string | undefined>
  state: ComputedRef<ClaudeTerminalTaskState | undefined>
  operate(task: ClaudeTaskIdentity, operation: 'inspect' | 'stop' | 'send' | 'input' | 'foreground' | 'background', text?: string): number | undefined
}> = Symbol('Claude native task controls')
