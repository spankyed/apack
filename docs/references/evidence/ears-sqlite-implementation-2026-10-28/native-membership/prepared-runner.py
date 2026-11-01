from pathlib import Path
import subprocess,json,time
r=Path('/metrics');o=Path('/results');rows=[]
for label,args in [('packages-build',['npm','run','packages:build']),('specifiers',['npm','run','check:specifiers'])]:
 start=time.monotonic()
 with (o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-6000:]
