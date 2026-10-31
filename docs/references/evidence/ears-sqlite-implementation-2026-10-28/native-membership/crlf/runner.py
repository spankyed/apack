from pathlib import Path
import os,json,hashlib,subprocess,time
r=Path('/metrics');o=Path('/results');builder=r/'native/vectors/build.mjs';rows=[]
env=os.environ|{'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'core.autocrlf','GIT_CONFIG_VALUE_0':'true'}
def run(name,args,extra=None):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=env|(extra or {}),stdout=f,stderr=subprocess.STDOUT,timeout=180)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-6000:]
builder.write_bytes(Path('/before.mjs').read_bytes())
run('legacy-crlf',['node','native/vectors/build.mjs','/metrics/crlf-legacy','/upstream.c'])
legacy=(r/'crlf-legacy/vec1.c').read_bytes();legacySha=hashlib.sha256(legacy).hexdigest()
assert legacySha=='9a3ab41535721647537af740e30dd28e8d2b83aef4e910d944d1b696e74556f8',legacySha
builder.write_bytes(Path('/fixed.mjs').read_bytes())
run('canonical-crlf',['node','native/vectors/build.mjs','/metrics/crlf-fixed','/upstream.c'])
fixed=(r/'crlf-fixed/vec1.c').read_bytes();assert hashlib.sha256(fixed).hexdigest()=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
assert legacy.replace(b'\r\n',b'\n')==fixed
run('canonical-membership',['node','native/vectors/membership-test.mjs','/metrics/crlf-fixed/vec1.so','/results/membership.json'])
v=json.loads((o/'membership.json').read_text());assert v['completed'] and sum(g['checks'] for g in v['groups'])==555
(o/'control.json').write_text(json.dumps({'gitAutocrlf':True,'legacySha256':legacySha,'canonicalSha256':hashlib.sha256(fixed).hexdigest(),'matchesActualWindowsFailure':True,'onlyLineEndingsChanged':True,'membershipChecks':555,'builderSha256':hashlib.sha256(builder.read_bytes()).hexdigest()},indent=2)+'\n')
