import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsRuntime } from '#features/code/be/services/claude-code/terminal-settings-runtime.ts'

function fixture() {
  let nativeEditor:any,openers=new Map()
  const editorOpening=vi.fn(async()=>{})
  const editorReading=vi.fn(async()=>nativeEditor),editorSaving=vi.fn(async(_signal:AbortSignal)=>({})),editorAction=vi.fn(async(_n:unknown,_entry:unknown,_request:unknown,_signal:AbortSignal)=>({}))
  let value = false
  let frame: any = {selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false}
  const writer = vi.fn(async (next: boolean) => { value = next })
  const context = {}, entry = { context, kind: 'panel', commandName: 'config', clientId: 'client', closed: false, answered: false, current: vi.fn(), dialogId: 'dialog', nodeId: 'node', store: { getState: () => ({ open: [{ id: 'dialog', kind: 'local_jsx', payload: { nodeId: 'node' } }] }) }, done: new Promise(() => {}) }
  const handles = () => [{ row: { key: 'tips', label: 'Show tips', kind: 'boolean', value, isLocked: false }, write: writer }, { row: { key: 'hidden', label: 'Hidden', kind: 'boolean', value: false, isLocked: false }, write: vi.fn() }]
  const api = { configRowHandles: vi.fn(handles) }
  const commit = vi.fn(async (request: any) => { await request.write(request.value); return { value: request.value } })
  const n = { gate: { _Jo: vi.fn() }, runtime: { p_r: vi.fn(async (row: any) => row.key === 'hidden' ? undefined : row), Ims: commit } }
  const source = claudeTerminalSettingsRuntime.replace("await import('/$bunfs/root/chunk-1ghyy712.js')", 'nativeSettingsApi').replace('await readNativeSettingsFrame(n,entry,signal)', 'settingsFrame()').replaceAll('await nativeSettingsEditorOpeners(n,entry)','settingsEditors()')
  const run = vm.runInNewContext(source + ';nativeSettingsMountedConsentRows=()=>[];waitForNativeSettingsConfig=async()=>{};readNativeSettingsEditor=editorReading;activateNativeSettingsEditor=editorOpening;saveNativeSettingsEditor=(_n,_entry,_revision,_values,signal)=>editorSaving(signal);actNativeSettingsEditor=editorAction;nativeSettings', { editorOpening,editorReading,editorSaving,editorAction,settingsFrame: () => frame, settingsEditors:()=>({openers}), nativeSettingsApi: api, agentCommandDialogs: new Map([['panel', entry]]), createHash, AbortController, setTimeout })
  const request = { client_id: 'client', panel_id: 'panel' }
  return { editorOpening,setOpeners:(next:Map<string,unknown>)=>{openers=next},setNativeEditor:(next:any)=>{nativeEditor=next},editorSaving,editorAction,setFrame: (next: any) => { frame = next }, setValue: (next: boolean) => { value = next }, n, entry, writer, commit, request, read: () => run(n, { ...request, operation: 'read' }, new AbortController()), run }
}
it('uses original description visibility and config.set coordinator instead of writing directly', async () => {
  const f = fixture(), before = await f.read()
  expect(before.snapshot.rows.map((row: any) => row.key)).toEqual(['tips'])
  expect(f.writer).not.toHaveBeenCalled()
  const result = await f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  expect(f.commit).toHaveBeenCalledOnce()
  expect(f.writer).toHaveBeenCalledExactlyOnceWith(true)
  expect(result.savedKey).toBe('tips'); expect(result.snapshot.rows[0].value).toBe(true)
})
it('preserves native denial and refuses a stale snapshot before invoking the coordinator', async () => {
  const f = fixture(), before = await f.read()
  await expect(f.run(f.n, { ...f.request, operation: 'write', revision: 'old', key: 'tips', value: true }, new AbortController())).rejects.toThrow('changed')
  expect(f.commit).not.toHaveBeenCalled()
  f.commit.mockImplementationOnce(async () => ({ deny: 'Managed by original policy' }) as any)
  const result = await f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  expect(result.problem).toBe('Managed by original policy'); expect(result.savedKey).toBeUndefined(); expect(f.writer).not.toHaveBeenCalled()
})
it('refuses a native hook-held write after its panel closes', async () => {
  const f = fixture(), before = await f.read()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  f.commit.mockImplementationOnce(async request => { await held; await request.write(request.value); return { value: request.value } })
  const result = f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  await vi.waitFor(() => expect(f.commit).toHaveBeenCalledOnce())
  f.entry.closed = true; release()
  await expect(result).rejects.toThrow('expired'); expect(f.writer).not.toHaveBeenCalled()
})

