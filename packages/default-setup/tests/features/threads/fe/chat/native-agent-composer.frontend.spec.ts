import { createApp, h, reactive, nextTick, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import NativeAgentComposer from '#features/threads/fe/chat/NativeAgentComposer.vue'
import type { ClaudePromptReply, ClaudePromptEdit } from '#generated/types.ts'
import type { ClaudeNativeAgentInputReview } from '#features/code/common/native-terminal.ts'
import type { Editor } from '@tiptap/core'
import type { ClaudeAgentDraftSnapshot } from '#features/threads/fe/chat/native-agent-draft.ts'
let resetSelectionOnCreate = false, preserveEmptyMarker = false
let app: App | undefined, editor: Editor
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => {
  const { defineComponent, h, onBeforeUnmount, onMounted, ref } = await import('vue')
  const { Editor, Extension } = await import('@tiptap/core')
  const { default: StarterKit } = await import('@tiptap/starter-kit')
  const { Markdown } = await import('tiptap-markdown')
  return { default: defineComponent({ emits: ['update:modelValue'], setup(_props, { expose, emit }) {
    const root = ref<HTMLElement>()
    editor = new Editor({ onCreate: ({ editor }) => { if (resetSelectionOnCreate) editor.commands.setTextSelection(1) }, onUpdate: ({ editor }) => emit('update:modelValue', preserveEmptyMarker && editor.isEmpty ? '&nbsp;' : (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()), content: 'Unsent Agent draft', extensions: [StarterKit, Markdown, Extension.create({ name: 'genericEscape', addKeyboardShortcuts: () => ({ Escape: () => true }) })] })
    expose({ editor }); onMounted(() => root.value?.append(editor.view.dom)); onBeforeUnmount(() => editor.destroy())
    return () => h('div', { ref: root })
  } }) }
})
vi.mock('#features/threads/fe/chat/StatusLine.vue', () => ({ default: { render: () => null } }))
beforeEach(() => { resetSelectionOnCreate = false; preserveEmptyMarker = false; startFeTestRuntime() })
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime() })
async function mount(send: (text: string) => Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void> = async () => {}, connected = false, draftSnapshot?: ClaudeAgentDraftSnapshot) {
  const leave = vi.fn(), draft = vi.fn(), saved = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const state = reactive({ draft: 'Unsent Agent draft', prompt: undefined as ClaudePromptReply | undefined })
  const edit = (value: ClaudePromptEdit) => { state.prompt = { revision: value.revision, status: 'applied', frame: { text: value.text, cursor: value.cursor } } }
  app = createApp({ render: () => h(NativeAgentComposer, { draft: state.draft, draftSnapshot, 'onDraft-snapshot': saved, disabled: false, send, mountId: connected ? 'agent-ui' : undefined, prompt: state.prompt, onEdit: edit, onLeave: leave, onDraft: (text: string) => { draft(text); state.draft = text } }) }); app.mount(root); await nextTick(); await nextTick()
  return { leave, draft, saved, root }
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

it('adopts the cleaned draft for review and requires another explicit submission', async () => {
  const send = vi.fn(async (): Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void> => ({ text: 'Clean Agent draft', removed: 1 }))
  const f = await mount(send, true)
  f.root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(f.root.textContent).toContain('Review the message before sending'))
  expect(send).toHaveBeenCalledOnce(); expect(editor.state.doc.textContent).toBe('Clean Agent draft')
  expect(f.root.querySelector('[role="alert"]')?.textContent).toContain('Removed 1 invisible character')
})
it('preserves newer typing when native admission returns a cleaned older draft', async () => {
  let finish!: (review: ClaudeNativeAgentInputReview) => void
  const send = vi.fn(() => new Promise<ClaudeNativeAgentInputReview>(resolve => { finish = resolve }))
  const f = await mount(send, true)
  f.root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  editor.commands.insertContent(' newer text')
  finish({ text: 'Older clean message', removed: 1 })
  await vi.waitFor(() => expect(f.root.textContent).toContain('Your newer draft was kept'))
  expect(editor.state.doc.textContent).toContain('newer text'); expect(send).toHaveBeenCalledOnce()
})

it('retains the exact draft when native submission opens a command confirmation', async () => {
  const send = vi.fn(async () => ({ commandPending: true as const }))
  const f = await mount(send, true)
  f.root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  await nextTick()
  expect(editor.state.doc.textContent).toBe('Unsent Agent draft')
  expect(f.draft).not.toHaveBeenCalledWith('')
})


it('captures selection before teardown and restores it after the next editor creation callback', async () => {
  const first = await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  editor.commands.setTextSelection({ from: 2, to: 7 })
  const selection = editor.state.selection.toJSON()
  app!.unmount(); app = undefined
  const snapshot = first.saved.mock.lastCall![0] as ClaudeAgentDraftSnapshot
  expect(snapshot.text).toBe('Unsent Agent draft'); expect(snapshot.selection).toEqual(selection)
  resetSelectionOnCreate = true
  await mount(async () => {}, true, snapshot)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(editor.state.doc.textContent).toBe('Unsent Agent draft')
})
it('persists a cleared Agent as an empty draft rather than the serializer placeholder', async () => {
  preserveEmptyMarker = true
  const f = await mount()
  editor.commands.clearContent(); await nextTick()
  expect(f.draft).toHaveBeenLastCalledWith('')
  expect(f.root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
})
