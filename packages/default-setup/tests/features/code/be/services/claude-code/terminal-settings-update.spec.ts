import vm from 'node:vm'
import {createHash} from 'node:crypto'
import {claudeTerminalSettingsUpdateRuntime} from '#features/code/be/services/claude-code/terminal-settings-update-runtime.ts'
function fixture(){
 const Se=function OriginalUpdateModal(){},Xe=function OriginalUpdatePicker(){},Fi=Symbol('original-uncommitted'),cancel=vi.fn(),change=vi.fn()
 const modal:any={type:Se,memoizedProps:{title:'Enable Auto-Updates',onCancel:cancel,children:'Original environment restriction'}}
 const owner={child:modal},frame={panel:{hidden:true}},entry={settingsEditorKey:'autoUpdatesChannel',closed:false,answered:false,current:vi.fn()},format=vi.fn(async(_n:unknown,value:unknown)=>String(value))
 const source=claudeTerminalSettingsUpdateRuntime.replace("await import('/$bunfs/root/chunk-35cyt9ex.js')",'originalModal').replace("await import('/$bunfs/root/chunk-0d2czwx3.js')",'originalPicker')
 const read=vm.runInNewContext(source+';readNativeSettingsUpdate',{originalModal:{Se},originalPicker:{Xe,Fi},nativeSettingsConfig:()=>({frame,owner}),nativeGenericPermissionText:format,awaitNativeSettingsReading:async(value:unknown)=>value,sameNativeSettingsFiber:(a:unknown,b:unknown)=>a===b,currentNativeSettingsFiber:(_owner:unknown,fiber:unknown)=>fiber,createHash})
 return {read:(signal?:AbortSignal)=>read({},entry,signal),modal,owner,frame,entry,format,Se,Xe,Fi,cancel,change}
}
it('keeps native environment/development explanations read-only and preserves original Close',async()=>{
 const f=fixture(),result=await f.read()
 expect(result.snapshot).toEqual({kind:'information',title:'Enable Auto-Updates',description:'Original environment restriction'})
 expect(result.actions.onCancel).toBe(f.cancel);expect(result.actions.onChange).toBeUndefined();expect(f.cancel).not.toHaveBeenCalled()
 f.modal.memoizedProps.children='Original development restriction';expect((await f.read()).snapshot.description).toBe('Original development restriction')
})
it('uses original enable choices and callbacks without inventing or invoking writers',async()=>{
 const f=fixture();f.modal.memoizedProps.children={type:f.Xe,props:{selectedValue:f.Fi,options:[{value:'native-latest',label:'Original latest'},{value:'native-stable',label:'Original stable',disabled:true}],onChange:f.change}}
 const result=await f.read();expect(result.snapshot.options).toEqual([{value:'native-latest',label:'Original latest',disabled:false},{value:'native-stable',label:'Original stable',disabled:true}]);expect(result.snapshot.value).toBeUndefined()
 expect(result.actions.onChange).toBe(f.change);expect(result.actions.onCancel).toBe(f.cancel);expect(f.change).not.toHaveBeenCalled()
})
it('preserves version-aware downgrade text and original choice values',async()=>{
 const f=fixture();f.modal.memoizedProps={title:'Switch to Stable Channel',onCancel:f.cancel,children:['Original current version 2.1.302','Original downgrade warning',{type:f.Xe,props:{options:[{value:'native-stay',label:'Original stay on current version'},{value:'native-downgrade',label:'Original allow downgrade'}],onChange:f.change}}]}
 const result=await f.read();expect(result.snapshot.description).toContain('2.1.302');expect(result.snapshot.options.map((option:any)=>option.value)).toEqual(['native-stay','native-downgrade']);expect(result.actions.onCancel).toBe(f.cancel)
})
it('rejects duplicate options/dialogs, unsupported selection and asynchronous retirement',async()=>{
 const f=fixture();f.modal.sibling={...f.modal};await expect(f.read()).rejects.toThrow('ambiguous')
 const g=fixture();g.modal.memoizedProps.children={type:g.Xe,props:{options:[{value:'a',label:'A'},{value:'a',label:'Again'}],onChange:g.change}};await expect(g.read()).rejects.toThrow('option changed')
 const h=fixture();h.format.mockImplementationOnce(async()=>{h.entry.closed=true;return 'retired'});await expect(h.read()).rejects.toThrow('changed while reading')
 const i=fixture(),abort=new AbortController();abort.abort();await expect(i.read(abort.signal)).rejects.toThrow();expect(i.change).not.toHaveBeenCalled()
})
