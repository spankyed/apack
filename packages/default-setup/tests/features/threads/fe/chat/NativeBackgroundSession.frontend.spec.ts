import { createApp, nextTick, reactive } from 'vue'
import NativeBackgroundSession from '#features/threads/fe/chat/NativeBackgroundSession.vue'
import type { ClaudeBackgroundSessionState } from '#features/threads/be/claude-terminal-views.ts'
const link = { sessionId: '24be904a-3c35-4981-9793-cbe7a6c19d46', continuedInSessionId: '05ff1d31-597d-4537-8737-4407191add6e', timestamp: '2026-10-29T12:13:13.909Z' }
it('renders observed child state and captures the worker target; retires Stop only on native acknowledgement', async () => {
  const state = reactive<ClaudeBackgroundSessionState>({ ...link, operation: 'refresh', status: 'done', revision: 1,
    session: { id: '05ff1d31', sessionId: link.continuedInSessionId, cwd: '/owned', pid: 119, state: 'working', status: 'busy' } })
  const operate = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeBackgroundSession, { continuation: link, state, onOperate: operate }); app.mount(root)
  try {
    expect(root.textContent).toContain('working in background')
    const stop = [...root.querySelectorAll('button')].find(button => button.textContent === 'Stop background session')!
    stop.click(); expect(operate).toHaveBeenCalledWith(link, { operation: 'stop', id: '05ff1d31', pid: 119 })
    state.operation = 'stop'; state.status = 'pending'; await nextTick()
    expect(root.textContent).not.toContain('Last reported: stopped')
    expect([...root.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    state.status = 'done'; state.session = { ...state.session!, state: 'stopped', pid: undefined }; await nextTick()
    expect(root.textContent).toContain('Last reported: stopped')
    expect(root.textContent).not.toContain('Stop background session')
    stop.click(); expect(operate).toHaveBeenCalledTimes(1)
  } finally { app.unmount(); root.remove() }
})
it('does not display another child state as the current session', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp(NativeBackgroundSession, { continuation: link, state: { ...link, continuedInSessionId: link.sessionId, operation: 'refresh', status: 'done', revision: 1,
    session: { id: '12345678', sessionId: link.sessionId, cwd: '/foreign', pid: 999, state: 'working' } } }); app.mount(root)
  try { expect(root.textContent).toContain('Checking background session'); expect(root.textContent).not.toContain('Stop background session') }
  finally { app.unmount(); root.remove() }
})

it('retains a refused draft through remount and clears only its acknowledged reply', async () => {
  const state = reactive<ClaudeBackgroundSessionState>({...link,operation:'refresh',status:'done',revision:1,session:{id:'05ff1d31',sessionId:link.continuedInSessionId,cwd:'/owned',pid:119,state:'working',status:'idle'}})
  const operate=vi.fn(),root=document.createElement('div');document.body.append(root)
  let app=createApp(NativeBackgroundSession,{continuation:link,state,onOperate:operate,canReply:true});app.mount(root)
  const type=async(text:string)=>{const input=root.querySelector('textarea')!;input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick()}
  const submit=()=>root.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  try{
    [...root.querySelectorAll('button')].find(button=>button.textContent==='Reply')!.click();await nextTick();await type('Keep this follow-up.');submit()
    expect(operate).toHaveBeenLastCalledWith(link,{operation:'reply',id:'05ff1d31',pid:119,text:'Keep this follow-up.'})
    state.operation='reply';state.revision=2;state.status='error';state.problem='Original refusal';await nextTick()
    expect(root.querySelector('textarea')!.value).toBe('Keep this follow-up.')
    app.unmount();app=createApp(NativeBackgroundSession,{continuation:link,state,onOperate:operate,canReply:true});app.mount(root)
    expect(root.querySelector('textarea')!.value).toBe('Keep this follow-up.')
    submit();state.revision=3;state.status='pending';await nextTick();expect(root.querySelector('textarea')!.disabled).toBe(true)
    state.status='done';await nextTick();expect(root.querySelector('textarea')!.value).toBe('');expect(root.textContent).toContain('Message queued')
  }finally{app.unmount();root.remove()}
})

it('shows child usage only for the listed live job and hides it when that worker is stopped', async () => {
  const state=reactive<ClaudeBackgroundSessionState>({...link,operation:'refresh',status:'done',revision:1,session:{id:'05ff1d31',sessionId:link.continuedInSessionId,cwd:'/owned',pid:119,state:'working'}})
  const info=reactive({jobId:'05ff1d31',sessionId:link.continuedInSessionId,pid:119,observedAt:10000,startedAt:1,model:'sonnet',turns:2,context:{tokens:40,window:200000,percent:0},totalCostUsd:0.001})
  const root=document.createElement('div');document.body.append(root);const app=createApp(NativeBackgroundSession,{continuation:link,state,info});app.mount(root)
  try{
    expect(root.querySelector('[aria-label="Background session usage"]')?.textContent).toContain('sonnet · 2 turns · 0% context · Session total $0.001000')
    info.pid=120;await nextTick();expect(root.querySelector('[aria-label="Background session usage"]')).toBeNull()
    info.pid=119;state.session!.state='stopped';await nextTick();expect(root.querySelector('[aria-label="Background session usage"]')).toBeNull()
  }finally{app.unmount();root.remove()}
})

it('renders original configured ANSI status only for the current live child worker',async()=>{
 const state=reactive<ClaudeBackgroundSessionState>({...link,operation:'refresh',status:'done',revision:1,session:{id:'05ff1d31',sessionId:link.continuedInSessionId,cwd:'/owned',pid:119,state:'working'}})
 const info={jobId:'05ff1d31',sessionId:link.continuedInSessionId,pid:119,observedAt:1,model:'sonnet',turns:2,startedAt:1,statusLine:'\u001b[32mOriginal helper\u001b[0m\nSecond line'}
 const root=document.createElement('div');document.body.append(root)
 const app=createApp(NativeBackgroundSession,{continuation:link,state,info});app.mount(root)
 try{
  const status=root.querySelector('[aria-label="Background Claude configured status"]')!;expect(status.textContent).toContain('Original helper');expect(status.textContent).toContain('Second line');expect(status.textContent).not.toContain('\u001b[')
  state.session={...state.session!,pid:120};await nextTick();expect(root.querySelector('[aria-label="Background Claude configured status"]')).toBeNull()
 }finally{app.unmount();root.remove()}
})
