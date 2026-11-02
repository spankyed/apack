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
assert results[-1].get('exitCode')==0, 'dependency setup failed'
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
check('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('focused-typos',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-typos.spec.ts','tests/engine/search-relevance.spec.ts','tests/engine/search.spec.ts','tests/sqlite/text-documents.spec.ts','tests/sqlite/search-recovery.spec.ts'],env=backend)
check('api-reports',['npm','run','api:check'])
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
check('sqlite-suite',['npm','test','-w','@apackdev/ears'],env=backend,timeout=180)
check('native-suite',['npm','test','-w','@apackdev/ears'],env={'EARS_EVALUATION_BACKEND':'elmdb'},timeout=180)
p=r/'packages/apack-ears/src/sqlite/text.ts';fixed=p.read_text()
try:
 needle='? this.presentAlternatives(job, normalized) : []';assert fixed.count(needle)==1
 p.write_text(fixed.replace(needle,'? [] : []'))
 check('negative-removed-alternatives',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-typos.spec.ts','-t','one edit'],env=backend,negative=True)
 p.write_bytes(pathlib.Path('/before-text.ts').read_bytes())
 check('negative-vocabulary-scan',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-typos.spec.ts','-t','independent of unrelated vocabulary'],env=backend,negative=True)
 assert 'Vocabulary enumeration must not reach JavaScript' in (o/'negative-vocabulary-scan.txt').read_text()

 p.write_text(fixed.replace('? this.presentAlternatives(job, normalized) : []','? typoAlternatives(normalized) : []'))
 check('negative-unpruned-match',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-typos.spec.ts','-t','independent of unrelated vocabulary'],env=backend,negative=True)
 p.write_text(fixed)
 test=r/'packages/apack-ears/tests/sqlite/text-typos.spec.ts';original_test=test.read_text()
 try:
  marker="other.transact(() => { other.write('Row-a').set('name', 'other'); other.create('Row', { id: 'Row-b', name: 'database' }); });"
  assert original_test.count(marker)==1
  test.write_text(original_test.replace(marker,marker+'\n        db.sql.exec("COMMIT; BEGIN");'))
  check('negative-lost-snapshot',['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-typos.spec.ts','-t','one snapshot across another handle'],env=backend,negative=True)
  assert "Row-b" in (o/'negative-lost-snapshot.txt').read_text()
 finally:test.write_text(original_test)

finally:p.write_text(fixed)
assert p.read_text()==fixed
