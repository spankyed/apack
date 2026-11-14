import { claudeTerminalStatusObserverRuntime } from './terminal-status-observer-runtime.ts'
/** Authored preload observes native helper I/O without changing commands or stream flow. */
export const claudeTerminalStatusRuntime = String.raw`${claudeTerminalStatusObserverRuntime}
const configUrl=new URL('./observer.json',import.meta.url);
const config=JSON.parse(readFileSync(configUrl,'utf8'));
if(config.originalBunOptions===null||config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
let readNativeHelperPolicy;
const observer=installNativeHelperObserver({resolveConfig:()=>configUrl,readPolicy:()=>readNativeHelperPolicy?.(),onReady:async()=>{
 if(config.uiSocketPath){const ui=await import('./ui.mjs');await ui.prepareNativeHelperPolicy();readNativeHelperPolicy=ui.readNativeHelperPolicy;}
}});
await observer.activate();
`
