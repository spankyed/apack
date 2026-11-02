from pathlib import Path
import subprocess,json,hashlib,os
r=Path('/electron');o=Path('/results');checks=[];env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite'}
subprocess.run(['tar','--no-same-owner','-xf','/overlay.tar','-C',str(r)],check=True)
inputs=json.loads(Path('/inputs.json').read_text())
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n

def run(label,args,timeout=300):
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 checks.append({'label':label,'args':args,'exitCode':p.returncode});print(label,p.returncode,flush=True)
 (o/'final-checks.json').write_text(json.dumps({'base':'098d479157aaf9c7cfa363f01a8a8a371c1473d5','inputs':inputs,'checks':checks},indent=2)+'\n')
 assert p.returncode==0,(o/(label+'.log')).read_text()[-5500:]
base=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json']
run('focused-final2',base+['tests/backup/recovery.spec.ts','tests/database/storage.spec.ts','tests/services/run-history.spec.ts','tests/backup/storage.spec.ts','--outputFile=/results/focused-final2.json'])
run('host-types',['node','node_modules/typescript/bin/tsc','-p','packages/apack-host','--noEmit'])
run('ears-types',['node','node_modules/typescript/bin/tsc','-p','packages/apack-ears','--noEmit'])
run('coverage-routing',['node','node_modules/vitest/vitest.mjs','run','--root','packages/repo-checks','tests/chain-inputs.spec.ts','tests/repro.spec.ts','--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/coverage-routing.json'])
run('lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in inputs if n.endswith(('.ts','.mjs'))],'-D','correctness'])
run('ears-final',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/ears-final.json'])
run('host-final',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/host-final.json'],600)
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
