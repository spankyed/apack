import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { Editor } from '@tiptap/core'
import { createExtensions } from '../../../src/components/tiptap/extensions.ts'

let dom: JSDOM, editor: Editor
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'Node', 'MutationObserver', 'getComputedStyle'] as const)
    vi.stubGlobal(key, key === 'window' ? dom.window : dom.window[key])
  editor = new Editor({ extensions: createExtensions({ mode: 'input', variant: 'chat' }) })
})
afterEach(() => { editor.destroy(); dom.window.close(); vi.unstubAllGlobals() })
it('preserves heading and code Markdown through the actual chat-input schema', () => {
  const text = '# Release review\n\n```ts\nconst ready = true\n```\n\nReview changes.'
  editor.commands.setContent(text)
  const { markdown } = editor.storage as unknown as { markdown: { serializer: { serialize(doc: typeof editor.state.doc): string } } }
  expect(markdown.serializer.serialize(editor.state.doc)).toBe(text)
  expect(editor.state.doc.firstChild?.type.name).toBe('heading')
  expect(editor.getHTML()).toContain('<pre>')
})
