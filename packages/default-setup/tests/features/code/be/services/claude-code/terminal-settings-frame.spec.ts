import vm from 'node:vm'
import { stripVTControlCharacters } from 'node:util'
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
  const api = vm.runInNewContext(claudeTerminalSettingsFrameRuntime + ';({nativeSettingsFrame,readNativeSettingsFrame,selectNativeSettingsTab,actNativeSettingsStats})', { process, createHash, stripVTControlCharacters, composerFunctionHashes: hashes, setTimeout, clearTimeout, nativeGenericPermissionText: async (_n: unknown, value: unknown) => String(value) })
  const n = { themeRoots: { ai: () => new Map([[process.stdout, { container: { current: root } }]]) } }
  return { run: () => api.nativeSettingsFrame(n, entry), read: (signal?: AbortSignal) => api.readNativeSettingsFrame(n, entry, signal), select: (tab: string, signal?: AbortSignal) => api.selectNativeSettingsTab(n, entry, tab, signal), statsAction: (action: string) => api.actNativeSettingsStats(n, entry, action), n, root, owner, rows, panel, entry, hashes, Status }
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

it('uses the guarded original Stats date callback and preserves native empty outcomes', async () => {
  const f = fixture(), Loader = () => {}, cycle = vi.fn(), cache = Array(50).fill(null)
  f.panel.selectedTab = 'Stats'; cache[3] = cycle
  f.hashes.set(Loader, 'dea182e69c551bbf30ca8dc15dbbd4ce008db3150028451a40b64fff5d53282a')
  ;(f.owner.child as any).child = {type:Loader,memoizedProps:{allTimePromise:Promise.resolve({type:'empty'}),activeTimePromise:Promise.resolve({})},updateQueue:{memoCache:{data:[cache]}}}
  expect((await f.read()).stats).toEqual({outcome:'empty',loading:false,copyState:'idle'})
  await f.statsAction('cycleDates'); expect(cycle).toHaveBeenCalledOnce()
  cache[3] = null
  await expect(f.statsAction('cycleDates')).rejects.toThrow('date control changed')
})
it('cancels a pending Usage reading without inventing zero values', async () => {
  const f = fixture(), cancelled = new AbortController()
  f.panel.selectedTab = 'Usage'; (f.owner.child as any).child = null
  ;(f.n as any).runtime = {Hco:vi.fn(()=>new Promise(()=>{}))}
  const reading = f.read(cancelled.signal); cancelled.abort()
  await expect(reading).rejects.toThrow()
  expect((f.n as any).runtime.Hco).toHaveBeenCalledWith({},'apack native Settings')
})

it('uses the original Stats export handler and refuses copying outside a mounted Stats view', async () => {
  const f = fixture(), Loader = () => {}, Models = () => {}, copy = vi.fn(), dates = vi.fn(), cache = Array(50).fill(null)
  f.panel.selectedTab = 'Stats'; cache[3] = dates; cache[13] = copy
  f.hashes.set(Loader, 'dea182e69c551bbf30ca8dc15dbbd4ce008db3150028451a40b64fff5d53282a')
  f.hashes.set(Models, '81b82bfee5a2b4a365261e1814815ed043c073b29370102ddbf1522a8bdcd1d1')
  ;(f.owner.child as any).child = {type:Loader,memoizedProps:{allTimePromise:Promise.resolve({type:'empty'}),activeTimePromise:Promise.resolve({})},updateQueue:{memoCache:{data:[cache]}},child:{type:Models,memoizedProps:{stats:{modelUsage:{}}}}}
  await f.statsAction('copy')
  expect(copy).toHaveBeenCalledOnce(); expect(copy.mock.calls[0][0]).toMatchObject({key:'s',ctrl:true,meta:false})
  expect(dates).not.toHaveBeenCalled()
  f.panel.selectedTab='Config'
  await expect(f.statsAction('copy')).rejects.toThrow('unavailable')
  expect(copy).toHaveBeenCalledOnce()
})

it('projects the original cached calendar without recomputing dates or trimming its grid', async () => {
  const f=fixture(),Loader=()=>{},Overview=()=>{},loaderCache=Array(50).fill(null),overviewCache=Array(102).fill(null)
  f.panel.selectedTab='Stats'
  f.hashes.set(Loader,'dea182e69c551bbf30ca8dc15dbbd4ce008db3150028451a40b64fff5d53282a')
  f.hashes.set(Overview,'c5b3f64e5af1267c75634025ba8c60e8b06fe422e02a157926deb0dc9af555d6')
  const data={totalSessions:1,totalMessages:2,totalDays:3,activeDays:1,dailyActivity:[],modelUsage:{}}
  const nativeCalendar='    Oct\nMon ·\x1b[31m█\x1b[0m  \n    Less ░ ▒ ▓ █ More'
  overviewCache[26]={props:{children:{props:{children:nativeCalendar}}}}
  ;(f.owner.child as any).child={type:Loader,memoizedProps:{allTimePromise:Promise.resolve({type:'success',data}),activeTimePromise:Promise.resolve({})},updateQueue:{memoCache:{data:[loaderCache]}},child:{type:Overview,memoizedProps:{stats:data,allTimeStats:data},updateQueue:{memoCache:{data:[overviewCache]}}}}
  expect((await f.read()).stats.calendar).toBe(stripVTControlCharacters(nativeCalendar))
  overviewCache[26].props.children.props.children={unexpected:true}
  await expect(f.read()).rejects.toThrow('calendar producer changed')
})
