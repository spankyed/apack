import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':os.environ['EARS_TEST_SOURCE'],'gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

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
check('fault-regressions',['npm','test','-w','@apackdev/ears','--','tests/sqlite/transaction-failures.spec.ts'],env={'EARS_EVALUATION_BACKEND':'sqlite'})
p=r/'packages/apack-ears/src/sqlite/database.ts';original=p.read_bytes()
try:
 p.write_bytes(pathlib.Path('/baseline-database.ts').read_bytes())
 check('negative-pre-fix',['npm','test','-w','@apackdev/ears','--','tests/sqlite/transaction-failures.spec.ts'],env={'EARS_EVALUATION_BACKEND':'sqlite'},negative=True)
finally:p.write_bytes(original)
probe=r/'storage-exhaustion.mjs'
probe.write_text(r"""import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openDatabase} from '@apackdev/ears/sqlite';import {createEarsEngine} from '@apackdev/ears';
const result=[];
const errorOf=error=>({name:error?.name,code:error?.code,message:error?.message});
for(const kind of ['allocator','tmpfs-spill','tmpfs-commit']){
 const dir=fs.mkdtempSync(path.join(kind==='allocator'?os.tmpdir():'/fault','ears-full-'));
 let db,watch;const observations={kind,events:[]};
 try{
  db=openDatabase({path:dir,syncs:true,schema:{types:{Row:{required:[]}},relations:{},roles:[]}});
  const e=createEarsEngine({database:db});e.create('Row',{id:'Row-before',title:'incumbent'});
  await db.indexesReady();db.sql.pragma('wal_checkpoint(TRUNCATE)');
  const deliveries=[];watch=e.watch(()=>e.query('Row').ids(),v=>deliveries.push([...v]));await e.admin.watchesSettled();
  observations.sequenceBefore=db.sequence;observations.deliveriesBefore=deliveries.length;
  if(kind==='allocator'){
   const pages=db.sql.pragma('page_count',{simple:true});db.sql.pragma('max_page_count='+String(pages+8));
  }else{
   db.sql.pragma('cache_size='+(kind==='tmpfs-spill'?'-64':'-8192'));
   fs.writeFileSync(path.join(dir,'filler'),Buffer.alloc(3*1024*1024));
  }
  const run=db.run.bind(db);db.run=(sql,...args)=>{try{return run(sql,...args)}catch(error){observations.events.push({at:'run',sql:sql.slice(0,100),...errorOf(error)});throw error}};
  const exec=db.sql.exec.bind(db.sql);db.sql.exec=sql=>{try{return exec(sql)}catch(error){observations.events.push({at:'exec',sql,...errorOf(error)});throw error}};
  try{e.create('Row',{id:'Row-refused',body:'x'.repeat(2*1024*1024)});observations.unexpectedSuccess=true}catch(error){observations.error=errorOf(error)}
  observations.inTransaction=db.sql.inTransaction;
  if(kind==='allocator')db.sql.pragma('max_page_count=2147483646');else fs.unlinkSync(path.join(dir,'filler'));
  try{observations.sequenceAfter=db.sequence;observations.idsAfter=e.query('Row').ids();await e.admin.watchesSettled();observations.deliveriesAfter=deliveries.length}catch(error){observations.readError=errorOf(error)}
  try{e.create('Row',{id:'Row-recovered',title:'recovered'});observations.recovered=true}catch(error){observations.recoveryError=errorOf(error)}
 }catch(error){observations.harnessError=errorOf(error)}
 finally{try{watch?.stop();db?.close()}catch(error){observations.closeError=errorOf(error)}fs.rmSync(dir,{recursive:true,force:true})}
 result.push(observations);
}
console.log(JSON.stringify(result,null,2));
""")
with (o/'observations.json').open('w') as f:
 p=subprocess.run(['node',str(probe)],cwd=r,text=True,stdout=f,stderr=subprocess.PIPE,timeout=60)
(o/'stderr.txt').write_text(p.stderr);print('probe-exit',p.returncode,flush=True);assert p.returncode==0,p.stderr
v=json.loads((o/'observations.json').read_text());assert len(v)==3
for item in v:
 assert 'harnessError' not in item,item
 assert item.get('error') is not None and any(e.get('code')=='SQLITE_FULL' for e in item['events']),item
 assert item['error']['code']=='SQLITE_FULL',item
 assert not item['inTransaction'] and item['sequenceBefore']==item['sequenceAfter'],item
 assert item['idsAfter']==['Row-before'] and item['deliveriesBefore']==item['deliveriesAfter'] and item.get('recovered') is True,item
 print(json.dumps({'kind':item['kind'],'reported':item['error'],'underlying':item['events'],'recovered':item.get('recovered')}),flush=True)

for backend in ['sqlite','elmdb']:
 check('contracts-'+backend,['npm','test','-w','@apackdev/ears','--','--reporter=json','--outputFile=/results/'+backend+'.json'],env={'EARS_EVALUATION_BACKEND':backend},timeout=180)
 v=json.loads((o/(backend+'.json')).read_text());print(backend,v['numPassedTests'],v['numFailedTests'],flush=True)
check('ears-api',['npm','run','api:check','-w','@apackdev/ears'])
check('source-node',['npm','test','-w','@apackdev/ears','--','tests/sqlite/source-node.spec.ts'])
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
