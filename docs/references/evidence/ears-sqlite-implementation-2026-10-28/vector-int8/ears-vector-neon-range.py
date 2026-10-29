import pathlib,subprocess,json,time,os,shutil
r=pathlib.Path('/probe');o=pathlib.Path('/results')
p=pathlib.Path('/tmp/mode-probe');p.mkdir();(p/'file').write_text('probe');p.chmod(0)
try:
 try:list(p.iterdir())
 except PermissionError:pass
 else:raise AssertionError('mode denial bypassed')
finally:p.chmod(0o700);shutil.rmtree(p)
(o/'preflight.json').write_text(json.dumps({'modeDenial':True,'capEff':next(line.strip() for line in pathlib.Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:'))})+'\n')
results=[]
def run(name,args,limit):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as f:p=subprocess.run(args,cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=limit)
 results.append({'name':name,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results[-1]),flush=True)
 assert p.returncode==0,(o/(name+'.txt')).read_text()[-16000:]
run('lint',['node_modules/.bin/oxlint','vector-quantized.mjs','-D','correctness'],30)
build=pathlib.Path('/optimized');build.mkdir();(build/'plain').mkdir();(build/'neon').mkdir()
with (o/'compiler.txt').open('w') as f:subprocess.run(['cc','--version'],stdout=f,stderr=subprocess.STDOUT,check=True)
import hashlib
native={'sources':{name:hashlib.sha256(pathlib.Path('/amalgamation',name).read_bytes()).hexdigest() for name in ['sqlite-vec.c','sqlite-vec.h']},'builds':{}}
for variant in ['plain','neon']:
 command=['cc','-O3','-fPIC','-shared','-flax-vector-conversions',*(['-DSQLITE_VEC_ENABLE_NEON'] if variant=='neon' else []),'/amalgamation/sqlite-vec.c','-o',str(build/variant/'vec0.so'),'-lm']
 run('compile-'+variant,command,180)
 native['builds'][variant]={'command':command,'sha256':hashlib.sha256((build/variant/'vec0.so').read_bytes()).hexdigest()}
(o/'native.json').write_text(json.dumps(native,indent=2)+'\n')
for variant in ['plain','neon']:
 run('distance-'+variant,['node','/range.mjs',str(build/variant/'vec0.so'),str(o/(variant+'.json'))],30)
