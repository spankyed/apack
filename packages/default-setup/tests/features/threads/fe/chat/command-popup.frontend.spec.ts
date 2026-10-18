import { createApp, h, nextTick } from 'vue'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import CommandSuggestionPopup from '#extensions/tiptap/CommandSuggestionPopup.vue'
import { commandSuggestionPlugin, commandSuggestionPluginKey } from '#extensions/tiptap/command-suggestion-plugin.ts'
vi.mock('#extensions/tiptap/useCommandItems.ts', async () => { const { ref } = await import('vue'); return { useCommandItems: () => ({ commands: ref([]) }) } })
it('preserves an unmatched native slash command when clicking Send outside the app picker', async () => {
  const root = document.createElement('div'), form = document.createElement('form'), send = document.createElement('button')
  send.type = 'submit'; send.textContent = 'Send'; form.append(send); document.body.append(root, form)
  const editor = new Editor({ extensions: [StarterKit], content: '' })
  editor.registerPlugin(commandSuggestionPlugin(editor, () => []))
  const app = createApp({ render: () => h(CommandSuggestionPopup, { editor }) }); app.mount(root)
  try {
    editor.commands.setContent('/context'); editor.commands.setTextSelection(editor.state.doc.content.size - 1); await nextTick(); await nextTick()
    await vi.waitFor(() => expect(document.querySelector('.command-suggestion-popup')).not.toBeNull())
    send.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(editor.state.doc.textContent).toBe('/context')
    expect(commandSuggestionPluginKey.getState(editor.state)?.active).toBe(false)
  } finally { app.unmount(); editor.destroy(); document.body.replaceChildren() }
})
