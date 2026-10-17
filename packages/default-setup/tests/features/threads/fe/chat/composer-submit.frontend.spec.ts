import { createApp, h, reactive, nextTick, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import type { ClaudePromptReply } from '#generated/types.ts'
import type { Editor } from '@tiptap/core'
import type { useAttachments } from '#features/threads/fe/chat/composables/useAttachments.ts'
import ChatInput from '#features/threads/fe/chat/input.vue'

let editor: Editor
let attachments: ReturnType<typeof useAttachments>
let app: App | undefined
let previousElectronApi: PropertyDescriptor | undefined
vi.mock('#features/threads/fe/chat/composables/useAttachments.ts', async importActual => {
  const actual = await importActual<typeof import('#features/threads/fe/chat/composables/useAttachments.ts')>()
  return { ...actual, useAttachments: () => { attachments = actual.useAttachments(); return attachments } }
})
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => {
  const { defineComponent, h, onUnmounted } = await import('vue')
  const { Editor } = await import('@tiptap/core')
  const { default: StarterKit } = await import('@tiptap/starter-kit')
  const { Markdown } = await import('tiptap-markdown')
  return { default: defineComponent({ emits: ['update:modelValue'], setup(_props, { expose, emit }) {
    editor = new Editor({ extensions: [StarterKit, Markdown], onUpdate: ({ editor }) => emit('update:modelValue', (editor.storage as any).markdown.getMarkdown()) })
    expose({ editor }); onUnmounted(() => editor.destroy())
    return () => h('div', { 'data-testid': 'editor-fixture' })
  } }) }
})
vi.mock('#features/threads/fe/chat/status-indicator.vue', () => ({ default: { render: () => null } }))
vi.mock('#features/threads/fe/chat/QuickPromptsPopup.vue', () => ({ default: { render: () => null } }))
vi.mock('#features/threads/fe/chat/RevertHistoryPopup.vue', () => ({ default: { render: () => null } }))
vi.mock('#features/threads/fe/chat/ModePhaseSelector.vue', () => ({ default: { render: () => null } }))
vi.mock('#features/threads/fe/chat/FileBlock.vue', () => ({ default: { render: () => null } }))
vi.mock('#features/threads/fe/chat/ImageThumbnail.vue', () => ({ default: { render: () => null } }))

beforeEach(() => { previousElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI'); startFeTestRuntime(); localStorage.clear() })
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime(); if (previousElectronApi) Object.defineProperty(window, 'electronAPI', previousElectronApi); else Reflect.deleteProperty(window, 'electronAPI'); vi.unstubAllGlobals() })
function mount(upload: (...args: unknown[]) => Promise<string | undefined>) {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { media: { upload } } })
  const state = reactive({ currentThread: { id: 'thread-one', messages: [] } as any, currentMode: 'Claude Code', nativePrompt: undefined as { mountId: string; reply?: ClaudePromptReply } | undefined, currentPhase: undefined as string | undefined, modes: [{ name: 'Claude Code' }] as any })
  const send = vi.fn(), command = vi.fn(), prompt = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ChatInput, { ...state, onSendMessage: send, onSendCommand: command, onNativePromptEdit: prompt }) }); app.mount(root)
  editor.commands.setContent('first')
  return { state, send, command, prompt, root, submit: () => root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
}
const image = (name: string) => ({ name, dataUrl: 'data:image/png;base64,YQ==' })
const file = (name: string) => ({ name, path: '/private/' + name, typeLabel: 'Text', isImage: false })

it('sends once during upload and preserves newer typing and attachments', async () => {
  let finish!: (url: string) => void
  const upload = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const f = mount(upload)
  attachments.pendingImages.value = [image('old.png')]; attachments.pendingFiles.value = [file('old.txt')]
  f.submit(); f.submit(); await nextTick()
  expect(upload).toHaveBeenCalledOnce()
  editor.commands.insertContent(' newer')
  attachments.pendingImages.value.push(image('new.png')); attachments.pendingFiles.value.push(file('new.txt'))
  finish('/media/old.png')
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
  expect(f.send).toHaveBeenCalledWith('first', expect.objectContaining({ images: [{ url: '/media/old.png', name: 'old.png' }], files: [expect.objectContaining({ name: 'old.txt' })] }))
  expect(editor.state.doc.textContent).toBe('first newer')
  expect(attachments.pendingImages.value.map(img => img.name)).toEqual(['new.png'])
  expect(attachments.pendingFiles.value.map(item => item.name)).toEqual(['new.txt'])
})

