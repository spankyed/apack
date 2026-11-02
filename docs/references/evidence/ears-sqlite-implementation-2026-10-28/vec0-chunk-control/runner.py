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
os.environ['EARS_VECTOR_CACHE_KIB']='65536'
os.environ['EARS_VECTOR_SCRATCH']='/metrics'
for chunk in (64,128,256):
 os.environ['EARS_VEC0_CHUNK_SIZE']=str(chunk)
 label='99900-vec0-binary-256-chunk-'+str(chunk)
 code=run(label,['node','--import','tsx','packages/apack-ears/bench/sqlite/real-vector-vec1.mjs','/unused','/corpus','/truth/truth.json','99900','vec0-binary-256','/results/'+label+'.json'],600)
 if code!=0:
  print((o/(label+'.log')).read_text()[-4000:],flush=True)
  break
