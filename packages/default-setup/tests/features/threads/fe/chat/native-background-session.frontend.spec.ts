import {createApp,h,nextTick,reactive} from 'vue'
import NativeBackgroundSession from '#features/threads/fe/chat/NativeBackgroundSession.vue'
import type {ClaudeBackgroundSessionState} from '#features/threads/be/claude-terminal-views.ts'
vi.mock('@apackdev/sdk/fe',()=>({surfaceStorage:()=>({get:()=>undefined,set:()=>{}})}))
it('keeps composing ownership and its bounded layout when active session changes within the same job',async()=>{
 const continuation={sessionId:'parent',continuedInSessionId:'root',timestamp:'2026-11-05T00:00:00Z'}
 const state=reactive<ClaudeBackgroundSessionState>({...continuation,revision:1,operation:'refresh',status:'done',session:{id:'11111111',sessionId:'root',cwd:'/owned',state:'working',pid:119},desktop:{ownerId:'first',parentSessionId:'parent',sessionId:'root',jobSessionId:'root',jobId:'11111111',pid:119,processStart:'start'}})
 const composing=vi.fn(),root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeBackgroundSession,{continuation,state,canReply:true,onComposing:composing},{composer:()=>h('button','Child Send')})})
 try{
  app.mount(root);root.querySelector<HTMLButtonElement>('button[aria-label="Reply"]')!.click();await nextTick()
  expect(composing).toHaveBeenLastCalledWith(true)
  state.desktop={...state.desktop!,ownerId:'second',sessionId:'fresh'};await nextTick()
  expect(root.querySelector('.background-session--composing')).not.toBeNull();expect(composing).toHaveBeenLastCalledWith(true)
  state.desktop={...state.desktop!,jobSessionId:'foreign'};await nextTick()
  expect(root.querySelector('.background-session--composing')).toBeNull();expect(composing).toHaveBeenLastCalledWith(false)
 }finally{app.unmount();root.remove()}
})

it('interrupts the current response while retaining the separate worker Stop control',async()=>{
 const continuation={sessionId:'parent',continuedInSessionId:'root',timestamp:'2026-11-05T00:00:00Z'}
 const desktop={ownerId:'desktop',parentSessionId:'parent',sessionId:'root',jobSessionId:'root',jobId:'11111111',pid:119,processStart:'start'}
 const state=reactive<ClaudeBackgroundSessionState>({...continuation,revision:1,operation:'refresh',status:'done',session:{id:'11111111',sessionId:'root',cwd:'/owned',state:'working',pid:119},desktop,turn:{id:'one',cancelled:false}})
 const operate=vi.fn(),root=document.createElement('div');document.body.append(root)
 const app=createApp({render:()=>h(NativeBackgroundSession,{continuation,state,onOperate:operate})})
 try{
  app.mount(root);root.querySelector<HTMLButtonElement>('button[aria-label="Interrupt response"]')!.click()
  expect(operate).toHaveBeenLastCalledWith(continuation,{operation:'interrupt',target:desktop,turnId:'one'})
  state.turn={id:'one',cancelled:true};await nextTick()
  expect(root.querySelector('button[aria-label="Interrupt response"]')).toBeNull();expect(root.querySelector('button[aria-label="Stop background session"]')).not.toBeNull()
  state.turn={id:'two',cancelled:false};state.continuedInSessionId='replacement';await nextTick()
  expect(root.querySelector('button[aria-label="Interrupt response"]')).toBeNull()
 }finally{app.unmount();root.remove()}
})

it.each([
  { name:'the original reply', replacement:false, revision:2 },
  { name:'a replaced worker', replacement:true, revision:2 },
  { name:'a newer reply', replacement:false, revision:3 },
])('settles a rich reply against $name', async ({ replacement, revision }) => {
  const continuation = { sessionId: 'parent', continuedInSessionId: 'root', timestamp: '2026-11-05T00:00:00Z' }
  const desktop = { ownerId: 'desktop', parentSessionId: 'parent', sessionId: 'root', jobSessionId: 'root', jobId: '11111111', pid: 119, processStart: 'start' }
  const state = reactive<ClaudeBackgroundSessionState>({
    ...continuation, revision: 1, operation: 'refresh', status: 'done',
    session: { id: '11111111', sessionId: 'root', cwd: '/owned', state: 'working', pid: 119 }, desktop,
  })
  const operate = vi.fn(), accepted = vi.fn(), rejected = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(NativeBackgroundSession, { continuation, state, canReply: true, onOperate: operate }, {
      composer: ({ send }) => h('button', { onClick: () => void send('First reply').then(accepted,rejected) }, 'Child Send'),
    }),
  })
  try {
    app.mount(root)
    root.querySelector<HTMLButtonElement>('button[aria-label="Reply"]')!.click()
    await nextTick()
    const clickSend = () => Array.from(root.querySelectorAll('button')).find(button => button.textContent === 'Child Send')!.click()
    clickSend()
    expect(operate).toHaveBeenCalledExactlyOnceWith(continuation, { operation: 'reply', id: '11111111', pid: 119, text: 'First reply' })
    Object.assign(state, { revision: 2, operation: 'reply', status: 'pending' })
    await nextTick()
    expect(accepted).not.toHaveBeenCalled()
    if(replacement){
      state.session={...state.session!,pid:120}
      state.desktop={...desktop,pid:120,processStart:'replacement'}
      await nextTick()
      await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce())
    }
    Object.assign(state,{revision,status:'done'})
    if(replacement || revision!==2){
      await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce())
      expect(accepted).not.toHaveBeenCalled()
      clickSend()
      expect(operate).toHaveBeenCalledTimes(2)
      Object.assign(state,{revision:revision+1,status:'done'})
    }
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledExactlyOnceWith({ accepted: true }))
  } finally {
    app.unmount()
    root.remove()
  }
})
