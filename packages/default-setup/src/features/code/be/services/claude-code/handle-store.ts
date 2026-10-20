import type { ClaudePreparedNativeTerminal, ClaudeNativeTerminalOwner, ClaudeNativeTerminalOptions } from './terminal-owner.ts'
import type { QueryHandle } from './query.ts'
import { createClaudeConversation, type ClaudeConversation, type ClaudeTurnConsumer } from './conversation.ts'
import { createLogger } from '@apackdev/sdk/logger'
import { registerThreadTeardown } from '#features/threads/be/thread-teardown.ts'

const logger = createLogger('claude-code-handle-store')
const activeHandles = new Map<string, QueryHandle>()
const conversations = new Map<string, { owner: ClaudeConversation; launchKey: string }>()
const starting = new Map<string, object>()
const terminals = new Map<string, ClaudeNativeTerminalOwner>()
const draining = new Map<string, Promise<void>>()
const terminalTransitions = new Map<string, AbortController>()
const terminalResumes = new Map<string, Omit<ClaudeNativeTerminalOptions, 'settings' | 'signal'>>()

function stop(key: string): void {
  terminalResumes.delete(key)
  starting.delete(key)
  terminalTransitions.get(key)?.abort(); terminalTransitions.delete(key)
  const terminal = terminals.get(key); terminals.delete(key); terminal?.kill()
  const owner = conversations.get(key)?.owner
  conversations.delete(key)
  const done = terminal?.done ?? owner?.done
  if (done) {
    const pending = Promise.all([draining.get(key), done]).then(() => {}, () => {})
    draining.set(key, pending)
    void pending.finally(() => { if (draining.get(key) === pending) draining.delete(key) })
  }
  const handle = activeHandles.get(key)
  activeHandles.delete(key)
  try { if (owner) owner.kill(); else handle?.kill() } catch { /* already gone */ }
}
registerThreadTeardown(stop)

export async function openConversation(key: string, launchKey: string, spawn: () => Promise<QueryHandle>, consumeAutonomous: ClaudeTurnConsumer, accountedCostUsd = 0): Promise<ClaudeConversation> {
  if (!Number.isFinite(accountedCostUsd) || accountedCostUsd < 0) throw new Error('Invalid accounted native cost baseline')
  if (starting.has(key) || conversations.has(key) || terminals.has(key) || activeHandles.has(key)) throw new Error('Claude conversation already exists')
  const ticket = {}
  starting.set(key, ticket)
  try {
    await draining.get(key)
    if (starting.get(key) !== ticket) throw new Error('Claude conversation startup was cancelled')
    const handle = await spawn()
    if (starting.get(key) !== ticket) { handle.kill(); throw new Error('Claude conversation startup was cancelled') }
    const owner = createClaudeConversation(handle, consumeAutonomous, accountedCostUsd)
    terminalResumes.delete(key)
    conversations.set(key, { owner, launchKey })
    const cleanup = () => {
      if (conversations.get(key)?.owner === owner) conversations.delete(key)
    }
    owner.done.then(cleanup, cleanup)
    return owner
  } finally { if (starting.get(key) === ticket) starting.delete(key) }
}

export function getConversation(key: string): { owner: ClaudeConversation; launchKey: string } | undefined {
  if (terminalTransitions.has(key)) return undefined
  const conversation = conversations.get(key)
  return conversation?.owner.closing ? undefined : conversation
}
export function isConversationBusy(key: string): boolean {
  return starting.has(key) || !!conversations.get(key)?.owner.busy || !!terminals.get(key)?.busy || activeHandles.has(key)
}
export async function closeIdleConversation(key: string): Promise<boolean> {
  await draining.get(key)
  if (isConversationBusy(key)) return false
  const conversation = conversations.get(key)
  if (conversation) await conversation.owner.close()
  await terminals.get(key)?.close()
  return true
}
export function killAllHandles(): void {
  for (const key of new Set([...activeHandles.keys(), ...conversations.keys(), ...terminals.keys(), ...terminalResumes.keys(), ...starting.keys()])) stop(key)
}

export function storeHandle(key: string, handle: QueryHandle): void {
  if (terminals.has(key) || terminalTransitions.has(key)) { handle.kill(); throw new Error('Native terminal owns this Claude conversation') }
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
  if (terminals.has(key) || terminalTransitions.has(key)) return
  starting.delete(key)
  const handle = activeHandles.get(key)
  activeHandles.delete(key)
  const conversation = conversations.get(key)
  if (!conversation) return
  if (handle && conversation.owner.release(handle)) {
    if (conversation.owner.closing) conversations.delete(key)
  } else stop(key)
}

