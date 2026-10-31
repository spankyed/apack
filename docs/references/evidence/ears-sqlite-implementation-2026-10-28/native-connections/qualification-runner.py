from pathlib import Path
import subprocess,tarfile,json,hashlib,os,time
r=Path('/metrics');o=Path('/results')
prior=json.loads(Path('/prior-inputs.json').read_text())
for name,sha in prior.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')};assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
ext=Path('/seed/patched/vec1.so');assert hashlib.sha256(ext.read_bytes()).hexdigest()=='360c068120fbd25bb947d08ab2908d8981122da84ace8aeba218cd15c90b403d'
(o/'source.json').write_text(json.dumps({'integrationBase':'6509f4ed39e3bc23b00aaa05a2470007dd278674','priorInputs':prior,'overlay':inputs,'limits':limits,'extensionSha256':hashlib.sha256(ext.read_bytes()).hexdigest(),'nativeBinding':'read-only old 4d558a2 plus tested own-unit patch; not qualification of new 006d6ce elmdb pin','scope':'SQLite EARS source tests only; exact full integration/platform remains pending'},indent=2)+'\n')
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(ext)};rows=[]
def run(name,args,negative=False):
 at=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=240)
 rows.append({'name':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-10000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json']
run('models',[*base,'packages/apack-ears/tests/sqlite/vector-models.spec.ts','--outputFile=/results/models.json'])
mutations=[
 ('missing-connection-load','packages/apack-ears/src/sqlite/database.ts','      if (options.nativeVectorExtension !== undefined) this.loadNativeVectors(options.nativeVectorExtension);','','loads trusted native candidates on independent'),
 ('missing-audit-loader','packages/apack-ears/src/sqlite/audit.ts',', nativeVectorExtension: source.nativeVectorExtension','','retains the trusted connection loader')]
for label,name,before,after,pattern in mutations:
 f=r/name;fixed=f.read_bytes();s=fixed.decode();assert before in s
 try:
  f.write_text(s.replace(before,after))
  run('reject-'+label,[*base,'packages/apack-ears/tests/sqlite/vector-models.spec.ts','-t',pattern,'--outputFile=/results/'+label+'.json'],True)
  d=json.loads((o/(label+'.json')).read_text());assert d['numFailedTests']==1
 finally:f.write_bytes(fixed)
run('all-ears',[*base,'--outputFile=/results/all-ears.json'])
d=json.loads((o/'all-ears.json').read_text());assert d['numPassedTests']==637 and d['numFailedTests']==0 and d['numPendingTests']==0
run('types',['npm','run','typecheck','-w','@apackdev/ears'])
run('boundaries',['npm','run','check:specifiers'])
run('api-update',['npm','run','api:update','-w','@apackdev/ears'])
import shutil
shutil.copyfile(r/'packages/apack-ears/etc/sqlite.api.md',o/'sqlite.api.md')
run('package-build',['npm','run','packages:build'])
run('lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in inputs if n.endswith('.ts')],'-D','correctness'])

for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
