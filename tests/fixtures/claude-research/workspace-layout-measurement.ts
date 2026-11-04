import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {expect,type Page,type Locator} from '@playwright/test'

/** Observe the real shell before choosing a UI-12 repair; never infer acceptance from intersection. */
export async function measureWorkspaceLayout({page,composer,workspace,phase,capture}:{page:Page;composer:Locator;workspace:string;phase:'parent'|'agent';capture:(name:string)=>Promise<void>}){
 const original=await page.evaluate(()=>(window as any).applicationState.getSnapshot().context.panelSizes)
 const draft=await composer.textContent()
 if(draft===null)throw Error('The active composer has no readable document')
 const readings=[]
 const send=phase==='parent'?page.locator('[data-onboarding-id="agent-chat-input"]').getByRole('button',{name:'Send',exact:true}):page.getByRole('form',{name:'Agent message',exact:true}).getByRole('button',{name:'Send to Agent',exact:true})
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
    if(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT_ACCEPT==='1')await expect(send).toBeEnabled()
    const sendGeometry=await send.evaluate(element=>{const r=element.getBoundingClientRect();const points=[[r.left+r.width/4,r.top+r.height/4],[r.right-r.width/4,r.top+r.height/4],[r.left+r.width/4,r.bottom-r.height/4],[r.right-r.width/4,r.bottom-r.height/4]];return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,borderRadius:getComputedStyle(element).borderRadius,hit:points.every(([x,y])=>element.contains(document.elementFromPoint(x,y))),targets:points.map(([x,y])=>({x,y,elements:document.elementsFromPoint(x,y).slice(0,6).map(node=>({tag:node.tagName,classes:node.className,role:node.getAttribute('role'),text:node.textContent?.slice(0,100)}))})),ancestors:Array.from((function*(node:HTMLElement|null){for(;node;node=node.parentElement)yield node})(element.parentElement)).slice(0,9).map(node=>{const r=node.getBoundingClientRect(),style=getComputedStyle(node);return{tag:node.tagName,classes:node.className,top:r.top,bottom:r.bottom,height:r.height,overflow:style.overflow,position:style.position,zIndex:style.zIndex,pointerEvents:style.pointerEvents}})}})
    const composerGeometry=await composer.evaluate(element=>{const r=element.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,width:r.width,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}})
    const reading:Record<string,unknown>={viewport,state,geometry,composerGeometry,sendGeometry}
    readings.push(reading)
    if(process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT_ACCEPT==='1'){
     await expect(composer).toBeInViewport({ratio:1});await expect(send).toBeInViewport({ratio:1})
     if(process.env.CLAUDE_RESEARCH_AGENT_HIT_DIAGNOSTIC!=='1')expect(sendGeometry.hit,'Send is not clipped or obscured').toBe(true)
     expect(composerGeometry.clientHeight,'At least one complete draft line remains readable').toBeGreaterThanOrEqual(24)
     if(state==='workspace'||viewport.height===600){
      const elements=geometry.elements as Record<string,{height:number}>
      expect(elements.artifacts.height,'Workspace reading remains usable beside composing').toBeGreaterThanOrEqual(96)
      const artifacts=page.locator('[data-onboarding-id="agent-artifacts"]')
      const details=artifacts.locator('details').first(),summary=details.locator(':scope > summary')
      const bounds=await artifacts.boundingBox();expect(bounds).toBeTruthy()
      const summaryControl = () => summary.evaluate(element => {
       const r=element.getBoundingClientRect();let top=0,bottom=innerHeight,left=0,right=innerWidth
       for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(style.overflow+style.overflowY)){const p=parent.getBoundingClientRect();top=Math.max(top,p.top);bottom=Math.min(bottom,p.bottom);left=Math.max(left,p.left);right=Math.min(right,p.right)}}
       const points=[[r.left+r.width/4,r.top+r.height/4],[r.right-r.width/4,r.top+r.height/4],[r.left+r.width/4,r.bottom-r.height/4],[r.right-r.width/4,r.bottom-r.height/4]]
       return{top:r.top,bottom:r.bottom,height:r.height,fullyVisible:r.top>=top&&r.bottom<=bottom&&r.left>=left&&r.right<=right,hit:points.every(([x,y])=>element.contains(document.elementFromPoint(x,y)))}
      })
      let control=await summaryControl()
      if(!control.fullyVisible||!control.hit){
       await page.mouse.move(bounds!.x+bounds!.width*.85,bounds!.y+bounds!.height/2)
       await page.mouse.wheel(0,480)
       await expect(summary).toBeInViewport({ratio:1})
       control=await summaryControl()
      }
      reading.workspaceSummaryControl=control
      expect(control.fullyVisible,'Complete Session Details control is readable').toBe(true)
      expect(control.hit,'Session Details control is not obscured').toBe(true)
      await expect(summary).toBeInViewport({ratio:1})
      await summary.click();await expect(details).toHaveAttribute('open','')
      const session=details.locator('span.font-mono').first()
      const sessionBounds=await session.boundingBox();expect(sessionBounds).toBeTruthy()
      await page.mouse.move(bounds!.x+bounds!.width*.85,bounds!.y+bounds!.height/2)
      await page.mouse.wheel(0,sessionBounds!.y+sessionBounds!.height/2-(bounds!.y+bounds!.height/2))
      await expect(session).toBeInViewport({ratio:1})
      const sessionId=await page.evaluate(()=>(window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.context?.claudeCode?.sessionId)
      if(typeof sessionId!=='string'||!sessionId)throw Error('Workspace session identity is missing')
      const display=await session.innerText();expect(display).toContain(sessionId.slice(0,8))
      reading.workspaceReading={sessionId,display,summary:await summary.innerText(),visible:true}
      await expect(composer).toHaveText(draft)
      await expect(send).toBeInViewport({ratio:1})
      await capture(`native-workspace-${phase}-${state}-${viewport.width}.png`)
      await summary.click();await expect(details).not.toHaveAttribute('open','')
     }
    }
    // Reading states are captured with Details open above; keep one settled image per state.
    if(!reading.workspaceReading)await capture(`native-workspace-${phase}-${state}-${viewport.width}.png`)
   }
   await page.evaluate(size=>(window as any).applicationState.send({type:'RESIZE_PANEL',panel:'canvas',size}),original.canvasHeight)
  }
  if(process.env.CLAUDE_RESEARCH_AGENT_HIT_DIAGNOSTIC==='1')throw Error('Agent pointer diagnostics recorded; this run cannot establish acceptance')
 }finally{
  await writeFile(join(workspace,`native-workspace-${phase}-measurement.json`),JSON.stringify({status:process.env.CLAUDE_RESEARCH_WORKSPACE_LAYOUT_ACCEPT==='1'?'candidate-acceptance':'diagnostic-only',original,readings},null,2))
  await page.evaluate(size=>(window as any).applicationState.send({type:'RESIZE_PANEL',panel:'canvas',size}),original.canvasHeight)
  await page.setViewportSize({width:1100,height:900})
 }
}
