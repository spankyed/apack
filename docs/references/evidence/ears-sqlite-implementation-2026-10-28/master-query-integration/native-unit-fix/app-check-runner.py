import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir(exist_ok=True)
with tarfile.open('/source.tar') as t:
 source=t.pax_headers.get('comment')
 assert source and len(source)==40
 os.environ['EARS_TEST_SOURCE']=source
 t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':os.environ['EARS_TEST_SOURCE'],'gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

p=r/'vendor/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine')
(r/'node_modules').mkdir(exist_ok=True)
p=r/'node_modules/elmdb'
if p.is_symlink():p.unlink()
elif p.exists():shutil.rmtree(p)
p.symlink_to('/engine/crates/elmdb-node')
os.chdir(r)
os.environ['npm_config_jobs']='2'
limits={name:pathlib.Path('/sys/fs/cgroup',name).read_text().strip() for name in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
(o/'limits.json').write_text(json.dumps(limits,indent=2)+'\n')
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
lock=(r/'package-lock.json').read_bytes()
run('dependencies',['npm','ci','--ignore-scripts','--no-audit','--no-fund'],240)
assert results[-1].get('exitCode') == 0
assert (r/'package-lock.json').read_bytes() == lock
run('sqlite-binding',['npm','rebuild','better-sqlite3'],240)
assert results[-1].get('exitCode') == 0
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'



def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 results.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start})
 (o/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]





import hashlib
nativePatch=subprocess.check_output(['git','-C','/engine','diff','--binary'])
assert hashlib.sha256(nativePatch).hexdigest()=='a6c663442b58e3d04e436ecb485f823813fe4ab8ae6f6d2a23d3e863dc50a91d'
(o/'native-receipt.json').write_text(json.dumps({'base':subprocess.check_output(['git','-C','/engine','rev-parse','HEAD'],text=True).strip(),'patchSha256':hashlib.sha256(nativePatch).hexdigest(),'bindingSha256':hashlib.sha256(pathlib.Path('/engine/crates/elmdb-node/elmdb.linux-arm64-gnu.node').read_bytes()).hexdigest(),'state':'uncommitted isolated overlay candidate'},indent=2)+'\n')
check('native-own-unit-vector',['npm','test','-w','@apackdev/ears','--','tests/engine/vector.spec.ts','-t','ranks own embeddings in a unit','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=/results/native-own-unit.json'],env={'EARS_EVALUATION_BACKEND':'elmdb'},timeout=60)
check('cli-refused-facade',['node','node_modules/vitest/vitest.mjs','run','--config','vitest.integration.config.ts','packages/apack-cli/tests/build/build-output-swap.integration.spec.ts','-t','does not reuse facade files from an incumbent with stamps from a refused replacement','--maxWorkers=1','--reporter=default','--reporter=json','--reporter=/reporter.mjs','--outputFile=/results/cli-refused-facade.json'],timeout=260)
