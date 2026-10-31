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

backend={'EARS_EVALUATION_BACKEND':'sqlite'}
check('benchmark-syntax',['node','--check','packages/apack-ears/bench/sqlite/text-shape.mjs'])
check('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('text-prefixes',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-limits.spec.ts','tests/sqlite/text-documents.spec.ts','tests/engine/search.spec.ts','tests/engine/search-relevance.spec.ts','tests/engine/vector.spec.ts','tests/sqlite/source-node.spec.ts'],env=backend)
check('native-search',['npm','test','-w','@apackdev/ears','--','tests/engine/search.spec.ts','tests/engine/search-relevance.spec.ts'],env={'EARS_EVALUATION_BACKEND':'elmdb'})
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
check('ears-api',['npm','run','api:check','-w','@apackdev/ears'])
p=r/'packages/apack-ears/src/sqlite/text.ts';original=p.read_text()
for label,old,new,pattern in [
 ('native-prefix','const nativeLimit = recency ? undefined : limit;','const nativeLimit = undefined;','returns only the adjacent'),
 ('late-fetch','select(open, close, wantHits, selected)','select(open, close, wantHits)','limits complete entities'),
 ('recency-guard','const nativeLimit = recency ? undefined : limit;','const nativeLimit = limit;','global prefix across types')]:
 try:
  assert old in original
  p.write_text(original.replace(old,new,1))
  check('negative-'+label,['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-limits.spec.ts','-t',pattern],env=backend,negative=True)
 finally:p.write_text(original)
p=r/'packages/apack-ears/src/sqlite/query.ts';original=p.read_text()
try:
 old="if (next?.step === 'limit') textLimit = Math.max(0, Math.floor(next.n));"
 new="const later = steps.slice(stepIndex + 1).find(step => step.step === 'limit'); if (later?.step === 'limit') textLimit = Math.max(0, Math.floor(later.n));"
 assert old in original;p.write_text(original.replace(old,new,1))
 check('negative-pipeline-scope',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-limits.spec.ts','-t','original pipeline scope'],env=backend,negative=True)
finally:p.write_text(original)
try:
 old='const row = db.row(id, terminal.fields)!;';assert old in original
 p.write_text(original.replace(old,'const row = db.row(id)!;',1))
 check('negative-hit-projection',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-limits.spec.ts','-t','projects requested hit fields'],env=backend,negative=True)
finally:p.write_text(original)
check('sqlite-suite',['npm','test','-w','@apackdev/ears'],env=backend,timeout=180)
check('native-suite',['npm','test','-w','@apackdev/ears'],env={'EARS_EVALUATION_BACKEND':'elmdb'},timeout=180)
