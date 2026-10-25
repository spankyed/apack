import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalSettingsRuntime } from '#features/code/be/services/claude-code/terminal-settings-runtime.ts'

function fixture() {
  let nativeEditor:any
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
  const run = vm.runInNewContext(source + ';readNativeSettingsEditor=editorReading;saveNativeSettingsEditor=(_n,_entry,_revision,_values,signal)=>editorSaving(signal);actNativeSettingsEditor=editorAction;nativeSettings', { editorReading,editorSaving,editorAction,settingsFrame: () => frame, settingsEditors:()=>({openers:new Map()}), nativeSettingsApi: api, agentCommandDialogs: new Map([['panel', entry]]), createHash, AbortController, setTimeout })
  const request = { client_id: 'client', panel_id: 'panel' }
  return { setNativeEditor:(next:any)=>{nativeEditor=next},editorSaving,editorAction,setFrame: (next: any) => { frame = next }, setValue: (next: boolean) => { value = next }, n, entry, writer, commit, request, read: () => run(n, { ...request, operation: 'read' }, new AbortController()), run }
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

it('waits for the original settings cache to observe a queued write before publishing saved state', async () => {
  const f = fixture(), before = await f.read()
  f.writer.mockImplementationOnce(async next => { setTimeout(() => f.setValue(next), 20) })
  const result = await f.run(f.n, { ...f.request, operation: 'write', revision: before.snapshot.revision, key: 'tips', value: true }, new AbortController())
  expect(result.savedKey).toBe('tips'); expect(result.snapshot.rows[0].value).toBe(true)
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
