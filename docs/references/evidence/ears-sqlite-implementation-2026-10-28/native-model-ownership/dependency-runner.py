from pathlib import Path
import subprocess,json,hashlib,shutil,os
r=Path('/metrics');o=Path('/results');old=(r/'package-lock.json').read_bytes();(o/'previous-package-lock.json').write_bytes(old)
lockOnly=os.environ.get('LOCK_ONLY')=='1'
args=['npm','install','--ignore-scripts','--save-exact','fs-native-extensions@1.5.2','--workspace','@apackdev/ears','--no-audit','--no-fund']
if lockOnly:args.append('--package-lock-only')
with (o/'install.log').open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180,env=os.environ|{'npm_config_update_notifier':'false'})
(o/'install.json').write_text(json.dumps({'lockOnly':lockOnly,'args':args,'exitCode':p.returncode,'previousLockSha256':hashlib.sha256(old).hexdigest()},indent=2)+'\n');assert p.returncode==0,(o/'install.log').read_text()[-6000:]
shutil.copyfile(r/'package-lock.json',o/'package-lock.json');shutil.copyfile(r/'packages/apack-ears/package.json',o/'ears-package.json')
if lockOnly:
 print('Dependency metadata and exact lockfile resolved; no lifecycle scripts or native validation executed.',flush=True);raise SystemExit(0)
probe="""const {createRequire}=require('node:module'),fs=require('node:fs'),crypto=require('node:crypto');const req=createRequire('/metrics/packages/apack-ears/package.json');const api=req('fs-native-extensions');const fd=fs.openSync('/results/lock-probe','a+',0o600),other=fs.openSync('/results/lock-probe','a+');try{if(!api.tryLock(fd)||api.tryLock(other))throw Error('Descriptor locking refused its contract');console.log(JSON.stringify({version:req('fs-native-extensions/package.json').version,binaries:Object.keys(require.cache).filter(p=>p.endsWith('.node')).map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}))}));}finally{fs.closeSync(other);fs.closeSync(fd);} """
with (o/'dependency-probe.json').open('w') as f:subprocess.run(['node','-e',probe],cwd=r,stdout=f,check=True)
print('Pinned dependency installed without lifecycle scripts; independent-descriptor kernel probe passes.',flush=True)
