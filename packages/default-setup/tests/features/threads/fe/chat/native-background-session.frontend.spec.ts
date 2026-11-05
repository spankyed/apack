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
