import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const CommandViewerDecoration = Extension.create({
  name: 'commandViewerDecoration',
  addProseMirrorPlugins() {
    if (this.editor.isEditable) return []
    return [
      new Plugin({
        props: {
          decorations(state) {
            const text = state.doc.textContent
            const match = text.match(/^\/[\w-]+/)
            if (!match) return DecorationSet.empty

            const cmdStart = 1 // position after doc node opening
            const cmdEnd = cmdStart + match[0].length
            return DecorationSet.create(state.doc, [
              Decoration.inline(cmdStart, cmdEnd, { class: 'command-segment' }),
            ])
          },
        },
      }),
    ]
  },
})

/** The same command segment, rendered without a ProseMirror decoration set. */
export const ReadOnlyCommandDecoration = {
  decorate(root: HTMLElement) {
    const match = root.textContent?.match(/^\/[\w-]+/)
    if (!match) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const first = walker.nextNode()
    if (!first) return
    let last = first
    let remaining = match[0].length
    while (remaining > (last.textContent?.length ?? 0)) {
      remaining -= last.textContent?.length ?? 0
      const next = walker.nextNode()
      if (!next) return
      last = next
    }
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, remaining)
    const span = document.createElement('span')
    span.className = 'command-segment'
    span.appendChild(range.extractContents())
    range.insertNode(span)
  },
}
