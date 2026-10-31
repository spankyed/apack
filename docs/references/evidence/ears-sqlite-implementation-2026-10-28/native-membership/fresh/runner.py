from pathlib import Path
import os,subprocess,tarfile,shutil,json,time,hashlib
r=Path('/metrics');o=Path('/results');r.mkdir(exist_ok=True)
assert not any(r.iterdir()),'Fresh work volume must be empty'
with tarfile.open('/source.tar') as t:
 source=t.pax_headers['comment'];assert source=='1860dd2eb141fc1d3f3b8b5d3e7b0a7a5f2fe332';t.extractall(r)
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','add','-f','.'],cwd=r,check=True)
subprocess.run(['git','-c','user.name=SQLite measurement','-c','user.email=measurement@localhost','commit','-qm','Exact tracked source archive for isolated measurements'],cwd=r,check=True)
assert (r/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
(r/'vendor/elmdb').symlink_to('/engine')
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
truth=Path('/truth/truth.json').read_bytes();assert hashlib.sha256(truth).hexdigest()=='ca6356a0cf0059ba87e5f628e9ae0a32260adf146617acb498c880cdf9442545'
(o/'source.json').write_text(json.dumps({'source':source,'sourceTree':'exact Git archive; synthetic Git metadata only for tracked/ignored source checks','limits':limits,'truthSha256':hashlib.sha256(truth).hexdigest(),'order':['original','patched'],'comparison':'same app, corpus, settings and limits; independent full lifecycle/model training, not a paired same-model membership-only timing'},indent=2)+'\n')
env=os.environ|{'EARS_TEST_SOURCE':source,'EARS_EVALUATION_BACKEND':'sqlite','CARGO_BUILD_JOBS':'2'};rows=[]
def run(name,args,limit=180,measurement=False,extra=None):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode in ([0,1] if measurement else [0]),(o/(name+'.log')).read_text()[-6000:]
run('packages-build',['npm','run','packages:build'])
run('compile-original',['cc','-O3','-DNDEBUG','-Werror=implicit-function-declaration','-shared','-fPIC','-I'+str(r/'node_modules/better-sqlite3/deps/sqlite3'),'/upstream.c','-lm','-o',str(r/'original.so')])
run('compile-patched',['node','native/vectors/build.mjs','/metrics/patched','/upstream.c'])
provenance=json.loads((r/'patched/provenance.json').read_text());assert provenance['sourceSha256']=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
(o/'native-provenance.json').write_text(json.dumps({'original':{'sourceSha256':hashlib.sha256(Path('/upstream.c').read_bytes()).hexdigest(),'binarySha256':hashlib.sha256((r/'original.so').read_bytes()).hexdigest()},'patched':provenance},indent=2)+'\n')
for variant in ['original','patched']:
 ext=str(r/'original.so') if variant=='original' else str(r/'patched/vec1.so')
 for size,deadline in [(1000,120),(99900,1800)]:
  name=variant+'-'+str(size);report=o/(name+'.json');verification=o/(name+'-verification.json')
  run(name,['node','--import','tsx','packages/apack-ears/bench/sqlite/real-vector-ears.mjs','/corpus','/truth/truth.json',str(size),str(report),'native-fresh'],limit=deadline,extra={'EARS_VEC1_EXTENSION':ext})
  run(name+'-verification',['python3','packages/apack-ears/bench/sqlite/verify-fresh-vector.py',str(report),'/truth/truth.json',str(verification)],measurement=True)
  result=json.loads(verification.read_text());assert result['evidenceValid'] and result['source']==source
  print(json.dumps({'variant':variant,'size':size,'queryGatesPassed':result['queryGatesPassed'],'admissionHeartbeatPassed':result['admissionHeartbeatPassed']}),flush=True)
