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

it('retains structured plan-reset continuations without calling them human composer inputs', () => {
  const continuation = { ...row, type: 'user', origin: { kind: 'auto-continuation' }, planContent: '# Approved plan', queueSkipAttachments: true, message: { role: 'user', content: 'Implement the following plan:\n\n# Approved plan' } }
  const projected = projectClaudeTerminalHistory({ sessionId, row: continuation })!
  expect(projected.text).toBe(continuation.message.content)
  expect(projected.context).toMatchObject({ cliUuid: uuid, claudePlanContinuation: true, claudeTerminalMessage: { origin: continuation.origin } })
  expect(projected.context.claudeNativeUserMessage).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...continuation, planContent: undefined } })).toBeUndefined()
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...continuation, isMeta: true } })).toBeUndefined()
})


it('shows original command envelopes as commands/results without claiming human or assistant model provenance', () => {
  const command = { ...row, type: 'user', entrypoint: 'cli', message: { content: '<command-name>/compact</command-name>\n  <command-message>compact</command-message>\n  <command-args>Keep &lt;api&gt; &amp; tests</command-args>' } }
  const invocation = projectClaudeTerminalHistory({ sessionId, row: command })!
  expect(invocation).toMatchObject({ uuid, sessionId, sender: 'user', text: '/compact Keep <api> & tests' })
  expect(invocation.context.claudeNativeCommand).toMatchObject({ kind: 'invocation', name: '/compact' })
  expect(invocation.context.claudeNativeUserMessage).toBeUndefined()
  for (const stream of ['stdout', 'stderr']) {
    const output = projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: `<local-command-${stream}>\u001b[2mDone &amp; &lt;ready&gt;\u001b[22m</local-command-${stream}>` } } })!
    expect(output).toMatchObject({ uuid, sessionId, sender: 'assistant', text: 'Done & <ready>' })
    expect(output.context.claudeNativeCommand).toMatchObject({ kind: 'output', stream })
    expect(output.context.claudeNativeUserMessage).toBeUndefined(); expect(output.context.claudeNativeMessages).toBeUndefined()
  }
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...command, message: { content: '<local-command-stdout> </local-command-stdout>' } } })).toBeUndefined()
})
it('keeps quoted, malformed, mixed-media and genuinely human command-like markup literal', () => {
  for (const text of ['Explain <local-command-stdout>text</local-command-stdout>', '<local-command-stdout>missing end', '<local-command-stdout>text</local-command-stderr>', '<command-name>/compact</command-name>']) {
    expect(projectClaudeTerminalHistory({ sessionId, row: { ...row, type: 'user', entrypoint: 'cli', message: { content: text } } })?.text).toBe(text)
  }
  const text = '<local-command-stdout>&amp;lt; literal</local-command-stdout>'
  const base = { ...row, type: 'user', entrypoint: 'cli', message: { content: text } }
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...base, origin: { kind: 'human' } } })?.text).toBe(text)
  expect(projectClaudeTerminalHistory({ sessionId, row: base })?.text).toBe('&lt; literal')
  expect(projectClaudeTerminalHistory({ sessionId, row: { ...base, message: { content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] } } })?.text).toBe(text)
})
