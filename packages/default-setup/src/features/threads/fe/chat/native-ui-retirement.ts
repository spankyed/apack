/** Cleanup must outlive a replaced pack actor, but never the renderer window. */
export type ClaudeUiRetirement = { threadId: string; mountId: string; resumeKey: string }
const key = Symbol.for('apack.default-setup.claude-ui-retirements')
const windowState = globalThis as unknown as Record<symbol, ClaudeUiRetirement[] | undefined>

export function queueClaudeUiRetirement(release: ClaudeUiRetirement): void {
  forgetClaudeUiLease(release)
  const pending = windowState[key] ??= []
  if (!pending.some(item => item.resumeKey === release.resumeKey)) pending.push({ ...release })
}

/** Called only once the new frontend's accepted startup data arrives. */
export function takeClaudeUiRetirements(): ClaudeUiRetirement[] {
  const pending = [...reloadLeases.previous, ...(windowState[key] ?? [])]
  reloadLeases.previous = []
  saveLeases()
  delete windowState[key]
  return pending
}

// sessionStorage belongs to this renderer window. On reload, retire its old server-issued
// credentials before mounting fresh views; never restore drawings or callback authority.
const storageKey = 'apack.claude-ui-leases'
const leaseKey = Symbol.for('apack.default-setup.claude-ui-reload-leases')
type ReloadLeases = { previous: ClaudeUiRetirement[]; active: Map<string, ClaudeUiRetirement> }
const leaseScope = globalThis as unknown as Record<symbol, ReloadLeases | undefined>
function previousLeases(): ClaudeUiRetirement[] {
  try {
    const value: unknown = JSON.parse(globalThis.sessionStorage?.getItem(storageKey) ?? '[]')
    return Array.isArray(value) ? value.slice(0, 128).filter((item): item is ClaudeUiRetirement =>
      !!item && typeof item === 'object' && typeof item.threadId === 'string' && item.threadId.length <= 256 &&
      typeof item.mountId === 'string' && /^[0-9a-f-]{36}$/i.test(item.mountId) &&
      typeof item.resumeKey === 'string' && /^[0-9a-f-]{36}$/i.test(item.resumeKey)) : []
  } catch { return [] }
}
const reloadLeases = leaseScope[leaseKey] ??= { previous: previousLeases(), active: new Map() }
function saveLeases(): void {
  try {
    const leases = [...reloadLeases.active.values()]
    if (leases.length) globalThis.sessionStorage?.setItem(storageKey, JSON.stringify(leases))
    else globalThis.sessionStorage?.removeItem(storageKey)
  } catch { /* Storage refusal must not prevent current-window cleanup. */ }
}
export function rememberClaudeUiLease(lease: ClaudeUiRetirement): void {
  reloadLeases.active.set(lease.mountId, { ...lease }); saveLeases()
}
export function forgetClaudeUiLease(lease: Pick<ClaudeUiRetirement, 'mountId' | 'threadId'>): void {
  if (reloadLeases.active.get(lease.mountId)?.threadId !== lease.threadId) return
  reloadLeases.active.delete(lease.mountId); saveLeases()
}
