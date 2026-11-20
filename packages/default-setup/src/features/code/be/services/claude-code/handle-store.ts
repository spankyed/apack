import type { QueryHandle } from './query.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { registerThreadTeardown } from '#features/threads/be/thread-teardown.ts'

const logger = createLogger('claude-code-handle-store')
const activeHandles = new Map<string, QueryHandle>()

registerThreadTeardown((threadId: string) => {
  const h = activeHandles.get(threadId)
  if (h) {
    try { h.kill() } catch { /* already gone */ }
    activeHandles.delete(threadId)
  }
})

export function storeHandle(key: string, handle: QueryHandle): void {
  const existing = activeHandles.get(key)
  if (existing) {
    try { existing.kill() } catch { /* already gone */ }
    logger.warn('overwriting active handle — killed previous', { key })
  }
  activeHandles.set(key, handle)
}

export function getHandle(key: string): QueryHandle | undefined {
  return activeHandles.get(key)
}

/**
 * Ends every turn under way and holds none of them: for the pack's backend stopping, after which nothing here
 * would end them. Each is a `claude` process of its own, alive until its turn is over.
 *
 * **Let go of as well as ended.** A turn's consumer reads whether it still holds its thread's slot to tell why
 * its stream ended, and one that no longer does winds its message up and touches nothing else. Left holding the
 * slot, it would record a turn the app itself ended as a session that failed. What the thread then shows as
 * running is what a process ending mid-turn leaves, which the next turn on that thread already clears.
 */
export function endAllTurns(): void {
  for (const [key, handle] of activeHandles) {
    activeHandles.delete(key)
    try { handle.kill() } catch { /* already gone */ }
  }
}

export function clearHandle(key: string): void {
  activeHandles.delete(key)
}
