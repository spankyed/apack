import { createApp, h, nextTick, reactive } from 'vue'
import NativeSettingsPanel from '#features/threads/fe/chat/NativeSettingsPanel.vue'
import type { ClaudeSettingsView, ClaudeSettingsOperation } from '#features/code/common/native-settings.ts'

it('keeps native values authoritative, explains locks and allows Close while a save is held', async () => {
  const state = reactive<{ state: ClaudeSettingsView }>({ state: { requestId: 'read', status: 'ready', snapshot: { revision: 'a'.repeat(64), rows: [
    { key: 'tips', label: 'Show tips', kind: 'boolean', value: true, isLocked: false },
    { key: 'thinking', label: 'Thinking', kind: 'boolean', value: true, isLocked: true, lockReason: 'Set by original policy' },
  ] } } })
  const operations: ClaudeSettingsOperation[] = [], close = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeSettingsPanel, { ...state, onOperate: (event: ClaudeSettingsOperation) => operations.push(event), onClose: close }); app.mount(root)
  try {
    await nextTick(); expect(operations).toEqual([{ kind: 'read' }])
    const tips = root.querySelector<HTMLInputElement>('[data-native-setting="tips"] input')!, locked = root.querySelector<HTMLInputElement>('[data-native-setting="thinking"] input')!
    expect(locked.disabled).toBe(true); expect(root.textContent).toContain('Set by original policy')
    tips.click(); await nextTick()
    expect(operations.at(-1)).toEqual({kind:'write',revision:'a'.repeat(64),key:'tips',value:false})
    expect(tips.checked).toBe(true)
    state.state.status = 'pending'; await nextTick(); expect(tips.disabled).toBe(true)
    const closeButton = [...root.querySelectorAll('button')].find(button => button.textContent === 'Close settings')!
    closeButton.click(); expect(close).toHaveBeenCalledOnce()
    state.state.status = 'error'; state.state.problem = 'Native save refused'; await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Native save refused'); expect(tips.checked).toBe(true)
  } finally { app.unmount(); root.remove() }
})

it('waits for native tab acknowledgement and displays structured Status, Usage and Stats', async () => {
  const frame = reactive<NonNullable<import('#features/code/common/native-settings.ts').ClaudeSettingsSnapshot['frame']>>({ selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false })
  const operations: ClaudeSettingsOperation[] = [], root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeSettingsPanel, {state:{requestId:'frame',status:'ready',snapshot:{revision:'b'.repeat(64),rows:[],frame}},onOperate:(event:ClaudeSettingsOperation)=>operations.push(event)})
  app.mount(root)
  try {
    await nextTick()
    const status = [...root.querySelectorAll('nav button')].find(button=>button.textContent==='Status') as HTMLButtonElement
    status.click(); await nextTick()
    expect(operations.at(-1)).toEqual({kind:'tab',tab:'Status',revision:'b'.repeat(64)})
    expect(root.querySelector('[aria-label="Search Claude Code settings"]')).not.toBeNull()
    frame.selectedTab='Status'; frame.status=[[{label:'Version',value:'2.1.302'},{label:'',value:'Original unlabelled status note'}]]; await nextTick()
    const note=[...root.querySelectorAll('dd')].find(node=>node.textContent==='Original unlabelled status note')!
    expect(note.previousElementSibling?.textContent).toBe('Additional information')
    expect(root.textContent).toContain('2.1.302'); expect(root.querySelector('[aria-label="Search Claude Code settings"]')).toBeNull()
    frame.diagnostics=['Original settings warning\nOriginal detail']; await nextTick()
    expect(root.querySelector('[aria-label="System diagnostics"]')?.textContent).toContain('Original settings warning\nOriginal detail')
    frame.diagnostics=[]; await nextTick(); expect(root.querySelector('[aria-label="System diagnostics"]')).toBeNull()
    frame.selectedTab='Usage'; frame.usage={startedAt:1,context:{window:200000},rateLimits:[]}; await nextTick()
    expect(root.textContent).toContain('no rate-limit reading'); expect(root.textContent).not.toContain('Session cost')
    frame.selectedTab='Stats'; frame.stats={outcome:'success',loading:false,view:'Models',range:'7d',data:{totalSessions:1,totalMessages:2,totalDays:1,activeDays:1,dailyActivity:[],modelUsage:{'native-model':{inputTokens:10,outputTokens:5,cacheReadInputTokens:0,cacheCreationInputTokens:0,costUSD:0.02}}}}; await nextTick()
    expect(root.textContent).toContain('native-model'); expect(root.textContent).toContain('Last 7 days')
    const cycle = [...root.querySelectorAll('button')].find(button=>button.textContent?.includes('Change dates')) as HTMLButtonElement
    cycle.click(); expect(operations.at(-1)).toEqual({kind:'stats',action:'cycleDates',revision:'b'.repeat(64)})
  } finally { app.unmount(); root.remove() }
})

