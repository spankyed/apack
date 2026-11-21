import {expect,type Locator,type Page} from '@playwright/test'

/** Read the complete rendered Help body using wheel input, retaining per-row viewport coverage. */
export async function readNativeHelpBody(page:Page,body:Locator){
 await body.hover();await page.mouse.wheel(0,-100000)
 await expect.poll(()=>body.evaluate(element=>element.scrollTop)).toBe(0)
 const coverage=new Map<number,{text:string;height:number;intervals:number[][]}>()
 let final:any
 for(let step=0;step<400;step++){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  const frame=await body.evaluate(element=>{
   const viewport=element.getBoundingClientRect(),top=viewport.top+element.clientTop,bottom=top+element.clientHeight
   return {top:element.scrollTop,height:element.clientHeight,total:element.scrollHeight,rows:Array.from(element.querySelectorAll('p,dl > div,a')).map((row,index)=>{const bounds=row.getBoundingClientRect();return {index,text:row.textContent??'',height:bounds.height,start:Math.max(0,top-bounds.top),end:Math.min(bounds.height,bottom-bounds.top)}})}
  })
  for(const row of frame.rows){
   const previous=coverage.get(row.index)
   if(previous){expect(previous.text).toBe(row.text);expect(Math.abs(previous.height-row.height)).toBeLessThan(1)}
   const reading=previous??{text:row.text,height:row.height,intervals:[]};if(row.end>row.start)reading.intervals.push([row.start,row.end]);coverage.set(row.index,reading)
  }
  final=frame
  if(frame.top+frame.height>=frame.total-1)break
  await page.mouse.wheel(0,Math.max(24,Math.floor(frame.height/2)))
 }
 expect(final.top+final.height).toBeGreaterThanOrEqual(final.total-1)
 expect(coverage.size).toBeGreaterThan(0)
 const rows=[...coverage.values()].map(row=>{
  let covered=0
  for(const [start,end] of row.intervals.sort((a,b)=>a[0]-b[0])){expect(start).toBeLessThanOrEqual(covered+1);covered=Math.max(covered,end)}
  expect(covered).toBeGreaterThanOrEqual(row.height-1)
  return {text:row.text,height:row.height,covered}
 })
 return {realWheel:true,atBottom:true,rows}
}
