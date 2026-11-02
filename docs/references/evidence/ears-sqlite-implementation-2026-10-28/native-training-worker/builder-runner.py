from pathlib import Path
import tarfile,os,subprocess,json,time,shutil
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
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Synthetic metadata for exact source archive'],check=True)
assert run('build-extension',['node','.github/scripts/ears-vec1-build.mjs','/metrics/.temp/sqlite-platform/native-generation','/assets/vec1.c'])==0
shutil.copyfile(r/'.temp/sqlite-platform/native-generation/provenance.json',o/'provenance.json')
assert run('syntax-platform',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])==0
(r/'bad.c').write_text('invalid fixture source')
assert run('refuse-source-hash',['node','.github/scripts/ears-vec1-build.mjs','/metrics/.temp/bad-build','/metrics/bad.c'])!=0
assert not (r/'.temp/bad-build/vec1.so').exists()
assert run('native-probe',['node','--input-type=module','-e',"import Database from 'better-sqlite3';const d=new Database(':memory:');d.loadExtension('/metrics/.temp/sqlite-platform/native-generation/vec1.so');console.log(JSON.stringify(d.prepare('SELECT vec1_info() native,sqlite_version() sqlite').get()));d.close();"])==0
