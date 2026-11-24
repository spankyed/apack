import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalComposerRuntime } from '#features/code/be/services/claude-code/terminal-composer-runtime.ts'
function fixture(){
 const output={},publish=vi.fn(),clients=new Set(['view']),edits=new Map([['view',{box:{text:'Unsent app draft'}}]])
 function vtr(){return 'original spinner'}
 function OH(){return 'original modes'}
 function vY(){return 'original prompt hint'}
 const trusted=new Map([[Function.prototype.toString.call(vtr),'303032488d6858b55a00a4718644628955b5beadbdf79e9161609313fe9ee5e2'],[Function.prototype.toString.call(OH),'102949adbd5d8849d10b15d5d7bc64d7e98466e46a23fa0ad704c86ae02b8b8a']])
 trusted.set(Function.prototype.toString.call(vY),'0e01508dc7198c1522cbf5658ec5b6b83f4ce8068ddeee35694dc501b6103dd5')
 const crypto=(algorithm:string)=>{let value='';return{update(input:string){value+=input;return this},digest(){return trusted.get(value)??createHash(algorithm).update(value).digest('hex')}}}
 const input={surface:'terminal',component:'Spinner',requestId:'native-agent',props:{word:'Working',message:null,suffix:'…',mode:'tool-input'}}
 const factory=vi.fn((value:any)=>({type:'original-engine',props:value.props})),cache=Array(22);cache[21]=factory
 const fiber:any={type:vtr,memoizedState:{memoizedState:[input,[]]},updateQueue:{memoCache:{data:[cache]}}}
 const roster={list:vi.fn(()=>[] as {clientId:string;answers:string[]}[])}, fleet={Kwn:{Provider:Symbol('mounted original provider')}}
 const n={roster:{Kw:roster},fleet,privateTasks:{$nr:{Provider:Symbol('private task store')}},privateTaskDrawing:{ktr:()=>null},documentDefaults:{$Et:()=>({})},themeRoots:{ai:()=>new Map([[output,{container:{current:fiber}}]])},questionOptions:{Ze:()=> 'native-agent',j:()=> 'session'},runtime:{ey:()=>({}),fse:()=>true},taskSessionGlobals:{Bn:()=>false},nativeClients:{release:vi.fn(),suspend:vi.fn(),suspendInstance:vi.fn()},jsx:{e:(type:unknown,props:unknown)=>({type,props})},terminalComponents:{n:Symbol('native themed Text')},appProvider:{d_:Symbol('fresh original provider')},staticRender:{v6e:vi.fn(async(_tree:unknown,_options:unknown)=> 'Original native engine')}}
 const api=vm.runInNewContext(claudeTerminalComposerRuntime+`;({read:nativeComposerInputs,list:nativeComposerList,facts:nativeComposerFacts,refresh:refreshNativeComposer,current:currentComposerAction,format:formatNativeComposer,idleTasks:formatNativeIdleTasks,taskActions:nativeComposerTaskActions,frames:composerFrames})`,{process:{stdout:output},createHash:crypto,clients,edits,publish,originalContext:undefined,clientViewCurrent:()=>true,nativeViewFacts:()=>({view:{kind:'main'}}),nativeThemeProvider:()=>({type:'theme',value:{resolvedTheme:{text:'#fff'}}}),AbortController,Date,Set})
 return{n,api,fiber,input,factory,edits,publish,OH,vY,roster,fleet}
}
it('uses exact original inputs and default factories, mapping desktop mode without changing native props',async()=>{
 const f=fixture(),facts=f.api.facts(f.n,'view','Spinner','native-agent')
 expect(facts.props.mode).toBe('tool-use');expect(f.input.props.mode).toBe('tool-input')
 expect(f.api.list(f.n,'view')).toMatchObject([{component:'Spinner',id:'native-agent'}])
 await expect(f.api.format(f.n,facts,{...facts.props,word:'Display word'},{signal:new AbortController().signal})).resolves.toBe('Original native engine')
 expect(f.factory).toHaveBeenCalledWith(expect.objectContaining({surface:'desktop',props:expect.objectContaining({word:'Display word'})}))
 const wrapper=f.n.staticRender.v6e.mock.calls[0]![0] as any
 expect(wrapper.type).toBe(f.n.appProvider.d_);expect(wrapper.props.store).toBeUndefined()
})
it('rejects lookalike producers, ambiguous inputs and changed default renderer caches',()=>{
 const f=fixture();f.fiber.type=function vtr(){return 'impostor'};expect(f.api.list(f.n,'view')).toEqual([])
 const g=fixture();g.fiber.updateQueue.memoCache.data[0][21]=undefined;expect(()=>g.api.read(g.n)).toThrow('cache changed')
 const h=fixture();h.fiber.sibling={...h.fiber,memoizedState:{memoizedState:[{...h.input,props:{...h.input.props,word:'Other'}},[]]}};expect(()=>h.api.read(h.n)).toThrow('Ambiguous')
})
it('retires withdrawn sources and fences old actions while leaving unrelated sources alone',()=>{
 const f=fixture(),facts=f.api.facts(f.n,'view','Spinner','native-agent'),request={client_id:'view',component:'Spinner',instance_id:'native-agent'}
 f.api.frames.set(JSON.stringify(['view','Spinner','native-agent']),{...request,clientId:'view',id:'native-agent',fingerprint:facts.fingerprint})
 expect(()=>f.api.current(f.n,request)).not.toThrow();f.api.refresh(f.n)
 f.input.props.mode='tool-use';expect(()=>f.api.current(f.n,request)).toThrow('changed or expired')
 f.fiber.memoizedState=null;f.api.refresh(f.n)
 expect(f.n.nativeClients.release).toHaveBeenCalledWith('view','Spinner','native-agent')
 expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({composer_placements:true,client_id:'view'}))
})

