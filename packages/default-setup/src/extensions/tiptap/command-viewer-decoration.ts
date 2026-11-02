import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { conversationMessageNodeName } from '@apackdev/ui/components/tiptap/extensions'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export const CommandViewerDecoration = Extension.create({
  name: 'commandViewerDecoration',
  addProseMirrorPlugins() {
    if (this.editor.isEditable) return []
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const decorate = (document: ProseMirrorNode, start: number) => {
              const match = document.textContent.match(/^\/[\w-]+/)
              if (match) decorations.push(Decoration.inline(start, start + match[0].length, { class: 'command-segment' }))
            }
            if (state.doc.firstChild?.type.name === conversationMessageNodeName) {
              state.doc.forEach((message, offset) => decorate(message, offset + 2))
            } else decorate(state.doc, 1)
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
