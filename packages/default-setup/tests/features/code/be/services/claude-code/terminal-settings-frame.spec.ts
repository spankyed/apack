import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsFrameRuntime } from '#features/code/be/services/claude-code/terminal-settings-frame-runtime.ts'

function fixture() {
  const onClose = () => {}, originalProps = { onClose, credentials: {}, messages: [] }
  const Frame = () => {}, Status = () => {}, Tabs = () => {}
  const rows = { type: Status, memoizedProps: { accountStatusRead: {}, machineStatusRead: {} } }
  const panel = { title: 'Settings', selectedTab: 'Status', hidden: false, onTabChange: vi.fn(), children: ['Status', 'Config', 'Usage', 'Stats'].map(title => ({ props: { title } })) }
  const owner = { type: Frame, memoizedProps: originalProps, child: { type: Tabs, memoizedProps: panel, child: rows } }
  const hashes = new WeakMap<Function, string>([[Frame, '8a56a17e7c83ad4879b026f7d8498fb45fea80c549f97547bcfdb4ef3b9725ee'], [Status, '8c89bb757b28a8a05a69fdc7d3beebb9b5bd02e74fc0bf54a238dc7b1921cf29']])
  const root: any = { child: owner }
  const entry = { originalProps, current: vi.fn(), closed: false, answered: false }
  const api = vm.runInNewContext(claudeTerminalSettingsFrameRuntime + ';({nativeSettingsFrame,readNativeSettingsFrame,selectNativeSettingsTab})', { process, createHash, composerFunctionHashes: hashes, setTimeout, nativeGenericPermissionText: async (_n: unknown, value: unknown) => String(value) })
  const n = { themeRoots: { ai: () => new Map([[process.stdout, { container: { current: root } }]]) } }
  return { run: () => api.nativeSettingsFrame(n, entry), read: (signal?: AbortSignal) => api.readNativeSettingsFrame(n, entry, signal), select: (tab: string, signal?: AbortSignal) => api.selectNativeSettingsTab(n, entry, tab, signal), root, owner, rows, panel, entry, hashes, Status }
}
it('correlates the owned dialog and excludes a sibling dialog from its data', () => {
  const f = fixture()
  ;(f.owner as any).sibling = { type: f.Status, memoizedProps: f.rows.memoizedProps }
  expect(f.run().status).toBe(f.rows)
  expect(f.run().panel).toBe(f.panel)
})
it('refuses changed producers and duplicate matching owners', () => {
  const f = fixture(); f.hashes.set(f.Status, 'unknown')
  expect(f.run).toThrow('producer changed')
  const g = fixture(); (g.owner as any).sibling = { ...g.owner }
  expect(g.run).toThrow('not uniquely mounted')
})
it('refuses retired ownership and changed native tab contracts', () => {
  const f = fixture(); f.entry.closed = true
  expect(f.run).toThrow('expired')
  const g = fixture(); g.panel.children.pop()
  expect(g.run).toThrow('tab contract changed')
})

it('publishes native structured Status labels and values without serializing private props', async () => {
  const f = fixture(), cache = Array(17).fill(null)
  cache[10] = [[{ label: 'Version', value: '2.1.302' }]]
  ;(f.rows as any).updateQueue = { memoCache: { data: [cache] } }
  const frame = await f.read()
  expect(frame.status).toEqual([[{ label: 'Version', value: '2.1.302' }]])
  expect(frame).not.toHaveProperty('credentials')
  expect(frame.selectedTab).toBe('Status')
})
it('uses the original tab callback and rejects hidden, invalid and cancelled selections', async () => {
  const f = fixture()
  f.panel.onTabChange.mockImplementation(tab => { f.panel.selectedTab = tab })
  await f.select('Config')
  expect(f.panel.onTabChange).toHaveBeenCalledExactlyOnceWith('Config')
  f.panel.hidden = true
  await expect(f.select('Stats')).rejects.toThrow('unavailable')
  f.panel.hidden = false
  await expect(f.select('Invented')).rejects.toThrow('unavailable')
  const cancelled = new AbortController(); cancelled.abort()
  await expect(f.select('Usage', cancelled.signal)).rejects.toThrow()
  expect(f.panel.onTabChange).toHaveBeenCalledTimes(1)
})
