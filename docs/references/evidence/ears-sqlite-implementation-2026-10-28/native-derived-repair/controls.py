from pathlib import Path
import subprocess,os,json,hashlib
r=Path('/metrics');o=Path('/results');m=json.loads(Path('/inputs.json').read_text());rows=[]
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'}
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--reporter=default','--reporter=json','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-audit.spec.ts']
controls=[
('omit-native-repair','database.ts','if(options.repairNative){','if(false&&options.repairNative){','repairs missing-trigger'),
('ignore-native-page-damage','vector-repair.ts',".some(row=>Object.values(row)[0]!=='ok')",'.some(()=>false)','repairs damaged-pages'),
('discard-on-io-error','vector-repair.ts',"if((error as {code?:unknown})?.code==='SQLITE_CORRUPT_VTAB')damaged.add(id);else throw error;","if(['SQLITE_CORRUPT_VTAB','SQLITE_IOERR_READ'].includes(String((error as {code?:unknown})?.code)))damaged.add(id);else throw error;",'does not classify a native integrity I/O'),
('discard-foreign-table','vector-repair.ts','if(entry&&!/^CREATE','if(false&&entry&&!/^CREATE','refuses an unrecognized table')]
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
