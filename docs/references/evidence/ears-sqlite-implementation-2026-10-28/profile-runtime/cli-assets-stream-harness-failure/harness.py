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

import tempfile,hashlib
profile=tempfile.mkdtemp(prefix='ears-compiled-cli-')
env=os.environ|{'APACK_ENV':'test','APACK_STORAGE_FORMAT':'sqlite/1'}
seed=r/'seed-cli-assets.mts'
seed.write_text("""import {openDatabase} from '@apackdev/ears/sqlite';
import {createEarsEngine} from '@apackdev/ears';import {_appDataPaths} from '@apackdev/sdk/utils';
const database=openDatabase({path:_appDataPaths(process.argv[2]!).lmdb,syncs:false,schema:{types:{Row:{required:[],substrings:['title'],embed:{from:['title'],model:'fixture',dims:3}}},relations:{},roles:[]}});
try{const e=createEarsEngine({database});e.create('Row',{id:'Row-alpha',title:'alpha marker'});e.create('Row',{id:'Row-beta',title:'beta marker'});
const {model,chunks}=e.pendingEmbeddings('Row');e.embed(chunks.map(c=>({...c,model,vector:c.id==='Row-alpha'?[1,0,0]:[0,1,0]})));}
finally{database.close();}
""")
def check(name,args,expected):
 start=time.monotonic()
 p=subprocess.run(args,cwd=r,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
 (o/(name+'.txt')).write_text(p.stdout)
 assert p.returncode==0,p.stdout
 assert json.loads(p.stdout)==expected,p.stdout
 print(name,'pass',round(time.monotonic()-start,3),flush=True)
p=subprocess.run(['node','--import','tsx','--conditions=@apackdev/source',str(seed),profile],cwd=r,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
(o/'seed.txt').write_text(p.stdout);assert p.returncode==0,p.stdout
cli=['node','packages/apack-cli/dist/package/dist/cli.js','db','query','--data-dir',profile,'--output','json']
check('compiled-regex',cli+['return query("Row").matching("^alpha").ids()'],['Row-alpha'])
check('compiled-substring',cli+['return query("Row").containing("beta").ids()'],['Row-beta'])
check('compiled-vector',cli+['return query("Row").near([1,0,0], {k:1}).ids()'],['Row-alpha'])
wasm=r/'packages/apack-ears/vendor/rregex/rregex_bg.wasm';hidden=wasm.with_suffix('.hidden')
wasm.rename(hidden)
try:
 p=subprocess.run(cli+['return query("Row").matching("^alpha").ids()'],cwd=r,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
 (o/'negative-missing-wasm.txt').write_text(p.stdout);assert p.returncode!=0 and ('rregex_bg.wasm' in p.stdout or 'ENOENT' in p.stdout),p.stdout
finally:hidden.rename(wasm)
check('restored-regex',cli+['return query("Row").matching("^alpha").ids()'],['Row-alpha'])
files=[r/'packages/apack-cli/dist/package/dist/cli.js',r/'packages/apack-ears/dist/sqlite/index.js',wasm]
(o/'built-sha256.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},indent=2)+'\n')
