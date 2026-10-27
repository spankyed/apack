import type { ClaudeUiRender, ClaudeUiRenderResult, ClaudeUiPress } from '#features/code/be/services/claude-code/ui-controls.ts'
import { createClaudeTranscriptMessageHost } from '#features/code/be/services/claude-code/ui-transcript-messages.ts'
import type { ClaudeUiTranscriptRow } from '#features/code/be/services/claude-code/ui-presentation.ts'
function fixture(clientId = 'view') {
  let current = true, handle = 0
  let rowSource: Parameters<typeof createClaudeTranscriptMessageHost>[0]['rows']|undefined
  let rows: ClaudeUiTranscriptRow[] = ['a', 'b'].map((uuid, index) => ({ component: 'AssistantMessage' as const, uuid, messageId: 'app', sessionId: 'session', text: 'Native text', start: index * 12, end: index * 12 + 11, isFirstOfReply: index === 0 }))
  const ui = { managedSettingsDiagnostics:vi.fn(async()=>[] as import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeManagedSettingsDiagnostic[]),diagnostics:vi.fn(async()=>[] as import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiDiagnosticAttachment[]), terminalPlacements:vi.fn(async()=>[]),composerPlacements: vi.fn(async () => [] as import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiComposerPlacement[]), toolGroups: vi.fn(async () => [] as import('#features/code/be/services/claude-code/ui-controls.ts').ClaudeUiToolGroup[]), releaseInstance: vi.fn(async () => ({ released: true })),
    render: vi.fn(async (_request: ClaudeUiRender): Promise<ClaudeUiRenderResult> => ({ tree: { type: 'Box', children: [
      { type: 'Button', props: { key: 'run', label: 'Run' }, press: { plugin: 'fixture', handle: ++handle } },
      { type: 'Input', props: { key: 'draft', value: '', label: 'Draft' }, press: { plugin: 'fixture', handle: ++handle } },
      { type: 'engine', ref: 1 },
    ] }, props: { text: 'Display rewrite' }, hooked: true, rewritten: true })),
    press: vi.fn(async (_request: ClaudeUiPress) => ({ handled: true })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })),
  }
  const publish = vi.fn()
  const host = createClaudeTranscriptMessageHost({ ui, client: { client_id: clientId, surface: 'desktop' }, rows: (groups,composer) => rowSource?.(groups,composer) ?? rows, current: () => current, publish })
  const nodes = (index = 0) => { const body = host.state[index].body; if (body.status !== 'live' || body.tree.kind !== 'box') throw Error('expected message'); return body.tree.children }
  return { host, ui, publish, nodes, rows, replace: () => { current = false }, setRows: (next: ClaudeUiTranscriptRow[]) => { rows = next }, setSource: (next:NonNullable<typeof rowSource>)=>{rowSource=next} }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('renders distinct native instances, retaining display-only rewrites and independent actions', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render.mock.calls.map(args => args[0])).toEqual(['a', 'b'].map((id, index) => ({ client_id: 'view', surface: 'desktop', component: 'AssistantMessage', instance_id: id, instance_revision: index + 1, props: { text: 'Native text', isFirstOfReply: index === 0 } })))
  expect(f.host.state.map(frame => [frame.uuid, frame.text, frame.displayText])).toEqual([['a', 'Native text', 'Display rewrite'], ['b', 'Native text', 'Display rewrite']])
  const a = f.nodes(0)[0], b = f.nodes(1)[0]; if (a.kind !== 'button' || b.kind !== 'button') throw Error('buttons')
  expect(a.actionId).not.toBe(b.actionId)
  await f.host.press(a.actionId!); await f.host.press(b.actionId!)
  expect(f.ui.press.mock.calls.map(args => args[0].handle)).toEqual([1, 3])
  await expect(f.host.press(a.actionId!)).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('validates current persisted membership before executing even when refresh has not run', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const node = f.nodes()[0]; if (node.kind !== 'button') throw Error('button')
  f.setRows(f.rows.slice(1))
  await expect(f.host.press(node.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.refresh(); expect(f.host.state.map(frame => frame.uuid)).toEqual(['b'])
  f.host.dispose()
})
it('coalesces invalidation and refuses old callbacks while retaining keyed field edits', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  for (let i = 0; i < 100; i++) f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Typed' })
  expect(f.ui.input).toHaveBeenCalledWith(expect.objectContaining({ component: 'AssistantMessage', instance_id: 'a', value: 'Typed' }))
  await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenCalledTimes(4)
  expect(f.nodes()[1]).toMatchObject({ actionId: input.actionId, revision: 1 })
  await expect(f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Duplicate' })).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('rejects another view and retires all row callbacks on owner replacement or disposal', async () => {
  const f = fixture(), other = fixture('other'); f.host.start(); other.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  await expect(other.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  f.replace(); await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.dispose(); other.host.dispose(); expect(f.host.state).toEqual([])
})
it('discards an in-flight render whose persisted row was removed', async () => {
  const f = fixture(); let finish!: (value: Awaited<ReturnType<typeof f.ui.render>>) => void
  f.ui.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  f.setRows([]); f.host.refresh()
  finish({ tree: { type: 'engine', ref: 1 }, props: { text: 'Late' }, hooked: true, rewritten: true })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state).toEqual([])
  f.host.dispose()
})

it('keeps a failed message callback local and never retries its possible native side effect', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.ui.press.mockRejectedValueOnce(new Error('Lost native reply'))
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.host.state[0].body.status).toBe('error'); expect(f.host.state[0].displayText).toBe('Native text')
  expect(f.host.state[1].body.status).toBe('live')
  await vi.advanceTimersByTimeAsync(500)
  expect(f.ui.press).toHaveBeenCalledTimes(1)
  f.host.dispose()
})


