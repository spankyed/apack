import { selectClaudeFocusMessages } from '#features/threads/fe/chat/native-focus-messages.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'
const owner = (): ClaudeNativeTerminalState => ({ ownerId: 'owner', sessionId: 'session', cwd: '/', status: 'live', busy: false, tasks: [], view: { kind: 'main', revision: 2 }, focus: { sessionId: 'session', viewRevision: 2, producerId: 'native-renderer', active: true, hidden: ['hidden'] } })
it('hides only acknowledged canonical native identities and restores the same history objects', () => {
  const hidden = { context: { cliUuid: 'hidden', claudeTerminalMessage: { sessionId: 'session', uuid: 'hidden' } } }, foreign = { context: { cliUuid: 'hidden', claudeTerminalMessage: { sessionId: 'foreign', uuid: 'hidden' } } }, forged = { context: { cliUuid: 'different', claudeTerminalMessage: { sessionId: 'session', uuid: 'hidden' } } }, host = { context: {} }
  const messages = [hidden, foreign, forged, host], state = owner()
  expect(selectClaudeFocusMessages(messages, state)).toEqual([foreign, forged, host])
  state.focus!.active = false
  expect(selectClaudeFocusMessages(messages, state)).toEqual(messages)
  expect(selectClaudeFocusMessages(messages, state)[0]).toBe(hidden)
})
it.each(['view', 'session', 'exit'])('refuses stale focus after %s change', change => {
  const message = { context: { cliUuid: 'hidden', claudeTerminalMessage: { sessionId: 'session', uuid: 'hidden' } } }, state = owner()
  if (change === 'view') state.view = { kind: 'main', revision: 3 }
  if (change === 'session') state.sessionId = 'replacement'
  if (change === 'exit') state.status = 'exited'
  expect(selectClaudeFocusMessages([message], state)).toEqual([message])
})
