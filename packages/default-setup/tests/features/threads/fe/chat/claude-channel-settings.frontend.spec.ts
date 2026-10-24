import {createApp,h,nextTick,type App} from 'vue'
import ClaudeChannelSettings from '#features/threads/fe/chat/ClaudeChannelSettings.vue'
let app:App|undefined
beforeEach(()=>{HTMLDialogElement.prototype.showModal=vi.fn();HTMLDialogElement.prototype.close=vi.fn()})
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren()})
function mount(locked=false){const save=vi.fn(),close=vi.fn(),root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(ClaudeChannelSettings,{channels:['plugin:review@owned'],locked,onSave:save,onClose:close})});app.mount(root);return {root,save,close,field:root.querySelector('textarea')!}}
it('opens a modal, preserves selectors and refuses flag-shaped values before saving',async()=>{
 const f=mount();expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();expect(f.field.value).toBe('plugin:review@owned')
 f.field.value='--dangerously-load-development-channels';f.field.dispatchEvent(new Event('input'));await nextTick();(f.root.querySelectorAll('button')[1] as HTMLButtonElement).click();await nextTick();expect(f.save).not.toHaveBeenCalled();expect(f.root.querySelector('[role=alert]')?.textContent).toContain('not CLI flags')
 f.field.value='plugin:notes@owned\nreview';f.field.dispatchEvent(new Event('input'));await nextTick();(f.root.querySelectorAll('button')[1] as HTMLButtonElement).click();expect(f.save).toHaveBeenCalledWith(['plugin:notes@owned','review'])
})
it('locks selection during native work but leaves cancellation available',()=>{
 const f=mount(true);expect(f.field.disabled).toBe(true);expect((f.root.querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(true);(f.root.querySelectorAll('button')[0] as HTMLButtonElement).click();expect(f.close).toHaveBeenCalledOnce();expect(f.save).not.toHaveBeenCalled()
})
