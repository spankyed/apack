import type { InjectionKey } from 'vue'
import type { ClaudeUiTranscriptLayout } from '#features/code/be/services/claude-code/ui-presentation.ts'
export const claudeTranscriptLayout: InjectionKey<(layout: ClaudeUiTranscriptLayout) => void> = Symbol('claude-transcript-layout')