it('routes user fields by component and retains keyed drafts across readonly expansion changes', async () => {
  const f = fixture()
  const user: ClaudeUiTranscriptRow = { component: 'UserMessage', messageId: 'app-user', uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', start: 0, end: 12, origin: { kind: 'unclassified' }, isExpanded: false }
  f.setRows([user]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'UserMessage', instance_id: 'native-user', props: { text: 'Typed prompt', origin: { kind: 'unclassified' }, isExpanded: false } }))
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  await f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'User note' })
  expect(f.ui.input).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'UserMessage', instance_id: 'native-user', value: 'User note' }))
  f.setRows([{ ...user, isExpanded: true }]); f.host.refresh()
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.nodes()[1]).toMatchObject({ actionId: input.actionId, revision: 1 })
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ props: { text: 'Typed prompt', origin: { kind: 'unclassified' }, isExpanded: true } }))
  f.host.dispose()
})
it('caps user body rewrites at the native printable limit without changing stored text', async () => {
  const f = fixture(), original = 'Original prompt', rewrite = 'x'.repeat(100001)
  f.setRows([{ component: 'UserMessage', messageId: 'app-user', uuid: 'user', sessionId: 'session', text: original, start: 0, end: original.length, origin: { kind: 'unclassified' }, isExpanded: true }])
  f.ui.render.mockResolvedValueOnce({ tree: { type: 'engine', ref: 1 }, props: { text: rewrite }, rewritten: true, hooked: true })
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state[0].displayText).toHaveLength(100000); expect(f.host.state[0].text).toBe(original)
  f.host.dispose()
})

