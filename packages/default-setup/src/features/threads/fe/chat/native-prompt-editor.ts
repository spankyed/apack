import type { Editor } from '@tiptap/core'
import { createClaudePromptDecorations, drawClaudePromptDecorations } from './native-prompt-decorations.ts'
import { TextSelection } from '@tiptap/pm/state'
import type { ClaudePromptEdit, ClaudePromptReply } from '#generated/types.ts'
import { captureClaudePromptDocument, rewriteClaudePromptDocument, type ClaudePromptDocument } from './native-prompt-document.ts'

/** A mounted view owns its revisions and listeners; it never owns the editor's lifetime. */
export function bindClaudePromptEditor(editor: Editor, send: (edit: ClaudePromptEdit) => void, onProblem: (message: string | undefined) => void, initialRevision = 0) {
  const serialize = (doc: import('@tiptap/pm/model').Node): string =>
    (editor.storage as unknown as { markdown: { serializer: { serialize(doc: import('@tiptap/pm/model').Node): string } } }).markdown.serializer.serialize(doc)
  const decorations = createClaudePromptDecorations()
  editor.registerPlugin(decorations.plugin)
  let revision = initialRevision, applying = false, disposed = false
  let settled = false
  let pending: { revision: number; snapshot: ClaudePromptDocument; selection: import('@tiptap/pm/state').Selection; done: Promise<boolean>; finish: (accepted: boolean) => void } | undefined
  let person = false, clearPerson: ReturnType<typeof setTimeout> | undefined
  let key: ClaudePromptEdit['key']
  const intent = (event?: Event) => {
    person = true
    if (event?.type === 'keydown') {
      const keyboard = event as KeyboardEvent
      key = keyboard.key && keyboard.key.length <= 32 ? { key: keyboard.key, ...(keyboard.ctrlKey ? { ctrl: true as const } : {}), ...(keyboard.shiftKey ? { shift: true as const } : {}), ...(keyboard.metaKey ? { meta: true as const } : {}) } : undefined
    } else if (event?.type !== 'beforeinput') key = undefined
    if (clearPerson) clearTimeout(clearPerson)
    clearPerson = setTimeout(() => { person = false; key = undefined }, 0)
  }
  const dom = editor.view.dom
  const events = ['beforeinput', 'keydown', 'paste', 'drop', 'pointerdown'] as const
  for (const event of events) dom.addEventListener(event, intent, true)
  function finishPending(accepted: boolean) {
    settled = accepted
    pending?.finish(accepted)
    pending = undefined
  }
  function publish(by?: 'app' | 'person') {
    if (disposed || applying || editor.isDestroyed) return
    finishPending(false)
    if (editor.view.composing) return
    const snapshot = captureClaudePromptDocument(editor.state.doc, editor.state.selection.head, serialize)
    revision++
    let finish!: (accepted: boolean) => void
    const done = new Promise<boolean>(resolve => { finish = resolve })
    pending = snapshot ? { revision, snapshot, selection: editor.state.selection, done, finish } : undefined
    if (!snapshot) { onProblem('Claude prompt hooks cannot map this editor selection'); return }
    onProblem(undefined)
    const origin = by ?? (person ? 'person' : 'app')
    try { send({ revision, text: snapshot.text, cursor: snapshot.cursor, by: origin, ...(origin === 'person' && key ? { key } : {}) }) }
    catch (error) { finishPending(false); onProblem(error instanceof Error ? error.message : 'Claude input could not be sent') }
  }
  const transaction = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    if (transaction.docChanged || transaction.selectionSet) publish(transaction.getMeta('claude-prompt-by'))
  }
  const compositionEnd = () => { intent(); publish() }
  const destroyed = () => finishPending(false)
  editor.on('destroy', destroyed)
  editor.on('transaction', transaction)
  dom.addEventListener('compositionend', compositionEnd)
  publish()
  return {
    get revision() { return revision },
    /** Settle this edit only; newer edits retire this send intent instead of joining it. */
    settle(): Promise<boolean> { return pending?.done ?? Promise.resolve(settled && !disposed && !editor.isDestroyed && !editor.view.composing) },
    receive(reply: ClaudePromptReply) {
      if (disposed || !pending || reply.revision !== pending.revision || editor.isDestroyed) return
      const { snapshot, selection } = pending
      if (editor.state.doc !== snapshot.doc || !editor.state.selection.eq(selection)) { finishPending(false); return }
      if (reply.status === 'error') { onProblem(reply.message); finishPending(false); return }
      if (reply.frame.superseded) { finishPending(false); return }
      const next = rewriteClaudePromptDocument(snapshot, reply.frame, serialize)
      if (!next) { onProblem('Claude prompt rewrite cannot be represented without changing editor structure'); finishPending(false); return }
      applying = true
      try {
        const tr = editor.state.tr
        if (next.doc !== snapshot.doc) tr.replaceWith(0, tr.doc.content.size, next.doc.content)
        tr.setSelection(TextSelection.create(tr.doc, next.position))
        tr.setMeta(decorations.key, drawClaudePromptDecorations(tr.doc, reply.frame.decorations ?? [], serialize))
        editor.view.dispatch(tr)
        onProblem(undefined)
        finishPending(true)
      } catch (error) {
        finishPending(false)
        onProblem(error instanceof Error ? error.message : 'Claude input could not be applied')
      } finally { applying = false }
    },
    dispose() {
      disposed = true; finishPending(false)
      if (clearPerson) clearTimeout(clearPerson)
      editor.off('transaction', transaction)
      editor.off('destroy', destroyed)
      if (!editor.isDestroyed) editor.unregisterPlugin(decorations.key)
      for (const event of events) dom.removeEventListener(event, intent, true)
      dom.removeEventListener('compositionend', compositionEnd)
    },
  }
}
