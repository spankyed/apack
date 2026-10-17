import { projectClaudeInputReplay } from '../../../../src/content/actions/claude-code/_helpers/native-input-replay.ts'

it('projects accepted bare and multimodal text without losing image attachments', () => {
  expect(projectClaudeInputReplay('CHANGED', 'typed', 'typed')).toEqual({ text: 'CHANGED' })
  expect(projectClaudeInputReplay([{ type: 'text', text: 'CHANGED' }, { type: 'image', source: { data: 'private' } }], 'typed', 'typed')).toEqual({ text: 'CHANGED' })
})
it('keeps bootstrap/reference context out of the visible user row', () => {
  expect(projectClaudeInputReplay('Prior context\n\nCHANGED', 'typed', 'Prior context\n\ntyped')).toEqual({ text: 'CHANGED' })
  expect(projectClaudeInputReplay('MODIFIED CONTEXT\n\nCHANGED', 'typed', 'Prior context\n\ntyped')).toEqual({ claudeSubmittedText: 'MODIFIED CONTEXT\n\nCHANGED' })
})
it('leaves unchanged, absent and tool-result-only inputs alone', () => {
  expect(projectClaudeInputReplay('prefix typed', 'typed', 'prefix typed')).toEqual({})
  expect(projectClaudeInputReplay([{ type: 'tool_result', content: 'result' }], 'typed', 'typed')).toEqual({})
  expect(projectClaudeInputReplay(undefined, 'typed', 'typed')).toEqual({})
  expect(projectClaudeInputReplay('new', 'typed')).toEqual({})
})


it('retains an accepted native user identity and the visible text without inventing an origin stamp', () => {
  expect(projectClaudeInputReplay('typed', 'typed', 'typed', { uuid: 'native-user', sessionId: 'session' })).toEqual({
    claudeNativeUserMessage: { uuid: 'native-user', sessionId: 'session', text: 'typed', origin: { kind: 'unclassified' } },
  })
})
it('maps a safe bootstrap-preserving rewrite to the visible user row only', () => {
  expect(projectClaudeInputReplay('Private prefix\n\nChanged', 'typed', 'Private prefix\n\ntyped', { uuid: 'native-user', sessionId: 'session' })).toEqual({
    text: 'Changed', claudeNativeUserMessage: { uuid: 'native-user', sessionId: 'session', text: 'Changed', origin: { kind: 'unclassified' } },
  })
})
it('does not grant a user render identity when a rewritten bootstrap prevents a safe visible mapping', () => {
  expect(projectClaudeInputReplay('Changed private prefix\n\nChanged', 'typed', 'Private prefix\n\ntyped', { uuid: 'native-user', sessionId: 'session' })).toEqual({ claudeSubmittedText: 'Changed private prefix\n\nChanged' })
})
it('requires a real native session and UUID and ignores tool-result-only replay bodies', () => {
  for (const identity of [{ uuid: 'native-user' }, { uuid: {}, sessionId: 'session' }, { uuid: '', sessionId: 'session' }]) {
    expect(projectClaudeInputReplay('typed', 'typed', 'typed', identity)).toEqual({})
  }
  expect(projectClaudeInputReplay([{ type: 'tool_result', content: 'tool output' }], 'typed', 'typed', { uuid: 'tool-result-user', sessionId: 'session' })).toEqual({})
})
