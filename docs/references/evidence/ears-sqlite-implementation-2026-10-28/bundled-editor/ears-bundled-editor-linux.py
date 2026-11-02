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
assert results[-1].get('exitCode')==0, 'dependency setup failed'
assert (r/'package-lock.json').read_bytes()==source_lock, 'dependency setup changed checked-in lockfile'
run('packages-build',['npm','run','packages:build'],180)
assert results[-1].get('exitCode') == 0, 'package setup failed; stop before diagnosing types'



def check(name,args,env=None,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-16000:]





# This container runs Chromium as root with no capabilities; the local executable wrapper supplies
# --no-sandbox only for this diagnostic. It is not a product source edit or packaging qualification.
electron=r/'node_modules/electron/dist/electron'; electron.rename(electron.with_name('electron.real'))
electron.write_text('#!/bin/sh\nexec "$(dirname "$0")/electron.real" --no-sandbox "$@"\n');electron.chmod(0o755)
os.environ['APACK_CHAIN_CORES']='2'
os.environ['APACK_HOST']=str(r)
check('default-pack-build',['npm','run','build:default-setup'],timeout=600)
check('runtime-build',['npm','run','build:runtime','--','--cores','2'],timeout=600)
pack=r/'tests/packs/bundled-ui-pack'
def packcheck(label,args,timeout=180):
 start=time.monotonic()
 with (o/(label+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=pack,env=os.environ,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 print(label,p.returncode,round(time.monotonic()-start,3),flush=True)
 return p.returncode
assert packcheck('fixture-build',[str(r/'node_modules/.bin/apack'),'pack','build'])==0
try:
 code=packcheck('bundled-editor-original',['xvfb-run','-a',str(r/'node_modules/.bin/apack'),'pack','test','--host',str(r),'--prebuilt'],timeout=180)
 (o/'editor-outcome.json').write_text(json.dumps({'exitCode':code,'source':os.environ['EARS_TEST_SOURCE'],'sandbox':'disabled only in private Electron executable wrapper; root/cap-drop ALL','display':'Xvfb','backend':'default elmdb'},indent=2)+'\n')
finally:
 output=pack/'.apack/tests/results'
 if output.exists():shutil.copytree(output,o/'playwright-results',dirs_exist_ok=True)
