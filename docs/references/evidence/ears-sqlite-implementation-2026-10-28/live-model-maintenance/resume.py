from pathlib import Path
import subprocess,os,json,time,hashlib,shutil
r=Path("/metrics");o=Path("/results");m=json.loads(Path("/inputs.json").read_text())
env=os.environ|{'npm_config_nodedir':'/usr/local','EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'};rows=json.loads((o/'integrated-results.json').read_text())
def run(label,args,timeout=600):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'integrated-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-9000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=2','--reporter=default','--reporter=json']
run('all-api',[*base,'--project','@app/api','--outputFile=/results/all-api.json'])
run('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
run('host-types',['npm','run','typecheck:host'])
run('api-types',['npm','run','typecheck:api'])
run('api-update',['npm','run','api:update','-w','@apackdev/ears'])
run('api-check',['npm','run','api:check','-w','@apackdev/ears'])
shutil.copytree(r/'packages/apack-ears/etc',o/'api-reports',dirs_exist_ok=True)
run('boundaries',['npm','run','check:specifiers'])
run('changed-lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in m if n.endswith('.ts')],'-D','correctness'])
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
