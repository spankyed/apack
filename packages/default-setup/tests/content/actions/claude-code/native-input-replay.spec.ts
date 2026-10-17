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
