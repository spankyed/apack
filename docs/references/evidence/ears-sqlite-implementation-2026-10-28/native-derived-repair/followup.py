from pathlib import Path
import tarfile,json,hashlib,subprocess,os
r=Path('/metrics');o=Path('/results');before=json.loads(Path('/inputs.json').read_text());after=json.loads(Path('/after.json').read_text())
for n,h in before.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
with tarfile.open('/followup.tar') as t:t.extractall(r)
for n,h in after.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'}
checks=[('all-native-recovery',['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--reporter=default','--reporter=json','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-audit.spec.ts','--outputFile=/results/all-native-recovery.json']),('ears-types-followup',['npm','run','typecheck','-w','@apackdev/ears']),('api-normalized-check',['node','node_modules/tsx/dist/cli.mjs','scripts/api-reports.ts','packages/apack-ears'])]
rows=[]
for label,args in checks:
 with (o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':label,'exitCode':p.returncode,'args':args});print(label,p.returncode,flush=True);assert p.returncode==0,(o/(label+'.log')).read_text()[-6000:]
d=json.loads((o/'all-native-recovery.json').read_text());assert(d['numPassedTests'],d['numFailedTests'],d['numPendingTests'])==(25,0,0)
for n,h in after.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
(o/'followup-source.json').write_text(json.dumps({'base':'212b819db6f505a87e44cc93cb3d3d0967c424e8','nativePin':'95615ed8d493f9a7c2789eaf1f4c847ae375eb32','broadValidatedInputs':before,'finalInputs':after,'followupChecks':rows},indent=2)+'\n')
