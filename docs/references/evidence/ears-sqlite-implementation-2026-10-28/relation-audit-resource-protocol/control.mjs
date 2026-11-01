// Protocol-only orchestration controls. No real child process or native database is started.
import fs from 'node:fs';import{tmpdir}from'node:os';import{join,dirname,resolve}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{EventEmitter}from'node:events';import vm from'node:vm';import assert from'node:assert/strict';
const path=resolve('packages/apack-ears/bench/sqlite/relation-audit-resources.mjs');
let source=fs.readFileSync(path,'utf8');source=source.slice(0,source.indexOf('const [, , mode'));
source=source.replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path).href));
const fixtures={'many-small-keys':{name:'many-small-keys',count:50000,payloadBytes:64},'large-infos':{name:'large-infos',count:10000,payloadBytes:8192}};
const sourceSha='a'.repeat(40),limits={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'};
const phase=()=>({memory:{rss:8192,heapTotal:4096,heapUsed:2048,external:1024,arrayBuffers:512},usage:{maxRSS:8,userCPUTime:100,systemCPUTime:10}});
const modes=['pass','bad-exit','wrong-source','missing-driver','missing-memory','bad-memory','missing-compiled','missing-rows','sampling-error','throws-undefined'];
const checked=[];
for(const mode of modes) {
 const root=fs.mkdtempSync(join(tmpdir(),'ears-audit-protocol-')),scratch=join(root,'scratch'),output=join(root,'report.json');fs.mkdirSync(scratch);let spawned=0;const roots=[];
 try {
  const spawn=(_executable,args)=>{
   if(mode==='throws-undefined')throw undefined;
   spawned++;assert.equal(args[3],'--child');const [own,name,resultFile]=args.slice(4);roots.push(own);
   fs.writeFileSync(join(own,'relation-identities.sqlite3'),Buffer.alloc(64));
   const result={completed:true,fixture:fixtures[name],source:sourceSha,execution:'built-package',baselineGc:true,syncs:false,synchronous:0,sqlite:'3.53.4',
    node:process.version,platform:'linux',arch:'x64',limits,cpuModels:['protocol control CPU'],nativeBindings:[{path:'/fixture/better_sqlite3.node',sha256:'b'.repeat(64)}],
    enginePin:'c'.repeat(40),compiledInputs:Object.fromEntries(['index.js','schema.js','sqlite/database.js','sqlite/audit.js','sqlite/relation-identity.js'].map(path=>[path,'d'.repeat(64)])),
    auditMs:2,setupMs:1,beforeAudit:phase(),afterAudit:phase(),sourceRelationsUnchanged:true,sourceCommitUnchanged:true,audit:{ok:true,issueCount:0,checkedRelations:fixtures[name].count}};
   if(mode==='bad-exit'){result.completed=false;result.failure={message:'child failure retained'};}
   if(mode==='wrong-source')result.source='e'.repeat(40);
   if(mode==='missing-driver')result.nativeBindings=[];
   if(mode==='missing-memory')delete result.afterAudit;
   if(mode==='bad-memory')result.afterAudit.memory.rss=NaN;
   if(mode==='missing-compiled')delete result.compiledInputs['sqlite/audit.js'];
   if(mode==='missing-rows')result.audit.checkedRelations--;
   fs.writeFileSync(resultFile,JSON.stringify(result));
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
   setImmediate(()=>child.emit('close',mode==='bad-exit'?1:0,null));return child;
  };
  const readFileSync=(path,...args)=>String(path).startsWith('/sys/fs/cgroup/')?limits[String(path).split('/').at(-1)]:fs.readFileSync(path,...args);
  const statSync=(path,...args)=>{if(mode==='sampling-error'&&String(path).endsWith('relation-identities.sqlite3'))throw Object.assign(Error('sampling refused'),{code:'EIO'});return fs.statSync(path,...args);};
  const context=vm.createContext({assert,spawn,existsSync:fs.existsSync,mkdirSync:fs.mkdirSync,mkdtempSync:fs.mkdtempSync,readFileSync,readdirSync:fs.readdirSync,renameSync:fs.renameSync,rmSync:fs.rmSync,statSync,writeFileSync:fs.writeFileSync,
   tmpdir:()=>scratch,dirname,join,fileURLToPath,setInterval,clearInterval,process:{platform:'linux',arch:'x64',version:process.version,execPath:'/protocol/node',env:{GITHUB_SHA:sourceSha}}});
  vm.runInContext(source+'\nglobalThis.run=parent;',context);
  let rejected=false;try{await context.run(output);}catch{rejected=true;}
  assert.equal(rejected,mode!=='pass');const report=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(report.completed,mode==='pass');assert.equal(report.trials.length,mode==='pass'?6:1);
  assert(report.trials.every(trial=>trial.scratchRemoved===true));assert(roots.every(root=>!fs.existsSync(root)));
  assert.equal(fs.readdirSync(scratch).length,0);
  if(mode==='bad-exit')assert.equal(report.trials[0].result.failure.message,'child failure retained');
  if(mode==='throws-undefined')assert.equal(report.trials[0].failure.message,'undefined');
  checked.push({mode,spawned,scratchRemoved:true});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log(JSON.stringify({scope:'Mock child protocol/cleanup only; no native execution, timing, resource or container qualification',checked},null,2));
