import { createApp, h, reactive, nextTick, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import type { ClaudePromptReply, ClaudePromptCompletionReply, ClaudeUiMountState } from '#generated/types.ts'
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
  const state = reactive({ currentThread: { id: 'thread-one', messages: [] } as any, currentMode: 'Claude Code', isBusy: false, nativeSubmit: undefined as ((text: string, references: import('#generated/types.ts').MessageReferences) => Promise<void>) | undefined, nativeUi: undefined as ClaudeUiMountState | undefined, nativePrompt: undefined as { hostRequest?: import('#generated/types.ts').ClaudePromptHostRequest; mountId: string; reply?: ClaudePromptReply; completions?: ClaudePromptCompletionReply } | undefined, currentPhase: undefined as string | undefined, modes: [{ name: 'Claude Code' }] as any })
  const send = vi.fn(), hostResponse = vi.fn(), press = vi.fn(), command = vi.fn(), prompt = vi.fn(), complete = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(ChatInput, { ...state, onSendMessage: send, onNativeUiPress: press, onSendCommand: command, onNativePromptHostResponse: hostResponse, onNativePromptEdit: prompt, onNativePromptAutocomplete: complete }) }); app.mount(root)
  editor.commands.setContent('first')
  return { state, send, hostResponse, press, command, prompt, complete, root, submit: () => root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
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


it('draws native rows without autofocus, selects the exact token and never submits chat', async () => {
  const f = await nativeMount()
  const request = f.complete.mock.lastCall![0]
  f.state.nativePrompt!.completions = { revision: request.revision, status: 'ready', result: { start: 0, suggestions: [{ text: 'native-word', label: '<script>Native</script>', description: 'Plugin description' }] } }
  await nextTick()
  const row = f.root.querySelector('[aria-label="Claude suggestions"] button')! as HTMLButtonElement
  expect(row.textContent).toContain('<script>Native</script>')
  expect(f.root.querySelector('script')).toBeNull()
  expect(document.activeElement).not.toBe(row)
  row.click(); await nextTick()
  expect(editor.state.doc.textContent).toBe('native-word')
  expect(f.prompt.mock.lastCall![0]).toMatchObject({ by: 'app', text: 'native-word', cursor: 11 })
  expect(f.send).not.toHaveBeenCalled(); expect(f.command).not.toHaveBeenCalled()
  expect(f.root.querySelector('[aria-label="Claude suggestions"]')).toBeNull()
})

it('keeps native row navigation inside its group and drops stale clicks after typing', async () => {
  const f = await nativeMount(), request = f.complete.mock.lastCall![0]
  f.state.nativePrompt!.completions = { revision: request.revision, status: 'ready', result: { start: 0, suggestions: [{ text: 'one' }, { text: 'two' }] } }
  await nextTick()
  const group = f.root.querySelector('[aria-label="Claude suggestions"]')!, buttons = group.querySelectorAll('button')
  // The capture listener must see a later event than Vue's newly attached row listener.
  await new Promise(resolve => setTimeout(resolve, 1))
  buttons[0]!.focus(); buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(buttons[1])
  editor.commands.insertContent('x'); await nextTick()
  buttons[0]!.click(); expect(editor.state.doc.textContent).toBe('firstx')
  expect(f.root.querySelector('[aria-label="Claude suggestions"]')).toBeNull()
  expect(f.send).not.toHaveBeenCalled()
})


it('dismisses native offers on Escape and leaves Shift+Tab to normal focus traversal', async () => {
  const f = await nativeMount(), request = f.complete.mock.lastCall![0]
  f.state.nativePrompt!.completions = { revision: request.revision, status: 'ready', result: { start: 0, suggestions: [{ text: 'native' }] } }
  await nextTick()
  const row = f.root.querySelector('[aria-label="Claude suggestions"] button')! as HTMLButtonElement
  // Advance one event-loop turn past Vue's listener-attachment timestamp guard.
  await new Promise(resolve => setTimeout(resolve, 1))
  const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
  row.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false)
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await nextTick()
  expect(f.root.querySelector('[aria-label="Claude suggestions"]')).toBeNull()
  row.click(); expect(editor.state.doc.textContent).toBe('first')
  expect(f.send).not.toHaveBeenCalled()
})


it('refuses a detached old row click even after a newer offer occupies the same index', async () => {
  const f = await nativeMount(), first = f.complete.mock.lastCall![0]
  f.state.nativePrompt!.completions = { revision: first.revision, status: 'ready', result: { start: 0, suggestions: [{ text: 'old' }] } }
  await nextTick()
  const old = f.root.querySelector('[aria-label="Claude suggestions"] button')! as HTMLButtonElement
  editor.commands.insertContent('x'); await nextTick()
  const edit = f.prompt.mock.lastCall![0]
  f.state.nativePrompt!.reply = { revision: edit.revision, status: 'applied', frame: { text: edit.text, cursor: edit.cursor } }; await nextTick()
  const second = f.complete.mock.lastCall![0]
  f.state.nativePrompt!.completions = { revision: second.revision, status: 'ready', result: { start: 0, suggestions: [{ text: 'new' }] } }; await nextTick()
  old.click(); expect(editor.state.doc.textContent).toBe('firstx')
  ;(f.root.querySelector('[aria-label="Claude suggestions"] button')! as HTMLButtonElement).click()
  expect(editor.state.doc.textContent).toBe('new')
})


