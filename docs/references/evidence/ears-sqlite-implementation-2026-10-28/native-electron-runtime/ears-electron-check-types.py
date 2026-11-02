from pathlib import Path
import subprocess,tarfile,json,hashlib,os
r=Path('/metrics');o=Path('/results');m=json.loads(Path('/inputs.json').read_text())
with tarfile.open('/overlay.tar') as t:t.extractall(r)
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
checks=[('app-e2e-types',['node','node_modules/typescript/bin/tsc','-p','tests/tsconfig.json','--noEmit']),('bundled-editor-types',['node','node_modules/typescript/bin/tsc','-p','tests/packs/bundled-ui-pack/tsconfig.json','--noEmit']),('changed-lint',['node','node_modules/oxlint/bin/oxlint','build/prod/smoke-native.mjs','tests/e2e/app-integration/sqlite-storage.spec.ts','tests/packs/bundled-ui-pack/tests/e2e/scribbles.spec.ts','-D','correctness'])];rows=[]
for label,args in checks:
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':label,'args':args,'exitCode':p.returncode});print(label,p.returncode,flush=True);assert p.returncode==0,(o/(label+'.log')).read_text()[-7000:]
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
(o/'final-inputs.json').write_text(json.dumps({'base':'3333361c3cfe65ea2eddadf29d3f5c893e132177','inputs':m,'checks':rows},indent=2)+'\n')
