import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const CommandViewerDecoration = Extension.create({
  name: 'commandViewerDecoration',
  addProseMirrorPlugins() {
    if (this.editor.isEditable) return []
    const thisEditor = this.editor
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (thisEditor.isEditable) return DecorationSet.empty
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
