from pathlib import Path
import subprocess,json,tarfile,hashlib,os,time
r=Path('/metrics');o=Path('/results')
with tarfile.open('/overlay.tar') as t:t.extractall(r)
env=os.environ.copy();env.pop('EARS_TEST_SOURCE',None);start=time.monotonic()
args=['node','native/vectors/membership-test.mjs','/metrics/wrapper-native/vec1.so','/results/membership.json']
with (o/'check.log').open('w') as f:p=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
assert p.returncode==0,(o/'check.log').read_text()
v=json.loads((o/'membership.json').read_text());assert v['source']==subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip()
assert v['extensionSha256']==hashlib.sha256((r/'wrapper-native/vec1.so').read_bytes()).hexdigest()
assert v['completed'] and sum(g['checks'] for g in v['groups'])==555
(o/'result.json').write_text(json.dumps({'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start,'sourceDefaultVerified':True,'actualLoadedArtifactHashVerified':True,'testSourceSha256':hashlib.sha256((r/'native/vectors/membership-test.mjs').read_bytes()).hexdigest()},indent=2)+'\n')
print('All 555 comparisons pass; default Git source and actual binary hash match',flush=True)
