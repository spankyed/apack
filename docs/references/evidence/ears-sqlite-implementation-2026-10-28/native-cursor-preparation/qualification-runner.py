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
(o/'source.json').write_text(json.dumps({'integrationBase':'edf17cd0dc','priorInputs':prior,'overlay':inputs,'limits':limits,'extensionSha256':hashlib.sha256(ext.read_bytes()).hexdigest(),'nativeBinding':'read-only old 4d558a2 plus tested own-unit patch; not qualification of new 006d6ce elmdb pin','scope':'SQLite EARS source tests only; exact full integration/platform remains pending'},indent=2)+'\n')
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(ext)};rows=[]
def run(name,args,negative=False):
 at=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=240)
 rows.append({'name':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-10000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json']
f=r/'packages/apack-ears/src/sqlite/search.ts';fixed=f.read_bytes()
try:
 s=fixed.decode();needle='    prepareEmptyNativeVectorCursor(this.db);';assert s.count(needle)==1;f.write_text(s.replace(needle,''))
 run('reject-missing-empty-preparation',[*base,'packages/apack-ears/tests/sqlite/vector-index.spec.ts','-t','prepares ordinary empty stores','--outputFile=/results/rejected.json'],True)
 d=json.loads((o/'rejected.json').read_text());assert d['numFailedTests']==1
finally:f.write_bytes(fixed)
run('all-ears',[*base,'--outputFile=/results/all-ears.json'])
d=json.loads((o/'all-ears.json').read_text());assert d['numPassedTests']==635 and d['numFailedTests']==0 and d['numPendingTests']==0
run('types',['npm','run','typecheck','-w','@apackdev/ears'])
run('lint',['node','node_modules/oxlint/bin/oxlint','packages/apack-ears/src/sqlite/vector-cursor.ts','packages/apack-ears/src/sqlite/search.ts','packages/apack-ears/src/sqlite/vector-index.ts','packages/apack-ears/tests/sqlite/vector-index.spec.ts','-D','correctness'])
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