it('keeps an accepted scalar write pending until native value acknowledgement without replay', async () => {
  const f=fixture(),before=await f.read();let land!:()=>void
  f.writer.mockImplementationOnce(async next=>{land=()=>f.setValue(next)})
  const result=await f.run(f.n,{...f.request,operation:'write',revision:before.snapshot.revision,key:'tips',value:true},new AbortController())
  expect(result.snapshot.commitPending).toBe(true);expect(result.savedKey).toBeUndefined();expect(result.problem).toBeUndefined();expect(result.snapshot.rows[0].value).toBe(false)
  await expect(f.run(f.n,{...f.request,operation:'write',revision:result.snapshot.revision,key:'tips',value:true},new AbortController())).rejects.toThrow('pending')
  land();const acknowledged=await f.read();expect(acknowledged.snapshot.commitPending).toBeUndefined();expect(acknowledged.savedKey).toBe('tips');expect(acknowledged.snapshot.rows[0].value).toBe(true);expect(f.writer).toHaveBeenCalledOnce()
})
it('expires scalar acknowledgement honestly and never marks a withdrawn row saved',async()=>{
 const f=fixture(),before=await f.read();f.writer.mockImplementation(async()=>{})
 await f.run(f.n,{...f.request,operation:'write',revision:before.snapshot.revision,key:'tips',value:true},new AbortController())
 ;(f.entry as any).settingsCommit.until=0;const expired=await f.read();expect(expired.snapshot.commitPending).toBeUndefined();expect(expired.savedKey).toBeUndefined();expect(expired.problem).toContain('not acknowledged');expect(f.writer).toHaveBeenCalledOnce()
 ;(f.entry as any).settingsCommit={key:'tips',before:false,until:Date.now()+5000,scalar:true};f.n.runtime.p_r.mockResolvedValue(undefined)
 const removed=await f.read();expect(removed.savedKey).toBeUndefined();expect(removed.problem).toContain('no longer available')
})

it('keeps timed copy feedback out of action authority while retaining selected-tab fences', async () => {
  const f = fixture(), frame = {selectedTab:'Stats',tabs:['Status','Config','Usage','Stats'],hidden:false,stats:{view:'Overview',range:'all',loading:false,outcome:'success',copyState:'saved'}}
  f.setFrame(frame); const before = await f.read()
  f.setFrame({...frame,stats:{...frame.stats,copyState:'idle'}})
  expect((await f.read()).snapshot.revision).toBe(before.snapshot.revision)
  f.setFrame({...frame,selectedTab:'Config'})
  expect((await f.read()).snapshot.revision).not.toBe(before.snapshot.revision)
})

it('cancels only the owned pending editor lease after native draft revisions advance',async()=>{
 const f=fixture(),owner={},editor={owner,revision:'a'.repeat(64),snapshot:{kind:'form',title:'Original editor',submitLabel:'Save',fields:[{key:'value',label:'Value',value:'old'}]}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor)
 const before=await f.read();let heldSignal:AbortSignal|undefined
 f.editorSaving.mockImplementationOnce(async(signal:AbortSignal)=>{heldSignal=signal;f.setNativeEditor({...editor,revision:'b'.repeat(64),snapshot:{...editor.snapshot,fields:[{key:'value',label:'Value',value:'new'}]}});return await new Promise<{}>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
 const request={...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision}
 const saving=f.run(f.n,{...request,command:{action:'save',values:{value:'new'}}},new AbortController()).catch((error:Error)=>error)
 await vi.waitFor(()=>expect(f.editorSaving).toHaveBeenCalledOnce())
 f.editorAction.mockImplementationOnce(async()=>{f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false});return {}})
 const cancelled=await f.run(f.n,{...request,command:{action:'cancel'}},new AbortController())
 expect(heldSignal?.aborted).toBe(true);expect((await saving).message).toContain('cancelled')
 expect(f.editorAction.mock.calls[0][2]).toEqual({action:'cancel',revision:'b'.repeat(64)})
 expect(cancelled.snapshot.editor).toBeUndefined();expect((f.entry as any).settingsEditorLease).toBeUndefined()
})
it('refuses stale cancellation tokens and never invokes Cancel on a replacement editor owner',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'form',title:'Original',submitLabel:'Save',fields:[]}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor)
 const before=await f.read();let heldSignal:AbortSignal|undefined
 f.editorSaving.mockImplementationOnce(async(signal:AbortSignal)=>{heldSignal=signal;return await new Promise<{}>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
 const request={...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision}
 const saving=f.run(f.n,{...request,command:{action:'save',values:{}}},new AbortController()).catch((error:Error)=>error)
 await vi.waitFor(()=>expect(f.editorSaving).toHaveBeenCalledOnce())
 await expect(f.run(f.n,{...request,editor_revision:'retired',command:{action:'cancel'}},new AbortController())).rejects.toThrow('changed before cancellation');expect(heldSignal?.aborted).toBe(false)
 f.setNativeEditor({...editor,owner:{}})
 await expect(f.run(f.n,{...request,command:{action:'cancel'}},new AbortController())).rejects.toThrow('owner changed before cancellation')
 await saving;expect(f.editorAction).not.toHaveBeenCalled();expect(heldSignal?.aborted).toBe(true)
})

