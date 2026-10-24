/** Preserve explicit native selectors without allowing a selector to become another CLI flag. */
export function copyClaudeChannelSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(selector => typeof selector !== 'string' || !selector.length || selector.startsWith('-') || ['\0', '\r', '\n'].some(character => selector.includes(character)))) {
    throw new Error('Claude channels must be nonempty server or plugin selectors, not CLI flags')
  }
  return value.slice() as string[]
}
