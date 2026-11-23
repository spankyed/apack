import type { ClaudeNativeAgentInputReview } from '#features/code/common/native-terminal.ts'

export type ClaudeComposerSubmitResult = void | { review: { text: string; removed: number } } | { commandPending: true; revision: number } | { queued: boolean }

export type ClaudeAgentComposerSubmitResult = void | ClaudeNativeAgentInputReview | { commandPending: true } | { accepted: true }
