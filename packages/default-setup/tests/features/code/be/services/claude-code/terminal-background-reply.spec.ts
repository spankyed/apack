import { claudeTerminalBackgroundReplyRuntime } from '#features/code/be/services/claude-code/terminal-background-reply-runtime.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
const parent = '24be904a-3c35-4981-9793-cbe7a6c19d46', child = '05ff1d31-597d-4537-8737-4407191add6e'
function fixture() {
  const state = {sessionId:child,cwd:'/owned',daemonShort:'05ff1d31'}
  const worker = {pid:100,procStart:'host-start',replPid:119,replProcStart:'owned-start',dispatch:{sessionId:child,cwd:'/owned'}}
  const jobs = {io:vi.fn(() => '/original-job'),Kp:vi.fn(),Zr:vi.fn(async () => state),uL:vi.fn(async () => ({workers:{'05ff1d31':worker}})),iZt:vi.fn(async () => true)}
  const Ptt = vi.fn(async () => null), load = vi.fn(async (name:string) => name === 'chunk-tj6zgtfh.js' ? jobs : {Ptt})
  const digest = vi.fn(() => 'reviewed'), update = vi.fn(() => ({digest})), hash = vi.fn(() => ({update}))
  const source = rewriteClaudeNativePlatformSelectors(claudeTerminalBackgroundReplyRuntime)
  const api = new Function('config','importClaudeNativeModule','createHash','nativeFunctionHash',source+';return replyNativeBackground')({sessionId:parent},load,hash,()=> 'reviewed')
  const request = {parent_session_id:parent,child_session_id:child,job_id:'05ff1d31',pid:119,cwd:'/owned',text:'Follow up on the review.'}
  return {api,request,state,worker,jobs,Ptt,load,digest,update}
}
it('uses original identity, liveness and next-turn reply with the original known state', async () => {
  const f=fixture();await expect(f.api(f.request)).resolves.toEqual({queued:true})
  expect(f.jobs.Kp).toHaveBeenCalledWith('/original-job');expect(f.jobs.iZt).toHaveBeenCalledWith(119,'owned-start');expect(f.jobs.iZt).toHaveBeenCalledWith(100,'host-start')
  expect(f.Ptt).toHaveBeenCalledExactlyOnceWith('05ff1d31',f.request.text,undefined,f.state,undefined,undefined,{nextTurn:true})
  expect(f.update).toHaveBeenCalledWith(Function.prototype.toString.call(f.Ptt))
})
it.each(['parent','child','pid','cwd','missing-start','liveness','fingerprint'])('refuses a stale %s before native reply', async kind => {
  const f=fixture()
  if(kind==='parent')f.request.parent_session_id=child
  if(kind==='child')f.state.sessionId=parent
  if(kind==='pid')f.worker.replPid=120
  if(kind==='cwd')f.worker.dispatch.cwd='/replacement'
  if(kind==='missing-start')f.worker.replProcStart=''
  if(kind==='liveness')f.jobs.iZt.mockResolvedValue(false)
  if(kind==='fingerprint')f.digest.mockReturnValue('changed')
  await expect(f.api(f.request)).rejects.toThrow();expect(f.Ptt).not.toHaveBeenCalled()
})
it('preserves the original refusal and never retries the adapter call', async () => {
  const f=fixture();f.Ptt.mockResolvedValue({err:'Original native refusal'} as never)
  await expect(f.api(f.request)).rejects.toThrow('Original native refusal');expect(f.Ptt).toHaveBeenCalledOnce()
})
it('does not accept a second reply while the first original operation is unresolved', async () => {
  const f=fixture();let finish!:(value:null)=>void;f.Ptt.mockImplementation(() => new Promise(resolve=>{finish=resolve}))
  const first=f.api(f.request);await vi.waitFor(()=>expect(f.Ptt).toHaveBeenCalledOnce())
  await expect(f.api(f.request)).rejects.toThrow('already pending');finish(null);await first;f.Ptt.mockResolvedValue(null)
  await expect(f.api(f.request)).resolves.toEqual({queued:true})
})
