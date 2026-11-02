import subprocess,pathlib,json,time,os,hashlib
r=pathlib.Path('/native');o=pathlib.Path('/results');results=[]
patch=subprocess.check_output(['git','diff','--binary'],cwd=r)
assert hashlib.sha256(patch).hexdigest()=='a6c663442b58e3d04e436ecb485f823813fe4ab8ae6f6d2a23d3e863dc50a91d'
env=os.environ|{'CARGO_BUILD_JOBS':'2','CARGO_TARGET_DIR':'/native/target'}
def run(label,args,limit=1200):
 start=time.monotonic()
 with (o/(label+'.log')).open('w') as f:
  p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 results.append({'label':label,'command':args,'exitCode':p.returncode,'seconds':time.monotonic()-start})
 (o/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(label,p.returncode,flush=True)
 assert p.returncode==0,(o/(label+'.log')).read_text()[-6000:]
run('fmt',['cargo','fmt','--all','--check'],60)
run('clippy',['cargo','clippy','--workspace','--all-targets','--','-D','warnings'])
run('install-nextest',['cargo','install','--locked','cargo-nextest@0.9.148'])
run('nextest',['cargo','nextest','run','--workspace','--profile','ci'])
run('doctests',['cargo','test','--workspace','--doc'])
run('generated',['cargo','xtask','check-generated'])
run('one-lmdb',['cargo','xtask','check-one-lmdb'])
run('npm-ci',['npm','ci'],180)
run('binding-build',['npm','run','build'],240)
run('typecheck',['npm','run','typecheck'],120)
run('binding-tests',['npm','test'],300)
