import type { ClaudeUiMountState } from '#generated/types.ts'

type ClaudeActionKeys = NonNullable<ClaudeUiMountState['actionKeys']>
type ClaudeActionStroke = ClaudeActionKeys['bindings'][number][number]
export type ClaudeActionKeyResult = { sequence: number; handled: boolean; actionKeys?: ClaudeActionKeys }
export type ClaudeActionKeyRequest = { sequence: number; revision: string; event: { key: string; ctrl: boolean; alt: boolean; shift: boolean; super: boolean; from_composer: boolean } }

// Binding strings, context arbitration and callback selection remain native-owned.
const namedKeys: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end' }
function stroke(event: KeyboardEvent): ClaudeActionStroke | undefined {
  const key = namedKeys[event.key] ?? (event.key.length === 1 ? event.key.toLowerCase() : undefined)
  if (!key) return
  // Shift on a punctuation character is represented by that character in native bindings.
  return { key, ctrl: event.ctrlKey, alt: event.altKey, meta: event.altKey, super: event.metaKey, shift: event.shiftKey && (event.key.length !== 1 || event.key.toLowerCase() !== event.key.toUpperCase()) }
}
function same(a: ClaudeActionStroke, b: ClaudeActionStroke): boolean {
  return a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && (a.alt || a.meta) === (b.alt || b.meta) && a.super === b.super
}
function prefix(path: ClaudeActionStroke[], chord: ClaudeActionStroke[]): boolean {
  return path.length <= chord.length && path.every((key, index) => same(key, chord[index]!))
}
function advance(keys: ClaudeActionKeys, pending: ClaudeActionStroke[] | null, key: ClaudeActionStroke): ClaudeActionStroke[] | null {
  if (pending && key.key === 'escape') return null
  const path = [...(pending ?? []), key]
  // The original resolver checks longer chords before single/full matches.
  return [...keys.bindings, ...keys.continuations].some(chord => chord.length > path.length && prefix(path, chord)) ? path : null
}

/** Predict only browser suppression; original native dispatch decides whether an action runs. */
export function createClaudeActionKeyHandler(
  read: () => { scope?: string; keys?: ClaudeActionKeys; result?: ClaudeActionKeyResult },
  send: (request: ClaudeActionKeyRequest) => void,
) {
  let scope: string | undefined, revision: string | undefined, sent = 0, acknowledged = 0
  let pending: ClaudeActionStroke[] | null = null
  let queued: { sequence: number; key: ClaudeActionStroke }[] = []
  const handle = (event: KeyboardEvent, root: HTMLElement | null): boolean => {
    if (!root || event.defaultPrevented || event.isComposing || event.keyCode === 229 || !(event.target instanceof HTMLElement) || !root.contains(event.target)) return false
    const state = read(), keys = state.keys
    if (scope !== state.scope || revision !== keys?.revision) {
      scope = state.scope; revision = keys?.revision; pending = keys?.pending ?? null
      queued = []; acknowledged = sent
    }
    if (!scope || !keys || !keys.bindings.length) return false
    const receipt = state.result
    if (receipt && receipt.sequence > acknowledged && receipt.sequence <= sent) {
      acknowledged = receipt.sequence; queued = queued.filter(item => item.sequence > acknowledged)
      pending = receipt.actionKeys?.revision === keys.revision ? receipt.actionKeys.pending : null
      for (const item of queued) pending = advance(keys, pending, item.key)
    } else if (!queued.length) pending = keys.pending
    const target = event.target
    // Native Client and form fields own their independent input contracts.
    if (target.closest('[data-native-client]')) return false
    const fromComposer = !!target.closest('.composer-document, .native-agent-editor')
    if (!fromComposer && (!target.closest('[data-native-plugin]') || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return false
    const key = stroke(event)
    if (!key || (!pending && fromComposer && !key.ctrl && !key.alt && !key.super)) return false
    if (!pending && !keys.bindings.some(chord => chord[0] && same(chord[0], key))) return false
    pending = advance(keys, pending, key)
    const sequence = ++sent
    queued.push({ sequence, key })
    event.preventDefault(); event.stopPropagation()
    send({ sequence, revision: keys.revision, event: { key: key.key, ctrl: key.ctrl, alt: key.alt || key.meta, shift: key.shift, super: key.super, from_composer: fromComposer } })
    return true
  }
  const cancel = () => {
    const state = read()
    if (!pending || !state.scope || state.scope !== scope || !state.keys || state.keys.revision !== revision) return
    const sequence = ++sent, key: ClaudeActionStroke = { key: 'escape', ctrl: false, alt: false, meta: false, shift: false, super: false }
    pending = null; queued.push({ sequence, key })
    send({ sequence, revision: state.keys.revision, event: { key: 'escape', ctrl: false, alt: false, shift: false, super: false, from_composer: true } })
  }
  return Object.assign(handle, { cancel, leave: (event: FocusEvent, root: HTMLElement | null) => {
    if (!(event.relatedTarget instanceof Node) || !root?.contains(event.relatedTarget)) cancel()
  } })
}
