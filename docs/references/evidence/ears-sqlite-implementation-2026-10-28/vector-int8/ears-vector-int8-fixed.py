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
for n in [1000,10000,100000]:run('int8-'+str(n),['node','--import','tsx','vector-quantized.mjs',str(n),str(o/(str(n)+'.json'))],600)
