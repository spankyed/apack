from pathlib import Path
import subprocess,tarfile,hashlib,json,os,time
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for f,sha in inputs.items():assert hashlib.sha256((r/f).read_bytes()).hexdigest()==sha
(o/'slice-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
with tarfile.open('/source.tar') as t:
 tracked=[m.name for m in t if m.isfile() or m.issym()]
(o/'tracked-paths').write_bytes(b'\0'.join(x.encode() for x in tracked)+b'\0')
subprocess.run(['git','init','-q'],cwd=r,check=True)
subprocess.run(['git','add','-f','--pathspec-from-file=/results/tracked-paths','--pathspec-file-nul'],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Projection qualification','-c','user.email=qualification@localhost','commit','-qm','Exact archived source plus recorded projection overlay'],cwd=r,check=True)
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/patched/vec1.so','EARS_TEST_SOURCE':'2d0a0e7d4885b47c3d330870e75ff74666f81fdd'}
rows=[]
def run(name,args,timeout=180,negative=False,extra=None):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'slice-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-10000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json']
index=r/'packages/apack-ears/src/sqlite/vector-index.ts';fixed=index.read_bytes()
try:
 index.write_bytes(Path('/before.ts').read_bytes())
 run('reject-unsliced-page',[*base,'packages/apack-ears/tests/sqlite/vector-index.spec.ts','-t','stops inside a partial page','--outputFile=/results/unsliced-control.json'],negative=True)
 negative=json.loads((o/'unsliced-control.json').read_text());assert negative['numFailedTests']==1
 assert 'expected true to be false' in (o/'reject-unsliced-page.log').read_text()
finally:index.write_bytes(fixed)
run('all-ears-sliced',[*base,'--outputFile=/results/all-ears-sliced.json'],timeout=240)
positive=json.loads((o/'all-ears-sliced.json').read_text());assert positive['numPassedTests']==626 and positive['numFailedTests']==0 and positive['numPendingTests']==0
run('ears-slice-types',['npm','run','typecheck','-w','@apackdev/ears'],timeout=180)
run('slice-lint',['node','node_modules/oxlint/bin/oxlint','packages/apack-ears/src/sqlite/vector-index.ts','packages/apack-ears/src/sqlite/vector-models.ts','packages/apack-ears/tests/sqlite/vector-index.spec.ts','-D','correctness'])
# Use the identical diagnostic harness, FULL policy and starting checkpoint, changing only the recorded source overlay.
probe=r/'packages/apack-ears/bench/sqlite/checkpoint-admission-probe.mjs'
assert hashlib.sha256(probe.read_bytes()).hexdigest()==json.loads((o/'source.json').read_text())['probeSha256']
for size in [1000,99900]:
 name='sliced-auto-'+str(size)
 run(name,['node','--import','tsx',str(probe),'/corpus','/truth/truth.json',str(size),'/results/'+name+'.json','native-diagnose'],timeout=480,extra={'EARS_CHECKPOINT_PROBE':'auto'})
 report=json.loads((o/(name+'.json')).read_text());assert report['completed'] and report['synchronous']==2 and report['checkpointProbe']['admissionAutoThreshold']==1000 and report['modelAdmission']['state']['state']=='ready' and report['checkpointProbe']['finalCanonicalRowsVerified']==size
