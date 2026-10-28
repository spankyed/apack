import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':'dirty snapshot: see host ears-maintenance-source.json','gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in pathlib.Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
p=r/'vendor/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine')
p=r/'node_modules/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine/crates/elmdb-node')
os.chdir(r)
probe=r/'permission-denial-probe';probe.mkdir();(probe/'file').write_text('probe');probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Container privileges bypass mode denial; cannot qualify permission tests')
finally:probe.chmod(0o700);shutil.rmtree(probe)
(o/'permission-preflight.json').write_text(json.dumps({'uid':os.getuid(),'modeDenial':True,'capEff':next(line.strip() for line in pathlib.Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:'))},indent=2)+'\n')

results=[]
def run(label,args,limit):
 start=time.monotonic()
 with (o/(label+'.txt')).open('w') as f:
  try:
   p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
   v={'label':label,'exitCode':p.returncode,'seconds':time.monotonic()-start}
  except subprocess.TimeoutExpired:v={'label':label,'timeoutSeconds':limit,'seconds':time.monotonic()-start}
 results.append(v);(o/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(v),flush=True)
source_lock=(r/'package-lock.json').read_bytes()
run('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)
assert (r/'package-lock.json').read_bytes()==source_lock, 'dependency setup changed checked-in lockfile'
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'



def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]
check('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('commit-regressions',['npm','test','-w','@apackdev/ears','--','tests/sqlite/commit-outcomes.spec.ts','tests/sqlite/transaction-failures.spec.ts','tests/engine/maintenance.spec.ts'],env={'EARS_EVALUATION_BACKEND':'sqlite'})
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
import hashlib,tempfile
subprocess.run(['cc','-shared','-fPIC','-Wall','-Wextra','-O2','/fault-shim.c','-ldl','-o','/metrics/fault-shim.so'],check=True)
(o/'shim-sha256.json').write_text(json.dumps({'source':hashlib.sha256(pathlib.Path('/fault-shim.c').read_bytes()).hexdigest(),'library':hashlib.sha256((r/'fault-shim.so').read_bytes()).hexdigest()},indent=2)+'\n')
probe=r/'commit-io-probe.mjs'
probe.write_text(r"""import fs from 'node:fs';import {openDatabase} from '@apackdev/ears/sqlite';import {createEarsEngine} from '@apackdev/ears';
const [dir,mode,exitMode,report]=process.argv.slice(2);
const errorOf=error=>({name:error?.name,code:error?.code,message:error?.message,cause:error?.cause?.code});
let db;
const state={mode,exitMode};
try{
 db=openDatabase({path:dir,syncs:true,schema:{types:{Row:{required:[]}},relations:{},roles:[]}});
 const e=createEarsEngine({database:db});e.create('Row',{id:'Row-before',title:'incumbent'});
 await db.indexesReady();db.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
 state.before=db.sequence;
 if(mode!=='none'){
  const exec=db.sql.exec.bind(db.sql);let armed=true;
  db.sql.exec=sql=>{if(sql==='COMMIT'&&armed){armed=false;fs.writeFileSync(process.env.EARS_FAULT_MARKER,mode)}return exec(sql)};
 }
 try{e.create('Row',{id:'Row-candidate',title:'candidate'});state.returned=true}catch(error){state.error=errorOf(error)}
 state.inTransaction=db.sql.inTransaction;
 try{state.liveSequence=db.sequence;state.liveIds=e.query('Row').ids()}catch(error){state.readError=errorOf(error)}
 fs.writeFileSync(report,JSON.stringify(state,null,2));
 if(exitMode==='crash')process.kill(process.pid,'SIGKILL');
 try{db.close();state.closed=true}catch(error){state.closeError=errorOf(error)}
 fs.writeFileSync(report,JSON.stringify(state,null,2));
}catch(error){state.harnessError=errorOf(error);fs.writeFileSync(report,JSON.stringify(state,null,2));process.exitCode=1}
""")
reader=r/'commit-io-read.mjs'
reader.write_text("import {openDatabase} from '@apackdev/ears/sqlite';import {createEarsEngine} from '@apackdev/ears';const db=openDatabase({path:process.argv[2],readOnly:true});try{console.log(JSON.stringify({sequence:db.sequence,ids:createEarsEngine({database:db}).query('Row').ids()}));}finally{db.close();}")
results=[]
for mode in ['none','before','after']:
 for exit_mode in ['clean','crash']:
  name=mode+'-'+exit_mode;dir=pathlib.Path(tempfile.mkdtemp(prefix='ears-commit-io-'));report=o/(name+'.json');log=o/(name+'-syscalls.jsonl')
  env=os.environ|{'LD_PRELOAD':'/metrics/fault-shim.so','EARS_FAULT_WAL':str(dir/'data.sqlite3-wal'),'EARS_FAULT_MARKER':str(dir/'arm'),'EARS_FAULT_LOG':str(log)}
  p=subprocess.run(['node',str(probe),str(dir),mode,exit_mode,str(report)],cwd=r,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
  (o/(name+'.txt')).write_text(p.stdout);assert p.returncode==(0 if exit_mode=='clean' else -9),p.stdout
  state=json.loads(report.read_text());assert 'harnessError' not in state,state
  recovered=subprocess.run(['node',str(reader),str(dir)],cwd=r,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
  (o/(name+'-reopen.txt')).write_text(recovered.stdout+recovered.stderr);assert recovered.returncode==0,recovered.stderr
  state['reopened']=json.loads(recovered.stdout);state['syscalls']=[json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
  assert (not state['syscalls'] if mode=='none' else len(state['syscalls'])==1),state
  if mode!='none':assert state.get('error',{}).get('code','').__eq__('COMMIT_UNKNOWN'),state
  results.append(state);(o/'outcomes.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(state),flush=True)
