import { CLAUDE_QUESTION_IMAGE_REFUSAL } from '../../../common/native-ui-problem.ts'
import { claudeTerminalHelperPolicyReaderRuntime } from './terminal-helper-policy-reader-runtime.ts'
import { claudeTerminalEffortNudgeRuntime } from './terminal-effort-nudge-runtime.ts'
import { claudeTerminalAutoModeSafetyRuntime } from './terminal-auto-mode-safety-runtime.ts'
import { claudeTerminalComputerPermissionRuntime } from './terminal-computer-permission-runtime.ts'
import { claudeTerminalChromeSetupRuntime } from './terminal-chrome-setup-runtime.ts'
import { claudeTerminalHelperPolicyRuntime } from './terminal-helper-policy-runtime.ts'
import { CLAUDE_UI_CONTROL_RESPONSE_MAX_BYTES, CLAUDE_UI_PROMPT_RPC_SUBTYPES, CLAUDE_UI_TEXT_MAX_LENGTH, CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES } from './ui-text-limits.ts'
import { claudeTerminalBackgroundReplyRuntime } from './terminal-background-reply-runtime.ts'
import { claudeTerminalLeftArrowRuntime } from './terminal-leftarrow-runtime.ts'
import { claudeTerminalBackgroundRuntime } from './terminal-background-runtime.ts'
import { claudeTerminalPublishPluginRuntime } from './terminal-publish-plugin-runtime.ts'
import { claudeTerminalSandboxNetworkRuntime } from './terminal-sandbox-network-runtime.ts'
import { claudeTerminalBrowserPermissionRuntime } from './terminal-browser-permission-runtime.ts'
import { claudeTerminalManagedSecurityRuntime } from './terminal-managed-security-runtime.ts'
import { claudeTerminalAutocompactOfferRuntime } from './terminal-autocompact-offer-runtime.ts'
import { claudeTerminalPeerApprovalRuntime } from './terminal-peer-approval-runtime.ts'
import { claudeTerminalGoalProposalRuntime } from './terminal-goal-proposal-runtime.ts'
import { claudeTerminalIdeOnboardingRuntime } from './terminal-ide-onboarding-runtime.ts'
import { claudeTerminalFullscreenOfferRuntime } from './terminal-fullscreen-offer-runtime.ts'
import { claudeTerminalResumeReturnRuntime } from './terminal-resume-return-runtime.ts'
import { claudeTerminalRemoteCalloutRuntime } from './terminal-remote-callout-runtime.ts'
import { claudeTerminalUltraplanChoiceRuntime } from './terminal-ultraplan-choice-runtime.ts'
import { claudeTerminalUltraplanLaunchRuntime } from './terminal-ultraplan-launch-runtime.ts'
import { claudeTerminalCostWarningRuntime } from './terminal-cost-warning-runtime.ts'
import { claudeTerminalColdQuotaRuntime } from './terminal-cold-quota-runtime.ts'
import { claudeTerminalRefusalRuntime } from './terminal-refusal-runtime.ts'
import { claudeTerminalPluginHintRuntime } from './terminal-plugin-hint-runtime.ts'
import { claudeTerminalSettingsRuntime } from './terminal-settings-runtime.ts'
import { claudeTerminalLspRecommendationRuntime } from './terminal-lsp-recommendation-runtime.ts'
import { claudeManagedSettingsDiagnosticRuntime } from './native-managed-settings-runtime.ts'
import { claudeTerminalMcpUrlRuntime } from './terminal-mcp-url-runtime.ts'
import { claudeTerminalMcpPolicyRuntime } from './terminal-mcp-policy-runtime.ts'
import { claudeTerminalMcpFormRuntime } from './terminal-mcp-form-runtime.ts'
import { claudeTerminalGenericPermissionRuntime } from './terminal-generic-permission-runtime.ts'
import { claudeTerminalPowerShellRuntime } from './terminal-powershell-runtime.ts'
import { claudeTerminalToolPermissionRuntime } from './terminal-tool-permission-runtime.ts'
import { claudeTerminalStreamRuntime } from './terminal-stream-runtime.ts'
import { claudeNativeToolResultRuntime } from './native-tool-result-runtime.ts'
import { withClaudeNativePlatformRuntime } from './native-platform-runtime.ts'
import { claudeTerminalRasterRuntime } from './terminal-raster-runtime.ts'
import { claudeTerminalQuestionCountdownRuntime } from './terminal-question-countdown-runtime.ts'
import { claudeTerminalFocusRuntime } from './terminal-focus-runtime.ts'
import { claudeTerminalWorkflowRuntime } from './terminal-workflow-runtime.ts'
import { claudeNativeThemeRuntime } from './native-theme-runtime.ts'
import { claudeTerminalDocumentRuntime } from './terminal-document-runtime.ts'
import { claudeTerminalBashRuntime } from './terminal-bash-runtime.ts'
import { claudeTerminalFileRuntime } from './terminal-file-runtime.ts'
import { claudeTerminalHistoryPlacementRuntime } from './terminal-history-placement-runtime.ts'
import { claudeTerminalComposerRuntime } from './terminal-composer-runtime.ts'
import { claudeTerminalToolGroupRuntime, claudeTerminalToolGroupDrawingRuntime } from './terminal-tool-group-runtime.ts'
import { claudeTerminalToolProgressRuntime } from './terminal-tool-progress-runtime.ts'
import { claudeTerminalToolUseRuntime } from './terminal-tool-use-runtime.ts'
import { claudeTerminalDiagnosticRuntime } from './terminal-diagnostic-runtime.ts'
import { claudeTerminalToolOutputRuntime } from './terminal-tool-output-runtime.ts'
import { claudeTerminalInstanceRuntime } from './terminal-instance-runtime.ts'
import { claudeTerminalParentCommandRuntime } from './terminal-parent-command-runtime.ts'
import { claudeTerminalFileCompletionRuntime } from './terminal-file-completion-runtime.ts'
import { claudeTerminalAgentInputRuntime } from './terminal-agent-input-runtime.ts'
import { claudeTerminalTaskRuntime } from './terminal-task-runtime.ts'
import { claudeTerminalClientRuntime } from './terminal-client-runtime.ts'
import { claudeTerminalInlineModelRuntime } from './terminal-inline-model-runtime.ts'
import { claudeTerminalActionKeyRuntime } from './terminal-action-key-runtime.ts'
/** Authored adapter to reviewed embedded native exports; no recovered vendor files are executed. */
import { CLAUDE_QUESTION_IMAGE_BYTES, CLAUDE_QUESTION_IMAGE_COUNT, CLAUDE_QUESTION_IMAGE_TYPES } from '../../../common/native-question.ts'

