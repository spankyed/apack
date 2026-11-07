export type ClaudeComposerSubmitResult = void | { review: { text: string; removed: number } } | { commandPending: true; revision: number }
