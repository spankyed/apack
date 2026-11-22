import { claudeTerminalStatusObserverRuntime } from './terminal-status-observer-runtime.ts'
/** Authored preload observes native helper I/O without changing commands or stream flow. */
export const claudeTerminalStatusRuntime = String.raw`${claudeTerminalStatusObserverRuntime}
const configUrl=new URL('./observer.json',import.meta.url);
const config=JSON.parse(readFileSync(configUrl,'utf8'));
if(config.originalBunOptions===null||config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
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
`