export type ClaudeNativeTerminalHandoffOptions = Pick<ClaudeNativeTerminalOptions, 'cliPath' | 'env' | 'columns' | 'rows'>
export function getNativeTerminal(key: string): ClaudeNativeTerminalOwner | undefined { return terminals.get(key) }

/** Explicit handoff/reopen; reservation and read-only preflight keep one session writer. */
export async function openNativeTerminal(key: string, options: ClaudeNativeTerminalHandoffOptions, prepare: (options: ClaudeNativeTerminalOptions) => Promise<ClaudePreparedNativeTerminal>, readResume?: (options: Omit<ClaudeNativeTerminalOptions, 'settings'>) => Promise<Pick<ClaudeNativeTerminalOptions, 'settings' | 'permissionMode'>>): Promise<ClaudeNativeTerminalOwner> {
  const previous = conversations.get(key), resume = terminalResumes.get(key)
  if ((!previous && (!resume || !readResume)) || previous?.owner.closing || previous && !previous.owner.sessionId || isConversationBusy(key) || terminals.has(key) || terminalTransitions.has(key)) throw new Error('Native terminal handoff needs an idle live Claude conversation or a stopped native session')
  const ticket = {}, abort = new AbortController()
  starting.set(key, ticket); terminalTransitions.set(key, abort)
  let prepared: ClaudePreparedNativeTerminal | undefined
  let published = false
  const current = () => !abort.signal.aborted && starting.get(key) === ticket && (previous ? conversations.get(key) === previous && !previous.owner.busy : terminalResumes.get(key) === resume)
  try {
    await draining.get(key)
    if (!current()) throw new Error('Claude conversation changed during native terminal handoff')
    let launch: Omit<ClaudeNativeTerminalOptions, 'settings' | 'signal'>, settings: ClaudeNativeTerminalOptions['settings']
    if (previous) {
      settings = await previous.owner.handle.getSettings()
      const permissionMode = await previous.owner.handle.getPermissionMode()
      if (!permissionMode) throw new Error('Native permission mode has not been acknowledged')
      const prior = JSON.parse(previous.launchKey) as Omit<ClaudeNativeTerminalOptions, 'settings' | 'sessionId'>
      // Print-only flags (notably worktree) do not belong to a resumed native launch.
      launch = { ...options, cwd: previous.owner.sessionCwd ?? prior.cwd, sessionId: previous.owner.sessionId!, model: typeof settings.applied?.model === 'string' ? settings.applied.model : previous.owner.modelSelection ?? prior.model, permissionMode,
        allowedTools: prior.allowedTools, disallowedTools: prior.disallowedTools, appendSystemPrompt: prior.appendSystemPrompt, addDir: prior.addDir, pluginDir: prior.pluginDir }
    } else {
      launch = { ...resume!, ...options }
      // Original native settings/policy are read again; no cached helpers run after Stop.
      const fresh = await readResume!({ ...launch, signal: abort.signal })
      settings = fresh.settings; launch.permissionMode = fresh.permissionMode
    }
    if (!current()) throw new Error('Claude conversation changed during native terminal handoff')
    if (typeof launch.cwd !== 'string' || !launch.cwd) throw new Error('Native terminal handoff has no current working directory')
    prepared = await prepare({ ...launch, settings, signal: abort.signal })
    if (!current()) throw new Error('Claude conversation changed before terminal startup')
    await previous?.owner.close()
    if (abort.signal.aborted || starting.get(key) !== ticket) throw new Error('Native terminal handoff was cancelled')
    const owner = await prepared.start()
    if (abort.signal.aborted || starting.get(key) !== ticket) { owner.kill(); await owner.done; throw new Error('Native terminal startup was cancelled') }
    terminals.set(key, owner); terminalResumes.set(key, launch); published = true
    owner.beforeRelease(async () => {
      if (terminalResumes.get(key) !== launch) return
      const state = owner.state
      launch.sessionId = state.sessionId; launch.cwd = state.session?.cwd ?? state.cwd
      launch.model = owner.modelSelection ?? state.session?.model ?? launch.model
      launch.permissionMode = state.session?.permissionMode ?? launch.permissionMode
    })
    void owner.done.finally(() => { if (terminals.get(key) === owner) terminals.delete(key) })
    return owner
  } finally {
    try { if (!published) await prepared?.dispose() } finally {
      if (starting.get(key) === ticket) starting.delete(key)
      if (terminalTransitions.get(key) === abort) terminalTransitions.delete(key)
    }
  }
}
