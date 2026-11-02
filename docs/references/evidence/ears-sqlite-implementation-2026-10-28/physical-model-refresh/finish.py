from pathlib import Path
import subprocess,os,json,time,shutil,tarfile
r=Path('/metrics');o=Path('/results')
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'};rows=[]
def run(label,args,cwd=r):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'finish-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-8000:]
run('packages-current',['npm','run','packages:build'])
run('api-update',['npm','run','api:update','-w','@apackdev/ears'])
run('api-check',['npm','run','api:check','-w','@apackdev/ears'])
shutil.copytree(r/'packages/apack-ears/etc',o/'api-reports',dirs_exist_ok=True)
run('boundaries',['npm','run','check:specifiers'])
files=['packages/apack-ears/src/sqlite/'+n+'.ts' for n in ['database','index-builds','index','vector-candidates','vector-index','vector-models']]+['packages/apack-ears/tests/sqlite/vector-'+n+'.spec.ts' for n in ['index','models']]
run('lint',['node','node_modules/oxlint/bin/oxlint',*files,'-D','correctness'])
