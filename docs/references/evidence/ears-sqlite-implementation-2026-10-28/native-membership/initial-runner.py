from pathlib import Path
import tarfile,shutil,os,subprocess,time,json,hashlib
root=Path('/metrics');out=Path('/results');root.mkdir(exist_ok=True)
with tarfile.open('/source.tar') as t:
 source=t.pax_headers['comment'];t.extractall(root)
assert (root/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
with tarfile.open('/overlay.tar') as t:t.extractall(root)
inputs=json.loads(Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha
subprocess.run(['git','init','-q',str(root)],check=True)
subprocess.run(['git','add','-f','.'],cwd=root,check=True)
subprocess.run(['git','-c','user.name=SQLite qualification','-c','user.email=qualification@localhost','commit','-qm','Exact source plus recorded native overlay'],cwd=root,check=True)
shutil.copytree('/seed/node_modules',root/'node_modules',symlinks=True)
for p in Path('/seed/packages').glob('*/node_modules'):
 d=root/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
(root/'vendor/elmdb').symlink_to('/engine')
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
(out/'source.json').write_text(json.dumps({'appSource':source,'uncommittedNativeInputs':inputs,'limits':limits,'gitMetadata':'synthetic only; source/archive and native overlay hashes are authoritative'},indent=2)+'\n')
env=os.environ|{'EARS_TEST_SOURCE':source,'EARS_EVALUATION_BACKEND':'sqlite'};results=[]
def run(name,args,timeout=180,negative=False):
 start=time.monotonic()
 with (out/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 results.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start})
 (out/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(out/(name+'.log')).read_text()[-6000:]
run('compile-original',['node','.github/scripts/ears-vec1-build.mjs','/metrics/original','/upstream.c'])
run('compile-patched',['node','native/vectors/build.mjs','/metrics/patched','/upstream.c'])
shutil.copyfile(root/'original/provenance.json',out/'original-provenance.json');shutil.copyfile(root/'patched/provenance.json',out/'patched-provenance.json')
for name in ('original','patched'):
 run('membership-'+name,['node','native/vectors/membership-test.mjs',str(root/name/'vec1.so'),str(out/('membership-'+name+'.json'))])
 report=json.loads((out/('membership-'+name+'.json')).read_text());assert report['completed'] and len(report['groups'])==15
 assert all(g['checks']==37 for g in report['groups'])
# Corrupted input must be refused before producing any native output.
corrupt=root/'corrupt.c';corrupt.write_bytes(Path('/upstream.c').read_bytes()+b'\n/* changed */\n')
run('refuse-source-mismatch',['node','native/vectors/build.mjs','/metrics/refused',str(corrupt)],negative=True)
assert not (root/'refused').exists()
assert 'Pinned native source hash must match' in (out/'refuse-source-mismatch.log').read_text()
env['EARS_VEC1_EXTENSION']=str(root/'patched/vec1.so')
run('ears-sqlite-patched',['npm','test','-w','@apackdev/ears','--','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/ears.json'],180)
report=json.loads((out/'ears.json').read_text());assert report['success'] and report['numPassedTests']>=625
