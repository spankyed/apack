import {createApp,h,nextTick,reactive,type App} from 'vue'
import NativeBackgroundComposer from '#features/threads/fe/chat/NativeBackgroundComposer.vue'
import type {ClaudeUiMountState,ClaudeUiQuestionFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
const captured=vi.hoisted(()=>({questions:[] as {run():void}[],approvals:[] as {run():void}[],send:vi.fn()}))
let context:{nativeUiViews:Record<string,{threadId:string;attachmentId:string;state:ClaudeUiMountState}>},app:App|undefined
vi.mock('@apackdev/sdk/fe',()=>({useSurface:()=>({send:captured.send,getSnapshot:()=>({context,status:'active'})})}))
vi.mock('@xstate/vue',async()=>{const{computed}=await import('vue');return{useSelector:(_actor:unknown,select:(value:unknown)=>unknown)=>computed(()=>select({context}))}})
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue',()=>({default:{render:()=>null}}))
vi.mock('#features/threads/fe/chat/NativeQuestionDrawing.vue',async()=>{const{getCurrentInstance,h}=await import('vue');return{default:{props:['frame'],setup(props:{frame:ClaudeUiQuestionFrame}){const identity={messageId:props.frame.messageId,token:props.frame.token!},listener=getCurrentInstance()!.vnode.props!.onRespond as (...args:unknown[])=>void;captured.questions.push({run:()=>listener({answers:{Same:'Alpha'}},identity)});return()=>h('div')}}}})
vi.mock('#features/threads/fe/chat/NativeBackgroundApproval.vue',async()=>{const{getCurrentInstance,h}=await import('vue');return{default:{props:['frame'],setup(props:{frame:{id:string}}){const id=props.frame.id,listener=getCurrentInstance()!.vnode.props!.onAnswer as (...args:unknown[])=>void;captured.approvals.push({run:()=>listener(id,{approved:false})});return()=>h('div')}}}})
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren()})
it('never retargets queued old responses even when the replacement asks the same question or needs a tokenless denial',async()=>{
 captured.questions.length=0;captured.approvals.length=0;captured.send.mockClear();context=reactive({nativeUiViews:{}})
 const root=document.createElement('div');document.body.append(root)
 app=createApp({render:()=>h(NativeBackgroundComposer,{threadId:'thread',target:{ownerId:'owner',parentSessionId:'parent',sessionId:'child',jobId:'11111111',pid:119,processStart:'start'},draft:'',disabled:false,send:async()=>{}})});app.mount(root)
 const mount=captured.send.mock.calls.find(([event])=>event.type==='CLAUDE_UI_MOUNT')![0]
 const question=(id:string):ClaudeUiQuestionFrame=>({messageId:id,id:'dialog',revision:id,draftActionId:id,token:id,body:{status:'rendering'}})
 context.nativeUiViews[mount.mountId]={threadId:'thread',attachmentId:'attached',state:{status:'disconnected',question:question('first')}};await nextTick()
 const oldQuestion=captured.questions[0]!
 context.nativeUiViews[mount.mountId]!.state={status:'disconnected',question:question('replacement')};await nextTick()
 oldQuestion.run();expect(captured.send.mock.calls.filter(([event])=>event.type==='CLAUDE_UI_QUESTION_ANSWER')).toHaveLength(0)
 captured.questions.at(-1)!.run();expect(captured.send).toHaveBeenLastCalledWith(expect.objectContaining({type:'CLAUDE_UI_QUESTION_ANSWER',messageId:'replacement',token:'replacement'}))
 const approval=(id:string)=>({id,control:{kind:'bash' as const,dialog:{id:'dialog',revision:id,sessionId:'child',requestId:'tool',toolName:'Bash' as const,command:'printf original',cwd:'/owned',input:{}}}})
 context.nativeUiViews[mount.mountId]!.state={status:'disconnected',approval:approval('first')};await nextTick()
 const oldApproval=captured.approvals[0]!
 context.nativeUiViews[mount.mountId]!.state={status:'disconnected',approval:approval('replacement')};await nextTick()
 oldApproval.run();expect(captured.send.mock.calls.filter(([event])=>event.type==='CLAUDE_UI_APPROVAL_ANSWER')).toHaveLength(0)
 captured.approvals.at(-1)!.run();expect(captured.send).toHaveBeenLastCalledWith(expect.objectContaining({type:'CLAUDE_UI_APPROVAL_ANSWER',frameId:'replacement',answer:{approved:false}}))
})
