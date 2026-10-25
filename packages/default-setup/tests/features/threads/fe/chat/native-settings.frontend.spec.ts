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
