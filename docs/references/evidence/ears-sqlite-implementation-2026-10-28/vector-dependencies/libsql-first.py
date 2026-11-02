import pathlib,subprocess,shutil,json,time
r=pathlib.Path('/probe');r.mkdir();o=pathlib.Path('/results')
(r/'package.json').write_text(json.dumps({'private':True,'dependencies':{'libsql':'0.5.29'}}))
shutil.copy2('/probe-source.mjs',r/'probe.mjs')
start=time.monotonic()
with (o/'install.txt').open('w') as f:p=subprocess.run(['npm','install','--ignore-scripts','--no-audit','--no-fund'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
(o/'install.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-start})+'\n');assert p.returncode==0
shutil.copy2(r/'package-lock.json',o/'package-lock.json')
with (o/'run.txt').open('w') as f:p=subprocess.run(['node','probe.mjs'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=60)
print('probe exit',p.returncode,flush=True)
raise SystemExit(p.returncode)
