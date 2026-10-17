import { claudeAssistantDisplayText, selectClaudeTranscriptRows } from '#features/code/be/services/claude-code/ui-transcript-rows.ts'
const row = (uuid: string, start = 0, text = 'Native text', apiMessageId = 'provider') => ({ uuid, sessionId: 'session', apiMessageId, text, start, end: start + text.length })
const message = (id: string, rows: ReturnType<typeof row>[], text = rows.map(value => value.text).join('\n')) => ({ id, sender: 'assistant', text, context: { claudeNativeMessages: rows } })
it('derives reply opening from all persisted native rows, including rows outside the mounted selection', () => {
  const messages = [message('app-a', [row('native-a')]), message('app-b', [row('native-b')]), message('app-c', [row('native-c', 0, 'Next', 'next-provider')])]
  expect(selectClaudeTranscriptRows(messages, 'session', new Set(['app-b', 'app-c']))).toEqual([
    { component: 'AssistantMessage', messageId: 'app-b', uuid: 'native-b', sessionId: 'session', text: 'Native text', start: 0, end: 11, isFirstOfReply: false },
    { component: 'AssistantMessage', messageId: 'app-c', uuid: 'native-c', sessionId: 'session', text: 'Next', start: 0, end: 4, isFirstOfReply: true },
  ])
})
it('rejects foreign sessions, stale text, overlaps, forged types and missing membership', () => {
  const valid = message('app', [row('a'), row('b', 12)], 'Native text\nNative text')
  expect(selectClaudeTranscriptRows([valid], 'session', new Set(['other']))).toEqual([])
  expect(selectClaudeTranscriptRows([valid], 'foreign', new Set(['app']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...valid, text: 'Edited transcript' }], 'session', new Set(['app']))).toEqual([])
  expect(selectClaudeTranscriptRows([message('app', [row('a'), row('b')], 'Native text')], 'session', new Set(['app']))).toHaveLength(1)
  expect(selectClaudeTranscriptRows([{ id: 'app', sender: 'assistant', text: 'Native text', context: { claudeNativeMessages: [null, { ...row('a'), start: '0' }] } }], 'session', new Set(['app']))).toEqual([])
})
it('rejects duplicate UUIDs across persisted messages rather than sharing native callback identity', () => {
  expect(selectClaudeTranscriptRows([message('app-a', [row('same')]), message('app-b', [row('same')])], 'session', new Set(['app-a', 'app-b']))).toEqual([])
})
it('keeps stored source intact while matching native context and memory-tag display filtering', () => {
  const source = '\n<context>Hidden\ncontext</context>\n<commit_analysis>Private</commit_analysis>\n<cc-memory filenames="a.md">Remembered text</cc-memory>\nVisible <contextual>literal</contextual>'
  expect(claudeAssistantDisplayText(source)).toBe('Remembered text\nVisible <contextual>literal</contextual>')
  expect(source).toContain('Hidden')
  expect(claudeAssistantDisplayText('<CC_MEMORY>Text</CC_MEMORY>')).toBe('Text')
  expect(claudeAssistantDisplayText('<cc-memory-other>Literal</cc-memory-other>')).toBe('<cc-memory-other>Literal</cc-memory-other>')
})


it('uses only accepted user provenance and the owning view expansion state', () => {
  const user = { id: 'app-user', sender: 'user', text: 'Typed prompt', context: { cliUuid: 'native-user', claudeNativeUserMessage: { uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', origin: { kind: 'unclassified' } } } }
  expect(selectClaudeTranscriptRows([user], 'session', new Set(['app-user']), new Map([['app-user', false]]))).toEqual([
    { component: 'UserMessage', messageId: 'app-user', uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', start: 0, end: 12, origin: { kind: 'unclassified' }, isExpanded: false },
  ])
  expect(selectClaudeTranscriptRows([user], 'session', new Set(['app-user']))[0]).toMatchObject({ isExpanded: true })
  expect(selectClaudeTranscriptRows([user], 'other-session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, status: 'queued' }], 'session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, text: 'Edited prompt' }], 'session', new Set(['app-user']))).toEqual([])
  expect(selectClaudeTranscriptRows([{ ...user, context: { ...user.context, claudeNativeUserMessage: { ...user.context.claudeNativeUserMessage, origin: { kind: 'composer' } } } }], 'session', new Set(['app-user']))).toEqual([])
})
