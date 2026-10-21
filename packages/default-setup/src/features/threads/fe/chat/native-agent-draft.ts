import type { Editor, JSONContent } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'

/** In-memory app input state; native callbacks and presentation decorations are not saved. */
export interface ClaudeAgentDraftSnapshot {
  text: string
  doc: JSONContent
  selection: Record<string, unknown>
  storedMarks?: readonly Record<string, unknown>[]
}
/** The app serializes a structurally empty paragraph as a round-trip marker. */
export function normalizeClaudeAgentDraftText(doc: Editor['state']['doc'], text: string): string {
  return text === '&nbsp;' && doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && !doc.firstChild.content.size ? '' : text
}
const markdown = (editor: Editor, doc = editor.state.doc): string => normalizeClaudeAgentDraftText(doc,
  (editor.storage as unknown as { markdown: { serializer: { serialize(value: typeof doc): string } } }).markdown.serializer.serialize(doc))

export function captureClaudeAgentDraft(editor: Editor): ClaudeAgentDraftSnapshot | undefined {
  if (editor.isDestroyed || editor.view.composing) return
  return { text: markdown(editor), doc: editor.getJSON(), selection: editor.state.selection.toJSON(),
    ...(editor.state.storedMarks ? { storedMarks: editor.state.storedMarks.map(mark => mark.toJSON()) } : {}) }
}

/** Restore the same draft. A fresh editor may supply its untouched initial document before Markdown normalization. */
export function restoreClaudeAgentDraft(editor: Editor, snapshot: ClaudeAgentDraftSnapshot, expectedText: string, initialDocument?: Editor['state']['doc']): boolean {
  if (editor.isDestroyed || editor.view.composing || snapshot.text !== expectedText || (markdown(editor) !== expectedText && editor.state.doc !== initialDocument)) return false
  try {
    const doc = editor.schema.nodeFromJSON(snapshot.doc)
    doc.check()
    if (markdown(editor, doc) !== expectedText) return false
    const marks = snapshot.storedMarks?.map(mark => editor.schema.markFromJSON(mark)) ?? null
    const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content)
    transaction.setSelection(Selection.fromJSON(transaction.doc, snapshot.selection)).setStoredMarks(marks)
      .setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
    return true
  } catch { return false }
}
