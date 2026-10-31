from pathlib import Path
import subprocess,json,os,time,hashlib
r=Path('/metrics');o=Path('/results');factory=r/'packages/apack-sdk/src/testing/databases.ts';original=factory.read_bytes();text=original.decode()
control=text.replace("import { createTemporaryDatabases as sqliteDatabases }", "import type { createTemporaryDatabases as sqliteDatabases }").replace("if(backend==='sqlite')return sqliteDatabases();", "if(backend==='sqlite')throw new Error('SQLite disabled only in this scratch import-cost control');")
assert control!=text
rows=[]
try:
 for index,variant in enumerate(['candidate','native-only-control','native-only-control','candidate']):
  factory.write_bytes(original if variant=='candidate' else control.encode())
  name=f'import-probe-{index}-{variant}';out=o/(name+'.json');report=o/(name+'-durations.json')
  args=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/sdk','packages/apack-sdk/tests/content/format-applier.spec.ts','packages/apack-sdk/tests/testing/test-host.spec.ts','--maxWorkers=1','--reporter=default','--reporter=json','--reporter=/metrics/scripts/lib/spec-durations-reporter.ts','--outputFile='+str(out)]
  start=time.monotonic()
  with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_EVALUATION_BACKEND':'elmdb','SPEC_DURATIONS_FILE':str(report)},stdout=f,stderr=subprocess.STDOUT,timeout=90)
  assert p.returncode==0,(o/(name+'.log')).read_text()[-8000:]
  data=json.loads(out.read_text());durations=json.loads(report.read_text());assert data['numFailedTests']==0 and data['numPendingTests']==0 and data['numPassedTests']>51
  rows.append({'variant':variant,'args':args,'seconds':time.monotonic()-start,'testsPassed':data['numPassedTests'],'factorySha256':hashlib.sha256(factory.read_bytes()).hexdigest(),'modules':durations['modules']});(o/'import-probe-summary.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,rows[-1]['seconds'],flush=True)
finally:
 factory.write_bytes(original)
 assert factory.read_bytes()==original
 (o/'import-probe-control.json').write_text(json.dumps({'candidateSha256':hashlib.sha256(original).hexdigest(),'controlSha256':hashlib.sha256(control.encode()).hexdigest(),'controlOnlyChange':'remove SQLite runtime import from test database factory; native selection and selected real tests unchanged; SQLite explicitly refused in control','order':'candidate, control, control, candidate','restored':factory.read_bytes()==original},indent=2)+'\n')
