import {describe,expect,it,vi} from 'vitest'
import {createClaudeNativeEditorLease,type ClaudeNativeEditorScope} from '#features/code/be/services/claude-code/native-editor-lease.ts'

function fixture(){
 const scope:ClaudeNativeEditorScope={pid:41,sessionId:'session-one',clientId:'window-one',panelId:'permissions-one'}
 let owner:{pid:number;sessionId:string}|undefined={pid:scope.pid,sessionId:scope.sessionId}
 let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void
 const native=new Promise((yes,no)=>{resolve=yes;reject=no}),invoke=vi.fn(()=>native),release=vi.fn(),hold=vi.fn(()=>release),respond=vi.fn(),changed=vi.fn(),failed=vi.fn(),ownsChild=vi.fn(async()=>true)
 const lease=createClaudeNativeEditorLease({current:()=>owner,ownsChild,changed,failed})
 const offer={pid:42,parentPid:41,fileIdentity:'a'.repeat(64),content:'Original environment\n'}
 return {scope,lease,invoke,hold,release,respond,changed,failed,ownsChild,offer,resolve,reject,replace:()=>{owner={pid:51,sessionId:scope.sessionId}},begin:()=>lease.begin(scope,invoke,hold)}
}

describe('original external-editor invocation lifetime',()=>{
 it('passes a native operation through without manufacturing an editor',async()=>{
  const f=fixture(),result=f.begin(),original={snapshot:{native:true}};f.resolve(original)
  await expect(result).resolves.toEqual({kind:'native',value:original});expect(f.invoke).toHaveBeenCalledOnce();expect(f.lease.active).toBeUndefined();expect(f.hold).not.toHaveBeenCalled()
  expect(await f.lease.offer(f.offer,f.respond)).toBe(false)
 })
 it('returns one editor offer, then the original native validation result after save',async()=>{
  const f=fixture(),opening=f.begin();expect(await f.lease.offer(f.offer,f.respond)).toBe(true)
  const offered=await opening;expect(offered.kind).toBe('editor');const editor=f.lease.active!;expect(editor.content).toBe(f.offer.content);expect(f.hold).toHaveBeenCalledOnce()
  const finish=f.lease.finish(f.scope,editor.revision,{kind:'save',content:'Updated environment\n'});expect(f.respond).toHaveBeenCalledExactlyOnceWith({kind:'save',content:'Updated environment\n'});expect(f.release).toHaveBeenCalledOnce()
  const original={snapshot:{nativeValidation:'rejected'},problem:'Original validation reason'};f.resolve(original);await expect(finish).resolves.toBe(original)
  expect(f.invoke).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledOnce();expect(f.lease.active).toBeUndefined()
 })
 it('cancels without submitting replacement text or writing a setting',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  const finish=f.lease.finish(f.scope,f.lease.active!.revision,{kind:'cancel'});expect(f.respond).toHaveBeenCalledExactlyOnceWith({kind:'cancel'})
  f.resolve({problem:'No changes detected'});await expect(finish).resolves.toEqual({problem:'No changes detected'})
 })
 it('rejects foreign children and rechecks ownership after asynchronous admission',async()=>{
  const f=fixture(),opening=f.begin();void opening.catch(()=>{})
  expect(await f.lease.offer({...f.offer,parentPid:99},f.respond)).toBe(false);expect(f.ownsChild).not.toHaveBeenCalled()
  f.ownsChild.mockImplementation(async()=>{f.replace();return true});expect(await f.lease.offer(f.offer,f.respond)).toBe(false);expect(f.hold).not.toHaveBeenCalled();f.lease.close()
 })
 it('refuses stale revisions, foreign clients and duplicate decisions',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening;const revision=f.lease.active!.revision
  await expect(f.lease.finish({...f.scope,clientId:'another-window'},revision,{kind:'save',content:'foreign'})).rejects.toThrow(/changed/)
  await expect(f.lease.finish(f.scope,'stale',{kind:'save',content:'stale'})).rejects.toThrow(/changed/);expect(f.respond).not.toHaveBeenCalled()
  const finish=f.lease.finish(f.scope,revision,{kind:'cancel'});await expect(f.lease.finish(f.scope,revision,{kind:'cancel'})).rejects.toThrow(/changed/);f.resolve({});await finish;expect(f.respond).toHaveBeenCalledOnce()
 })
 it('retains the editor on unrelated detach and cancels only its owning client',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  f.lease.detach('another-window');expect(f.lease.active).toBeDefined();expect(f.respond).not.toHaveBeenCalled()
  f.lease.detach(f.scope.clientId);expect(f.respond).toHaveBeenCalledExactlyOnceWith({kind:'cancel'});expect(f.release).toHaveBeenCalledOnce();expect(f.lease.active).toBeUndefined()
 })
 it('reports original native failures and closes the outstanding child once',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  f.reject(new Error('Original operation failed'));await vi.waitFor(()=>expect(f.failed).toHaveBeenCalledOnce());expect(f.respond).toHaveBeenCalledExactlyOnceWith({kind:'cancel'});expect(f.release).toHaveBeenCalledOnce();expect(f.lease.active).toBeUndefined()
 })
 it('expires an offered editor on owner replacement and admits fresh native work',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  f.replace();expect(f.lease.active).toBeUndefined();expect(f.respond).toHaveBeenCalledExactlyOnceWith({kind:'cancel'});expect(f.release).toHaveBeenCalledOnce()
  await expect(f.lease.begin({...f.scope,pid:51},async()=>({fresh:true}),f.hold)).resolves.toEqual({kind:'native',value:{fresh:true}})
 })

 it('returns the native failure after a child disconnect without sending another decision',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  f.lease.disconnect('another-editor');expect(f.lease.active!.closing).toBe(false)
  f.lease.disconnect(f.lease.active!.id);expect(f.lease.active!.closing).toBe(true);expect(f.release).toHaveBeenCalledOnce();expect(f.respond).not.toHaveBeenCalled();expect(f.failed).toHaveBeenCalledOnce()
  f.resolve({problem:'Original editor quit unexpectedly'});await vi.waitFor(()=>expect(f.lease.active).toBeUndefined());expect(f.respond).not.toHaveBeenCalled()
 })
 it('reports ownership-check failure without opening an editor or replacing the native result',async()=>{
  const f=fixture(),opening=f.begin();f.ownsChild.mockRejectedValue(new Error('Broker unavailable'))
  expect(await f.lease.offer(f.offer,f.respond)).toBe(false);expect(f.failed).toHaveBeenCalledOnce();expect(f.hold).not.toHaveBeenCalled()
  f.resolve({problem:'Original editor failed'});await expect(opening).resolves.toEqual({kind:'native',value:{problem:'Original editor failed'}})
 })
 it('reports a native failure after save exactly once',async()=>{
  const f=fixture(),opening=f.begin();await f.lease.offer(f.offer,f.respond);await opening
  const finish=f.lease.finish(f.scope,f.lease.active!.revision,{kind:'save',content:'Updated'})
  f.reject(new Error('Native validation transport failed'));await expect(finish).rejects.toThrow('Native validation transport failed');expect(f.failed).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledOnce();expect(f.respond).toHaveBeenCalledOnce()
 })

})
