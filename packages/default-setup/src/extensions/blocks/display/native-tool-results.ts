import type { ComputedRef, InjectionKey, VNodeChild } from 'vue'
import type { ClaudeUiTranscriptFrame, ClaudeUiFieldEvent } from '#features/code/be/services/claude-code/ui-presentation.ts'
export const claudeToolResults: InjectionKey<{
  render(toolUseId: string, fallback: () => VNodeChild): VNodeChild
  frames: ComputedRef<ClaudeUiTranscriptFrame[]>
  press(id: string, href?: string): void
  field(event: ClaudeUiFieldEvent): void
  view(toolUseId: string, open: boolean): void
}> = Symbol('claude-tool-results')
