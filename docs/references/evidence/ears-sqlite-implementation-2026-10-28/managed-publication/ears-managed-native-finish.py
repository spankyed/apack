from pathlib import Path
import subprocess,json,hashlib,os
r=Path('/electron');out=Path('/results');inputs=json.loads(Path('/inputs.json').read_text())
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
library=r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so';assert library.exists()
env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(library)}
args=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears','--maxWorkers','2','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/ears-native-final.json']
with(out/'ears-native-final.log').open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=300)
d=json.loads((out/'ears-native-final.json').read_text());print(p.returncode,d['numPassedTests'],d['numFailedTests'],d['numPendingTests'],flush=True);assert p.returncode==0 and d['numPassedTests']==691 and d['numPendingTests']==0
(out/'native-finish.json').write_text(json.dumps({'inputs':inputs,'extensionSha256':hashlib.sha256(library.read_bytes()).hexdigest(),'command':args,'passed':691,'skipped':0},indent=2)+'\n')
