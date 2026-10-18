import { createApp, h, nextTick, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import NativeAgentComposer from '#features/threads/fe/chat/NativeAgentComposer.vue'
import type { Editor } from '@tiptap/core'
let app: App | undefined, editor: Editor
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => {
  const { defineComponent, h, onBeforeUnmount, onMounted, ref } = await import('vue')
  const { Editor, Extension } = await import('@tiptap/core')
  const { default: StarterKit } = await import('@tiptap/starter-kit')
  const { Markdown } = await import('tiptap-markdown')
  return { default: defineComponent({ setup(_props, { expose }) {
    const root = ref<HTMLElement>()
    editor = new Editor({ content: 'Unsent Agent draft', extensions: [StarterKit, Markdown, Extension.create({ name: 'genericEscape', addKeyboardShortcuts: () => ({ Escape: () => true }) })] })
    expose({ editor }); onMounted(() => root.value?.append(editor.view.dom)); onBeforeUnmount(() => editor.destroy())
    return () => h('div', { ref: root })
  } }) }
})
vi.mock('#features/threads/fe/chat/StatusLine.vue', () => ({ default: { render: () => null } }))
beforeEach(() => startFeTestRuntime())
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime() })
async function mount() {
  const leave = vi.fn(), draft = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeAgentComposer, { draft: 'Unsent Agent draft', disabled: false, send: async () => {}, onLeave: leave, onDraft: draft }) }); app.mount(root); await nextTick()
  return { leave, draft, root }
}
it('owns Escape before the generic editor keymap and preserves the unsent draft', async () => {
  const f = await mount(), event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  expect(f.leave).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true)
  expect(editor.state.doc.textContent).toBe('Unsent Agent draft'); expect(f.draft).not.toHaveBeenCalled()
})
it('keeps composition and other native controls outside the composer navigation handler', async () => {
  const f = await mount()
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))
  f.root.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(f.leave).not.toHaveBeenCalled(); expect(editor.state.doc.textContent).toBe('Unsent Agent draft')
})
