// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Mark } from '@tiptap/core'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import type { TextEditorExtensionsBinding } from '@apackdev/sdk/fe'
import ChatMessageViewer from '../../../src/components/tiptap/ChatMessageViewer.vue'

vi.mock('../../../src/components/tiptap/TiptapEditor.vue', () => ({ default: {
  props: ['modelValue'], setup: (props: { modelValue: string }) => () => h('div', { 'data-editor-fallback': '' }, props.modelValue),
} }))

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); stopFeTestRuntime() })
function fixture(initial: TextEditorExtensionsBinding[] = []) {
  let groups = initial
  const listeners = new Set<() => void>()
  startFeTestRuntime({ packs: { textEditor: () => groups,
    onChanged(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback) } },
  } as never })
  const source = ref('**first**')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(ChatMessageViewer, { modelValue: source.value }) })
  app.mount(root)
  return { root, source, listeners, async publish(next: TextEditorExtensionsBinding[]) {
    groups = next; for (const listener of listeners) listener(); await nextTick(); await nextTick()
  } }
}

it('updates supported messages and disposes adapters on replacement and unmount', async () => {
  const cleanup = vi.fn()
  const decorate = vi.fn((root: HTMLElement) => { root.dataset.enhanced = 'yes'; root.classList.add('custom-message'); return cleanup })
  const f = fixture([{ packId: 'pack', groupId: 'group', binding: { readOnly: { decorate } } }])
  await nextTick()
  expect(f.root.querySelector('strong')?.textContent).toBe('first')
  expect(f.root.querySelector('[data-enhanced="yes"].custom-message.ProseMirror')).not.toBeNull()
  f.source.value = '**second**'; await nextTick(); await nextTick()
  expect(f.root.querySelector('strong')?.textContent).toBe('second')
  expect(cleanup).toHaveBeenCalledOnce()
  await f.publish([])
  expect(cleanup).toHaveBeenCalledTimes(2)
  app!.unmount(); app = undefined
  expect(f.listeners.size).toBe(0)
})

it('uses the editor for unknown contributions and returns to the supported path after removal', async () => {
  const f = fixture([{ packId: 'unknown', groupId: 'group', binding: {} }])
  await nextTick()
  expect(f.root.querySelector('[data-editor-fallback]')?.textContent).toBe('**first**')
  await f.publish([])
  expect(f.root.querySelector('[data-editor-fallback]')).toBeNull()
  expect(f.root.querySelector('strong')?.textContent).toBe('first')
})

it('shows a failed supported renderer and recovers after its contribution is replaced', async () => {
  const cleanup = vi.fn()
  const f = fixture([
    { packId: 'first', groupId: 'group', binding: { readOnly: { decorate: () => cleanup } } },
    { packId: 'bad', groupId: 'group', binding: { readOnly: { decorate: () => { throw Error('refused') } } } },
  ])
  await nextTick()
  expect(f.root.querySelector('[role="status"]')?.textContent).toContain('could not be displayed')
  expect(f.root.querySelector('[data-editor-fallback]')).toBeNull()
  expect(cleanup).toHaveBeenCalledOnce()
  await f.publish([])
  expect(f.root.querySelector('[role="status"]')).toBeNull()
  expect(f.root.querySelector('strong')?.textContent).toBe('first')
})

it('keeps the displayed DOM and selection target for unrelated editing-only contributions', async () => {
  const f = fixture([])
  await nextTick()
  const strong = f.root.querySelector('strong')
  await f.publish([{ packId: 'editing', groupId: 'suggestions', binding: { readOnly: false } }])
  expect(f.root.querySelector('strong')).toBe(strong)
})

it('preserves rendered DOM while copy uses a replaced contribution serializer', async () => {
  const readOnly = {}
  const bold = (delimiter: string) => Mark.create({ name: 'bold',
    parseHTML: () => [{ tag: 'strong' }], renderHTML: () => ['strong', 0],
    addStorage: () => ({ markdown: { serialize: { open: delimiter, close: delimiter, mixable: true, expelEnclosingWhitespace: true } } }),
  })
  const group = (delimiter: string): TextEditorExtensionsBinding => ({ packId: 'pack', groupId: 'format',
    binding: { readOnly, extensions: { bold: bold(delimiter) } } })
  const f = fixture([group('**')])
  await nextTick()
  const root = f.root.querySelector('.ProseMirror')!
  await f.publish([group('__')])
  expect(f.root.querySelector('.ProseMirror')).toBe(root)
  const range = document.createRange(); range.selectNodeContents(root)
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  const copied = new Map<string, string>()
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => copied.set(type, value) } })
  root.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(copied.get('text/plain')).toBe('__first__')
  selection.removeAllRanges()
})
