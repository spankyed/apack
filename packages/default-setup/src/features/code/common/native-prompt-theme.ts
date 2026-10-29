/** Resolved native paint only; the native process owns theme selection and overrides. */
export function readClaudePromptPalette(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const entries = Object.entries(value)
  if (!entries.length || entries.length > 256 || !Object.hasOwn(value, 'text')) return
  // eslint-disable-next-line no-control-regex -- Match or reject native terminal control sequences explicitly.
  if (entries.some(([key, color]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof color !== 'string' || !color || color.length > 256 || /[\u0000-\u001f\u007f]/.test(color))) return
  return Object.fromEntries(entries) as Record<string, string>
}
