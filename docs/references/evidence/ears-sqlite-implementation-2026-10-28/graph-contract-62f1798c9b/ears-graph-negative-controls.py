from pathlib import Path
import subprocess,json,os
r=Path('/electron');o=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':str(r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so')};rows=[]
cases=[
 ('cursor-release','packages/apack-ears/src/sqlite/database.ts','      cursor.return?.();','',1,'tests/sqlite/graph-execution.spec.ts','closes an early-return cursor'),
 ('membership-invalidation','packages/apack-ears/src/sqlite/database.ts',"changes.add('membersAny');",'',2,'tests/engine/relations.spec.ts','updates cross-type graph watches'),
 ('path-direction-order','packages/apack-ears/src/sqlite/query.ts',"${both ? 'CASE WHEN r.source=seed.value THEN 0 ELSE 1 END,' : ''}",'',1,'tests/engine/relations.spec.ts','breaks shortest-path ties'),
 ('iterator-explain','packages/apack-ears/src/sqlite/database.ts','      if (trace) this.recordStatement(sql, parameters, count, ms);','',1,'tests/engine/sqlite-operations.spec.ts','bounds explain capture'),
]
for label,name,before,after,count,spec,pattern in cases:
 p=r/name;original=p.read_text();assert original.count(before)==count,(label,original.count(before))
 try:
  p.write_text(original.replace(before,after));args=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-ears',spec,'-t',pattern,'--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/negative-'+label+'.json']
  with(o/('negative-'+label+'.log')).open('w') as f:result=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
  report=json.loads((o/('negative-'+label+'.json')).read_text());failed=[a for t in report['testResults'] for a in t.get('assertionResults',[]) if a['status']=='failed']
  assert result.returncode!=0 and failed and all(pattern in a['fullName'] for a in failed),(label,result.returncode)
  if label == 'cursor-release':
   assert all('busy executing a query' in '\n'.join(a['failureMessages']) and 'Object.explain' in '\n'.join(a['failureMessages']) for a in failed),(label,'must fail during the actual query')
  else:
   assert all('AssertionError' in '\n'.join(a['failureMessages']) for a in failed),(label,'must fail at assertions, not setup')
  rows.append({'control':label,'exitCode':result.returncode,'failedAssertions':[a['fullName'] for a in failed]});print(label,'negative proved',flush=True)
 finally:p.write_text(original)
 (o/'negative-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
