from pathlib import Path
import subprocess,os,json,time,shutil,tarfile
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'};rows=[]
def run(label,args,cwd=r):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'integrated-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-8000:]
run('ear-package',['npm','run','build:package','-w','@apackdev/ears'])
run('source-stage',['git','add','-A']);run('source-snapshot',['git','-c','user.name=Physical model qualification','-c','user.email=qualification@localhost','commit','--allow-empty','-qm','Current pinned integration with physical model refresh overlay'])
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=2','--reporter=default','--reporter=json']
run('all-ears',[*base,'--project','@apackdev/ears','--outputFile=/results/all-ears.json'])
d=json.loads((o/'all-ears.json').read_text());assert d['numPassedTests']==657 and d['numFailedTests']==0 and d['numPendingTests']==0
run('host',[*base,'--project','@apackdev/host','packages/apack-host/tests/database/storage.spec.ts','packages/apack-host/tests/database/close.spec.ts','--outputFile=/results/host.json'])
run('api',[*base,'--project','@app/api','packages/api/tests/runtime/sqlite-profile.spec.ts','packages/api/tests/transport/shutdown.spec.ts','--outputFile=/results/api.json'])
run('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
run('host-types',['npm','run','typecheck:host'])
run('api-types',['npm','run','typecheck:api'])
run('api-update',['npm','run','api:update','-w','@apackdev/ears'])
run('api-check',['npm','run','api:check','-w','@apackdev/ears'])
shutil.copytree(r/'packages/apack-ears/etc',o/'api-reports',dirs_exist_ok=True)
run('boundaries',['npm','run','check:specifiers'])
files=['packages/apack-ears/src/sqlite/'+n+'.ts' for n in ['database','index-builds','index','vector-candidates','vector-index','vector-models']]+['packages/apack-ears/tests/sqlite/vector-'+n+'.spec.ts' for n in ['index','models']]
run('lint',['node','node_modules/oxlint/bin/oxlint',*files,'-D','correctness'])
