import { expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CommandViewerDecoration } from '#extensions/tiptap/command-viewer-decoration.ts'

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
