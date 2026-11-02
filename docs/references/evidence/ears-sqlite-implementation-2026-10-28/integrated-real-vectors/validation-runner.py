import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:
 source=t.pax_headers.get('comment')
 assert source and len(source)==40
 os.environ['EARS_TEST_SOURCE']=source
 t.extractall(r)
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
limits={name:pathlib.Path('/sys/fs/cgroup',name).read_text().strip() for name in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
(o/'limits.json').write_text(json.dumps(limits,indent=2)+'\n')
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
lock=(r/'package-lock.json').read_bytes()
run('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)
assert results[-1].get('exitCode') == 0
assert (r/'package-lock.json').read_bytes() == lock
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'



def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 results.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start})
 (o/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]





check('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('focused',['npm','test','-w','@apackdev/ears','--','tests/sqlite/vector-execution.spec.ts','tests/sqlite/embeddings.spec.ts','tests/engine/vector.spec.ts','tests/sqlite/search-recovery.spec.ts','tests/sqlite/search-builds.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/focused.json'],env={'EARS_EVALUATION_BACKEND':'sqlite'})
# Negative controls for the two measured plan/probe regressions; restore before all final checks.
for name,before,after in [
 ('owner-plan',"FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id\n      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE ${eligible}\n      AND c.entity_id IN (SELECT entity_id FROM candidates)","FROM candidates a JOIN chunks c ON c.entity_id=a.entity_id JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id\n      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE ${eligible}"),
 ('bounded-probe','WHERE ${eligible} LIMIT 4097)','WHERE ${eligible})')]:
 path=r/'packages/apack-ears/src/sqlite/vectors.ts';original=path.read_bytes();assert original.count(before.encode())==1
 try:
  path.write_bytes(original.replace(before.encode(),after.encode()))
  check('mutation-'+name,['npm','test','-w','@apackdev/ears','--','tests/sqlite/vector-execution.spec.ts','-t','bounds exact reranking','--maxWorkers=1'],env={'EARS_EVALUATION_BACKEND':'sqlite'},negative=True)
  assert 'AssertionError' in (o/('mutation-'+name+'.txt')).read_text()
 finally:path.write_bytes(original)
subprocess.run(['git','diff','--exit-code'],check=True)
check('ears-api',['npm','run','api:check','-w','@apackdev/ears'])
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
check('ears-all',['npm','test','-w','@apackdev/ears','--','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/ears.json'],env={'EARS_EVALUATION_BACKEND':'sqlite'},timeout=240)
check('host-storage',['npm','test','-w','@apackdev/host','--','tests/backup/recovery.spec.ts','tests/backup/recovery-crash.spec.ts','tests/backup/import.spec.ts','tests/backup/import-transaction.spec.ts','tests/backup/logical.spec.ts','tests/backup/logical-crash.spec.ts','tests/backup/storage.spec.ts','tests/database/storage.spec.ts','tests/database/open-app-database.spec.ts','tests/database/write-lock.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/host.json'],env={'EARS_EVALUATION_BACKEND':'sqlite'},timeout=180)
