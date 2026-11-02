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
probe=r/'permission-denial-probe';probe.mkdir();(probe/'file').write_text('probe');probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Container privileges bypass mode denial; cannot qualify permission tests')
finally:probe.chmod(0o700);shutil.rmtree(probe)
(o/'permission-preflight.json').write_text(json.dumps({'uid':os.getuid(),'modeDenial':True,'capEff':next(line.strip() for line in pathlib.Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:'))},indent=2)+'\n')

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

import pathlib,subprocess,json,os,tempfile,socket,time,hashlib,signal
r=pathlib.Path('/metrics');o=pathlib.Path('/results/built-runtime');o.mkdir()
files=list((r/'packages/apack-host/src/database').glob('*.ts'))+[r/'packages/api/src/runtime/index.ts',r/'packages/api/src/server.ts',r/'packages/default-setup/apack.json',r/'package.json']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
def run(name,args,env=None,timeout=300):
 start=time.monotonic();p=subprocess.run(args,cwd=r,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=timeout)
 (o/(name+'.txt')).write_text(p.stdout);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert p.returncode==0,p.stdout[-16000:]
 return p
run('shipped-pack-build',['npm','run','build:default-setup'],timeout=420)
for backend in ['elmdb/1','sqlite/1']:
 run('reset-parity-'+backend.split('/')[0],['npm','test','-w','@app/api','--','tests/runtime/app-reset.spec.ts','tests/runtime/app-database-parity.spec.ts'],os.environ|{'APACK_STORAGE_FORMAT':backend},timeout=180)
run('api-build',['npm','run','build','-w','@app/api'])
run('source-node',['npm','test','-w','@apackdev/ears','--','tests/sqlite/source-node.spec.ts'])
run('api-bundle',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'])
profile=tempfile.mkdtemp(prefix='ears-built-api-sqlite-')
env=os.environ|{'APACK_ENV':'test','APACK_USER_DATA_DIR':profile,'APACK_STORAGE_FORMAT':'sqlite/1','APACK_API_TOKEN':'synthetic-sqlite-probe-token','SHIPPED_PACKS_DIR':str(r/'packages')}
seed=r/'sqlite-boot-seed.mjs'
seed.write_text('''import {openDatabaseStore,readInstalledSchema} from '@apackdev/host/database';
import {_appDataPaths} from '@apackdev/sdk/utils';import {resolveAppEnvironment} from '@apackdev/sdk/env';
import {writeFileSync} from 'node:fs';
const context=resolveAppEnvironment(),paths=_appDataPaths(context.userDataDir);
const {database,engine}=openDatabaseStore({path:paths.lmdb,schema:readInstalledSchema(context)});
try{engine.create('Prompt',{id:'Prompt-built-api',label:'persistent SQLite app',inputs:{},templateFn:'return ""'});}
finally{database.close();}
writeFileSync('/results/built-runtime/profile-paths.json',JSON.stringify({apiPortFile:context.apiPortFile,primary:paths.lmdb,runs:paths.runHistory}));
''')
run('seed',['node','--import','tsx','--conditions=@apackdev/source',str(seed)],env)
client=r/'sqlite-boot-client.mjs'
client.write_text('''import assert from 'node:assert/strict';import {createWSClient,createTRPCClient,wsLink} from '@trpc/client';import WebSocket from 'ws';
class ApiSocket extends WebSocket{constructor(url){super(url,['apack',`apack-token.${process.env.APACK_API_TOKEN}`]);}}
const ws=createWSClient({url:`ws://127.0.0.1:${process.env.API_PORT}`,WebSocket:ApiSocket});
const rpc=createTRPCClient({links:[wsLink({client:ws})]});
let timer;
try{
 const result=await Promise.race([(async()=>{
  const seeded=await rpc.entities.exists.query({id:'Prompt-built-api'}),migrated=await rpc.entities.exists.query({id:'AppState-app'});
  assert.equal(seeded,true);assert.equal(migrated,true);
  const loaded=await rpc.packs.loaded.query();assert(loaded.some(pack=>pack.id==='default-setup'),JSON.stringify(loaded));
  const credential=await rpc.settings.openHost.mutate();assert.equal(typeof credential,'string');assert(credential.length>0);
  await rpc.settings.close.mutate({credential});
  return {seeded,migrated,loaded:loaded.map(pack=>pack.id),settingsLeaseOpenedAndClosed:true};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Authenticated RPC timed out')),15000);})]);
 console.log(JSON.stringify(result));
}finally{clearTimeout(timer);await ws.close();}
''')
paths=json.loads((o/'profile-paths.json').read_text());results=[]
run('bundled-cli',['node','packages/apack-cli/dist/package/dist/cli.js','db','query','--data-dir',profile,'--output','json','return query("Prompt").ids()'],env)
for trial in [1,2]:
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 childenv=env|{'API_PORT':str(port),'APACK_STARTUP_ID':f'sqlite-probe-{trial}'}
 log=o/f'server-{trial}.txt'
 with log.open('w') as f:
  child=subprocess.Popen(['node','scripts/with-source.mjs','node','packages/api/dist/server.js'],cwd=r,env=childenv,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  start=time.monotonic()
  try:
   while True:
    if child.poll() is not None:raise RuntimeError(f'API exited before listening: {child.returncode}\n'+log.read_text()[-16000:])
    ready=pathlib.Path(paths['apiPortFile'])
    if ready.exists():
     try:
      endpoint=json.loads(ready.read_text())
      if endpoint.get('port')==port:break
     except (ValueError,OSError):pass
    if time.monotonic()-start>60:raise TimeoutError('API did not publish its endpoint within the 60s smoke safety cap')
    time.sleep(.1)
   run(f'rpc-{trial}',['node',str(client)],childenv,timeout=25)
   item={'trial':trial,'readySeconds':time.monotonic()-start,'rpc':True,'scope':'built Node API, actual shipped pack and authenticated WebSocket; not Electron/platform or performance qualification'}
  finally:
   if child.poll() is None:
    os.killpg(child.pid,signal.SIGTERM)
    try:child.wait(timeout=15)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait();raise
  item['exitCode']=child.returncode;assert child.returncode==0,log.read_text()[-16000:]
  results.append(item);(o/'boots.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(item),flush=True)
assert not pathlib.Path(paths['primary'],'data.mdb').exists()
assert pathlib.Path(paths['primary'],'data.sqlite3').exists() and pathlib.Path(paths['runs'],'data.sqlite3').exists()
