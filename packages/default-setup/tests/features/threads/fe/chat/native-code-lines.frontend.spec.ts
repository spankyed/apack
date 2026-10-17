import { claudeCodeLines, claudeCodeDiffLines } from '#features/threads/fe/chat/native-code-lines.ts'

const texts = (lines: ReturnType<typeof claudeCodeLines>) => lines.map(line => line.map(token => token.text).join('')).join('\n')
it('preserves tabs, blank/trailing rows, literal markup and multiline comment state', () => {
  const source = '/* start\n\t<script>literal</script>\nend */\n\nconst value = "ok";\n'
  const lines = claudeCodeLines(source, 'typescript')
  expect(texts(lines)).toBe(source)
  expect(lines[1].every(token => token.classes.includes('hljs-comment'))).toBe(true)
  expect(lines[4].some(token => token.classes.includes('hljs-keyword'))).toBe(true)
  expect(lines).toHaveLength(6)
})
it('keeps unknown explicit languages plain instead of guessing from the path', () => {
  const source = '<img onerror="bad()">'
  const lines = claudeCodeLines(source, 'unavailable-plugin-grammar', '/secret/file.html')
  expect(texts(lines)).toBe(source)
  expect(lines.flat().every(token => !token.classes.length)).toBe(true)
})
it.each([
  ['/secret/file.ts', 'const value = true'],
  ['/secret/Dockerfile', 'FROM alpine'],
  [undefined, '#!/usr/bin/env python3\nprint(True)'],
])('infers a known language without reading the file: %s', (path, source) => {
  const lines = claudeCodeLines(source, undefined, path)
  expect(texts(lines)).toBe(source)
  expect(lines.flat().some(token => token.classes.length > 0)).toBe(true)
})

it('does not let a removed open comment suppress highlighting on the new side', () => {
  const rows = claudeCodeDiffLines([
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { kind: 'remove', text: '/* removed open comment', oldLine: 1 },
    { kind: 'add', text: 'const added = true;', newLine: 1 },
    { kind: 'context', text: 'const kept = true;', oldLine: 2, newLine: 2 },
  ], 'typescript')
  expect(rows[1].some(token => token.classes.includes('hljs-comment'))).toBe(true)
  expect(rows[2].some(token => token.classes.includes('hljs-keyword'))).toBe(true)
  expect(rows[3].some(token => token.classes.includes('hljs-keyword'))).toBe(true)
})
