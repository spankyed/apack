from pathlib import Path
import tarfile,os,subprocess,json,time
r=Path('/metrics');r.mkdir(exist_ok=True);o=Path('/results')
with tarfile.open('/source.tar') as archive:
 source=archive.pax_headers['comment'];archive.extractall(r)
os.environ['EARS_TEST_SOURCE']=source
(r/'node_modules').symlink_to('/seed/node_modules')
limits={name:Path('/sys/fs/cgroup',name).read_text().strip() for name in ('cpu.max','memory.max','memory.swap.max')}
assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
probe=r/'mode-denial';probe.mkdir();probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Mode denial bypassed')
finally:probe.chmod(0o700);probe.rmdir()
records=[]
def run(name,args,timeout=180):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as log:
  try:p=subprocess.run(args,cwd=r,stdout=log,stderr=subprocess.STDOUT,timeout=timeout);code=p.returncode
  except subprocess.TimeoutExpired:code='timeout'
 records.append({'label':name,'args':args,'exitCode':code,'seconds':time.monotonic()-start})
 (o/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(records[-1],flush=True)
 return code
(o/'runtime.json').write_text(json.dumps({'source':source,'limits':limits,'modeDenial':True},indent=2)+'\n')
prefix=r/'ann-deps';prefix.mkdir();(prefix/'package.json').write_text(json.dumps({'name':'ears-private-ann-compat','private':True}))
assert run('install-alpha',['npm','install','--prefix',str(prefix),'--ignore-scripts','--no-audit','--no-fund','--save-exact','sqlite-vec@0.1.10-alpha.4'],120)==0
(o/'private-package-lock.json').write_bytes((prefix/'package-lock.json').read_bytes())
extension=subprocess.check_output(['node','--input-type=commonjs','-e',"console.log(require('node:module').createRequire('/metrics/ann-deps/package.json')('sqlite-vec').getLoadablePath())"],cwd=r,text=True).strip()
assert run('ann-compat',['node','--import','tsx','packages/apack-ears/bench/sqlite/sqlite-vec-ann-compat.mjs',extension,'/results/compat.json'],180)==0
