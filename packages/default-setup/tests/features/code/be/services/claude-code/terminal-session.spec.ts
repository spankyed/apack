import { describe, expect, it } from 'vitest'
import { parseClaudeNativeContinuation } from '../../../../../../src/features/code/be/services/claude-code/terminal-session.ts'
const sessionId = '24be904a-3c35-4981-9793-cbe7a6c19d46'
const row = { type: 'continued-in', timestamp: '2026-10-29T12:13:13.909Z', sessionId, continuedInSessionId: '05ff1d31-597d-4537-8737-4407191add6e' }
describe('native durable continuation identity', () => {
  it('preserves distinct original and continued session identities from an observed journal row', () => {
    expect(parseClaudeNativeContinuation(row, sessionId)).toEqual({ sessionId, continuedInSessionId: row.continuedInSessionId, timestamp: row.timestamp })
  })
  it.each([null, [], {}, { ...row, type: 'user' }, { ...row, sessionId: row.continuedInSessionId },
    { ...row, continuedInSessionId: sessionId }, { ...row, continuedInSessionId: sessionId.toUpperCase() },
    { ...row, continuedInSessionId: '../other' }, { ...row, continuedInSessionId: undefined },
    { ...row, timestamp: 'invalid' }, { ...row, timestamp: 123 }])('rejects foreign, self-referential or malformed continuation %#', value => {
    expect(parseClaudeNativeContinuation(value, sessionId)).toBeUndefined()
  })
})
