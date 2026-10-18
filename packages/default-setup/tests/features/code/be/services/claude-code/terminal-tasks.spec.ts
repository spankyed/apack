import vm from 'node:vm'
import { claudeTerminalTaskRuntime } from '#features/code/be/services/claude-code/terminal-task-runtime.ts'
function fixture() {
  const tasks = [{ id: 'registry-a', agentId: 'agent-a', type: 'local_agent', status: 'running', description: 'Worker' }]
  const registry = { all: () => Object.fromEntries(tasks.map(task => [task.id, task])), getTranscript: vi.fn(() => ({ messages: [{ uuid: 'live', type: 'assistant', message: { content: [{ type: 'text', text: 'Live progress' }] } }] })) }
  const context = { taskRegistry: registry, session: {}, storageV5: {}, getAppState: vi.fn(), setAppState: vi.fn() }
  const stop = vi.fn(async () => {}), saved = vi.fn(async () => [{ uuid: 'saved', type: 'user', message: { content: 'Task instruction' } }, { uuid: 'hidden', type: 'user', isMeta: true, message: { content: 'Hidden context' } }])
  const canUseTool = vi.fn(), tools = [{ name: 'SendMessage' }]
  let denied = false
  const message = vi.fn((value: unknown) => value)
  const runner = vi.fn(async function* (call: { id: string }, _assistant: unknown, _permission: unknown, _context: unknown, _clock: unknown) { yield { message: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: call.id, ...(denied ? { is_error: true, content: 'Native refusal' } : {}) }] }, toolUseResult: { success: !denied } } } })
  const run = vm.runInNewContext(claudeTerminalTaskRuntime + ';nativeTaskControl', { randomUUID: () => '12345678-1234-1234-1234-123456789abc' }) as (n: unknown, binding: unknown, request: unknown, abort: unknown, current: () => void) => Promise<any>
  const request = (operation: string, id = 'agent-a', current: () => void = vi.fn(), text = 'User instruction') => run({ runtime: { Z2: runner, _d: message, flt: (task: typeof tasks[number]) => ({ id: task.agentId }) }, taskControls: { gAe: stop } }, { tools: () => tools, canUseTool, toolContext: () => context, savedAgentMessages: saved }, { operation, task_id: id, text }, new AbortController(), current)
  return { tasks, registry, context, stop, saved, request, runner, message, canUseTool, tools, refuse() { denied = true } }
}
it('stops the exact native registry task through the original user-stop callback', async () => {
  const f = fixture(); expect(await f.request('stop')).toEqual({ stopped: true })
  expect(f.stop).toHaveBeenCalledExactlyOnceWith('registry-a', { taskRegistry: f.registry, session: f.context.session, storageV5: f.context.storageV5, getAppState: f.context.getAppState, setAppState: f.context.setAppState, source: 'user' })
})
it('rejects foreign and ambiguous task identities before any native operation', async () => {
  const f = fixture(); await expect(f.request('stop', 'foreign')).rejects.toThrow('no longer owned')
  f.tasks.push({ ...f.tasks[0], id: 'registry-b' }); await expect(f.request('stop')).rejects.toThrow('no longer owned')
  expect(f.stop).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled()
})
it('reads original saved and live Agent messages without exposing hidden context or stopping work', async () => {
  const f = fixture(); const result = await f.request('inspect')
  expect(result.details.messages).toEqual([{ role: 'user', text: 'Task instruction' }, { role: 'assistant', text: 'Live progress' }])
  expect(f.registry.getTranscript).toHaveBeenCalledWith('registry-a'); expect(f.saved).toHaveBeenCalledWith('agent-a'); expect(f.stop).not.toHaveBeenCalled()
})
it('refuses a reply when its native session expires during transcript loading', async () => {
  const f = fixture(); let calls = 0
  await expect(f.request('inspect', 'agent-a', () => { if (++calls > 1) throw new Error('Session changed') })).rejects.toThrow('Session changed')
})

it('uses the original permission-aware runner and confirms only its structured send result', async () => {
  const f = fixture(); expect(await f.request('send')).toEqual({ sent: true })
  expect(f.runner.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'SendMessage', input: { to: 'agent-a', message: 'User instruction' } }))
  expect(f.runner.mock.calls[0][2]).toBe(f.canUseTool)
  expect(f.message).toHaveBeenCalledWith(expect.objectContaining({ isVirtual: true }))
  expect(f.stop).not.toHaveBeenCalled()
})
it('preserves native messaging refusal and refuses empty, oversized or unavailable sends', async () => {
  const f = fixture(); f.refuse(); await expect(f.request('send')).rejects.toThrow('Native refusal')
  f.runner.mockClear(); await expect(f.request('send', 'agent-a', vi.fn(), ' ')).rejects.toThrow('1 to 16384')
  await expect(f.request('send', 'agent-a', vi.fn(), 'x'.repeat(16385))).rejects.toThrow('1 to 16384')
  f.tools.length = 0; await expect(f.request('send')).rejects.toThrow('not available')
  expect(f.runner).not.toHaveBeenCalled()
})
