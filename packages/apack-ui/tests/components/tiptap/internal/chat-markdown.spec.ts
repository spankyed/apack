import { expect, it } from 'vitest'
import { createChatMarkdownParser } from '../../../../src/components/tiptap/internal/chat-markdown.ts'
import { configureMarkdownRules } from '../../../../src/components/tiptap/internal/markdown-rules.ts'

it('preserves chat formatting and application whitespace rules', () => {
  const parser = createChatMarkdownParser()
  configureMarkdownRules(parser)
  const html = parser.render('# Heading\n\n**bold**\nnext\n\n&nbsp;\n\n` spaced`\n\n| a | b |\n|---|---|\n| x | y |')
  expect(html).toContain('<h1>Heading</h1>')
  expect(html).toContain('<strong>bold</strong><br>\nnext')
  expect(html).toContain('<p>\u00a0</p>')
  expect(html).toContain('` spaced`')
  expect(html).toContain('<table>')
})

it('escapes raw HTML and refuses executable link protocols', () => {
  const html = createChatMarkdownParser().render('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)')
  expect(html).toContain('&lt;img')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('href="https://example.com"')
})

it('does not share contributed parser changes between messages', () => {
  const first = createChatMarkdownParser()
  first.renderer.rules.strong_open = () => '<b>'
  expect(first.render('**one**')).toContain('<b>')
  expect(createChatMarkdownParser().render('**two**')).toContain('<strong>')
})
