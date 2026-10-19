import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalClientRuntime } from '#features/code/be/services/claude-code/terminal-client-runtime.ts'

it('releases native Client input when the original command result expires', () => {
  const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
  let valid = true
  const release = vi.fn(), key = vi.fn(), invalidate = vi.fn(), stop = vi.fn()
  const instance = { release, key, subscribe: () => stop, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Text', children: ['result'] } }), acceptsPointer: () => false, acceptsKeys: () => true }
  const host = create(() => ({ acquire: () => instance, dispose() {} }), invalidate, () => 'callback', { current: () => valid })
  const tree = host.render('view', 'CommandOutput', 'original-result', { type: 'Client', props: { key: 'result', module: './result.ts' }, client: { plugin: 'fixture' } })
  expect(host.event('view', tree.props.id, 1, { kind: 'key', key: 'x' })).toEqual({ handled: true })
  expect(key).toHaveBeenCalledTimes(1)
  valid = false
  expect(host.event('view', tree.props.id, 2, { kind: 'key', key: 'x' })).toEqual({ handled: false })
  expect(host.count()).toBe(0); expect(stop).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
  expect(key).toHaveBeenCalledTimes(1)
})

it('stops owned timers and old input on scoped release while another Client keeps ticking', async () => {
  vi.useFakeTimers()
  try {
    const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
    const ticks = new Map<string, number>(), releases = new Map<string, number>(), clocks = new Map<string, { every(ms: number, fn: () => void): () => void }>()
    const host = create(() => ({ acquire: (options: any) => { clocks.set(options.requestId, options.clock); options.clock.every(100, () => ticks.set(options.requestId, (ticks.get(options.requestId) ?? 0) + 1)); return { release: () => releases.set(options.requestId, (releases.get(options.requestId) ?? 0) + 1), subscribe: () => () => {}, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Text', children: ['client'] } }), acceptsPointer: () => false, acceptsKeys: () => true, key() {} } }, dispose() {} }), () => {}, () => 'callback')
    const tree = { type: 'Client', props: { key: 'client', module: './client.ts' }, client: { plugin: 'fixture' } }
    const result = host.render('view', 'ToolResult', 'result', tree, 1)
    host.render('view', 'AbovePrompt', 'above', tree)
    await vi.advanceTimersByTimeAsync(200); expect(ticks.get('result')).toBe(2)
    host.release('view', 'ToolResult', 'result'); host.release('view', 'ToolResult', 'result')
    clocks.get('result')!.every(100, () => ticks.set('late', 1))
    await vi.advanceTimersByTimeAsync(300)
    expect(ticks.get('result')).toBe(2); expect(ticks.get('late')).toBeUndefined(); expect(ticks.get('above')).toBe(5)
    expect(releases.get('result')).toBe(1); expect(host.count()).toBe(1)
    expect(host.event('view', result.props.id, 1, { kind: 'key', key: 'x' })).toEqual({ handled: false })
    host.detach(); await vi.runOnlyPendingTimersAsync(); expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('does not run a sandbox callback if its instance closes during the original asynchronous hook', async () => {
  const create = vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`, { Map, Set, randomUUID, setTimeout, clearTimeout, setInterval, clearInterval })
  let finish!: (value: unknown) => void
  const run = vi.fn(), dispatch = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const host = create(() => ({ acquire: () => ({ release() {}, subscribe: () => () => {}, getSnapshot: () => ({ status: 'drawn', tree: { type: 'Button', props: { key: 'run' }, press: { plugin: 'fixture', handle: 1 } } }), acceptsPointer: () => false, acceptsKeys: () => false }), dispose() {} }), () => {}, () => 'callback', { dispatch, run })
  host.render('view', 'ToolResult', 'result', { type: 'Client', props: { key: 'client', module: './client.ts' }, client: { plugin: 'fixture' } }, 1)
  const ordinary = { subtype: 'ui_press', plugin: 'fixture', handle: 1, key: 'inspect-result', component: 'ToolResult', instance_id: 'result', instance_revision: 1 }
  expect(await host.dispatchAction('view', ordinary)).toBeUndefined()
  expect(host.action('view', ordinary)).toBeUndefined()
  const pending = host.dispatchAction('view', { subtype: 'ui_press', plugin: 'fixture', handle: 1, key: 'run', component: 'ToolResult', instance_id: 'result', instance_revision: 1 })
  host.release('view', 'ToolResult', 'result'); finish({ reached: { element: 'run' } })
  expect(await pending).toEqual({ handled: false }); expect(run).not.toHaveBeenCalled()
})

it('suspends only the changing composer instance while another window remains actionable',()=>{
 const create=vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`,{Map,Set,randomUUID,setTimeout,clearTimeout,setInterval,clearInterval})
 const key=vi.fn(),host=create(()=>({acquire:()=>({release(){},subscribe:()=>()=>{},getSnapshot:()=>({status:'drawn',tree:{type:'Text',children:['client']}}),acceptsPointer:()=>false,acceptsKeys:()=>true,key}),dispose(){}}),()=>{},()=> 'callback')
 const tree={type:'Client',props:{key:'client',module:'./client.ts'},client:{plugin:'fixture'}}
 const first=host.render('first','PromptHint','prompt-hint',tree,1),second=host.render('second','PromptHint','prompt-hint',tree,1)
 expect(()=>host.suspendInstance('first','PromptHint','prompt-hint')).not.toThrow()
 expect(host.event('first',first.props.id,1,{kind:'key',key:'x'})).toEqual({handled:false})
 expect(host.event('second',second.props.id,1,{kind:'key',key:'x'})).toEqual({handled:true})
 host.detach()
})

it('suspends policy-revoked Clients and resumes their existing clocks with fresh input tokens',async()=>{
 vi.useFakeTimers()
 try{
  const create=vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`,{Map,Set,randomUUID,setTimeout,clearTimeout,setInterval,clearInterval})
  let eligible=true;const ticks=vi.fn(),release=vi.fn(),key=vi.fn(),acquire=vi.fn((options:any)=>{options.clock.every(100,ticks);return{release,subscribe:()=>()=>{},getSnapshot:()=>({status:'drawn',tree:{type:'Text',children:['client']}}),acceptsPointer:()=>false,acceptsKeys:()=>true,key}})
  const host=create(()=>({acquire,dispose(){}}),()=>{},()=> 'callback',{eligible:()=>eligible})
  const tree={type:'Client',props:{key:'clock',module:'./clock.ts'},client:{plugin:'fixture'}}
  const first=host.render('view','AbovePrompt','above',tree,1)
  await vi.advanceTimersByTimeAsync(100);expect(ticks).toHaveBeenCalledTimes(1)
  eligible=false;await vi.advanceTimersByTimeAsync(200);expect(ticks).toHaveBeenCalledTimes(1);expect(release).not.toHaveBeenCalled()
  expect(host.event('view',first.props.id,1,{kind:'key',key:'x'})).toEqual({handled:false})
  expect(()=>host.render('view','AbovePrompt','above',tree,1)).toThrow('no longer eligible')
  host.render('view','AbovePrompt','above',{type:'Text',children:['default']},1)
  await vi.advanceTimersByTimeAsync(200);expect(ticks).toHaveBeenCalledTimes(1)
  eligible=true;await vi.advanceTimersByTimeAsync(100);expect(ticks).toHaveBeenCalledTimes(1)
  const restored=host.render('view','AbovePrompt','above',tree,1)
  expect(restored.props.id).not.toBe(first.props.id);expect(acquire).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(200);expect(ticks).toHaveBeenCalledTimes(3)
  expect(host.event('view',first.props.id,2,{kind:'key',key:'x'})).toEqual({handled:false})
  expect(host.event('view',restored.props.id,1,{kind:'key',key:'r'})).toEqual({handled:true});expect(key).toHaveBeenCalledOnce()
  eligible=false;await vi.advanceTimersByTimeAsync(100)
  host.detach();await vi.runOnlyPendingTimersAsync();expect(release).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)
 }finally{vi.useRealTimers()}
})

it('rejects an asynchronous action spanning policy suspension and restoration',async()=>{
 const create=vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`,{Map,Set,randomUUID,setTimeout,clearTimeout,setInterval,clearInterval})
 let eligible=true,finish!:(value:unknown)=>void
 const run=vi.fn(),host=create(()=>({acquire:()=>({release(){},subscribe:()=>()=>{},getSnapshot:()=>({status:'drawn',tree:{type:'Button',props:{key:'run'},press:{plugin:'fixture',handle:1}}}),acceptsPointer:()=>false,acceptsKeys:()=>true}),dispose(){}}),()=>{},()=> 'callback',{eligible:()=>eligible,dispatch:()=>new Promise(resolve=>{finish=resolve}),run})
 const tree={type:'Client',props:{key:'client',module:'./client.ts'},client:{plugin:'fixture'}}
 host.render('view','AbovePrompt','above',tree)
 const pending=host.dispatchAction('view',{subtype:'ui_press',plugin:'fixture',handle:1,key:'run'})
 eligible=false;host.render('view','AbovePrompt','above',{type:'Text',children:['default']})
 eligible=true;host.render('view','AbovePrompt','above',tree)
 finish({reached:{element:'run'}});expect(await pending).toEqual({handled:false});expect(run).not.toHaveBeenCalled()
 host.detach()
})

it('projects borrowed terminal Clients through native callbacks without creating or owning a sandbox',async()=>{
 const create=vm.runInNewContext(`${claudeTerminalClientRuntime};createNativeClientHost`,{Map,Set,randomUUID,setTimeout,clearTimeout,setInterval,clearInterval})
 const registry=vi.fn(),key=vi.fn(),stop=vi.fn(),dispatch=vi.fn(),borrow=vi.fn(()=>({id:'original-terminal-client',surface:'terminal',callbackRequestId:'original-notice#clock',release(){},subscribe:()=>stop,getSnapshot:()=>({status:'drawn',tree:{type:'Button',props:{key:'run'},press:{plugin:'fixture',handle:45}}}),acceptsKeys:()=>true,acceptsPointer:()=>false,key}))
 const host=create(registry,()=>{},()=> 'desktop-callback',{borrow,dispatch})
 const frame=host.render('view','InfoNotice','bounded-app-id',{type:'Client',props:{key:'clock',module:'./clock.ts'},client:{plugin:'fixture'}},1)
 expect(registry).not.toHaveBeenCalled();expect(host.surface('view',frame.props.id)).toBe('terminal')
 expect(host.event('view',frame.props.id,1,{kind:'key',key:'k'})).toEqual({handled:true});expect(key).toHaveBeenCalledWith({key:'k'})
 const action={subtype:'ui_press',plugin:'fixture',handle:45,key:'run',component:'InfoNotice',instance_id:'bounded-app-id',instance_revision:1}
 expect(await host.dispatchAction('view',action)).toBeUndefined();expect(dispatch).not.toHaveBeenCalled()
 expect(host.action('view',action)).toEqual({handle:45,component:'InfoNotice',requestId:'original-notice#clock',surface:'terminal'})
 host.detach('view');expect(stop).toHaveBeenCalledOnce();expect(host.surface('view',frame.props.id)).toBeUndefined()
 expect(host.event('view',frame.props.id,2,{kind:'key',key:'old'})).toEqual({handled:false})
})
