from pathlib import Path
import subprocess,os,json,hashlib
r=Path('/metrics');o=Path('/results');m=json.loads(Path('/inputs.json').read_text())
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
with (o/'ears-types-followup.log').open('w') as f:p=subprocess.run(['npm','run','typecheck','-w','@apackdev/ears'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
assert p.returncode==0,(o/'ears-types-followup.log').read_text()
print('Final native recovery inputs typecheck',flush=True)
d=json.loads((o/'followup-source.json').read_text());d['followupChecks'].append({'label':'ears-types-followup','exitCode':p.returncode,'args':['npm','run','typecheck','-w','@apackdev/ears']});(o/'followup-source.json').write_text(json.dumps(d,indent=2)+'\n')
