import type { Editor, EditorEvents } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { watch } from 'vue'

export function trackNativeSubmittedDraft(editor: Editor, submitted: Node) {
  const boundary = Selection.atEnd(submitted).head
  let prefixUntouched = editor.state.doc === submitted
  const record = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
    for (const change of [transaction, ...appendedTransactions]) {
      for (const step of change.mapping.maps) {
        step.forEach(from => {
          if (from < boundary) prefixUntouched = false
        })
      }
    }
  }
  editor.on('transaction', record)
  return {
    dispose: () => { editor.off('transaction', record) },
    removeAcceptedPrefix() {
      if (!prefixUntouched || editor.view.composing) return
      const { doc, tr } = editor.state
      if (doc.eq(submitted)) {
        editor.chain().setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false).clearContent(true).run()
        return
      }
      // A new block may start outside the final text block's closing tokens.
      // Prefer the outermost cut that leaves exactly the submitted document.
      for (let end = Math.min(submitted.content.size, doc.content.size - 1); end >= boundary; end--) {
        if (!doc.cut(0, end).eq(submitted)) continue
        tr.delete(0, end)
        if (tr.doc.eq(doc.cut(end))) {
          editor.view.dispatch(tr.setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false))
        }
        return
      }
    },
  }
}

/** ProseMirror may still be incorporating the final DOM input when compositionend fires. */
export function waitForSubmittedDraftComposition(editor: Editor, current: () => boolean): Promise<void> {
  return new Promise(resolve => {
    const { dom } = editor.view
    let check: ReturnType<typeof setTimeout> | undefined
    function finish() {
      clearTimeout(check)
      stopWatching()
      dom.removeEventListener('compositionend', scheduleCheck)
      editor.off('transaction', scheduleCheck)
      editor.off('destroy', finish)
      resolve()
    }
    function scheduleCheck() {
      if (check !== undefined || editor.view.composing) return
      check = setTimeout(() => {
        check = undefined
        if (!editor.view.composing) finish()
      }, 0)
    }
    const stopWatching = watch(current, owned => { if (!owned) finish() }, { flush: 'sync' })
    editor.on('destroy', finish)
    editor.on('transaction', scheduleCheck)
    dom.addEventListener('compositionend', scheduleCheck)
  })
}
