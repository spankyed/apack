import {createApp, h, nextTick, reactive, type App} from 'vue'
import NativeBackgroundComposer from '#features/threads/fe/chat/NativeBackgroundComposer.vue'
import type {ClaudeBackgroundUiTarget} from '#features/code/common/native-background.ts'
const send=vi.fn()
let context:{nativeUiViews:Record<string,{threadId:string;attachmentId?:string;state:{status:string}}>} , app:App|undefined
vi.mock('@apackdev/sdk/fe',()=>({useSurface:()=>({send,getSnapshot:()=>({context,status:'active'})})}))
vi.mock('@xstate/vue',async()=>{const{computed}=await import('vue');return{useSelector:(_actor:unknown,select:(value:unknown)=>unknown)=>computed(()=>select({context}))}})
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue',()=>({default:{props:['disabled','draft','audience'],emits:['field','host','draft','leave'],template:`<section><textarea aria-label="Draft" :value="draft" :disabled="disabled" @input="$emit('draft',$event.target.value)"/><button @click="$emit('field',{actionId:'action',text:'child value'})">Field</button><button @click="$emit('host',{requestId:'request',kind:'read',text:'draft',cursor:5})">Host</button><button @click="$emit('leave')">Close</button></section>`}}))
beforeEach(()=>{send.mockClear();context=reactive({nativeUiViews:{}})})
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren()})
it('routes controls through its child mount and retires that mount on worker replacement and collapse',async()=>{
 const target=reactive<ClaudeBackgroundUiTarget>({ownerId:'child-one',parentSessionId:'parent',sessionId:'child',jobId:'11111111',pid:119,processStart:'one'})
 const root=document.createElement('div');document.body.append(root);const leave=vi.fn(),draft=vi.fn()
 app=createApp({render:()=>h(NativeBackgroundComposer,{threadId:'thread',target,draft:'Saved child draft',disabled:false,send:async()=>{},onDraft:draft,onLeave:leave})});app.mount(root)
 const first=send.mock.calls.find(([event])=>event.type==='CLAUDE_UI_MOUNT')![0]
 expect(first.backgroundView).toEqual(target);expect(first.nativeView).toBeUndefined()
 context.nativeUiViews[first.mountId]={threadId:'thread',attachmentId:'attachment',state:{status:'live'}};await nextTick()
 expect(root.querySelector('textarea')!.disabled).toBe(false)
 root.querySelectorAll('button')[0]!.click();root.querySelectorAll('button')[1]!.click()
 expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'CLAUDE_UI_FIELD',threadId:'thread',mountId:first.mountId,text:'child value'}))
 expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'CLAUDE_PROMPT_HOST_RESPONSE',threadId:'thread',mountId:first.mountId,requestId:'request'}))
 target.ownerId='child-two';target.processStart='two';await nextTick()
 expect(send).toHaveBeenCalledWith({type:'CLAUDE_UI_UNMOUNT',threadId:'thread',mountId:first.mountId})
 const second=send.mock.calls.filter(([event])=>event.type==='CLAUDE_UI_MOUNT').at(-1)![0]
 expect(second.mountId).not.toBe(first.mountId);expect(second.backgroundView.ownerId).toBe('child-two')
 expect(root.querySelector('textarea')!.disabled).toBe(true)
 root.querySelectorAll('button')[2]!.click();expect(leave).toHaveBeenCalledOnce()
 app.unmount();app=undefined
 expect(send).toHaveBeenCalledWith({type:'CLAUDE_UI_UNMOUNT',threadId:'thread',mountId:second.mountId})
 expect(send.mock.calls.some(([event])=>event.type==='CLAUDE_TERMINAL_INPUT')).toBe(false)
})
