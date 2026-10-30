/** Bind an inherited public hook to the original job and both current process incarnations. */
export const claudeTerminalBackgroundStatusRuntime = String.raw`
async function identifyNativeBackground(request){
 if(request.parent_session_id!==config.sessionId||typeof request.child_session_id!=='string'||!/^[a-f0-9-]{36}$/i.test(request.child_session_id)||request.child_session_id===config.sessionId||!Number.isSafeInteger(request.pid)||request.pid<=1||typeof request.cwd!=='string')throw Error('Invalid background status target');
 const jobs=await import('/$bunfs/root/chunk-tj6zgtfh.js'),roster=await jobs.uL({silent:true});
 const candidates=Object.entries(roster.workers).filter(([,worker])=>worker.replPid===request.pid&&worker.dispatch?.sessionId===request.child_session_id&&worker.dispatch.cwd===request.cwd);
 if(candidates.length!==1)throw Error('Background status worker changed');
 const [id,worker]=candidates[0];
 if(!/^[a-f0-9]{8}$/.test(id)||typeof worker.procStart!=='string'||!worker.procStart||typeof worker.replProcStart!=='string'||!worker.replProcStart||!await jobs.iZt(worker.replPid,worker.replProcStart)||!await jobs.iZt(worker.pid,worker.procStart))throw Error('Background status process retired');
 const directory=jobs.io(id);jobs.Kp(directory);const state=await jobs.Zr(directory);
 if(!state||state.sessionId!==request.child_session_id||state.cwd!==request.cwd||state.daemonShort!==id)throw Error('Background status job changed');
 return {jobId:id,sessionId:request.child_session_id,pid:worker.replPid,start:worker.replProcStart,hostPid:worker.pid,hostStart:worker.procStart,cwd:request.cwd};
}
`
