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


backend={'EARS_EVALUATION_BACKEND':'sqlite','EARS_PLATFORM_ARCH':'arm64'}
try:
 check('workflow-yaml',['node','--input-type=module','--eval',"import {createRequire} from 'node:module';import fs from 'node:fs';const require=createRequire(import.meta.url),yaml=require('js-yaml');for(const f of ['.github/workflows/ears-sqlite.yml','.github/workflows/strict-chain.yml']) {const v=yaml.load(fs.readFileSync(f,'utf8'));if(!v.on||!v.jobs)throw Error('Not a workflow: '+f);console.log(f,Object.keys(v.jobs));}"])
 check('probe-syntax',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])
 check('probe-lint',['node','node_modules/oxlint/bin/oxlint','.github/scripts/ears-sqlite-platform.mjs','-D','correctness'])
 check('runtime-probe',['node','.github/scripts/ears-sqlite-platform.mjs','probe'],env=backend)
 ears=['npm','test','-w','@apackdev/ears','--','--reporter=default','--reporter=json','--outputFile=../../.temp/sqlite-platform/ears.json']
 check('candidate-ears',ears,env=backend)
 check('candidate-host',['npm','test','-w','@apackdev/host','--','tests/backup/recovery.spec.ts','tests/backup/recovery-crash.spec.ts','tests/backup/import.spec.ts','tests/backup/import-transaction.spec.ts','tests/database/storage.spec.ts','tests/database/open-app-database.spec.ts','tests/database/write-lock.spec.ts','--reporter=default','--reporter=json','--outputFile=../../.temp/sqlite-platform/host.json'],env=backend)
 check('positive-report-guard',['node','.github/scripts/ears-sqlite-platform.mjs','verify'],env=backend)
 report=r/'.temp/sqlite-platform/ears.json';sqlite_report=report.read_bytes()
 try:
  check('native-control',ears,env={'EARS_EVALUATION_BACKEND':'elmdb'})
  shutil.copy2(report,o/'negative-native-selection.json')
  check('negative-report-guard',['node','.github/scripts/ears-sqlite-platform.mjs','verify'],env=backend,negative=True)
  shutil.copy2(r/'.temp/sqlite-platform/verification.json',o/'negative-verification.json')
 finally:report.write_bytes(sqlite_report)
 check('restored-report-guard',['node','.github/scripts/ears-sqlite-platform.mjs','verify'],env=backend)
 check('lint',['npm','run','lint:check'])
 check('specifiers',['npm','run','check:specifiers'])
finally:
 p=r/'.temp/sqlite-platform'
 if p.exists():shutil.copytree(p,o/'platform',dirs_exist_ok=True)
