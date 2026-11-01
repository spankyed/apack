import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { Editor } from '@tiptap/core'
import { createExtensions } from '../../../../src/components/tiptap/extensions.ts'
import { createChatMarkdownParser } from '../../../../src/components/tiptap/internal/chat-markdown.ts'
import { renderChat } from '../../../../src/components/tiptap/internal/render-chat.ts'

let dom: JSDOM
const editors: Editor[] = []
const cleanups: Array<() => void> = []
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'Node', 'MutationObserver', 'MouseEvent', 'getComputedStyle'] as const)
    vi.stubGlobal(key, key === 'window' ? dom.window : dom.window[key])
})
afterEach(() => { for (const release of cleanups.splice(0)) release(); for (const editor of editors.splice(0)) editor.destroy(); dom.window.close(); vi.unstubAllGlobals() })
function compare(source: string) {
  const element = document.createElement('div'); document.body.appendChild(element)
  const editor = new Editor({ element, editable: false, extensions: createExtensions({ mode: 'viewer', variant: 'chat' }), content: source })
  editors.push(editor)
  const candidate = renderChat(createChatMarkdownParser(), source, [])
  cleanups.push(candidate.dispose)
  return { baseline: editor.view.dom, candidate: candidate.root }
}
it('preserves code-copy text and paragraph content against the existing viewer', () => {
  const pair = compare('## Heading\n\n**Bold** and *emphasis*\nnext line\n\n```js\nconst x = 1\n```')
  for (const selector of ['h2', 'strong', 'em', 'pre code']) {
    expect(pair.candidate.querySelector(selector)?.textContent, selector).toBe(pair.baseline.querySelector(selector)?.textContent)
  }
})
it('preserves table cell block structure and text against the existing viewer', () => {
  const pair = compare('| Name | Value |\n| --- | --- |\n| alpha | beta |')
  const cells = (root: HTMLElement) => [...root.querySelectorAll('th,td')].map(cell => ({ tag: cell.tagName, html: cell.innerHTML }))
  expect(cells(pair.candidate)).toEqual(cells(pair.baseline))
})
it('preserves inline image behavior against the existing chat viewer', () => {
  const pair = compare('before ![alt](https://example.com/image.png) after')
  expect(pair.candidate.querySelectorAll('img').length).toBe(pair.baseline.querySelectorAll('img').length)
})

it('preserves the empty-message line box used before a reply starts streaming', () => {
  const pair = compare('')
  expect(pair.candidate.querySelector('p')?.innerHTML).toBe(pair.baseline.querySelector('p')?.innerHTML)
})
it('preserves nested tight-list paragraph structure', () => {
  const pair = compare('- first\n  - nested\n- second')
  const shape = (root: HTMLElement) => ({
    tight: [...root.querySelectorAll('ul')].map(list => list.getAttribute('data-tight')),
    paragraphs: [...root.querySelectorAll('li > p')].map(paragraph => paragraph.textContent?.trim()),
  })
  expect(shape(pair.candidate)).toEqual(shape(pair.baseline))
})

it('preserves links introduced by streamed content updates', () => {
  const pair = compare('starting reply')
  const source = 'See [example](https://example.com) for details. '
  editors[editors.length - 1]!.commands.setContent(source)
  const updated = renderChat(createChatMarkdownParser(), source, [])
  cleanups.push(updated.dispose)
  const links = (root: HTMLElement) => [...root.querySelectorAll('a')].map(link => link.getAttribute('href'))
  expect(links(pair.baseline)).toEqual(['https://example.com'])
  expect(links(updated.root)).toEqual(links(pair.baseline))
})
