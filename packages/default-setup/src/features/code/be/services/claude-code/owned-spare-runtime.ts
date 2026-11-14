/** A dormant observer follows a native spare's claim without changing its argv, environment or protocol. */
export const claudeOwnedSpareRuntime = String.raw`import {readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareClaudeOwnedWorkerStartup,processStart} from './launch.mjs';
import {installNativeHelperObserver} from './status-observer.mjs';
export async function startOwnedWarmSpare(config,spareDirectory){
 if(process.pid!==config.pid||processStart(process.pid)!==config.start||realpathSync(process.execPath)!==config.executable||process.env.CLAUDE_CONFIG_DIR!==config.configDir)throw Error('Claude spare startup identity changed');
 if(config.originalBunOptions===null||config.originalBunOptions===undefined)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;
 const policy=await import('./helper-policy-reader.mjs');await policy.prepareNativeHelperPolicy();
 const cleanup=()=>{try{rmSync(spareDirectory,{recursive:true,force:true})}catch{process.stderr.write('apack: retired spare observation files could not be removed\n')}};
 const observer=installNativeHelperObserver({
  resolveConfig(){
   const startup=prepareClaudeOwnedWorkerStartup({configDir:config.configDir,pid:process.pid,argv:[process.execPath,...process.argv.slice(2)]});
   if(!startup)return;
   const worker=dirname(startup),configPath=join(worker,'observer.json'),owned=JSON.parse(readFileSync(configPath,'utf8'));
   writeFileSync(join(dirname(dirname(worker)),'worker-'+process.pid+'.json'),JSON.stringify({pid:process.pid,sessionId:owned.sessionId,start:processStart(process.pid),configPath}),{mode:0o600,flag:'wx'});
   cleanup();return pathToFileURL(configPath);
  },
  readPolicy:()=>policy.readNativeHelperPolicy(),
  async onReady({configUrl}){const ui=await import(new URL('./ui.mjs',configUrl));await ui.prepareNativeHelperPolicy();},
 });
 process.once('exit',()=>{observer.close();cleanup()});
}
`;
