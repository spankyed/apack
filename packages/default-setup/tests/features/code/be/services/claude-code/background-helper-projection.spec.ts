import { createClaudeBackgroundHelperProjection } from '#features/code/be/services/claude-code/background-helper-projection.ts'

const sessionId = '05ff1d31-597d-4537-8737-4407191add6e'
const scope = { sessionId, pid: 119, generation: 'epoch-a', policyKey: '[false,false,false]', command: 'native-helper', agents: [{ id: 'reviewer', type: 'general-purpose', status: 'running' }] }
const output = { sessionId, parentPid: 119, generation: 'epoch-a', policyKey: scope.policyKey, command: scope.command, kind: 'subagent', startedAt: '10', code: 0, truncated: false, tasks: [{ id: 'reviewer', status: 'running' }], stdout: JSON.stringify({ id: 'reviewer', content: 'Release review' }) }

it('decorates only an admitted original task and refuses foreign worker, command and policy output', () => {
  const state = createClaudeBackgroundHelperProjection()
  expect(state.configure(scope)).toBe(true)
  expect(state.accept(output)).toBe(true)
  expect(state.tasks[0]?.statusText).toBe('Release review')
  for (const patch of [{ sessionId: 'foreign' }, { parentPid: 120 }, { generation: 'old' }, { command: 'other' }, { policyKey: '[true,false,false]' }, { kind: 'main' }]) {
    expect(state.accept({ ...output, ...patch, startedAt: '11' })).toBe(false)
  }
  expect(state.tasks[0]?.statusText).toBe('Release review')
  expect(state.accept(output)).toBe(false)
})

it('withdraws captions across disable/restore even if the configured command returns unchanged', () => {
  const state = createClaudeBackgroundHelperProjection()
  state.configure(scope); state.accept(output)
  state.configure({ ...scope, generation: 'disabled', command: null, policyKey: '[true,false,false]' })
  expect(state.tasks[0]?.statusText).toBeUndefined()
  expect(state.accept(output)).toBe(false)
  state.configure({ ...scope, generation: 'restored' })
  expect(state.accept(output)).toBe(false)
  expect(state.accept({ ...output, generation: 'restored', startedAt: '11' })).toBe(true)
  expect(state.tasks[0]?.statusText).toBe('Release review')
})

it('retires task captions on status change, removal and owner disposal', () => {
  const state = createClaudeBackgroundHelperProjection()
  state.configure(scope); state.accept(output)
  state.configure({ ...scope, agents: [{ ...scope.agents[0]!, status: 'completed' }] })
  expect(state.tasks[0]?.statusText).toBeUndefined()
  state.configure({ ...scope, agents: [] })
  expect(state.tasks).toEqual([])
  state.clear()
  expect(state.accept({ ...output, startedAt: '12' })).toBe(false)
})

it('clears successful text after a newer failed helper and refuses its late predecessor', () => {
  const state = createClaudeBackgroundHelperProjection()
  state.configure(scope); state.accept(output)
  expect(state.accept({ ...output, startedAt: '12', code: 7 })).toBe(true)
  expect(state.tasks[0]?.statusText).toBeUndefined()
  expect(state.accept({ ...output, startedAt: '11' })).toBe(false)
  expect(state.tasks[0]?.statusText).toBeUndefined()
})
