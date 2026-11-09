import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'
import type { Editor } from '@tiptap/core'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'

// Pack frontend modules/actors are replaceable. Only document data is retained;
// native authority, callbacks, completion offers and component references never enter this cache.
const key = Symbol.for('apack.default-setup.claude-window-drafts')
type WindowDrafts = { parent: Map<string, ClaudeAgentDraftSnapshot>; agents: Record<string, { text: string; snapshot?: ClaudeAgentDraftSnapshot }> }
const scope = globalThis as unknown as Record<symbol, WindowDrafts | undefined>
const drafts = scope[key] ??= { parent: new Map(), agents: {} }
export const claudeWindowAgentDrafts = drafts.agents

export function bindClaudeWindowDraft(editor: Editor, owner: string): () => void {
  const storageKey = claudeWindowStorageKey('parent-draft', owner)
  let saved = drafts.parent.get(owner)
  if (!saved && storageKey) {
    try { const raw = surfaceStorage(featureRef('threads')).get(storageKey); if (raw) saved = JSON.parse(raw) as ClaudeAgentDraftSnapshot } catch { /* Storage availability never gates editing. */ }
  }
  let ready = false
  const save = () => {
    if (!ready) return
    const snapshot = captureClaudeAgentDraft(editor)
    if (!snapshot) return
    drafts.parent.set(owner, snapshot)
    if (storageKey) try {
      if (editor.isEmpty) surfaceStorage(featureRef('threads')).remove(storageKey)
      else surfaceStorage(featureRef('threads')).set(storageKey, JSON.stringify(snapshot))
    } catch { /* Keep the current window draft when storage is unavailable or full. */ }
  }
  const adopt = () => {
    if (editor.isDestroyed) return
    if (saved && editor.isEmpty) {
      try {
        const doc = editor.schema.nodeFromJSON(saved.doc); doc.check()
        if (typeof saved.text === 'string') {
          editor.chain().setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false).setContent(doc.toJSON()).run()
          restoreClaudeAgentDraft(editor, saved, saved.text)
        }
      } catch { /* Invalid stored data cannot prevent a fresh editor. */ }
    }
    ready = true; save()
  }
  const dom = editor.view.dom
  let pointerFocus = false, active = true
  const pointer = () => { pointerFocus = dom.ownerDocument.activeElement !== dom }
  const blur = () => { pointerFocus = false }
  const focus = () => {
    const fromPointer = pointerFocus; pointerFocus = false
    if (fromPointer || editor.isDestroyed || editor.view.composing) return
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
  editor.on('transaction', save)
  if (editor.isInitialized) adopt()
  else editor.on('create', adopt)
  return () => {
    active = false
    dom.removeEventListener('pointerdown', pointer, true)
    dom.removeEventListener('pointercancel', blur)
    dom.removeEventListener('blur', blur)
    dom.removeEventListener('focus', focus, true)
    save(); editor.off('create', adopt); editor.off('transaction', save)
  }
}
