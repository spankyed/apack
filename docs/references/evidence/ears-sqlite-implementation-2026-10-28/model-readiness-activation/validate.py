from pathlib import Path
import subprocess,os,json,time
r=Path('/metrics');o=Path('/results');env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so','CARGO_HOME':'/metrics/.temp/ears-cargo','CARGO_TARGET_DIR':'/metrics/.temp/ears-native-target','CARGO_BUILD_JOBS':'2','RUSTUP_TOOLCHAIN':'1.99.1'}
rows=[]
def run(label,args,cwd=r):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'integrated-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-6000:]
run('native-binding',['cargo','build','--locked','--release','-p','elmdb-node'],r/'vendor/elmdb')
import shutil
shutil.copyfile(r/'.temp/ears-native-target/release/libelmdb_node.so',r/'vendor/elmdb/crates/elmdb-node/elmdb.linux-arm64-gnu.node')
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=2','--reporter=default','--reporter=json']
run('all-ears',[*base,'--project','@apackdev/ears','--outputFile=/results/all-ears.json'])
run('host-startup',[*base,'--project','@apackdev/host','packages/apack-host/tests/database/storage.spec.ts','packages/apack-host/tests/database/close.spec.ts','--outputFile=/results/host-startup.json'])
run('api-startup',[*base,'--project','@app/api','packages/api/tests/runtime/sqlite-profile.spec.ts','packages/api/tests/transport/shutdown.spec.ts','--outputFile=/results/api-startup.json'])
run('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
run('host-types',['npm','run','typecheck:host'])
run('api-types',['npm','run','typecheck:api'])
run('api-reports',['npm','run','api:update','-w','@apackdev/ears'])
run('api-report-check',['npm','run','api:check','-w','@apackdev/ears'])
shutil.copytree(r/'packages/apack-ears/etc',o/'api-reports',dirs_exist_ok=True)
