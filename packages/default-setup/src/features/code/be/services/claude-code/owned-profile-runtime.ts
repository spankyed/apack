/** Node helper for the original native launcher's argv prefix. The shell exec retains the native PID. */
export const claudeOwnedLauncherRuntime = String.raw`import {readFileSync,lstatSync,realpathSync,mkdirSync,mkdtempSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
function processStart(pid){if(process.platform==='linux'){const value=readFileSync('/proc/'+pid+'/stat','utf8');return value.slice(value.lastIndexOf(')')+2).split(' ')[19];}return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:1000}).trim();}
const [configDir,pidText,...argv]=process.argv.slice(2),pid=Number(pidText);
function privateFile(path,maxBytes){const s=lstatSync(path);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)!==0||s.size>maxBytes)throw Error('Unowned Claude child startup input');return readFileSync(path,'utf8');}
function prepare(){
 if(process.env.CLAUDE_CONFIG_DIR!==configDir||process.env.CLAUDE_CODE_SESSION_KIND!=='bg'||!process.env.CLAUDE_BG_RENDEZVOUS_SOCK||argv.includes('--bg-pty-host')||!Number.isSafeInteger(pid)||pid<2)return;
 const sessionId=['--session-id','--resume'].map(flag=>argv.indexOf(flag)).filter(index=>index>=0).map(index=>argv[index+1]).find(value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value));
 if(!sessionId)return;
 let selected;
 for(let index=0;index<argv.length-1;index++){
  if(argv[index]!=='--plugin-dir')continue;
  const directory=dirname(argv[index+1]);
  // Native Unix sockets and preload arguments use our short private observer directory.
  if(!/^\/(?:private\/)?tmp\/cc-child-[A-Za-z0-9]+$/.test(directory))continue;
  const info=lstatSync(directory);if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o077)!==0||realpathSync(directory)!==directory)continue;
  let descriptor;try{descriptor=JSON.parse(privateFile(join(directory,'child-ui-launch.json'),65536));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(descriptor.configDir!==configDir||realpathSync(argv[0])!==descriptor.executable)continue;
  if(selected)throw Error('Multiple app child startup owners');
  if(descriptor.directory!==directory||descriptor.socketPath!==join(directory,'status.sock')||typeof descriptor.token!=='string'||!/^[a-f0-9]{64}$/.test(descriptor.token))throw Error('Invalid app child startup owner');
  selected={directory,descriptor};
 }
 if(!selected)return;
 const {directory,descriptor}=selected;
 const workers=join(directory,'workers');mkdirSync(workers,{mode:0o700,recursive:true});
 const workersInfo=lstatSync(workers);if(!workersInfo.isDirectory()||workersInfo.uid!==process.getuid()||(workersInfo.mode&0o077)!==0)throw Error('Unowned Claude child startup directory');
 for(const name of readdirSync(workers)){
  const match=/^w-([0-9]+)-[A-Za-z0-9]+$/.exec(name);if(!match)continue;
  const priorPid=Number(match[1]);let retired=priorPid===pid;
  if(!retired)try{process.kill(priorPid,0);const marker=JSON.parse(privateFile(join(directory,'worker-'+priorPid+'.json'),65536));retired=marker.start!==processStart(priorPid);}catch(error){if(error.code==='ESRCH')retired=true;}
  if(retired){rmSync(join(workers,name),{recursive:true,force:true});rmSync(join(directory,'worker-'+priorPid+'.json'),{force:true});}
 }
 const worker=mkdtempSync(join(workers,'w-'+pid+'-'));
 const originalBunOptions=process.env.BUN_OPTIONS??null;
 const config={socketPath:descriptor.socketPath,token:randomBytes(32).toString('hex'),sessionId,uiSocketPath:join(worker,'ui.sock'),originalBunOptions};
 writeFileSync(join(worker,'observer.json'),JSON.stringify(config),{mode:0o600,flag:'wx'});
 const runtime=privateFile(join(directory,'child-ui-template.mjs'),4*1024*1024);
 writeFileSync(join(worker,'ui.mjs'),runtime,{mode:0o600,flag:'wx'});
 const marker=join(worker,'startup.mjs');
 writeFileSync(marker,"import {execFileSync} from 'node:child_process';\nimport {readFileSync,writeFileSync} from 'node:fs';\nconst config=JSON.parse(readFileSync(new URL('./observer.json',import.meta.url),'utf8'));\nif(process.pid!=="+pid+"||process.env.CLAUDE_CONFIG_DIR!=="+JSON.stringify(configDir)+")throw Error('Claude child startup identity changed');\nif(config.originalBunOptions===null)delete process.env.BUN_OPTIONS;else process.env.BUN_OPTIONS=config.originalBunOptions;\nwriteFileSync("+JSON.stringify(join(directory,'worker-'+pid+'.json'))+",JSON.stringify({pid:process.pid,sessionId:config.sessionId,start:("+processStart.toString()+") (process.pid),configPath:"+JSON.stringify(join(worker,'observer.json'))+"}),{mode:0o600,flag:'wx'});\nawait import('./ui.mjs');\n",{mode:0o600,flag:'wx'});
 return marker;
}
const preload=prepare();if(preload)process.stdout.write(preload);
`;
