from pathlib import Path
import os,subprocess,json,hashlib
r=Path('/electron');o=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite'};rows=[]
cases=[
 ('atomic-bootstrap','packages/apack-ears/src/sqlite/database.ts',"      if (initializing) this.sql.exec('BEGIN IMMEDIATE');",'', 'rolls back identity and every primary initializer'),
 ('foreign-wal','packages/apack-ears/src/sqlite/database.ts','    if (!this.readOnly && existsSync(file)) inspectExistingDatabase(file);','', 'preserves a foreign committed WAL.*false'),
 ('missing-primary','packages/apack-ears/src/sqlite/format.ts',"  if (present !== primaryTables.length) return refuse('CORRUPT', 'Missing authoritative SQLite storage');",'', 'refuses missing authoritative entities'),
]
for label,name,before,after,pattern in cases:
 p=r/name;original=p.read_text();assert original.count(before)==1
 try:
  p.write_text(original.replace(before,after))
  args=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears','tests/sqlite/database-identity.spec.ts','-t',pattern,'--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/negative-'+label+'.json']
  with(o/('negative-'+label+'.log')).open('w') as f:result=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
  report=json.loads((o/('negative-'+label+'.json')).read_text());failed=[a for t in report['testResults'] for a in t['assertionResults'] if a['status']=='failed']
  assert result.returncode!=0 and len(failed)==1,(label,result.returncode)
  assert all('AssertionError' in '\n'.join(a['failureMessages']) for a in failed),(label,'actual assertion required')
  rows.append({'label':label,'exitCode':result.returncode,'failedCases':[a['fullName'] for a in failed]});print(label,'proved',flush=True)
 finally:p.write_text(original)
 (o/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
