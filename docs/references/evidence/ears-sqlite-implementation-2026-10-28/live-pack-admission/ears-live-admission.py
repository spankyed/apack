import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in pathlib.Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
p=r/'vendor/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine')
p=r/'node_modules/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine/crates/elmdb-node')
os.chdir(r)
results=[]
def run(label,args,limit):
 start=time.monotonic()
 with (o/(label+'.txt')).open('w') as f:
  try:
   p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
   v={'label':label,'exitCode':p.returncode,'seconds':time.monotonic()-start}
  except subprocess.TimeoutExpired:v={'label':label,'timeoutSeconds':limit,'seconds':time.monotonic()-start}
 results.append(v);(o/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(v),flush=True)
run('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'

def checked(name,args,negative=False,env=None,timeout=180):
 start=time.monotonic()
 try:p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 except subprocess.TimeoutExpired as e:
  (o/(name+'.txt')).write_bytes(e.stdout or b'');raise
 (o/(name+'.txt')).write_text(p.stdout);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),p.stdout[-18000:]
 return p.stdout
for name,args in [
 ('host-types',['npm','run','typecheck','-w','@apackdev/host']),
 ('api-types',['node','node_modules/typescript/bin/tsc','--noEmit','-p','packages/api/tsconfig.json']),
 ('lifecycle',['npm','test','-w','@apackdev/host','--','tests/packs/runtime/lifecycle.spec.ts','tests/packs/runtime/reload.spec.ts','tests/features/packs/be/system.spec.ts','tests/migrations/native-migrations.spec.ts','tests/services/host-runtime.spec.ts']),
 ('api-profile',['npm','test','-w','@app/api','--','tests/runtime/sqlite-profile.spec.ts']),
]:checked(name,args)
p=r/'packages/apack-host/src/packs/runtime/lifecycle.ts';original=p.read_text();assert '    await registry.indexesReady();' in original
try:
 p.write_text(original.replace('    await registry.indexesReady();',''))
 checked('negative-start-order',['npm','test','-w','@apackdev/host','--','tests/packs/runtime/lifecycle.spec.ts','-t','awaits index admission'],negative=True)
finally:p.write_text(original)
p=r/'packages/api/src/runtime/index.ts';original=p.read_text();assert 'indexesReady: () => database.indexesReady()' in original
try:
 p.write_text(original.replace('indexesReady: () => database.indexesReady()','indexesReady: () => Promise.resolve()'))
 checked('negative-root-wiring',['npm','test','-w','@app/api','--','tests/runtime/sqlite-profile.spec.ts','-t','real populated search admission'],negative=True)
finally:p.write_text(original)
p=r/'packages/apack-host/src/features/packs/be/system.ts';original=p.read_text();assert 'finally { activated = await startAccepted!(); }' in original
try:
 p.write_text(original.replace('finally { activated = await startAccepted!(); }','finally { activated = startAccepted!() as unknown as boolean; }'))
 checked('negative-install-claim',['npm','test','-w','@apackdev/host','--','tests/features/packs/be/system.spec.ts','-t','holds the install claim'],negative=True)
finally:p.write_text(original)
checked('restored-lifecycle',['npm','test','-w','@apackdev/host','--','tests/packs/runtime/lifecycle.spec.ts','tests/packs/runtime/reload.spec.ts','tests/features/packs/be/system.spec.ts'])
checked('lint',['npm','run','lint:check'])
checked('specifiers',['npm','run','check:specifiers'])
