// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { Extension, type Editor } from '@tiptap/core'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import type MarkdownIt from 'markdown-it'
import type { TextEditorExtensionsBinding } from '@apackdev/sdk/fe'
import ConversationViewer from '../../../src/components/tiptap/ConversationViewer.vue'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); stopFeTestRuntime() })

async function settle() { for (let i = 0; i < 5; i++) await nextTick() }

async function fixture() {
  const editors: Editor[] = []
  const probe = { packId: 'fixture', groupId: 'lifetime', binding: { extensions: {
    lifetime: Extension.create({ name: 'lifetime', onBeforeCreate() { editors.push(this.editor) } }),
  } } }
  let groups: TextEditorExtensionsBinding[] = [probe]
  const listeners = new Set<() => void>()
  startFeTestRuntime({ packs: { textEditor: () => groups,
    onChanged(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback) } },
  } as never })
  const messages = ref([{ id: 'a', text: '**first**' }, { id: 'b', text: '/help second' }])
  const root = document.createElement('div')
  document.body.appendChild(root)
  const rendered: string[][] = []
  app = createApp({ render: () => h(ConversationViewer, { messages: messages.value,
    onRendered: () => rendered.push(Array.from(root.querySelectorAll('[data-message]'), row => row.textContent ?? '')),
  }, {
    default: ({ id, content }: { id: string; content: object }) => h('section', { 'data-message': id }, [h(content)]),
  }) })
  app.mount(root)
  await settle()
  return { messages, root, listeners, editors, rendered, async publish(next: TextEditorExtensionsBinding[]) {
    groups = [probe, ...next]; for (const listener of listeners) listener(); await settle()
  } }
}

it('uses one editor, updates bodies and retains unchanged rows across prepend, reorder and deletion', async () => {
  const f = await fixture()
  expect(f.editors).toHaveLength(1)
  expect(f.root.querySelectorAll('.ProseMirror')).toHaveLength(1)
  expect(f.root.querySelectorAll('[data-message]')).toHaveLength(2)
  expect(f.rendered.at(-1)).toEqual(['first', '/help second'])
  const first = f.root.querySelector('[data-message="a"]')
  expect(first?.querySelector('strong')?.textContent).toBe('first')
  f.messages.value[1].text = '## updated'
  await settle()
  expect(f.root.querySelector('[data-message="a"]')).toBe(first)
  expect(f.root.querySelector('[data-message="b"] h2')?.textContent).toBe('updated')
  expect(f.rendered.at(-1)).toEqual(['first', 'updated'])
  f.messages.value.unshift({ id: 'older', text: 'older' })
  await settle()
  expect(f.root.querySelector('[data-message="a"]')).toBe(first)
  expect(Array.from(f.root.querySelectorAll('[data-message]'), row => row.getAttribute('data-message'))).toEqual(['older', 'a', 'b'])
  f.messages.value = [f.messages.value[2], f.messages.value[1]]
  await settle()
  expect(Array.from(f.root.querySelectorAll('[data-message]'), row => row.getAttribute('data-message'))).toEqual(['b', 'a'])
  f.messages.value[0].text = ''
  await settle()
  expect(f.root.querySelector('[data-message="b"]')?.textContent).toBe('')
  f.messages.value = []
  await settle()
  expect(f.root.querySelectorAll('[data-message]')).toHaveLength(0)
  expect(f.editors).toHaveLength(1)
})

it('keeps a selection in an unchanged message and copies Markdown using the existing serializer', async () => {
  const f = await fixture()
  const editor = f.editors[0]
  editor.commands.setTextSelection({ from: 2, to: 7 })
  const selection = editor.state.selection.toJSON()
  f.messages.value[1].text = 'A longer streamed response'
  await settle()
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(editor.view.serializeForClipboard(editor.state.selection.content()).text).toBe('**first**')
  editor.commands.setTextSelection({ from: 2, to: editor.state.doc.content.size - 2 })
  const copied = editor.view.serializeForClipboard(editor.state.selection.content()).text
  expect(copied).toBe('**first**\n\nA longer streamed response')
})

it('renders rich Markdown through the existing parser, including table container elements', async () => {
  const f = await fixture()
  f.messages.value[0].text = '## Heading\n\n**bold** and *italic*\n\n> quoted\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| alpha | beta |\n\n```js\nconst value = "safe <text>"\n```'
  await settle()
  expect(f.root.querySelector('[role="status"]')).toBeNull()
  for (const selector of ['h2', 'strong', 'em', 'blockquote', 'ul', 'table', 'pre code']) {
    expect(f.root.querySelector(`[data-message="a"] ${selector}`)).not.toBeNull()
  }
})

it('replaces contributed editor lifetime, preserves content, and releases its subscription', async () => {
  const f = await fixture()
  let destroyed = 0
  await f.publish([{ packId: 'pack', groupId: 'test', binding: { extensions: {
    probe: Extension.create({ name: 'probe', onDestroy() { destroyed++ } }),
  } } }])
  expect(f.root.querySelectorAll('.ProseMirror')).toHaveLength(1)
  expect(f.root.querySelector('strong')?.textContent).toBe('first')
  await f.publish([])
  expect(destroyed).toBe(1)
  expect(f.root.querySelector('strong')?.textContent).toBe('first')
  app!.unmount(); app = undefined
  expect(f.listeners.size).toBe(0)
})

it('replaces contributed popups without reconstructing the editor', async () => {
  const f = await fixture()
  const popup = (text: string): TextEditorExtensionsBinding => ({ packId: 'pack', groupId: 'popup', binding: {
    popups: { status: { setup: () => () => h('span', { 'data-popup': '' }, text) } },
  } })
  await f.publish([popup('first')])
  expect(f.root.querySelector('[data-popup]')?.textContent).toBe('first')
  await f.publish([popup('second')])
  expect(f.root.querySelector('[data-popup]')?.textContent).toBe('second')
  expect(f.editors).toHaveLength(1)
})

it('propagates a contributed parser refusal and recovers without leaving transaction capture active', async () => {
  const f = await fixture()
  await f.publish([{ packId: 'pack', groupId: 'parser', binding: { extensions: {
    parser: Extension.create({ name: 'refusingParser', addStorage: () => ({ markdown: { parse: {
      setup(markdown: MarkdownIt) {
        markdown.core.ruler.push('refuse-invalid-source', state => {
          if (state.src.includes('invalid-source')) throw new Error('Refused source')
        })
      },
    } } }) }),
  } } }])
  const editor = f.editors.at(-1)!
  const before = editor.state.doc
  f.messages.value[0].text = 'invalid-source'
  await settle()
  expect(f.root.querySelector('[role="status"]')).not.toBeNull()
  expect(editor.state.doc).toBe(before)
  expect(editor.isCapturingTransaction).toBe(false)
  f.messages.value[0].text = '**recovered**'
  await settle()
  expect(f.root.querySelector('[role="status"]')).toBeNull()
  expect(f.root.querySelector('strong')?.textContent).toBe('recovered')
})

it('refuses duplicate identities without publishing a partial document, then recovers', async () => {
  const f = await fixture()
  f.messages.value.push({ id: 'a', text: 'duplicate' })
  await settle()
  expect(f.root.querySelector('[role="status"]')?.textContent).toContain('could not be displayed')
  expect(f.root.querySelectorAll('[data-message]')).toHaveLength(2)
  f.messages.value.pop()
  await settle()
  expect(f.root.querySelector('[role="status"]')).toBeNull()
})
