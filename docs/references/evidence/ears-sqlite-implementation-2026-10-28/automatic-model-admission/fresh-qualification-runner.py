from pathlib import Path
import subprocess,tarfile,shutil,json,hashlib,os,time
r=Path('/metrics');o=Path('/results');r.mkdir(exist_ok=True);assert not any(r.iterdir())
with tarfile.open('/source.tar') as t:source=t.pax_headers['comment'];assert source=='844e0f6184978565b126b2cccf08ad082c291350';t.extractall(r)
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
subprocess.run(['git','init','-q'],cwd=r,check=True);subprocess.run(['git','add','-f','.'],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Admission qualification','-c','user.email=qualification@localhost','commit','-qm','Exact source archive plus recorded automatic admission overlay'],cwd=r,check=True)
assert (r/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
(r/'vendor/elmdb').symlink_to('/engine')
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')};assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
assert hashlib.sha256(Path('/upstream.c').read_bytes()).hexdigest()=='b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1'
with (o/'fresh-native-build.log').open('w') as f:subprocess.run(['node','native/vectors/build.mjs','/metrics/patched','/upstream.c'],cwd=r,stdout=f,stderr=subprocess.STDOUT,check=True)
ext=r/'patched/vec1.so'
provenance=json.loads((r/'patched/provenance.json').read_text());assert provenance['sourceSha256']=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
(o/'native-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
(o/'source.json').write_text(json.dumps({'base':source,'overlay':inputs,'limits':limits,'extensionSha256':hashlib.sha256(ext.read_bytes()).hexdigest(),'metadata':'synthetic Git metadata for source classification; private copied dependencies, no shared writable outputs'},indent=2)+'\n')
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(ext)};rows=[]
def run(name,args,timeout=180,negative=False):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-12000:]
(o/'final-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json'];file='packages/apack-ears/tests/sqlite/vector-models.spec.ts'
run('qualified-types',['npm','run','typecheck','-w','@apackdev/ears'])
mutations=[
 ('disabled-admission','packages/apack-ears/src/sqlite/vector-admission.ts','    return this.scan !== undefined || this.dirty.size > 0;','    return false;','automatically admits an eligible committed generation'),
 ('missing-import-invalidation','packages/apack-ears/src/sqlite/database.ts','      this.indexBuilds.committed(unit.changes);','','admits canonical embeddings imported after'),
 ('reset-active-scan','packages/apack-ears/src/sqlite/vector-admission.ts','    for (const key of changes) this.mark(this.dependencies.get(key));','    for (const key of changes) this.mark(this.dependencies.get(key)); this.scan = undefined;','bounds eligibility to metadata pages'),
 ('retry-failed-logical','packages/apack-ears/src/sqlite/vector-admission.ts'," || row.state === 'failed'",'','does not enqueue or keep polling a failed logical generation')]
for label,name,before,after,pattern in mutations:
 path=r/name;fixed=path.read_bytes();s=fixed.decode();assert s.count(before)==1
 try:
  path.write_text(s.replace(before,after));run('reject-'+label,[*base,file,'-t',pattern,'--outputFile=/results/'+label+'.json'],negative=True)
  d=json.loads((o/(label+'.json')).read_text());assert d['numFailedTests']==1
 finally:path.write_bytes(fixed)
run('all-ears-qualified',[*base,'--outputFile=/results/all-ears-qualified.json'],timeout=240)
d=json.loads((o/'all-ears-qualified.json').read_text());assert d['numPassedTests']==633 and d['numFailedTests']==0 and d['numPendingTests']==0
run('qualified-lint',['node','node_modules/oxlint/bin/oxlint',*inputs.keys(),'-D','correctness'])
run('qualified-boundaries',['npm','run','check:specifiers'])
run('qualified-package-build',['npm','run','packages:build'],timeout=240)
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