it('retires collapsed summary controls before reopening a fresh drawing', async () => {
  const f = fixture()
  const summary: ClaudeUiTranscriptRow = { ...f.rows[0], component: 'AssistantMessage', isFirstOfReply: true, isSummary: true, blockIndex: 2, text: '  <context>Hidden</context>\nSummary  ', start: 0, end: 37 }
  f.setRows([summary]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ props: { text: 'Summary', isSummary: true, isFirstOfReply: true } }))
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  f.setRows([])
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Stale' })).resolves.toEqual({ handled: false })
  f.host.refresh(); expect(f.host.state).toEqual([])
  f.setRows([summary]); f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  const reopened = f.nodes()[0]; if (reopened.kind !== 'button') throw Error('button')
  expect(reopened.actionId).not.toBe(button.actionId)
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.press(reopened.actionId!)).resolves.toEqual({ handled: true })
  f.host.dispose()
})

it('renders command output by original UUID and retires callbacks when its error state changes', async () => {
  const f = fixture()
  const command: ClaudeUiTranscriptRow = { component: 'CommandOutput', messageId: 'app-command', uuid: 'native-command', sessionId: 'session', text: 'Result', start: 0, end: 6, isErrored: false }
  f.setRows([command]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'CommandOutput', instance_id: 'native-command', props: { text: 'Result', isErrored: false } }))
  expect(f.host.state[0]).toMatchObject({ text: 'Result', displayText: 'Display rewrite' })
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.setRows([{ ...command, isErrored: true }])
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.dispose()
})

it('retains structured result rewrites only in presentation and retires controls when the block closes', async () => {
  const f = fixture()
  const tool: ClaudeUiTranscriptRow = { component: 'ToolResult', messageId: 'app', uuid: 'a', sessionId: 'session', text: 'Stored original', start: 0, end: 0, blockIndex: 1, assistantUuid: 'assistant-uuid', resultUuid: 'result-uuid', tool: 'Read', isErrored: false }
  f.setRows([tool, f.rows[0]!])
  f.ui.render.mockResolvedValueOnce({ tree: { type: 'Button', props: { key: 'run', label: 'Run' }, press: { plugin: 'fixture', handle: 1 } }, props: { output: { file: '<script>literal</script>' } }, rewritten: true, hooked: true, output_rewritten: true, engine_output: '\u001b[32mOriginal formatted result\u001b[0m' })
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state).toHaveLength(2)
  expect(f.ui.render).toHaveBeenCalledWith(expect.objectContaining({ component: 'ToolResult', instance_id: 'a', props: { session_id: 'session', source_uuid: 'result-uuid', assistant_uuid: 'assistant-uuid', text: 'Stored original', tool: 'Read', isErrored: false } }))
  const frame = f.host.state.find(row => row.component === 'ToolResult')!
  expect(frame).toMatchObject({ text: 'Stored original', outputRewritten: true, engineOutput: '\u001b[32mOriginal formatted result\u001b[0m', displayText: JSON.stringify({ file: '<script>literal</script>' }, null, 2) })
  if (frame.body.status !== 'live' || frame.body.tree.kind !== 'button') throw Error('result button')
  f.ui.render.mockRejectedValueOnce(new Error('Native formatter unavailable'))
  f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state[0]?.body.status).toBe('error')
  expect(f.host.state[0]?.engineOutput).toBeUndefined()
  expect(f.host.state[0]?.outputRewritten).toBeUndefined()
  f.setRows([f.rows[0]!])
  await expect(f.host.press(frame.body.tree.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.dispose()
})

it('uses the native drawing and formatted notice when a rewritten media payload stays in the native process', async () => {
  const f = fixture()
  f.setRows([{ component: 'ToolResult', messageId: 'app', uuid: 'image', sessionId: 'session', text: '', start: 0, end: 0, blockIndex: 1, assistantUuid: 'assistant', resultUuid: 'result', tool: 'Bash', isErrored: false }])
  f.ui.render.mockResolvedValueOnce({ tree: { type: 'engine', ref: 1 }, props: { tool: 'Bash' }, rewritten: true, hooked: true, output_rewritten: true, output_in_native_process: true, engine_output: '[Image data detected and sent to Claude]' })
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state[0]).toMatchObject({ text: '', displayText: '', outputRewritten: true, engineOutput: '[Image data detected and sent to Claude]', body: { status: 'live' } })
  await f.host.dispose()
})