it('renders desktop prompt hints with the original dim Text under the live native theme',async()=>{
 const f=fixture()
 await expect(f.api.format(f.n,{component:'PromptHint'},{hint:'Draft ready',tail:'Terminal-only tail'},{signal:new AbortController().signal})).resolves.toBe('Original native engine')
 const wrapper=f.n.staticRender.v6e.mock.calls[0]![0] as any
 expect(wrapper.props.children).toMatchObject({type:'theme',props:{value:{resolvedTheme:{text:'#fff'}},children:{type:f.n.terminalComponents.n,props:{dimColor:true,children:'Draft ready'}}}})
 expect(f.factory).not.toHaveBeenCalled()
})

it('keeps draft flags and revisions scoped to each app composer without mutating terminal inputs',()=>{
 const f=fixture(),input={surface:'terminal',component:'PromptHint',requestId:'prompt-hint',props:{isDraft:false,isWorking:true,hint:'Native hint'}}
 f.fiber.type=f.vY;f.fiber.memoizedState={memoizedState:[input,[]]}
 f.edits.set('empty-view',{box:{text:''}})
 const draft=f.api.facts(f.n,'view','PromptHint','prompt-hint'),empty=f.api.facts(f.n,'empty-view','PromptHint','prompt-hint')
 expect(draft.props).toMatchObject({isDraft:true,isWorking:true})
 expect(empty.props).toMatchObject({isDraft:false,isWorking:true})
 expect(draft.fingerprint).not.toBe(empty.fingerprint)
 expect(input.props.isDraft).toBe(false)
})
it('rejects actions from an old source generation when the native request id is reused',()=>{
 const f=fixture(),facts=f.api.facts(f.n,'view','Spinner','native-agent'),request={client_id:'view',component:'Spinner',instance_id:'native-agent'}
 f.api.frames.set(JSON.stringify(['view','Spinner','native-agent']),{fingerprint:facts.fingerprint})
 f.fiber.updateQueue.memoCache.data[0][21]=()=>({type:'new original instance'})
 expect(()=>f.api.current(f.n,request)).toThrow('changed or expired')
 expect(f.api.facts(f.n,'view','Spinner','native-agent').fingerprint).not.toBe(facts.fingerprint)
})


