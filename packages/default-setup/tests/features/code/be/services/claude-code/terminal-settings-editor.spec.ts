import vm from 'node:vm'
import { claudeTerminalSettingsEditorRuntime } from '#features/code/be/services/claude-code/terminal-settings-editor-runtime.ts'

function fixture(){
  const qh={Field:()=>{},Button:()=>{},Link:()=>{}},Config=()=>{},onClose=()=>{},open=vi.fn()
  const field={type:qh.Field,key:'model',props:{label:'Model',children:{type:qh.Button,props:{onPress:open}}}}
  const config:any={type:Config,memoizedProps:{onClose,setTabsHidden:()=>{},children:[field]}}
  const owner={child:config},frame={owner,panel:{}},entry={originalProps:{onClose},closed:false,answered:false,current:vi.fn()}
  let hash='f9c1d43d75a5b3536ba40462166d47979c88ee4e471ccbe19e493a83984d0707'
  const run=vm.runInNewContext(claudeTerminalSettingsEditorRuntime.replace("await import('/$bunfs/root/chunk-07y7va8x.js')",'originalControls')+';nativeSettingsEditorOpeners',{originalControls:{qh},nativeSettingsFrame:()=>frame,createHash:()=>({update:()=>({digest:()=>hash})})})
  return {qh,config,field,frame,entry,open,setHash:(value:string)=>{hash=value},read:()=>run({},entry)}
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
