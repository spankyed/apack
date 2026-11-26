import { afterEach, expect, it } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { conversationMessageNodeName } from '@apackdev/ui/components/tiptap/extensions'
import { CommandViewerDecoration } from '../../../src/extensions/tiptap/command-viewer-decoration.ts'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

it('decorates commands at each message boundary using the same viewer extension', () => {
  const Message = Node.create({ name: conversationMessageNodeName, group: 'block', content: 'block+',
    renderHTML: () => ['div', 0] })
  editor = new Editor({ editable: false, extensions: [StarterKit.configure({ trailingNode: false }), Message, CommandViewerDecoration],
    content: { type: 'doc', content: ['/first one', '/second two'].map(text => ({ type: Message.name,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })) },
  })
  expect(Array.from(editor.view.dom.querySelectorAll('.command-segment'), node => node.textContent)).toEqual(['/first', '/second'])
  editor.commands.setContent('<p>/ordinary single-document viewer</p>')
  expect(editor.view.dom.querySelector('.command-segment')?.textContent).toBe('/ordinary')
})

it('retires viewer-only command paint when a disabled editor becomes editable', () => {
  const editor = new Editor({ extensions: [StarterKit, CommandViewerDecoration], editable: false, content: '/cc-model haiku' })
  try {
    expect(editor.view.dom.querySelector('.command-segment')?.textContent).toBe('/cc-model')
    editor.setEditable(true)
    expect(editor.view.dom.querySelector('.command-segment')).toBeNull()
    expect(editor.state.doc.textContent).toBe('/cc-model haiku')
    editor.setEditable(false)
    expect(editor.view.dom.querySelector('.command-segment')?.textContent).toBe('/cc-model')
  } finally { editor.destroy() }
})
