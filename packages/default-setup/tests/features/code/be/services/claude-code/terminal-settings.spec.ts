import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsRuntime } from '#features/code/be/services/claude-code/terminal-settings-runtime.ts'

function fixture() {
  let value = false
  const writer = vi.fn(async (next: boolean) => { value = next })
  const context = {}, entry = { context, kind: 'panel', commandName: 'config', clientId: 'client', closed: false, answered: false, current: vi.fn(), dialogId: 'dialog', nodeId: 'node', store: { getState: () => ({ open: [{ id: 'dialog', kind: 'local_jsx', payload: { nodeId: 'node' } }] }) }, done: new Promise(() => {}) }
  const handles = () => [{ row: { key: 'tips', label: 'Show tips', kind: 'boolean', value, isLocked: false }, write: writer }, { row: { key: 'hidden', label: 'Hidden', kind: 'boolean', value: false, isLocked: false }, write: vi.fn() }]
  const api = { configRowHandles: vi.fn(handles) }
  const commit = vi.fn(async (request: any) => { await request.write(request.value); return { value: request.value } })
  const n = { gate: { _Jo: vi.fn() }, runtime: { p_r: vi.fn(async (row: any) => row.key === 'hidden' ? undefined : row), Ims: commit } }
  const source = claudeTerminalSettingsRuntime.replace("await import('/$bunfs/root/chunk-1ghyy712.js')", 'nativeSettingsApi')
  const run = vm.runInNewContext(source + ';nativeSettings', { nativeSettingsApi: api, agentCommandDialogs: new Map([['panel', entry]]), createHash, AbortController })
  const request = { client_id: 'client', panel_id: 'panel' }
  return { n, entry, writer, commit, request, read: () => run(n, { ...request, operation: 'read' }, new AbortController()), run }
}
it('uses original description visibility and config.set coordinator instead of writing directly', async () => {
  const f = fixture(), before = await f.read()
  expect(before.snapshot.rows.map((row: any) => row.key)).toEqual(['tips'])
  expect(f.writer).not.toHaveBeenCalled()
  const result = await f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  expect(f.commit).toHaveBeenCalledOnce()
  expect(f.writer).toHaveBeenCalledExactlyOnceWith(true)
  expect(result.savedKey).toBe('tips'); expect(result.snapshot.rows[0].value).toBe(true)
})
it('preserves native denial and refuses a stale snapshot before invoking the coordinator', async () => {
  const f = fixture(), before = await f.read()
  await expect(f.run(f.n, { ...f.request, operation: 'write', revision: 'old', key: 'tips', value: true }, new AbortController())).rejects.toThrow('changed')
  expect(f.commit).not.toHaveBeenCalled()
  f.commit.mockImplementationOnce(async () => ({ deny: 'Managed by original policy' }) as any)
  const result = await f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  expect(result.problem).toBe('Managed by original policy'); expect(result.savedKey).toBeUndefined(); expect(f.writer).not.toHaveBeenCalled()
})
it('refuses a native hook-held write after its panel closes', async () => {
  const f = fixture(), before = await f.read()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  f.commit.mockImplementationOnce(async request => { await held; await request.write(request.value); return { value: request.value } })
  const result = f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  await vi.waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
  f.entry.closed = true; release()
  await expect(result).rejects.toThrow('expired'); expect(f.writer).not.toHaveBeenCalled()
})
