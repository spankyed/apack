from pathlib import Path
import tarfile,shutil,subprocess,time,json,os,hashlib
out=Path('/results');reports=[]
for label in ['old','new']:
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
new=Path('/new/packages/apack-ears/bench/sqlite/text-shape.mjs');old=Path('/old/packages/apack-ears/bench/sqlite/text-shape.mjs');shutil.copyfile(new,old)
(out/'protocol.json').write_text(json.dumps({'order':['old','new','new','old'],'fixtureSha256':hashlib.sha256(new.read_bytes()).hexdigest(),'oldChanges':'only identical new benchmark fixture copied in; production source stays pinned','cpus':2,'memoryGiB':6,'deadlineSeconds':180,'automaticRetries':False},indent=2)+'\n')
for ordinal,label in enumerate(['old','new','new','old'],1):
 prefix=f'{ordinal}-{label}';started=time.monotonic()
 with (out/(prefix+'.stdout')).open('w') as stdout,(out/(prefix+'.stderr')).open('w') as stderr:
  p=subprocess.run(['node','packages/apack-ears/bench/sqlite/text-shape.mjs',str(out/(prefix+'.json'))],cwd='/'+label,stdout=stdout,stderr=stderr,timeout=180)
 assert p.returncode==0,(out/(prefix+'.stderr')).read_text()[-10000:]
 value=json.loads((out/(prefix+'.json')).read_text())
 report={'trial':prefix,'seconds':time.monotonic()-started,'admissionMs':value['admissionMs'],'buildMs':value['buildMs'],'summaries':value['summaries'],'files':value['files']}
 reports.append(report);(out/'results.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(report),flush=True)
