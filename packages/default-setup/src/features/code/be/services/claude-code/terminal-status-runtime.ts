import { claudeTerminalStatusObserverRuntime } from './terminal-status-observer-runtime.ts'
/** Authored preload observes native helper I/O without changing commands or stream flow. */
export const claudeTerminalStatusRuntime = String.raw`${claudeTerminalStatusObserverRuntime}
import { fileURLToPath } from 'node:url';
const configUrl=new URL('./observer.json',import.meta.url);
const config=JSON.parse(readFileSync(configUrl,'utf8'));
if(config.originalBunOptions===null||config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
const restartedFrom=process.env.APACK_CLAUDE_RENDERER_RESTART_EPOCH;
delete process.env.APACK_CLAUDE_RENDERER_RESTART_EPOCH;
let observerAdmitted=true;
if(restartedFrom){
 observerAdmitted=await new Promise(resolve=>{
  const request=http.request({socketPath:config.socketPath,path:'/observer-relaunch',method:'POST',headers:{'x-apack-native-token':config.token,'content-type':'application/json'},timeout:2000},response=>{
   response.resume();response.once('end',()=>resolve(response.statusCode===200));response.once('error',()=>resolve(false));
  });
  request.once('error',()=>resolve(false));request.once('timeout',()=>request.destroy());
  request.end(JSON.stringify({sessionId:config.sessionId,pid:process.pid,previousEpoch:restartedFrom}));
 });
}
if(observerAdmitted){
const execve=process.execve;
if(config.uiSocketPath&&typeof execve==='function')process.execve=function(executable,argv,environment){
 const renderer=environment?.CLAUDE_CODE_TUI_JUST_SWITCHED;
 if(executable===process.execPath&&(renderer==='fullscreen'||renderer==='default')&&Array.isArray(argv)){
  const resume=argv.indexOf('--resume');
  const current=JSON.parse(readFileSync(configUrl,'utf8'));
  if(resume>=0&&argv[resume+1]===current.sessionId){
   const preload=fileURLToPath(import.meta.url);
   environment={...environment,BUN_OPTIONS:[environment.BUN_OPTIONS,'--preload='+preload].filter(Boolean).join(' '),
    APACK_CLAUDE_RENDERER_RESTART_EPOCH:current.transportEpoch};
  }
 }
 return Reflect.apply(execve,this,[executable,argv,environment]);
};
let readNativeHelperPolicy,readNativeHelperCommands,mainReconciliationBound=false;
const observer=installNativeHelperObserver({reconcileSignalledMain:()=>mainReconciliationBound,resolveConfig:()=>configUrl,readPolicy:()=>readNativeHelperPolicy?.(),readCommands:()=>readNativeHelperCommands?.(),onReady:async()=>{
 if(config.uiSocketPath){const ui=await import('./ui.mjs');await ui.prepareNativeHelperPolicy();ui.bindNativeHelperObservationReader(()=>({pending:observer.mainObservationPending,receipt:observer.mainObservation??null}));readNativeHelperPolicy=ui.readNativeHelperPolicy;readNativeHelperCommands=ui.readNativeHelperCommands;
  if(!config.jobSessionId){
   ui.bindNativeMainStatusReconciliation({startedAt:()=>observer.signalledMainStartedAt,reconcile:observer.reconcileMainStatus});
   mainReconciliationBound=true;
  }
 }
}});
await observer.activate();
}
`
