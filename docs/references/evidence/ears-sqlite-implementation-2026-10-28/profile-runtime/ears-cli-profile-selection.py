import pathlib,subprocess,time,json,hashlib
r=pathlib.Path('/metrics');o=pathlib.Path('/results')
files=list((r/'packages/apack-host/src/database').glob('*.ts'))+list((r/'packages/apack-cli/src/commands/db').glob('*.ts'))+[r/'packages/api/src/runtime/index.ts',r/'packages/apack-cli/tests/commands/sqlite-profile.spec.ts']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
def run(name,args,required=True):
 start=time.monotonic();p=subprocess.run(args,cwd=r,capture_output=True,text=True,timeout=180)
 (o/(name+'.txt')).write_text(p.stdout+p.stderr);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 if required:assert p.returncode==0,(p.stdout+p.stderr)[-14000:]
run('packages-build',['npm','run','packages:build'])
run('host-types',['npm','run','typecheck','-w','@apackdev/host'])
run('api-types',['node','node_modules/typescript/bin/tsc','--noEmit','-p','packages/api/tsconfig.json'])
run('cli-types',['npm','run','typecheck','-w','@apackdev/cli'])
run('cli-profiles',['npm','test','-w','@apackdev/cli','--','tests/commands/sqlite-profile.spec.ts'])
run('host-profiles',['npm','test','-w','@apackdev/host','--','tests/database/storage.spec.ts','tests/backup/storage.spec.ts'])
run('api-profiles',['npm','test','-w','@app/api','--','tests/runtime/sqlite-profile.spec.ts','tests/runtime/restart-persistence.spec.ts'])
run('lint',['npm','run','lint:check'])
run('specifiers',['npm','run','check:specifiers'])
