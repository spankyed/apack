/** Pinned native yto envelope: interruption rows are not person-authored prompts.
 * Original source: Linux chunk-a7b8k0bt.js yto / chunk-q1hf100k.js XE,Lp,bh;
 * Darwin chunk-hqtnbrjd.js / chunk-ev1xcp32.js. Keep literal human input visible.
 * Persisted explicit human origins and literal string input stay visible. Native prompt receipts
 * use the broader original Sh/bh predicate; session.turns keeps the distinct native her semantics.
 */
export function isClaudeNativeInterruption(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.type !== 'user') return false
  const origin = row.origin
  if (origin && typeof origin === 'object' && !Array.isArray(origin) && (origin as Record<string, unknown>).kind === 'human') return false
  const message = row.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content) || content.length !== 1) return false
  const block = content[0]
  return !!block && typeof block === 'object' && block.type === 'text'
    && (block.text === '[Request interrupted by user]' || block.text === '[Request interrupted by user for tool use]')
}