it.each(['thread', 'mode', 'phase'] as const)('retires an upload after %s ownership changes without clearing the draft', async owner => {
  let finish!: (url: string) => void
  const f = mount(() => new Promise<string>(resolve => { finish = resolve }))
  attachments.pendingImages.value = [image('old.png')]; f.submit()
  if (owner === 'thread') f.state.currentThread = { id: 'thread-two', messages: [] }
  else if (owner === 'mode') f.state.currentMode = 'Other mode'
  else f.state.currentPhase = 'review'
  await nextTick()
  editor.commands.setContent('another thread draft'); finish('/media/old.png'); await new Promise(resolve => setTimeout(resolve, 10))
  expect(f.send).not.toHaveBeenCalled(); expect(f.command).not.toHaveBeenCalled()
  expect(editor.state.doc.textContent).toBe('another thread draft')
  expect(attachments.pendingImages.value).toHaveLength(1)
})

it('keeps failed uploads available for retry and clears the successful unchanged draft', async () => {
  const upload = vi.fn().mockRejectedValueOnce(new Error('Fixture upload failed')).mockResolvedValue('/media/retry.png')
  const f = mount(upload)
  attachments.pendingImages.value = [image('retry.png')]; f.submit()
  await vi.waitFor(() => expect(f.root.textContent).toContain('Fixture upload failed'))
  expect(f.send).not.toHaveBeenCalled(); expect(editor.state.doc.textContent).toBe('first')
  expect(attachments.pendingImages.value).toHaveLength(1)
  f.submit(); await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
  expect(editor.state.doc.textContent).toBe(''); expect(attachments.pendingImages.value).toHaveLength(0)
})


it('retires an in-flight send when the composer unmounts', async () => {
  let finish!: (url: string) => void
  const f = mount(() => new Promise<string>(resolve => { finish = resolve }))
  attachments.pendingImages.value = [image('old.png')]; f.submit()
  app!.unmount(); app = undefined
  finish('/media/old.png'); await new Promise(resolve => setTimeout(resolve, 10))
  expect(f.send).not.toHaveBeenCalled(); expect(f.command).not.toHaveBeenCalled()
})


async function nativeMount() {
  const f = mount(vi.fn(async () => undefined))
  f.state.nativePrompt = { mountId: 'native-view' }; await nextTick()
  const adoption = f.prompt.mock.lastCall![0]
  f.state.nativePrompt.reply = { revision: adoption.revision, status: 'applied', frame: { text: adoption.text, cursor: adoption.cursor } }
  await nextTick()
  return f
}

it('waits for the current native edit and sends its rewritten draft once', async () => {
  const f = await nativeMount()
  editor.view.dom.dispatchEvent(new Event('beforeinput', { bubbles: true }))
  editor.commands.insertContent('x')
  const request = f.prompt.mock.lastCall![0]
  f.submit(); f.submit(); await nextTick()
  expect(f.send).not.toHaveBeenCalled()
  f.state.nativePrompt!.reply = { revision: request.revision, status: 'applied', frame: { text: 'FIRSTX', cursor: 6 } }
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
  expect(f.send).toHaveBeenCalledWith('FIRSTX', expect.anything())
  expect(editor.state.doc.textContent).toBe('')
})

it('retires a waiting Send on newer typing, leaving the new draft for an explicit Send', async () => {
  const f = await nativeMount()
  editor.commands.insertContent('x'); const old = f.prompt.mock.lastCall![0]
  f.submit(); editor.commands.insertContent('y'); const latest = f.prompt.mock.lastCall![0]
  await nextTick(); expect(f.send).not.toHaveBeenCalled()
  f.state.nativePrompt!.reply = { revision: old.revision, status: 'applied', frame: { text: 'OLD', cursor: 3 } }
  await nextTick(); expect(editor.state.doc.textContent).toBe('firstxy')
  f.state.nativePrompt!.reply = { revision: latest.revision, status: 'applied', frame: { text: 'FIRSTXY', cursor: 7 } }
  await nextTick(); expect(f.send).not.toHaveBeenCalled()
  f.submit(); await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
  expect(f.send).toHaveBeenCalledWith('FIRSTXY', expect.anything())
})

it.each(['disconnect', 'error', 'superseded'] as const)('retires a waiting Send on native %s', async outcome => {
  const f = await nativeMount()
  editor.commands.insertContent('x'); const request = f.prompt.mock.lastCall![0]
  f.submit()
  if (outcome === 'disconnect') f.state.nativePrompt = undefined
  else if (outcome === 'error') f.state.nativePrompt!.reply = { revision: request.revision, status: 'error', message: 'Native edit refused' }
  else f.state.nativePrompt!.reply = { revision: request.revision, status: 'applied', frame: { text: request.text, cursor: request.cursor, superseded: true } }
  await nextTick(); await nextTick()
  expect(f.send).not.toHaveBeenCalled()
  expect(editor.state.doc.textContent).toBe('firstx')
})
