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
assert run('compile',['cc','-O3','-DNDEBUG','-Werror=implicit-function-declaration','-shared','-fPIC','-I/seed/node_modules/better-sqlite3/deps/sqlite3','/assets/vec1.c','-lm','-o','/metrics/vec1.so'])==0
code=run('owner-scope',['node','--import','tsx','packages/apack-ears/bench/sqlite/vec1-owner-scope.mjs','/metrics/vec1.so','/corpus','/prior/model-99900-ivf-bq.bin','/results/owner-scope.json'],180)
if code!=0:print((o/'owner-scope.log').read_text()[-4000:],flush=True)
