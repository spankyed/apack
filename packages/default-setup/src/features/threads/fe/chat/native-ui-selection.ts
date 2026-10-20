import { inject, onBeforeUnmount, onMounted, provide, type InjectionKey } from 'vue'

type SelectionText = { text: string; instance_id?: string }
interface ClaudeSelectionReader { read(): SelectionText | undefined; clear(): void }
const selectionReader: InjectionKey<ClaudeSelectionReader> = Symbol('claude-ui-selection')
const rows = '[data-native-selection-row],[data-native-user],[data-native-assistant],[data-native-summary],[data-native-command-output],[data-native-tool-use],[data-native-tool-result],[data-native-tool-group],[data-native-tool-progress]'
const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement
function rowId(start: Node | null, end: Node | null): string | undefined {
  const row = element(start)?.closest(rows)
  if (!row || element(end)?.closest(rows) !== row) return undefined
  return ['nativeSelectionRow', 'nativeUser', 'nativeAssistant', 'nativeSummary', 'nativeCommandOutput', 'nativeToolUse', 'nativeToolResult', 'nativeToolGroup', 'nativeToolProgress'].map(name => (row as HTMLElement).dataset[name]).find(value => !!value)
}

/** Retain the person's selection when the native action that reads it takes browser focus. */
export function provideClaudeUiSelection(root: () => HTMLElement | null): ClaudeSelectionReader {
  let saved: SelectionText | undefined, alive = true
  const clear = () => { saved = undefined }
  const capture = () => {
    const scope = root()
    if (!alive || !scope || !scope.getClientRects().length || !document.hasFocus()) return undefined
    const field = document.activeElement
    if (field instanceof HTMLInputElement && field.type === 'password') { clear(); return undefined }
    if ((field instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(field.type) || field instanceof HTMLTextAreaElement) && scope.contains(field)) {
      const start = field.selectionStart, end = field.selectionEnd
      if (start !== null && end !== null && end > start) {
        const text = field.value.slice(start, end), instance_id = rowId(field, field)
        if (text.length <= 1000000) saved = { text, ...(instance_id ? { instance_id } : {}) }
        return saved
      }
    }
    const selected = document.getSelection()
    if (!selected || selected.isCollapsed || !selected.anchorNode || !selected.focusNode) return saved
    if (!scope.contains(selected.anchorNode) || !scope.contains(selected.focusNode) || element(selected.anchorNode)?.closest('[inert],[aria-hidden="true"]') || element(selected.focusNode)?.closest('[inert],[aria-hidden="true"]')) { clear(); return undefined }
    const text = selected.toString(), instance_id = rowId(selected.anchorNode, selected.focusNode)
    saved = text && text.length <= 1000000 ? { text, ...(instance_id ? { instance_id } : {}) } : undefined
    return saved
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