it('refreshes admitted Stats loading and stops on native refusal, another tab or unmount', async () => {
  vi.useFakeTimers()
  const frame=reactive<NonNullable<import('#features/code/common/native-settings.ts').ClaudeSettingsSnapshot['frame']>>({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false})
  const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
  const app=createApp(NativeSettingsPanel,{state:{requestId:'loading',status:'ready',snapshot:{revision:'c'.repeat(64),rows:[],frame}},onOperate:(event:ClaudeSettingsOperation)=>operations.push(event)})
  app.mount(root)
  try {
    await nextTick();const initial=operations.length
    frame.selectedTab='Stats';frame.stats={outcome:'loading',loading:true};await nextTick()
    expect(root.textContent).toContain('Loading Claude Code stats')
    await vi.advanceTimersByTimeAsync(250);expect(operations.slice(initial)).toEqual([{kind:'read'}])
    frame.stats={outcome:'unavailable',loading:false,problem:'Original native privacy refusal'};await nextTick()
    expect(root.textContent).toContain('Original native privacy refusal');expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.textContent).not.toContain('Copy stats');expect(root.textContent).not.toContain('Change dates')
    const settled=operations.length;await vi.advanceTimersByTimeAsync(1000);expect(operations).toHaveLength(settled)
    frame.stats={outcome:'loading',loading:true};await nextTick();frame.selectedTab='Usage';await nextTick()
    await vi.advanceTimersByTimeAsync(500);expect(operations).toHaveLength(settled)
    frame.selectedTab='Stats';await nextTick();app.unmount();await vi.advanceTimersByTimeAsync(500);expect(operations).toHaveLength(settled)
  } finally {app.unmount();root.remove();vi.useRealTimers()}
})

it('routes original editor opening, form Save and pending Cancel through the current native revisions',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'editor',status:'ready',snapshot:{revision:'d'.repeat(64),rows:[{key:'advanced',label:'Advanced value',kind:'text',value:'original',isLocked:false,editorAvailable:true}],frame:{selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();[...root.querySelectorAll('button')].find(button=>button.textContent==='Change…')!.click()
  expect(operations.at(-1)).toEqual({kind:'open',revision:'d'.repeat(64),key:'advanced'})
  state.state.snapshot!.editor={kind:'form',revision:'e'.repeat(64),title:'Original advanced editor',submitLabel:'Save native',fields:[{key:'value',label:'Original field',value:'original'}]};state.state.snapshot!.frame!.hidden=true;await nextTick()
  const input=root.querySelector<HTMLInputElement>('[aria-label="Claude Code setting editor"] input')!;input.value='edited';input.dispatchEvent(new Event('input'));await nextTick()
  root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(operations.at(-1)).toEqual({kind:'editor',revision:'d'.repeat(64),editorRevision:'e'.repeat(64),command:{action:'save',values:{value:'edited'}}})
  state.state.status='pending';await nextTick();[...root.querySelectorAll('button')].find(button=>button.textContent==='Cancel')!.click()
  expect(operations.at(-1)).toEqual({kind:'editor',revision:'d'.repeat(64),editorRevision:'e'.repeat(64),command:{action:'cancel'}})
 }finally{app.unmount();root.remove()}
})

