import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {expect,type Page,type Locator} from '@playwright/test'

/** Observe the real shell before choosing a UI-12 repair; never infer acceptance from intersection. */
export async function measureWorkspaceLayout({page,composer,workspace,phase,capture}:{page:Page;composer:Locator;workspace:string;phase:'parent'|'agent';capture:(name:string)=>Promise<void>}){
 const original=await page.evaluate(()=>(window as any).applicationState.getSnapshot().context.panelSizes)
 const draft=await composer.textContent(),readings=[]
 try{
  for(const viewport of [{width:1100,height:900},{width:680,height:600}]){
   await page.setViewportSize(viewport)
   for(const state of ['initial','workspace'] as const){
    if(state==='workspace'){
     const grip=page.locator('.cursor-row-resize').first(),box=await grip.boundingBox()
     expect(box).toBeTruthy()
     await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2)
     await page.mouse.down();await page.mouse.move(box!.x+box!.width/2,viewport.height-200,{steps:10});await page.mouse.up()
    }
    await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))))
    const geometry=await page.evaluate(()=>{
     const result:Record<string,unknown>={}
     for(const [name,selector]of Object.entries({canvas:'[data-onboarding-id="canvas-area"]',chat:'[data-onboarding-id="chat-area"]',tabs:'[data-onboarding-id="agent-thread-tabs"]',artifacts:'[data-onboarding-id="agent-artifacts"]',shell:'.native-chat-shell',transcript:'[data-testid="chat-transcript"]'})){
      const element=document.querySelector<HTMLElement>(selector);if(!element){result[name]=null;continue}
      const r=element.getBoundingClientRect(),style=getComputedStyle(element),ancestors=[]
      for(let parent=element.parentElement;parent;parent=parent.parentElement){const s=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(s.overflow+s.overflowY)){const p=parent.getBoundingClientRect();ancestors.push({tag:parent.tagName,classes:parent.className,top:p.top,bottom:p.bottom,clientHeight:parent.clientHeight,scrollHeight:parent.scrollHeight,scrollTop:parent.scrollTop,overflowY:s.overflowY})}}
      result[name]={top:r.top,bottom:r.bottom,height:r.height,width:r.width,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop,minHeight:style.minHeight,flex:style.flex,ancestors}
     }
     return{elements:result,panelSizes:(window as any).applicationState.getSnapshot().context.panelSizes}
    })
    expect(await composer.textContent()).toBe(draft)
    readings.push({viewport,state,geometry})
    await capture(`native-workspace-${phase}-${state}-${viewport.width}.png`)
   }
   await page.evaluate(size=>(window as any).applicationState.send({type:'RESIZE_PANEL',panel:'canvas',size}),original.canvasHeight)
  }
 }finally{
  await page.evaluate(size=>(window as any).applicationState.send({type:'RESIZE_PANEL',panel:'canvas',size}),original.canvasHeight)
  await page.setViewportSize({width:1100,height:900})
  await writeFile(join(workspace,`native-workspace-${phase}-measurement.json`),JSON.stringify({status:'diagnostic-only',original,readings},null,2))
 }
}
