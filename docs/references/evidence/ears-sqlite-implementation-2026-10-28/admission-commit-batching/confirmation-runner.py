from pathlib import Path
import subprocess,hashlib,json,os,time
r=Path('/metrics');o=Path('/results');index=r/'packages/apack-ears/src/sqlite/vector-index.ts';models=r/'packages/apack-ears/src/sqlite/vector-models.ts'
fixed={index:index.read_bytes(),models:models.read_bytes()};inputs=json.loads((o/'slice-inputs.json').read_text())
for p,b in fixed.items():assert hashlib.sha256(b).hexdigest()==inputs[str(p.relative_to(r))]
rows=[]
try:
 for variant in ['sliced-confirm','baseline-confirm']:
  if variant=='baseline-confirm':index.write_bytes(Path('/before-index.ts').read_bytes());models.write_bytes(Path('/before-models.ts').read_bytes())
  args=['node','--import','tsx','packages/apack-ears/bench/sqlite/checkpoint-admission-probe.mjs','/corpus','/truth/truth.json','99900','/results/'+variant+'.json','native-diagnose'];start=time.monotonic()
  hashes={str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixed}
  with (o/(variant+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_TEST_SOURCE':'2d0a0e7d4885b47c3d330870e75ff74666f81fdd','EARS_VEC1_EXTENSION':'/metrics/patched/vec1.so','EARS_CHECKPOINT_PROBE':'auto'},stdout=f,stderr=subprocess.STDOUT,timeout=480)
  rows.append({'label':variant,'args':args,'sourceOverlay':hashes,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'confirmation-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(variant,p.returncode,flush=True)
  assert p.returncode==0,(o/(variant+'.log')).read_text()[-8000:]
  report=json.loads((o/(variant+'.json')).read_text());assert report['completed'] and report['synchronous']==2 and report['checkpointProbe']['admissionAutoThreshold']==1000 and report['checkpointProbe']['finalCanonicalRowsVerified']==99900
finally:
 for p,b in fixed.items():p.write_bytes(b)
 (o/'confirmation-restored.json').write_text(json.dumps({str(p.relative_to(r)):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixed},indent=2)+'\n')
