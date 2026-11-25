import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { readDurableClaudeWindowDraft, saveDurableClaudeWindowDraft } from './native-window-draft-storage.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'
import type { Editor, EditorEvents } from '@tiptap/core'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'

// Pack frontend modules/actors are replaceable. Only document data is retained;
// native authority, callbacks, completion offers and component references never enter this cache.
const key = Symbol.for('apack.default-setup.claude-window-drafts')
type WindowDrafts = { parent: Map<string, ClaudeAgentDraftSnapshot>; agents: Record<string, { text: string; snapshot?: ClaudeAgentDraftSnapshot }> }
const scope = globalThis as unknown as Record<symbol, WindowDrafts | undefined>
const drafts = scope[key] ??= { parent: new Map(), agents: {} }
export const claudeWindowAgentDrafts = drafts.agents

export function bindClaudeWindowDraft(editor: Editor, owner: string, { persistent = true } = {}): () => void {
  const storageKey = persistent ? claudeWindowStorageKey('parent-draft', owner) : undefined
  const cached = drafts.parent.get(owner)
  const storage = () => surfaceStorage(featureRef('threads'))
  const durable = !!storageKey && typeof indexedDB !== 'undefined'
  let legacy: ClaudeAgentDraftSnapshot | undefined
  try { const raw = storageKey && storage().get(storageKey); if (raw) legacy = JSON.parse(raw) as ClaudeAgentDraftSnapshot } catch { /* Storage availability never gates editing. */ }
  let ready = false, active = true, lastStored: string | undefined
  const save = () => {
    if (!ready) return
    const snapshot = captureClaudeAgentDraft(editor)
    if (!snapshot) return
    drafts.parent.set(owner, snapshot)
    if (!storageKey) return
    const empty = editor.isEmpty
    const serialized = empty ? '' : JSON.stringify(snapshot)
    if (serialized === lastStored) return
    lastStored = serialized
    try {
      if (empty) storage().remove(storageKey)
      else storage().set(storageKey, serialized)
    } catch { /* Keep the current window draft when storage is unavailable or full. */ }
    if (durable) saveDurableClaudeWindowDraft(storageKey, empty ? null : snapshot)
  }
  const adopt = (saved: ClaudeAgentDraftSnapshot | null | undefined) => {
    if (!active || ready || editor.isDestroyed) return
    if (saved && editor.isEmpty && !editor.view.composing) {
      restoreClaudeAgentDraft(editor, saved, saved.text, editor.state.doc)
    }
    ready = true
    // A cold empty editor needs no disk record until it is edited. A durable empty record
    // still removes stale input from the legacy cache.
    if (editor.isEmpty && !saved && !editor.view.composing) {
      lastStored = ''
      if (saved === null && storageKey) try { storage().remove(storageKey) } catch { /* Best effort. */ }
    }
    save()
  }
  const initialize = () => {
    if (cached || !storageKey || !durable) adopt(cached ?? legacy)
    else void readDurableClaudeWindowDraft(storageKey)
      .then(saved => adopt(saved === undefined ? legacy : saved), () => adopt(legacy))
  }
  const remember = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
    // A user edit before the durable read completes owns the editor immediately.
    if (!ready && !editor.view.composing && (transaction.docChanged || appendedTransactions.some(change => change.docChanged))) ready = true
    save()
  }
  const dom = editor.view.dom
  const compositionEnded = () => queueMicrotask(() => {
    if (!active || editor.isDestroyed || editor.view.composing) return
    ready = true
    save()
  })
  let pointerFocus = false
  const pointer = () => { pointerFocus = dom.ownerDocument.activeElement !== dom }
  const blur = () => { pointerFocus = false }
  const focus = () => {
    const fromPointer = pointerFocus; pointerFocus = false
    if (fromPointer || editor.isDestroyed || editor.view.composing) return
    const selection = dom.ownerDocument.getSelection()
    // A caller can select text before focusing, for example when replacing the draft.
    if (selection && !selection.isCollapsed && dom.contains(selection.anchorNode) && dom.contains(selection.focusNode)) return
    const retained = editor.state
    // Chromium may install a default DOM caret after programmatic focus on a previously hidden input.
    queueMicrotask(() => {
      if (!active || editor.isDestroyed || editor.view.composing || dom.ownerDocument.activeElement !== dom || editor.state.doc !== retained.doc) return
      if (!editor.state.selection.eq(retained.selection) || editor.state.storedMarks !== retained.storedMarks) {
        editor.view.dispatch(editor.state.tr.setSelection(retained.selection).setStoredMarks(retained.storedMarks)
          .setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false))
      }
      editor.view.focus()
    })
  }
  dom.addEventListener('pointerdown', pointer, true)
  dom.addEventListener('pointercancel', blur)
  dom.addEventListener('blur', blur)
  dom.addEventListener('focus', focus, true)
  dom.addEventListener('compositionend', compositionEnded)
  editor.on('transaction', remember)
  if (editor.isInitialized) initialize()
  else editor.on('create', initialize)
  return () => {
    active = false
    dom.removeEventListener('pointerdown', pointer, true)
    dom.removeEventListener('pointercancel', blur)
    dom.removeEventListener('blur', blur)
    dom.removeEventListener('focus', focus, true)
    dom.removeEventListener('compositionend', compositionEnded)
    save(); editor.off('create', initialize); editor.off('transaction', remember)
  }
}