it('publishes bounded native commit waiting and settles from original row changes without replaying a writer',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'choice',options:[{value:'true',label:'On',disabled:false}],disabled:false,value:'false'}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='tips'
 const before=await f.read();f.editorAction.mockImplementationOnce(async()=>{f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false});return {}})
 const changed=await f.run(f.n,{...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command:{action:'select',value:'true'}},new AbortController())
 expect(changed.snapshot.commitPending).toBe(true);expect(changed.snapshot.rows[0].value).toBe(false)
 f.setValue(true);const acknowledged=await f.read();expect(acknowledged.snapshot.commitPending).toBeUndefined();expect(acknowledged.snapshot.rows[0].value).toBe(true)
 expect(f.editorAction).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled()
 ;(f.entry as any).settingsCommit={key:'tips',before:true,until:0};const timedOut=await f.read()
 expect(timedOut.problem).toContain('not acknowledged');expect(timedOut.snapshot.commitPending).toBeUndefined()
})

it('tracks Language form acknowledgement by its native field and avoids waiting on an unchanged default draft',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'form',title:'Language',submitLabel:'Save',fields:[{key:'language',label:'Language',value:'French'}]}}
 f.n.runtime.p_r.mockImplementation(async(row:any)=>row.key==='tips'?{...row,key:'language',kind:'string',value:'French'}:undefined)
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='language'
 const before=await f.read();f.editorSaving.mockImplementation(async()=>{f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false});return {}})
 const changed=await f.run(f.n,{...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command:{action:'save',values:{language:''}}},new AbortController())
 expect(changed.snapshot.commitPending).toBe(true)
 delete (f.entry as any).settingsCommit
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor({...editor,snapshot:{...editor.snapshot,fields:[{key:'language',label:'Language',value:''}]}})
 const reset=await f.read();const unchanged=await f.run(f.n,{...f.request,operation:'editor',revision:reset.snapshot.revision,editor_revision:editor.revision,command:{action:'save',values:{language:'   '}}},new AbortController())
 expect(unchanged.snapshot.commitPending).toBeUndefined();expect(f.writer).not.toHaveBeenCalled()
})

it.each([{action:'preview',value:'true'},{action:'toggleSyntax'}])('does not publish a Config commit wait for a Theme presentation action %j',async(command)=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'choice',options:[{value:'true',label:'Light',disabled:false}],value:'false',disabled:false,canPreview:true,canToggleSyntax:true}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='tips'
 const before=await f.read();const result=await f.run(f.n,{...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command},new AbortController())
 expect(result.snapshot.commitPending).toBeUndefined();expect(f.editorAction).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled();expect(f.commit).not.toHaveBeenCalled()
})

