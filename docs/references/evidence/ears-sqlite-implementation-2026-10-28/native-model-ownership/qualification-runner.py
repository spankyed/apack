from pathlib import Path
import subprocess,tarfile,json,hashlib,os,time
r=Path('/metrics');o=Path('/results')
for archive in ['/base.tar','/overlay.tar']:
 with tarfile.open(archive) as t:t.extractall(r)
(r/'packages/apack-ears/src/sqlite/fs-native-extensions.d.ts').unlink(missing_ok=True)
m=json.loads(Path('/inputs.json').read_text())
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
assert (r/'package-lock.json').read_bytes()==(o/'package-lock.json').read_bytes()
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')};assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
subprocess.run(['git','add','-u'],cwd=r,check=True);subprocess.run(['git','add','-f',*m],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Native owner qualification','-c','user.email=qualification@localhost','commit','--allow-empty','-qm','Exact integration archive plus advisory ownership overlay'],cwd=r,check=True)
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so','npm_config_update_notifier':'false'};rows=[]
(o/'full-source.json').write_text(json.dumps({'base':'1efad34246795ee6286d915e47637fe9c55807ef','inputs':m,'limits':limits,'nativeBinding':'recorded older base-plus-own-unit-patch binding; not exact native 006d6ce qualification','network':'none','scope':'SQLite source and native model ownership; app activation remains separate'},indent=2)+'\n')
def run(label,args,negative=False):
 at=time.monotonic()
 with (o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=240)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-at});(o/'full-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(label+'.log')).read_text()[-9000:]
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/ears','--maxWorkers=2','--reporter=default','--reporter=json']
run('owner-packages',['npm','run','packages:build'])
mutations=[('missing-kernel-claim','packages/apack-ears/src/sqlite/vector-owner.ts','if (!tryLock(fd))','if (false)','packages/apack-ears/tests/sqlite/vector-owner.spec.ts','releases after process death'),('early-claim-release','packages/apack-ears/src/sqlite/vector-models.ts','    this.stopped=true;','    this.stopped=true;this.release();','packages/apack-ears/tests/sqlite/vector-models.spec.ts','excludes independent connections')]
for label,name,before,after,file,pattern in mutations:
 p=r/name;fixed=p.read_bytes();s=fixed.decode();assert s.count(before)==1
 try:
  p.write_text(s.replace(before,after));run('reject-'+label,[*base,file,'-t',pattern,'--outputFile=/results/'+label+'.json'],True)
  d=json.loads((o/(label+'.json')).read_text());assert d['numFailedTests']==1
 finally:p.write_bytes(fixed)
run('owner-all-ears',[*base,'--outputFile=/results/owner-all-ears.json'])
d=json.loads((o/'owner-all-ears.json').read_text());assert d['numPassedTests']==646 and d['numFailedTests']==0 and d['numPendingTests']==0
run('owner-types',['npm','run','typecheck','-w','@apackdev/ears'])
run('owner-host-types',['npm','run','typecheck:host'])
run('owner-boundaries',['npm','run','check:specifiers'])
run('owner-lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in m if n.endswith('.ts')],'-D','correctness'])
run('owner-platform-syntax',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
