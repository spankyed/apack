import vm from 'node:vm'
import { claudeTerminalTaskRuntime } from '#features/code/be/services/claude-code/terminal-task-runtime.ts'
function fixture() {
  const tasks = [{ id: 'registry-a', agentId: 'agent-a', type: 'local_agent', status: 'running', description: 'Worker' }]
  const registry = { all: () => Object.fromEntries(tasks.map(task => [task.id, task])), getTranscript: vi.fn(() => ({ messages: [{ uuid: 'live', type: 'assistant', message: { content: [{ type: 'text', text: 'Live progress' }] } }] })) }
  const context = { taskRegistry: registry, session: {}, storageV5: {}, getAppState: vi.fn(), setAppState: vi.fn() }
  const stop = vi.fn(async () => {}), saved = vi.fn(async () => [{ uuid: 'saved', type: 'user', message: { content: 'Task instruction' } }, { uuid: 'hidden', type: 'user', isMeta: true, message: { content: 'Hidden context' } }])
  const run = vm.runInNewContext(claudeTerminalTaskRuntime + ';nativeTaskControl') as (n: unknown, binding: unknown, request: unknown, abort: unknown, current: () => void) => Promise<any>
  const request = (operation: string, id = 'agent-a', current: () => void = vi.fn()) => run({ runtime: { flt: (task: typeof tasks[number]) => ({ id: task.agentId }) }, taskControls: { gAe: stop } }, { toolContext: () => context, savedAgentMessages: saved }, { operation, task_id: id }, new AbortController(), current)
  return { tasks, registry, context, stop, saved, request }
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
