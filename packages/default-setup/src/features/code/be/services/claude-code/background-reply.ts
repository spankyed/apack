import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {backgroundSession} from './background-sessions.ts'
import {execOnce,buildChildEnv} from './runner.ts'
import {claudeNativePlatformRuntime,rewriteClaudeNativePlatformSelectors} from './native-platform-runtime.ts'
import {claudeTerminalBackgroundReplyRuntime} from './terminal-background-reply-runtime.ts'
import type {SubcommandOptions} from './subcommand.ts'
import type {ClaudeNativeContinuation} from './terminal-session.ts'
import type {ClaudeBackgroundReplyRequest,ClaudeBackgroundSession} from '../../../common/native-background.ts'

const pending = new Set<string>()
const quote = (value:string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

/** A fresh original CLI sends to the existing supervisor; it never resumes or writes the conversation. */
export async function replyBackgroundSession(continuation:ClaudeNativeContinuation,request:ClaudeBackgroundReplyRequest,options:SubcommandOptions={}):Promise<ClaudeBackgroundSession> {
 if(typeof request.text!=='string'||!request.text.trim()||request.text.length>32768)throw Error('Invalid background reply')
 if(options.signal?.aborted)throw Error('Background reply cancelled')
 const env=buildChildEnv(options.env),key=JSON.stringify([env.CLAUDE_CONFIG_DIR,env.HOME,continuation.continuedInSessionId])
 if(pending.has(key))throw Error('A background reply is already pending')
 pending.add(key)
 let directory:string|undefined
 try{
  const current=await backgroundSession(continuation,{operation:'refresh'},options)
  if(!current||current.id!==request.id||current.pid!==request.pid||!Number.isSafeInteger(request.pid)||request.pid<=1||!['working','blocked'].includes(current.state))throw Error('Background session changed; refresh before sending')
  if(options.signal?.aborted)throw Error('Background reply cancelled')
  directory=await mkdtemp(join(process.platform==='darwin'?'/private/tmp':tmpdir(),'cc-reply-'))
  const preload=join(directory,'reply.mjs'),resultPath=join(directory,'result.json')
  const target={parent_session_id:continuation.sessionId,child_session_id:continuation.continuedInSessionId,job_id:current.id,pid:current.pid,cwd:current.cwd,text:request.text}
  const source=`import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const config={sessionId:${JSON.stringify(continuation.sessionId)}};
${claudeNativePlatformRuntime}
${rewriteClaudeNativePlatformSelectors(claudeTerminalBackgroundReplyRuntime)}
try{requireClaudeNativePlatform();const result=await replyNativeBackground(${JSON.stringify(target)});writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result),{mode:0o600});process.exit(0);}catch(error){process.stderr.write(String(error));process.exit(1);}`
  await writeFile(preload,source,{mode:0o600})
  if(options.signal?.aborted)throw Error('Background reply cancelled')
  await execOnce(['--version'],{...options,cwd:current.cwd,env:{...env,BUN_OPTIONS:(env.BUN_OPTIONS?env.BUN_OPTIONS+' ':'')+'--preload='+quote(preload)},timeoutMs:options.timeoutMs??15000})
  const result:unknown=JSON.parse(await readFile(resultPath,'utf8'))
  if(!result||typeof result!=='object'||!('queued' in result)||result.queued!==true)throw Error('Native background reply was not acknowledged')
  return current
 }finally{
  try{if(directory)await rm(directory,{recursive:true,force:true})}finally{pending.delete(key)}
 }
}
