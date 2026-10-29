import pathlib,subprocess,shutil,json,time,os
r=pathlib.Path('/probe');r.mkdir();o=pathlib.Path('/results')
(r/'package.json').write_text(json.dumps({'private':True,'dependencies':{'libsql':'0.5.29'}}))
shutil.copy2('/probe-source.mjs',r/'probe.mjs')
shutil.copy2('/pinned-lock.json',r/'package-lock.json')
start=time.monotonic()
with (o/'install.txt').open('w') as f:p=subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
(o/'install.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-start})+'\n');assert p.returncode==0
shutil.copy2(r/'package-lock.json',o/'package-lock.json')
with (o/'run.txt').open('w') as f:p=subprocess.run(['node','probe.mjs'],cwd=r,env=os.environ|{'RUST_BACKTRACE':'1'},stdout=f,stderr=subprocess.STDOUT,timeout=60)
print('probe exit',p.returncode,flush=True)
raise SystemExit(p.returncode)
