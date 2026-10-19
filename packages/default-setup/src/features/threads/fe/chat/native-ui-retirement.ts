/** Cleanup must outlive a replaced pack actor, but never the renderer window. */
export type ClaudeUiRetirement = { threadId: string; mountId: string; resumeKey: string }
const key = Symbol.for('apack.default-setup.claude-ui-retirements')
const windowState = globalThis as unknown as Record<symbol, ClaudeUiRetirement[] | undefined>

export function queueClaudeUiRetirement(release: ClaudeUiRetirement): void {
  const pending = windowState[key] ??= []
  if (!pending.some(item => item.resumeKey === release.resumeKey)) pending.push({ ...release })
}

/** Called only once the new frontend's accepted startup data arrives. */
export function takeClaudeUiRetirements(): ClaudeUiRetirement[] {
  const pending = windowState[key] ?? []
  delete windowState[key]
  return pending
}
