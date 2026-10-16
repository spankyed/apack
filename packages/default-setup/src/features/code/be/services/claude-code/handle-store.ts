import type { QueryHandle } from './query.ts'
import { createClaudeConversation, type ClaudeConversation, type ClaudeTurnConsumer } from './conversation.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { registerThreadTeardown } from '#features/threads/be/thread-teardown.ts'

const logger = createLogger('claude-code-handle-store')
const activeHandles = new Map<string, QueryHandle>()
const conversations = new Map<string, { owner: ClaudeConversation; launchKey: string }>()
const starting = new Map<string, object>()

function stop(key: string): void {
  starting.delete(key)
  const owner = conversations.get(key)?.owner
  conversations.delete(key)
  const handle = activeHandles.get(key)
  activeHandles.delete(key)
  try { if (owner) owner.kill(); else handle?.kill() } catch { /* already gone */ }
}
registerThreadTeardown(stop)

export async function openConversation(key: string, launchKey: string, spawn: () => Promise<QueryHandle>, consumeAutonomous: ClaudeTurnConsumer): Promise<ClaudeConversation> {
  if (starting.has(key) || conversations.has(key) || activeHandles.has(key)) throw new Error('Claude conversation already exists')
  const ticket = {}
  starting.set(key, ticket)
  try {
    const handle = await spawn()
    if (starting.get(key) !== ticket) { handle.kill(); throw new Error('Claude conversation startup was cancelled') }
    const owner = createClaudeConversation(handle, consumeAutonomous)
    conversations.set(key, { owner, launchKey })
    const cleanup = () => {
      if (conversations.get(key)?.owner === owner) conversations.delete(key)
    }
    owner.done.then(cleanup, cleanup)
    return owner
  } finally { if (starting.get(key) === ticket) starting.delete(key) }
}

export function getConversation(key: string): { owner: ClaudeConversation; launchKey: string } | undefined {
  const conversation = conversations.get(key)
  return conversation?.owner.closing ? undefined : conversation
}
export function isConversationBusy(key: string): boolean {
  return starting.has(key) || !!conversations.get(key)?.owner.busy || activeHandles.has(key)
}
export async function closeIdleConversation(key: string): Promise<boolean> {
  if (isConversationBusy(key)) return false
  const conversation = conversations.get(key)
  if (conversation) await conversation.owner.close()
  return true
}
export function killAllHandles(): void {
  for (const key of new Set([...activeHandles.keys(), ...conversations.keys(), ...starting.keys()])) stop(key)
}

export function storeHandle(key: string, handle: QueryHandle): void {
  const conversation = conversations.get(key)
  if (conversation && !conversation.owner.ownsTurn(handle)) stop(key)
  const existing = activeHandles.get(key)
  if (existing && existing !== handle) {
    try { existing.kill() } catch { /* already gone */ }
    logger.warn('overwriting active handle — killed previous', { key })
  }
  activeHandles.set(key, handle)
}
export function getHandle(key: string): QueryHandle | undefined {
  return getConversation(key)?.owner.handle ?? activeHandles.get(key)
}
/** Turn writers require exact scope ownership; controls use the stable process handle. */
export function isCurrentTurn(key: string, handle: QueryHandle): boolean {
  return activeHandles.get(key) === handle
}
export function clearHandle(key: string): void {
  starting.delete(key)
  const handle = activeHandles.get(key)
  activeHandles.delete(key)
  const conversation = conversations.get(key)
  if (!conversation) return
  if (handle && conversation.owner.release(handle)) {
    if (conversation.owner.closing) conversations.delete(key)
  } else stop(key)
}
