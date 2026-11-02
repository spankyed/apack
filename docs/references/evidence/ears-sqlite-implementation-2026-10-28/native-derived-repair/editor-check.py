from pathlib import Path
import subprocess,hashlib,json
r=Path('/metrics');o=Path('/results');name='tests/packs/bundled-ui-pack/tests/e2e/scribbles.spec.ts';(r/name).write_bytes(Path('/scribbles.spec.ts').read_bytes());rows=[]
for label,args in [('bundled-editor-types',['node','node_modules/typescript/bin/tsc','-p','tests/packs/bundled-ui-pack/tsconfig.json','--noEmit']),('bundled-editor-lint',['node','node_modules/oxlint/bin/oxlint',name,'-D','correctness'])]:
 with (o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':label,'exitCode':p.returncode,'args':args});print(label,p.returncode,flush=True);assert p.returncode==0,(o/(label+'.log')).read_text()[-6000:]
(o/'bundled-editor-diagnostics.json').write_text(json.dumps({'file':name,'sha256':hashlib.sha256((r/name).read_bytes()).hexdigest(),'checks':rows,'purpose':'Capture DOM and ProseMirror state on the original failure without changing assertions or timeouts; actual app reproduction remains required'},indent=2)+'\n')
