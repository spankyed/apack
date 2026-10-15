export interface ThreadHistoryRequest {
  kind: 'fork' | 'revert' | 'summarize'
  threadId: string
  messageId: string
}
export interface ThreadHistoryOperationInput {
  request: ThreadHistoryRequest
  snapshot: string
  readSnapshot(): string
  commit(): void
  rejected(error: unknown): void
}
const validators = new Set<(request: ThreadHistoryRequest, signal: AbortSignal) => Promise<void>>();

/** Provider integrations validate their own native history before the thread owner mutates app rows. */
export function registerThreadHistoryValidator(validate: (request: ThreadHistoryRequest, signal: AbortSignal) => Promise<void>): () => void {
  validators.add(validate)
  return () => validators.delete(validate)
}

export async function runThreadHistoryOperation(input: ThreadHistoryOperationInput, signal: AbortSignal): Promise<void> {
  try {
    for (const validate of validators) {
      signal.throwIfAborted()
      await validate(input.request, signal)
    }
    signal.throwIfAborted()
    if (input.snapshot !== input.readSnapshot()) throw new Error('The conversation changed while validating history. Try again.')
    input.commit()
  } catch (error) {
    if (!signal.aborted) input.rejected(error)
  }
}
