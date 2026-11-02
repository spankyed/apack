from pathlib import Path
import subprocess,tempfile,os,json,time,hashlib,shutil
r=Path('/electron');o=Path('/results');s=Path('/smoke-native.mjs').read_text()
probe=s.split('const PROBE = String.raw`',1)[1].split('`;\n\nconst executable',1)[0]
header=probe.split('async function main()',1)[0]
start=probe.index("  const earsEntry = load.resolve('@apackdev/ears/sqlite');")
end=probe.index("  const pty = load('node-pty');",start)
section=probe[start:end]
report="console.log('RUNTIME_PROVENANCE '+JSON.stringify({versions:process.versions,addons:Object.keys(require.cache).filter(p=>p.endsWith('.node')).map(p=>({file:p,sha256:require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(p)).digest('hex')}))}));"
body=header+'async function main(){\n'+section+'\n'+report+'\n}\nmain().catch(error=>{console.error(error);process.exit(1)});\n'
file=r/'.temp/packaged-sqlite-probe.cjs';file.parent.mkdir(parents=True,exist_ok=True);file.write_text(body)
rows=[]
for label,exe,source,negative in [('node-sqlite-smoke','node',body,False),('electron-sqlite-smoke','/electron/node_modules/electron/dist/electron',body,False),('missing-model-owner','/electron/node_modules/electron/dist/electron',body.replace('    await startVectorModels(sqlite);','    /* reverted ownership start */'),True),('outside-app-dependency','/electron/node_modules/electron/dist/electron',body.replace("insideApp(earsEntry);","insideApp('/usr/local/bin/node');"),True)]:
 file.write_text(source);temp=Path(tempfile.mkdtemp(prefix='ears-packaged-smoke-'));env=os.environ|{'ELECTRON_RUN_AS_NODE':'1'};at=time.monotonic()
 try:
  with(o/(label+'.log')).open('w') as log:p=subprocess.run([exe,str(file),str(r),str(temp)],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=60)
 finally:shutil.rmtree(temp)
 log=(o/(label+'.log')).read_text();assert (p.returncode!=0 and ('outside the app' if label=='outside-app-dependency' else 'BACKGROUND_OWNER_REQUIRED') in log if negative else p.returncode==0),(label,log[-8000:])
 entry={'label':label,'exitCode':p.returncode,'seconds':time.monotonic()-at,'negative':negative}
 if not negative:entry['runtime']=json.loads(next(line.removeprefix('RUNTIME_PROVENANCE ') for line in log.splitlines() if line.startswith('RUNTIME_PROVENANCE ')))
 rows.append(entry);print(label,p.returncode,flush=True)
file.write_text(body)
(o/'smoke-section.json').write_text(json.dumps({'source':'3333361c3c + changed packaged-smoke SQLite section','smokeFileSha256':hashlib.sha256(Path('/smoke-native.mjs').read_bytes()).hexdigest(),'qualification':'Actual smoke SQLite section including FTS/regex/worker/native ownership/reopen; not a complete installer/signing test','checks':rows},indent=2)+'\n')
assert sorted(rows[0]['runtime']['addons'],key=lambda x:x['file'])==sorted(rows[1]['runtime']['addons'],key=lambda x:x['file']),'Different native addon bytes were loaded'