it('releases closed native instances and uses a new revision when the same row is reopened', async () => {
  const f = fixture(); f.setRows([f.rows[0]!]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  f.setRows([]); f.host.refresh()
  expect(f.ui.releaseInstance).toHaveBeenCalledWith({ client_id: 'view', component: 'AssistantMessage', instance_id: 'a', instance_revision: 1 })
  f.setRows([f.rows[0]!]); f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ instance_id: 'a', instance_revision: 2 }))
  await f.host.dispose()
  expect(f.ui.releaseInstance).toHaveBeenLastCalledWith(expect.objectContaining({ instance_revision: 2 }))
})
it('preserves a native instance across prop changes without releasing it after an old render finishes', async () => {
  const f = fixture(); f.setRows([f.rows[0]!]); let finish!: (value: ClaudeUiRenderResult) => void
  f.ui.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  f.setRows([{ ...f.rows[0]!, text: 'Changed text', end: 12 }]); f.host.refresh()
  finish({ tree: { type: 'engine', ref: 1 }, props: {}, hooked: false, rewritten: false }); await vi.advanceTimersByTimeAsync(100)
  expect(f.ui.releaseInstance).not.toHaveBeenCalled()
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ instance_revision: 1 }))
  await f.host.dispose()
})

it('keeps actions live during Client snapshots and redraws only the originating view and instance', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const a = f.nodes(0)[0], b = f.nodes(1)[0]
  if (a.kind !== 'button' || b.kind !== 'button') throw Error('buttons')
  const event = { type: 'system', subtype: 'ui_invalidate', event: 'ui.render', client_snapshot: true, client_id: 'other', instances: [{ surface: 'desktop', component: 'AssistantMessage', instance_id: 'a' }] }
  f.host.receive(event); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenCalledTimes(2)
  f.host.receive({ ...event, client_id: 'view' })
  expect(f.host.ownsAction(a.actionId!)).toBe(true)
  expect(f.host.ownsAction(b.actionId!)).toBe(true)
  await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenCalledTimes(3)
  expect(f.ui.render.mock.lastCall?.[0].instance_id).toBe('a')
  await expect(f.host.press(b.actionId!)).resolves.toEqual({ handled: true })
  await f.host.dispose()
})


it('keeps ToolUse producer state native and retires header actions when activity changes', async () => {
  const f = fixture()
  const tool: ClaudeUiTranscriptRow = { component: 'ToolUse', messageId: 'app', uuid: 'tool', sessionId: 'session', text: 'Original', start: 0, end: 0, blockIndex: 0, assistantUuid: 'assistant', activityStatus: 'running' }
  f.setRows([tool]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'ToolUse', instance_id: 'tool', props: { assistant_uuid: 'assistant' } }))
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.setRows([{ ...tool, activityStatus: 'completed', resultUuid: 'result' }])
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenCalledTimes(2)
  await f.host.dispose()
})


