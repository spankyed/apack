import pathlib, subprocess, time, json, os, shutil, tarfile
r=pathlib.Path('/metrics');o=pathlib.Path('/results');r.mkdir()
with tarfile.open('/source.tar') as t:t.extractall(r)
# Archive source is exact; these guards also inspect Git's tracked/ignored path classification.
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact tracked source archive for isolated checks'],check=True)
(o/'source.json').write_text(json.dumps({'source':'5e20fb5956cb0543d8934f34232d088d108818b1','gitMetadata':'synthetic repository for tracked/ignored file guards; no source edits'},indent=2)+'\n')

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


import hashlib,re,tempfile
def checked(name,args,negative=False,env=None,timeout=180):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=os.environ|(env or {}),text=True,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 value=(o/(name+'.txt')).read_text();print(name,p.returncode,round(time.monotonic()-start,3),flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),value[-18000:]
 return value
checked('api-bundle',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'])
p=r/'packages/api/tsup.config.ts';original=p.read_text()
try:
 p.write_text(original.replace("    noExternal: [/^@apackdev\\/ears(?:\\/lmdb)?$/],\n",''))
 assert p.read_text()!=original
 value=checked('negative-root-bundling',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'],negative=True)
 assert 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' in value or 'namespace' in value,value[-12000:]
finally:p.write_text(original)
try:
 changed=original.replace(", '@apackdev/ears/sqlite'",'').replace('(?:\\/lmdb)?','(?:\\/(?:lmdb|sqlite))?')
 assert changed!=original
 p.write_text(changed)
 value=checked('negative-sqlite-inlining',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'],negative=True)
 assert 'better_sqlite3.node' in value or 'Cannot find module' in value,value[-12000:]
finally:p.write_text(original)
checked('api-types',['npm','run','typecheck:api'])
info=r/'node_modules/.cache/tsbuildinfo/api-test.tsbuildinfo';assert info.exists()
text=info.read_text();assert 'tsup.config.ts' in text and 'build-metadata.ts' in text
checked('cache-inputs',['npm','test','-w','@app/repo-checks','--','tests/suite-reads.spec.ts','tests/chain-inputs.spec.ts','tests/typecheck-legs.spec.ts'])
checked('compiler-inputs',['npm','run','test:integration','-w','@app/repo-checks','--','tests/dep-files.integration.spec.ts','-t','leaves nothing a leg read'])
p=r/'scripts/lib/chain-steps.ts';original=p.read_text()
try:
 p.write_text(original.replace("'tsup.config.ts', ",'').replace("'package.json', 'build/build-metadata.ts'","'package.json'"))
 value=checked('negative-suite-inputs',['npm','test','-w','@app/repo-checks','--','tests/suite-reads.spec.ts','-t','leaves no file a spec'],negative=True)
 assert 'api reads build/build-metadata.ts' in value and 'api reads packages/api/tsup.config.ts' in value,value[-12000:]
finally:p.write_text(original)
checked('restored-api-bundle',['npm','test','-w','@app/api','--','tests/runtime/sqlite-bundle.spec.ts'])
raw=(r/'build/prod/smoke-native.mjs').read_text().split('const PROBE = String.raw`',1)[1].split('`;',1)[0]
head=raw[:raw.index('async function main()')]
body=raw[raw.index('  const { openDatabase }'):raw.index("  const pty = load('node-pty');")]
probe=r/'sqlite-native-smoke.cjs';probe.write_text(head+'async function main(){\n'+body+"}\nmain().catch(error=>{console.error(error.stack);process.exit(1)});\n")
(o/'sqlite-native-smoke.cjs').write_text(probe.read_text())
def smoke(name,executable,negative=False):
 return checked(name,[executable,str(probe),str(r),tempfile.mkdtemp(prefix='ears-runtime-native-')],negative=negative,env={'ELECTRON_RUN_AS_NODE':'1'})
smoke('node-assets','node')
electron='/seed/node_modules/electron/dist/electron'
checked('electron-version',[electron,'-p','JSON.stringify({versions:process.versions,platform:process.platform,arch:process.arch})'],env={'ELECTRON_RUN_AS_NODE':'1'})
smoke('electron-assets',electron)
wasm=r/'packages/apack-ears/vendor/rregex/rregex_bg.wasm';hidden=wasm.with_suffix('.hidden');wasm.rename(hidden)
try:
 value=smoke('negative-electron-wasm',electron,negative=True);assert 'rregex_bg.wasm' in value or 'ENOENT' in value,value
finally:hidden.rename(wasm)
smoke('restored-electron-assets',electron)
for label,executable in [('node','node'),('electron',electron)]:
 code="const{createRequire}=require('node:module');const r=createRequire('/metrics/packages/apack-ears/package.json');const D=r('better-sqlite3');const d=new D(':memory:');const fs=require('node:fs'),c=require('node:crypto');console.log(JSON.stringify({runtime:process.versions,addon:Object.keys(require.cache).filter(p=>p.endsWith('.node')).map(p=>({path:p,sha256:c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),vector:r('sqlite-vec').getLoadablePath()}));d.close()"
 checked(label+'-native-provenance',[executable,'-e',code],env={'ELECTRON_RUN_AS_NODE':'1'})
checked('scripts-types',['npm','run','typecheck:scripts'],timeout=60)
checked('lint',['npm','run','lint:check'])
checked('specifiers',['npm','run','check:specifiers'])
