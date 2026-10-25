import vm from 'node:vm'
import { claudeTerminalSettingsEditorRuntime } from '#features/code/be/services/claude-code/terminal-settings-editor-runtime.ts'

function fixture(){
  const qh={Field:()=>{},Button:()=>{},Link:()=>{}},Config=()=>{},onClose=()=>{},open=vi.fn()
  const field={type:qh.Field,key:'model',props:{label:'Model',children:{type:qh.Button,props:{onPress:open}}}}
  const config:any={type:Config,memoizedProps:{onClose,setTabsHidden:()=>{},children:[field]}}
  const owner={child:config},frame={owner,panel:{selectedTab:'Config',hidden:false}},entry={originalProps:{onClose},closed:false,answered:false,current:vi.fn()}
  let hash='f9c1d43d75a5b3536ba40462166d47979c88ee4e471ccbe19e493a83984d0707'
  const run=vm.runInNewContext(claudeTerminalSettingsEditorRuntime.replace("await import('/$bunfs/root/chunk-07y7va8x.js')",'originalControls')+';({nativeSettingsEditorOpeners,activateNativeSettingsEditor})',{originalControls:{qh},nativeSettingsFrame:()=>frame,awaitNativeSettingsReading:async(value:unknown)=>value,createHash:()=>({update:()=>({digest:()=>hash})})})
  return {qh,config,field,frame,entry,open,setHash:(value:string)=>{hash=value},read:()=>run.nativeSettingsEditorOpeners({},entry),activate:(keys=new Set(['model']),signal?:AbortSignal)=>run.activateNativeSettingsEditor({},entry,'model',keys,signal)}
}
it('finds original editor callbacks in owned element props before the field mounts',async()=>{
  const f=fixture(),result=await f.read()
  expect(result.openers.get('model').label).toBe('Model');expect(result.openers.get('model').callback).toBe(f.open)
  expect(f.open).not.toHaveBeenCalled()
  f.field.props.children.props={onPress:f.open,disabled:true} as any
  expect((await f.read()).openers.size).toBe(0)
})
it('refuses changed Config producers and duplicate original editor keys',async()=>{
  const f=fixture();f.setHash('changed');await expect(f.read()).rejects.toThrow('producer changed')
  const g=fixture();g.config.memoizedProps.children.push({...g.field,props:{...g.field.props,children:{type:g.qh.Button,props:{onPress:()=>{}}}}})
  await expect(g.read()).rejects.toThrow('ambiguous')
})
it('rejects a retired owner after discovery and does not search its siblings',async()=>{
  const f=fixture();(f.frame.owner as any).sibling={...f.config}
  expect((await f.read()).openers.size).toBe(1)
  f.entry.current.mockImplementation(()=>{f.entry.closed=true})
  await expect(f.read()).rejects.toThrow('owner changed');expect(f.open).not.toHaveBeenCalled()
})

it('opens only visible, active original Config editors and preserves their callback result',async()=>{
 const f=fixture();f.open.mockResolvedValue('original open result')
 expect(await f.activate()).toBe('original open result');expect(f.open).toHaveBeenCalledExactlyOnceWith()
 await expect(f.activate(new Set())).rejects.toThrow('no longer visible')
 f.frame.panel.hidden=true;await expect(f.activate()).rejects.toThrow('unavailable')
 f.frame.panel.hidden=false;f.frame.panel.selectedTab='Stats';await expect(f.activate()).rejects.toThrow('unavailable')
 expect(f.open).toHaveBeenCalledOnce()
})
it('refuses cancellation and callback replacement immediately before original activation',async()=>{
 const f=fixture(),cancelled=new AbortController();cancelled.abort()
 await expect(f.activate(undefined,cancelled.signal)).rejects.toThrow();expect(f.open).not.toHaveBeenCalled()
 const g=fixture(),replacement=vi.fn();let checks=0
 g.entry.current.mockImplementation(()=>{if(++checks===1)g.field.props.children.props.onPress=replacement})
 await expect(g.activate()).rejects.toThrow('changed before opening');expect(g.open).not.toHaveBeenCalled();expect(replacement).not.toHaveBeenCalled()
})
