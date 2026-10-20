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
    try { const raw = globalThis.localStorage?.getItem(storageKey); if (raw) saved = JSON.parse(raw) as ClaudeAgentDraftSnapshot } catch { /* Storage availability never gates editing. */ }
  }
  let ready = false
  const save = () => {
    if (!ready) return
    const snapshot = captureClaudeAgentDraft(editor)
    if (!snapshot) return
    drafts.parent.set(owner, snapshot)
    if (storageKey) try {
      if (editor.isEmpty) globalThis.localStorage?.removeItem(storageKey)
      else globalThis.localStorage?.setItem(storageKey, JSON.stringify(snapshot))
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
  editor.on('transaction', save)
  if (editor.isInitialized) adopt()
  else editor.on('create', adopt)
  return () => { save(); editor.off('create', adopt); editor.off('transaction', save) }
}
