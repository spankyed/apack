from pathlib import Path
import subprocess,tarfile,hashlib,json,os,time
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
m=json.loads(Path('/inputs.json').read_text())
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h
args=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','-t','excludes independent connections|enforces one owner and drains workers','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=/results/lifetime.json']
at=time.monotonic()
with (o/'lifetime.log').open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'},stdout=f,stderr=subprocess.STDOUT,timeout=60)
(o/'lifetime-source.json').write_text(json.dumps({'inputs':m,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at,'limits':{n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')},'scope':'Focused advisory-lock contracts only, no compiler or full validation'},indent=2)+'\n');assert p.returncode==0,(o/'lifetime.log').read_text()[-6000:]
d=json.loads((o/'lifetime.json').read_text());assert d['numPassedTests']==2 and d['numFailedTests']==0 
print('Both real worker lifetime cases pass.',flush=True)
with (o/'owner-types.log').open('w') as f:p=subprocess.run(['npm','run','typecheck','-w','@apackdev/ears'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=120)
assert p.returncode==0,(o/'owner-types.log').read_text()[-6000:]
print('EARS typecheck passes.',flush=True)