it('discovers native groups, keeps the engine inert during redraw and retires children on collapse',async()=>{
 const f=fixture(),unrelated=f.rows[0]!,group={id:'native-group',anchorIds:[],members:[{toolUseId:'tool',revision:'b'.repeat(64)}],usesEngine:true,isActive:false,isExpanded:true,initialized:true,revision:'a'.repeat(64)}
 f.ui.toolGroups.mockResolvedValue([group])
 f.setSource(groups=>[...groups.flatMap(value=>{
  const row:ClaudeUiTranscriptRow={component:'ToolGroup',uuid:value.id,messageId:'app',sessionId:'session',text:'',start:0,end:0,blockIndex:0,revision:value.revision,isActive:value.isActive,isExpanded:value.isExpanded,usesEngine:value.usesEngine,tools:[{id:'tool',tool:'Read',summary:'file',status:'ok'}],artifacts:[]}
  return [row,...(value.isExpanded&&value.usesEngine?[{component:'ToolUse' as const,uuid:'tool',messageId:'app',sessionId:'session',text:'',start:0,end:0,blockIndex:0,assistantUuid:'assistant',activityStatus:'ok'}]:[])]
 }),unrelated])
 f.ui.render.mockImplementation(async request=>({tree:{type:'Box',children:[{type:'Button',props:{key:'run',label:'Run'},press:{plugin:'fixture',handle:1}},{type:'engine',ref:0}]},props:request.component==='ToolGroup'?{isExpanded:request.props.isExpanded}:{},hooked:true,rewritten:false,...(request.component==='ToolGroup'?{group_engine:true}:{})}))
 f.host.start();await vi.advanceTimersByTimeAsync(200)
 expect(f.host.state.map(row=>row.component)).toEqual(['AssistantMessage','ToolGroup','ToolUse'])
 const parentRevision=f.ui.render.mock.calls.find(args=>args[0].component==='ToolGroup')![0].instance_revision
 const parent=f.host.state.find(row=>row.component==='ToolGroup')!,button=f.nodes(f.host.state.findIndex(row=>row.component==='ToolGroup'))[0];if(button.kind!=='button')throw Error('button')
 f.ui.toolGroups.mockResolvedValue([{...group,isExpanded:false}])
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]})
 expect(f.host.state.find(row=>row.component==='ToolGroup')?.body.status).toBe('live')
 const unaffected=f.ui.render.mock.calls.filter(args=>args[0].component==='AssistantMessage').length
 await expect(f.host.press(button.actionId!)).resolves.toEqual({handled:false})
 await vi.advanceTimersByTimeAsync(200)
 expect(f.host.state).toHaveLength(2);expect(f.host.state.find(row=>row.component==='ToolGroup')).toMatchObject({component:'ToolGroup',groupExpanded:false});expect(f.ui.render.mock.calls.filter(args=>args[0].component==='AssistantMessage')).toHaveLength(unaffected)
 expect(f.ui.releaseInstance).toHaveBeenCalledWith(expect.objectContaining({component:'ToolUse',instance_id:'tool'}))
 expect(f.ui.releaseInstance).not.toHaveBeenCalledWith(expect.objectContaining({component:'ToolGroup'}))
 expect(f.host.state.find(row=>row.component==='ToolGroup')?.uuid).toBe(parent.uuid)
 f.ui.toolGroups.mockResolvedValue([group]);f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]});await vi.advanceTimersByTimeAsync(200)
 const renderBase=f.ui.render.getMockImplementation()!;let failGroup=true
 f.ui.render.mockImplementation(async request=>{if(request.component==='ToolGroup'&&failGroup){failGroup=false;throw Error('Group module failed')}return renderBase(request)})
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]});await vi.advanceTimersByTimeAsync(200)
 expect(f.host.state.find(row=>row.component==='ToolGroup')?.body.status).toBe('error');expect(f.host.state).toHaveLength(2)
 expect(f.ui.releaseInstance).toHaveBeenCalledWith(expect.objectContaining({component:'ToolGroup',instance_id:'native-group',instance_revision:parentRevision}))
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',tool_groups:true,instances:[{surface:'desktop',component:'ToolGroup',instance_id:'native-group'}]});await vi.advanceTimersByTimeAsync(200)
 const render=f.ui.render.mock.calls.filter(args=>args[0].component==='ToolGroup').at(-1)![0]
 expect(render.instance_revision).toBeGreaterThan(1);expect(f.host.state.find(row=>row.component==='ToolGroup')?.body.status).toBe('live')
 const childRevision=f.ui.render.mock.calls.filter(args=>args[0].component==='ToolUse').at(-1)![0].instance_revision
 const normalRender=f.ui.render.getMockImplementation()!
 f.ui.render.mockImplementation(async request=>request.component==='ToolGroup'?{tree:{type:'Text',children:['Group-only']},props:{isExpanded:true},group_engine:false,hooked:true,rewritten:false}:normalRender(request))
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render'});await vi.advanceTimersByTimeAsync(200)
 expect(f.host.state.filter(row=>row.component==='ToolUse')).toEqual([])
 expect(f.ui.releaseInstance).toHaveBeenCalledWith(expect.objectContaining({component:'ToolUse',instance_revision:childRevision}))
 await f.host.dispose()
})

