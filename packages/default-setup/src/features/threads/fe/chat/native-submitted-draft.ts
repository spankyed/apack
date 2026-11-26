import type { Editor, EditorEvents } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Selection, type EditorState } from '@tiptap/pm/state'
import { watch } from 'vue'

export function createNativeSubmittedDraft(submitted: Node) {
  const boundary = Selection.atEnd(submitted).head
  let prefixUntouched = true
  return {
    observe({ transaction, appendedTransactions }: EditorEvents['transaction']) {
      for (const change of [transaction, ...appendedTransactions]) {
        for (const step of change.mapping.maps) {
          step.forEach(from => {
            if (from < boundary) prefixUntouched = false
          })
        }
      }
    },
    transaction(state: EditorState) {
      if (!prefixUntouched) return
      const { doc, tr } = state
      const original = submitted.type.schema === state.schema ? submitted : state.schema.nodeFromJSON(submitted.toJSON())
      tr.setMeta('claude-prompt-by', 'app').setMeta('addToHistory', false)
      if (doc.eq(original)) return tr.delete(0, doc.content.size)
      // A new block may start outside the final text block's closing tokens.
      // Prefer the outermost cut that leaves exactly the submitted document.
      for (let end = Math.min(original.content.size, doc.content.size - 1); end >= boundary; end--) {
        if (!doc.cut(0, end).eq(original)) continue
        tr.delete(0, end)
        if (tr.doc.eq(doc.cut(end))) return tr
        return
      }
    },
  }
}

export function trackNativeSubmittedDraft(editor: Editor, submitted: Node) {
  const draft = createNativeSubmittedDraft(submitted)
  editor.on('transaction', draft.observe)
  return {
    dispose: () => { editor.off('transaction', draft.observe) },
    removeAcceptedPrefix() {
      if (editor.view.composing) return
      const transaction = draft.transaction(editor.state)
      if (transaction) editor.view.dispatch(transaction)
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
    scheduleCheck()
  })
}
