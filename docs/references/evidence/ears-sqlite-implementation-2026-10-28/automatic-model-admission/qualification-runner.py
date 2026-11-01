from pathlib import Path
import subprocess,tarfile,hashlib,json,os,time
r=Path('/metrics');o=Path('/results');previous=json.loads((o/'revision4/final-inputs.json').read_text())
for name,sha in previous.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
(o/'final-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
subprocess.run(['git','add','-f',*inputs.keys()],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Admission qualification','-c','user.email=qualification@localhost','commit','-qm','Generation-specific committed admission dependencies'],cwd=r,check=True)
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json'];file='packages/apack-ears/tests/sqlite/vector-models.spec.ts'
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/seed/patched/vec1.so'};rows=[]
def run(name,args,timeout=180,negative=False):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'qualified-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-12000:]
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
