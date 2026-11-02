from pathlib import Path
import tarfile,json,hashlib,subprocess,os
r=Path('/metrics');o=Path('/results')
m=json.loads(Path('/inputs.json').read_text())
for n,h in m.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
with tarfile.open('/final.tar') as t:t.extractall(r)
final=json.loads(Path('/final-inputs.json').read_text())
for n,h in final.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
with (o/'api-normalized-check.log').open('w') as f:p=subprocess.run(['node','node_modules/tsx/dist/cli.mjs','scripts/api-reports.ts','packages/apack-ears'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=120)
assert p.returncode==0,(o/'api-normalized-check.log').read_text()
(o/'final-source.json').write_text(json.dumps({'base':'4903c50a4a39bba91c8dff495d54764e1472ff18','nativePin':'95615ed8d493f9a7c2789eaf1f4c847ae375eb32','validatedRuntimeInputs':m,'finalInputs':final,'normalizedReportCheckExitCode':p.returncode},indent=2)+'\n')
print('Restored runtime inputs and normalized API report verified',flush=True)
