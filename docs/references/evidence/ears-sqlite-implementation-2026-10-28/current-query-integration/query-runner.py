from pathlib import Path
import tarfile,subprocess,shutil,os,time,json
r=Path('/metrics');o=Path('/results');r.mkdir(exist_ok=True)
assert not any(r.iterdir())
with tarfile.open('/source.tar') as t:
 source=t.pax_headers['comment'];t.extractall(r)
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','add','-f','.'],cwd=r,check=True)
subprocess.run(['git','-c','user.name=Isolated qualification','-c','user.email=qualification@localhost','commit','-qm','Exact integrated source archive'],cwd=r,check=True)
assert (r/'package-lock.json').read_bytes()==Path('/seed/package-lock.json').read_bytes()
shutil.copytree('/seed/node_modules',r/'node_modules',symlinks=True)
for p in Path('/seed/packages').glob('*/node_modules'):
 d=r/'packages'/p.parent.name/'node_modules'
 if d.parent.exists():shutil.copytree(p,d,symlinks=True)
(r/'vendor/elmdb').symlink_to('/engine')
limits={n:Path('/sys/fs/cgroup',n).read_text().strip() for n in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
(o/'source.json').write_text(json.dumps({'source':source,'limits':limits,'sourceDescription':'exact integration commit archive; synthetic Git classification metadata'},indent=2)+'\n')
rows=[]
def run(name,args,timeout=240,extra=None):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-10000:]
run('packages-build',['npm','run','packages:build'])
run('default-setup-build',['npm','run','build:default-setup'],timeout=540)
for backend in ['sqlite','elmdb']:
 report='/results/query-'+backend+'.json'
 run('query-'+backend,['npm','test','-w','@app/default-setup','--','tests/features/threads/be/query-work.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile='+report],extra={'EARS_EVALUATION_BACKEND':backend},timeout=240)
 result=json.loads(Path(report).read_text())
 assert result['numPassedTests']==5 and result['numFailedTests']==0 and result['numPendingTests']==0,result
