from pathlib import Path
import subprocess,json,hashlib,os
r=Path('/electron');o=Path('/results');p=r/'packages/apack-cli/src/commands/db/destructive.ts';original=p.read_bytes();source=original.decode()
a=source.index('    // The tool\'s write lock does not exclude read-only history tools.');b=source.index("    return '\\nReset.",a)
old='''    db.admin.clear();
    if (hasHistory) fs.rmSync(db.paths.runHistory, { recursive: true, force: true });
    if (!keepKeys) secrets.clearAll();
'''
try:
 p.write_text(source[:a]+old+source[b:])
 args=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-cli','tests/commands/sqlite-profile.spec.ts','-t','refuses reset before changing SQLite primary data','--maxWorkers','1','--minWorkers','1','--reporter=default','--reporter=json','--outputFile=/results/negative-reset.json']
 with(o/'negative-reset.log').open('w') as f:result=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=120)
 d=json.loads((o/'negative-reset.json').read_text());assert result.returncode!=0 and d['numFailedTests']==2,(result.returncode,d['numFailedTests'])
 cases=[c for t in d['testResults'] for c in t['assertionResults'] if c['status']=='failed'];assert all(any('promise resolved' in m for m in c['failureMessages']) for c in cases),[(c['fullName'],c['failureMessages']) for c in cases]
 (o/'negative-control.json').write_text(json.dumps({'originalSha256':hashlib.sha256(original).hexdigest(),'exitCode':result.returncode,'failedCases':[c['fullName'] for c in cases],'reason':'Without exclusion, reset incorrectly resolves while history handles remain open'},indent=2)+'\n')
finally:p.write_bytes(original)
assert hashlib.sha256(p.read_bytes()).hexdigest()==hashlib.sha256(original).hexdigest()
print('Restored reset source after both actual SQLite held-handle guards failed as intended',flush=True)
