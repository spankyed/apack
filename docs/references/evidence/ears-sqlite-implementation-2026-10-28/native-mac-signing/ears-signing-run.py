from pathlib import Path
import subprocess,tarfile,json,hashlib
r=Path('/electron');out=Path('/results')
subprocess.run(['tar','--no-same-owner','-xf','/overlay.tar','-C',str(r)],check=True)
checks=[]
def run(label,args,negative=False):
 with (out/(label+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 checks.append({'label':label,'args':args,'exitCode':p.returncode,'negative':negative})
 print(label,p.returncode,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(out/(label+'.log')).read_text()[-5000:]
test=['node','node_modules/vitest/vitest.mjs','run','--root','packages/repo-checks','tests/native-signing.spec.ts','tests/preview-build.spec.ts','--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/tests.json']
run('tests',test)
run('types',['node','node_modules/typescript/bin/tsc','-p','packages/repo-checks','--noEmit'])
run('lint',['node','node_modules/oxlint/bin/oxlint','build/prod/sign-mac.mjs','packages/repo-checks/tests/native-signing.spec.ts','scripts/build-preview.ts','-D','correctness'])
run('workflow',['node','.temp/signing-workflow-check.cjs'])
run('shell-syntax',['bash','-n','build/build.sh'])
f=r/'build/prod/sign-mac.mjs';original=f.read_text()
for label,before,after in [('omit-manifest-publication','fs.writeFileSync(manifestFile, expectedManifest);','void 0;'),('omit-inner-signature-verification',"execFileSync('/usr/bin/codesign', ['--verify', '--strict', library], { stdio: 'pipe' });",'void 0;'),('allow-skipped-library',"if (!signedLibrary) throw new Error('Signer skipped the native vector library before sealing the app');",'void signedLibrary;')]:
 assert before in original
 try:
  f.write_text(original.replace(before,after))
  control=[arg if not arg.startswith('--outputFile=') else '--outputFile=/results/'+label+'.json' for arg in test]
  run(label,control,True)
  report=json.loads((out/(label+'.json')).read_text())
  assert report['numFailedTests']>0 and report['numTotalTests']==12,report
  failed=[a['fullName'] for result in report['testResults'] for a in result['assertionResults'] if a['status']=='failed']
  assert failed,report
  checks[-1]['failedAssertions']=failed
 finally:f.write_text(original)
files=['.github/workflows/app-acceptance.yml','build/prod/sign-mac.mjs','electron-builder.mjs','scripts/build-preview.ts','build/build.sh','packages/repo-checks/tests/native-signing.spec.ts']
inputs={n:hashlib.sha256((Path('/workflow.yml') if n.startswith('.github') else r/n).read_bytes()).hexdigest() for n in files}
(out/'checks.json').write_text(json.dumps({'base':'ff16d3b9467ee3f0c115ac3bc60d1798651d7c31','inputs':inputs,'checks':checks},indent=2)+'\n')
