/** Select the last drawn visible Button, matching the native site's collision rule. */
export function pressClaudeUiHotkey(event: KeyboardEvent, site: HTMLElement | null, fromComposer = false): boolean {
  if (!site || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  const key = event.key.toLowerCase()
  if (key.length !== 1 || !/^[0-9a-z]$/.test(key) || (fromComposer && (!/^[0-9]$/.test(key) || event.shiftKey))) return false
  if (!fromComposer) {
    if (!(event.target instanceof HTMLElement) || !site.contains(event.target)) return false
    if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false
  }
  const buttons = [...site.querySelectorAll<HTMLButtonElement>('button[data-native-hotkey]')]
  const button = buttons.reverse().find(candidate => {
    if (candidate.disabled || candidate.dataset.nativeHotkey !== key) return false
    for (let element: HTMLElement | null = candidate; element; element = element.parentElement) {
      if (element.hidden || element.hasAttribute('inert')) return false
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
      if (element === site) break
    }
    return true
  })
  if (!button) return false
  event.preventDefault(); event.stopPropagation()
  button.click()
  return true
}
