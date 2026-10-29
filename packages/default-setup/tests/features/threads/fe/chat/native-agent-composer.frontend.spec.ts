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
async function mount(send: (text: string) => Promise<ClaudeNativeAgentInputReview | { commandPending: true } | void> = async () => {}, connected = false, draftSnapshot?: ClaudeAgentDraftSnapshot, openSettings?: () => Promise<void>) {
  const leave = vi.fn(), draft = vi.fn(), saved = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const state = reactive({ draft: 'Unsent Agent draft', attachmentId: 'native-one', promptRevision: 0, prompt: undefined as ClaudePromptReply | undefined })
  const edit = vi.fn((value: ClaudePromptEdit) => { state.promptRevision = value.revision; state.prompt = { revision: value.revision, status: 'applied', frame: { text: value.text, cursor: value.cursor } } })
  app = createApp({ render: () => h(NativeAgentComposer, { draft: state.draft, draftSnapshot, 'onDraft-snapshot': saved, disabled: false, send, openSettings, mountId: connected ? 'agent-ui' : undefined, attachmentId: state.attachmentId, promptRevision: state.promptRevision, prompt: state.prompt, onEdit: edit, onLeave: leave, onDraft: (text: string) => { draft(text); state.draft = text } }) }); app.mount(root); await nextTick(); await nextTick()
  return { leave, draft, saved, root, state, edit }
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
it('adopts the current draft and selection as app input when a fresh native attachment replaces the old one', async () => {
  const f = await mount(async () => {}, true)
  editor.commands.setTextSelection({ from: 2, to: 5 }); await nextTick()
  const doc = editor.state.doc, selected = editor.state.selection, revision = f.state.promptRevision, edits = f.edit.mock.calls.length
  f.state.attachmentId = 'native-two'; await nextTick(); await nextTick()
  expect(f.edit).toHaveBeenCalledTimes(edits + 1)
  expect(f.edit.mock.lastCall![0]).toMatchObject({ by: 'app', revision: revision + 1, text: 'Unsent Agent draft' })
  expect(editor.state.doc).toBe(doc); expect(editor.state.selection.eq(selected)).toBe(true)
})

it('keeps the last committed draft and selection when an Agent unmounts during composition', async () => {
  const f = await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  editor.commands.setTextSelection(4)
  editor.commands.toggleBold()
  const committed = editor.getJSON(), selection = editor.state.selection.toJSON()
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true })
  editor.commands.insertContent('未確定')
  await nextTick()
  expect(f.state.draft).toBe('Unsent Agent draft')
  app!.unmount(); app = undefined
  expect(f.saved).toHaveBeenCalledOnce()
  expect(f.saved.mock.lastCall![0]).toMatchObject({text:'Unsent Agent draft',doc:committed,selection,storedMarks:[{type:'bold'}]})
  expect(f.edit.mock.calls.every(([event])=>!event.text.includes('未確定'))).toBe(true)
})

it('publishes a finished composition even when its last content update was preedit', async () => {
  const f = await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  Object.defineProperty(editor.view, 'composing', { configurable:true, value:true })
  editor.commands.insertContent('確定')
  expect(f.state.draft).toBe('Unsent Agent draft')
  Object.defineProperty(editor.view, 'composing', { configurable:true, value:false })
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', {data:'確定',bubbles:true}))
  await nextTick(); await nextTick()
  expect(f.state.draft).toContain('確定')
  expect(f.draft.mock.calls.filter(([text])=>text.includes('確定'))).toHaveLength(1)
})

it('does not publish a cancelled composition as an Agent draft', async () => {
  const f = await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  const original = editor.getJSON()
  Object.defineProperty(editor.view, 'composing', { configurable:true, value:true })
  editor.commands.insertContent('取消');editor.commands.setContent(original)
  Object.defineProperty(editor.view, 'composing', { configurable:true, value:false })
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', {data:'',bubbles:true}))
  await nextTick(); await nextTick()
  expect(f.state.draft).toBe('Unsent Agent draft')
  expect(f.draft.mock.calls.every(([text])=>!text.includes('取消'))).toBe(true)
})

it('places the browser caret at retained input before immediate keyboard focus can publish a different cursor', async () => {
  await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  editor.commands.setTextSelection(5); editor.commands.toggleBold()
  const selection=window.getSelection()!;selection.removeAllRanges()
  editor.view.dom.focus()
  await nextTick()
  expect(selection.anchorNode).toBe(editor.view.dom.querySelector('p')!.firstChild)
  expect(selection.anchorOffset).toBe(4)
  expect(editor.state.selection.head).toBe(5)
  expect(editor.state.storedMarks?.map(mark=>mark.type.name)).toEqual(['bold'])
})

it('allows a pointer focus to choose a new caret instead of restoring the prior position', async () => {
  await mount(async () => {}, true)
  await vi.waitFor(() => expect(editor.isInitialized).toBe(true))
  editor.commands.setTextSelection(5);editor.commands.toggleBold()
  editor.view.dom.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}))
  editor.view.dom.focus()
  const selection=window.getSelection()!,range=document.createRange()
  range.setStart(editor.view.dom.querySelector('p')!.firstChild!,1);range.collapse(true)
  selection.removeAllRanges();selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await nextTick()
  expect(editor.state.selection.head).toBe(2)
  expect(editor.state.storedMarks).toBeNull()
})

it('opens Settings once without sending or replacing the Agent document and selection',async()=>{
 let finish!:()=>void
 const settings=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve})),send=vi.fn(async()=>{})
 const f=await mount(send,true,undefined,settings)
 editor.commands.setTextSelection({from:2,to:7});await nextTick()
 const doc=editor.state.doc,selection=editor.state.selection.toJSON()
 const button=f.root.querySelector<HTMLButtonElement>('[aria-label="Claude settings"]')!
 button.click();button.click()
 await vi.waitFor(()=>expect(settings).toHaveBeenCalledOnce());finish();await nextTick();await nextTick()
 expect(send).not.toHaveBeenCalled();expect(editor.state.doc).toBe(doc);expect(editor.state.selection.toJSON()).toEqual(selection)
 expect(f.draft).not.toHaveBeenCalledWith('')
})
it('keeps the Agent draft on Settings refusal and retires an invocation across native reattachment',async()=>{
 const settings=vi.fn(async()=>{throw Error('Original Settings refusal')})
 const f=await mount(async()=>{},true,undefined,settings)
 f.root.querySelector<HTMLButtonElement>('[aria-label="Claude settings"]')!.click()
 await vi.waitFor(()=>expect(f.root.textContent).toContain('Original Settings refusal'))
 expect(editor.state.doc.textContent).toBe('Unsent Agent draft')
 settings.mockClear();editor.commands.insertContent(' newer');await nextTick()
 f.root.querySelector<HTMLButtonElement>('[aria-label="Claude settings"]')!.click();f.state.attachmentId='replacement'
 await nextTick();await nextTick()
 expect(settings).not.toHaveBeenCalled();expect(editor.state.doc.textContent).toContain('newer')
})
