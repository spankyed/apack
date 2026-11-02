from pathlib import Path
import tarfile,os,subprocess,json,time,hashlib
r=Path('/metrics');r.mkdir();o=Path('/results')
with tarfile.open('/source.tar') as archive:
 source=archive.pax_headers['comment'];archive.extractall(r)
os.environ['EARS_TEST_SOURCE']=source
(r/'node_modules').symlink_to('/seed/node_modules')
probe=r/'mode-denial';probe.mkdir();probe.chmod(0)
try:
 try:list(probe.iterdir())
 except PermissionError:pass
 else:raise AssertionError('Mode denial bypassed')
finally:probe.chmod(0o700);probe.rmdir()
records=[]
def run(name,args):
 start=time.monotonic()
 with (o/(name+'.log')).open('w') as log:p=subprocess.run(args,cwd=r,stdout=log,stderr=subprocess.STDOUT,timeout=180)
 records.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(records[-1],flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-12000:]
(o/'source.json').write_text(json.dumps({'source':source,'upstream':json.loads(Path('/assets/vec1-source.json').read_text()),'cpuMax':Path('/sys/fs/cgroup/cpu.max').read_text().strip(),'memoryMax':Path('/sys/fs/cgroup/memory.max').read_text().strip(),'swapMax':Path('/sys/fs/cgroup/memory.swap.max').read_text().strip(),'modeDenial':True},indent=2)+'\n')
run('compile',['cc','-O3','-DNDEBUG','-Werror=implicit-function-declaration','-shared','-fPIC','-I/seed/node_modules/better-sqlite3/deps/sqlite3','/assets/vec1.c','-lm','-o','/metrics/vec1.so'])
run('compat',['node','--import','tsx','packages/apack-ears/bench/sqlite/vec1-compat.mjs','/metrics/vec1.so','/assets/vec1-source.json','/results/compat.json'])