it('refreshes a pending native setting change and stops once its original value is acknowledged',async()=>{
 vi.useFakeTimers()
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'commit',status:'ready',snapshot:{revision:'a'.repeat(64),commitPending:true,rows:[{key:'tips',label:'Show tips',kind:'boolean',value:false,isLocked:false}],frame:{selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  const before=operations.length;await vi.advanceTimersByTimeAsync(250);expect(operations.slice(before)).toEqual([{kind:'read'}])
  state.state.snapshot!.commitPending=false;state.state.snapshot!.rows[0].value=true;await nextTick()
  const acknowledged=operations.length;await vi.advanceTimersByTimeAsync(1000);expect(operations.length).toBe(acknowledged);expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false)
 }finally{app.unmount();root.remove();vi.useRealTimers()}
})

it('separates Theme preview, syntax toggle and commit under exact native editor revisions',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'theme',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],frame:{selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true},editor:{kind:'choice',revision:'b'.repeat(64),title:'Theme',disabled:false,value:'dark',previewValue:'light',canPreview:true,canToggleSyntax:true,preview:{theme:{text:'#222222',inverseText:'#ffffff'},text:'1  Original code sample',ansi:'1  \u001b[32mOriginal code sample\u001b[0m',lines:[' Original code sample'],caption:'Native syntax caption'},options:[{value:'light',label:'Light mode',disabled:false}]}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();expect(root.querySelector('[aria-label="Native Theme preview"]')?.textContent).toContain('Original code sample')
  const surface=root.querySelector<HTMLElement>('[data-native-theme-surface]')!;expect(surface.style.color).toBe('rgb(34, 34, 34)');expect(surface.style.backgroundColor).toBe('rgb(255, 255, 255)')
  const preview=root.querySelector<HTMLButtonElement>('[aria-label="Preview Light mode"]')!;expect(preview.getAttribute('aria-pressed')).toBe('true');preview.click()
  expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'preview',value:'light'}})
  ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Toggle syntax highlighting')!.click()
  expect(operations.at(-1)).toMatchObject({command:{action:'toggleSyntax'}})
  ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Light mode')!.click()
  expect(operations.at(-1)).toMatchObject({command:{action:'select',value:'light'}})
  state.state.status='pending';await nextTick();expect(preview.disabled).toBe(true)
 }finally{app.unmount();root.remove()}
})

it('routes native Model details and effort while preserving price styling and disabled eligibility',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'model',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],frame:{selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true},editor:{kind:'choice',revision:'b'.repeat(64),title:'Model',disabled:false,value:'alpha',model:{focusValue:'alpha',description:'Native model instructions',effortText:'Native medium effort',canAdjustEffort:true,fastModeNotice:'Native fast-mode notice'},options:[{value:'alpha',label:'Native Alpha',description:'$8 $4',descriptionAnsi:'\u001b[9m$8\u001b[29m $4',disabled:false},{value:'locked',label:'Unavailable',disabled:true}]}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();expect(root.querySelector('[aria-label="Native Model details"]')?.textContent).toContain('Native medium effort');expect(root.querySelector('input')).toBeNull()
  expect([...root.querySelectorAll<HTMLElement>('span')].find(span=>span.textContent==='$8')?.style.textDecoration).toBe('line-through')
  root.querySelector<HTMLButtonElement>('[aria-label="Details for Native Alpha"]')!.click();expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'focusModel',value:'alpha'}})
  ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Decrease effort')!.click();expect(operations.at(-1)).toMatchObject({command:{action:'adjustEffort',direction:'left'}})
  root.querySelector('[aria-label="Native Model details"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));expect(operations.at(-1)).toMatchObject({command:{action:'adjustEffort',direction:'right'}})
  expect(root.querySelector<HTMLButtonElement>('[aria-label="Details for Unavailable"]')!.disabled).toBe(true)
  ;[...root.querySelectorAll('button')].find(button=>button.querySelector('span')?.textContent==='Native Alpha')!.click();expect(operations.at(-1)).toMatchObject({command:{action:'select',value:'alpha'}})
 }finally{app.unmount();root.remove()}
})

