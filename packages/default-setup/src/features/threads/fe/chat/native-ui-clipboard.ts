/** Copy only while this native view is mounted and its original request is live. */
export async function copyClaudeUiText(text: string, expiresAt: number, current: () => boolean): Promise<boolean> {
  if (text.length > 1000000 || Date.now() >= expiresAt || !document.hasFocus() || !current()) return false
  try {
    await navigator.clipboard.writeText(text)
    return Date.now() < expiresAt && current()
  } catch { return false }
}
