const COPY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

/** Both viewers own the same code-copy behavior and release its timer on destruction. */
export function createCodeCopyButton(code: HTMLElement) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'code-block-copy-btn'
  button.setAttribute('aria-label', 'Copy code')
  button.contentEditable = 'false'
  button.innerHTML = COPY_SVG
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const press = (event: MouseEvent) => event.preventDefault()
  const copy = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(code.textContent ?? '')
      if (disposed) return
      button.innerHTML = CHECK_SVG
      button.classList.add('is-copied')
      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        button.innerHTML = COPY_SVG
        button.classList.remove('is-copied')
      }, 1500)
    } catch { /* Clipboard may be unavailable. */ }
  }
  button.addEventListener('mousedown', press)
  button.addEventListener('click', copy)
  return { button, dispose() {
    disposed = true
    if (resetTimer) clearTimeout(resetTimer)
    button.removeEventListener('mousedown', press)
    button.removeEventListener('click', copy)
  } }
}