it('uses a bare digit for a native survey only when the actual composer draft and attachments are empty', async () => {
  const f = mount(vi.fn(async () => undefined))
  // This capture-path case needs the real editor DOM inside the mounted composer.
  f.root.querySelector('[data-testid="editor-fixture"]')!.append(editor.view.dom)
  f.state.nativeUi = { status: 'live', tree: { kind: 'button', label: 'Answer one', hotkey: '1', actionId: 'answer' } }
  editor.commands.clearContent(); await nextTick()
  ;(f.root.querySelector('[aria-label="Session tools"]')! as HTMLButtonElement).click(); await nextTick()
  const key = (init: KeyboardEventInit = {}) => { const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true, ...init }); editor.view.dom.dispatchEvent(event); return event }
  expect(key().defaultPrevented).toBe(true)
  expect(f.press).toHaveBeenCalledExactlyOnceWith('answer', undefined)
  editor.commands.setContent('Draft'); await nextTick()
  expect(key().defaultPrevented).toBe(false)
  editor.commands.clearContent(); await nextTick()
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { key: 'w' }]) expect(key(init).defaultPrevented).toBe(false)
  attachments.pendingFiles.value = [file('context.txt')]; await nextTick(); expect(key().defaultPrevented).toBe(false)
  attachments.pendingFiles.value = []; attachments.pendingImages.value = [image('context.png')]; await nextTick(); expect(key().defaultPrevented).toBe(false)
  attachments.pendingImages.value = []; f.state.nativeUi = { status: 'disconnected' }; await nextTick(); expect(key().defaultPrevented).toBe(false)
  expect(f.press).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled()
})


it('answers native host reads/fills through the actual input and refuses stale, expired or modal fills', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = mount(vi.fn(async () => undefined))
    f.state.nativePrompt = { mountId: 'native-owner' }; await nextTick()
    const request = (kind: 'read' | 'fill', extra = {}) => {
      const revision = f.prompt.mock.calls.at(-1)?.[0].revision ?? 0
      f.state.nativePrompt!.hostRequest = { requestId: crypto.randomUUID(), revision, expiresAt: Date.now() + 3000, ...(kind === 'read' ? { kind } : { kind, input: { text: 'native fill', mode: 'replace' as const } }), ...extra }
    }
    request('read'); await nextTick()
    expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'read', box: { text: 'first' } })
    request('fill'); await nextTick(); expect(editor.state.doc.textContent).toBe('native fill')
    expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'fill', filled: true })
    editor.commands.insertContent(' typing'); await nextTick()
    const newer = editor.state.doc.textContent
    request('fill', { revision: 0 }); await nextTick(); expect(editor.state.doc.textContent).toBe(newer)
    expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'fill', filled: false })
    request('fill', { expiresAt: Date.now() - 1 }); await nextTick()
    expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ filled: false })
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog)
    request('fill'); await nextTick(); expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ filled: false })
    expect(editor.state.doc.textContent).toBe(newer); expect(f.send).not.toHaveBeenCalled(); dialog.remove()
  } finally { windowFocus.mockRestore() }
})


it('shows native ghost text without changing the draft, accepts Tab and retires it for busy or attached input', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = mount(vi.fn(async () => undefined))
    f.root.querySelector('[data-testid="editor-fixture"]')!.append(editor.view.dom)
    f.state.nativePrompt = { mountId: 'native-owner' }; editor.commands.clearContent(); await nextTick()
    const propose = () => { f.state.nativePrompt!.hostRequest = { requestId: crypto.randomUUID(), revision: f.prompt.mock.calls.at(-1)![0].revision, expiresAt: Date.now() + 3000, kind: 'suggest', text: 'Native ghost' } }
    propose(); await nextTick()
    expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'suggest', shown: true })
    expect(editor.state.doc.textContent).toBe('')
    expect(f.root.querySelector('.claude-prompt-suggestion')?.textContent).toBe('Native ghost')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await nextTick()
    expect(editor.state.doc.textContent).toBe('Native ghost'); expect(f.send).not.toHaveBeenCalled()
    editor.commands.clearContent(); await nextTick(); f.state.isBusy = true
    propose(); await nextTick(); expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ shown: false })
    f.state.isBusy = false; propose(); await nextTick(); expect(f.root.querySelector('.claude-prompt-suggestion')).not.toBeNull()
    attachments.pendingFiles.value = [file('context.txt')]; await nextTick()
    expect(f.root.querySelector('.claude-prompt-suggestion')).toBeNull()
    propose(); await nextTick(); expect(f.hostResponse.mock.calls.at(-1)?.[0]).toMatchObject({ shown: false })
  } finally { windowFocus.mockRestore() }
})


it('retains a native draft until acceptance and keeps a rejected draft retryable', async () => {
  const f = mount(vi.fn(async () => undefined))
  let accept!: () => void
  f.state.nativeSubmit = vi.fn(() => new Promise<void>(resolve => { accept = resolve }))
  await nextTick(); f.submit(); f.submit()
  await vi.waitFor(() => expect(f.state.nativeSubmit).toHaveBeenCalledOnce())
  expect(editor.state.doc.textContent).toBe('first'); expect(f.send).not.toHaveBeenCalled()
  editor.commands.insertContent(' newer'); accept()
  await vi.waitFor(() => expect(f.root.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false))
  expect(editor.state.doc.textContent).toBe('first newer')
  f.state.nativeSubmit = vi.fn(async () => { throw new Error('Native hook refused') })
  await nextTick(); f.submit()
  await vi.waitFor(() => expect(f.root.textContent).toContain('Native hook refused'))
  expect(editor.state.doc.textContent).toBe('first newer'); expect(f.send).not.toHaveBeenCalled()
  f.state.nativeSubmit = vi.fn(async () => {})
  await nextTick(); f.submit()
  await vi.waitFor(() => expect(editor.state.doc.textContent).toBe(''))
})
