from pathlib import Path
import subprocess,json,os,hashlib,time
r=Path('/electron');o=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so')};rows=[]
inputs=json.loads((o/'inputs.json').read_text())
subprocess.run(['tar','--no-same-owner','-xf','/overlay.tar','-C',str(r)],check=True)
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
commands=[
('ears-api-check',['npm','run','api:check','-w','@apackdev/ears']),
('ears-types',['node','node_modules/typescript/bin/tsc','-p','packages/apack-ears','--noEmit']),
('ears-full',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/ears-full.json']),
('host-full',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/host-full.json']),
('host-types',['node','node_modules/typescript/bin/tsc','-p','packages/apack-host','--noEmit']),
('scripts-types',['npm','run','typecheck:scripts']),
('graph-lint',['node','node_modules/oxlint/bin/oxlint',*[n for n in inputs if n.endswith(('.ts','.mjs'))],'-D','correctness']),
]
for label,args in commands:
 started=time.time()
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'elapsedSeconds':time.time()-started});print(label,p.returncode,flush=True)
 (o/'qualification.json').write_text(json.dumps({'parent':'82b36eca5b209b44b4450e4f3db664f6a02b5c8f','master':'62f1798c9bec2c013ded929d7080b65d1083049e','inputs':inputs,'commands':rows},indent=2)+'\n')
 assert p.returncode==0,(o/(label+'.log')).read_text()[-6500:]
for n,h in inputs.items():
 if n!='packages/apack-ears/etc/index.api.md':assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
for n in ['index','lmdb','sqlite']:
 p=r/'packages/apack-ears/etc'/f'{n}.api.md'
 if p.exists():(o/p.name).write_bytes(p.read_bytes())
