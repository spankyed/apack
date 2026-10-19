import { claudeTextCut, claudeInlineText, cutClaudeTextNode } from '#features/threads/fe/chat/native-text-layout.ts'
import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'

const clipped = (text: string, width: number, mode: Parameters<typeof claudeTextCut>[2], measure = (start: number, end: number) => end - start) => {
  const cut = claudeTextCut(text, width, mode, measure, 1)
  return text.slice(0, cut.head) + (cut.ellipsis ? '…' : '') + text.slice(cut.tail)
}
it.each(['end', 'truncate', 'truncate-end'] as const)('keeps native end alias %s', mode => {
  expect(clipped('abcdefghij', 7, mode)).toBe('abcdef…')
})
it.each(['middle', 'truncate-middle'] as const)('keeps both native middle spellings %s', mode => {
  expect(clipped('abcdefghij', 7, mode)).toBe('abc…hij')
  expect(clipped('abcdefghij', 6, mode)).toBe('abc…ij')
})
it('preserves start, wrap, exact fit, zero width and ellipsis-only boundaries', () => {
  expect(clipped('abcdefghij', 7, 'truncate-start')).toBe('…efghij')
  expect(clipped('abcdefghij', 2, 'wrap')).toBe('abcdefghij')
  expect(clipped('abc', 3, 'truncate')).toBe('abc')
  expect(clipped('abc', 0, 'truncate')).toBe('')
  expect(clipped('abc', 1, 'truncate')).toBe('…')
})
it('uses measured width rather than character count and never splits a grapheme', () => {
  const text = 'We\u0301👩‍💻XYZ'
  const measure = (start: number, end: number) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.slice(start, end))].reduce((width, { segment }) => width + (segment === 'W' ? 3 : segment === '👩‍💻' ? 4 : 1), 0)
  expect(clipped(text, 6, 'truncate-end', measure)).toBe('We\u0301…')
  expect(clipped(text, 6, 'truncate-start', measure)).toBe('…XYZ')
})
it('retains surviving nested styles/link identity without changing the native source drawing', () => {
  const node: Extract<ClaudeUiNode, { kind: 'text' }> = { kind: 'text', text: 'ab', style: { wrap: 'middle', color: '#123456' }, children: [
    { kind: 'text', text: 'cdef', style: { bold: true }, plugin: 'native' },
    { kind: 'link', href: 'https://example.test/notes', children: [{ kind: 'text', text: 'ghij', style: { italic: true } }] },
  ] }
  const original = JSON.stringify(node)
  const result = cutClaudeTextNode(node, claudeTextCut(claudeInlineText(node)!, 7, 'middle', (a, b) => b - a, 1))
  expect(claudeInlineText(result)).toBe('abc…hij')
  expect(result.children?.[0]).toMatchObject({ text: 'ab', children: [{ text: 'c', style: { bold: true }, plugin: 'native' }] })
  expect(result.children?.[2]).toMatchObject({ children: [{ kind: 'link', href: 'https://example.test/notes', children: [{ text: 'hij', style: { italic: true } }] }] })
  expect(JSON.stringify(node)).toBe(original)
})
it('leaves non-inline component lifetimes outside text slicing', () => {
  const node = { kind: 'text', text: '', children: [{ kind: 'unsupported', component: 'engine' }] } as const
  expect(claudeInlineText(node as unknown as ClaudeUiNode)).toBeUndefined()
})
