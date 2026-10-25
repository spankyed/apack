import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsGroupRuntime } from '#features/code/be/services/claude-code/terminal-settings-group-runtime.ts'
function fixture(key='agentsView'){
 const qh={Field:()=>{},Toggle:()=>{},Select:()=>{}},Se=()=>{},onCancel=vi.fn(),onChange=vi.fn(),Notifications=function OriginalNotifications(){}
 const field={type:qh.Field,key:'native-row',props:{label:'Original toggle',children:{type:qh.Toggle,props:{value:true,onChange}}}}
 const group:any={type:Se,memoizedProps:{title:key==='agentsView'?'Agents view':'Notifications',onCancel,children:[field]}}
 const notification:any={type:Notifications,memoizedProps:{onClose:onCancel},child:group}
 const owner:any={child:key==='agentsView'?group:notification},frame={panel:{hidden:true},owner},entry={settingsEditorKey:key,closed:false,answered:false,current:vi.fn()}
 const format=vi.fn(async(_n:unknown,v:unknown)=>String(v))
 const source=claudeTerminalSettingsGroupRuntime.replace("await import('/$bunfs/root/chunk-07y7va8x.js')",'controls').replace("await import('/$bunfs/root/chunk-35cyt9ex.js')",'container')
 const read=vm.runInNewContext(source+';readNativeSettingsGroup',{controls:{qh},container:{Se},nativeSettingsConfig:()=>({frame,owner}),nativeGenericPermissionText:format,awaitNativeSettingsReading:async(v:unknown)=>v,sameNativeSettingsFiber:(a:unknown,b:unknown)=>a===b,currentNativeSettingsFiber:(root:any,target:any)=>{const stack=[root];while(stack.length){const n=stack.pop();if(n===target)return n;if(n.child)stack.push(n.child);if(n.sibling)stack.push(n.sibling)}throw Error('retired fiber')},createHash:()=>({update:(v:string)=>({digest:()=>v===Notifications.toString()?'dc69f6b8da2820e90db5876a9b0dac418417f9833f4280b1ec91ef4bb84757e2':createHash('sha256').update(v).digest('hex')})})})
 return {read:(signal?:AbortSignal)=>read({},entry,signal),field,group,notification,owner,frame,entry,format,qh,onCancel,onChange}
}
it('reads original grouped toggles without invoking or inventing controls',async()=>{
 const f=fixture(),result=await f.read()
 expect(result.snapshot).toEqual({kind:'group',title:'Agents view',rows:[{key:'native-row',label:'Original toggle',kind:'boolean',value:true,disabled:false}]})
 expect(result.actions.get('native-row').callback).toBe(f.onChange);expect(result.onCancel).toBe(f.onCancel)
 expect(f.onCancel).not.toHaveBeenCalled();expect(f.onChange).not.toHaveBeenCalled()
 f.group.memoizedProps.children=[];expect((await f.read()).snapshot.rows).toEqual([])
})
it('keeps native Notifications channel options, disabled state and conditional row admission',async()=>{
 const f=fixture('notifChannel')
 f.field.props.children={type:f.qh.Select,props:{value:'original',onChange:f.onChange,disabled:true,options:[{value:'original',label:'Original channel'},{value:'other',label:'Other',disabled:true}]}} as any
 const row=(await f.read()).snapshot.rows[0]
 expect(row.kind).toBe('choice');expect(row.disabled).toBe(true);expect(row.options).toEqual([{value:'original',label:'Original channel',disabled:false},{value:'other',label:'Other',disabled:true}])
 expect((await f.read()).snapshot.rows).toHaveLength(1)
 f.notification.memoizedProps.onClose=()=>{};await expect(f.read()).rejects.toThrow('owner changed')
})
it('rejects duplicate keys and unsupported controls rather than silently omitting them',async()=>{
 const f=fixture();f.group.memoizedProps.children.push({...f.field});await expect(f.read()).rejects.toThrow('exceeded bound')
 const g=fixture();g.field.props.children.type=()=>{};await expect(g.read()).rejects.toThrow('control changed')
})
it('rejects cancellation, retired props and owner retirement during asynchronous formatting',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();await expect(f.read(abort.signal)).rejects.toThrow()
 const g=fixture();g.format.mockImplementationOnce(async()=>{g.group.memoizedProps={...g.group.memoizedProps};return 'retired'});await expect(g.read()).rejects.toThrow('changed while reading')
 const h=fixture();h.entry.current.mockImplementation(()=>{h.entry.closed=true});await expect(h.read()).rejects.toThrow('changed while reading')
})