it('mounts source-bound composer rows, keeps unrelated message actions live and retires withdrawn sources', async () => {
 const f=fixture(),source={component:'Spinner' as const,id:'native-agent',revision:'a'.repeat(64)}
 f.ui.composerPlacements.mockResolvedValue([source])
 f.setSource((_groups,composer)=>[f.rows[0]!,...composer.map(item=>({component:item.component,uuid:item.id,sourceRevision:item.revision,messageId:'composer',sessionId:'session',text:'',start:0,end:0}))])
 f.host.start();await vi.advanceTimersByTimeAsync(50)
 expect(f.ui.render).toHaveBeenCalledWith(expect.objectContaining({component:'Spinner',instance_id:'native-agent',props:{source_revision:source.revision}}))
 const original=f.nodes()[0];if(original.kind!=='button')throw Error('button')
 const spinner=f.host.state.find(row=>row.component==='Spinner')!,body=spinner.body;if(body.status!=='live'||body.tree.kind!=='box'||body.tree.children[0].kind!=='button')throw Error('spinner button')
 const stale=body.tree.children[0].actionId!
 f.ui.composerPlacements.mockResolvedValue([])
 f.host.receive({type:'system',subtype:'ui_invalidate',event:'ui.render',composer_placements:true,client_id:'view',instances:[{surface:'desktop',component:'Spinner',instance_id:'native-agent'}]})
 await vi.advanceTimersByTimeAsync(100)
 expect(f.host.state.some(row=>row.component==='Spinner')).toBe(false)
 await expect(f.host.press(stale)).resolves.toEqual({handled:false})
 await expect(f.host.press(original.actionId!)).resolves.toEqual({handled:true})
 expect(f.ui.releaseInstance).toHaveBeenCalledWith(expect.objectContaining({component:'Spinner',instance_id:'native-agent'}))
})


it('keeps redrawn callbacks inert until the previous native press acknowledges', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const first = f.nodes()[0]; if (first.kind !== 'button') throw Error('button')
  let acknowledge!: (value: { handled: boolean }) => void
  f.ui.press.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve }))
  const pending = f.host.press(first.actionId!)
  f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  await vi.advanceTimersByTimeAsync(50)
  const redrawn = f.nodes()[0]; if (redrawn.kind !== 'button') throw Error('button')
  expect(redrawn.actionId).toBeUndefined()
  acknowledge({ handled: true }); await pending; await vi.advanceTimersByTimeAsync(50)
  const ready = f.nodes()[0]; if (ready.kind !== 'button') throw Error('button')
  expect(ready.actionId).toBeTruthy()
  await expect(f.host.press(ready.actionId!)).resolves.toEqual({ handled: true })
  expect(f.ui.press).toHaveBeenCalledTimes(2)
  await f.host.dispose()
})

