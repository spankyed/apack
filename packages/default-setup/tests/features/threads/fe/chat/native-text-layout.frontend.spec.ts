import { claudeTextCut, claudeInlineText, cutClaudeTextNode } from '#features/threads/fe/chat/native-text-layout.ts'
import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'

const clipped = (text: string, width: number, mode: Parameters<typeof claudeTextCut>[2], measure = (start: number, end: number) => end - start) => {
  let offset = 0
  const naturalWidth = Math.max(...text.split('\n').map(line => {
    const extent = measure(offset, offset + line.length); offset += line.length + 1; return extent
  }))
  const cut = claudeTextCut(text, width, mode, { width: naturalWidth, range: measure }, 1)
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
  const result = cutClaudeTextNode(node, claudeTextCut(claudeInlineText(node)!, 7, 'middle', { width: 10, range: (a, b) => b - a }, 1))
  expect(claudeInlineText(result)).toBe('abc…hij')
  expect(result.children?.[0]).toMatchObject({ text: 'ab', children: [{ text: 'c', style: { bold: true }, plugin: 'native' }] })
  expect(result.children?.[2]).toMatchObject({ children: [{ kind: 'link', href: 'https://example.test/notes', children: [{ text: 'hij', style: { italic: true } }] }] })
  expect(JSON.stringify(node)).toBe(original)
})
it('leaves non-inline component lifetimes outside text slicing', () => {
  const node = { kind: 'text', text: '', children: [{ kind: 'unsupported', component: 'engine' }] } as const
  expect(claudeInlineText(node as unknown as ClaudeUiNode)).toBeUndefined()
})

// Expected cuts come from pinned 2.1.302 Ku/rqt exports, not per-line slicing.
it.each([
  ['abcdefghij\nXY', 'abcdef…', '…ghij\nXY', 'abc…j\nXY'],
  ['ab\ncdefghij', 'ab\ncdef…', '…efghij', 'ab\nc…hij'],
  ['אבגדהוזחטי\nAB', 'אבגדהו…', '…זחטי\nAB', 'אבג…י\nAB'],
  ['ABC אבגדהוזחטי XYZ', 'ABC אב…', '…טי XYZ', 'ABC…XYZ'],
])('uses logical advance when truncating %s', (text, end, start, middle) => {
  const measure = (a: number, b: number) => text.slice(a, b).replaceAll('\n', '').length
  expect(clipped(text, 7, 'truncate-end', measure)).toBe(end)
  expect(clipped(text, 7, 'truncate-start', measure)).toBe(start)
  expect(clipped(text, 7, 'middle', measure)).toBe(middle)
})
it('keeps multiline text when its widest line fits, despite larger total advance', () => {
  const text = 'abcd\nefghij'
  expect(clipped(text, 7, 'truncate-end', (a, b) => text.slice(a, b).replaceAll('\n', '').length)).toBe(text)
})
it.each(['truncate-end', 'truncate-start', 'middle'] as const)('keeps the ellipsis-only boundary with leading/trailing newlines: %s', mode => {
  const text = '\nabc\n'
  expect(clipped(text, 1, mode, (a, b) => text.slice(a, b).replaceAll('\n', '').length)).toBe('…')
})
