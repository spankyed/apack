from pathlib import Path
import subprocess,json,hashlib,shutil,os,time
r=Path('/electron');o=Path('/results');inputs=json.loads((o/'inputs.json').read_text())
for n,h in inputs.items():assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
p=r/'packages/apack-ears/bench/sqlite/current-admission-probe.mjs';shutil.copyfile('/probe.mjs',p)
meta=json.loads((o/'probe-source.json').read_text());assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['probeSha256']
subprocess.run(['node','--check',str(p)],check=True)
limits={name:Path('/sys/fs/cgroup',name).read_text().strip() for name in ['cpu.max','memory.max','memory.swap.max']};assert limits=={'cpu.max':'200000 100000','memory.max':'6442450944','memory.swap.max':'0'}
args=['node','--import','tsx',str(p),'/corpus','/truth/truth.json','99900','/results/current-admission.json','native-diagnose'];env={**os.environ,'EARS_TEST_SOURCE':meta['source'],'EARS_VEC1_EXTENSION':str(r/'packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'),'EARS_CHECKPOINT_PROBE':'auto'}
start=time.time()
with(o/'current-admission.log').open('w') as f:result=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT)
(o/'run.json').write_text(json.dumps({'source':meta['source'],'limits':limits,'args':args,'exitCode':result.returncode,'seconds':time.time()-start,'inputs':inputs},indent=2)+'\n');print('Current admission diagnostic exit',result.returncode,flush=True)
assert result.returncode==0,(o/'current-admission.log').read_text()[-6000:]
d=json.loads((o/'current-admission.json').read_text());assert d['completed'] and d['checkpointProbe']['finalCanonicalRowsVerified']==99900 and d['synchronous']==2
print(json.dumps({'admissionMs':d['modelAdmission']['ms'],'heartbeat':d['modelAdmission']['heartbeatMs']}),flush=True)