it('uses each mounted tool width independently and refuses retired instance measurements', async () => {
  const f = fixture()
  const row = (uuid: string): ClaudeUiTranscriptRow => ({ component: 'ToolResult', uuid, messageId: 'app', sessionId: 'session', text: 'Original output', start: 0, end: 15, blockIndex: 0, assistantUuid: 'assistant', resultUuid: 'result-'+uuid, tool: 'Read', isErrored: false })
  f.setRows([row('wide'), row('narrow')]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const [wide, narrow] = f.host.state
  f.ui.render.mockClear()
  f.host.layout({ component: 'ToolResult', uuid: wide.uuid, instanceRevision: wide.instanceRevision, columns: 100 })
  f.host.layout({ component: 'ToolResult', uuid: narrow.uuid, instanceRevision: narrow.instanceRevision, columns: 38 })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render.mock.calls.map(([request]) => [request.instance_id, request.viewport?.columns])).toEqual([['wide',100],['narrow',38]])
  f.ui.render.mockClear()
  f.host.layout({ component: 'ToolResult', uuid: wide.uuid, instanceRevision: wide.instanceRevision, columns: 100 })
  f.host.layout({ component: 'ToolResult', uuid: narrow.uuid, instanceRevision: narrow.instanceRevision+1, columns: 80 })
  await vi.advanceTimersByTimeAsync(50); expect(f.ui.render).not.toHaveBeenCalled()
  f.setRows([]); f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  f.setRows([row('wide')]); f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  const replacement = f.host.state[0]; expect(replacement.instanceRevision).not.toBe(wide.instanceRevision)
  f.ui.render.mockClear()
  f.host.layout({ component: 'ToolResult', uuid: wide.uuid, instanceRevision: wide.instanceRevision, columns: 40 })
  await vi.advanceTimersByTimeAsync(50); expect(f.ui.render).not.toHaveBeenCalled()
  f.host.layout({ component: 'ToolResult', uuid: replacement.uuid, instanceRevision: replacement.instanceRevision, columns: 40 })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render.mock.calls[0][0].viewport).toEqual({ columns:40, rows:24 })
  await f.host.dispose()
})

it('anchors diagnostic attachments to selected original rows and withdraws unavailable sources', async () => {
  const f=fixture(), diagnostic={id:'warning',revision:'a'.repeat(64),anchorIds:['foreign','a'],summary:'Native summary',detail:'Native warning'}
  f.ui.diagnostics.mockResolvedValue([diagnostic]);f.host.start();await vi.advanceTimersByTimeAsync(50)
  expect(f.host.diagnostics).toEqual([{...diagnostic,messageId:'app'}])
  f.setRows([]);expect(f.host.diagnostics).toEqual([])
  f.setRows(f.rows);f.ui.diagnostics.mockRejectedValueOnce(Error('Detached'))
  f.host.receive({type:'attachment'});await vi.advanceTimersByTimeAsync(50)
  expect(f.host.diagnostics).toEqual([]);f.host.dispose()
})
it('discards a pending diagnostic response after owner retirement', async () => {
  const f=fixture();let finish!:(rows:Awaited<ReturnType<typeof f.ui.diagnostics>>)=>void
  f.ui.diagnostics.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));f.host.start();f.replace()
  finish([{id:'late',revision:'b'.repeat(64),anchorIds:['a'],summary:'Old summary',detail:'Old detail'}])
  await vi.advanceTimersByTimeAsync(50);expect(f.host.diagnostics).toEqual([]);f.host.dispose()
})
it('shows native managed settings diagnostics without fabricating a transcript anchor and withdraws them on retirement', async () => {
  const f=fixture(), warning={file:'/etc/claude-code/managed-settings.json',path:'',message:'Settings file could not be read: EACCES',severity:'fatal' as const,errno:'EACCES'}
  f.setRows([]);f.ui.managedSettingsDiagnostics.mockResolvedValue([warning]);f.host.start();await vi.advanceTimersByTimeAsync(50)
  expect(f.host.managedSettingsDiagnostics).toEqual([warning]);expect(f.host.state).toEqual([])
  f.replace();expect(f.host.managedSettingsDiagnostics).toEqual([]);f.host.dispose()
})
it('does not publish a managed policy diagnostic reply after its view is disposed', async () => {
  const f=fixture();let finish!:(rows:Awaited<ReturnType<typeof f.ui.managedSettingsDiagnostics>>)=>void
  f.ui.managedSettingsDiagnostics.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));f.host.start();await vi.advanceTimersByTimeAsync(50)
  f.host.dispose();finish([{file:'managed settings',path:'',message:'Old warning',severity:'warning'}]);await vi.advanceTimersByTimeAsync(50)
  expect(f.host.managedSettingsDiagnostics).toEqual([])
})

