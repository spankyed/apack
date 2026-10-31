import pathlib,tarfile,subprocess,json,time,os,hashlib
r=pathlib.Path('/metrics');o=pathlib.Path('/results');records=[]
with tarfile.open('/overlay.tar') as t:t.extractall(r)
inputs=json.loads(pathlib.Path('/inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
(o/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
def run(name,args):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=180)
 records.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(records,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-6000:]
for file in inputs:
 if file.endswith('.mjs'):run('syntax-'+pathlib.Path(file).stem,['node','--check',file])
run('ci-wrapper',['node','.github/scripts/ears-vec1-build.mjs','/metrics/wrapper-native','/upstream.c'])
p=json.loads((r/'wrapper-native/provenance.json').read_text());assert p['patchApplied'] and p['sourceSha256']=='5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b'
assert p['patchSha256']==inputs['native/vectors/vec1-membership.patch']
(o/'provenance.json').write_text(json.dumps(p,indent=2)+'\n')
run('specifiers',['npm','run','check:specifiers'])
