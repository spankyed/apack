import {createApp,h,nextTick,provide,type App} from 'vue'
import NativeUiClient from '#features/threads/fe/chat/NativeUiClient.vue'
import {claudeClientInput,claudeClientReturnFocus} from '#features/threads/fe/chat/native-client-input.ts'
let app:App|undefined
const pointer=(type:string,init:MouseEventInit&{pointerId:number})=>Object.assign(new MouseEvent(type,init),{pointerId:init.pointerId})
const id='9b08a63e-78f6-46c5-9134-c6c64de30937'
afterEach(()=>{app?.unmount();app=undefined;document.body.replaceChildren();vi.restoreAllMocks()})
async function mount(returnFocus?:()=>void){
 const send=vi.fn(),root=document.createElement('div');document.body.append(root)
 app=createApp({setup(){provide(claudeClientInput,send);if(returnFocus)provide(claudeClientReturnFocus,returnFocus);return()=>h(NativeUiClient,{node:{kind:'client',id,keys:true,pointer:true,layout:{width:'50%',height:4,flexGrow:1},children:[]}},()=>[h('textarea',{'aria-label':'Nested editor'}),h('button',{type:'button'},'Client action')])}});app.mount(root);await nextTick();await new Promise(resolve=>setTimeout(resolve,0))
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
 vi.spyOn(measure,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,800,20))
 const capture=vi.fn(),release=vi.fn();Object.assign(region,{setPointerCapture:capture,hasPointerCapture:()=>true,releasePointerCapture:release})
 region.dispatchEvent(pointer('pointerdown',{pointerId:7,clientX:110,clientY:110,button:0,buttons:1,bubbles:true}))
 expect(capture).toHaveBeenCalledWith(7)
 expect(send).toHaveBeenCalledWith(id,expect.objectContaining({kind:'pointer',type:'down',x:1,y:0,fine:{x:1.25,y:0.5},button:'left'}))
 region.dispatchEvent(pointer('pointermove',{pointerId:7,clientX:90,clientY:180,buttons:1,bubbles:true,cancelable:true}))
 region.dispatchEvent(pointer('pointerup',{pointerId:7,clientX:90,clientY:180,button:0,bubbles:true}))
 expect(send).toHaveBeenCalledWith(id,expect.objectContaining({type:'move',x:-2,y:4,fine:{x:-1.25,y:4}}))
 expect(release).toHaveBeenCalledWith(7)
 region.dispatchEvent(pointer('pointerleave',{pointerId:7,clientX:300,clientY:300,bubbles:true}))
 expect(send).toHaveBeenLastCalledWith(id,expect.objectContaining({type:'leave',x:-2,y:4}))
})

it('gives the Client keyboard focus after its button click while leaving nested text input local',async()=>{
 const {region,root}=await mount();root.querySelector('button')!.click();expect(document.activeElement).toBe(region)
 const input=root.querySelector('textarea')!;input.focus();input.click();expect(document.activeElement).toBe(input)
})

it('does not activate a captured child button when the pointer is released outside it',async()=>{
 const {region,root}=await mount(),button=root.querySelector('button')!,press=vi.fn(),original=document.elementFromPoint
 button.addEventListener('click',press)
 try{
  document.elementFromPoint=()=>document.body
  button.dispatchEvent(pointer('pointerdown',{pointerId:7,clientX:10,clientY:10,button:0,buttons:1,bubbles:true}))
  button.dispatchEvent(pointer('pointerup',{pointerId:7,clientX:200,clientY:200,button:0,bubbles:true}))
  button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))
  expect(press).not.toHaveBeenCalled();expect(document.activeElement).toBe(region)
  document.elementFromPoint=()=>button
  button.dispatchEvent(pointer('pointerdown',{pointerId:8,clientX:10,clientY:10,button:0,buttons:1,bubbles:true}))
  button.dispatchEvent(pointer('pointerup',{pointerId:8,clientX:10,clientY:10,button:0,bubbles:true}))
  button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));expect(press).toHaveBeenCalledTimes(1)
 }finally{document.elementFromPoint=original}
})

it('uses native space naming and releases Client focus on control-C/control-D without delivering them',async()=>{
 const {region,root,send}=await mount(),site=document.createElement('div');site.className='native-extension-surface';site.tabIndex=0;root.before(site);site.append(root)
 region.focus();region.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))
 expect(send).toHaveBeenCalledWith(id,{kind:'key',key:'space'});send.mockClear()
 for(const key of ['c','d']){region.focus();const event=new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true});region.dispatchEvent(event);expect(document.activeElement).toBe(site);expect(event.defaultPrevented).toBe(false)}
 region.focus();region.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true,cancelable:true}));expect(send).not.toHaveBeenCalled()
})

it('returns terminal placement Client keyboard ownership to the composer without sending control keys',async()=>{
 const target=document.createElement('input');document.body.append(target);const focus=vi.fn(()=>target.focus()),{root,region,send}=await mount(focus)
 root.setAttribute('data-native-placement','InfoNotice');send.mockClear()
 for(const key of ['Escape','c','d']){region.focus();const event=new KeyboardEvent('keydown',{key,ctrlKey:key!=='Escape',bubbles:true,cancelable:true});region.dispatchEvent(event);expect(document.activeElement).toBe(target);expect(event.defaultPrevented).toBe(true)}
 expect(focus).toHaveBeenCalledTimes(3);expect(send).not.toHaveBeenCalled()
})

it('reports intrinsic cell geometry without rounding its fractional CSS width down a cell',async()=>{
 let resize!:()=>void
 vi.stubGlobal('ResizeObserver',class {constructor(callback:()=>void){resize=callback}observe(){}disconnect(){}})
 try{
 const {region,send}=await mount(),measure=region.querySelector<HTMLElement>('span')!
 const bounds=vi.spyOn(region,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,39.140625,20))
 vi.spyOn(measure,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,782.65625,20))
 Object.defineProperty(region,'clientWidth',{configurable:true,value:39})
 send.mockClear()
 resize()
 await new Promise(resolve=>requestAnimationFrame(resolve))
 expect(send).toHaveBeenCalledWith(id,{kind:'resize',columns:5,rows:1})
 bounds.mockReturnValue(new DOMRect(0,0,93.90625,20));resize()
 await new Promise(resolve=>requestAnimationFrame(resolve))
 expect(send).toHaveBeenLastCalledWith(id,{kind:'resize',columns:12,rows:1})
 bounds.mockReturnValue(new DOMRect(0,0,39,20));resize()
 await new Promise(resolve=>requestAnimationFrame(resolve))
 expect(send).toHaveBeenLastCalledWith(id,{kind:'resize',columns:4,rows:1})
 }finally{vi.unstubAllGlobals()}
})
