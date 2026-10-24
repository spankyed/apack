import { holdEditorCommandSuggestions } from '@apackdev/sdk/fe'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { createApp, h, nextTick } from 'vue'
import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import CommandSuggestionPopup from '@apackdev/ui/components/tiptap/CommandSuggestionPopup'
import { CommandSuggestion, commandSuggestionKey } from '@apackdev/ui/components/tiptap/extensions/command-suggestion'
vi.mock('@apackdev/ui/components/tiptap/composables/useCommandItems', async () => { const { ref } = await import('vue'); return { useCommandItems: () => ({ commands: ref([]) }) } })
it('preserves an unmatched native slash command when clicking Send outside the app picker', async () => {
  const root = document.createElement('div'), form = document.createElement('form'), send = document.createElement('button')
  send.type = 'submit'; send.textContent = 'Send'; form.append(send); document.body.append(root, form)
  startFeTestRuntime({ application: { getSnapshot: () => ({ context: { commands: [] } }), system: { get: () => undefined } } as never })
  const editor = new Editor({ extensions: [StarterKit, CommandSuggestion], content: '' })
  const app = createApp({ render: () => h(CommandSuggestionPopup, { editor }) }); app.mount(root)
  try {
    editor.commands.setContent('/context'); editor.commands.setTextSelection(editor.state.doc.content.size - 1); await nextTick(); await nextTick()
    await vi.waitFor(() => expect(document.querySelector('.command-suggestion-popup')).not.toBeNull())
    send.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(editor.state.doc.textContent).toBe('/context')
    expect(commandSuggestionKey.getState(editor.state)?.active).toBe(false)
  } finally { app.unmount(); editor.destroy(); stopFeTestRuntime(); document.body.replaceChildren() }
})

it('holds app command matching for an editor with a native producer and restores it after detach', () => {
  startFeTestRuntime({ application: { getSnapshot: () => ({ context: { commands: [{ name: 'cc-model', placeholder: 'Model' }] } }) } as never })
  const editor = new Editor({ extensions: [StarterKit, CommandSuggestion], content: '' })
  try {
    const release = holdEditorCommandSuggestions(editor)
    editor.commands.setContent('/cc-model haiku')
    expect(commandSuggestionKey.getState(editor.state)?.active).toBe(false)
    expect(editor.state.doc.textContent).toBe('/cc-model haiku')
    release()
    editor.commands.setContent('/cc-model haiku')
    expect(commandSuggestionKey.getState(editor.state)?.selectedCommand?.name).toBe('cc-model')
  } finally { editor.destroy(); stopFeTestRuntime() }
})
