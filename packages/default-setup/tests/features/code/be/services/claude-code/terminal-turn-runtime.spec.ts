import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '../../../../../../src/features/code/be/services/claude-code/terminal-ui-runtime.ts'

function setup() {
  const start = claudeTerminalUiRuntime.indexOf('function nativeTurnControl('), end = claudeTerminalUiRuntime.indexOf('// Keep remote edit state', start)
  const control = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';nativeTurnControl')
  const cancel = vi.fn(), turn = { turnId: 'turn-one', cancelled: () => false, cancel }
  const state = { current: turn as typeof turn | undefined }, n = { runtime: { lpe: () => state.current } }
  const invoke = (request: Record<string, unknown>, signal = new AbortController().signal) => control(n, request, signal, 'session-one')
  return { invoke, cancel, state, turn }
}
it('reads and cancels only the original active turn', () => {
  const f = setup()
  expect(f.invoke({ subtype: 'apack_turn_state', session_id: 'session-one' })).toEqual({ turn: { id: 'turn-one', cancelled: false } })
  expect(f.invoke({ subtype: 'apack_abort_turn', session_id: 'session-one', turn_id: 'turn-one' })).toEqual({ cancelled: true })
  expect(f.cancel).toHaveBeenCalledOnce()
})
it('refuses an addressed old turn after replacement', () => {
  const f = setup(); f.state.current = { ...f.turn, turnId: 'turn-two' }
  expect(() => f.invoke({ subtype: 'apack_abort_turn', session_id: 'session-one', turn_id: 'turn-one' })).toThrow('Native turn changed or ended')
  expect(f.cancel).not.toHaveBeenCalled()
})
it('refuses a foreign session and a retired request without cancellation', () => {
  const f = setup()
  expect(() => f.invoke({ subtype: 'apack_abort_turn', session_id: 'foreign', turn_id: 'turn-one' })).toThrow('Native turn session changed')
  const abort = new AbortController(); abort.abort()
  expect(() => f.invoke({ subtype: 'apack_abort_turn', session_id: 'session-one', turn_id: 'turn-one' }, abort.signal)).toThrow()
  expect(f.cancel).not.toHaveBeenCalled()
})
it('does not cancel an ending turn twice', () => {
  const f = setup(); f.state.current = { ...f.turn, cancelled: () => true }
  expect(f.invoke({ subtype: 'apack_abort_turn', session_id: 'session-one', turn_id: 'turn-one' })).toEqual({ cancelled: false, ending: true })
  expect(f.cancel).not.toHaveBeenCalled()
})
it('reports idle without inventing a turn and rejects an old cancellation', () => {
  const f = setup(); f.state.current = undefined
  expect(f.invoke({ subtype: 'apack_turn_state', session_id: 'session-one' })).toEqual({ turn: null })
  expect(() => f.invoke({ subtype: 'apack_abort_turn', session_id: 'session-one', turn_id: 'turn-one' })).toThrow('Native turn changed or ended')
  expect(f.cancel).not.toHaveBeenCalled()
})
