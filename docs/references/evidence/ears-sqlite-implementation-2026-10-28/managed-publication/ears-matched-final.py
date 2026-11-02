from pathlib import Path
import subprocess,json,hashlib,os
r=Path('/electron');o=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so')};rows=[]
files=list(json.loads(Path('/inputs.json').read_text()))+['scripts/lib/native-signing.mjs','packages/repo-checks/tests/native-signing.spec.ts']
inputs={n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in files}
for label,args in [
 ('matched-host',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/matched-host.json']),
 ('matched-ears',['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/matched-ears.json']),
 ('matched-scripts',['npm','run','typecheck:scripts'])]:
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600)
 rows.append({'label':label,'args':args,'exitCode':p.returncode});print(label,p.returncode,flush=True)
 (o/'matched-final.json').write_text(json.dumps({'base':'098d479157aaf9c7cfa363f01a8a8a371c1473d5','inputs':inputs,'extensionSha256':hashlib.sha256(Path(env['EARS_VEC1_EXTENSION']).read_bytes()).hexdigest(),'commands':rows},indent=2)+'\n')
 assert p.returncode==0,(o/(label+'.log')).read_text()[-5000:]
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
