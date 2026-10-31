from pathlib import Path
import tarfile,shutil,subprocess,time,json,os,hashlib
out=Path('/results');reports=[]
for label in ['sequence','recency']:
 root=Path('/'+label);root.mkdir()
 with tarfile.open('/'+label+'.tar') as t:t.extractall(root)
 shutil.copytree('/seed/node_modules',root/'node_modules',symlinks=True)
 for p in Path('/seed/packages').glob('*/node_modules'):
  d=root/'packages'/p.parent.name/'node_modules'
  if d.parent.exists():shutil.copytree(p,d,symlinks=True)
 for p,destination in [(root/'vendor/elmdb','/engine'),(root/'node_modules/elmdb','/engine/crates/elmdb-node')]:
  if p.is_symlink():p.unlink()
  elif p.exists():shutil.rmtree(p)
  p.symlink_to(destination)
 lock=(root/'package-lock.json').read_bytes()
 for name,args in [('dependencies',['npm','install','--ignore-scripts','--no-audit','--no-fund']),('build',['npm','run','build:package','-w','@apackdev/ears'])]:
  with (out/(label+'-'+name+'.txt')).open('w') as f:p=subprocess.run(args,cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=180)
  assert p.returncode==0,(out/(label+'-'+name+'.txt')).read_text()[-10000:]
 assert (root/'package-lock.json').read_bytes()==lock
fixture=Path('/recency/packages/apack-ears/bench/sqlite/text-shape.mjs')
for label in ['sequence']:shutil.copyfile(fixture,Path('/'+label+'/packages/apack-ears/bench/sqlite/text-shape.mjs'))
for name,args in [('benchmark-syntax',['node','--check','packages/apack-ears/bench/sqlite/text-shape.mjs']),('lint',['npm','run','lint:check'])]:
 with (out/(name+'.txt')).open('w') as f:p=subprocess.run(args,cwd='/recency',stdout=f,stderr=subprocess.STDOUT,timeout=180)
 assert p.returncode==0,(out/(name+'.txt')).read_text()[-10000:]
(out/'protocol.json').write_text(json.dumps({'order':['sequence','recency','recency','sequence'],'fixtureSha256':hashlib.sha256(fixture.read_bytes()).hexdigest(),'controlChanges':'only identical new benchmark fixture copied in; implementation source stays pinned','cpus':2,'memoryGiB':6,'deadlineSeconds':180,'automaticRetries':False},indent=2)+'\n')
for ordinal,label in enumerate(['sequence','recency','recency','sequence'],1):
 prefix=f'{ordinal}-{label}';started=time.monotonic()
 with (out/(prefix+'.stdout')).open('w') as stdout,(out/(prefix+'.stderr')).open('w') as stderr:
  p=subprocess.run(['node','packages/apack-ears/bench/sqlite/text-shape.mjs',str(out/(prefix+'.json'))],cwd='/'+label,stdout=stdout,stderr=stderr,timeout=180)
 assert p.returncode==0,(out/(prefix+'.stderr')).read_text()[-10000:]
 value=json.loads((out/(prefix+'.json')).read_text())
 report={'trial':prefix,'seconds':time.monotonic()-started,'admissionMs':value['admissionMs'],'buildMs':value['buildMs'],'summaries':value['summaries'],'files':value['files']}
 reports.append(report);(out/'results.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(report),flush=True)

# Prove a premature base-score prefix is incorrect; this control runs only after all timed processes.
p=Path('/recency/packages/apack-ears/src/sqlite/text.ts');original=p.read_text()
try:
 old='FROM accepted a LEFT JOIN';assert old in original
 p.write_text(original.replace(old,'FROM (SELECT * FROM accepted ORDER BY score DESC,seq LIMIT 1) a LEFT JOIN',1))
 with (out/'negative-premature-recency-prefix.txt').open('w') as f:
  ptest=subprocess.run(['npm','test','-w','@apackdev/ears','--','tests/sqlite/text-limits.spec.ts','-t','sees recency writes'],cwd='/recency',env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite'},stdout=f,stderr=subprocess.STDOUT,timeout=180)
 assert ptest.returncode!=0
 failure=(out/'negative-premature-recency-prefix.txt').read_text();assert 'Row-0' in failure and 'Row-15' in failure,failure[-10000:]
 print('Premature-prefix control fails on the wrong winner as expected',flush=True)
finally:p.write_text(original)
