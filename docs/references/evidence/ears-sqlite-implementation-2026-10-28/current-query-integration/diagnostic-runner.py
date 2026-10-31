from pathlib import Path
import tarfile,subprocess,os,time,json,hashlib
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for n,sha in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==sha
(o/'diagnostic-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
rows=[]
def run(name,args,timeout=180,extra=None,allowFailure=False):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'diagnostic-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 if not allowFailure:assert p.returncode==0,(o/(name+'.log')).read_text()[-10000:]
assert Path('/usr/local/include/node/common.gypi').exists()
run('build-node-pty-prepared-headers',['npm','rebuild','node-pty','--offline'],timeout=240,extra={'npm_config_nodedir':'/usr/local'})
for backend in ['sqlite','elmdb']:
 report='/results/query-'+backend+'-prepared.json'
 run('query-'+backend,['npm','test','-w','@app/default-setup','--','tests/features/threads/be/query-work.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile='+report],extra={'EARS_EVALUATION_BACKEND':backend},timeout=240)
 result=json.loads(Path(report).read_text())
 assert result['numPassedTests']==5 and result['numFailedTests']==0 and result['numPendingTests']==0,result
run('reporter-contracts',['node','node_modules/vitest/vitest.mjs','run','--config','vitest.integration.config.ts','--project','@app/repo-checks','packages/repo-checks/tests/spec-durations-reporter.integration.spec.ts','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=/results/reporter-contracts.json'])
run('scripts-types',['node','node_modules/typescript/bin/tsc','-p','scripts'],timeout=240)
run('repo-check-types',['node','node_modules/typescript/bin/tsc','-p','packages/repo-checks'],timeout=240)
run('specifiers',['npm','run','check:specifiers'])
run('host-progress',['npm','run','test:unit:host','--','--all'],timeout=660,extra={'APACK_DIAGNOSTIC_RUN':'1','APACK_CHAIN_CORES':'2','SPEC_DURATIONS_PROGRESS_FILE':'/results/host-progress'},allowFailure=True)
