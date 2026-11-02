from pathlib import Path
import subprocess,json,hashlib
r=Path('/electron');o=Path('/results');rows=[]
def run(label,args,negative=False):
 with(o/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':label,'args':args,'exitCode':p.returncode,'negative':negative});print(label,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(label+'.log')).read_text()[-7000:]
if not (r/'.git').exists():
 subprocess.run(['git','init','-q'],cwd=r,check=True)
 paths=[n for n in Path('/tracked-files').read_text().split('\0') if n and (r/n).exists()]
 for start in range(0,len(paths),200):subprocess.run(['git','add','--',*paths[start:start+200]],cwd=r,check=True)
subprocess.run(['git','add','packages/repo-checks/tests/native-signing.spec.ts','build/prod/sign-mac.mjs'],cwd=r,check=True)
base=['node','node_modules/vitest/vitest.mjs','run','--root','packages/repo-checks','--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json']
run('old-placement',base+['tests/repo-check-boundary.spec.ts','--outputFile=/results/old-placement.json'],True)
d=json.loads((o/'old-placement.json').read_text());assert d['numFailedTests']>0;failed=[a for t in d['testResults'] for a in t['assertionResults'] if a['status']=='failed'];assert any(a['fullName'].endswith('holds nothing else') for a in failed) and 'native-signing.spec.ts' in (o/'old-placement.log').read_text()
subprocess.run(['tar','--no-same-owner','-xf','/routing.tar','-C',str(r)],check=True)
(r/'build/prod/sign-mac.mjs').unlink()
subprocess.run(['git','add','scripts/lib/native-signing.mjs','build/prod/sign-mac.mjs','electron-builder.mjs','packages/repo-checks/tests/native-signing.spec.ts','.github/workflows/app-acceptance.yml'],cwd=r,check=True)
run('routed-tests',base+['tests/repo-check-boundary.spec.ts','tests/native-signing.spec.ts','tests/preview-build.spec.ts','--outputFile=/results/routed-tests.json'])
run('routed-types',['node','node_modules/typescript/bin/tsc','-p','packages/repo-checks','--noEmit'])
run('routed-lint',['node','node_modules/oxlint/bin/oxlint','scripts/lib/native-signing.mjs','packages/repo-checks/tests/native-signing.spec.ts','-D','correctness'])
run('routed-workflow',['node','.temp/signing-workflow-check.cjs'])
files=['scripts/lib/native-signing.mjs','electron-builder.mjs','packages/repo-checks/tests/native-signing.spec.ts','.github/workflows/app-acceptance.yml']
(o/'routing-checks.json').write_text(json.dumps({'base':'2558de0d9d8910c611fcaa179c5dadf666b4fbff','inputs':{n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in files},'checks':rows},indent=2)+'\n')
