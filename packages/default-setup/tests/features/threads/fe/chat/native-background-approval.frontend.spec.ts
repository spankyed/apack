import {createApp,h,reactive,nextTick,type App} from 'vue'
import NativeBackgroundApproval from '#features/threads/fe/chat/NativeBackgroundApproval.vue'
import type {ClaudeUiApprovalFrame} from '#features/code/be/services/claude-code/ui-presentation.ts'
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor',async()=>{const{h}=await import('vue');return{default:{props:['modelValue'],render(this:{modelValue:string}){return h('pre',this.modelValue)}}}})
let app:App|undefined
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren()})
it('shows original child command/choices and emits its exact token with a separate notes-return action',async()=>{
 const token='a'.repeat(64),answer=vi.fn(),leave=vi.fn(),root=document.createElement('div');document.body.append(root)
 const frame=reactive<ClaudeUiApprovalFrame>({id:'frame',control:{kind:'bash',dialog:{id:'dialog',revision:'revision',sessionId:'child',requestId:'tool',toolName:'Bash',command:'printf "<script>literal</script>"',cwd:'/owned',input:{},choices:[{value:'yes',label:'Yes',token}],choiceToken:'b'.repeat(64)}}})
 app=createApp({render:()=>h(NativeBackgroundApproval,{frame,disabled:false,onAnswer:answer,onLeave:leave})});app.mount(root)
 expect(root.querySelector('script')).toBeNull();expect(root.textContent).toContain('printf "<script>literal</script>"')
 ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Allow once')!.click()
 expect(answer).toHaveBeenCalledWith('frame',{approved:true,choice:'yes',choiceToken:token})
 ;[...root.querySelectorAll('button')].find(button=>button.textContent==='Back to parent notes')!.click();expect(leave).toHaveBeenCalledOnce()
 frame.pending=true;await nextTick();expect([...root.querySelectorAll('button')].every(button=>button.disabled)).toBe(true)
})
it('offers no unbacked Bash allow when the original choice is not ready',()=>{
 const root=document.createElement('div');document.body.append(root)
 const frame:ClaudeUiApprovalFrame={id:'frame',control:{kind:'bash',dialog:{id:'dialog',revision:'revision',sessionId:'child',requestId:'tool',toolName:'Bash',command:'printf original',cwd:'/owned',input:{}}}}
 app=createApp({render:()=>h(NativeBackgroundApproval,{frame,disabled:false})});app.mount(root)
 expect([...root.querySelectorAll('button')].find(button=>button.textContent==='Allow once')!.disabled).toBe(true)
 expect([...root.querySelectorAll('button')].find(button=>button.textContent==='Deny')!.disabled).toBe(false)
})
