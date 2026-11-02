import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createChatMarkdownParser } from '../../../../src/components/tiptap/internal/chat-markdown.ts'
import { renderChat } from '../../../../src/components/tiptap/internal/render-chat.ts'

let dom: JSDOM
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => { vi.unstubAllGlobals(); dom.window.close() })

it('renders rich content safely with highlighted code text and copy controls', () => {
  const rendered = renderChat(createChatMarkdownParser(), '# Heading\n\n**bold**\n\n```js\nconst x = "<img onerror=x>"\n```\n\n<script>alert(1)</script>', [])
  expect(rendered.root.querySelector('h1')?.textContent).toBe('Heading')
  expect(rendered.root.querySelector('strong')?.textContent).toBe('bold')
  expect(rendered.root.querySelector('script')).toBeNull()
  expect(rendered.root.querySelector('img')).toBeNull()
  expect(rendered.root.querySelector('code')?.textContent).toBe('const x = "<img onerror=x>"')
  expect(rendered.root.querySelector('code .hljs-keyword')?.textContent).toBe('const')
  expect(rendered.root.querySelector('button')?.getAttribute('aria-label')).toBe('Copy code')
  rendered.dispose()
})

it('unwinds earlier adapters if a later adapter refuses construction', () => {
  const cleanup = vi.fn()
  expect(() => renderChat(createChatMarkdownParser(), 'body', [
    { decorate: () => cleanup }, { decorate: () => { throw Error('refused') } },
  ])).toThrow('refused')
  expect(cleanup).toHaveBeenCalledOnce()
})

it('releases every adapter even if cleanup throws and disposes only once', () => {
  const cleanup = vi.fn()
  const rendered = renderChat(createChatMarkdownParser(), 'body', [
    { decorate: () => cleanup }, { decorate: () => () => { throw Error('cleanup refused') } },
  ])
  expect(rendered.dispose).toThrow('cleanup failed')
  expect(cleanup).toHaveBeenCalledOnce()
  rendered.dispose()
  expect(cleanup).toHaveBeenCalledOnce()
})

it('ignores clipboard completion after disposal', async () => {
  let finish!: () => void
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>(resolve => { finish = resolve }) } })
  const rendered = renderChat(createChatMarkdownParser(), '```\ncode\n```', [])
  const button = rendered.root.querySelector('button')!
  button.click()
  rendered.dispose()
  finish()
  await Promise.resolve()
  expect(button.classList.contains('is-copied')).toBe(false)
})

it('copies the original code text rather than highlighting markup', async () => {
  const write = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: write } })
  const rendered = renderChat(createChatMarkdownParser(), '```js\nconst x = "<tag>"\n```', [])
  rendered.root.querySelector('button')!.click()
  expect(write).toHaveBeenCalledWith('const x = "<tag>"')
  await Promise.resolve()
  rendered.dispose()
})
