import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {expect,type Page,type Locator} from '@playwright/test'

/** Real DOM selections travel through the original native API and private reply channel. */
export async function verifySelectionLimit({appPage,card,composer,project,context,capture}:{appPage:Page;card:Locator;composer:Locator;project:string;context:()=>Promise<any>;capture:(name:string)=>Promise<void>}){
 const before=await context(),proof:unknown[]=[]
 const receipts=async()=>JSON.parse(await readFile(join(project,'native-selection-limit-receipts.json'),'utf8').catch(()=>'[]'))
 const button=card.getByRole('button',{name:'Read current selection',exact:true})
 const notes=card.getByRole('textbox',{name:'Selection review notes',exact:true})
 await card.getByRole('button',{name:'Session tools',exact:true}).click()
 await expect(notes).toBeVisible()
 await notes.focus();await notes.press(process.platform==='darwin'?'Meta+A':'Control+A')
 await button.click();await expect.poll(async()=>(await receipts()).length).toBe(1)
 expect((await receipts())[0]).toEqual({selected:true,value:{text:'Current release notes'}})
 await notes.focus();await notes.press('ArrowRight')
 await button.click();await expect.poll(async()=>(await receipts()).length).toBe(2)
 expect((await receipts())[1]).toEqual({selected:false})
 for(const [name,text] of [['cjk','漢'.repeat(1_000_000)],['astral','👋'.repeat(500_000)],['oversized','漢'.repeat(1_000_001)]]){
  await composer.fill(text)
  await composer.evaluate(root=>{const range=document.createRange();range.selectNodeContents(root);const selected=document.getSelection()!;selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'))})
  const count=(await receipts()).length
  await button.click();await expect.poll(async()=>(await receipts()).length).toBe(count+1)
  const receipt=(await receipts()).at(-1)
  if(name==='oversized')expect(receipt).toEqual({selected:false})
  else expect(receipt).toEqual({selected:true,value:{text}})
  proof.push({name,length:text.length,sha256:createHash('sha256').update(text).digest('hex'),selected:receipt.selected})
 }
 await composer.fill('Keep this draft after reading selected release notes.')
 await composer.evaluate(root=>{const range=document.createRange();range.selectNodeContents(root);const selected=document.getSelection()!;selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'))})
 await button.click();await expect.poll(async()=>(await receipts()).length).toBe(6)
 const recovered='Keep this draft after reading selected release notes.'
 expect((await receipts())[5]).toEqual({selected:true,value:{text:recovered}})
 proof.push({name:'recovery',length:recovered.length,sha256:createHash('sha256').update(recovered).digest('hex'),selected:true})
 for(const width of [1100,680]){
  await appPage.setViewportSize({width,height:width===680?600:900})
  await expect(composer).toHaveText('Keep this draft after reading selected release notes.')
  await expect(button).toBeInViewport();await expect(card.getByRole('button',{name:'Send',exact:true})).toBeInViewport()
  await capture('native-selection-limit-'+width+'.png')
 }
 const after=await context()
 expect(after.messages).toEqual(before.messages);expect(after.turns).toBe(before.turns)
 expect(after.claude.totalCostUsd).toBe(before.claude.totalCostUsd)
 expect(after.native.state.nativePid).toBe(before.native.state.nativePid)
 await writeFile(join(project,'native-selection-limit-proof.json'),JSON.stringify({proof,before,after,fieldSelectionRetired:true},null,2))
 await card.getByRole('button',{name:'Session tools',exact:true}).click()
 await appPage.setViewportSize({width:1100,height:900})
}
