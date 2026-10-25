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
  const run = vm.runInNewContext(claudeTerminalSettingsFrameRuntime + ';nativeSettingsFrame', { process, createHash, composerFunctionHashes: hashes })
  const n = { themeRoots: { ai: () => new Map([[process.stdout, { container: { current: root } }]]) } }
  return { run: () => run(n, entry), root, owner, rows, panel, entry, hashes, Status }
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
