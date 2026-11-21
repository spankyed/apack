import {createApp, h, nextTick, reactive, type App} from 'vue'
import NativeBackgroundSession from '#features/threads/fe/chat/NativeBackgroundSession.vue'
import NativeBackgroundComposer from '#features/threads/fe/chat/NativeBackgroundComposer.vue'
import type {ClaudeUiQuestionFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
import type {ClaudeBackgroundUiTarget} from '#features/code/common/native-background.ts'
const send=vi.fn()
let context:{nativeUiViews:Record<string,{threadId:string;attachmentId?:string;state:{status:string; question?: ClaudeUiQuestionFrame}}>} , app:App|undefined
vi.mock('@apackdev/sdk/fe',()=>({surfaceStorage:()=>({get:()=>null,set:()=>{},remove:()=>{}}),useSurface:()=>({send,getSnapshot:()=>({context,status:'active'})})}))
vi.mock('@xstate/vue',async()=>{const{computed}=await import('vue');return{useSelector:(_actor:unknown,select:(value:unknown)=>unknown)=>computed(()=>select({context}))}})
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue',()=>({default:{props:['disabled','draft','audience'],emits:['field','host','draft','leave'],template:`<section><textarea aria-label="Draft" :value="draft" :disabled="disabled" @input="$emit('draft',$event.target.value)"/><button @click="$emit('field',{actionId:'action',text:'child value'})">Field</button><button @click="$emit('host',{requestId:'request',kind:'read',text:'draft',cursor:5})">Host</button><button @click="$emit('leave')">Close</button></section>`}}))
beforeEach(()=>{send.mockClear();context=reactive({nativeUiViews:{}})})
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren()})
it('routes controls through its child mount and retires that mount on worker replacement and collapse',async()=>{
 const target=reactive<ClaudeBackgroundUiTarget>({ownerId:'child-one',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:'11111111',pid:119,processStart:'one'})
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

it('renders the original child question and routes answers without changing the retained composer draft', async () => {
 const target:ClaudeBackgroundUiTarget={ownerId:'child',parentSessionId:'parent',sessionId:'child',jobSessionId:'child',jobId:'11111111',pid:119,processStart:'one'}
 const root=document.createElement('div');document.body.append(root);const leave=vi.fn()
 app=createApp({render:()=>h(NativeBackgroundComposer,{threadId:'thread',target,draft:'Retained child draft',disabled:false,send:async()=>{},onLeave:leave})});app.mount(root)
 const mounted=send.mock.calls.find(([event])=>event.type==='CLAUDE_UI_MOUNT')![0]
 const question:ClaudeUiQuestionFrame={messageId:'child:dialog:revision',id:'dialog',revision:'revision',draftActionId:'draft-action',token:'issued-token',shownInput:{questions:[{question:'Which branch?',header:'Branch',options:[{label:'Alpha'},{label:'Beta'}]}]},body:{status:'live',tree:{kind:'unsupported',component:'engine'}}}
 context.nativeUiViews[mounted.mountId]={threadId:'thread',attachmentId:'attached',state:{status:'live',question}};await nextTick()
 expect(root.textContent).toContain('Which branch?')
 expect(root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Draft"]')!.value).toBe('Retained child draft')
 root.querySelector<HTMLInputElement>('input[value="Alpha"]')!.click();await nextTick()
 expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'CLAUDE_UI_FIELD',mountId:mounted.mountId,actionId:'draft-action',value:'issued-token'}))
 ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Submit answers')!.click()
 expect(send).toHaveBeenCalledWith({type:'CLAUDE_UI_QUESTION_ANSWER',threadId:'thread',mountId:mounted.mountId,messageId:question.messageId,token:'issued-token',answer:{answers:{'Which branch?':'Alpha'},annotations:{}}})
 ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Back to parent notes')!.click()
 expect(leave).toHaveBeenCalledOnce()
 expect(send.mock.calls.some(([event])=>event.type==='RESPOND_TO_BLOCK'||event.type==='CLAUDE_TERMINAL_INPUT')).toBe(false)
 context.nativeUiViews[mounted.mountId]!.state.question=undefined;await nextTick()
 expect(root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Draft"]')!.value).toBe('Retained child draft')
})

it('keeps an opened question mounted while returning to notes and retires it on worker replacement', async () => {
 const root=document.createElement('div');document.body.append(root)
 const state=reactive({sessionId:'parent-question',continuedInSessionId:'child-question',revision:1,operation:'refresh' as const,status:'done' as const,question:{id:'question',revision:'revision'},desktop:{ownerId:'one',parentSessionId:'parent-question',sessionId:'child-question',jobSessionId:'child-question',jobId:'11111111',pid:119,processStart:'one'},session:{id:'11111111',sessionId:'child-question',cwd:'/owned',pid:119,state:'working' as const}})
 let close!:()=>void
 app=createApp({render:()=>h(NativeBackgroundSession,{continuation:{sessionId:'parent-question',continuedInSessionId:'child-question',timestamp:'now'},state,canReply:true},{composer:(slot:{active:boolean;close():void})=>{close=slot.close;return h('input',{'aria-label':'Question draft','data-active':String(slot.active)})}})});app.mount(root)
 expect(root.querySelector('input')).toBeNull()
 const open=root.querySelector<HTMLButtonElement>('button[aria-label="Answer question"]')!
 open.click();await nextTick()
 const input=root.querySelector<HTMLInputElement>('input')!;input.value='Draft answer'
 close();await nextTick()
 expect(root.querySelector('input')).toBe(input)
 expect(input.dataset.active).toBe('false')
 open.click();await nextTick()
 expect(root.querySelector('input')).toBe(input);expect(input.value).toBe('Draft answer')
 close();await nextTick()
 state.desktop.ownerId='replacement';await nextTick()
 expect(root.querySelector('input')).toBeNull()
})
