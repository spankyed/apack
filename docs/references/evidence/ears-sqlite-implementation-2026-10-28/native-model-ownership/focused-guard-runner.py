from pathlib import Path
import subprocess,tarfile,hashlib,json,os,time
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
m=json.loads(Path('/inputs.json').read_text())
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h
args=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-owner.spec.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=/results/guard.json']
at=time.monotonic()
with (o/'guard.log').open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite'},stdout=f,stderr=subprocess.STDOUT,timeout=60)
(o/'guard-source.json').write_text(json.dumps({'inputs':m,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at,'limits':{n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')},'scope':'Focused advisory-lock contracts only, no compiler or full validation'},indent=2)+'\n');assert p.returncode==0,(o/'guard.log').read_text()[-6000:]
d=json.loads((o/'guard.json').read_text());assert d['numPassedTests']==3 and d['numFailedTests']==0 and d['numPendingTests']==0
print('Three real descriptor/process/termination ownership cases pass.',flush=True)
