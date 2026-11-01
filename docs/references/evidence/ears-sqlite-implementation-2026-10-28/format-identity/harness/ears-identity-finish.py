from pathlib import Path
import subprocess,os,json,hashlib,time
r=Path('/electron');o=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so')};rows=[]
subprocess.run(['tar','--no-same-owner','-xf','/overlay.tar','-C',str(r)],check=True)
inputs=json.loads((o/'inputs.json').read_text())
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
commands=[
 ('host-full',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/host-full.json']),
 ('scripts-types',['npm','run','typecheck:scripts']),

]
for label,args in commands:
 started=time.time()
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'elapsedSeconds':time.time()-started});print(label,p.returncode,flush=True)
 (o/'qualification.json').write_text(json.dumps({'sourceParent':'836d3d1d1ffedf85f1ae2dd8baa40be4e488276b','inputs':inputs,'commands':rows},indent=2)+'\n')
 assert p.returncode==0,(o/(label+'.log')).read_text()[-6500:]
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
