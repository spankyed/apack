from pathlib import Path
import subprocess,tarfile,json,hashlib,os,time
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for n,sha in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==sha
(o/'chain-fix-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
rows=[]
def run(name,args,timeout=180):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'chain-fix-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-10000:]
run('prepare-ui-api-types',['npm','run','api:build','-w','@apackdev/ui'],timeout=240)
run('chain-input-contracts',['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@app/repo-checks','packages/repo-checks/tests/chain-inputs.spec.ts','packages/repo-checks/tests/chain-graph.spec.ts','packages/repo-checks/tests/unused-code-gate.spec.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=/results/chain-contracts.json'])
run('changed-source-lint',['node','node_modules/oxlint/bin/oxlint','native/vectors','scripts/lib/chain-steps.ts','scripts/lib/spec-durations-reporter.ts','packages/repo-checks/tests/spec-durations-reporter.integration.spec.ts','-D','correctness'])
run('chain-scripts-types',['node','node_modules/typescript/bin/tsc','-p','scripts'],timeout=240)
