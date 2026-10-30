/** Use the original agents-view reply path; this does not give the parent a child UI owner. */
export const claudeTerminalBackgroundReplyRuntime = String.raw`
let nativeBackgroundReplyPending=false;
async function replyNativeBackground(request){
 if(request.parent_session_id!==config.sessionId||typeof request.child_session_id!=='string'||!/^[a-f0-9-]{36}$/i.test(request.child_session_id)||request.child_session_id===config.sessionId
  ||typeof request.job_id!=='string'||!/^[a-f0-9]{8}$/.test(request.job_id)||!Number.isSafeInteger(request.pid)||request.pid<=1||typeof request.cwd!=='string'
  ||typeof request.text!=='string'||!request.text.trim()||request.text.length>32768)throw Error('Invalid background reply target');
 if(nativeBackgroundReplyPending)throw Error('A background reply is already pending');
 nativeBackgroundReplyPending=true;
 try{
  const processIdentity=await import('/$bunfs/root/chunk-0xj14bee.js');
 const jobs=await import('/$bunfs/root/chunk-tj6zgtfh.js');
  const directory=jobs.io(request.job_id);jobs.Kp(directory);
  const state=await jobs.Zr(directory),roster=await jobs.uL({silent:true}),worker=roster.workers[request.job_id];
  if(!state||state.sessionId!==request.child_session_id||state.cwd!==request.cwd||state.daemonShort!==request.job_id||!worker||worker.replPid!==request.pid
   ||typeof worker.procStart!=='string'||!worker.procStart||typeof worker.replProcStart!=='string'||!worker.replProcStart
   ||worker.dispatch?.sessionId!==request.child_session_id||worker.dispatch.cwd!==request.cwd||await processIdentity.jh(worker.replPid,worker.replProcStart)!==true||!await jobs.iZt(worker.replPid,worker.replProcStart)||await processIdentity.jh(worker.pid,worker.procStart)!==true||!await jobs.iZt(worker.pid,worker.procStart))throw Error('Background session changed; refresh before sending');
  const reply=await import('/$bunfs/root/chunk-mnx9wh8s.js');
  if(createHash('sha256').update(Function.prototype.toString.call(reply.Ptt)).digest('hex')!=='c3b67e62aaed8df6ac6850195265ab5bcc7c66780b78befd952b0033174efb5c')throw Error('Original background reply contract changed');
  // Supplying original known state keeps native refusal handling from persisting a fallback queued prompt.
  const result=await reply.Ptt(request.job_id,request.text,undefined,state,undefined,undefined,{nextTurn:true});
  if(result!==null)throw Error(typeof result?.err==='string'?result.err:'Native background reply was not acknowledged');
  return {queued:true};
 }finally{nativeBackgroundReplyPending=false;}
}
`
