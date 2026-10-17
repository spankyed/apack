import { claudeAssistantDisplayText, selectClaudeAssistantRows } from '#features/code/be/services/claude-code/ui-assistant-rows.ts'
const row = (uuid: string, start = 0, text = 'Native text', apiMessageId = 'provider') => ({ uuid, sessionId: 'session', apiMessageId, text, start, end: start + text.length })
const message = (id: string, rows: ReturnType<typeof row>[], text = rows.map(value => value.text).join('\n')) => ({ id, sender: 'assistant', text, context: { claudeNativeMessages: rows } })
it('derives reply opening from all persisted native rows, including rows outside the mounted selection', () => {
  const messages = [message('app-a', [row('native-a')]), message('app-b', [row('native-b')]), message('app-c', [row('native-c', 0, 'Next', 'next-provider')])]
  expect(selectClaudeAssistantRows(messages, 'session', new Set(['app-b', 'app-c']))).toEqual([
    { messageId: 'app-b', uuid: 'native-b', sessionId: 'session', text: 'Native text', start: 0, end: 11, isFirstOfReply: false },
    { messageId: 'app-c', uuid: 'native-c', sessionId: 'session', text: 'Next', start: 0, end: 4, isFirstOfReply: true },
  ])
})
it('rejects foreign sessions, stale text, overlaps, forged types and missing membership', () => {
  const valid = message('app', [row('a'), row('b', 12)], 'Native text\nNative text')
  expect(selectClaudeAssistantRows([valid], 'session', new Set(['other']))).toEqual([])
  expect(selectClaudeAssistantRows([valid], 'foreign', new Set(['app']))).toEqual([])
  expect(selectClaudeAssistantRows([{ ...valid, text: 'Edited transcript' }], 'session', new Set(['app']))).toEqual([])
  expect(selectClaudeAssistantRows([message('app', [row('a'), row('b')], 'Native text')], 'session', new Set(['app']))).toHaveLength(1)
  expect(selectClaudeAssistantRows([{ id: 'app', sender: 'assistant', text: 'Native text', context: { claudeNativeMessages: [null, { ...row('a'), start: '0' }] } }], 'session', new Set(['app']))).toEqual([])
})
it('rejects duplicate UUIDs across persisted messages rather than sharing native callback identity', () => {
  expect(selectClaudeAssistantRows([message('app-a', [row('same')]), message('app-b', [row('same')])], 'session', new Set(['app-a', 'app-b']))).toEqual([])
})
it('keeps stored source intact while matching native context and memory-tag display filtering', () => {
  const source = '\n<context>Hidden\ncontext</context>\n<commit_analysis>Private</commit_analysis>\n<cc-memory filenames="a.md">Remembered text</cc-memory>\nVisible <contextual>literal</contextual>'
  expect(claudeAssistantDisplayText(source)).toBe('Remembered text\nVisible <contextual>literal</contextual>')
  expect(source).toContain('Hidden')
  expect(claudeAssistantDisplayText('<CC_MEMORY>Text</CC_MEMORY>')).toBe('Text')
  expect(claudeAssistantDisplayText('<cc-memory-other>Literal</cc-memory-other>')).toBe('<cc-memory-other>Literal</cc-memory-other>')
})
