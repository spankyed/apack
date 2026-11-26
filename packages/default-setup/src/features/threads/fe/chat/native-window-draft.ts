import { surfaceStorage } from '@apackdev/sdk/fe'
import { ref as featureRef } from '#generated/ref.ts'
import { readDurableClaudeWindowDraft, saveDurableClaudeWindowDraft } from './native-window-draft-storage.ts'
import { claudeWindowStorageKey } from './native-window-storage.ts'
import { isNodeEmpty, type Editor, type EditorEvents } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { createNativeSubmittedDraft, waitForSubmittedDraftComposition } from './native-submitted-draft.ts'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'

// Pack frontend modules/actors are replaceable. Only document data is retained;
// native authority, callbacks, completion offers and component references never enter this cache.
const key = Symbol.for('apack.default-setup.claude-window-drafts')
type WindowDrafts = { parent: Map<string, ClaudeAgentDraftSnapshot>; agents: Record<string, { text: string; snapshot?: ClaudeAgentDraftSnapshot }> }
const scope = globalThis as unknown as Record<symbol, WindowDrafts | undefined>
const drafts = scope[key] ??= { parent: new Map(), agents: {} }
export const claudeWindowAgentDrafts = drafts.agents

interface BoundDraft {
  editor: Editor
  committed?: EditorState
  claim(): void
  persist(snapshot: ClaudeAgentDraftSnapshot, empty: boolean): void
}
const boundDrafts = new Map<string, BoundDraft>()
const submissionListeners = new Map<string, (binding?: BoundDraft) => void>()

export function trackClaudeWindowSubmittedDraft(owner: string, editor: Editor) {
  let binding = boundDrafts.get(owner)
  if (binding?.editor === editor) binding.claim()
  const draft = createNativeSubmittedDraft(editor.state.doc)
  let retained: BoundDraft | undefined
  let accepted: { binding: BoundDraft; snapshot: ClaudeAgentDraftSnapshot; empty: boolean } | undefined
  let owned = binding?.editor === editor
  const seal = () => {
    if (!binding?.committed || binding.editor.isDestroyed) return
    const transaction = draft.transaction(binding.committed)
    const snapshot = transaction && captureClaudeAgentDraft(binding.editor, binding.committed.apply(transaction))
    accepted = transaction && snapshot ? { binding, snapshot, empty: isNodeEmpty(transaction.doc) } : undefined
  }
  const observe = (current: BoundDraft) => {
    current.editor.on('transaction', draft.observe)
    current.editor.on('destroy', seal)
  }
  const unobserve = () => {
    binding?.editor.off('transaction', draft.observe)
    binding?.editor.off('destroy', seal)
  }
  const bind = (next?: BoundDraft) => {
    if (!next) {
      seal()
      retained = binding
    } else {
      // A fresh schema may have adopted the retained document. Preserve the
      // tracker only when the binding restored that entire document.
      if (binding || !retained?.committed
        || JSON.stringify(retained.committed.doc.toJSON()) !== JSON.stringify(next.editor.state.doc.toJSON())) owned = false
      accepted = undefined
    }
    unobserve()
    binding = next
    if (next && owned) observe(next)
  }
  if (binding && owned) {
    observe(binding)
    submissionListeners.set(owner, bind)
  }
  return {
    dispose() {
      if (submissionListeners.get(owner) === bind) submissionListeners.delete(owner)
      unobserve()
    },
    async accept() {
      while (owned) {
        const current = binding
        if (current && !current.editor.isDestroyed) {
          const active = current.editor
          if (active.view.composing) {
            await waitForSubmittedDraftComposition(active, () => boundDrafts.get(owner) === current && !active.isDestroyed)
            continue
          }
          const transaction = draft.transaction(active.state)
          if (transaction) active.view.dispatch(transaction)
        } else if (accepted) {
          accepted.binding.persist(accepted.snapshot, accepted.empty)
        }
        return
      }
    },
  }
}

export function bindClaudeWindowDraft(editor: Editor, owner: string, { persistent = true } = {}): () => void {
  const storageKey = persistent ? claudeWindowStorageKey('parent-draft', owner) : undefined
  const storage = () => surfaceStorage(featureRef('threads'))
  const durable = !!storageKey && typeof indexedDB !== 'undefined'
  let legacy: ClaudeAgentDraftSnapshot | undefined
  try { const raw = storageKey && storage().get(storageKey); if (raw) legacy = JSON.parse(raw) as ClaudeAgentDraftSnapshot } catch { /* Storage availability never gates editing. */ }
  let ready = false, adopting = false, active = true, lastStored: string | undefined
  const binding: BoundDraft = { editor, persist, claim: () => adopt(undefined) }
  function persist(snapshot: ClaudeAgentDraftSnapshot, empty: boolean) {
    drafts.parent.set(owner, snapshot)
    if (!storageKey) return
    const serialized = empty ? '' : JSON.stringify(snapshot)
    if (serialized === lastStored) return
    lastStored = serialized
    try {
      if (empty) storage().remove(storageKey)
      else storage().set(storageKey, serialized)
    } catch { /* Keep the current window draft when storage is unavailable or full. */ }
    if (durable) saveDurableClaudeWindowDraft(storageKey, empty ? null : snapshot)
  }
  const save = () => {
    if (!ready) return
    const snapshot = captureClaudeAgentDraft(editor)
    if (!snapshot) return
    binding.committed = editor.state
    persist(snapshot, editor.isEmpty)
  }
  const adopt = (saved: ClaudeAgentDraftSnapshot | null | undefined) => {
    if (!active || ready || editor.isDestroyed) return
    if (saved && editor.isEmpty && !editor.view.composing) {
      adopting = true
      restoreClaudeAgentDraft(editor, saved, saved.text, editor.state.doc)
      adopting = false
    }
    ready = true
    // A cold empty editor needs no disk record until it is edited. A durable empty record
    // still removes stale input from the legacy cache.
    if (editor.isEmpty && !saved && !editor.view.composing) {
      lastStored = ''
      if (saved === null && storageKey) try { storage().remove(storageKey) } catch { /* Best effort. */ }
    }
    save()
    submissionListeners.get(owner)?.(binding)
  }
  const initialize = () => {
    const cached = drafts.parent.get(owner)
    if (cached || !storageKey || !durable) adopt(cached ?? legacy)
    else void readDurableClaudeWindowDraft(storageKey)
      .then(saved => adopt(saved === undefined ? legacy : saved), () => adopt(legacy))
  }
  const remember = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
    // A user edit before the durable read completes owns the editor immediately.
    if (!ready && !adopting && !editor.view.composing && (transaction.docChanged || appendedTransactions.some(change => change.docChanged))) adopt(undefined)
    else save()
  }
  const dom = editor.view.dom
  const compositionEnded = () => queueMicrotask(() => {
    if (!active || editor.isDestroyed || editor.view.composing) return
    if (!ready) adopt(undefined)
    else save()
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
  boundDrafts.set(owner, binding)
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
    save()
    if (boundDrafts.get(owner) === binding) {
      boundDrafts.delete(owner)
      submissionListeners.get(owner)?.()
    }
    editor.off('create', initialize)
    editor.off('transaction', remember)
  }
}
