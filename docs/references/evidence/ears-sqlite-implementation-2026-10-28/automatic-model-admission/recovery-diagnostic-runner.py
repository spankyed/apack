from pathlib import Path
import subprocess,json,hashlib,os,time
r=Path('/metrics');o=Path('/results');file=r/'packages/apack-host/tests/backup/recovery-crash.spec.ts';original=file.read_bytes();s=original.decode()
needle="const [action,root,format,boundary]=JSON.parse(process.env.EARS_RECOVERY_PROBE), paths=_appDataPaths(root);";assert needle in s
s=s.replace(needle,needle+"\nconst phase=label=>console.error(JSON.stringify({recoveryPhase:label,action,at:Date.now()}));phase('child-entry');")
s=s.replace(" const pending=listImportRecoveries(root).find(item=>item.status!=='recovered');", " phase('find-recovery');const pending=listImportRecoveries(root).find(item=>item.status!=='recovered');")
s=s.replace("try{result=restoreImportRecovery(target,pending.session)}", "try{phase('restore-start');result=restoreImportRecovery(target,pending.session);phase('restore-complete')}")
s=s.replace(" console.log(JSON.stringify({...inspect(),result,interrupted:", " phase('inspect-start');console.log(JSON.stringify({...inspect(),result,interrupted:")
needle="async function run(action: string, root: string, format: string, boundary: string, killed = false) {";assert needle in s
s=s.replace(needle,needle+'\n  const diagnosticStarted=Date.now();')
needle='  const reason = `${action} (${format}, ${boundary}): ${result.stderr}`;';assert needle in s
s=s.replace(needle,"  console.error(JSON.stringify({recoveryAction:action,format,boundary,started:diagnosticStarted,finished:Date.now(),killed:result.error?.killed??false,stderr:result.stderr}));\n"+needle)
(o/'concurrent-recovery-source.json').write_text(json.dumps({'originalSha256':hashlib.sha256(original).hexdigest(),'diagnosticSha256':hashlib.sha256(s.encode()).hexdigest(),'change':'private stderr timestamps plus forwarding captured child stderr; operations, assertions and 15000ms child deadline unchanged'},indent=2)+'\n')
(o/'concurrent-recovery-diagnostic.spec.ts').write_text(s)
args=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--project','@apackdev/host','packages/apack-host/tests/backup/recovery-crash.spec.ts','packages/apack-host/tests/backup/storage.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/concurrent-recovery.json'];start=time.monotonic()
try:
 file.write_text(s)
 with (o/'concurrent-recovery.log').open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite'},stdout=f,stderr=subprocess.STDOUT,timeout=240)
 (o/'concurrent-recovery-result.json').write_text(json.dumps({'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start},indent=2)+'\n');print('concurrent-recovery',p.returncode,flush=True)
finally:
 file.write_bytes(original)
 (o/'concurrent-recovery-restored.json').write_text(json.dumps({'restored':file.read_bytes()==original,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},indent=2)+'\n')
