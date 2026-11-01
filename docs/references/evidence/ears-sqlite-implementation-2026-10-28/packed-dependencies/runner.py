from pathlib import Path
import tarfile,subprocess,shutil,os,time,json,hashlib
r=Path('/metrics');o=Path('/results');r.mkdir(exist_ok=True)
assert not any(r.iterdir())
with tarfile.open('/source.tar') as t:source=t.pax_headers['comment'];t.extractall(r)
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
subprocess.run(['git','init','-q',str(r)],check=True);subprocess.run(['git','add','-f','.'],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Fixture qualification','-c','user.email=qualification@localhost','commit','-qm','Exact source plus recorded fixture fix'],cwd=r,check=True)
assert (r/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
(r/'vendor/elmdb').symlink_to('/engine')
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
(o/'source.json').write_text(json.dumps({'base':source,'overlay':inputs,'limits':limits,'metadata':'synthetic Git metadata only for source classification'},indent=2)+'\n')
rows=[]
def run(name,args,negative=False,timeout=180):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.log')).read_text()[-6000:]
fixture=r/'packages/publish-checks/src/published-packages.ts';fixed=fixture.read_bytes()
fixture.write_bytes(Path('/old-fixture.ts').read_bytes())
run('packages-before-control',['npm','run','packages:build'])
file='packages/publish-checks/tests/published-exports.integration.spec.ts'
base=['node','node_modules/vitest/vitest.mjs','run','--config','vitest.integration.config.ts','--maxWorkers=1','--reporter=default','--reporter=json']
run('reject-flattened-dependencies',[*base,file,'-t','preserves each packed package','--outputFile=/results/flattened.json'],negative=True)
negative=json.loads((o/'flattened.json').read_text());assert negative['numFailedTests']==1
assert 'private version override' in (o/'reject-flattened-dependencies.log').read_text()
fixture.write_bytes(fixed)
run('packages-fixed',['npm','run','packages:build'])
run('packed-and-workspace-contracts',[*base,file,'packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts','--outputFile=/results/fixed.json'],timeout=540)
positive=json.loads((o/'fixed.json').read_text());assert positive['numFailedTests']==0 and positive['numPassedTests']==6 and positive['numPendingTests']==0
assert fixture.read_bytes()==fixed
run('specifiers',['npm','run','check:specifiers'])