it('refreshes a visible waiting count through the current native provider at its sweep cadence',()=>{
 const f=fixture(),store={getSnapshot:vi.fn(()=>({needsInput:1})),refetch:vi.fn(async()=>{})};
 f.fiber.type=f.vY;
 f.fiber.memoizedState={memoizedState:[{surface:'terminal',component:'PromptHint',requestId:'main',props:{hint:'← 1 agent'}},[]]};
 f.fiber.return={type:f.fleet.Kwn.Provider,memoizedProps:{value:store}};
 const clock=vi.spyOn(Date,'now').mockReturnValue(20000);
 try{
  f.api.refresh(f.n);
  expect(store.refetch).not.toHaveBeenCalled();
  f.roster.list.mockReturnValue([{clientId:'view',answers:['ui_prompt_read']}]);
  f.api.refresh(f.n);
  clock.mockReturnValue(29999);
  f.api.refresh(f.n);
  expect(store.refetch).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(30000);
  f.api.refresh(f.n);
  expect(store.refetch).toHaveBeenCalledTimes(2);
  store.getSnapshot.mockReturnValue({needsInput:0});
  clock.mockReturnValue(40000);
  f.api.refresh(f.n);
  expect(store.refetch).toHaveBeenCalledTimes(2);
 }finally{clock.mockRestore();}
})

it('projects only the current native idle hint and retires it without altering the PromptHint hook input', () => {
  const f = fixture()
  const input = { surface: 'terminal', component: 'PromptHint', requestId: 'prompt-hint', props: { hint: 'Original keyboard help', isWorking: false } }
  f.fiber.type = f.vY
  f.fiber.memoizedState = { memoizedState: [input, []] }
  const hint = { key: 'idle-return-hint', kind: 'contextual', segments: ['new task? ', '/clear', ' to save ', '15 tokens'].map(text => ({ text })) }
  const notifications: { current?: unknown; queue: unknown[] } = { current: hint, queue: [] }
  let dialogOpen = false
  f.n.runtime.ey = () => ({
    surface: 'terminal',
    toolContext: () => ({
      getAppState: () => ({ notifications }),
      dialogStore: { getState: () => ({ open: dialogOpen ? [{}] : [] }) },
    }),
  })
  const facts = () => f.api.facts(f.n, 'view', 'PromptHint', 'prompt-hint')
  const shown = facts()
  expect(shown.idleReturnHint).toBe('new task? /clear to save 15 tokens')
  expect(shown.props).toEqual({ ...input.props, isDraft: true })
  dialogOpen = true
  expect(facts().idleReturnHint).toBeUndefined()
  dialogOpen = false
  input.props.isWorking = true
  expect(facts().idleReturnHint).toBeUndefined()
  input.props.isWorking = false
  notifications.current = undefined
  notifications.queue.push(hint)
  expect(facts().idleReturnHint).toBeUndefined()
  expect(facts().fingerprint).not.toBe(shown.fingerprint)
})


it('renders the mounted idle list and advertises its original Global toggle while collapsed', async () => {
  const f = fixture()
  const input = { surface: 'terminal', component: 'PromptHint', requestId: 'prompt-hint', props: { isWorking: false } }
  const tasks = [{ id: '1', subject: 'Review migration notes', status: 'pending' }]
  const taskStore = { type: f.n.privateTasks.$nr, memoizedProps: { value: { getSnapshot: () => tasks } } }
  const standalone = { type: f.n.privateTaskDrawing.ktr, return: taskStore, memoizedProps: { hidden: false } }
  Object.assign(f.fiber, { type: f.vY, return: taskStore, sibling: standalone, memoizedState: { memoizedState: input } })
  let expandedView = 'tasks'
  f.n.runtime.ey = () => ({
    toolContext: () => ({ getAppState: () => ({ expandedView }) }),
  })
  const facts = () => f.api.facts(f.n, 'view', 'PromptHint', input.requestId)
  const provider = { props: { handlerRegistryRef: { current: new Map([['app:toggleTodos', new Set([
    { action: 'app:toggleTodos', context: 'Global', handler: vi.fn() },
  ])]]) } } }
  const actions = (client = 'view') => f.api.taskActions(f.n, client, provider)
  const shown = facts()
  expect(shown.taskList.tasks).toBe(tasks)
  await expect(f.api.idleTasks(f.n, shown, {})).resolves.toBe('Original native engine')
  expect(actions()).toEqual([expect.objectContaining({ action: 'app:toggleTodos' })])
  const shownAction = actions()[0]
  expandedView = 'none'
  expect(facts().taskList).toBeUndefined()
  expect(actions()[0].revision).not.toBe(shownAction.revision)
  expect(actions('detached')).toEqual([])
  expandedView = 'tasks'
  standalone.memoizedProps.hidden = true
  expect(facts().taskList).toBeUndefined()
  standalone.memoizedProps.hidden = false
  input.props.isWorking = true
  expect(facts().taskList).toBeUndefined()
})