it('keeps an exact live editor usable across unrelated Config updates but rejects retired or locked editors',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'choice',options:[{value:'light',label:'Light',disabled:false}],value:'light',disabled:false,canToggleSyntax:true}}
 let other=false,locked=false
 f.n.runtime.p_r.mockImplementation(async(row:any)=>row.key==='tips'?{...row,key:'theme',kind:'choice',value:'light',isLocked:locked}:{...row,key:'other',value:other})
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='theme'
 const before=await f.read();other=true
 const request={...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command:{action:'toggleSyntax'}}
 await f.run(f.n,request,new AbortController());expect(f.editorAction).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled()
 locked=true;await expect(f.run(f.n,request,new AbortController())).rejects.toThrow('changed');expect(f.editorAction).toHaveBeenCalledOnce()
 locked=false;f.setNativeEditor({...editor,revision:'b'.repeat(64)});await expect(f.run(f.n,request,new AbortController())).rejects.toThrow('changed');expect(f.editorAction).toHaveBeenCalledOnce()
})

it('does not wait for a row change when the original choice is selected again',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'choice',options:[{value:'native-default',label:'Default',disabled:false}],value:'native-default',disabled:false}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='tips'
 const before=await f.read();f.editorAction.mockImplementationOnce(async()=>{f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false});return {}})
 const result=await f.run(f.n,{...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command:{action:'select',value:'native-default'}},new AbortController())
 expect(result.snapshot.commitPending).toBeUndefined();expect(f.editorAction).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled()
})

it('does not turn a declined consent into a pending scalar write or bypass its original decision',async()=>{
 const f=fixture(),editor={owner:{},revision:'a'.repeat(64),snapshot:{kind:'choice',options:[{value:'cancel',label:'No',disabled:false},{value:'confirm',label:'Yes',disabled:false}],disabled:false,consent:{description:'Original warning',cancelLabel:'No',defaultFocusValue:'cancel'}}}
 f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:true});f.setNativeEditor(editor);(f.entry as any).settingsEditorKey='tips'
 const before=await f.read();f.editorAction.mockImplementationOnce(async()=>{f.setFrame({selectedTab:'Config',tabs:['Status','Config','Usage','Stats'],hidden:false});return {}})
 const result=await f.run(f.n,{...f.request,operation:'editor',revision:before.snapshot.revision,editor_revision:editor.revision,command:{action:'select',value:'cancel'}},new AbortController())
 expect(result.snapshot.commitPending).toBeUndefined();expect(f.editorAction).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled();expect(f.commit).not.toHaveBeenCalled()
})

it('follows delayed native acknowledgement for direct stable-to-latest opens without replaying the callback',async()=>{
 const f=fixture();let channel='stable'
 f.n.runtime.p_r.mockImplementation(async(row:any)=>row.key==='tips'?{...row,key:'autoUpdatesChannel',kind:'text',value:channel}:undefined)
 f.setOpeners(new Map([['autoUpdatesChannel',{}]]));const before=await f.read()
 const result=await f.run(f.n,{...f.request,operation:'open',revision:before.snapshot.revision,key:'autoUpdatesChannel'},new AbortController())
 expect(result.snapshot.commitPending).toBe(true);expect(result.snapshot.rows[0].value).toBe('stable');expect(f.editorOpening).toHaveBeenCalledOnce();expect(f.writer).not.toHaveBeenCalled()
 channel='latest';const settled=await f.read();expect(settled.snapshot.commitPending).toBeUndefined();expect(settled.snapshot.rows[0].value).toBe('latest');expect(f.editorOpening).toHaveBeenCalledOnce()
})
it('does not hold update picker admission as a pending channel write',async()=>{
 const f=fixture();f.n.runtime.p_r.mockImplementation(async(row:any)=>row.key==='tips'?{...row,key:'autoUpdatesChannel',kind:'text',value:'latest'}:undefined)
 f.setOpeners(new Map([['autoUpdatesChannel',{}]]));const before=await f.read()
 f.editorOpening.mockImplementationOnce(async()=>{f.setFrame({selectedTab:'Config',tabs:['Config'],hidden:true});f.setNativeEditor({revision:'a'.repeat(64),snapshot:{kind:'choice',title:'Switch to Stable Channel',options:[],disabled:false}})})
 const result=await f.run(f.n,{...f.request,operation:'open',revision:before.snapshot.revision,key:'autoUpdatesChannel'},new AbortController())
 expect(result.snapshot.commitPending).toBeUndefined();expect(result.snapshot.editor.title).toBe('Switch to Stable Channel');expect(f.editorOpening).toHaveBeenCalledOnce()
})
