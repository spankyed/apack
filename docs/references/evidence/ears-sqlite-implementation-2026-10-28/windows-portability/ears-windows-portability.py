import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':os.environ['EARS_TEST_SOURCE'],'gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

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
source_lock=(r/'package-lock.json').read_bytes()
run('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund'],120)
assert (r/'package-lock.json').read_bytes()==source_lock, 'dependency setup changed checked-in lockfile'
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'



def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]



# Reproduce Windows checkout byte conversion with Git itself, not a normalized hash assertion.
origin=pathlib.Path('/tmp/regex-byte-origin');origin.mkdir()
subprocess.run(['git','init','-q',str(origin)],check=True)
asset='packages/apack-ears/vendor/rregex';(origin/asset).parent.mkdir(parents=True)
shutil.copytree(r/asset,origin/asset)
def git(*args):return subprocess.run(['git',*args],cwd=origin,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
git('-c','core.autocrlf=false','add','.')
git('-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Controlled bytes without attributes')
for name in ['before','after']:
 if name=='after':
  shutil.copy2(r/'.gitattributes',origin/'.gitattributes');git('add','.gitattributes');git('-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Pin controlled byte attributes')
 git('-c','core.autocrlf=true','clone','-q','--no-local',str(origin),'/tmp/regex-byte-'+name)
import hashlib
provenance=json.loads((r/asset/'provenance.json').read_text());comparison={}
for name in ['before','after']:
 root=pathlib.Path('/tmp/regex-byte-'+name)/asset
 comparison[name]={file:hashlib.sha256((root/file).read_bytes()).hexdigest() for file in provenance['sha256']}
assert comparison['before']['rregex.cjs']=='b460e24b492a5f93a1b1c5d08f4525473d4beed5bb37dfd2ec51bba6a213a2f3'
assert comparison['after']==provenance['sha256']
(o/'git-checkout-bytes.json').write_text(json.dumps(comparison,indent=2)+'\n')
print('Git checkout reproduces the Windows mismatch and attributes preserve exact provenance bytes',flush=True)
backend={'EARS_EVALUATION_BACKEND':'sqlite'}
check('ears-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('focused-portability',['npm','test','-w','@apackdev/ears','--','tests/sqlite/search-builds.spec.ts','tests/sqlite/regex.spec.ts','tests/engine/calls.spec.ts'],env=backend)
check('lint',['npm','run','lint:check'])
check('specifiers',['npm','run','check:specifiers'])
p=r/'packages/apack-ears/tests/sqlite/search-builds.spec.ts';original=p.read_text()
try:
 old='db.indexBuilds.step();writeSync(1,JSON.stringify';assert old in original
 p.write_text(original.replace(old,'writeSync(1,JSON.stringify',1))
 check('negative-uncommitted-cursor',['npm','test','-w','@apackdev/ears','--','tests/sqlite/search-builds.spec.ts','-t','cursor committed by a process killed'],env=backend,negative=True)
finally:p.write_text(original)
check('sqlite-suite',['npm','test','-w','@apackdev/ears'],env=backend,timeout=180)
check('native-suite',['npm','test','-w','@apackdev/ears'],env={'EARS_EVALUATION_BACKEND':'elmdb'},timeout=180)
