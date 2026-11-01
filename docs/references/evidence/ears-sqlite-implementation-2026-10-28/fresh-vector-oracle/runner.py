import json,os,pathlib,runpy,subprocess,sys,tarfile
out=pathlib.Path('/results')
with tarfile.open('/source.tar') as archive:
 source=archive.pax_headers['comment']
 name='packages/apack-ears/bench/sqlite/real-vector-oracle.py'
 data=archive.extractfile(name).read()
script=pathlib.Path('/tmp/real-vector-oracle.py');script.write_bytes(data)
(out/'source.json').write_text(json.dumps({'source':source,'path':name},indent=2)+'\n')
with (out/'install.log').open('w') as log:
 subprocess.run([sys.executable,'-m','pip','install','--only-binary=:all:','--no-cache-dir','--report','/results/pip-install.json','--target','/tmp/oracle-numpy','numpy==2.5.4'],stdout=log,stderr=subprocess.STDOUT,check=True)
sys.path.insert(0,'/tmp/oracle-numpy')
os.environ['OPENBLAS_NUM_THREADS']='1'
sys.argv=[str(script),'--corpus','/corpus','--output','/results/truth.json','--partition','fresh']
runpy.run_path(str(script),run_name='__main__')