it('does not replace a fresh drawing when a retired press rejects', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const first = f.nodes()[0]; if (first.kind !== 'button') throw Error('button')
  let reject!: (error: Error) => void
  f.ui.press.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const pending = f.host.press(first.actionId!)
  f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  await vi.advanceTimersByTimeAsync(50)
  reject(new Error('Original terminal press handle retired'))
  await expect(pending).resolves.toEqual({ handled: false })
  await vi.advanceTimersByTimeAsync(50)
  const fresh = f.nodes()[0]; if (fresh.kind !== 'button') throw Error('button')
  expect(fresh.actionId).toBeTruthy()
  await expect(f.host.press(first.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.press(fresh.actionId!)).resolves.toEqual({ handled: true })
  await f.host.dispose()
})

it('keeps the error presentation when the current press fails without a replacement drawing', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.ui.press.mockRejectedValueOnce(new Error('Current callback failed'))
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.host.state[0].body.status).toBe('error')
  await f.host.dispose()
})

describe.each(['input', 'select'] as const)('%s callback failure ownership', kind => {
  function setupField() {
    const f = fixture()
    if (kind === 'select') {
      let handle = 0
      f.ui.render.mockImplementation(async () => ({ tree: { type: 'Box', children: [
        { type: 'Select', props: { key: 'choice', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }, press: { plugin: 'fixture', handle: ++handle } },
      ] }, props: {}, hooked: true, rewritten: false }))
    }
    return { ...f, callback: kind === 'input' ? f.ui.input : f.ui.select, field() {
      const node = f.nodes()[kind === 'input' ? 1 : 0]
      if (node.kind !== 'input' && node.kind !== 'select') throw Error('field')
      return node
    }, event(revision: number) { return { actionId: this.field().actionId, revision, kind: kind === 'input' ? 'change' as const : 'select' as const, value: 'b' } } }
  }

  it('retains a fresh field when an earlier drawing callback rejects', async () => {
    const f = setupField(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
    let reject!: (error: Error) => void
    f.callback.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = f.host.field(f.event(1))
    f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
    await vi.advanceTimersByTimeAsync(50)
    reject(new Error('Retired native field'))
    await expect(pending).resolves.toEqual({ handled: false })
    expect(f.field().actionId).toBeTruthy()
    await expect(f.host.field(f.event(2))).resolves.toEqual({ handled: true })
    await f.host.dispose()
  })

  it('does not let an older edit failure destroy a newer pending edit', async () => {
    const f = setupField(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
    let reject!: (error: Error) => void, resolve!: (result: { handled: boolean }) => void
    f.callback.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    f.callback.mockImplementationOnce(() => new Promise(finish => { resolve = finish }))
    const older = f.host.field(f.event(1)), newer = f.host.field(f.event(2))
    reject(new Error('Old edit failed'))
    await expect(older).resolves.toEqual({ handled: false })
    expect(f.field().actionId).toBeTruthy()
    resolve({ handled: true }); await expect(newer).resolves.toEqual({ handled: true })
    await vi.advanceTimersByTimeAsync(50)
    expect(f.field().actionId).toBeTruthy()
    await f.host.dispose()
  })

  it('keeps current field failures visible when no newer edit or drawing exists', async () => {
    const f = setupField(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
    f.callback.mockRejectedValueOnce(new Error('Current edit failed'))
    await expect(f.host.field(f.event(1))).resolves.toEqual({ handled: false })
    expect(f.host.state[0].body.status).toBe('error')
    await f.host.dispose()
  })
})
