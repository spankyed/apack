import vm from 'node:vm'
import { stripVTControlCharacters } from 'node:util'
import { claudeTerminalTaskRuntime } from '#features/code/be/services/claude-code/terminal-task-runtime.ts'
import { ClaudeNativeTaskResultSchema } from '#features/code/be/services/claude-code/terminal-tasks.ts'
import { createClaudeTerminalStatus } from '#features/code/be/services/claude-code/terminal-status.ts'

function fixture() {
  let task = { id: 'shell-a', type: 'local_bash', status: 'running', isBackgrounded: true, elsewhere: false, description: 'Review output', command: 'review --check', cwd: '/owned/project' }
  const registry = { all: () => ({ [task.id]: task }), get: (id: string) => id === task.id ? task : undefined }
  const read = vi.fn(async () => ({ content: '\x1b[31mResult\x1b[0m\n\x1b]8;;https://example.test\x07details\x1b]8;;\x07', bytesRead: 80, bytesTotal: 12000 }))
  const stop = vi.fn(async () => {})
  const n = { taskOutput: { X8e: read }, taskOutputText: { stripVTControlCharacters }, taskControls: { gAe: stop }, runtime: { flt: () => undefined } }
  const context = { taskRegistry: registry, session: {}, storageV5: {}, getAppState: vi.fn(), setAppState: vi.fn() }
  const api = vm.runInNewContext(claudeTerminalTaskRuntime + ';({control:nativeTaskControl,list:nativeShellTasks})')
  const request = (operation = 'inspect', id = task.id) => api.control(n, { toolContext: () => context }, { operation, task_id: id }, {}, () => {})
  return { request, read, stop, list: () => api.list(registry), task, replace: () => { task = { ...task, command: 'replacement' } } }
}

it('keeps shell discovery and bounded native output separate from Agent conversations', async () => {
  const f = fixture()
  expect(f.list()).toEqual([{ id: 'shell-a', name: 'Review output', status: 'running', canStop: true }])
  const result = ClaudeNativeTaskResultSchema.parse(await f.request())
  expect(result.details?.shell).toEqual({ command: 'review --check', commandTruncated: false, cwd: '/owned/project', output: 'Result\ndetails', totalBytes: 12000, truncated: true })
  expect(result.details).toMatchObject({ canInput: false, canMessage: false, messages: [] })
  expect(f.read).toHaveBeenCalledWith('shell-a')
  await f.request('stop')
  expect(f.stop).toHaveBeenCalledWith('shell-a', expect.objectContaining({ source: 'user' }))
})

it('refuses foreign, foreground and ended stop targets without reading or invoking native stop', async () => {
  const f = fixture()
  await expect(f.request('inspect', 'foreign')).rejects.toThrow('no longer owned')
  f.task.elsewhere = true; expect(f.list()).toEqual([])
  await expect(f.request()).rejects.toThrow('not a background command')
  f.task.elsewhere = false; f.task.isBackgrounded = false
  await expect(f.request()).rejects.toThrow('not a background command')
  f.task.isBackgrounded = true; f.task.status = 'completed'
  await expect(f.request('stop')).rejects.toThrow('no longer running')
  await expect(f.request('foreground')).rejects.toThrow('inspection and Stop only')
  expect(f.read).not.toHaveBeenCalled(); expect(f.stop).not.toHaveBeenCalled()
})

it('refuses a completed output read after the registry record was replaced', async () => {
  const f = fixture()
  f.read.mockImplementationOnce(async () => { f.replace(); return { content: 'old output', bytesRead: 10, bytesTotal: 10 } })
  await expect(f.request()).rejects.toThrow('changed while reading output')
})

it('clears shell ownership at reset and rejects malformed or foreign updates without replacing valid rows', () => {
  const session = '11111111-1111-1111-1111-111111111111', state = createClaudeTerminalStatus(session)
  const rows = [{ id: 'shell-a', name: 'Check', status: 'running', canStop: true }]
  expect(state.updateShells(session, rows)).toBe(true)
  expect(state.tasks[0]).toMatchObject({ kind: 'shell', canStop: true })
  expect(state.updateShells('foreign', [])).toBe(false)
  expect(state.updateShells(session, [...rows, ...rows])).toBe(false)
  expect(state.tasks).toHaveLength(1)
  state.updateSession('22222222-2222-2222-2222-222222222222', [])
  expect(state.tasks).toEqual([])
  expect(state.updateShells(session, rows)).toBe(false)
})

it('does not partially publish valid Workflow changes from a rejected shell/activity snapshot', () => {
  const session = '11111111-1111-1111-1111-111111111111', state = createClaudeTerminalStatus(session)
  const workflow = { id:'workflow-a',name:'Review',status:'running',settled:false,canPause:true,canResume:false,canStop:true }
  expect(state.updateActivityTasks(session,[workflow],[])).toBe(true)
  expect(state.updateActivityTasks(session,[],[{id:'bad-shell'}])).toBe(false)
  expect(state.tasks).toEqual([{...workflow,kind:'workflow'}])
})
