from pathlib import Path
import subprocess,os,json,hashlib
r=Path('/metrics');o=Path('/results');m=json.loads(Path('/inputs.json').read_text());rows=[]
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'}
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--reporter=default','--reporter=json','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-audit.spec.ts']
controls=[
('ignore-native-owner','vector-audit.ts',' OR a.c0 IS NOT x.owner OR a.c1 IS NOT x.active','','reports owner drift'),
('unclaimed-rebuild','index.ts','await withNativeModelsPaused(database,async () => {','await database.withExclusiveWrites(async () => {','refuses rebuild while an independent'),
('keep-native-epoch','database.ts','      this.invalidateNativeModels();\n      const jobs = this.indexBuilds.jobs();','      const jobs = this.indexBuilds.jobs();','rebuilds offline under the native claim')]
for label,name,before,after,pattern in controls:
 p=r/'packages/apack-ears/src/sqlite'/name;original=p.read_bytes();s=original.decode();assert s.count(before)==1,(label,s.count(before))
 try:
  p.write_text(s.replace(before,after))
  with (o/(label+'-control.log')).open('w') as f:proc=subprocess.run([*base,'-t',pattern,'--outputFile=/results/'+label+'-control.json'],cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=90)
  d=json.loads((o/(label+'-control.json')).read_text());assert proc.returncode!=0 and d['numFailedTests']==1,(label,proc.returncode,d['numFailedTests'])
  rows.append({'control':label,'exitCode':proc.returncode,'failedTests':d['numFailedTests']});print(label,'rejected',flush=True)
 finally:p.write_bytes(original)
for name,h in m.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==h,name
(o/'negative-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
