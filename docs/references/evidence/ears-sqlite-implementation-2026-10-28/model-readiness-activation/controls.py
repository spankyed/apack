from pathlib import Path
import subprocess,json
r=Path('/metrics');o=Path('/results')
base=['node','../../scripts/with-source.mjs','node','../../node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','tests/sqlite/vector-models.spec.ts','--maxWorkers=1','--reporter=json']
controls=[('missing-recovery','packages/apack-ears/src/sqlite/index.ts','models.recover(); database.commitWrite();','database.commitWrite();','recovers abandoned attempts only'),('throw-after-commit','packages/apack-ears/src/sqlite/index-builds.ts','catch(error){this.pending=false;this.stop(error);return;}','catch(error){throw error;}','misreport a committed')]
for label,name,before,after,pattern in controls:
 p=r/name;original=p.read_bytes();s=original.decode();assert s.count(before)==1
 try:
  p.write_text(s.replace(before,after))
  with (o/(label+'.log')).open('w') as log:
   result=subprocess.run([*base,'-t',pattern,'--outputFile=/results/'+label+'.json'],cwd=r/'packages/apack-ears',stdout=log,stderr=subprocess.STDOUT,timeout=60)
  d=json.loads((o/(label+'.json')).read_text());assert result.returncode!=0 and d['numFailedTests']==1,(label,result.returncode,d)
  print(label,'rejected as expected',flush=True)
 finally:p.write_bytes(original)
