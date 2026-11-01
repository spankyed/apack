from pathlib import Path
import subprocess,os,json,time,shutil
r=Path('/metrics');o=Path('/results');env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'};rows=[]
def run(label,args):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'finish-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-7000:]
run('git-init',['git','init','-q'])
run('git-stage',['git','add','-A'])
run('git-snapshot',['git','-c','user.name=SQLite qualification','-c','user.email=qualification@localhost','commit','-qm','Pinned integration plus readiness activation overlay'])
run('api-startup-typed',['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@app/api','packages/api/tests/runtime/sqlite-profile.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/api-startup-typed.json'])
run('api-types-fixed',['npm','run','typecheck:api'])
run('api-reports',['npm','run','api:update','-w','@apackdev/ears'])
run('api-report-check',['npm','run','api:check','-w','@apackdev/ears'])
shutil.copytree(r/'packages/apack-ears/etc',o/'api-reports',dirs_exist_ok=True)
run('boundaries',['npm','run','check:specifiers'])
files=subprocess.check_output(['git','diff','--name-only'],cwd=r,text=True).splitlines()
changed=['packages/apack-ears/src/database.ts','packages/apack-ears/src/sqlite/database.ts','packages/apack-ears/src/sqlite/index-builds.ts','packages/apack-ears/src/sqlite/index.ts','packages/apack-ears/tests/sqlite/vector-models.spec.ts','packages/apack-host/src/database/index.ts','packages/apack-host/src/database/storage.ts','packages/apack-host/tests/database/storage.spec.ts','packages/api/src/runtime/index.ts','packages/api/tests/runtime/sqlite-profile.spec.ts']
run('changed-lint',['node','node_modules/oxlint/bin/oxlint',*changed,'-D','correctness'])
run('platform-syntax',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])
