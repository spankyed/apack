import type { ClaudeNativeAgentInputReview } from '#features/code/common/native-terminal.ts'

export class ClaudeSendUnconfirmedError extends Error {
  constructor() {
    super('Send unconfirmed. Check the conversation before trying again.')
  }
}

export type ClaudeComposerSubmitResult = void | { review: { text: string; removed: number } } | { commandPending: true; revision: number } | { queued: boolean } | { returnedDraft: string }

export type ClaudeAgentComposerSubmitResult = void | ClaudeNativeAgentInputReview | { commandPending: true } | { accepted: true }
