from pathlib import Path
import subprocess,json,hashlib,os
r=Path('/electron');out=Path('/results');env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite'};rows=[]
inputs=json.loads(Path('/inputs.json').read_text())
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
controls=[
 ('unclaimed-writable','packages/apack-host/src/database/recovery-lock.ts','export function openProfileDatabase(databasePath: string, readOnly: boolean | undefined, open: () => EarsDatabase): EarsDatabase {','export function openProfileDatabase(databasePath: string, readOnly: boolean | undefined, open: () => EarsDatabase): EarsDatabase {\n  if (!readOnly) return open();','excludes writable'),
 ('quarantine-without-exclusion','packages/apack-host/src/database/open.ts',"const exclusion = holdRecoveryExclusion(dir, 'store');",'const exclusion = { release() {} };','history quarantine'),
 ('io-classified-unreadable','packages/apack-host/src/database/storage.ts',"unreadableOpen('SQLITE_NOTADB', 'SQLITE_CORRUPT')","unreadableOpen('SQLITE_NOTADB', 'SQLITE_CORRUPT', 'SQLITE_IOERR_READ')",'never treats SQLITE_IOERR_READ'),
 ('forget-uncertain-open','packages/apack-host/src/database/recovery-lock.ts','if (!(error as { databaseConnectionUnclosed?: boolean })?.databaseConnectionUnclosed) release();','release();','retains the directory claim when a failed SQLite constructor'),
 ('ignore-directory-identity','packages/apack-host/src/database/recovery-lock.ts','claim.directory === target || ','','excludes physical directory identity'),
 ('quarantine-stale-incumbent','packages/apack-host/src/database/open.ts','if (!incumbent || directoryIdentity(dir) !== incumbent)','if (false)','refuses stale'),
 ('omit-native-close-uncertainty','packages/apack-ears/src/sqlite/database.ts',', databaseConnectionUnclosed: true','','retains the directory claim when a failed SQLite constructor'),
]
for label,name,before,after,pattern in controls:
 f=r/name;original=f.read_text();assert before in original,(label,before)
 args=['node','node_modules/vitest/vitest.mjs','run','--root','packages/apack-host','tests/backup/recovery.spec.ts','tests/database/storage.spec.ts','--maxWorkers','1','--minWorkers','1','-t',pattern,'--reporter=default','--reporter=json','--outputFile=/results/'+label+'.json']
 try:
  f.write_text(original.replace(before,after,1))
  with (out/(label+'.log')).open('w') as log:p=subprocess.run(args,cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
  assert p.returncode!=0,(label,'Reverted safeguard passed')
  report=json.loads((out/(label+'.json')).read_text());assert report['numFailedTests']>0
  failed=[a['fullName'] for t in report['testResults'] for a in t['assertionResults'] if a['status']=='failed'];assert failed and all(pattern in n for n in failed),(label,failed)
  rows.append({'label':label,'path':name,'exitCode':p.returncode,'failedAssertions':failed});print(label,len(failed),'failed assertions',flush=True)
 finally:f.write_text(original)
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
(out/'controls.json').write_text(json.dumps({'base':'098d479157aaf9c7cfa363f01a8a8a371c1473d5','inputs':inputs,'controls':rows},indent=2)+'\n')
