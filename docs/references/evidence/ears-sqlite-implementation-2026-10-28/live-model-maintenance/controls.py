from pathlib import Path
import subprocess,os,json,hashlib
r=Path('/metrics');o=Path('/results');m=json.loads(Path('/inputs.json').read_text())
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'}
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--reporter=default','--reporter=json']
controls=[
('epoch-invalidation','packages/apack-ears/src/sqlite/database.ts','        this.invalidateNativeModels();','        /* negative control: keep obsolete physical models */',1,'@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','rolls back a refused corpus epoch'),
('unknown-commit-cleanup','packages/apack-ears/src/sqlite/database.ts',"    if(!this.opened)fail('CLOSED','The database is closed');\n    if (this.active)","    this.assertOpen();\n    if (this.active)",1,'@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','drains and closes a quarantined'),
('offline-ownership','packages/apack-ears/src/sqlite/index-builds.ts','const release=claimNativeVectorOwner(this.db.path);this.nativeMaintenanceRelease=release;','const release=()=>{};this.nativeMaintenanceRelease=release;',1,'@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','excludes another service during offline'),
('recovery-retention','packages/apack-host/src/backup/index.ts','preserveRollback=true;','preserveRollback=false;',2,'@apackdev/host','packages/apack-host/tests/backup/import-transaction.spec.ts','retains prepared incumbent recovery when background restart')]
rows=[]
for label,name,before,after,count,project,file,pattern in controls:
 p=r/name;original=p.read_bytes();s=original.decode();assert s.count(before)==count,(label,s.count(before))
 try:
  p.write_text(s.replace(before,after))
  with (o/(label+'-control.log')).open('w') as log:proc=subprocess.run([*base,'--project',project,file,'-t',pattern,'--outputFile=/results/'+label+'-control.json'],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90)
  d=json.loads((o/(label+'-control.json')).read_text());assert proc.returncode!=0 and d['numFailedTests']==1,(label,proc.returncode,d['numFailedTests'])
  rows.append({'control':label,'exitCode':proc.returncode,'failedTests':d['numFailedTests']});print(label,'rejected',flush=True)
 finally:p.write_bytes(original)
for name,h in m.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==h,name
(o/'negative-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
