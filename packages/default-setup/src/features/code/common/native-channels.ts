/** Validate the original tagged selector grammar and keep each selector in one argv value. */
export function copyClaudeChannelSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(selector => typeof selector !== 'string' || !selector.length || selector.startsWith('-') || ['\0', '\r', '\n'].some(character => selector.includes(character)))) {
    throw new Error('Claude channels must be nonempty server or plugin selectors, not CLI flags')
  }
  for (const selector of value as string[]) {
    if (selector.startsWith('server:') && selector.length > 7) continue
    if (selector.startsWith('plugin:')) {
      const plugin = selector.slice(7), separator = plugin.indexOf('@')
      if (separator > 0 && separator < plugin.length - 1) continue
    }
    throw new Error('Use server:<name> or plugin:<name>@<marketplace> for each channel')
  }
  return value.slice() as string[]
}
