import { claudeCodeDiffRows } from '#features/threads/fe/chat/native-code-diff.ts'

it('keeps multiple file and hunk numbering independent and skips no-newline annotations', () => {
  const source = '--- a/a\n+++ b/a\n@@ -9 +12 @@\n-old\n+new\n\\ No newline at end of file\n@@ -19,0 +24,1 @@\n+extra\n--- a/b\n+++ b/b\n@@ -100,1 +0,0 @@\n-gone\n'
  const rows = claudeCodeDiffRows(source)!
  expect(rows.filter(row => row.kind === 'hunk')).toHaveLength(3)
  expect(rows.filter(row => row.kind === 'add')).toEqual([
    { kind: 'add', text: 'new', newLine: 12 }, { kind: 'add', text: 'extra', newLine: 24 },
  ])
  expect(rows.at(-1)).toEqual({ kind: 'remove', text: 'gone', oldLine: 100 })
  expect(rows.some(row => row.text.includes('No newline'))).toBe(false)
})

it('preserves raw line content instead of silently normalizing carriage returns', () => {
  expect(claudeCodeDiffRows('@@ -1,2 +1,2 @@\r\n \r\n-same\r\n+changed\r\n')?.slice(1)).toEqual([
    { kind: 'context', text: '\r', oldLine: 1, newLine: 1 },
    { kind: 'remove', text: 'same\r', oldLine: 2 },
    { kind: 'add', text: 'changed\r', newLine: 2 },
  ])
})

it.each([
  'plain code',
  '@@ -1,2 +1,2 @@\n-one\n+two',
  '@@ -1000000001,1 +1,1 @@\n-a\n+b\n',
  '@@ -1,1 +1,1 @@\n-a\n+b\n@@ invalid @@\n',
])('falls back for invalid or incomplete hunks: %s', source => {
  expect(claudeCodeDiffRows(source)).toBeUndefined()
})
