import pathlib,subprocess,json,os,tempfile,socket,time,hashlib,signal
r=pathlib.Path('/metrics');o=pathlib.Path('/results')
files=list((r/'packages/apack-host/src/database').glob('*.ts'))+[r/'packages/api/src/runtime/index.ts',r/'packages/api/src/server.ts',r/'packages/default-setup/apack.json',r/'package.json']
(o/'source-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
def run(name,args,env=None,timeout=300):
 start=time.monotonic();p=subprocess.run(args,cwd=r,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,timeout=timeout)
 (o/(name+'.txt')).write_text(p.stdout);print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert p.returncode==0,p.stdout[-16000:]
 return p
run('packages-build',['npm','run','packages:build'])
run('shipped-pack-build',['npm','run','build:default-setup'],timeout=420)
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
writeFileSync('/results/profile-paths.json',JSON.stringify({apiPortFile:context.apiPortFile,primary:paths.lmdb,runs:paths.runHistory}));
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
