import { encodeClaudeDocument, decodeClaudeDocument } from '#features/code/common/native-document-codec.ts'
it('round-trips native paint, hyperlinks, Unicode and literal token text exactly', () => {
  const text = '\x1b[38;2;12;34;56m~0; literal ~~ Ω😀\x1b[39m\n\x1b]8;;https://example.com/~page\x07link\x1b]8;;\x07'
  expect(decodeClaudeDocument(encodeClaudeDocument(text))).toBe(text)
  const large = ('\x1b[38;2;12;34;56mvalue\x1b[39m\n').repeat(2000)
  expect(JSON.stringify(encodeClaudeDocument(large)).length).toBeLessThan(JSON.stringify(large).length / 2)
  expect(decodeClaudeDocument(encodeClaudeDocument(large))).toBe(large)
})
it('rejects malformed dictionaries, foreign references and excessive decoded expansion', () => {
  for (const value of [{body:'~',codes:['\x1b[0m']},{body:'~0;',codes:[]},{body:'~!',codes:[]},{body:'~0;',codes:['untrusted text']},{body:'x',codes:Array(257).fill('\x1b[0m')}]) expect(() => decodeClaudeDocument(value)).toThrow()
  expect(() => decodeClaudeDocument({body:'~0;'.repeat(400),codes:['\x1b]8;;'+ 'x'.repeat(4000)+'\x07']})).toThrow('exceeds limit')
})
