import pathlib,subprocess,json,hashlib,time
r=pathlib.Path('/metrics');o=pathlib.Path('/results')
files=[r/'packages/apack-cli/src/commands/db/target.ts',r/'packages/apack-cli/tests/commands/sqlite-profile.spec.ts',r/'packages/apack-host/src/database/storage.ts']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
def run(name,args,expected=0):
 p=subprocess.run(args,cwd=r,capture_output=True,text=True,timeout=120);v=p.stdout+p.stderr
 (o/(name+'.txt')).write_text(v);print(name,p.returncode,flush=True)
 assert (p.returncode==0 if expected==0 else p.returncode!=0),v[-12000:]
 return v
# The implementation was fully built on 8b007da448. Only a parser guard and its test changed afterwards.
run('cli-profiles',['npm','test','-w','@apackdev/cli','--','tests/commands/sqlite-profile.spec.ts'])
p=files[0];original=p.read_text();guard='  configuredDatabaseFormat(context.userDataDir);';assert guard in original
try:
 p.write_text(original.replace(guard,''))
 v=run('negative-early-isolation',['npm','test','-w','@apackdev/cli','--','tests/commands/sqlite-profile.spec.ts','-t','during argument parsing'],expected=1)
 assert "didn't" in v or 'did not throw' in v or 'to throw' in v,v[-12000:]
finally:p.write_text(original)
run('restored',['npm','test','-w','@apackdev/cli','--','tests/commands/sqlite-profile.spec.ts'])
run('types',['npm','run','typecheck','-w','@apackdev/cli'])
