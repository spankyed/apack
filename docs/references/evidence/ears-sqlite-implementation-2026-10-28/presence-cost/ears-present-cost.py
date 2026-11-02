from pathlib import Path
import tarfile,shutil,subprocess,time,json,os,hashlib
out=Path('/results');reports=[]
for label in ['scan','presence','unpruned']:
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

fixture=Path('/fixture.mjs')
for label in ['scan','presence','unpruned']:shutil.copyfile(fixture,Path('/'+label+'/packages/apack-ears/bench/sqlite/text-typo-cost.mjs'))
(out/'protocol.json').write_text(json.dumps({'order':['scan','presence','unpruned','unpruned','presence','scan'],'fixtureSha256':hashlib.sha256(fixture.read_bytes()).hexdigest(),'controlChanges':'only identical benchmark fixture copied in; implementation source stays pinned','cpus':2,'memoryGiB':6,'deadlineSeconds':180,'automaticRetries':False},indent=2)+'\n')
for name,args in [('syntax',['node','--check','packages/apack-ears/bench/sqlite/text-typo-cost.mjs']),('lint',['node','node_modules/oxlint/bin/oxlint','packages/apack-ears/bench/sqlite/text-typo-cost.mjs','-D','correctness'])]:
 with (out/(name+'.txt')).open('w') as f:p=subprocess.run(args,cwd='/presence',stdout=f,stderr=subprocess.STDOUT,timeout=60)
 assert p.returncode==0,(out/(name+'.txt')).read_text()
for ordinal,label in enumerate(['scan','presence','unpruned','unpruned','presence','scan'],1):
 prefix=f'{ordinal}-{label}';started=time.monotonic()
 with (out/(prefix+'.stdout')).open('w') as stdout,(out/(prefix+'.stderr')).open('w') as stderr:
  p=subprocess.run(['node','packages/apack-ears/bench/sqlite/text-typo-cost.mjs',str(out/(prefix+'.json'))],cwd='/'+label,env=os.environ|{'NODE_OPTIONS':'','EARS_COST_SOURCE':label},stdout=stdout,stderr=stderr,timeout=180)
 assert p.returncode==0,(out/(prefix+'.stderr')).read_text()[-10000:]
 value=json.loads((out/(prefix+'.json')).read_text());assert 'failure' not in value,value.get('failure')
 report={'trial':prefix,'seconds':time.monotonic()-started,'profiles':[{'n':profile['n'],'readyMs':profile['readyMs'],'queries':{name:{'firstInvocationMs':query['firstInvocationMs'],'summary':query['summary']} for name,query in profile['queries'].items()}} for profile in value['profiles']]}
 reports.append(report);(out/'results.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps({'trial':prefix,'seconds':report['seconds'],'sizes':[p['n'] for p in report['profiles']]}),flush=True)