it('renders native grouped rows and sends revision-bound changes without a synthetic Save',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'group',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'group',revision:'b'.repeat(64),title:'Notifications',disabled:false,description:'Original mobile notice',rows:[{key:'channel',label:'Channel',kind:'choice',value:'original',disabled:false,options:[{value:'original',label:'Original channel',disabled:false},{value:'other',label:'Other channel',disabled:false}]},{key:'done',label:'Notify when Claude is done',kind:'boolean',value:true,disabled:false}]}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();expect(root.textContent).toContain('Original mobile notice');expect(root.querySelector('form')).toBeNull()
  const select=root.querySelector('select')!;select.value='other';select.dispatchEvent(new Event('change'))
  expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'setGroup',key:'channel',value:'other'}})
  state.state.status='pending';await nextTick();expect(select.disabled).toBe(true);expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Close')!.click()
  expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'cancel'}})
 }finally{app.unmount();root.remove()}
})

it('shows original consent disclosure and initially focuses the native No choice',async()=>{
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp(NativeSettingsPanel,{state:{requestId:'consent',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'choice',revision:'b'.repeat(64),title:'Original consent',disabled:false,consent:{description:'Original warning and external path',cancelLabel:'No, disable external imports',defaultFocusValue:'cancel'},options:[{value:'cancel',label:'No, disable external imports',disabled:false},{value:'confirm',label:'Yes, allow external imports',disabled:false}]}}},onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})
 app.mount(root)
 try{
  await nextTick();expect(root.textContent).toContain('Original warning and external path');expect(document.activeElement).toBe(root.querySelector('[data-native-settings-option="cancel"]'))
  ;(root.querySelector('[data-native-settings-option="confirm"]') as HTMLButtonElement).click();expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'select',value:'confirm'}})
 }finally{app.unmount();root.remove()}
})

it('shows original external approval state and distinguishes review from native disable',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'consent-row',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[{key:'showExternalIncludesDialog',label:'External CLAUDE.md includes',kind:'text',value:'false',isLocked:false,editorAvailable:true}]}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();expect(root.textContent).toContain('Not allowed')
  ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Review external imports…')!.click()
  expect(operations.at(-1)).toEqual({kind:'open',revision:'a'.repeat(64),key:'showExternalIncludesDialog'})
  state.state.snapshot!.rows[0].value='true';await nextTick();expect(root.textContent).not.toContain('Not allowed');expect(root.textContent).toContain('Allowed')
  const disable=[...root.querySelectorAll('button')].find(button=>button.textContent==='Disable external imports')!;disable.click();expect(operations.at(-1)).toEqual({kind:'open',revision:'a'.repeat(64),key:'showExternalIncludesDialog'})
  state.state.snapshot!.rows[0].isLocked=true;await nextTick();expect(disable.disabled).toBe(true)
 }finally{app.unmount();root.remove()}
})

it('shows native read-only update restrictions without an editable field or Save control',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'update-info',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'information',revision:'b'.repeat(64),title:'Enable Auto-Updates',description:'Original restriction: controlled by the original environment variable.'}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action)})});app.mount(root)
 try{
  await nextTick();const editor=root.querySelector('[aria-label="Claude Code setting editor"]')!;expect(editor.textContent).toContain('Original restriction');expect(editor.querySelector('input,select,form')).toBeNull()
  state.state.status='pending';await nextTick();const close=[...editor.querySelectorAll('button')].find(button=>button.textContent==='Close')!;expect(close.disabled).toBe(false);close.click()
  expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'cancel'}})
 }finally{app.unmount();root.remove()}
})

it('focuses the original typed consent answer, preserves exact input and shows native refusal feedback',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'typed-consent',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'form',revision:'b'.repeat(64),title:'Original consent',description:'Original warning and y/n decision labels',submitLabel:'Submit',fields:[{key:'answer',label:'Enter y/n:',value:''}],consent:{cancelLabel:'Original No',focusField:'answer',problem:'Please answer y or n.'}}}}})
 const operations:ClaudeSettingsOperation[]=[],root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{state:state.state,onOperate:(operation:ClaudeSettingsOperation)=>operations.push(operation)})});app.mount(root)
 try{
  await nextTick();await nextTick();const input=root.querySelector<HTMLInputElement>('[data-native-setting-field="answer"]')!;expect(document.activeElement).toBe(input);expect(root.querySelector('[role="alert"]')?.textContent).toBe('Please answer y or n.')
  input.value=' YES ';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'save',values:{answer:' YES '}}})
  state.state.status='pending';await nextTick();const cancel=[...root.querySelectorAll('button')].find(button=>button.textContent==='Original No')!;expect(cancel.disabled).toBe(false);cancel.click();expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'cancel'}})
 }finally{app.unmount();root.remove()}
})


