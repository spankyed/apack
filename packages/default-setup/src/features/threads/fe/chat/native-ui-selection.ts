import { inject, onBeforeUnmount, onMounted, provide, type InjectionKey } from 'vue'

type SelectionText = { text: string; instance_id?: string }
interface ClaudeSelectionReader { read(): SelectionText | undefined; clear(): void }
const selectionReader: InjectionKey<ClaudeSelectionReader> = Symbol('claude-ui-selection')
const rows = '[data-native-agent-message],[data-native-selection-row],[data-native-user],[data-native-assistant],[data-native-summary],[data-native-command-output],[data-native-tool-use],[data-native-tool-result],[data-native-tool-group],[data-native-tool-progress]'
const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement
function isSelectable(scope: HTMLElement, node: Node): boolean {
  return scope.contains(node) && !element(node)?.closest('[inert],[hidden],[aria-hidden="true"]')
}
function rowId(start: Node | null, end: Node | null): string | undefined {
  const row = element(start)?.closest(rows)
  if (!row || element(end)?.closest(rows) !== row) return undefined
  return ['nativeAgentMessage', 'nativeSelectionRow', 'nativeUser', 'nativeAssistant', 'nativeSummary', 'nativeCommandOutput', 'nativeToolUse', 'nativeToolResult', 'nativeToolGroup', 'nativeToolProgress'].map(name => (row as HTMLElement).dataset[name]).find(value => !!value)
}

/** Retain the person's selection when the native action that reads it takes browser focus. */
export function provideClaudeUiSelection(root: () => HTMLElement | null): ClaudeSelectionReader {
  let saved: { value: SelectionText; current(scope: HTMLElement): boolean } | undefined
  let alive = true
  const clear = () => { saved = undefined }
  const capture = () => {
    const scope = root()
    if (!alive || !scope?.isConnected || !scope.getClientRects().length || !document.hasFocus()) { clear(); return undefined }
    const field = document.activeElement
    if (field instanceof HTMLInputElement && field.type === 'password') { clear(); return undefined }
    if ((field instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(field.type) || field instanceof HTMLTextAreaElement)) {
      if (!isSelectable(scope, field)) { clear(); return undefined }
      const start = field.selectionStart, end = field.selectionEnd
      if (start === null || end === null || end <= start || end - start > 1_000_000) { clear(); return undefined }
      const text = field.value.slice(start, end), instance_id = rowId(field, field)
      const value = { text, ...(instance_id ? { instance_id } : {}) }
      saved = { value, current: scope => isSelectable(scope, field) && field.type !== 'password'
        && rowId(field, field) === instance_id && field.value.slice(start, end) === text }
      return value
    }
    const selected = document.getSelection()
    if (!selected || selected.isCollapsed || !selected.anchorNode || !selected.focusNode) {
      if (saved?.current(scope)) return saved.value
      clear(); return undefined
    }
    const { anchorNode, focusNode } = selected
    if (!isSelectable(scope, anchorNode) || !isSelectable(scope, focusNode)) { clear(); return undefined }
    const text = selected.toString(), instance_id = rowId(anchorNode, focusNode)
    if (!text || text.length > 1_000_000) { clear(); return undefined }
    const value = { text, ...(instance_id ? { instance_id } : {}) }
    const ranges = Array.from({ length: selected.rangeCount }, (_, index) => selected.getRangeAt(index).cloneRange())
    // Browser focus can collapse the selection while an action reads it. Retain the text
    // only while its original content belongs to this view and still represents that range.
    saved = { value, current: scope => isSelectable(scope, anchorNode) && isSelectable(scope, focusNode)
      && rowId(anchorNode, focusNode) === instance_id && ranges.map(range => range.toString()).join('') === text }
    return value
  }
  const reader: ClaudeSelectionReader = { read: capture, clear }
  provide(selectionReader, reader)
  onMounted(() => { document.addEventListener('selectionchange', capture); document.addEventListener('pointerdown', capture, true); document.addEventListener('keydown', capture, true); window.addEventListener('blur', clear) })
  onBeforeUnmount(() => { alive = false; clear(); document.removeEventListener('selectionchange', capture); document.removeEventListener('pointerdown', capture, true); document.removeEventListener('keydown', capture, true); window.removeEventListener('blur', clear) })
  return reader
}

export function useClaudeUiSelection() { return inject(selectionReader, undefined) }

/** Only text crosses this ephemeral channel; the ordinary event response acknowledges delivery. */
export async function replyClaudeUiSelection(url: string, reader: ClaudeSelectionReader | undefined, expiresAt: number, current: () => boolean): Promise<boolean> {
  if (!current() || Date.now() >= expiresAt || !document.hasFocus()) return false
  let target: URL
  try { target = new URL(url) } catch { return false }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password || target.search || target.hash || !/^\/[a-f0-9]{64}$/.test(target.pathname)) return false
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), Math.max(0, expiresAt - Date.now()))
  try {
    const selection = reader?.read()
    if (!current()) return false
    const response = await fetch(target, { method: 'POST', body: JSON.stringify(selection ?? {}), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: abort.signal })
    return response.status === 204 && Date.now() < expiresAt && current()
  } catch { return false } finally { clearTimeout(timer) }
}
