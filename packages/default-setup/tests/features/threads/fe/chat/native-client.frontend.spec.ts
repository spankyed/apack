import {createApp,h,nextTick,provide,type App} from 'vue'
import NativeUiClient from '#features/threads/fe/chat/NativeUiClient.vue'
import {claudeClientInput} from '#features/threads/fe/chat/native-client-input.ts'
let app:App|undefined
const pointer=(type:string,init:MouseEventInit&{pointerId:number})=>Object.assign(new MouseEvent(type,init),{pointerId:init.pointerId})
const id='9b08a63e-78f6-46c5-9134-c6c64de30937'
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren();vi.restoreAllMocks()})
async function mount(){
 const send=vi.fn(),root=document.createElement('div');document.body.append(root)
 app=createApp({setup(){provide(claudeClientInput,send);return()=>h(NativeUiClient,{node:{kind:'client',id,keys:true,pointer:true,layout:{width:'50%',height:4,flexGrow:1},children:[]}},()=>[h('textarea',{'aria-label':'Nested editor'}),h('button',{type:'button'},'Client action')])}});app.mount(root);await nextTick()
 return {root,send,region:root.querySelector<HTMLElement>('[data-native-client]')!}
}
it('routes native key names and modifiers while preserving composition, Escape and nested input',async()=>{
 const {region,root,send}=await mount();region.focus()
 const arrow=new KeyboardEvent('keydown',{key:'ArrowLeft',ctrlKey:true,bubbles:true,cancelable:true});region.dispatchEvent(arrow)
 expect(send).toHaveBeenCalledWith(id,{kind:'key',key:'left',ctrl:true});expect(arrow.defaultPrevented).toBe(true)
 send.mockClear()
 for(const key of [new KeyboardEvent('keydown',{key:'x',isComposing:true,bubbles:true}),new KeyboardEvent('keydown',{key:'Escape',bubbles:true})])region.dispatchEvent(key)
 root.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true}))
 expect(send).not.toHaveBeenCalled()
 expect(region.style.width).toBe('50%');expect(region.style.height).toBe('4lh');expect(region.style.flexGrow).toBe('1')
})
it('reports fractional region coordinates and retains pointer capture outside its bounds',async()=>{
 const {region,send}=await mount(),measure=region.querySelector<HTMLElement>('span')!
 vi.spyOn(region,'getBoundingClientRect').mockReturnValue(new DOMRect(100,100,160,60))
 vi.spyOn(measure,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,80,20))
 const capture=vi.fn(),release=vi.fn();Object.assign(region,{setPointerCapture:capture,hasPointerCapture:()=>true,releasePointerCapture:release})
 region.dispatchEvent(pointer('pointerdown',{pointerId:7,clientX:110,clientY:110,button:0,buttons:1,bubbles:true}))
 expect(capture).toHaveBeenCalledWith(7)
 expect(send).toHaveBeenCalledWith(id,expect.objectContaining({kind:'pointer',type:'down',x:1,y:0,fine:{x:1.25,y:0.5},button:'left'}))
 region.dispatchEvent(pointer('pointermove',{pointerId:7,clientX:90,clientY:180,buttons:1,bubbles:true,cancelable:true}))
 region.dispatchEvent(pointer('pointerup',{pointerId:7,clientX:90,clientY:180,button:0,bubbles:true}))
 expect(send).toHaveBeenCalledWith(id,expect.objectContaining({type:'move',x:-2,y:4,fine:{x:-1.25,y:4}}))
 expect(release).toHaveBeenCalledWith(7)
})

it('gives the Client keyboard focus after its button click while leaving nested text input local',async()=>{
 const {region,root}=await mount();root.querySelector('button')!.click();expect(document.activeElement).toBe(region)
 const input=root.querySelector('textarea')!;input.focus();input.click();expect(document.activeElement).toBe(input)
})