it('reviews cloud forwarding consent instead of writing true from a checkbox',async()=>{
 const root=document.createElement('div');document.body.append(root);const operations:ClaudeSettingsOperation[]=[]
 const app=createApp(NativeSettingsPanel,{state:{requestId:'cloud',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[{key:'remoteHomeSettings',label:"Use this machine settings in cloud sessions",kind:'boolean',value:false,isLocked:false,editorAvailable:true,description:'Original refusal notice'}]}},onOperate:(event:ClaudeSettingsOperation)=>operations.push(event)})
 app.mount(root)
 try{
  await nextTick();expect(root.textContent).toContain('Not forwarding');expect(root.textContent).toContain('Original refusal notice');expect(root.querySelector('input[type="checkbox"]')).toBeNull()
  const review=[...root.querySelectorAll('button')].find(button=>button.textContent==='Review cloud settings…')!;review.click();await nextTick()
  expect(operations.at(-1)).toEqual({kind:'open',revision:'a'.repeat(64),key:'remoteHomeSettings'});expect(operations.some(event=>event.kind==='write')).toBe(false)
 }finally{app.unmount();root.remove()}
})


it('focuses native Not now and makes Escape cancel its editor while retaining Settings',async()=>{
 const root=document.createElement('div');document.body.append(root);const operations:ClaudeSettingsOperation[]=[],close=vi.fn()
 const app=createApp(NativeSettingsPanel,{state:{requestId:'cloud-consent',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],editor:{kind:'choice',revision:'b'.repeat(64),title:'Cloud consent',disabled:false,consent:{description:'Original disclosure',cancelLabel:'Not now',defaultFocusValue:'not_now'},options:[{value:'forward',label:'Yes',disabled:false},{value:'not_now',label:'Not now',disabled:false}]}}},onOperate:(event:ClaudeSettingsOperation)=>operations.push(event),onClose:close})
 app.mount(root)
 try{
  await nextTick();await nextTick();expect(document.activeElement).toBe(root.querySelector('[data-native-settings-option="not_now"]'))
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,isComposing:true}));expect(operations.some(event=>event.kind==='editor')).toBe(false)
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'cancel'}});expect(close).not.toHaveBeenCalled()
 }finally{app.unmount();root.remove()}
})

it('preserves native non-cancellable credit processing and routes admitted model Close through native cancellation',async()=>{
 const state=reactive<{state:ClaudeSettingsView}>({state:{requestId:'credit',status:'ready',snapshot:{revision:'a'.repeat(64),rows:[],dismissible:false,refreshPending:true,editor:{kind:'information',revision:'b'.repeat(64),title:'Usage credits',description:'Processing payment…'}}}})
 const operations:ClaudeSettingsOperation[]=[],close=vi.fn(),root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeSettingsPanel,{subject:'model',state:state.state,onOperate:(action:ClaudeSettingsOperation)=>operations.push(action),onClose:close})});app.mount(root)
 try{
  await nextTick();const before=operations.length,button=root.querySelector<HTMLButtonElement>('header button')!
  expect(button.disabled).toBe(true);button.click();root.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(operations).toHaveLength(before);expect(close).not.toHaveBeenCalled()
  state.state.snapshot!.dismissible=true;state.state.snapshot!.refreshPending=false;await nextTick()
  expect(button.disabled).toBe(false);button.click();expect(operations.at(-1)).toEqual({kind:'editor',revision:'a'.repeat(64),editorRevision:'b'.repeat(64),command:{action:'cancel'}});expect(close).not.toHaveBeenCalled()
 }finally{app.unmount();root.remove()}
})