export const claudeTerminalUiRuntime = withClaudeNativePlatformRuntime(String.raw`import http from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {dirname as nativeEditorDirname} from 'node:path';
import {stripVTControlCharacters} from 'node:util';
import {accessSync,constants as fsConstants,readFileSync,statSync,lstatSync,openSync,fstatSync,closeSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const nativeUiTextMessageMaxBytes=${CLAUDE_UI_TEXT_MESSAGE_MAX_BYTES};
const nativeUiTextMaxLength=${CLAUDE_UI_TEXT_MAX_LENGTH};
const nativeUiControlResponseMaxBytes=${CLAUDE_UI_CONTROL_RESPONSE_MAX_BYTES};
async function nativeInterruptionModule(){return await import('/$bunfs/root/chunk-ev1xcp32.js');}
const nativeUiPromptRpcSubtypes=new Set(${JSON.stringify(CLAUDE_UI_PROMPT_RPC_SUBTYPES)});
const configUrl=new URL('./observer.json',import.meta.url),config=JSON.parse(readFileSync(configUrl,'utf8'));
${claudeTerminalHelperPolicyRuntime}
${claudeTerminalHelperPolicyReaderRuntime}
let nativeHelperObservationReader,nativeMainStatusReconciliation;
export function bindNativeMainStatusReconciliation(reconciliation){
 nativeMainStatusReconciliation=reconciliation;
}
export function bindNativeHelperObservationReader(reader){
 if(typeof reader!=='function'||nativeHelperObservationReader&&nativeHelperObservationReader!==reader)throw Error('Native helper observation reader is already bound or invalid');
 nativeHelperObservationReader=reader;
}

const clients=new Set(),seen=new Set();let native,initializing,activeSession=config.sessionId,sequenceSession=config.sessionId,sequenceEpoch=config.transportEpoch,sessionTransition,inFlight=0,highestSequence=0;
const nativeRasterMirrors=createNativeRasterMirrors({current:scope=>{if(!native||!clients.has(scope.client_id)||!clientViewCurrent(native,scope.client_id)||scope.instance_revision!==undefined&&!instanceLifetimes.active(scope,scope.instance_revision))return false;const source=currentTerminalPlacementAction(native,scope);return source?.fingerprint===scope.source_revision;},invalidate:scope=>publish({type:'system',subtype:'ui_invalidate',event:'ui.render',client_snapshot:true,client_id:scope.client_id,instances:[{surface:'desktop',component:scope.component,instance_id:scope.instance_id}]})});
const actionKeys=createNativeActionKeyBridge({
 nativeActions:(n,client,p)=>[...nativeInlineModelActions(n,client,p),...nativeComposerTaskActions(n,client,p)],
 knownClients:()=>clients,
 current:(n,scope)=>clients.has(scope.client_id)&&clientViewCurrent(n,scope.client_id)&&(scope.component!=='Pane'||paneRoster(n).shown_id===scope.instance_id)&&(scope.instance_revision===undefined||instanceLifetimes.active(scope,scope.instance_revision)),
 view:n=>clientViewKey(n),
 requestId:(n,scope)=>isTerminalPlacement(scope.component)?currentTerminalPlacementAction(n,scope)?.input.requestId??scope.instance_id:scope.instance_id,
 changed:(client_id,action_keys)=>publish({type:'system',subtype:'apack_ui_action_keys',client_id,action_keys}),
});
const instanceLifetimes=createNativeInstanceLifetimes(scope=>{
 actionKeys.invalidate(scope);
 nativeRasterMirrors.release(scope.client_id,scope.component,scope.instance_id);
 native?.nativeClients.release(scope.client_id,scope.component,scope.instance_id);
 const key=JSON.stringify([scope.client_id,scope.instance_id]);
 if(scope.component==='CommandOutput')commandOutputFrames.delete(key);
 if(scope.component==='ToolResult')toolResultFrames.delete(key);
 if(scope.component==='ToolUse')toolUseFrames.delete(key);
 if(scope.component==='ToolProgress')toolProgressFrames.delete(key);
 if(scope.component==='ToolGroup')toolGroupFrames.delete(key);
 if(isTerminalPlacement(scope.component))terminalPlacementFrames.delete(JSON.stringify([scope.client_id,scope.component,scope.instance_id]));
 if(isComposerComponent(scope.component))composerFrames.delete(JSON.stringify([scope.client_id,scope.component,scope.instance_id]));
});
function publish(event){
 try{const current=JSON.parse(readFileSync(configUrl,'utf8'));const request=http.request({socketPath:config.socketPath,path:'/ui-event',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:500},response=>response.resume());request.on('error',()=>{});request.on('timeout',()=>request.destroy());request.end(JSON.stringify({sessionId:current.sessionId,pid:process.pid,event,ownerEpoch:config.transportEpoch}));}catch{}
}
// Match native remote replay: latest status per plugin, bounded recent transients for first attach.
const noticeStatuses=new Map(),noticeTransient=[],noticeMethods=new WeakSet();
let noticeSession=config.sessionId,noticeOrder=0,noticeAttached=false;
function resetNotices(sessionId){noticeSession=sessionId;noticeStatuses.clear();noticeTransient.length=0;noticeAttached=false;}
function recordNotice(subtype,plugin,text,timeout,details){
 const current=JSON.parse(readFileSync(configUrl,'utf8'));
 if(noticeSession!==current.sessionId)resetNotices(current.sessionId);
 const event={type:'system',subtype,plugin,text:text??null,uuid:randomUUID(),session_id:current.sessionId,...(['ui_toast','ui_notification'].includes(subtype)?{timeout_ms:timeout}:{}),...(details??{})};
 const item={event,at:Date.now(),order:++noticeOrder};
 if(subtype==='ui_status'){noticeStatuses.delete(plugin);noticeStatuses.set(plugin,item);}
 else if(!clients.size){noticeTransient.push(item);noticeTransient.splice(0,Math.max(0,noticeTransient.length-20));}
 if(clients.size)publish(event);
}
function noticeScope(){try{const current=JSON.parse(readFileSync(configUrl,'utf8'));return JSON.stringify([current.sessionId,current.policyGeneration,helperPolicyReader?.()])}catch{return}}
function notificationPlugin(origin){return Array.isArray(origin)?origin.map(value=>typeof value==='string'?value:value?.plugin).findLast(value=>typeof value==='string'&&value.length>0&&value.length<=256):undefined}
function installNotices(n,context){
 if(context?.surface!=='terminal')return;
 if(!noticeMethods.has(context.toast)){
  const toast=context.toast;context.toast=function(plugin,text,timeout){const result=Reflect.apply(toast,this,arguments);try{recordNotice('ui_toast',plugin,text,timeout??n.runtime.o7t);}catch{}return result;};noticeMethods.add(context.toast);
 }
 if(!noticeMethods.has(context.status)){
  const status=context.status;context.status=function(plugin,text){const result=Reflect.apply(status,this,arguments);try{recordNotice('ui_status',plugin,text);}catch{}return result;};noticeMethods.add(context.status);
 }
 if(typeof context.notify==='function'&&!noticeMethods.has(context.notify)){
  const notify=context.notify;
  context.notify=async function(data,origin){
   const scope=noticeScope(),receiver=this,plugin=notificationPlugin(origin);
   const result=await Reflect.apply(notify,this,arguments);
   if(scope&&scope===noticeScope()&&n.runtime.ey()===receiver&&plugin&&data?.notificationType==='plugin_notification'&&typeof data.message==='string'&&typeof data.title==='string'&&['iterm2','iterm2_with_bell','kitty','ghostty','terminal_bell'].includes(result))try{recordNotice('ui_notification',plugin,data.message,n.runtime.o7t,{title:data.title,channel:result,policy_generation:JSON.parse(scope)[1]})}catch{}
   return result;
  };noticeMethods.add(context.notify);
 }
}
function replayNotices(){
 const current=JSON.parse(readFileSync(configUrl,'utf8'));
 if(noticeSession!==current.sessionId)resetNotices(current.sessionId);
 const items=[...noticeStatuses.values(),...(!noticeAttached?noticeTransient.filter(item=>Date.now()-item.at<=60000):[])].sort((a,b)=>a.order-b.order);
 noticeTransient.length=0;noticeAttached=true;
 for(const item of items)publish(item.event);
}
// Native hook dispatch owns admission and rewrites; this adapter supplies the remote layout.
const sites=new Map();
const siteRegistrations=new Map(),paneSiteOperations=new Map();
const commandOutputFrames=new Map();
function commandOutputFacts(n,id){
 const binding=originalContext??n.runtime.ey();
 const row=(binding?.messages?.()??[]).find(row=>row.uuid===id&&row.type==='system'&&row.subtype==='local_command');
 if(!row||typeof row.content!=='string'||typeof row.commandRun?.command!=='string'||typeof row.commandRun?.args!=='string')return;
 const stdout=n.commandTags.Ms(row.content,'local-command-stdout'),stderr=n.commandTags.Ms(row.content,'local-command-stderr');
 const out=stdout===null?'':n.commandEntities.km(stdout),err=stderr===null?'':n.commandEntities.km(stderr);
 const hasOut=out.trim()!==''&&out.trim()!==n.questionOptions.gu,hasErr=err.trim()!=='';
 if(hasOut===hasErr)return;
 const text=hasOut?out:err;
 if(text.length>65536||row.commandRun.command.length>256||row.commandRun.args.length>65536)return;
 const normalized=n.commandOutput.s4t(row.content,row.uuid,row.timestamp,row.contextUsage,row.commandRun,row.usageReport,row.commandOutcome)?.message?.content;
 const display=typeof normalized==='string'?normalized:Array.isArray(normalized)?normalized.filter(block=>block.type==='text').map(block=>block.text).join('\n'):undefined;
 if(typeof display!=='string')return;
 return {props:{command:row.commandRun.command,args:row.commandRun.args,text,isErrored:hasErr},display,fingerprint:JSON.stringify([row.content,row.commandRun])};
}
function currentCommandOutputAction(n,request){
 if(request.component!=='CommandOutput')return;
 const key=JSON.stringify([request.client_id,request.instance_id]),frame=commandOutputFrames.get(key),facts=commandOutputFacts(n,request.instance_id);
 if(!frame||!facts||frame.fingerprint!==facts.fingerprint)throw Error('Native command output changed or expired');
}
const toolResultFrames=new Map();
${claudeNativeToolResultRuntime}
function toolResultFacts(n,id,resultUuid,assistantUuid){
 const binding=originalContext??n.runtime.ey();
 return nativeToolResultFacts(binding?.messages?.()??[],id,resultUuid,assistantUuid);
}
function currentToolResultAction(n,request){
 if(request.component!=='ToolResult')return;
 const frame=toolResultFrames.get(JSON.stringify([request.client_id,request.instance_id]));
 if(!frame||toolResultFacts(n,request.instance_id,frame.resultUuid,frame.assistantUuid)?.fingerprint!==frame.fingerprint)throw Error('Native tool result changed or expired');
}
// ui-mount owns a client-specific AbovePrompt instance; the terminal keeps its original singleton.
function siteExists(n,component,id,clientId){return component==='AbovePrompt'&&(id===n.runtime.f4||typeof clientId==='string'&&id===clientId+':above-prompt')||component==='Pane'&&paneRoster(n).panes.some(pane=>pane.id===id);}
function siteOffset(site){return site.follow?Math.max(0,site.contentRows-site.bodyRows):site.offset;}
function siteMapKey(n,clientId,component,id){return component==='Pane'?JSON.stringify([clientId,component,id]):n.runtime.kV(component,id);}
function unregisterSite(n,site){
 const key=n.runtime.kV(site.component,site.id),registration=siteRegistrations.get(key);
 if(registration?.site!==site)return;
 siteRegistrations.delete(key);
 for(const [registry,entry,previous] of [[n.runtime.xbe(),site.scrollEntry,registration.previousScroll],[n.runtime.Eat(),site.focusEntry,registration.previousFocus]])if(registry.get(key)===entry){if(previous)registry.set(key,previous);else registry.delete(key);}
}
function dropSite(n,key){
 const site=sites.get(key);if(!site)return;sites.delete(key);site.abort.abort();
 actionKeys.retire({client_id:site.clientId,component:site.component,instance_id:site.id});
 unregisterSite(n,site);
}
function refreshSite(n,site,claim=false){
 if(!clientViewCurrent(n,site.clientId))return;
 const key=n.runtime.kV(site.component,site.id),scrolls=n.runtime.xbe(),focuses=n.runtime.Eat();
 const previous=siteRegistrations.get(key);
 if(!claim&&previous?.site!==site)return;
 const registration={
  site,
  previousScroll:previous&&scrolls.get(key)===previous.site.scrollEntry?previous.previousScroll:scrolls.get(key),
  previousFocus:previous&&focuses.get(key)===previous.site.focusEntry?previous.previousFocus:focuses.get(key),
 };
 if(previous&&previous.site!==site){previous.site.held=false;previous.site.holder=undefined;}
 siteRegistrations.set(key,registration);
 const current=()=>siteRegistrations.get(key)?.site===site&&sites.get(siteMapKey(n,site.clientId,site.component,site.id))===site
  &&clients.has(site.clientId)&&clientViewCurrent(n,site.clientId)&&siteExists(n,site.component,site.id,site.clientId);
 const moved=()=>publish({type:'system',subtype:'ui_scroll',client_id:site.clientId,component:site.component,instance_id:site.id,offset:siteOffset(site),...(site.follow?{follow_end:true}:{})});
 site.scrollEntry={component:site.component,requestId:site.id,owner:site.owner,bodyRows:site.bodyRows,contentRows:site.contentRows,maxOffset:Math.max(0,site.contentRows-site.bodyRows),offset:()=>siteOffset(site),keyRows:(plugin,key)=>{const row=site.keyed.find(row=>row.plugin===plugin&&row.key===key);return row&&{top:row.top,bottom:row.bottom};},commit:(offset,origin)=>{
  if(!current()||origin.kind==='person'&&site.superseded)return false;
  const end=Math.max(0,site.contentRows-site.bodyRows);site.offset=Math.min(end,Math.max(0,offset));
  if(origin.kind==='person')site.follow=site.follow&&site.offset>=end;
  else{site.superseded=site.moving;site.follow=false;moved();}return true;
 },followEnd:()=>{if(current()){site.follow=true;moved();}}};
 site.focusEntry={component:site.component,requestId:site.id,owner:site.owner,isHeldNow:()=>site.held,holderNow:()=>site.holder?.plugin,hasElement:(plugin,element)=>site.focusables.some(item=>item.plugin===plugin&&item.element===element),commit:input=>{
  if(!current())return 'no such site';
  if(input.plugin===undefined||input.element===undefined){site.holder=undefined;return;}
  if(!site.focusables.some(item=>item.plugin===input.plugin&&item.element===input.element))return 'no element of '+input.plugin+' is drawn under that key';
  site.holder={plugin:input.plugin,element:input.element};
  if(input.origin.kind==='plugin'&&!site.reporting)publish({type:'system',subtype:'ui_focus',client_id:site.clientId,component:site.component,instance_id:site.id,plugin:input.plugin,key:input.element});
 }};
 scrolls.set(key,site.scrollEntry);focuses.set(key,site.focusEntry);
}
function remoteSite(n,clientId,component,id){
 if(!clients.has(clientId)||!clientViewCurrent(n,clientId)||!siteExists(n,component,id,clientId))return;
 const key=siteMapKey(n,clientId,component,id);let site=sites.get(key);
 if(site&&site.clientId!==clientId){dropSite(n,key);site=undefined;}
 if(!site){site={clientId,component,id,owner:component==='Pane'?paneRoster(n).panes.find(pane=>pane.id===id)?.plugin:undefined,offset:0,bodyRows:0,contentRows:0,keyed:[],focusables:[],held:false,follow:false,abort:new AbortController()};sites.set(key,site);}
 return site;
}
// Claude's registry has one entry per Pane. Finish each admitted operation before another
// window can publish its own drawing to the original hook.
function runOnSite(n,site,run){
 if(site.component!=='Pane')return run();
 const key=n.runtime.kV(site.component,site.id);
 const prior=paneSiteOperations.get(key)??Promise.resolve();
 const pending=prior.then(run,run);
 paneSiteOperations.set(key,pending);
 return pending.finally(()=>{if(paneSiteOperations.get(key)===pending)paneSiteOperations.delete(key);});
}
function synchronizePanes(n){
 const state=n.roster.Ui().getState(),shown=paneRoster(n).shown_id;
 // Hidden panes unmount their original action registrations; showing one needs a fresh drawing.
 for(const [key,site] of sites){
  if(!siteExists(n,site.component,site.id,site.clientId)){dropSite(n,key);continue;}
  if(site.component==='Pane'){
   if(site.id!==shown){
    actionKeys.retire({client_id:site.clientId,component:site.component,instance_id:site.id});
    unregisterSite(n,site);site.focusables=[];site.held=false;site.holder=undefined;continue;
   }
   if(state.focusedId!==site.id){site.held=false;site.holder=undefined;}
  }
  refreshSite(n,site);
 }
}
function siteTurn(site,kind,report,merge,run){
 const state=site[kind]??(site[kind]={});
 if(state.active){
  if(state.waiting){state.waiting.report=merge(state.waiting.report,report);return state.waiting.promise;}
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});state.waiting={report,promise,resolve,reject};return promise;
 }
 state.active=true;
 return Promise.resolve().then(()=>run(report)).finally(()=>{
  state.active=false;const next=state.waiting;state.waiting=undefined;
  if(next)siteTurn(site,kind,next.report,merge,run).then(next.resolve,next.reject);
 });
}
async function remoteFocus(n,value){
 const site=remoteSite(n,value.client_id??'desktop:default',value.component,value.instance_id);
 if(!site)return {moved:false,element:null,deny:'no such site'};
 return siteTurn(site,'focusQueue',value,(before,after)=>after.element===undefined&&after.is_held&&before.element!==undefined?{...after,element:before.element,by:before.by}:after,value=>runOnSite(n,site,async()=>{
  if(site.abort.signal.aborted||!clientViewCurrent(n,site.clientId)||site.component==='Pane'&&paneRoster(n).shown_id!==site.id)return {moved:false,element:null,deny:'no such site'};
  const element=value.element;
  if(site.component==='Pane'&&value.is_held&&element&&!site.focusables.some(item=>item.plugin===element.plugin&&item.element===element.key))
   return {moved:false,element:null,deny:'no element of '+element.plugin+' is drawn under that key'};
  site.held=value.is_held;if(!site.held)site.holder=undefined;
  if(site.component==='Pane'&&!site.held&&siteRegistrations.get(n.runtime.kV(site.component,site.id))?.site!==site)return {moved:true,element:null};
  site.reporting=true;refreshSite(n,site,true);
  let result={};
  try{if(element!==undefined&&site.held)result=await n.runtime.v7t({input:{component:site.component,requestId:site.id,...(element?{plugin:element.plugin,element:element.key}:{}),origin:value.by==='auto'&&element?{kind:'plugin',name:element.plugin}:{kind:'person'}},signal:site.abort.signal});}
  finally{site.reporting=false;}
  const holder=site.holder;return {moved:result.deny===undefined,element:holder?{plugin:holder.plugin,key:holder.element}:null,...(result.deny!==undefined?{deny:result.deny}:{})};
 }));
}
async function remoteScroll(n,value){
 const site=remoteSite(n,value.client_id??'desktop:default',value.component,value.instance_id);
 if(!site)return {moved:false,offset:value.offset,deny:'no such site'};
 return siteTurn(site,'scrollQueue',value,(before,after)=>({...after,by:before.by+after.by}),value=>runOnSite(n,site,async()=>{
  if(site.abort.signal.aborted||!clientViewCurrent(n,site.clientId)||site.component==='Pane'&&paneRoster(n).shown_id!==site.id)return {moved:false,offset:siteOffset(site),deny:'no such site'};
  const end=Math.max(0,value.content_rows-value.body_rows),before=site.follow?end:Math.min(site.offset,end),wasFollowing=site.follow;
  site.offset=before;site.bodyRows=value.body_rows;site.contentRows=value.content_rows;if(value.keyed)site.keyed=value.keyed;
  const offset=Math.min(end,Math.max(0,value.offset)),registered=siteRegistrations.get(n.runtime.kV(site.component,site.id))?.site;
  // A passive viewport report updates that window's geometry without moving Claude's focus site.
  if(site.component==='Pane'&&registered&&registered!==site&&value.by===0&&!value.pointer){
   site.offset=offset;site.follow=site.follow&&offset>=end;return {moved:true,offset:siteOffset(site)};
  }
  site.moving=true;site.superseded=false;refreshSite(n,site,true);
  let result;
  try{result=await n.runtime.vxt({input:{component:site.component,requestId:site.id,offset,by:value.by,bodyRows:site.bodyRows,contentRows:site.contentRows,origin:{kind:'person'},...(value.pointer?{pointer:value.pointer}:{})},signal:site.abort.signal});}
  finally{site.moving=false;}
  if(site.abort.signal.aborted||site.superseded)return {moved:false,offset:siteOffset(site),deny:'the window moved meanwhile',...(site.follow?{follow_end:true}:{})};
  if(result.deny!==undefined)site.offset=before;
  else site.follow=site.follow||wasFollowing&&value.by>0&&site.offset>=end;
  return {moved:result.deny===undefined,offset:siteOffset(site),...(result.deny!==undefined?{deny:result.deny}:{}),...(site.follow?{follow_end:true}:{})};
 }));
}
function recordDrawing(n,value,tree){
 const site=remoteSite(n,value.client_id,value.component,value.instance_id);if(!site||site.component==='Pane'&&paneRoster(n).shown_id!==site.id)return;
 const scroll=value.props?.scroll;
 if(scroll&&Number.isInteger(scroll.bodyRows)&&scroll.bodyRows>=0)site.bodyRows=scroll.bodyRows;
 if(site.component!=='Pane'&&typeof value.props?.isFocused==='boolean')site.held=value.props.isFocused;
 site.focusables=n.session.Ket(tree);
 if(site.holder&&!site.focusables.some(item=>item.plugin===site.holder.plugin&&item.element===site.holder.element))site.holder=undefined;
 refreshSite(n,site,!siteRegistrations.has(n.runtime.kV(site.component,site.id)));n.runtime.k7t().emit();
}

function paneRoster(n){
 const state=n.roster.Ui().getState(),visible=state.open.filter(pane=>n.engine.FPe(pane.plugin));
 const hidden=new Set(state.open.filter(pane=>!visible.includes(pane)).map(pane=>pane.id));
 return {panes:visible.map(pane=>({id:pane.id,title:pane.title,plugin:pane.plugin,...(pane.closeOnEscape?{close_on_escape:true}:{}),...(pane.holdToasts?{hold_toasts:true}:{}),...(pane.rows!==undefined?{rows:pane.rows}:{}),...(pane.columns!==undefined?{columns:pane.columns}:{})})),shown_id:hidden.has(state.shownId)?visible.at(-1)?.id??null:state.shownId,focused_id:hidden.has(state.focusedId)?null:state.focusedId,focus_requested_id:hidden.has(state.focusRequest)?null:state.focusRequest};
}
${claudeTerminalInstanceRuntime}
${claudeTerminalActionKeyRuntime}
${claudeTerminalInlineModelRuntime}
${claudeTerminalClientRuntime}
${claudeTerminalToolOutputRuntime}
${claudeTerminalDiagnosticRuntime}
${claudeManagedSettingsDiagnosticRuntime}
${claudeTerminalToolUseRuntime}
${claudeTerminalToolProgressRuntime}
${claudeTerminalToolGroupRuntime}
${claudeTerminalToolGroupDrawingRuntime}
${claudeTerminalComposerRuntime}
${claudeTerminalBashRuntime}
${claudeTerminalFileRuntime}
${claudeTerminalGenericPermissionRuntime}
${claudeTerminalPowerShellRuntime}
${claudeTerminalToolPermissionRuntime}
${claudeTerminalWorkflowRuntime}
${claudeTerminalFocusRuntime}
${claudeTerminalQuestionCountdownRuntime}
${claudeTerminalStreamRuntime}
${claudeTerminalDocumentRuntime}
${claudeTerminalRasterRuntime}
${claudeTerminalHistoryPlacementRuntime}
${claudeTerminalTaskRuntime}
${claudeTerminalAgentInputRuntime}
${claudeTerminalParentCommandRuntime}
function nativeThemeProvider(n,output=process.stdout){
 const root=n.themeRoots.ai().get(output)?.container?.current,pending=root?[root]:[],seen=new Set();
 while(pending.length){
  const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
  if(seen.size>=4096)throw Error('Native theme provider traversal exceeded bound');seen.add(fiber);
  if(fiber.type===n.themePreferences.dEn){
   const value=fiber.child?.memoizedProps?.value;
   if(!value?.resolvedTheme||typeof value.themeSetting!=='string'||typeof value.resolvedTheme.text!=='string')throw Error('Native mounted theme provider contract changed');
   return {type:fiber.child.type,value};
  }
  if(fiber.sibling)pending.push(fiber.sibling);if(fiber.child)pending.push(fiber.child);
 }
 throw Error('Native theme provider is not mounted');
}
function nativeThemePalette(n,output=process.stdout){return nativeThemeProvider(n,output).value.resolvedTheme;}
${claudeNativeThemeRuntime}
function nativeThemePromptDecorations(n,decorations){if(!decorations?.length)return decorations;return nativePaletteDecorations(nativeThemePalette(n),decorations);}
function nativeThemeTree(n,tree){return nativePaletteTree(nativeThemePalette(n),tree);}
function publishPromptTheme(n){
 const palette=Object.fromEntries(Object.entries(nativeThemePalette(n)).filter(([key,value])=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)&&typeof value==='string'));
 publish({type:'system',subtype:'ui_prompt_theme',palette});
}
let nativeThemeSnapshot,nativePromptPaletteSnapshot;
function refreshNativeTheme(n){
 if(!clients.size)return;
 const palette=JSON.stringify(nativeThemePalette(n)),paletteChanged=nativePromptPaletteSnapshot!==undefined&&nativePromptPaletteSnapshot!==palette;nativePromptPaletteSnapshot=palette;
 const next=JSON.stringify([nativeThemePalette(n),nativeDocumentSyntaxFlag(n)]);
 if(nativeThemeSnapshot===next)return;
 const changed=nativeThemeSnapshot!==undefined;nativeThemeSnapshot=next;
 if(paletteChanged)publishPromptTheme(n);
 if(changed)publish({type:'system',subtype:'ui_invalidate',event:'ui.render'});
}
async function initialize(){
 if(native)return native;
 if(initializing)return initializing;
 initializing=(async()=>{
  if(createHash('sha256').update(readFileSync(process.execPath)).digest('hex')!=='5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37')throw Error('Native UI transport requires the reviewed Claude Code 2.1.302 binary');
  const clientRuntime=await import('/$bunfs/root/chunk-e980bbar.js');
  const nativeClients=createNativeClientHost(()=>createDesktopNativeClientRegistry(clientRuntime),entry=>publish({type:'system',subtype:'ui_invalidate',event:'ui.render',client_snapshot:true,client_id:entry.client,instances:[{surface:'desktop',component:entry.component,instance_id:entry.requestId}]}),clientRuntime.R3r,{borrow:request=>borrowTerminalClient(native,request),eligible:entry=>engine.FPe(entry.plugin),current:entry=>{if(entry.instanceRevision!==undefined&&!instanceLifetimes.active({client_id:entry.client,component:entry.component,instance_id:entry.requestId},entry.instanceRevision))return false;if(!['CommandOutput','ToolResult','ToolUse','ToolProgress','ToolGroup','Spinner','SessionMode','PromptHint','InfoNotice','TurnDuration'].includes(entry.component))return true;if(!native||!clients.has(entry.client)||!clientViewCurrent(native,entry.client))return false;if(entry.borrowed&&isTerminalPlacement(entry.component))return entry.instance.isCurrent?.()===true;const request={component:entry.component,client_id:entry.client,instance_id:entry.requestId};currentCommandOutputAction(native,request);currentToolResultAction(native,request);currentToolUseAction(native,request);currentToolProgressAction(native,request);currentToolGroupAction(native,request);currentComposerAction(native,request);currentTerminalPlacementAction(native,request);return true;},dispatch:value=>engine.I9e.clientPress(value),run:value=>runNativeClientAction(engine,value)});
  const gate=await import('/$bunfs/root/chunk-wn0572jb.js');
  const engine=await import('/$bunfs/root/chunk-c7wcn77x.js'),nativeHost=await import('/$bunfs/root/chunk-sbny5rjh.js');
  const session=await import('/$bunfs/root/chunk-a32bd1ts.js');
  const fileSuggestions=await import('/$bunfs/root/chunk-k5k90aj0.js');
  const referenceSearch=await import('/$bunfs/root/chunk-jfv2evcj.js');
  const referenceWorkspace=await import('/$bunfs/root/chunk-27d659a1.js');
  const referenceTransport=await import('/$bunfs/root/chunk-y0a0212f.js');
  const addressAdmission=await import('/$bunfs/root/chunk-xzrsvmt7.js');
  const addressNormalization=await import('/$bunfs/root/chunk-5w8txcza.js');
  const roster=await import('/$bunfs/root/chunk-nkxb8t4d.js');
  const schemas=await import('/$bunfs/root/chunk-5c94ftfz.js');
  const runtime=await import('/$bunfs/root/chunk-hqtnbrjd.js');
  const hookPresence=await import('/$bunfs/root/chunk-cg8hxhdr.js');
  const commandInput=await import('/$bunfs/root/chunk-bkgw23zx.js');
  const commandOutput=await import('/$bunfs/root/chunk-1svntv7y.js');
  const commandTags=await import('/$bunfs/root/chunk-nhvhsxnt.js'),commandEntities=await import('/$bunfs/root/chunk-25a3z2dq.js');
  const toolBackground=await import('/$bunfs/root/chunk-6f1afc3k.js'),terminalComponents=await import('/$bunfs/root/chunk-tdpa6qc1.js');
  const transcriptState=await import('/$bunfs/root/chunk-tnpfcesk.js');
  const toolRendering=await import('/$bunfs/root/chunk-r2k35jby.js'),staticRender=await import('/$bunfs/root/chunk-mn4kxp8g.js'),appProvider=await import('/$bunfs/root/chunk-002p0hd2.js'),toolExport=await import('/$bunfs/root/chunk-ste1xxgx.js'),jsx=await import('/$bunfs/root/chunk-4hec5rn1.js');
  const documentRendering=await import('/$bunfs/root/chunk-hz2qqf17.js'),documentDefaults=await import('/$bunfs/root/chunk-pbm0yhpt.js');
  const themeRoots=await import('/$bunfs/root/chunk-pg10s5g1.js'),fleet=await import('/$bunfs/root/chunk-zpkky5k1.js');
  const mcpInputTiming=await import('/$bunfs/root/chunk-p22r2x2e.js');
  const nativeKeyEvents=await import('/$bunfs/root/chunk-174fh6cj.js'),nativeKeyBindings=await import('/$bunfs/root/chunk-tvszjqy2.js'),nativeKeyDialogs=await import('/$bunfs/root/chunk-9qecvs92.js');
  const themePreferences=await import('/$bunfs/root/chunk-gnpc8ecg.js');
  const themeStore=await import('/$bunfs/root/chunk-5feck2gp.js'),themeStorageKeys=await import('/$bunfs/root/chunk-r1ydygv8.js'),themeStorageGate=await import('/$bunfs/root/chunk-gc95262s.js');
  const rename=await import('/$bunfs/root/chunk-swjk3jdr.js');
  const renameTiming=await import('/$bunfs/root/chunk-2jyw98bz.js');
  const taskControls=await import('/$bunfs/root/chunk-nmzacz4p.js'),privateTasks=await import('/$bunfs/root/chunk-s5erk9wy.js'),privateTaskDrawing=await import('/$bunfs/root/chunk-w5063paj.js');
  const taskOutput=await import('/$bunfs/root/chunk-nbvvw59m.js');
  const taskOutputText=await import('node:util');
  const workflowTasks=await import('/$bunfs/root/chunk-tkvjaryv.js');
  const workflowCommand=await import('/$bunfs/root/chunk-yr5kjc3d.js');
  const taskResume=await import('/$bunfs/root/chunk-jg0h78vk.js');
  const taskInputGate=await import('/$bunfs/root/chunk-ysbnj2tj.js');
  const mcp=await import('/$bunfs/root/chunk-7m5psxad.js');
  const mcpControls=await import('/$bunfs/root/chunk-aen4nr7w.js');
  const {Cot:channelPolicyBlocked}=await import('/$bunfs/root/chunk-9ah6nahr.js');
  const {me:readSettingsSource,ut:readEffectiveSettings}=await import('/$bunfs/root/chunk-1pjd7qsk.js');
  const mcpChannelBlocked=()=>channelPolicyBlocked(readSettingsSource('policySettings'));
  const managedPermissionRulesOnly=()=>readSettingsSource('policySettings')?.allowManagedPermissionRulesOnly===true;
  const permissions=await import('/$bunfs/root/chunk-gpwdwjeb.js');
  const models=await import('/$bunfs/root/chunk-0xdgy4bd.js');
  const questionTool=(await import('/$bunfs/root/chunk-at6jwec6.js')).yQ;
  const questionOptions=await import('/$bunfs/root/chunk-hdxpvbx1.js');
  const questionText=await import('/$bunfs/root/chunk-xh5v0djg.js');
  const questionDialog=await import('/$bunfs/root/chunk-a14ghztk.js');
  const questionImageModel=await import('/$bunfs/root/chunk-5f274gcf.js');
  const questionImage=await import('/$bunfs/root/chunk-ft699e6v.js');
  const catalog=await import('/$bunfs/root/chunk-2bb0j573.js');
  const paths=await import('/$bunfs/root/chunk-27d659a1.js');
  const planConsent=await import('/$bunfs/root/chunk-3m4t81ea.js');
  const planAuto=await import('/$bunfs/root/chunk-5c94ftfz.js');
  const planNormalize=await import('/$bunfs/root/chunk-gpwdwjeb.js');
  const planTool=await import('/$bunfs/root/chunk-rhvre9pz.js');
  const planTeams=await import('/$bunfs/root/chunk-tt5gpzxk.js');
  const taskTeamContext=await import('/$bunfs/root/chunk-c20dx22n.js');
  const taskAppState=await import('/$bunfs/root/chunk-sv68ryxf.js');
  const taskSessionGlobals=await import('/$bunfs/root/chunk-hdxpvbx1.js');
  const planStore=await import('/$bunfs/root/chunk-ehw6t5ag.js');
  const planProactivity=await import('/$bunfs/root/chunk-ck4jw7jw.js');

  const settingsDetector=await import('/$bunfs/root/chunk-ayzz9bjs.js');
  let fileSuggestionPolicyRevision=0;
  settingsDetector.Ta.subscribe(source=>{if(source==='policySettings')fileSuggestionPolicyRevision++;});
  const fileSuggestionScope=()=>{
   try{return JSON.stringify([fileSuggestionPolicyRevision,runtime.bgr(readEffectiveSettings().fileSuggestion)?.command??null]);}
   catch{return undefined;}
  };
  await import('/$bunfs/root/chunk-rpe8kh25.js');
  const modules={gate,engine,session,roster,schemas,runtime,permissions,models,catalog,questionTool,questionOptions,questionText,questionDialog,questionImageModel,questionImage,paths,planConsent,planAuto,planNormalize,planTool,planTeams,planStore,planProactivity};
  engine.I9e.onInvalidate(instances=>{nativeClients.suspend(instances);for(const[client,frame]of questionFrames)if(!instances||instances.some(item=>item.surface==='desktop'&&item.component==='AskUserQuestion'&&item.requestId===frame.requestId))questionFrames.delete(client);try{publish({type:'system',subtype:'ui_invalidate',event:'ui.render',...(gate.e5r()?{prompts_screened:true}:{}),...(instances?{instances:instances.map(item=>({surface:item.surface,component:item.component,instance_id:item.requestId}))}:{})});}catch{}});
  let previousRoster=JSON.stringify(paneRoster(modules));
  runtime.k7t().subscribe(()=>{for(const site of sites.values())refreshSite(modules,site);});
  roster.Ui().subscribe(()=>{synchronizePanes(modules);const current=paneRoster(modules),encoded=JSON.stringify(current);if(encoded===previousRoster)return;previousRoster=encoded;publish({type:'system',subtype:'ui_panes',...current});});
  observeNativeManagedSettings(settingsDetector.Ta);
  return native={hookPresence,mcpInputTiming,renameTiming,fileSuggestions,fileSuggestionScope,referenceSearch,referenceWorkspace,referenceTransport,addressAdmission,addressNormalization,nativeKeyEvents,nativeKeyBindings,nativeKeyDialogs,nativeHost,nativeClients,clientRuntime,documentRendering,documentDefaults,gate,engine,session,roster,schemas,runtime,commandInput,commandOutput,commandTags,commandEntities,toolBackground,terminalComponents,transcriptState,toolRendering,staticRender,appProvider,toolExport,jsx,themeRoots,fleet,themePreferences,themeStore,themeStorageKeys,themeStorageGate,rename,taskControls,privateTasks,privateTaskDrawing,taskTeamContext,taskAppState,taskSessionGlobals,taskOutput,taskOutputText,workflowTasks,workflowCommand,taskResume,taskInputGate,mcp,mcpControls,mcpChannelBlocked,managedPermissionRulesOnly,permissions,models,catalog,questionTool,questionOptions,questionText,questionDialog,questionImageModel,questionImage,paths,planConsent,planAuto,planNormalize,planTool,planTeams,planStore,planProactivity};
 })();
 return initializing;
}
let originalContext,wrappedContext,releaseHostGateway,hostSequence=0;
const clientViews=new Map();
function clientViewKey(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal')return undefined;
 const facts=nativeViewFacts(n,binding,new AbortController());
 return JSON.stringify([facts.sessionId,facts.sequence,facts.view]);
}
function clientViewCurrent(n,id){return !!n&&clientViews.has(id)&&clientViews.get(id)===clientViewKey(n);}
function clientAttachmentViewKey(n,expected){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal')throw Error('Native UI view is unavailable');
 const facts=nativeViewFacts(n,binding,new AbortController());
 if(expected===undefined){if(facts.view.kind!=='main')throw Error('Desktop parent UI cannot attach to a native Agent view');}
 else{
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||typeof expected.session_id!=='string'||!Number.isSafeInteger(expected.revision)||expected.revision<1||typeof expected.agent_id!=='string'||!expected.agent_id||expected.agent_id.length>256)throw Error('Invalid native Agent UI attachment');
  if(expected.session_id!==facts.sessionId||expected.revision!==facts.sequence||facts.view.kind!=='agent'||facts.view.taskId!==expected.agent_id)throw Error('Native Agent UI selection changed');
 }
 return JSON.stringify([facts.sessionId,facts.sequence,facts.view]);
}


async function askHost(subtype,args){
 if(!clients.has(args.clientId)||!clientViewCurrent(native,args.clientId))return undefined;
 const current=JSON.parse(readFileSync(configUrl,'utf8')),id=randomUUID();
 return new Promise(resolve=>{
  const request=http.request({socketPath:config.socketPath,path:'/ui-host',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:4500},response=>{
   let bytes=0;const chunks=[];response.on('data',chunk=>{bytes+=chunk.length;if(bytes>nativeUiTextMessageMaxBytes)response.destroy();else chunks.push(chunk);});
   response.on('error',()=>resolve(undefined));response.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());resolve(response.statusCode===200&&value.request_id===id&&value.pid===process.pid&&value.sessionId===current.sessionId?value.result:undefined);}catch{resolve(undefined);}});
  });request.on('error',()=>resolve(undefined));request.on('timeout',()=>request.destroy());
  request.end(JSON.stringify({sessionId:current.sessionId,pid:process.pid,ownerEpoch:config.transportEpoch,request_id:id,sequence:++hostSequence,request:{subtype,surface:'desktop',client_id:args.clientId,...(args.text!==undefined?{text:args.text}:{}),...(args.mode!==undefined?{mode:args.mode}:{}),...(args.ifEmpty===true?{ifEmpty:true}:{}),...(args.focus===true?{focus:true}:{}),...(args.decorations!==undefined?{decorations:args.decorations}:{})}}));
 });
}
function restoreHosts(n){
 releaseHostGateway?.();releaseHostGateway=undefined;
 if(wrappedContext&&n.runtime.ey()===wrappedContext)n.runtime.Zao(originalContext);
 originalContext=undefined;wrappedContext=undefined;
}
const nativeFillForRequester=new AsyncLocalStorage();
const nativeFillOrigin=new AsyncLocalStorage(), desktopPromptChanges=new Map();
function retireDesktopPromptChanges(clientId){
 const state=desktopPromptChanges.get(clientId);desktopPromptChanges.delete(clientId);state?.abort.abort();
}
function reportDesktopPromptChange(n,clientId,box,origin){
 if(!clientViewCurrent(n,clientId))return;
 let state=desktopPromptChanges.get(clientId);
 if(!state){state={plugins:[],warned:false,abort:new AbortController()};desktopPromptChanges.set(clientId,state)}
 state.pending={...box,origin};
 if(state.running)return;
 state.running=true;
 queueMicrotask(async()=>{
  try{
   while(state.pending&&!state.abort.signal.aborted&&clientViewCurrent(n,clientId)){
    const change=state.pending;state.pending=undefined;
    try{
     if(!n.hookPresence.tl('prompt.change'))break;
     // Match the native REPL's feedback limit and emit its session-scoped hook notice.
     if(state.plugins.length>=8){
      if(!state.warned){
       state.warned=true;
       const names=[...new Set(state.plugins)].sort().join(', ');
       n.engine.vG({key:'prompt.change stalled '+names,lead:'hooks',text:'prompt.change: '+state.plugins.length+' dispatches in a row for fills by '+names+'; not raised again until the box changes another way'});
      }
      break;
     }
     state.plugins.push(change.origin.name);
     await n.runtime.$i('prompt.change',{signal:state.abort.signal})(change);
    }catch{if(!state.abort.signal.aborted)process.stderr.write('apack: native desktop prompt.change failed\n')}
   }
  }finally{state.running=false;state.pending=undefined}
 });
}
async function requestNativeFill(n,args){
 const fill=nativeFillForRequester.getStore();
 const captured=fill?.text===args.text&&fill.mode===args.mode?fill:undefined;
 const local=captured?.decorations?.some(run=>run.start===run.end&&run.virtualText)
  ? ownedPromptDecorations(n,captured.decorations,args.text,true) : undefined;
 const decorations=local?.some(run=>run.start===run.end)?local:args.decorations;
 const view=clientViews.get(args.clientId),origin=captured?.origin;
 const result=await askHost('ui_prompt_fill',{...args,...(decorations!==undefined?{decorations:nativeThemePromptDecorations(n,decorations)}:{})});
 if(result?.filled===true&&result.change&&origin?.kind==='plugin'&&typeof origin.name==='string'&&view===clientViews.get(args.clientId))reportDesktopPromptChange(n,args.clientId,result.change,origin);
 return result;
}
function installHosts(n){
 if(wrappedContext&&n.runtime.ey()===wrappedContext)return;
 if(wrappedContext)restoreHosts(n);
 const current=n.runtime.ey();if(!current?.composer)throw Error('Native terminal composer is not bound');
 originalContext=current;
 releaseHostGateway=n.runtime.TXs({reach:()=> 'first',copy:async args=>(await askHost('ui_copy',args))?.copied,readSelection:async args=>{const value=await askHost('ui_read_selection',args);return value===undefined?n.runtime.j_r('aborted'):n.runtime.CXs(value.text,value.instance_id)},readPrompt:args=>askHost('ui_prompt_read',args),fillPrompt:async args=>(await requestNativeFill(n,args))?.filled,suggestPrompt:async args=>(await askHost('ui_prompt_suggest',args))?.shown});
 const remote=n.runtime.AXs(current.composer),selection=n.runtime.RXs(),has=answer=>n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.includes(answer));
 wrappedContext={...current,selection:{read:()=>has('ui_read_selection')?selection.read():current.selection?.read()},composer:{...current.composer,read:()=>remote.read(),attribute:(origin,write)=>
  nativeFillOrigin.run(origin,()=>current.composer.attribute?current.composer.attribute(origin,write):write()),write:(text,mode,decorations)=>{
  if(!has('ui_prompt_fill'))return current.composer.write(text,mode,decorations);
  // Keep original reach, refusal, and size checks. Only the selected owned desktop requester can use the pre-filter runs.
  return nativeFillForRequester.run({text,mode,decorations,origin:nativeFillOrigin.getStore()},()=>remote.write(text,mode,decorations));
 },propose:(...args)=>has('ui_prompt_suggest')?remote.propose(...args):current.composer.propose(...args)}};
 n.runtime.Zao(wrappedContext);
}
let preparedPrompt;
const desktopQueuedPrompts=new Set();
function nativeUnknownCommandRefusal(n,messages){
 if(typeof preparedPrompt?.text!=='string')return;
 const name=n.commandInput.IS(preparedPrompt.text.trimEnd())?.commandName;
 // The pinned dispatcher warns only for this command grammar; path-like input remains native input.
 if(typeof name!=='string'||!/^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$/.test(name))return;
 const shown=name.length>200?name.slice(0,200)+'…':name,prefix='Unknown command: /'+shown;
 const warnings=messages.filter(row=>!preparedPrompt.before.has(row.uuid)&&row.type==='system'&&row.subtype==='informational'&&row.level==='warning'&&row.isMeta!==true&&typeof row.uuid==='string'&&typeof row.content==='string'&&row.content.length<=1024&&(row.content===prefix||row.content.startsWith(prefix+'. Did you mean /')&&row.content.endsWith('?')));
 return warnings.length===1?warnings[0].content:undefined;
}
function isNativeMainHumanPrompt(n,item){
 return n.runtime.zp(item)&&item.mode==='prompt'&&item.origin?.kind==='human'
  &&item.isMeta!==true&&item.screeningPending!==true&&typeof item.uuid==='string';
}
function nativeQueuedDraft(n,item,verifyBytes=false){
 if(!n.runtime.Tf(item)||item.ideSelection!==undefined)return;
 const pasted=n.runtime.Dwr(item);
 const blocks=Array.isArray(item.value)?item.value:undefined;
 if(blocks?.some(part=>part?.type!=='text'&&part?.type!=='image'))return;
 if(pasted.some(part=>part?.type!=='image'))return;
 if(!blocks&&typeof item.value!=='string')return;
 const caption=n.runtime.fdt(item);
 if(caption.length>nativeUiTextMaxLength)return;
 // A native value can also carry image blocks directly. The original pop prepends those in block order.
 const embedded=blocks?n.runtime.Nmo(blocks,0):[];
 if(blocks&&embedded.length!==blocks.filter(part=>part.type==='image').length)return;
 const byId=new Map(pasted.map(image=>[image.id,image]));
 const markers=pasted.length?n.engine.Hc(caption).filter(marker=>byId.has(marker.id)&&marker.match===n.engine.nX(marker.id)):[];
 if(new Set(markers.map(marker=>marker.id)).size!==pasted.length||markers.length!==pasted.length)return;
 const images=[...embedded,...markers.map(marker=>byId.get(marker.id))];
 let text=caption;
 for(const {index,match} of markers.slice().reverse()){
  const end=index+match.length;
  // Drop a leading marker's separator. Keep words on either side of an inline marker separate.
  const separator=index>0&&/\S/u.test(text[index-1])&&/\S/u.test(text[end]??'')?' ':'';
  text=text.slice(0,index)+separator+text.slice(end+(index===0&&text[end]===' '?1:0));
 }
 let encodedBytes=0;
 const restoredImages=[];
 for(const image of images){
  const {mediaType,content:data}=image;
  if(!['image/png','image/jpeg','image/gif','image/webp'].includes(mediaType)||typeof data!=='string'||!data||data.length%4!==0)return;
  encodedBytes+=data.length;
  if(encodedBytes>nativeUiControlResponseMaxBytes
   ||verifyBytes&&!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return;
  restoredImages.push({mediaType,data});
 }
 if(!text&&!restoredImages.length)return;
 // Preflight the complete receipt before the irreversible native queue pop.
 const headerBytes=Buffer.byteLength(JSON.stringify(restoredImages.map(({mediaType})=>({mediaType,data:''}))))+encodedBytes+256;
 if(headerBytes+6*text.length>nativeUiControlResponseMaxBytes
  &&headerBytes+Buffer.byteLength(JSON.stringify(text))>nativeUiControlResponseMaxBytes)return;
 return {text,...(restoredImages.length?{images:restoredImages}:{})};
}
function nativeMainPromptQueue(n,queue){
 const rows=[];
 for(const item of queue){
  if(!isNativeMainHumanPrompt(n,item))continue;
  const caption=item.preExpansionValue??item.value;
  if(typeof caption==='string'){
   rows.push({item,text:caption});
   continue;
  }
  if(Array.isArray(item.value)&&item.value.some(part=>part?.type==='image')){
   // The original queued-prompt formatter reads the text parts of a multimodal entry.
   rows.push({item,text:n.runtime.fdt(item)||'Image attachment'});
  }
 }
 if(desktopQueuedPrompts.size){
  const liveIds=new Set(queue.map(item=>item.uuid));
  for(const id of desktopQueuedPrompts)if(!liveIds.has(id))desktopQueuedPrompts.delete(id);
 }
 if(!rows.length)return null;
 const items=rows.slice(0,12).map(({item,text})=>({
  id:item.uuid,
  text:text.trim().slice(0,240).replace(/[\uD800-\uDBFF]$/u,''),
  editable:!!nativeQueuedDraft(n,item),
  cancellable:desktopQueuedPrompts.has(item.uuid),
 }));
 // Include waiting work that may join delivery even when the preview shows only human text.
 const revision=createHash('sha256').update(JSON.stringify(queue.map(item=>[item.uuid,item.mode,item.priority,item.screeningPending===true]))).digest('hex');
 return {revision,count:rows.length,items};
}
let sentQueueRevision;
function nativeQueueSendNowController(n){
 const pending=[n.themeRoots.ai().get(process.stdout)?.container?.current],visited=new Set(),controllers=new Set();
 function matches(fn,hash){
  if(typeof fn!=='function')return false;
  let actual=composerFunctionHashes.get(fn);
  if(!actual){actual=createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');composerFunctionHashes.set(fn,actual);}
  return actual===hash;
 }
 while(pending.length){
  const fiber=pending.pop();
  if(!fiber||visited.has(fiber))continue;
  if(visited.size>=4096)throw Error('Claude queue controls are unavailable');
  visited.add(fiber);
  if(fiber.type?.name===nativeFunctionName('QK')
   &&matches(fiber.type,'df272849e942d17c66349e14a5027eb1c8c1155e6cda7f6f9b0c4ac2e807b1f3')){
   const controller=fiber.memoizedProps?.submitController;
   if(matches(controller?.sendQueuedNow,'3006d6da03796ed090d39350a672773b46cd77acc021e6bc4074c34e1893fc6c'))controllers.add(controller);
  }
  if(fiber.sibling)pending.push(fiber.sibling);
  if(fiber.child)pending.push(fiber.child);
 }
 return controllers.size===1?controllers.values().next().value:undefined;
}
async function dispatchNativeQueueAction(n,request,abort,run){
 await n.gate._Jo('desktop');
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal')return {handled:false};
 const draft=await binding.composer.read();
 abort.signal.throwIfAborted();
 const facts=nativeViewFacts(n,binding,abort),turn=n.runtime.lpe(),context=binding.toolContext(abort);
 if(facts.sessionId!==request.session_id||facts.sequence!==request.view_revision||facts.view.kind!=='main'
  ||!turn||turn.turnId!==request.turn_id||turn.cancelled()||draft.text!==''||context.dialogStore.getState().open.length
  ||binding!==(originalContext??n.runtime.ey()))return {handled:false};
 const commands=context.messageQueue.getCommandQueueSnapshot(),queue=nativeMainPromptQueue(n,commands);
 if(!queue||queue.revision!==request.queue_revision)return {handled:false};
 return run({facts,turn,queue,commands,messageQueue:context.messageQueue});
}
function sendNativeQueueNow(n,request,abort){
 return dispatchNativeQueueAction(n,request,abort,({facts,turn,queue})=>{
  const key=JSON.stringify([facts.sessionId,turn.turnId,queue.revision]);
  if(sentQueueRevision===key)return {handled:true};
  const controller=nativeQueueSendNowController(n);
  if(!controller||controller.sendQueuedNow('prompt')!==true)return {handled:false};
  sentQueueRevision=key;
  return {handled:true};
 });
}
function editNativeQueuedPrompt(n,request,abort){
 return dispatchNativeQueueAction(n,request,abort,({commands,messageQueue,queue})=>{
  if(!queue.items.some(row=>row.id===request.item_id&&row.editable)||messageQueue.isFoldInFlight(request.item_id))return {handled:false};
  // The original edit index ranges over all editable rows, including ones outside this desktop preview.
  const editable=commands.filter(n.runtime.Tf);
  const index=editable.findIndex(item=>item.uuid===request.item_id);
  const draft=index<0?undefined:nativeQueuedDraft(n,editable[index],true);
  if(!draft||!messageQueue.popEditableAt(index,'',0))return {handled:false};
  return {handled:true,restored:{id:request.item_id,...draft}};
 });
}
function cancelNativeQueuedPrompt(n,request,abort){
 return dispatchNativeQueueAction(n,request,abort,({commands,messageQueue,queue})=>{
  const id=request.item_id;
  if(!queue.items.some(row=>row.id===id&&row.cancellable)||messageQueue.isFoldInFlight(id))return {handled:false};
  const selected=commands.find(item=>item.uuid===id&&isNativeMainHumanPrompt(n,item));
  if(!selected)return {handled:false};
  // The original queue retains removal accounting and discard notifications for the addressed sender's prompt.
  const removed=messageQueue.removeByFilter(item=>item===selected,{reason:'cancelled_by_sender'});
  if(removed.length!==1)return {handled:false};
  desktopQueuedPrompts.delete(id);
  return {handled:true,cancelled:id};
 });
}
async function promptOutcome(n,id){
 const interruptions=await nativeInterruptionModule();
 if(!preparedPrompt||preparedPrompt.id!==id)return {};
 const context=originalContext??n.runtime.ey();
 const messages=context?.messages?.()??[];
 const chromeCommand=n.commandInput.IS(preparedPrompt.text.trimEnd())?.commandName==='claude-in-chrome';
 const message=messages.findLast(row=>row.promptSubmitEnding&&!preparedPrompt.before.has(row.uuid));
 if(!message){
  const candidates=messages.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true&&!interruptions.Sh(row)&&!preparedPrompt.before.has(row.uuid)&&!(Array.isArray(row.message?.content)&&row.message.content.some(block=>block.type==='tool_result')));
  if(candidates.length===0&&preparedPrompt.queue){
   const {queue,beforeQueue,text}=preparedPrompt;
   // Original zp / Gp identifies the main Agent by its real session-bound ID.
   const matches=queue.getCommandQueueSnapshot().filter(item=>isNativeMainHumanPrompt(n,item)&&!beforeQueue.has(item.uuid)
    &&(item.preExpansionValue??item.value)===text.trim());
   if(matches.length===1){
    const queued=matches[0].uuid;
    desktopQueuedPrompts.add(queued);
    return {queued};
   }
  }
  if(candidates.length===0){
   const reason=nativeUnknownCommandRefusal(n,messages);
   if(reason!==undefined)return {drop:reason};
   if(chromeCommand){
    const open=context?.toolContext(new AbortController()).dialogStore.getState().open;
    if(open?.length===1&&['chrome_install_upsell','chrome_install_setup'].includes(open[0].kind))return {waitingForChromeSetup:true};
   }
   return {};
  }
  if(candidates.length!==1)return {};
  const row=candidates[0],content=typeof row.message.content==='string'?[{type:'text',text:row.message.content}]:row.message.content;
  // The recorded skill invocation is the human row, before the generated meta prompt.
  const chromeInvocation=chromeCommand&&row.origin?.kind==='human'&&content.some(block=>block.type==='text'
   &&typeof block.text==='string'&&block.text.startsWith('<command-message>claude-in-chrome</command-message>\n<command-name>/claude-in-chrome</command-name>'));
  return {accepted:{uuid:row.uuid,door:'prompt',origin:row.origin??{kind:'native'},message:{type:'user',content}},chromeInvocation};
 }
 const ending=message.promptSubmitEnding.ending;
 return {drop:typeof ending?.reason==='string'&&ending.reason?ending.reason:'Native prompt was not submitted'};
}
function ownsActiveQueuedTurn(n,id){
 const turn=n.runtime.lpe();
 return !!turn&&turn.turnId===id&&turn.cancelled()===false;
}
function isSingleQueuedImagePaste(n,previous,next){
 const old=new Set(n.engine.Hc(previous).map(marker=>marker.id));
 const added=n.engine.Hc(next).filter(marker=>!old.has(marker.id)&&marker.match===n.engine.nX(marker.id));
 if(added.length!==1)return false;
 const {index,match}=added[0],left=next.slice(0,index),right=next.slice(index+match.length);
 return left+right===previous||left.endsWith(' ')&&left.slice(0,-1)+right===previous
  ||right.startsWith(' ')&&left+right.slice(1)===previous;
}
async function prepareTerminalPrompt(n,text,id,allowEmpty=false,queueRequested=false,queueTurnId){
 if(typeof text!=='string'||!allowEmpty&&!text.trim()||text.length>nativeUiTextMaxLength)throw Error('Native terminal draft is invalid');
 if(!n.gate.ioe({isRemoteTransport:false,redactsWhatItPersists:false}))throw Error('Native local UI eligibility refused this operation');
 const context=originalContext??n.runtime.ey(),composer=context?.composer;
 if(context?.surface!=='terminal'||!composer)throw Error('Native terminal composer is not bound');
 if(context.toolContext(new AbortController()).getAppState().viewingAgentTaskId!==undefined)throw Error('Return to the native main view before submitting a parent prompt');
 const prior=(await composer.read()).text;
 if(queueTurnId!==undefined&&(!queueRequested||!ownsActiveQueuedTurn(n,queueTurnId)))return {filled:false};
 if(prior&&prior!==preparedPrompt?.text)return {filled:false};
 const before=new Set((context.messages?.()??[]).map(row=>row.uuid));
 const queue=queueRequested?context.toolContext(new AbortController()).messageQueue:undefined;
 if(queueRequested&&typeof queue?.getCommandQueueSnapshot!=='function')throw Error('Native prompt queue is unavailable');
 const beforeQueue=queue?new Set(queue.getCommandQueueSnapshot().map(item=>item.uuid)):undefined;
 const normalize=n.runtime.ilo();
 const core={name:'core',isCore:true,budgetMs:0,run:async input=>{
  if(queueTurnId!==undefined&&((await composer.read()).text!==prior||!ownsActiveQueuedTurn(n,queueTurnId)))return false;
  const value=normalize(input.text);let decorations=input.decorations;
  if(decorations&&value!==input.text){
   const offsets=new Uint32Array(input.text.length+1);let from=0,to=0;
   for(const character of input.text){const next=String.fromCodePoint(value.codePointAt(to)??0),kept=to<value.length&&(character===next||((next==='\n'||next==='\uFFFD')&&normalize(character)===next));for(let unit=0;unit<character.length;unit++)offsets[from+unit]=to+(kept?unit:0);from+=character.length;if(kept)to+=next.length;}
   offsets[input.text.length]=to;const offset=index=>offsets[Math.max(0,Math.min(input.text.length,index))]??value.length;
   decorations=decorations.map(run=>({...run,start:offset(run.start),end:offset(run.end)}));
  }
  const write=()=>composer.write(value,input.mode,decorations);
  // Transporting the person's draft to Enter is a composer change, not a second plugin fill notification.
  return composer.attribute?composer.attribute({kind:'composer'},write):write();
 }};
 const result=await n.runtime.$i('prompt.fill',{core:{'prompt.fill':core}})({text,mode:'replace',origin:{kind:'plugin',name:'apack-native-terminal'}});
 const actual=(await composer.read()).text,filled=result.isFilled===true&&actual===text;
 if(filled)preparedPrompt={id,text:actual,before,queue,beforeQueue,queueTurnId};
 return {filled};
}
function nativeTurnControl(n,request,signal,sessionId){
 if(request.session_id!==sessionId)throw Error('Native turn session changed');
 const turn=n.runtime.lpe();
 if(request.subtype==='apack_turn_state')return {turn:turn?{id:turn.turnId,cancelled:turn.cancelled()}:null};
 // Original oxr / $.turn.abort: a delayed request must never end a replacement turn.
 if(!turn||typeof request.turn_id!=='string'||turn.turnId!==request.turn_id)throw Error('Native turn changed or ended');
 if(turn.cancelled())return {cancelled:false,ending:true};
 signal.throwIfAborted();turn.cancel();return {cancelled:true};
}
// Keep remote edit state separate from the hidden terminal draft used for submission.
const edits=new Map();
function ownedPromptDecorations(n,runs,text,latest){
 const normalized=n.runtime.nxe(runs,text);
 const hints=normalized.filter(run=>run.start===run.end&&run.virtualText);
 if(latest&&hints.length&&text&&text===text.normalize('NFC')
  &&(originalContext??n.runtime.ey())?.surface==='terminal'
  &&n.gate.ioe({isRemoteTransport:false,redactsWhatItPersists:false})
  &&n.themeRoots.ai().get(process.stdout)?.isScreenReaderEnabled===false){
  // Use the native terminal's projected text only to verify normalization; never return it as the draft.
  const display=n.engine.Yen(text,hints).text;
  if(display===display.normalize('NFC'))return normalized;
 }
 return n.runtime.qgr(normalized);
}
function clearEdit(clientId){
 retireDesktopPromptChanges(clientId);
 const state=edits.get(clientId);if(!state)return;
 edits.delete(clientId);state.active?.abort();
 for(const item of state.waiting)item.answer({...item.box,superseded:true});state.waiting=[];
}
function editPrompt(n,clientId,box,key,by){
 let state=edits.get(clientId);
 if(!state){state={box:{text:'',cursor:0},waiting:[]};edits.set(clientId,state);}
 box=n.session.o_n(box);
 if(by==='app'){
  for(const item of state.waiting)item.answer({...item.box,superseded:true});
  state.waiting=[];state.box=box;state.offered=undefined;state.stale=!!state.active;return box;
 }
 const change=desktopPromptChanges.get(clientId);
 if(change&&state.box.text!==box.text){change.plugins=[];change.warned=false;change.pending=undefined}
 return new Promise(answer=>{state.waiting.push({box,key,answer});drainEdit(n,clientId,state);});
}
function drainEdit(n,clientId,state){
 if(state.active||!state.waiting.length)return;
 const batch=state.waiting,next=batch.at(-1);
 for(const item of batch.slice(0,-1))item.answer({...item.box,superseded:true});
 const distance=before=>{const diff=n.session.Aze(before,next.box);return diff.end-diff.start+diff.inputText.length;};
 const before=state.offered&&distance(state.offered)<distance(state.box)?state.offered:state.box;
 const key=batch.length===1?next.key:undefined;
 const nativeKey=key?{key:key.key==='space'?' ':key.key,name:key.key==='space'||[...key.key].length===1?'':key.key,ctrl:key.ctrl===true,shift:key.shift===true,meta:key.meta===true}:undefined;
 state.box=next.box;state.offered=undefined;state.waiting=[];
 const abort=new AbortController();state.active=abort;
 Promise.resolve().then(()=>n.session.kGr({before,after:next.box,...(nativeKey?{key:nativeKey}:{})},abort.signal)).catch(()=>next.box).then(result=>{
  state.active=undefined;
  if(abort.signal.aborted||edits.get(clientId)!==state){next.answer({...next.box,superseded:true});return;}
  const box=n.session.o_n(result),decorations=nativeThemePromptDecorations(n,ownedPromptDecorations(n,result.decorations,box.text,!state.stale&&!state.waiting.length));
  if((box.text!==next.box.text||box.cursor!==next.box.cursor)&&!state.waiting.length&&!state.stale)state.offered=box;
  state.stale=false;next.answer({...box,...(decorations.length?{decorations}:{})});drainEdit(n,clientId,state);
 });
}
// Each attached composer has one native completion chain and at most one queued draft.
${claudeTerminalFileCompletionRuntime}
const completions=new Map();
function clearCompletion(clientId){
 nativeTemplateOffers.delete(clientId);
 const state=completions.get(clientId);if(!state)return;
 completions.delete(clientId);state.active?.abort();
 state.waiting?.answer({suggestions:[],superseded:true});state.waiting=undefined;
}
function autocomplete(n,clientId,box){
 nativeTemplateOffers.delete(clientId);
 let state=completions.get(clientId);
 if(!state){state={};completions.set(clientId,state);}
 return new Promise(answer=>{
  state.waiting?.answer({suggestions:[],superseded:true});
  state.waiting={box,answer};drainCompletion(n,clientId,state);
 });
}
function drainCompletion(n,clientId,state){
 if(state.active){state.active.abort();return;}
 const next=state.waiting;
 if(!next){if(completions.get(clientId)===state)completions.delete(clientId);return;}
 state.waiting=undefined;
 if(!clientViewCurrent(n,clientId)){clearCompletion(clientId);next.answer({suggestions:[],superseded:true});return;}
 const token=nativeFileCompletionToken(next.box),args=n.session.rwt(next.box);
 if(!args&&!token){next.answer({suggestions:[]});drainCompletion(n,clientId,state);return;}
 const abort=new AbortController();state.active=abort;
 const fileScope=token===undefined?undefined:n.fileSuggestionScope?.();
 const fileScopeCurrent=()=>token===undefined||!n.fileSuggestionScope||(fileScope!==undefined&&n.fileSuggestionScope()===fileScope);
 const original=nativeFileCompletions(n,clientId,token,abort,fileScopeCurrent).catch(()=>[]);
 const plugin=Promise.resolve().then(()=>args?n.session.r_n(args,abort.signal):undefined)
  .then(result=>result?n.session.n_n(result.suggestions):[]).catch(()=>[]);
 Promise.all([original,plugin]).then(([files,rows])=>{
  state.active=undefined;
  // Plugin completion can finish after an original native view switch, before desktop detaches.
  if(completions.get(clientId)===state&&!clientViewCurrent(n,clientId))clearCompletion(clientId);
  if(abort.signal.aborted||completions.get(clientId)!==state)next.answer({suggestions:[],superseded:true});
  else next.answer({suggestions:[...(fileScopeCurrent()?files:[]),...rows],start:args?.start??token?.start});
  if(completions.get(clientId)===state)drainCompletion(n,clientId,state);
 });
}
// A revision binds the actual native descriptor and payload objects; no client-supplied tool input.
const dialogRevisions=new Map(),questionFrames=new Map(),questionFrameHistory=new Map(),frozenQuestionFrames=new Map();
let mcpControlActive=false;
${claudeTerminalMcpPolicyRuntime}
${claudeTerminalMcpFormRuntime}
${claudeTerminalMcpUrlRuntime}
${claudeTerminalLspRecommendationRuntime}
${claudeTerminalPluginHintRuntime}
${claudeTerminalGoalProposalRuntime}
${claudeTerminalPeerApprovalRuntime}
${claudeTerminalIdeOnboardingRuntime}
${claudeTerminalFullscreenOfferRuntime}
${claudeTerminalResumeReturnRuntime}
${claudeTerminalColdQuotaRuntime}
${claudeTerminalCostWarningRuntime}
${claudeTerminalRemoteCalloutRuntime}
${claudeTerminalUltraplanChoiceRuntime}
${claudeTerminalUltraplanLaunchRuntime}
${claudeTerminalLeftArrowRuntime}
${claudeTerminalSandboxNetworkRuntime}
${claudeTerminalPublishPluginRuntime}
${claudeTerminalBrowserPermissionRuntime}
${claudeTerminalComputerPermissionRuntime}
${claudeTerminalAutoModeSafetyRuntime}
${claudeTerminalEffortNudgeRuntime}
${claudeTerminalChromeSetupRuntime}
${claudeTerminalManagedSecurityRuntime}
${claudeTerminalAutocompactOfferRuntime}
${claudeTerminalRefusalRuntime}
${claudeTerminalSettingsRuntime}
${claudeTerminalBackgroundRuntime}
function nativeBillingNotice(n){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native notice is not ready');
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native notice session changed');
 const store=binding.toolContext(new AbortController()).dialogStore,open=store.getState().open;
 const item=open.length===1?open[0]:undefined,payload=item?.payload,kind='auto_mode_server_fallback';
 if(item?.kind!==kind||typeof payload?.title!=='string'||!Array.isArray(payload.paragraphs)||!payload.paragraphs.every(text=>typeof text==='string')||typeof payload.helpUrl!=='string'){
  dialogRevisions.delete(kind);return {store,sessionId};
 }
 const fingerprint=JSON.stringify(payload);let revision=dialogRevisions.get(kind);
 if(revision?.item!==item||revision?.payload!==payload||revision?.fingerprint!==fingerprint||revision?.sessionId!==sessionId)revision={item,payload,fingerprint,sessionId,revision:randomUUID()};
 dialogRevisions.set(kind,revision);return {store,...revision};
}
function nativeDialog(n,kind){
 const binding=originalContext??n.runtime.ey();
 if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native dialogs are not ready');
 const context=binding.toolContext(new AbortController()),store=context.dialogStore;
 const sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId;
 if(String(n.questionOptions.q())!==sessionId)throw Error('Native dialog session changed or expired');
 const open=store.getState().open;
 // Other native dialogs retain their original interface until their contracts are integrated.
 const item=open.length===1?open[0]:undefined,payload=item?.payload;
 const supported=kind==='permission_publish_plugin'?payload?.toolName==='PublishPlugin'&&Array.isArray(payload.everything):kind==='permission_monitor'?payload?.toolName==='Monitor'&&typeof payload.intervalMs==='number':kind==='permission_powershell'?payload?.toolName==='PowerShell'&&typeof payload.input?.command==='string':kind==='permission_prompt'?typeof payload?.toolName==='string'&&payload.toolName.length>0&&payload.toolName.length<=256:kind==='permission_webfetch'?payload?.toolName==='WebFetch'&&typeof payload.hostname==='string':kind==='permission_skill'?payload?.toolName==='Skill'&&typeof payload.skill==='string':kind==='permission_workflow'?payload?.toolName==='Workflow'&&typeof payload.script==='string':kind==='permission_bash'?payload?.toolName==='Bash'&&typeof payload.input?.command==='string':kind==='permission_file'?(payload?.toolName==='Read'&&payload.operationType==='read'||['Write','Edit'].includes(payload?.toolName)&&payload.operationType==='write'&&typeof payload.input?.file_path==='string'&&['file-edit-diff','file-write-diff','no-changes'].includes(payload.content?.kind)||payload?.toolName==='NotebookEdit'&&payload.operationType==='write'&&typeof payload.input?.notebook_path==='string'&&['notebook-edit-diff','no-changes'].includes(payload.content?.kind)):kind==='permission_enter_plan_mode'?payload?.toolName==='EnterPlanMode':kind==='permission_exit_plan_mode_v2'?payload?.toolName==='ExitPlanMode'&&typeof payload.plan==='string':kind==='permission_ask_user_question'&&payload?.toolName==='AskUserQuestion'&&Array.isArray(payload.questions);
 if(item?.kind!==kind||!supported||typeof payload.requestId!=='string'||!payload.input||typeof payload.input!=='object'){
  dialogRevisions.delete(kind);return {store,sessionId};
 }
 let revision=dialogRevisions.get(kind);
 const planFacts=['permission_enter_plan_mode','permission_exit_plan_mode_v2'].includes(kind)?planPresentation(n,context,payload):undefined;
 const fingerprint=JSON.stringify([payload,planFacts]);
 if(revision?.fingerprint!==fingerprint||revision?.item!==item||revision?.payload!==payload||revision?.sessionId!==sessionId)
  revision={item,payload,sessionId,fingerprint,revision:randomUUID()};
 dialogRevisions.set(kind,revision);
 return {store,context,planFacts,sessionId,...revision};
}
// Frozen iCe/xit: constructor-produced mode rows and original native reset/message helpers.
function planPresentation(n,context,payload){
 const state=context.getAppState(),permission=state.toolPermissionContext,enter=payload.toolName==='EnterPlanMode';
 const raw=enter?'':payload.plan,empty=raw.trim()==='',withheld=!empty&&(raw.length>200000||n.questionText.VL(raw));
 const choices=[],auto=permission.isAutoModeAvailable===true&&n.runtime.ty(),bypass=permission.isBypassPermissionsModeAvailable===true;
 const add=(value,label,mode,clearContext=false)=>{const row=mode==='auto'?n.planConsent.Y_n('exit-plan-resume'):n.planConsent.kTe(mode,{isBypassPermissionsModeAvailable:bypass});if(row&&n.planConsent.hv(row))choices.push({value,label,mode,clearContext});};
 if(enter)add('yes','Enter plan mode','plan');
 else if(empty)add('yes','Exit plan mode','default');
 else if(!withheld){
  const mode=bypass?'bypassPermissions':auto?'auto':'acceptEdits',label=mode==='bypassPermissions'?'bypass permissions':mode==='auto'?'use auto mode':'auto-accept edits';
  if(state.settings.showClearContextOnPlanAccept===true&&n.paths.Ar()===null)add(mode==='auto'?'yes-auto-clear-context':mode==='bypassPermissions'?'yes-bypass-permissions':'yes-accept-edits','Clear context and '+label,mode,true);
  add(mode==='auto'?'yes-resume-auto-mode':'yes-accept-edits-keep-context','Keep context and '+label,mode);
  add('yes-default-keep-context','Keep context and manually approve edits','default');
 }
 return {plan:withheld?'':raw,...(typeof payload.planFilePath==='string'?{planFilePath:payload.planFilePath}:{}),empty,withheld,choices,initialChoice:state.proactivityLevel==='ask'&&n.planProactivity.BG()&&choices.some(option=>option.value==='yes-default-keep-context')&&!choices.some(option=>option.value==='yes-resume-auto-mode')?'yes-default-keep-context':choices[0]?.value??'',
  permissionMode:permission.mode,prePlanMode:permission.prePlanMode,autoActive:n.planAuto.yp()};
}
async function answerPlan(n,d,request){
 if(request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native plan feedback');
 const feedback=request.feedback?.trim();
 if(request.choice==='no'){d.store.answer(d.item.id,{behavior:'deny',...(feedback?{feedback}:{})});return;}
 const option=d.planFacts.choices.find(option=>option.value===request.choice);
 if(!option)throw Error('Native plan choice is unavailable');
 const enter=d.payload.toolName==='EnterPlanMode',edited=request.plan!==undefined&&request.plan!==d.payload.plan;
 if(request.plan!==undefined&&(enter||d.planFacts.empty||typeof request.plan!=='string'||request.plan.length>200000||n.questionText.VL(request.plan)))throw Error('Native plan cannot be reviewed');
 const plan=edited?request.plan:d.payload.plan,state=d.context.getAppState(),permission=state.toolPermissionContext;
 if(enter){const row=n.planConsent.kTe('plan');if(!row||!n.planConsent.hv(row))throw Error('Native plan entry is unavailable');n.questionOptions.Sye(permission.mode,'plan');d.store.answer(d.item.id,{behavior:'allow',updatedInput:{},permissionUpdates:row.applies});return;}
 if(option.mode!=='auto'&&n.planAuto.yp()){
  n.planAuto.Fx(false);n.questionOptions.EN(true);
  d.context.setAppState(current=>({...current,toolPermissionContext:{...n.planNormalize.vSe(current.toolPermissionContext),prePlanMode:undefined}}));
 }
 if(option.clearContext){
  if(edited&&typeof d.payload.planFilePath==='string'){await n.planStore.ATo(d.payload.planFilePath,plan,d.context.storageV5);n.runtime.rat(d.context.storageV5);if(await n.planStore.bYe(d.context.agentId,d.context.storageV5)!==plan)throw Error('Native revised plan could not be saved');if(nativeDialog(n,d.item.kind).revision!==d.revision)throw Error('Native plan changed while saving');}
  const pointer=n.runtime.Cf(d.sessionId),teamHint=n.planTool.Cxn(n.planTeams.is());
  // Original xit queues the native reset, then resolves this tool as denied.
  d.context.setAppState(current=>({...current,initialMessage:{message:{...n.runtime.Ae({content:'Implement the following plan:\n\n'+plan+'\n\nIf you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: '+pointer+teamHint+(feedback?'\n\nUser feedback on this plan: '+feedback:''),origin:{kind:'auto-continuation'}}),planContent:plan,queueSkipAttachments:true},clearContext:true,resetTrigger:'plan_mode_exit',mode:option.mode}}));
  if(option.mode==='auto')n.planAuto.Fx(true);
  n.questionOptions.x$(true);d.store.answer(d.item.id,{behavior:'deny'});return;
 }
 n.questionOptions.x$(true);n.questionOptions.s3(true);
 let row;
 if(option.mode==='auto'){
  n.planAuto.Fx(true);
  d.context.setAppState(current=>({...current,toolPermissionContext:n.planNormalize.nV({...current.toolPermissionContext,mode:'auto',prePlanMode:undefined,startupModeDecidedByProactivityLevel:undefined})}));
  row=n.planConsent.Y_n('exit-plan-resume');
 }else row=n.planConsent.kTe(option.mode,{isBypassPermissionsModeAvailable:permission.isBypassPermissionsModeAvailable===true});
 if(!row||!n.planConsent.hv(row))throw Error('Native plan choice is no longer available');
 d.store.answer(d.item.id,{behavior:'allow',updatedInput:edited?{plan}:{},permissionUpdates:row.applies,...(feedback?{feedback}:{})});
}
// Frozen terminal nrt/Yyo contract: native schema first, then presentation-only relabel bounds.
function questionShownInput(n,payload,questions){
 const original=n.questionTool.shownCardInput(payload.input),asked=original.questions;
 const parsed=n.questionTool.inputSchema.safeParse({questions});
 if(!parsed.success)return original;
 const drawn=parsed.data.questions;
 if(drawn.length!==asked.length)return original;
 for(let index=0;index<asked.length;index++){
  const before=asked[index],after=drawn[index];
  if((after.multiSelect??false)!==(before.multiSelect??false))return original;
  for(const field of ['label','preview'])if(JSON.stringify(after.options.map(option=>option[field]))!==JSON.stringify(before.options.map(option=>option[field])))return original;
  if(drawn.some((question,other)=>other!==index&&question.question===after.question)||asked.some((question,other)=>other!==index&&question.question===after.question))return original;
 }
 return {...original,questions:drawn};
}
function rememberQuestionFrame(frame){
 for(const[token,previous]of questionFrameHistory)if(previous.client===frame.client&&(previous.item!==frame.item||previous.revision!==frame.revision))questionFrameHistory.delete(token);
 questionFrameHistory.set(frame.token,frame);
 const owned=[...questionFrameHistory.values()].filter(previous=>previous.client===frame.client);
 for(const previous of owned.slice(0,Math.max(0,owned.length-32)))questionFrameHistory.delete(previous.token);
}
function holdQuestionFrame(dialog,token,client){
 const frame=questionFrameHistory.get(token);
 if(!frame||frame.client!==client||!clients.has(client)||frame.item!==dialog.item||frame.revision!==dialog.revision||frame.sessionId!==dialog.sessionId)throw Error('Native question draft drawing changed or expired');
 const prior=frozenQuestionFrames.get(client);
 if(prior&&prior.item===dialog.item&&prior.revision===dialog.revision)return prior;
 frozenQuestionFrames.set(client,frame);return frame;
}
function forgetQuestionClient(client){
 questionFrames.delete(client);frozenQuestionFrames.delete(client);
 for(const[token,frame]of questionFrameHistory)if(frame.client===client)questionFrameHistory.delete(token);
}
function questionAnswerFrame(dialog,request){
 let frame=[...questionFrames.values(),...frozenQuestionFrames.values()].find(frame=>frame.token===request.render_token);
 if(request.draft_started===true){
  const issued=questionFrameHistory.get(request.render_token);
  const held=issued&&holdQuestionFrame(dialog,request.render_token,issued.client);
  if(!held||held.token!==request.render_token)throw Error('Native question draft belongs to another drawing');
  frame=held;
 }
 if(!frame||!clients.has(frame.client)||frame.item!==dialog.item||frame.revision!==dialog.revision||frame.sessionId!==dialog.sessionId)throw Error('Native question drawing changed or expired');
 return frame;
}
function questionCanonicalAnswer(n,dialog,request){
 const original=n.questionTool.shownCardInput(dialog.payload.input);
 if(request.render_token===undefined)return n.questionTool.admitCardAnswer(original,request.answer);
 const frame=questionAnswerFrame(dialog,request);
 const admitted=n.questionTool.admitCardAnswer(frame.shownInput,request.answer);
 if(admitted.kind!=='admitted')return admitted;
 const remap=values=>{
  if(values===undefined)return values;
  const mapped=Object.create(null);
  for(const [question,value]of Object.entries(values)){
   const index=frame.shownInput.questions.findIndex(candidate=>candidate.question===question);
   if(index<0)throw Error('Native question answer has no original identity');
   mapped[original.questions[index].question]=value;
  }
  return mapped;
 };
 const answer={...original,answers:remap(admitted.input.answers),...(admitted.input.annotations!==undefined?{annotations:remap(admitted.input.annotations)}:{}),...(admitted.input.response!==undefined?{response:admitted.input.response}:{}),...(admitted.input.followUp!==undefined?{followUp:admitted.input.followUp}:{})};
 return n.questionTool.admitCardAnswer(original,answer);
}
const nativeQuestionPartials=new WeakMap();
function stageNativeQuestionPartial(n,d,frame,partial){
 if(!partial||!Number.isSafeInteger(partial.sequence)||partial.sequence<1||!partial.answer||
  Object.keys(partial.answer).some(key=>key!=='answers'&&key!=='annotations')||
  JSON.stringify(partial.answer).length>131072)throw Error('Invalid native partial question answer');
 const admitted=questionCanonicalAnswer(n,d,{render_token:frame.token,draft_started:true,answer:{...frame.shownInput,...partial.answer}});
 if(admitted.kind!=='admitted')throw Error('Native partial answer refused: '+admitted.rule);
 const store=d.store;
 let staged=nativeQuestionPartials.get(store);
 if(staged?.item!==d.item){
  staged?.restore();
  const original=store.answer,owners=new Map(),item=d.item;
  let unsubscribe;
  const restore=()=>{
   unsubscribe?.();
   if(store.answer===answer)store.answer=original;
   if(nativeQuestionPartials.get(store)?.item===item)nativeQuestionPartials.delete(store);
  };
  function answer(id,result,...args){
   if(id===item.id&&store.getState().open.some(open=>open===item)){
    try{
     const originalInput=result?.updatedInput;
     // Only the original AFK builder supplies the host timeout field. Manual and raw answers keep their own input.
     if(result?.behavior==='allow'&&Number.isSafeInteger(originalInput?.afkTimeoutMs)&&originalInput.afkTimeoutMs>0&&
       Object.keys(originalInput.answers??{}).length===0&&!result.contentBlocks?.length){
      const view=clientViewKey(n);
      const draft=view&&[...owners.values()].findLast(value=>clients.has(value.frame.client)&&
       clientViews.get(value.frame.client)===view&&frozenQuestionFrames.get(value.frame.client)===value.frame);
      if(draft)result={...result,updatedInput:{...originalInput,answers:draft.answers??{},
       annotations:{...draft.annotations,...originalInput.annotations}},...(draft.contentBlocks?.length?{contentBlocks:draft.contentBlocks}:{})};
     }
    }catch{ /* An unavailable desktop view leaves the original timeout result intact. */ }
    restore();
   }
   return Reflect.apply(original,this,[id,result,...args]);
  }
  store.answer=answer;
  unsubscribe=store.subscribe(()=>{if(!store.getState().open.some(open=>open===item))restore();});
  staged={item,owners,restore};
  nativeQuestionPartials.set(store,staged);
 }
 if((staged.owners.get(frame.client)?.sequence??0)>=partial.sequence)return;
 staged.owners.delete(frame.client);
 const draft={frame,sequence:partial.sequence,answers:admitted.input.answers,annotations:admitted.input.annotations};
 staged.owners.set(frame.client,draft);return draft;
}
// Pinned AskUserQuestion clarification builder (Darwin $rt / Linux zrt).
function questionClarification(n,payload,shown,admitted){
 const summary=shown.questions.map((question,index)=>{
  // Native h4/G6 keeps displayed answer keys but uses the original asked question in feedback.
  const asked=(payload.questions[index]??question).question;
  const title=payload.isEngineConfirm?n.questionDialog.VQo(asked).title:n.questionText.Xi(asked).text;
  const value=admitted.answers?.[question.question];
  const lines=['- "'+title+'"',value?'  Answer: '+value:'  (No answer provided)'];
  const notes=!question.multiSelect&&question.options?.some(option=>questionPreviewKind(n,option.preview)!=='empty')
    ? admitted.annotations?.[question.question]?.notes?.trim():undefined;
  if(notes)lines.push('  User notes: '+notes);
  return lines.join('\n');
 }).join('\n');
 return {behavior:'deny',feedback:'The user wants to clarify these questions.\n'
  +'    This means they may have additional information, context or questions for you.\n'
  +'    Take their response into account and then reformulate the questions if appropriate.\n'
  +'    Start by asking them what they would like to clarify.\n\n'
  +'    Questions asked:\n'+summary};
}
const questionImageTypes=new Set(${JSON.stringify(CLAUDE_QUESTION_IMAGE_TYPES)});
async function questionMedia(n,dialog,media){
 if(typeof media?.id!=='string'||!/^[a-f0-9-]{36}$/i.test(media.id)||!Array.isArray(media.types)||media.types.length<1||media.types.length>${CLAUDE_QUESTION_IMAGE_COUNT}||!media.types.every(type=>questionImageTypes.has(type)))throw Error('Invalid native question attachments');
 const directory=new URL('./question-media-'+media.id+'/',configUrl),directoryStat=lstatSync(directory);
 if(!directoryStat.isDirectory()||directoryStat.uid!==process.getuid?.()||(directoryStat.mode&0o077)!==0)throw Error('Unowned native question attachment directory');
 let remaining=${CLAUDE_QUESTION_IMAGE_BYTES};
 const images=media.types.map((mediaType,index)=>{
  const fd=openSync(new URL(String(index),directory),fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);
  try{
   const entry=fstatSync(fd);
   if(!entry.isFile()||entry.uid!==process.getuid?.()||(entry.mode&0o077)!==0||entry.size<1||entry.size>remaining)throw Error('Invalid native question attachment');
   const data=readFileSync(fd);
   if(data.length!==entry.size)throw Error('Native question attachment changed');
   remaining-=data.length;
   return {data,mediaType};
  }finally{closeSync(fd);}
 });
 const model=n.questionImageModel.CM(dialog.context.getAppState()),limits=n.runtime.ql(model);
 const blocks=await Promise.all(images.map(image=>n.questionImage.jS({...image,limits})));
 if(blocks.some(image=>image.block?.type!=='image'))throw Error(${JSON.stringify(CLAUDE_QUESTION_IMAGE_REFUSAL)});
 return blocks.map(image=>image.block);
}
function questionPreviewKind(n,preview){
 if(typeof preview!=='string')return 'empty';
 return preview.length>2000?'withheld':!n.questionText.zL(preview)?'empty':n.questionText.VL(preview)?'withheld':'full';
}
function questionPresentation(n,payload){
 const previewFormat=n.questionOptions.yjr()??null,previews=[];
 for(const question of payload.questions)for(const option of question.options??[]){
  if(typeof option.preview!=='string')continue;
  // Frozen terminal h4 producer: its 2000-character display cap and native text helpers.
  const kind=questionPreviewKind(n,option.preview);
  previews.push({question:question.question,option:option.label,kind,...(kind==='full'?(previewFormat==='html'?{html:option.preview}:{markdown:n.questionText._gt(option.preview)}):{})});
 }
 const originalNotice=n.runtime?.RFe?.noticesStore().getState().get(payload.requestId);
 const notice=typeof originalNotice?.plugin==='string'&&typeof originalNotice?.text==='string'?n.runtime.z4e(originalNotice.plugin,originalNotice.text):undefined;
 return {previewFormat,extendedQuestions:n.questionOptions.ZCe(),optionalDescriptions:n.questionOptions.Hzo(),previews,...(notice!==undefined?{notice}:{})};
}
const schemaNames={ui_focus:'HUt',ui_scroll:'MUt',ui_panes:'xUt',ui_pane_show:'PUt',ui_pane_focus:'IUt',ui_close:'OUt',ui_prompt_edit:'DUt',ui_prompt_autocomplete:'LUt',ui_attach:'M5n',ui_detach:'H5n',ui_render:'D5n',ui_press:'vUt',ui_input:'AUt',ui_select:'RUt'};
let nativeViewSequence=0,nativeViewKey;
function nativeViewFacts(n,binding,abort){
 const context=binding.toolContext(abort),selected=context.getAppState().viewingAgentTaskId;
 const task=selected===undefined?undefined:context.taskRegistry.get(selected),identity=task?n.runtime.flt(task):undefined;
 const view=selected===undefined?{kind:'main'}:{kind:'agent',registryId:selected,...(identity?{taskId:identity.id}:{})};
 const sessionId=String(n.questionOptions.q()),key=JSON.stringify([sessionId,view]);
 if(key!==nativeViewKey){nativeViewKey=key;nativeViewSequence++;}
 return {sessionId,view,sequence:nativeViewSequence};
}
let costCheckpoint=Promise.resolve(),checkpointedCostKey;
function checkpointNativeCost(n,sessionId){
 const state=n.runtime.adt();
 if(!state||state.sessionId!==sessionId)throw Error('Native cost ledger is unavailable for this session');
 const key=JSON.stringify([state.sessionId,state.totalCostUSD,state.modelUsage]);
 const result=costCheckpoint.then(async()=>{
  if(checkpointedCostKey!==key){
   await n.runtime.kfo(state);
   // appendEntry queues metadata writes. Await the original journal flush before acknowledging cost.
   await n.runtime.Ou();
   checkpointedCostKey=key;
  }
  return {sessionId:state.sessionId,totalCostUsd:state.totalCostUSD};
 });
 costCheckpoint=result.then(()=>{},()=>{});
 return result;
}
let planContextRestored=false;
function restoreNativePlanContext(n,context,sessionId){
 if(planContextRestored||config.restorePlan?.sessionId!==sessionId)return;
 const before=context.getAppState().toolPermissionContext;
 if(before.mode==='plan'&&before.prePlanMode!==config.restorePlan.mode){
  for(const mode of [config.restorePlan.mode,'plan']){
   const result=n.permissions.bC(mode,context.getAppState().toolPermissionContext,update=>context.setToolPermissionContext(update));
   if(!result.ok||context.getAppState().toolPermissionContext.mode!==result.mode)throw Object.assign(Error(result.error??'Native Plan restoration was not acknowledged'),{apackPlanRestore:true});
  }
 }
 planContextRestored=true;
}
async function readNativeNoticeSnapshot(n,signal){
  const policy=nativeManagedSecurity(n);if(policy.item)return {notice:await projectNativeManagedSecurity(n,policy),retirements:policy.startup?[]:nativeRefusalRetirements(n,policy.store)};if(policy.startup)return {notice:null,retirements:[]};
  const refusal=nativeRefusal(n);await restoreNativeRefusalDraft(n,refusal.store);refusal.retirements=nativeRefusalRetirements(n,refusal.store);if(refusal.item)return {notice:await projectNativeRefusal(n,refusal),retirements:refusal.retirements};
  const chrome=nativeChromeSetup(n);if(chrome.item)return {notice:await projectNativeChromeSetup(n,chrome),retirements:refusal.retirements};
  const credit=nativeCreditDialog(n);if(credit)return {notice:await projectNativeCreditDialog(n,credit,signal),retirements:refusal.retirements};
  const effort=nativeEffortNudge(n);if(effort.item)return {notice:await projectNativeEffortNudge(n,effort),retirements:refusal.retirements};
  const autoSafety=nativeAutoModeSafety(n);if(autoSafety.item)return {notice:await projectNativeAutoModeSafety(n,autoSafety),retirements:refusal.retirements};
  const computer=nativeComputerPermission(n);if(computer.item)return {notice:await projectNativeComputerPermission(n,computer),retirements:refusal.retirements};
  const browser=nativeBrowserPermission(n);if(browser.item)return {notice:await projectNativeBrowserPermission(n,browser),retirements:refusal.retirements};
  const publish=nativePublishPlugin(n);if(publish)return {notice:publish.notice,retirements:refusal.retirements};
  const network=nativeSandboxNetwork(n);if(network.item)return {notice:await projectNativeSandboxNetwork(n,network),retirements:refusal.retirements};
  const compact=nativeAutocompactOffer(n);if(compact.item)return {notice:await projectNativeAutocompactOffer(n,compact),retirements:refusal.retirements};
  const quota=nativeColdQuota(n);if(quota.item)return {notice:await projectNativeColdQuota(n,quota),retirements:refusal.retirements};
  const newer=nativeNewerModelOffer(n);if(newer.item)return {notice:await projectNativeNewerModelOffer(n,newer),retirements:refusal.retirements};
  const resume=nativeResumeReturn(n);if(resume.item)return {notice:await projectNativeResumeReturn(n,resume),retirements:refusal.retirements};
  const peer=nativePeerApproval(n);if(peer.item)return {notice:await projectNativePeerApproval(n,peer),retirements:refusal.retirements};
  const goal=nativeGoalProposal(n);if(goal.item)return {notice:await projectNativeGoalProposal(n,goal),retirements:refusal.retirements};
  const agentsReview=nativeLeftArrowReview(n);if(agentsReview.item)return {notice:projectNativeLeftArrow(n,agentsReview),retirements:refusal.retirements};
  const fullscreen=nativeFullscreenOffer(n);if(fullscreen){const offer=await projectNativeFullscreenOffer(n,fullscreen);if(offer)return {notice:offer,retirements:refusal.retirements};}
  const ideWelcome=nativeIdeOnboarding(n);if(ideWelcome){const welcome=await projectNativeIdeOnboarding(n,ideWelcome);if(welcome)return {notice:welcome,retirements:refusal.retirements};}
  const hint=nativePluginHint(n);if(hint.item)return {notice:await projectNativePluginHint(n,hint),retirements:refusal.retirements};
  const recommendation=nativeLspRecommendation(n);if(recommendation.item)return {notice:await projectNativeLspRecommendation(n,recommendation),retirements:refusal.retirements};
  const launch=nativeUltraplanLaunch(n);if(launch)return {notice:launch.notice,retirements:refusal.retirements};
  const ultraplan=nativeUltraplanChoice(n);if(ultraplan)return {notice:ultraplan.notice,retirements:refusal.retirements};
  const remoteCallout=nativeRemoteCallout(n);if(remoteCallout)return {notice:remoteCallout.notice,retirements:refusal.retirements};
  const costWarning=nativeCostWarning(n);if(costWarning)return {notice:costWarning.notice,retirements:refusal.retirements};
  const d=nativeBillingNotice(n);if(d.item)return {retirements:refusal.retirements,notice:{id:d.item.id,revision:d.revision,sessionId:d.sessionId,kind:'auto_mode_server_fallback',title:d.payload.title,paragraphs:d.payload.paragraphs,helpUrl:d.payload.helpUrl}};
  const creditResult=nativeCreditConsentResult(n);if(creditResult)return {retirements:refusal.retirements,notice:creditResult};
  const effortResult=nativeEffortPreferenceResult(n);if(effortResult)return {retirements:refusal.retirements,notice:effortResult};
  const inline=nativeInlineModelOffer(n);return {retirements:refusal.retirements,notice:inline?await projectNativeInlineModelOffer(n,inline):null};
 }
${claudeTerminalBackgroundReplyRuntime}
// Claude's immediate /rename persists the title now but holds its meta row until the turn ends.
async function appendNativeRenameReminder(n,binding,context,sessionId,message){
 const activity=context.turnActivity;
 if(!activity.getSnapshot()||!n.renameTiming.tp()){
  await context.appendSystemMessage(message);
  return;
 }
 const isCurrent=()=>String(n.questionOptions.q())===sessionId&&(originalContext??n.runtime.ey())===binding;
 const release=()=>{
  if(!isCurrent()){unsubscribe();return;}
  if(activity.getSnapshot())return;
  unsubscribe();
  Promise.resolve().then(()=>{
   if(isCurrent())return context.appendSystemMessage(message);
  }).catch(error=>console.error('Could not append the native rename reminder',error));
 };
 const unsubscribe=activity.subscribe(release);
 release();
}
async function control(request,abort){
 const n=await initialize();
 if(request.subtype==='apack_background_reply')return replyNativeBackground(request);
 if(request.subtype==='apack_checkpoint_cost')return checkpointNativeCost(n,request.session_id);
 if(request.subtype==='apack_ui_background_review')return nativeBackgroundReview(n,request);
 if(request.subtype==='apack_desktop_presence'){
  const {focused,observed_at:observed,session_id:sessionId}=request;
  const current=()=>String(n.questionOptions.q())===sessionId&&(originalContext??n.runtime.ey())?.surface==='terminal';
  if(typeof focused!=='boolean'||!Number.isSafeInteger(observed)||observed>Date.now()||!current())throw Error('Native desktop presence owner changed');
  const {h3r:setFocus,cQ:readFocus,_Xo:lastGain}=await import('/$bunfs/root/chunk-7pa9mtjb.js');
  abort.signal.throwIfAborted();
  if(!current()||Date.now()-observed>5000)return {applied:false};
  // A newer native gain belongs to the raw terminal, even if a desktop blur was queued first.
  if(!focused&&lastGain()>observed)return {applied:false};
  if(readFocus()!==(focused?'focused':'blurred'))setFocus(focused);
  return {applied:true};
 }
 if(request.subtype==='apack_ui_settings')return nativeSettings(n,request,abort);
 if(request.subtype==='apack_ui_parent_command')return nativeParentCommand(n,request);
 if(typeof request.client_id==='string'&&clients.has(request.client_id)&&!['ui_attach','ui_detach'].includes(request.subtype)&&!clientViewCurrent(n,request.client_id))throw Error('Native UI client belongs to a different selected view');
 if(['ui_press','ui_input','ui_select'].includes(request.subtype)&&request.instance_revision!==undefined&&!instanceLifetimes.active(request,request.instance_revision))return {handled:false};
 const toolGroupResult=runToolGroupAction(n,request,abort);if(toolGroupResult!==undefined)return toolGroupResult;
 const toolBackgroundResult=runToolBackgroundAction(n,request,abort);if(toolBackgroundResult!==undefined)return toolBackgroundResult;
 if(['ui_press','ui_input','ui_select'].includes(request.subtype)){currentCommandOutputAction(n,request);currentToolResultAction(n,request);currentToolUseAction(n,request);currentToolProgressAction(n,request);currentToolGroupAction(n,request);currentComposerAction(n,request);currentTerminalPlacementAction(n,request);}
 if(request.subtype==='apack_ui_ide_dismiss')return dismissNativeIdeContext(n,request);
 if(request.subtype==='apack_ui_action_key'){
  if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))return {handled:false,action_keys:actionKeys.snapshot(n,request.client_id)};
  await n.gate._Jo('desktop');
  for(const site of sites.values())refreshSite(n,site);
  return actionKeys.key(n,request,abort,value=>control(value,abort));
 }
 if(request.subtype==='apack_ui_agent_dispatch')return dispatchNativeAgentInput(n,request,abort);
 if(request.subtype==='apack_ui_agent_panel')return nativeAgentPanel(n,request);
 if(request.subtype==='apack_ui_agent_command')return answerNativeAgentCommand(n,request);
 if(request.subtype==='apack_parent_prompt_state'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native parent view is unavailable');
  return {main:binding.toolContext(abort).getAppState().viewingAgentTaskId===undefined};
 }
 if(request.subtype==='apack_turn_state'||request.subtype==='apack_abort_turn'){
  const globals=await import('/$bunfs/root/chunk-hdxpvbx1.js');
  return nativeTurnControl(n,request,abort.signal,String(globals.q()));
 }
 if(request.subtype==='apack_owner_snapshot'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native owner is not bound');
  const globals=await import('/$bunfs/root/chunk-hdxpvbx1.js'),settings=await import('/$bunfs/root/chunk-1pjd7qsk.js'),paths=await import('/$bunfs/root/chunk-27d659a1.js'),restrictions=await import('/$bunfs/root/chunk-kmv3514c.js');
  const sessionId=String(globals.q());
  if(sessionId!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId&&request.follow_native_session!==true)throw Error('Native owner session changed');
  const ownerContext=binding.toolContext(abort);
  restoreNativePlanContext(n,ownerContext,sessionId);
  await retireNativePolicyBlockedMcpConnections(n,ownerContext,()=>!abort.signal.aborted&&sessionId===String(globals.q()));
  await prepareNativeHelperPolicy();
  const effective=settings.ut(),policy=settings.me('policySettings')??{},privateHooksSuppressed=restrictions.xr('plugins')===true;
  const helperState=nativeHelperPolicySnapshot(effective,policy);
  const facts=nativeViewFacts(n,binding,abort),view=facts.view;
  if(request.include_main_status_cache===true&&ownerContext.session?.id===sessionId)helperState.cachedMainStatus=nativeMainStatusCache(n,ownerContext,sessionId,helperState.statusCommand);
  if(request.include_main_status_observation===true)helperState.mainStatusObservation=nativeHelperObservationReader?.()??null;
  const activityContext=binding.toolContext(abort),queuedCommands=activityContext.messageQueue.getCommandQueueSnapshot(),activity=n.toolRendering.bDe({tasks:activityContext.taskRegistry.all(),queuedCommands});
  const activeTurn=n.runtime.lpe();
  const preview=await nativeStreamingPreview(n,facts,activeTurn);
  const limits=await import('/$bunfs/root/chunk-2bb0j573.js');
  const billing=limits.xme()?{info:limits.ha(),observedAt:limits.HFs()}:null;
  // The native footer derives its active indicator from the goal start timestamp.
  const goalActive=Number.isSafeInteger(activityContext.getAppState().activeGoal?.setAt);
  if(request.policy_only===true)return {...facts,privateHooksSuppressed,preview,billing,goalActive,promptQueue:view.kind==='main'?nativeMainPromptQueue(n,queuedCommands):null,activeTurnId:activeTurn&&!activeTurn.cancelled()?activeTurn.turnId:null,endingTurnId:activeTurn?.cancelled()?activeTurn.turnId:null,transcriptPath:n.runtime.Cf(sessionId),activity,teammates:nativeTeammateTasks(n,activityContext.taskRegistry),managedTasks:nativeManagedTasks(activityContext.taskRegistry),mcpTasks:nativeMcpTasks(n,activityContext.taskRegistry),shells:nativeShellTasks(activityContext.taskRegistry),workflows:nativeWorkflowTasks(n,activityContext.taskRegistry),focus:nativeFocusProjection(n,facts)??null,...helperState};
  const context=binding.toolContext(abort),messages=binding.messages(),usage=await n.runtime.Hco({},'apack native owner');
  // Frozen native $.session.turns/her semantics include interruption envelopes, unlike person-message history.
  const turns=messages.filter(row=>row.type==='user'&&row.isMeta!==true&&row.isVirtual!==true&&!(Array.isArray(row.message?.content)&&row.message.content.some(block=>block.type==='tool_result'))).length;
  const turn=n.runtime.lpe();
  return {sessionId,view,privateHooksSuppressed,busy:context.turnActivity.getSnapshot()===true,transcriptPath:n.runtime.Cf(sessionId),metadata:{permissionMode:context.getAppState().toolPermissionContext.mode,prePlanMode:context.getAppState().toolPermissionContext.prePlanMode,cwd:paths.ce(),model:binding.model(),modelSelection:context.getAppState().mainLoopModelForSession??context.getAppState().mainLoopModel??'default',turns,startedAt:usage.startedAt,totalCostUsd:usage.cost.usd},...helperState,shellPrefix:process.env.CLAUDE_CODE_SHELL_PREFIX??null,turn:turn?{id:turn.turnId,cancelled:turn.cancelled()}:null,managedTasks:nativeManagedTasks(context.taskRegistry),mcpTasks:nativeMcpTasks(n,context.taskRegistry),shells:nativeShellTasks(context.taskRegistry),workflows:nativeWorkflowTasks(n,context.taskRegistry),taskFacts:Object.values(context.taskRegistry.all()).flatMap(task=>{const identity=n.runtime.flt(task);return identity?[{...identity,status:task.status,isIdle:task.isIdle===true,finalizing:task.finalizing===true,awaitingPlanApproval:task.awaitingPlanApproval===true,keepaliveReasons:[...task.keepaliveReasons??[]]}]:[]})};
 }
 if(request.subtype==='apack_plan_dialogs'){
  let d=nativeDialog(n,'permission_enter_plan_mode');if(!d.item)d=nativeDialog(n,'permission_exit_plan_mode_v2');if(!d.item)return {dialogs:[]};
  const{permissionMode,prePlanMode,autoActive,...presentation}=d.planFacts;
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:d.payload.toolName,input:d.payload.input,presentation,...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{})}]};
 }
 if(request.subtype==='apack_answer_plan_dialog'){
  abort.signal.throwIfAborted();let d=nativeDialog(n,'permission_enter_plan_mode');if(!d.item)d=nativeDialog(n,'permission_exit_plan_mode_v2');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native plan changed or expired');
  await answerPlan(n,d,request);dialogRevisions.delete(d.item.kind);return {answered:true};
 }
 if(request.subtype==='apack_main_queue_send_now')return sendNativeQueueNow(n,request,abort);
 if(request.subtype==='apack_main_queue_edit')return editNativeQueuedPrompt(n,request,abort);
 if(request.subtype==='apack_main_queue_cancel')return cancelNativeQueuedPrompt(n,request,abort);
 if(request.subtype==='apack_native_agents_gesture')return await dispatchNativeAgentsGesture(n,request);
 if(request.subtype==='apack_native_notice')return {...await readNativeNoticeSnapshot(n,abort.signal),handoffPending:nativeAgentsParkState(n)};
 if(request.subtype==='apack_answer_native_notice'){
  abort.signal.throwIfAborted();
  if(request.decision==='credit')return operateNativeCreditDialog(n,request,abort);
  if(['policy_approve','policy_reject'].includes(request.decision)){await answerNativeManagedSecurity(n,request);return {answered:true};}
  if(['compact_previous','compact_next','compact_accept','compact_keep','compact_dismiss'].includes(request.decision)){await answerNativeAutocompactOffer(n,request,abort);return {answered:true};}
  if(['chrome_install','chrome_not_now','chrome_never','chrome_continue','chrome_wait','chrome_skip','chrome_cancel'].includes(request.decision)){answerNativeChromeSetup(n,request);return {answered:true};}
  if(['effort_accept','effort_decline'].includes(request.decision)){answerNativeEffortNudge(n,request);return {answered:true};}
  if(['auto_nudge_accept','auto_nudge_decline','auto_review_accept','auto_review_decline','auto_rules_all','auto_rules_pick','auto_rules_leave','auto_rules_select','auto_rules_submit','auto_safety_cancel'].includes(request.decision)){await answerNativeAutoModeSafety(n,request,abort);return {answered:true};}
  if(['computer_deny','computer_allow','computer_accessibility','computer_screen_recording','computer_retry','computer_cancel'].includes(request.decision)){answerNativeComputerPermission(n,request);return {answered:true};}
  if(['browser_allow','browser_domain','browser_deny','browser_cancel'].includes(request.decision)){answerNativeBrowserPermission(n,request);return {answered:true};}
  if(['publish_plugin_confirm','publish_plugin_decline'].includes(request.decision)){await answerNativePublishPlugin(n,request,abort);return {answered:true};}
  if(['sandbox_allow','sandbox_remember','sandbox_deny','sandbox_cancel'].includes(request.decision)){answerNativeSandboxNetwork(n,request);return {answered:true};}
  if(['background_confirm','background_stay'].includes(request.decision)){await answerNativeLeftArrow(n,request);return {answered:true,handoffPending:nativeAgentsParkState(n)};}
  if(['quota_resume','quota_new_conversation','quota_dismiss'].includes(request.decision)){answerNativeColdQuota(n,request);return {answered:true};}
  if(['newer_accept','newer_keep','newer_dismiss'].includes(request.decision)){answerNativeNewerModelOffer(n,request);return {answered:true};}
  if(['resume_compact','resume_continue','resume_never','resume_dismiss'].includes(request.decision)){answerNativeResumeReturn(n,request);return {answered:true};}
  if(request.decision==='fullscreen_accept'||request.decision==='fullscreen_dismiss'){answerNativeFullscreenOffer(n,request);return {answered:true};}
  if(['ultraplan_launch_run','ultraplan_launch_cancel','ultraplan_launch_escape'].includes(request.decision)){answerNativeUltraplanLaunch(n,request);return {answered:true};}
  if(['ultraplan_here','ultraplan_fresh','ultraplan_cancel'].includes(request.decision)){answerNativeUltraplanChoice(n,request);return {answered:true};}
  if(['remote_enable','remote_dismiss'].includes(request.decision)){answerNativeRemoteCallout(n,request);return {answered:true};}
  if(request.decision==='cost_acknowledge'){answerNativeCostWarning(n,request);return {answered:true};}
  if(request.decision==='ide_welcome_dismiss'){answerNativeIdeOnboarding(n,request);return {answered:true};}
  if(['peer_deny','peer_deliver','peer_cancel'].includes(request.decision)){answerNativePeerApproval(n,request);return {answered:true};}
  if(['goal_accept','goal_decline'].includes(request.decision)){answerNativeGoalProposal(n,request);return {answered:true};}
  if(['retry_fallback','edit_prompt','cancelled'].includes(request.decision)){answerNativeRefusal(n,request);return {answered:true};}
  if(['yes','no','disable'].includes(request.decision)&&nativePluginHint(n).item){answerNativePluginHint(n,request);return {answered:true};}
  if(['yes','no','never','disable'].includes(request.decision)){answerNativeLspRecommendation(n,request);return {answered:true};}
  const d=nativeBillingNotice(n);
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native notice changed or expired');
  if(!['continue','interrupt'].includes(request.decision))throw Error('Invalid native notice decision');
  d.store.answer(d.item.id,request.decision);dialogRevisions.delete('auto_mode_server_fallback');return {answered:true};
 }
 if(request.subtype==='apack_workflow_dialogs'){
  const d=nativeDialog(n,'permission_workflow');if(!d.item)return {dialogs:[]};const {presentation}=await nativeWorkflowPresentation(n,d);
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:'Workflow',input:d.payload.input,presentation,...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{})}]};
 }
 if(request.subtype==='apack_answer_workflow_dialog'){
  abort.signal.throwIfAborted();const d=nativeDialog(n,'permission_workflow');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native workflow approval changed or expired');
  if(!['allow','deny'].includes(request.decision)||request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native workflow decision');
  await answerNativeWorkflow(n,d,request);dialogRevisions.delete('permission_workflow');return {answered:true};
 }
 if(request.subtype==='apack_bash_dialogs'){
  const d=nativeDialog(n,'permission_bash');if(!d.item)return {dialogs:[]};
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:'Bash',...(function(){const source=nativeBashChoices(n,d);return source?{choices:source.choices,choiceToken:source.token}:{};})(),cwd:n.paths.ce(),command:d.payload.input.command,...(typeof d.payload.description==='string'?{description:d.payload.description}:{}),...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{}),input:d.payload.input}]};
 }
 if(request.subtype==='apack_answer_bash_dialog'){
  abort.signal.throwIfAborted();const d=nativeDialog(n,'permission_bash');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native Bash approval changed or expired');
  if(!['allow','deny'].includes(request.decision)||request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native Bash decision');
  if(request.choice!==undefined){if(request.decision!=='allow'||request.feedback!==undefined)throw Error('Invalid native Bash choice response');await answerNativeBashChoice(n,d,request);}
  else{const result=request.decision==='allow'?{behavior:'allow',updatedInput:d.payload.input}:{behavior:'deny',...(request.feedback?{feedback:request.feedback}:{})};d.store.answer(d.item.id,result);}
  dialogRevisions.delete('permission_bash');return {answered:true};
 }
 if(request.subtype==='apack_mcp_input'){const form=nativeMcpDialog(n),url=nativeMcpDialog(n,'url');return {form:nativeMcpFormPresentation(n,form),url:nativeMcpUrlPresentation(n,url)};}
 if(request.subtype==='apack_operate_mcp_form')return operateNativeMcpForm(n,request,abort.signal);
 if(request.subtype==='apack_operate_mcp_url')return operateNativeMcpUrl(n,request,abort.signal);
 if(request.subtype==='apack_generic_tool_permission_dialogs'){
  const shell=nativeDialog(n,'permission_powershell');
  if(shell.item){
   const shown=await nativePowerShellPresentation(n,shell);if(!shown)return {dialogs:[]};
   return {dialogs:[{id:shell.item.id,revision:shell.revision,sessionId:shell.sessionId,requestId:shell.payload.requestId,toolName:'PowerShell',presentation:shown.presentation,reason:shown.reason||undefined,input:shown.withheld?{}:shell.payload.input}]};
  }
  const monitor=nativeDialog(n,'permission_monitor');
  if(monitor.item){
   const {source,...presentation}=await nativeGenericPermissionChoices(n,monitor);
   if(!source||presentation.details.length===0)return {dialogs:[]};
   return {dialogs:[{id:monitor.item.id,revision:monitor.revision,sessionId:monitor.sessionId,requestId:monitor.payload.requestId,toolName:'Monitor',presentation,input:{}}]};
  }
  const d=nativeDialog(n,'permission_prompt');if(!d.item)return {dialogs:[]};
  const shown=await nativeGenericPermissionChoices(n,d),{source,...presentation}=shown;
  const reason=presentation.details.some(detail=>detail.label==='Hook')?undefined:d.payload.permissionResult?.message;
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:d.payload.toolName,presentation,...(typeof reason==='string'?{reason}:{}),input:d.payload.input}]};
 }
 if(request.subtype==='apack_answer_generic_tool_permission_dialog'){
  abort.signal.throwIfAborted();
  const shell=nativeDialog(n,'permission_powershell');
  if(shell.item){
   if(request.id!==shell.item.id||request.revision!==shell.revision||request.session_id!==shell.sessionId)throw Error('Native PowerShell permission changed or expired');
   await answerNativePowerShellPermission(n,shell,request,abort.signal);dialogRevisions.delete('permission_powershell');return {answered:true};
  }
  const monitor=nativeDialog(n,'permission_monitor'),d=monitor.item?monitor:nativeDialog(n,'permission_prompt');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native generic permission changed or expired');
  await answerNativeGenericPermissionChoice(n,d,request);dialogRevisions.delete(d.item.kind);return {answered:true};
 }
 if(request.subtype==='apack_tool_permission_dialogs'){
  let d=nativeDialog(n,'permission_webfetch');if(!d.item)d=nativeDialog(n,'permission_skill');if(!d.item)return {dialogs:[]};
  const shown=await nativeToolPermissionChoices(n,d),{source,...presentation}=shown;
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:d.payload.toolName,presentation,...(typeof d.payload.permissionResult?.message==='string'?{reason:d.payload.permissionResult.message}:{}),input:d.payload.input}]};
 }
 if(request.subtype==='apack_answer_tool_permission_dialog'){
  abort.signal.throwIfAborted();
  if(!['WebFetch','Skill'].includes(request.toolName))throw Error('Unsupported native tool permission');
  const kind=request.toolName==='WebFetch'?'permission_webfetch':'permission_skill',d=nativeDialog(n,kind);
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native tool permission changed or expired');
  await answerNativeToolPermissionChoice(n,d,request);dialogRevisions.delete(kind);return {answered:true};
 }
 if(request.subtype==='apack_file_dialogs'){
  const d=nativeDialog(n,'permission_file');if(!d.item)return {dialogs:[]};
  const p=d.payload;
  const content=p.content,isWrite=['Write','Edit'].includes(p.toolName);
  const withheld=p.contentWithheld===true||content?.kind==='no-changes';
  const review=p.toolName==='NotebookEdit'?nativeNotebookReview(p):isWrite?{withheld,...(typeof content?.message==='string'?{notice:content.message}:typeof content?.notice==='string'?{notice:content.notice}:{}),...(!withheld?(content.kind==='file-write-diff'?{...(content.fileExists?{before:content.oldContent}:{}),after:content.content}:{before:content.edits[0].old_string,after:content.edits[0].new_string,replaceAll:content.edits[0].replace_all===true}):{})}:undefined;
  const choices=await nativeFileChoices(n,d);
  return {dialogs:[{approval:{token:choices.token,ready:choices.ready,choices:choices.choices},id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:p.requestId,toolName:p.toolName,title:p.title??'File permission',question:p.question?.kind==='plain'?p.question.text:p.question?.kind==='file-action'?'Allow Claude to '+p.question.verbPhrase+' '+p.question.fileName+'?':'Allow this file operation?',...(review?{review}:{}),...(typeof p.permissionResult?.message==='string'?{reason:p.permissionResult.message}:{}),input:p.input}]};
 }
 if(request.subtype==='apack_answer_file_dialog'){
  abort.signal.throwIfAborted();
  const d=nativeDialog(n,'permission_file');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native approval changed or expired');
  if(!['allow','deny'].includes(request.decision)||request.feedback!==undefined&&(typeof request.feedback!=='string'||request.feedback.length>4000))throw Error('Invalid native file decision');
  if(request.choice!==undefined&&(typeof request.choice!=='string'||request.choice.length>128)||request.choiceToken!==undefined&&(typeof request.choiceToken!=='string'||!/^[a-f0-9]{64}$/.test(request.choiceToken)))throw Error('Invalid native file choice');
  await answerNativeFileChoice(n,d,request);dialogRevisions.delete('permission_file');
  return {answered:true};
 }
 if(request.subtype==='apack_pending_control'){
  const activeTurn=n.runtime.lpe();
  const turn=activeTurn?{id:activeTurn.turnId,cancelled:activeTurn.cancelled()}:null;
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native dialogs are not ready');
  const store=binding.toolContext(abort).dialogStore,open=store.getState().open;
  if(open.length!==1)return {control:null,turn};
  const item=open[0],routes={permission_ask_user_question:['question','apack_question_dialogs'],permission_bash:['bash','apack_bash_dialogs'],permission_file:['file','apack_file_dialogs'],permission_workflow:['workflow','apack_workflow_dialogs'],permission_prompt:['generic','apack_generic_tool_permission_dialogs'],permission_powershell:['generic','apack_generic_tool_permission_dialogs'],permission_monitor:['generic','apack_generic_tool_permission_dialogs'],permission_webfetch:['tool','apack_tool_permission_dialogs'],permission_skill:['tool','apack_tool_permission_dialogs'],permission_enter_plan_mode:['plan','apack_plan_dialogs'],permission_exit_plan_mode_v2:['plan','apack_plan_dialogs']};
  const route=Object.hasOwn(routes,item.kind)?routes[item.kind]:undefined;if(!route)return {control:null,turn};
  const result=await control({subtype:route[1]},abort),dialog=result.dialogs?.length===1?result.dialogs[0]:undefined;
  abort.signal.throwIfAborted();
  const fresh=nativeDialog(n,item.kind);
  if(n.runtime.lpe()!==activeTurn||activeTurn?.cancelled())throw Error('Native turn changed while reading its control');
  if(!dialog&&['permission_powershell','permission_monitor'].includes(item.kind)&&fresh.item===item)return {control:null,turn};
  if(!dialog||fresh.item!==item||fresh.revision!==dialog.revision||store.getState().open.length!==1||store.getState().open[0]!==item||dialog.sessionId!==String(n.questionOptions.q())||dialog.sessionId!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native control changed while reading');
  return {control:{kind:route[0],dialog},turn};
 }
 if(request.subtype==='apack_question_dialogs'){
  const d=nativeDialog(n,'permission_ask_user_question');if(!d.item)return {dialogs:[]};
  return {dialogs:[{id:d.item.id,revision:d.revision,sessionId:d.sessionId,requestId:d.payload.requestId,toolName:'AskUserQuestion',shownInput:n.questionTool.shownCardInput(d.payload.input),presentation:questionPresentation(n,d.payload)}]};
 }
 if(request.subtype==='apack_hold_question_dialog'){
  abort.signal.throwIfAborted();const d=nativeDialog(n,'permission_ask_user_question');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native question changed or expired');
  const frame=holdQuestionFrame(d,request.render_token,request.client_id);
  if(request.partial!==undefined){
   if(frame.token!==request.render_token||!clientViewCurrent(n,frame.client))throw Error('Native partial question view changed');
   const draft=stageNativeQuestionPartial(n,d,frame,request.partial);
   if(draft&&request.question_media!==undefined){
    const contentBlocks=await questionMedia(n,d,request.question_media);
    abort.signal.throwIfAborted();
    const fresh=nativeDialog(n,'permission_ask_user_question');
    if(fresh.item!==d.item||fresh.revision!==d.revision||!clientViewCurrent(n,frame.client)||
      frozenQuestionFrames.get(frame.client)!==frame)throw Error('Native partial question changed while preparing attachments');
    if(nativeQuestionPartials.get(d.store)?.owners.get(frame.client)===draft)draft.contentBlocks=contentBlocks;
   }
  }
  return {held:true};
 }
 if(request.subtype==='apack_deny_question_dialog'){
  abort.signal.throwIfAborted();
  const d=nativeDialog(n,'permission_ask_user_question');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native question changed or expired');
  if(typeof request.render_token!=='string')throw Error('Native question rejection requires its drawing');
  questionAnswerFrame(d,request);
  // Original Nve Cancel answers deny; store disposal's cancelled is a different lifecycle result.
  d.store.answer(d.item.id,{behavior:'deny'});dialogRevisions.delete('permission_ask_user_question');
  return {answered:true};
 }
 if(request.subtype==='apack_answer_question_dialog'){
  abort.signal.throwIfAborted();
  const d=nativeDialog(n,'permission_ask_user_question');
  if(!d.item||request.id!==d.item.id||request.revision!==d.revision||request.session_id!==d.sessionId)throw Error('Native question changed or expired');
  if(request.decision!==undefined&&request.decision!=='clarify')throw Error('Invalid native question decision');
  let result;
  if(request.decision==='clarify'){
   if(typeof request.render_token!=='string')throw Error('Native question clarification requires its drawing');
   const frame=questionAnswerFrame(d,request);
   const admitted=n.questionTool.admitCardAnswer(frame.shownInput,request.answer);
   if(admitted.kind!=='admitted')throw Error('Native question answer refused: '+admitted.rule);
   if(admitted.input.response!==undefined||admitted.input.followUp!==undefined)throw Error('Native clarification requires answers and eligible notes');
   result=questionClarification(n,d.payload,frame.shownInput,admitted.input);
  }else{
   const admitted=questionCanonicalAnswer(n,d,request);
   if(admitted.kind!=='admitted')throw Error('Native question answer refused: '+admitted.rule);
   // The original tool validates answer keys, shown fields, previews/notes and host-only fields.
   result={behavior:'allow',updatedInput:admitted.input};
  }
  if(request.question_media!==undefined){
   if(typeof request.render_token!=='string')throw Error('Native question attachments require their drawing');
   const frame=questionAnswerFrame(d,request);
   const contentBlocks=await questionMedia(n,d,request.question_media);
   abort.signal.throwIfAborted();
   const fresh=nativeDialog(n,'permission_ask_user_question');
   if(fresh.item!==d.item||fresh.revision!==d.revision||questionAnswerFrame(fresh,request)!==frame)throw Error('Native question changed while preparing attachments');
   result.contentBlocks=contentBlocks;
  }
  d.store.answer(d.item.id,result);
  dialogRevisions.delete('permission_ask_user_question');
  return {answered:true};
 }
 if(request.subtype==='apack_tmux_teammate_target'){
  const binding=originalContext??n.runtime.ey(),facts=nativeViewFacts(n,binding,abort);
  if(facts.sessionId!==request.session_id)throw Error('Native teammate session changed');
  const context=binding.toolContext(abort);
  const matches=Object.values(context.taskRegistry.all()).filter(task=>n.runtime.flt(task)?.id===request.task_id);
  if(matches.length!==1)throw Error('Native teammate is no longer owned by this session');
  const paneId=nativeExternalTmuxPane(context,matches[0]),executable=Bun.which('tmux');abort.signal.throwIfAborted();
  if(!paneId||!executable||nativeViewFacts(n,binding,abort).sessionId!==request.session_id)throw Error('The private teammate terminal is unavailable');
  return {paneId,executable};
 }
 if(request.subtype==='apack_task_control'){
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native task session changed');};
  const binding=originalContext??n.runtime.ey();if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native task controls are not ready');
  if(request.operation==='foreground'){
   if(clients.size)throw Error('Detach desktop prompt handlers before selecting a native Agent view');
   if((await ownerPost('/owner-pending',{})).pending)throw Error('A native parent prompt is pending');
  }
  const result=await nativeTaskControl(n,binding,request,abort,current);
  if(result.view)await ownerPost('/native-view',{...nativeViewFacts(n,binding,abort),pid:process.pid});
  return result;
 }
 if(request.subtype==='apack_mcp_control'){
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native MCP session changed');};
  current();
  if(typeof request.server_name!=='string'||!request.server_name.trim()||!['reconnect','enable','disable'].includes(request.operation))throw Error('Invalid native MCP control');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native MCP controls are not ready');
  const liveMcp=()=>binding.toolContext(abort).getAppState().mcp;
  if(!liveMcp().clients.some(client=>client.name===request.server_name))throw Error('Native MCP server not found');
  if(mcpControlActive)throw Error('Another native MCP control is in progress');
  mcpControlActive=true;try{
  const reconnect=n.mcpControls.Mot(),toggle=n.mcpControls.urs(),disabled=n.mcpControls.Z_e();
  if(typeof reconnect!=='function'||typeof toggle!=='function'||typeof disabled!=='function')throw Error('Native MCP controls are not ready');
  let outcome;
  if(request.operation==='reconnect')outcome=(await reconnect(request.server_name)).client;
  else if(disabled(request.server_name)===(request.operation==='enable'))outcome=await toggle(request.server_name);
  // Original CRe batches store publication on a 16ms timer after its callback resolves.
  const deadline=Date.now()+4000;
  while(outcome){
   current();const row=liveMcp().clients.find(client=>client.name===request.server_name);
   if(row?.type===outcome.type&&(outcome.type!=='connected'||row.client===outcome.client))break;
   if(Date.now()>=deadline)throw Error('Native MCP connection state has not settled; read status again');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  current();
  if(reconnect!==n.mcpControls.Mot()||toggle!==n.mcpControls.urs())throw Error('Native MCP owner changed');
  const context=liveMcp();return {mcpServers:n.mcp.Q_n({connections:context.clients,tools:context.tools})};
  }finally{mcpControlActive=false;}
 }
 if(request.subtype==='apack_memory_dialog'||request.subtype==='apack_memory_edit'){
  const editing=request.subtype==='apack_memory_edit';
  if(editing&&typeof request.enabled!=='boolean')throw Error('Invalid Auto-memory preference');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native memory controls are not ready');
  const context=binding.toolContext(abort),initial=nativeViewFacts(n,binding,abort);
  const current=()=>{
   abort.signal.throwIfAborted();
   const facts=nativeViewFacts(n,binding,abort);
   if((originalContext??n.runtime.ey())!==binding||facts.view.kind!=='main'||facts.sequence!==initial.sequence||
    facts.sessionId!==request.session_id||facts.sessionId!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native memory session or view changed');
  };
  current();
  const command=n.engine.Rs('memory',binding.commands());
  if(command?.thinClientDispatch!=='control-request')throw Error('Claude has not admitted memory controls in this session');
  const eligibility=await import('/$bunfs/root/chunk-bx7jbfqx.js');
  const memory=await import('/$bunfs/root/chunk-sg7akve2.js');
  if(eligibility.qp(context.session))throw Error('Native memory is unavailable on this connection');
  return n.runtime.DS(context.session,async()=>{
   current();
   const state=context.getAppState(),activeAgents=state.agentDefinitions?.activeAgents;
   if(!Array.isArray(activeAgents))throw Error('Native memory sources are not ready');
   const dialog=await memory.buildMemoryDialogResponse({session:context.session,storageV5:context.storageV5,
    credentials:context.credentials,activeAgents,dreamRunning:Object.values(state.tasks).some(task=>task.type==='dream'&&task.status==='running')});
   current();
   if(!editing)return dialog;
   if(!dialog.auto_memory.toggleable)throw Error('Auto-memory cannot be changed in this session: '+dialog.auto_memory.status);
   const writer=await import('/$bunfs/root/chunk-sfa1w2rp.js');
   current();
   if(n.runtime.lpe())throw Error('Wait for the native conversation to become idle before changing Auto-memory');
   const receipt=await writer.runMemorySettingsEdit({autoMemoryEnabled:request.enabled},{json:true});
   if(!receipt.ok||receipt.written?.autoMemoryEnabled!==request.enabled)throw Error(receipt.error??'Native Auto-memory write was not acknowledged');
   return {enabled:receipt.written.autoMemoryEnabled};
  });
 }
 if(request.subtype==='apack_mcp_status'){
  const expected=request.session_id;
  if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native MCP session changed');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native MCP status is not ready');
  const context=binding.toolContext(abort).getAppState().mcp;
  return {mcpServers:n.mcp.Q_n({connections:context.clients,tools:context.tools})};
 }
 if(request.subtype==='apack_rename_session'){
  if(typeof request.title!=='string')throw Error('Native title must be a string');
  const expected=request.session_id;
  const current=()=>{abort.signal.throwIfAborted();if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native rename session changed');};
  current();
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native rename controls are not ready');
  const context=binding.toolContext(abort),result=await n.rename.Qar(request.title,context,true);
  current();if(typeof result.newName!=='string'||!result.newName)throw Error(result.message??'Native rename was refused');
  if(result.isGenerated!==true){
   await appendNativeRenameReminder(n,binding,context,expected,n.runtime.Ae({content:n.rename.G8s(result.newName,result.requestedName),isMeta:true}));
   current();
  }
  return {title:result.newName,message:result.message};
 }
 if(request.subtype==='apack_get_model_selection'){
  const expected=request.session_id;
  if(expected!==String(n.questionOptions.q())||expected!==JSON.parse(readFileSync(configUrl,'utf8')).sessionId)throw Error('Native model session changed');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native model controls are not ready');
  const state=binding.toolContext(abort).getAppState();
  return {sessionId:expected,selection:state.mainLoopModelForSession??state.mainLoopModel??'default'};
 }
 if(request.subtype==='apack_list_models')return {models:n.catalog.kae(n.catalog.dOe(request.include_unsupported_models===true))};
 if(request.subtype==='apack_set_model'){
  if(typeof request.model!=='string'||!request.model.trim()||request.model.length>256)throw Error('Invalid native model selection');
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native model controls are not ready');
  const context=binding.toolContext(abort),sessionId=JSON.parse(readFileSync(configUrl,'utf8')).sessionId,deadline=Date.now()+4000;
  const current=()=>{abort.signal.throwIfAborted();if(Date.now()>deadline||JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==sessionId)throw Error('Native model selection expired or changed session');};
  return n.runtime.DS(context.session,async()=>{
   current();
   const validation=await n.models.dRe(request.model,context.storageV5,context.credentials,{deadlineMs:2500});
   current();if(!validation.ok)throw Error(validation.message);
   if(n.models.Ooe(validation.model))throw Error('This model requires Claude Code consent. Use Choose Claude model in the composer actions to review it.');
   const hooks=await n.models.SC(context.session,context.getAppState,validation.model,'sdk',{signal:abort.signal});
   current();if(hooks.decision!=='proceed')throw Error(n.models.BKe(hooks)+(hooks.decision==='ask'?' Use Choose Claude model in the composer actions to review the original confirmation.':''));
   const notice=await n.models.jKe(context.session,validation.model,context.getAppState,context.setAppState,false,'sdk',validation.substitutedFrom,context.storageV5);
   const state=context.getAppState(),selection=state.mainLoopModelForSession??state.mainLoopModel??'default';
   return {selection,notice};
  });
 }
 if(request.subtype==='apack_ui_capabilities'){const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};return {capabilities:n.gate.Uvn('ui_attach',()=>facts)?[]:['ui_surface_v1','apack_native_view_v1','apack_ui_instance_lifetime_v1']};}
 if(request.subtype==='apack_observe_notices'){installNotices(n,n.runtime.ey());return {observing:true};}
 if(request.subtype==='apack_get_permission_mode'||request.subtype==='apack_set_permission_mode'||request.subtype==='apack_set_composer_phase'){
  const binding=originalContext??n.runtime.ey();
  if(binding?.surface!=='terminal'||typeof binding.toolContext!=='function')throw Error('Native permission controls are not ready');
  const context=binding.toolContext(new AbortController());
  const before=context.getAppState().toolPermissionContext;
  if(request.subtype==='apack_get_permission_mode')return {mode:before.mode,prePlanMode:before.prePlanMode};
  let requestedMode=request.mode;
  if(request.subtype==='apack_set_composer_phase'){
   if(request.phase!=='Plan'&&request.phase!=='Edit')throw Error('Invalid native composer phase');
   requestedMode=request.phase==='Plan'?'plan':before.mode==='plan'?(before.prePlanMode??'default'):before.mode;
  }
  const result=n.permissions.bC(requestedMode,before,update=>context.setToolPermissionContext(update));
  if(!result.ok)throw Error(result.error);
  const mode=context.getAppState().toolPermissionContext.mode;
  if(mode!==result.mode)throw Error('Native permission mode was not applied');
  return {mode,prePlanMode:context.getAppState().toolPermissionContext.prePlanMode};
 }
 if(request.subtype==='apack_prompt_outcome')return promptOutcome(n,request.submission_id);
 if(request.subtype==='apack_release_queued_draft'){
  const draft=preparedPrompt;
  if(!draft?.queueTurnId||draft.id!==request.submission_id)return {released:false};
  const composer=(originalContext??n.runtime.ey())?.composer;
  const box=await composer?.read();
  if(draft!==preparedPrompt||box?.text!==draft.text)return {released:false};
  preparedPrompt=undefined;
  await composer.write('','replace');
  return {released:true};
 }
 if(request.subtype==='apack_terminal_draft'){
  const draft=preparedPrompt;
  if(draft?.id!==request.submission_id)throw Error('Native prepared prompt identity changed');
  const box=await (originalContext??n.runtime.ey()).composer.read();
  if(draft!==preparedPrompt)throw Error('Native prepared prompt identity changed');
  const images=[...box.text.matchAll(/\[image\s*#\d+\]/gi)].length;
  if(request.remember===true){
   if(draft.queueTurnId!==undefined&&!isSingleQueuedImagePaste(n,draft.text,box.text))throw Error('Native draft changed while attaching a queued image');
   draft.text=box.text;
  }
  if(draft.queueTurnId!==undefined&&(!ownsActiveQueuedTurn(n,draft.queueTurnId)||request.confirm===true&&box.text!==draft.text))throw Error('Native turn or draft changed during image preparation');
  return {...box,images};
 }
 if(request.subtype==='apack_prepare_prompt')return prepareTerminalPrompt(n,request.text,request.submission_id,request.allow_empty===true,request.queue===true,request.queue_turn_id);
 let boundQuestion;
 if(request.subtype==='apack_render_question_dialog'){
  abort.signal.throwIfAborted();boundQuestion=nativeDialog(n,'permission_ask_user_question');
  if(!boundQuestion.item||request.id!==boundQuestion.item.id||request.revision!==boundQuestion.revision||request.session_id!==boundQuestion.sessionId)throw Error('Native question changed or expired');
  request={subtype:'ui_render',surface:'desktop',client_id:request.client_id,component:'AskUserQuestion',instance_id:boundQuestion.payload.requestId,props:{},...(request.viewport?{viewport:request.viewport}:{})};
 }
 if(request.subtype==='apack_ui_release_instance'){
  if(!clients.has(request.client_id)||typeof request.component!=='string'||!request.component||request.component.length>256||typeof request.instance_id!=='string'||!request.instance_id||request.instance_id.length>256)throw Error('Native UI instance owner is unavailable');
  const released=instanceLifetimes.retire(request,request.instance_revision);if(released)actionKeys.retire(request);await n.nativeClients.settle(request.client_id,request.component,request.instance_id);return {released};
 }
 if(request.subtype==='apack_ui_terminal_timestamps'){if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native transcript view is detached');return {timestamps:nativeTranscriptTimestamps(n)};}
 if(request.subtype==='apack_ui_terminal_placements'){if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native terminal placement view is detached');return {placements:terminalPlacementList(n)};}
 if(request.subtype==='apack_ui_composer'){if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native composer view is detached');return {placements:nativeComposerList(n,request.client_id)};}
 if(request.subtype==='apack_managed_settings_recheck')return recheckNativeManagedSettings(n,request,abort);
 if(request.subtype==='apack_ui_managed_settings_diagnostics'){if(!clients.has(request.client_id))throw Error('Native settings diagnostic view is detached');return {diagnostics:await readNativeManagedSettingsDiagnostics(()=>clientViewCurrent(n,request.client_id))};}
 if(request.subtype==='apack_ui_diagnostics'){if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native diagnostic view is detached');if(request.columns!==undefined&&(!Number.isSafeInteger(request.columns)||request.columns<20||request.columns>240))throw Error('Invalid diagnostic width');return {diagnostics:await nativeDiagnosticList(n,request.client_id,request.columns,abort.signal)};}
 if(request.subtype==='apack_ui_tool_groups'){if(!clients.has(request.client_id)||!clientViewCurrent(n,request.client_id))throw Error('Native group view is detached');return {groups:nativeToolGroupList(n,request.client_id)};}
 if(request.subtype==='apack_ui_client'){if(!clients.has(request.client_id))throw Error('Native Client view is detached');const surface=n.nativeClients.surface(request.client_id,request.id);if(!surface)return{handled:false};if(surface==='desktop')await n.gate._Jo('desktop');return n.nativeClients.event(request.client_id,request.id,request.sequence,request.event);}
 const schema=schemaNames[request.subtype];
 if(!schema)throw Error('Native terminal UI operation is not integrated: '+request.subtype);
 const {instance_revision:instanceRevision,templateOfferId,...originalRequest}=request;
 const value=n.schemas[schema]().parse(originalRequest);
 if(value.surface!==undefined&&value.surface!=='desktop')throw Error('This app owns a desktop UI surface');
 const facts={isRemoteTransport:false,redactsWhatItPersists:false,isAnySurfaceAttached:n.roster.Kw.list().length>0};
 if(n.gate.Uvn(value.subtype,()=>facts))throw Error('Native UI eligibility refused this operation');
 const clientId=value.client_id;
 if(value.subtype==='ui_attach'){
  const viewKey=clientAttachmentViewKey(n,request.native_view);
  if(!clients.has(clientId)&&clients.size>=64)throw Error('Native UI attachment limit reached');
  const answers=value.answers??[];if(answers.some(answer=>!['ui_prompt_read','ui_prompt_fill','ui_prompt_suggest','ui_copy','ui_read_selection'].includes(answer)))throw Error('Native reverse UI operation is not integrated');
  installNotices(n,n.runtime.ey());
  if(clients.has(clientId)&&clientViews.get(clientId)!==viewKey)throw Error('Detach the previous native view before attaching again');
  if(request.native_view&&answers.includes('ui_prompt_suggest')){
   const binding=originalContext??n.runtime.ey(),viewAbort=new AbortController();
   // Publish the live view before enabling the host, and cancel a parent suggestion that already passed its hook.
   await ownerPost('/native-view',{...nativeViewFacts(n,binding,viewAbort),pid:process.pid});
   if(clientViewKey(n)!==viewKey)throw Error('Native selected view changed during attachment');
   binding.toolContext(viewAbort).session.promptSuggestion.abortController?.abort();
  }
  if(answers.length)installHosts(n);
  clients.add(clientId);clientViews.set(clientId,viewKey);
  try{await n.session.I9s({surface:'desktop',clientId,...(value.viewport?{viewport:value.viewport}:{})},answers);if(clientViewKey(n)!==viewKey)throw Error('Native selected view changed during attachment');}catch(error){clients.delete(clientId);clientViews.delete(clientId);try{await n.session.d2t(clientId,'detach');}catch{}if(!n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.length))restoreHosts(n);throw error;}
  replayNotices();publishPromptTheme(n);
  return {surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_detach'){
  nativeIdeContextLeases.delete(clientId);
  actionKeys.detach(n,clientId);
  await retireNativeAgentCommands(n,clientId);
  instanceLifetimes.detach(clientId);
  n.nativeClients.detach(clientId);nativeRasterMirrors.detach(clientId);
  for(const [key,site] of sites)if(site.clientId===clientId)dropSite(n,key);
  clearEdit(clientId);clearCompletion(clientId);
  forgetQuestionClient(clientId);
  clientViews.delete(clientId);
  for(const [key,frame] of commandOutputFrames)if(frame.clientId===clientId)commandOutputFrames.delete(key);
  for(const [key,frame] of toolResultFrames)if(frame.clientId===clientId)toolResultFrames.delete(key);
  for(const [key,frame] of toolUseFrames)if(frame.clientId===clientId)toolUseFrames.delete(key);
  for(const [key,frame] of toolProgressFrames)if(frame.clientId===clientId)toolProgressFrames.delete(key);
  for(const [key,frame] of toolGroupFrames)if(frame.clientId===clientId)toolGroupFrames.delete(key);
  terminalTimestampSeen.delete(clientId);terminalPlacementSeen.delete(clientId);for(const[key]of terminalPlacementFrames)if(JSON.parse(key)[0]===clientId)terminalPlacementFrames.delete(key);
  composerSeen.delete(clientId);composerClocks.delete(clientId);for(const [key,frame] of composerFrames)if(frame.clientId===clientId)composerFrames.delete(key);
  agentsGestureSequences.delete(clientId);const detached=clients.delete(clientId);if(detached)await n.session.d2t(clientId,'detach');
  if(!n.roster.Kw.list().some(client=>clients.has(client.clientId)&&client.answers?.length))restoreHosts(n);
  return {detached,surfaces:n.runtime.lY()};
 }
 if(value.subtype==='ui_focus')return remoteFocus(n,value);
 if(value.subtype==='ui_scroll')return remoteScroll(n,value);
 if(['ui_panes','ui_pane_show','ui_pane_focus','ui_close'].includes(value.subtype)){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  if(value.subtype==='ui_panes')return {...paneRoster(n),_apack_action_keys:actionKeys.snapshot(n,id)};
  if(value.subtype==='ui_pane_show'){n.roster.avr(value.id);return {shown_id:n.roster.Ui().getState().shownId};}
  if(value.subtype==='ui_pane_focus'){n.roster.GY(value.id);return {focused_id:n.roster.Ui().getState().focusedId};}
  await n.roster.rct(value.id,{kind:'person'});
  return {closed:!n.roster.Hwe(n.roster.Ui().getState()).some(pane=>pane.id===value.id)};
 }
 if(value.subtype==='ui_prompt_edit'){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  return editPrompt(n,id,{text:value.text,cursor:value.cursor},value.key,value.by);
 }
 if(value.subtype==='ui_prompt_autocomplete'){
  const id=clientId??'desktop:default';
  if(!clients.has(id))throw Error('Native UI client is not attached to this owner');
  const box=n.session.o_n({text:value.text,cursor:value.cursor});
  if(templateOfferId!==undefined)return confirmNativeTemplate(id,box,templateOfferId);
  return autocomplete(n,id,box);
 }
 if(value.subtype==='ui_render'){
  actionKeys.invalidate(value);
  if(instanceRevision!==undefined){if(!clients.has(clientId))throw Error('Native UI client is detached');instanceLifetimes.begin(request,instanceRevision);}
  if(!clients.has(clientId))throw Error('Native UI client is not attached to this owner');
  await n.nativeClients.settle(clientId,value.component,value.instance_id);
  if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native UI instance expired before rendering');
  await n.gate._Jo('desktop');
  if(!clientViewCurrent(n,clientId))throw Error('Native UI client belongs to a different selected view');
  if(isTerminalPlacement(value.component)){
   const result=await renderTerminalPlacement(n,value,clientId,instanceRevision,abort);
   actionKeys.capture(n,{...value,instance_revision:instanceRevision},result.tree);
   return {...result,_apack_action_keys:actionKeys.snapshot(n,clientId)};
  }
  const question=boundQuestion;
  let commandFacts,toolFacts,useFacts,progressFacts,groupFacts,composerFacts,engineOutput,idleTaskOutput;
  const props=question?{tool:question.payload.toolName,questions:question.payload.questions,...(question.payload.metadataSource?{metadataSource:question.payload.metadataSource}:{})}:{...value.props};
  if(value.component==='AbovePrompt'||value.component==='Pane'){
   const selected=nativeViewFacts(n,originalContext??n.runtime.ey(),abort).view;
   if(selected.kind==='agent'&&!selected.taskId)throw Error('Native selected Agent is no longer available');
   props.view=selected.kind==='main'?{}:{agentId:selected.taskId};
  }
  if(value.component==='CommandOutput'){
   commandFacts=commandOutputFacts(n,value.instance_id);
   if(!commandFacts){commandOutputFrames.delete(JSON.stringify([clientId,value.instance_id]));return {tree:{type:'engine',ref:0},props:{text:value.props?.text??''},rewritten:false,hooked:false};}
   if(value.props?.text!==commandFacts.display||value.props?.isErrored!==commandFacts.props.isErrored)throw Error('Native command output does not match its history row');
   Object.assign(props,commandFacts.props);
  }
  if(isComposerComponent(value.component)){composerFacts=nativeComposerFacts(n,clientId,value.component,value.instance_id);if(!composerFacts||composerFacts.fingerprint!==value.props?.source_revision)throw Error('Native composer source changed before rendering');for(const key of Object.keys(props))delete props[key];Object.assign(props,composerFacts.props);}
  if(value.component==='ToolGroup'){
   groupFacts=nativeToolGroups(n).get(value.instance_id);if(!groupFacts||groupFacts.revision!==value.props?.source_revision)throw Error('Native group no longer matches its app members');
   const frame=toolGroupFrames.get(JSON.stringify([clientId,value.instance_id]));
   for(const key of Object.keys(props))delete props[key];Object.assign(props,{calls:groupFacts.calls,isActive:groupFacts.isActive,isExpanded:frame?.expanded??(value.props?.isExpanded===true)});
  }
  if(value.component==='ToolProgress'){
   const facts=toolProgressFacts(n,value.instance_id,value.props?.assistant_uuid,abort),key=JSON.stringify([clientId,value.instance_id]);
   if(!facts?.props){n.nativeClients.release(clientId,'ToolProgress',value.instance_id);await n.nativeClients.settle(clientId,'ToolProgress',value.instance_id);if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native tool progress instance expired during cleanup');}
   if(!facts){toolProgressFrames.delete(key);return {tree:{type:'engine',ref:0},props:{},rewritten:false,hooked:false,engine_output:''};}
   const save=()=>{toolProgressFrames.delete(key);toolProgressFrames.set(key,{clientId,id:value.instance_id,assistantUuid:value.props.assistant_uuid,fingerprint:facts.fingerprint,observed:facts.fingerprint});while(toolProgressFrames.size>256)toolProgressFrames.delete(toolProgressFrames.keys().next().value);};
   if(!facts.props){save();return {tree:{type:'engine',ref:0},props:{},rewritten:false,hooked:false,engine_output:''};}
   progressFacts={...facts,save};for(const key of Object.keys(props))delete props[key];Object.assign(props,facts.props);
  }
  if(value.component==='ToolUse'){
   useFacts=toolUseFacts(n,value.instance_id,value.props?.assistant_uuid,abort);
   if(!useFacts){toolUseFrames.delete(JSON.stringify([clientId,value.instance_id]));return {tree:{type:'engine',ref:0},props:{},rewritten:false,hooked:false};}
   for(const key of Object.keys(props))delete props[key];Object.assign(props,useFacts.props);
  }
  if(value.component==='ToolResult'){
   toolFacts=toolResultFacts(n,value.instance_id,value.props?.source_uuid,value.props?.assistant_uuid);
   if(!toolFacts){toolResultFrames.delete(JSON.stringify([clientId,value.instance_id]));return {tree:{type:'engine',ref:0},props:{},rewritten:false,hooked:false};}
   if(value.props.text!==toolFacts.text||value.props.tool!==toolFacts.props.tool||value.props.isErrored!==toolFacts.props.isErrored)throw Error('Native tool result does not match its mounted row');
   for(const key of Object.keys(props))delete props[key];Object.assign(props,toolFacts.props);
  }
  if((value.component==='ToolUse'||value.component==='ToolResult')&&typeof props.tool_use_id!=='string')props.tool_use_id=value.instance_id;
  if(typeof props.output==='string'&&props.output.length>65536)props.output=props.output.slice(0,65536);
  const result=await n.engine.I9e.run({surface:'desktop',component:value.component,requestId:value.instance_id,...(value.viewport?{viewport:value.viewport}:{}),props});
  if(!clientViewCurrent(n,clientId))throw Error('Native UI selection changed while rendering');
  if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native UI instance expired while rendering');
  if(composerFacts){if(nativeComposerFacts(n,clientId,value.component,value.instance_id)?.fingerprint!==composerFacts.fingerprint)throw Error('Native composer source changed while rendering');composerFrames.set(JSON.stringify([clientId,value.component,value.instance_id]),{clientId,component:value.component,id:value.instance_id,fingerprint:composerFacts.fingerprint});if(nativeDrawingUsesEngine(result.tree))engineOutput=await formatNativeComposer(n,composerFacts,result.props,{columns:value.viewport?.columns,signal:abort.signal});idleTaskOutput=await formatNativeIdleTasks(n,composerFacts,{columns:value.viewport?.columns,signal:abort.signal});if(nativeComposerFacts(n,clientId,value.component,value.instance_id)?.fingerprint!==composerFacts.fingerprint)throw Error('Native composer source changed while formatting');if(!clientViewCurrent(n,clientId)||instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native composer lifetime expired while formatting');}
  if(commandFacts){
   if(commandOutputFacts(n,value.instance_id)?.fingerprint!==commandFacts.fingerprint)throw Error('Native command output changed while rendering');
   const key=JSON.stringify([clientId,value.instance_id]);commandOutputFrames.delete(key);commandOutputFrames.set(key,{clientId,fingerprint:commandFacts.fingerprint});
   while(commandOutputFrames.size>256)commandOutputFrames.delete(commandOutputFrames.keys().next().value);
  }
  if(toolFacts){
   if(toolResultFacts(n,value.instance_id,value.props.source_uuid,value.props.assistant_uuid)?.fingerprint!==toolFacts.fingerprint)throw Error('Native tool result changed while rendering');
   const key=JSON.stringify([clientId,value.instance_id]);
   if(nativeDrawingUsesEngine(result.tree)){
    const binding=originalContext??n.runtime.ey();
    engineOutput=await formatNativeToolResult(n,toolFacts,result.props.output,{tools:binding.tools(),columns:value.viewport?.columns,signal:abort.signal});
    if(!clientViewCurrent(n,clientId)||toolResultFacts(n,value.instance_id,value.props.source_uuid,value.props.assistant_uuid)?.fingerprint!==toolFacts.fingerprint)throw Error('Native tool result changed while formatting');
    if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native UI instance expired while formatting');
   }
   toolResultFrames.delete(key);toolResultFrames.set(key,{clientId,resultUuid:value.props.source_uuid,assistantUuid:value.props.assistant_uuid,fingerprint:toolFacts.fingerprint});
   while(toolResultFrames.size>256)toolResultFrames.delete(toolResultFrames.keys().next().value);
  }
  if(groupFacts){
   if(nativeDrawingUsesEngine(result.tree)){
    if(!groupFacts.calls.length&&result.props.isExpanded===true){
     const binding=originalContext??n.runtime.ey(),parts=[];for(const message of groupFacts.message.messages){abort.signal.throwIfAborted();parts.push(await renderNativeToolMessage(n,{messages:groupFacts.message.messages},message,{tools:binding.tools(),columns:value.viewport?.columns,signal:abort.signal}));if(parts.join('\n').length>65536)throw Error('Native notification output exceeds limit');}engineOutput=parts.join('\n');
    }else engineOutput=await formatNativeToolGroup(n,groupFacts,value.viewport?.columns);
   }
   abort.signal.throwIfAborted();if(!clientViewCurrent(n,clientId)||instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native group lifetime expired while formatting');
   if(nativeToolGroups(n).get(value.instance_id)?.revision!==groupFacts.revision)throw Error('Native tool group changed while rendering');
   if(typeof result.props.isExpanded!=='boolean')throw Error('Native group expansion rewrite is invalid');
   const key=JSON.stringify([clientId,value.instance_id]);toolGroupFrames.delete(key);toolGroupFrames.set(key,{clientId,id:value.instance_id,revision:groupFacts.revision,expanded:props.isExpanded,shownExpanded:result.props.isExpanded,usesEngine:nativeDrawingUsesEngine(result.tree),needsRender:false});while(toolGroupFrames.size>256)toolGroupFrames.delete(toolGroupFrames.keys().next().value);
  }
  if(progressFacts){
   if(nativeDrawingUsesEngine(result.tree))engineOutput=await formatNativeToolProgress(n,result.props.hint,{columns:value.viewport?.columns,signal:abort.signal});
   if(!clientViewCurrent(n,clientId)||toolProgressFacts(n,value.instance_id,value.props.assistant_uuid,abort)?.fingerprint!==progressFacts.fingerprint)throw Error('Native tool progress changed while rendering');
   if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native tool progress instance expired while rendering');
   progressFacts.save();
  }
  if(useFacts){
   if(toolUseFacts(n,value.instance_id,value.props.assistant_uuid,abort)?.fingerprint!==useFacts.fingerprint)throw Error('Native tool use changed while rendering');
   if(nativeDrawingUsesEngine(result.tree)){
    const binding=originalContext??n.runtime.ey();
    engineOutput=await formatNativeToolUse(n,useFacts,result.props,{tools:binding.tools(),columns:value.viewport?.columns,signal:abort.signal});
    if(!clientViewCurrent(n,clientId)||toolUseFacts(n,value.instance_id,value.props.assistant_uuid,abort)?.fingerprint!==useFacts.fingerprint)throw Error('Native tool use changed while formatting');
    if(instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native UI instance expired while formatting');
   }
   const key=JSON.stringify([clientId,value.instance_id]);toolUseFrames.delete(key);toolUseFrames.set(key,{clientId,assistantUuid:value.props.assistant_uuid,fingerprint:useFacts.fingerprint});
   while(toolUseFrames.size>256)toolUseFrames.delete(toolUseFrames.keys().next().value);
  }
  let questionFrame;
  if(question){
   abort.signal.throwIfAborted();
   const current=nativeDialog(n,'permission_ask_user_question');
   if(!clients.has(clientId)||current.item!==question.item||current.revision!==question.revision)throw Error('Native question changed while rendering');
   const prior=frozenQuestionFrames.get(clientId);
   const held=prior?.item===question.item&&prior.revision===question.revision?prior:undefined;
   if(!held)frozenQuestionFrames.delete(clientId);
   const shownInput=held?.shownInput??questionShownInput(n,question.payload,result.props.questions),token=held?.token??randomUUID();
   if(!questionFrames.has(clientId)&&questionFrames.size>=64)questionFrames.delete(questionFrames.keys().next().value);
   const frame={client:clientId,token,item:question.item,revision:question.revision,sessionId:question.sessionId,requestId:question.payload.requestId,shownInput};
   questionFrames.set(clientId,frame);rememberQuestionFrame(frame);
   questionFrame={token,dialogId:question.item.id,revision:question.revision,shownInput,presentation:questionPresentation(n,{...question.payload,questions:shownInput.questions})};
  }
  refreshNativeTheme(n);
  const drawingTree=groupFacts?toolGroupDrawing(value,result.tree,instanceRevision):progressFacts?toolBackgroundDrawing(value,result.tree,instanceRevision):result.tree;
  const documentTree=await nativeDocumentTree(n,n.nativeClients.render(clientId,value.component,value.instance_id,drawingTree,instanceRevision),{signal:abort.signal,columns:value.viewport?.columns});
  if(!clients.has(clientId)||!clientViewCurrent(n,clientId)||instanceRevision!==undefined&&!instanceLifetimes.active(request,instanceRevision))throw Error('Native document lifetime expired while formatting');
  if(composerFacts&&nativeComposerFacts(n,clientId,value.component,value.instance_id)?.fingerprint!==composerFacts.fingerprint)throw Error('Native composer source changed while formatting document');
  if(commandFacts&&commandOutputFacts(n,value.instance_id)?.fingerprint!==commandFacts.fingerprint)throw Error('Native command changed while formatting document');
  if(toolFacts&&toolResultFacts(n,value.instance_id,value.props.source_uuid,value.props.assistant_uuid)?.fingerprint!==toolFacts.fingerprint)throw Error('Native result changed while formatting document');
  if(useFacts&&toolUseFacts(n,value.instance_id,value.props.assistant_uuid,abort)?.fingerprint!==useFacts.fingerprint)throw Error('Native tool changed while formatting document');
  if(progressFacts&&toolProgressFacts(n,value.instance_id,value.props.assistant_uuid,abort)?.fingerprint!==progressFacts.fingerprint)throw Error('Native progress changed while formatting document');
  if(groupFacts&&nativeToolGroups(n).get(value.instance_id)?.revision!==groupFacts.revision)throw Error('Native group changed while formatting document');
  if(question){const current=nativeDialog(n,'permission_ask_user_question');if(current.item!==question.item||current.revision!==question.revision)throw Error('Native question changed while formatting document');}
  recordDrawing(n,value,drawingTree);
  actionKeys.capture(n,{...value,instance_revision:instanceRevision},documentTree);
  const wire=toolFacts?nativeToolResultWireProps(result.props):{props:result.props};
  return {...(value.component==='AbovePrompt'?{_apack_ide:nativeIdeContext(n,clientId)}:{}),_apack_action_keys:actionKeys.snapshot(n,clientId),...(composerFacts?.component==='PromptHint'?{native_hint:result.props.hint===composerFacts.props.hint,...(composerFacts.idleReturnHint&&!engineOutput?.includes(composerFacts.idleReturnHint)?{idle_return_hint:composerFacts.idleReturnHint}:{})}:{}),...(groupFacts?{group_engine:nativeDrawingUsesEngine(result.tree)}:{}),...(questionFrame?{question:questionFrame}:{}),...(engineOutput!==undefined?{engine_output:engineOutput}:{}),...(idleTaskOutput?{idle_task_output:idleTaskOutput}:{}),...(toolFacts?{output_rewritten:JSON.stringify(result.props.output)!==JSON.stringify(toolFacts.props.output)}:{}),tree:nativeThemeTree(n,documentTree),...wire,props:questionFrame?{...wire.props,questions:questionFrame.shownInput.questions}:wire.props,rewritten:result.rewritten,hooked:n.gate.n5r(value.component,'desktop'),...(Object.keys(result.clientModules).length?{client_modules:result.clientModules}:{}),drawn_by:result.drawnBy};
 }
 if(!clients.size)throw Error('Native UI has no attached app view');
 for(const site of sites.values())refreshSite(n,site);
 const clientRequest=instanceRevision===undefined?value:{...value,instance_revision:instanceRevision,component:request.component,instance_id:request.instance_id};
 const dispatched=await n.nativeClients.dispatchAction(clientId,clientRequest);if(dispatched!==undefined)return dispatched;
 const clientAction=n.nativeClients.action(clientId,clientRequest);if(clientAction===false)return {handled:false};
 const terminalPlacement=isTerminalPlacement(request.component)?currentTerminalPlacementAction(n,request):undefined;
 if(instanceRevision!==undefined&&!clientAction){const held=n.engine.r5.heldPress(value.plugin,value.handle,value.key);if(!held||held.component!==request.component||held.requestId!==(terminalPlacement?.input.requestId??request.instance_id))return {handled:false};}
 const args={plugin:value.plugin,handle:clientAction?.handle??value.handle,surface:clientAction?.surface??(terminalPlacement?'terminal':'desktop'),...(value.key!==undefined?{element:value.key}:{}),...(clientAction?{component:clientAction.component,requestId:clientAction.requestId}:{...(value.component!==undefined?{component:value.component}:{}),...(value.instance_id!==undefined?{requestId:terminalPlacement?.input.requestId??value.instance_id}:{})})};
 const result=value.subtype==='ui_press'?await n.engine.I9e.press({...args,...(value.href!==undefined?{link:{href:value.href}}:{})}):value.subtype==='ui_input'?await n.engine.I9e.input({...args,kind:value.kind,value:value.value}):await n.engine.I9e.select({...args,value:value.value});
 return result===undefined?{handled:false}:{handled:true,element:result.element,...(value.subtype!=='ui_press'?{value:result.value}:{})};
}
const server=http.createServer(async(request,response)=>{
 const abort=new AbortController();response.once('close',()=>abort.abort());
 const reply=(status,value)=>{if(response.destroyed)return;response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
 if(request.method!=='POST'||request.url!=='/control'||request.headers['x-apack-native-token']!==config.token)return reply(403,{});
 let body;
 try{
  let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>nativeUiTextMessageMaxBytes)return reply(413,{});chunks.push(chunk);}
  body=JSON.parse(Buffer.concat(chunks).toString());
  if(bytes>1048576&&!nativeUiPromptRpcSubtypes.has(body?.request?.subtype))return reply(413,{});
  const current=JSON.parse(readFileSync(configUrl,'utf8'));
  if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id)||!Number.isSafeInteger(body.sequence)||body.sequence<1||body.ownerPid!==process.pid||body.sessionId!==current.sessionId||typeof current.transportEpoch!=='string'||!/^[a-f0-9]{32}$/.test(current.transportEpoch)||body.transportEpoch!==current.transportEpoch)return reply(409,{});
  const identity={id:body.id,pid:process.pid,sessionId:body.sessionId};
  if(sequenceSession!==body.sessionId||sequenceEpoch!==body.transportEpoch){seen.clear();highestSequence=0;sequenceSession=body.sessionId;sequenceEpoch=body.transportEpoch;}
  if(seen.has(body.sequence)||body.sequence<=highestSequence-4096||inFlight>=64)return reply(409,{...identity,error:'Native UI request is repeated, stale or exceeds its concurrent limit'});
  highestSequence=Math.max(highestSequence,body.sequence);seen.add(body.sequence);for(const sequence of seen)if(sequence<=highestSequence-4096)seen.delete(sequence);inFlight++;
  try{
   while(activeSession!==body.sessionId){if(JSON.parse(readFileSync(configUrl,'utf8')).sessionId!==body.sessionId)throw Error('Native session changed during client retirement');await (sessionTransition??=(async()=>{await retireNativeAgentCommands(native);if(native){nativeRasterMirrors.detach();native.nativeClients.detach();for(const key of sites.keys())dropSite(native,key);for(const id of clients){clearEdit(id);clearCompletion(id);await native.session.d2t(id,'detach');}restoreHosts(native);}instanceLifetimes.clear();actionKeys.clear(native);clients.clear();nativeIdeContextLeases.clear();clientViews.clear();commandOutputFrames.clear();toolResultFrames.clear();toolUseFrames.clear();toolProgressFrames.clear();toolGroupFrames.clear();toolGroupSnapshot=undefined;toolGroupRevisions.clear();composerFrames.clear();composerSeen.clear();composerClocks.clear();terminalPlacementFrames.clear();terminalTimestampSeen.clear();terminalPlacementSeen.clear();questionFrames.clear();questionFrameHistory.clear();frozenQuestionFrames.clear();preparedPrompt=undefined;desktopQueuedPrompts.clear();resetNotices(body.sessionId);activeSession=body.sessionId;})().finally(()=>{sessionTransition=undefined;}));}
   const beforeControl=JSON.parse(readFileSync(configUrl,'utf8'));if(beforeControl.sessionId!==body.sessionId||beforeControl.transportEpoch!==body.transportEpoch)throw Error('Native owner changed before UI request');
   const result=await control(body.request,abort);
   const after=JSON.parse(readFileSync(configUrl,'utf8'));if(after.sessionId!==body.sessionId||after.transportEpoch!==body.transportEpoch)throw Error('Native owner changed during UI request');
   reply(200,{...identity,result});
  }catch(error){if(body.request?.subtype==='ui_render')actionKeys.retire(body.request);reply(400,{...identity,error:String(error?.message??error)});}finally{inFlight--;}
 }catch{reply(400,{});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.uiSocketPath,resolve);});server.unref();


async function ownerPost(path,body){
 return new Promise((resolve,reject)=>{const request=http.request({socketPath:config.socketPath,path,method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:2000},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{if(response.statusCode!==200)throw Object.assign(Error('Native owner broker refused'),{status:response.statusCode});resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch(error){reject(error);}});});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('Native owner broker timeout')));request.end(JSON.stringify({sessionId:JSON.parse(readFileSync(configUrl,'utf8')).sessionId,...body,ownerEpoch:config.transportEpoch}));});
}
function ownerAgents(facts){
 const result=new Map();
 for(const task of facts){
  // Frozen native zln projection; task identity comes from the original flt export.
  let status=task.status;
  if(status==='running'&&(task.awaitingPlanApproval||task.isIdle))status='waiting';
  else if(status==='completed')status=task.finalizing?'running':task.keepaliveReasons.some(reason=>reason!=='flag:idle-window')?'waiting':task.name||task.keepaliveReasons.length?'idle':'completed';
  else if(status==='paused')status='idle';
  const prior=result.get(task.id);if(prior&&['running','waiting','idle'].includes(prior.status))continue;
  result.set(task.id,{id:task.id,type:task.type,status});
 }
 return [...result.values()];
}
let ownerReading=false,ownerIndependent=false,reportedView,viewHeartbeat=0,reportedTranscript,reportedActivity,activitySequence=0,reportedFocus,focusSequence=0,reportedPreview,previewSequence=0,settledBillingKey,billingSequence=0;
// Admit a native reset before publishing observations that are fenced by the broker's old session.
async function followNativeOwnerSession(gate){
 if(gate.sessionId===JSON.parse(readFileSync(configUrl,'utf8')).sessionId)return;
 const snapshot=await control({subtype:'apack_owner_snapshot',follow_native_session:true},new AbortController());
 if(snapshot.sessionId!==gate.sessionId)throw Error('Native session changed during owner handoff');
 await ownerPost('/poll',{...snapshot,agents:ownerAgents(snapshot.taskFacts),directOwner:true});
 ownerIndependent=true;
}
async function reportPendingPromptOutcome(id,includeAccepted){
 if(typeof id!=='string'||!id)return;
 const outcome=await control({subtype:'apack_prompt_outcome',submission_id:id},new AbortController());
 if(typeof outcome?.drop==='string')await ownerPost('/submission',{id,drop:outcome.drop});
 else if(typeof outcome?.queued==='string')await ownerPost('/submission',{id,queued:outcome.queued,pid:process.pid});
 else if(outcome?.accepted&&(includeAccepted||outcome.chromeInvocation===true)){
  await ownerPost('/append',{...outcome.accepted,submissionId:id});
  await ownerPost('/submission',{id,accepted:true});
 }
}
const ownerTimer=setInterval(async()=>{
 if(ownerReading)return;ownerReading=true;
 try{
  const signalledMain=nativeMainStatusReconciliation?.startedAt();
  const gate=await control({subtype:'apack_owner_snapshot',policy_only:true,follow_native_session:true,include_main_status_cache:signalledMain!==undefined},new AbortController());
  await followNativeOwnerSession(gate);
  if(signalledMain!==undefined)nativeMainStatusReconciliation.reconcile(signalledMain,gate);
  const viewKey=JSON.stringify([gate.sessionId,gate.view,gate.sequence]);
  // Reaffirm unchanged observations after a broker-side session handoff withdraws its view.
  const refreshView=viewKey!==reportedView||++viewHeartbeat>=4;
  let bootstrapOwner=false;
  if(refreshView){
   const response=await ownerPost('/native-view',{sessionId:gate.sessionId,pid:process.pid,view:gate.view,sequence:gate.sequence,heartbeat:true,promptQueue:gate.promptQueue});
   reportedView=viewKey;viewHeartbeat=0;
   bootstrapOwner=response?.bootstrapOwner===true;
   const command=response?.prepareQueuedPrompt;
   if(command){
    let filled=false;
    try{
     if(command.prepared===true){
      await control({subtype:'apack_terminal_draft',submission_id:command.id,confirm:true},new AbortController());
      filled=true;
     }else filled=(await control({subtype:'apack_prepare_prompt',text:command.text,submission_id:command.id,queue:true},new AbortController())).filled===true;
    }catch{}
    await ownerPost('/result',{id:command.id,filled,pid:process.pid});
   }
   await reportPendingPromptOutcome(response?.pendingSubmissionId,response?.queue===true);
  }
  const billingKey=JSON.stringify([gate.sessionId,gate.billing]);
  if(gate.billing&&billingKey!==settledBillingKey){
   try{
    await ownerPost('/native-billing',{sessionId:gate.sessionId,pid:process.pid,sequence:++billingSequence,...gate.billing});
    settledBillingKey=billingKey;
   }catch(error){
    // Clear can leave the last request's billing snapshot in the CLI. A 400 retires that snapshot.
    // Transient delivery errors can retry, while command polling continues either way.
    if(error?.status===400)settledBillingKey=billingKey;
   }
  }
  const previewKey=JSON.stringify([gate.sessionId,gate.sequence,gate.preview]);
  if((refreshView||previewKey!==reportedPreview)&&await ownerPost('/native-preview',{sessionId:gate.sessionId,pid:process.pid,sequence:++previewSequence,viewRevision:gate.sequence,preview:gate.preview}))reportedPreview=previewKey;
  const focusKey=JSON.stringify([gate.sessionId,gate.sequence,gate.focus]);
  if(refreshView||focusKey!==reportedFocus){await ownerPost('/native-focus',{sessionId:gate.sessionId,pid:process.pid,sequence:++focusSequence,viewRevision:gate.sequence,focus:gate.focus});reportedFocus=focusKey;}
  const activityKey=JSON.stringify([gate.sessionId,gate.activity,gate.workflows,gate.shells,gate.mcpTasks,gate.managedTasks,gate.teammates,gate.activeTurnId,gate.endingTurnId,gate.goalActive]);
  if(refreshView||activityKey!==reportedActivity){await ownerPost('/native-activity',{sessionId:gate.sessionId,pid:process.pid,sequence:++activitySequence,activity:gate.activity,workflows:gate.workflows,shells:gate.shells,mcpTasks:gate.mcpTasks,managedTasks:gate.managedTasks,teammates:gate.teammates,activeTurnId:gate.activeTurnId,endingTurnId:gate.endingTurnId,goalActive:gate.goalActive});reportedActivity=activityKey;}
  const transcriptKey=JSON.stringify([gate.sessionId,gate.transcriptPath]);
  if(transcriptKey!==reportedTranscript&&await ownerPost('/transcript',{sessionId:gate.sessionId,path:gate.transcriptPath}))reportedTranscript=transcriptKey;
  if(gate.privateHooksSuppressed||gate.policy.allowManagedHooksOnly||gate.policy.disableAllHooks||gate.hooksDisabled)ownerIndependent=true;
  if(native){refreshNativeQuestionCountdown(native);refreshNativeTheme(native);refreshNativeToolProgress(native);refreshNativeToolGroups(native);refreshNativeComposer(native);refreshNativeIdeContext(native);refreshTerminalPlacements(native);nativeRasterMirrors.refresh();actionKeys.poll(native);}
  if(!ownerIndependent&&!bootstrapOwner)return;
  const snapshot=await control({subtype:'apack_owner_snapshot',follow_native_session:true},new AbortController());
  const body={...snapshot,agents:ownerAgents(snapshot.taskFacts),directOwner:true,...(!ownerIndependent?{bootstrapOwner:true,pid:process.pid}:{})};
  const command=await ownerPost('/poll',body);
  if(command.keepPlugin===true)return;
  ownerIndependent=true;
  await ownerPost('/transcript',{path:snapshot.transcriptPath});
  if(command.id){
   let filled=command.prepared===true;
   if(!filled)filled=(await control({subtype:'apack_prepare_prompt',text:command.text,submission_id:command.id},new AbortController())).filled===true;
   await ownerPost('/result',{id:command.id,filled});
  }
  const pending=await ownerPost('/owner-pending',{});
  await reportPendingPromptOutcome(pending.id,true);
 }catch(error){if(error?.apackPlanRestore===true)await ownerPost('/observer-error',{message:error.message}).catch(()=>{});}finally{ownerReading=false;}
},250);ownerTimer.unref();
`, 'terminal')
