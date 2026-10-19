import type { ComputedRef, InjectionKey, VNodeChild } from 'vue'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
export const claudeToolDrawings: InjectionKey<{
  render(component: 'ToolUse' | 'ToolResult' | 'ToolProgress', toolUseId: string, fallback: () => VNodeChild): VNodeChild
  groups(toolUseIds: readonly string[], fallback: (ids: readonly string[]) => VNodeChild): VNodeChild
  frames: ComputedRef<ClaudeUiTranscriptFrame[]>
  press(id: string, href?: string): void
  field(event: ClaudeUiFieldEvent): void
  view(toolUseId: string, open: boolean): void
}> = Symbol('claude-tool-drawings')
