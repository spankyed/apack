import type { Editor } from '@tiptap/core'
import { captureClaudeAgentDraft, restoreClaudeAgentDraft, type ClaudeAgentDraftSnapshot } from './native-agent-draft.ts'

// Pack frontend modules/actors are replaceable. Only document data survives in this window;
// native authority, callbacks, completion offers and component references never enter this cache.
const key = Symbol.for('apack.default-setup.claude-window-drafts')
type WindowDrafts = { parent: Map<string, ClaudeAgentDraftSnapshot>; agents: Record<string, { text: string; snapshot?: ClaudeAgentDraftSnapshot }> }
const scope = globalThis as unknown as Record<symbol, WindowDrafts | undefined>
const drafts = scope[key] ??= { parent: new Map(), agents: {} }
export const claudeWindowAgentDrafts = drafts.agents

export function bindClaudeWindowDraft(editor: Editor, owner: string): () => void {
  const saved = drafts.parent.get(owner)
  let ready = false
  const save = () => { if (ready) { const snapshot = captureClaudeAgentDraft(editor); if (snapshot) drafts.parent.set(owner, snapshot) } }
  const adopt = () => {
    if (editor.isDestroyed) return
    if (saved && editor.isEmpty) {
      editor.chain().setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false).setContent(saved.doc).run()
      restoreClaudeAgentDraft(editor, saved, saved.text)
    }
    ready = true; save()
  }
  editor.on('transaction', save)
  if (editor.isInitialized) adopt()
  else editor.on('create', adopt)
  return () => { save(); editor.off('create', adopt); editor.off('transaction', save) }
}
