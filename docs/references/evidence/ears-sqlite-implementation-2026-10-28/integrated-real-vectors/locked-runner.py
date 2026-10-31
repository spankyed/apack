from pathlib import Path
import tarfile,os,subprocess,json,time,shutil
r=Path('/metrics');r.mkdir(exist_ok=True);o=Path('/results')
with tarfile.open('/source.tar') as archive:
 source=archive.pax_headers['comment'];archive.extractall(r)
os.environ['EARS_TEST_SOURCE']=source
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for package in Path('/seed/packages').glob('*/node_modules'):
 target=r/'packages'/package.parent.name/'node_modules'
 if target.parent.exists():shutil.copytree(package,target,symlinks=True)
for path,target in [(r/'vendor/elmdb',Path('/engine')),(r/'node_modules/elmdb',Path('/engine/crates/elmdb-node'))]:
 if path.is_symlink():path.unlink()
 elif path.exists():shutil.rmtree(path)
 path.symlink_to(target)
limits={name:Path('/sys/fs/cgroup',name).read_text().strip() for name in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
probe=r/'mode-denial';probe.mkdir();probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Mode denial bypassed')
finally:probe.chmod(0o700);probe.rmdir()
records=[]
def run(name,args,timeout=180):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as log:
  try:p=subprocess.run(args,cwd=r,stdout=log,stderr=subprocess.STDOUT,timeout=timeout);code=p.returncode
  except subprocess.TimeoutExpired:code='timeout'
 records.append({'label':name,'args':args,'exitCode':code,'seconds':time.monotonic()-start})
 (o/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(records[-1],flush=True)
 return code
(o/'runtime.json').write_text(json.dumps({'source':source,'limits':limits,'modeDenial':True},indent=2)+'\n')
lock=(r/'package-lock.json').read_bytes()
assert run('dependency-reconciliation',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)==0
assert (r/'package-lock.json').read_bytes()==lock
assert run('dependencies',['node','--input-type=commonjs','-e',"const fs=require('node:fs'),p=require('node:path'),r=require('node:module').createRequire('/metrics/packages/apack-ears/package.json'),a=require('node:assert/strict');const versions=Object.fromEntries(['ajv','better-sqlite3','sqlite-vec'].map(name=>{let dir=p.dirname(r.resolve(name));for(;;){const file=p.join(dir,'package.json');if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(pkg.name===name)return[name,{path:file,version:pkg.version}];}const parent=p.dirname(dir);if(parent===dir)throw Error('Package root absent: '+name);dir=parent;}}));a.equal(versions.ajv.version,'8.20.0');a.equal(versions['better-sqlite3'].version,'13.0.3');a.equal(versions['sqlite-vec'].version,'0.1.9');console.log(JSON.stringify(versions,null,2));"])==0
(o/'dependencies.json').write_text((o/'dependencies.log').read_text())
for size in (1000,99900):
 label='ears-'+str(size)
 code=run(label,['node','--import','tsx','packages/apack-ears/bench/sqlite/real-vector-ears.mjs','/corpus','/truth/truth.json',str(size),'/results/'+label+'.json'],900)
 if code!=0:
  print((o/(label+'.log')).read_text()[-8000:],flush=True)
  raise SystemExit(code if isinstance(code,int) else 1)
