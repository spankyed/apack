import { projectClaudeTerminalHistory } from '#features/threads/be/claude-terminal-history.ts'
const sessionId = '11111111-1111-1111-1111-111111111111', uuid = '22222222-2222-2222-2222-222222222222'
const row = { sessionId, uuid, type: 'assistant', message: { id: 'api', role: 'assistant', content: [{ type: 'text', text: ' Actual native text ' }] } }
it('retains exact native text and groups display rows by the real API identity', () => {
  const value = projectClaudeTerminalHistory({ sessionId, row })!
  expect(value.text).toBe(' Actual native text ')
  expect(value.context.claudeNativeMessages).toEqual([{ sessionId, uuid, apiMessageId: 'api', text: value.text, start: 0, end: value.text.length }])
  const summary = projectClaudeTerminalHistory({ sessionId, row: { ...row, isSummary: true } })!
  expect(summary.text).toBe(''); expect(summary.blocks[0]?.type).toBe('thinking')
  expect(summary.blocks[0]?.props.nativeMessages[0]).toMatchObject({ uuid, sessionId, isSummary: true })
})
it('excludes child, metadata and tool-result rows from the visible user history', () => {
  for (const extra of [{ isSidechain: true }, { agentId: 'child' }, { isMeta: true }, { parent_tool_use_id: 'tool' }, { type: 'user', origin: { kind: 'task-notification' } }]) expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, ...extra } })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'Result' }] } } })).toBeUndefined()
})
it('preserves native image bytes as image references without treating non-image media as URLs', () => {
  const value = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] } } })!
  expect(value.references?.images).toEqual([{ name: 'Native image', url: 'data:image/png;base64,YWJj' }])
})

it('uses native human provenance for composer rows and never guesses it for unstamped SDK rows', () => {
  const human = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', origin: { kind: 'human' } } })!
  expect(human.context.claudeNativeUserMessage).toMatchObject({ origin: { kind: 'composer' } })
  const unstamped = projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user' } })!
  expect(unstamped.context.claudeNativeUserMessage).toMatchObject({ origin: { kind: 'unclassified' } })
})
