from pathlib import Path
import subprocess,tarfile,json,hashlib,os,time
r=Path('/metrics');o=Path('/results');old=json.loads((o/'final-inputs.json').read_text())
for name,sha in old.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
(o/'qualified-inputs.json').write_text(json.dumps(old,indent=2)+'\n')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
assert [name for name in inputs if inputs[name]!=old[name]]==['packages/apack-ears/tests/sqlite/vector-models.spec.ts']
(o/'final-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json'];env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/seed/patched/vec1.so'};rows=[]
def run(name,args,negative=False):
 at=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'owner-boundary-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-10000:]
file=r/'packages/apack-ears/src/sqlite/vector-policy.ts';fixed=file.read_bytes()
try:
 s=fixed.decode();needle='NATIVE_VECTOR_OWNER_TARGET = 256';assert needle in s;file.write_text(s.replace(needle,'NATIVE_VECTOR_OWNER_TARGET = 2'))
 run('reject-low-owner-floor',[*base,'-t','requires enough live distinct owners','--outputFile=/results/low-owner-floor.json'],negative=True)
 assert json.loads((o/'low-owner-floor.json').read_text())['numFailedTests']==1
finally:file.write_bytes(fixed)
run('final-model-boundaries',[*base,'--outputFile=/results/final-model-boundaries.json'])
d=json.loads((o/'final-model-boundaries.json').read_text());assert d['numPassedTests']==14 and d['numFailedTests']==0 and d['numPendingTests']==0
run('final-boundary-types',['npm','run','typecheck','-w','@apackdev/ears'])
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
