from pathlib import Path
import subprocess,tarfile,json,hashlib,os,time
r=Path('/metrics');o=Path('/results')
prior=json.loads(Path('/prior-inputs.json').read_text())
for name,sha in prior.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')};assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
ext=Path('/seed/patched/vec1.so');assert hashlib.sha256(ext.read_bytes()).hexdigest()=='360c068120fbd25bb947d08ab2908d8981122da84ace8aeba218cd15c90b403d'
(o/'source.json').write_text(json.dumps({'integrationBase':'a658be490383120518f186fdf31fa1af3a202991','priorInputs':prior,'overlay':inputs,'limits':limits,'extensionSha256':hashlib.sha256(ext.read_bytes()).hexdigest(),'nativeBinding':'read-only old 4d558a2 plus tested own-unit patch; not qualification of new 006d6ce elmdb pin','scope':'SQLite EARS source tests only; exact full integration/platform remains pending'},indent=2)+'\n')
env=os.environ|{'npm_config_update_notifier':'false','EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(ext)};rows=json.loads((o/'results.json').read_text())
def run(name,args,negative=False):
 at=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=240)
 rows.append({'name':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-10000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json']
subprocess.run(['git','add','-f',*inputs.keys()],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Native package qualification','-c','user.email=qualification@localhost','commit','-qm','Native input coverage and typed fixture correction'],cwd=r,check=True)
run('final-package-build',['npm','run','packages:build'])
extension=r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so';env['EARS_VEC1_EXTENSION']=str(extension)
assert hashlib.sha256(extension.read_bytes()).hexdigest()==json.loads((o/'native-provenance.json').read_text())['extensionSha256']
run('final-native-package-cases',[*base,'packages/apack-ears/tests/sqlite/native-extension.spec.ts','--outputFile=/results/final-native-package.json'])
run('types',['npm','run','typecheck','-w','@apackdev/ears'])
run('host-types',['npm','run','typecheck:host'])
run('script-types',['npm','run','typecheck:scripts'])
run('boundaries',['npm','run','check:specifiers'])
repo=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@app/repo-checks','packages/repo-checks/tests/chain-inputs.spec.ts','packages/repo-checks/tests/repro.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json']
run('build-coverage',[*repo,'--outputFile=/results/build-coverage.json'])
run('platform-verifier-syntax',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])
run('lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in inputs if n.endswith('.ts')],'-D','correctness'])
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha,name
