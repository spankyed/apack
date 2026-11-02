from pathlib import Path
import tarfile,shutil,subprocess,time,json,os,hashlib
out=Path('/results');reports=[]
for label in ['bounded']:
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


fixture=Path('/fixture.mjs');shutil.copyfile(fixture,Path('/bounded/packages/apack-ears/bench/sqlite/text-typo-cost.mjs'))
for name,args in [('syntax',['node','--check','packages/apack-ears/bench/sqlite/text-typo-cost.mjs']),('lint',['node','node_modules/oxlint/bin/oxlint','packages/apack-ears/bench/sqlite/text-typo-cost.mjs','-D','correctness'])]:
 with (out/(name+'.txt')).open('w') as f:p=subprocess.run(args,cwd='/bounded',stdout=f,stderr=subprocess.STDOUT,timeout=60)
 assert p.returncode==0,(out/(name+'.txt')).read_text()
with (out/'diagnostic.stdout').open('w') as stdout,(out/'diagnostic.stderr').open('w') as stderr:
 p=subprocess.run(['node','packages/apack-ears/bench/sqlite/text-typo-cost.mjs','/results/diagnostic.json'],cwd='/bounded',env=os.environ|{'NODE_OPTIONS':'','EARS_COST_SOURCE':'9beb23ebc9'},stdout=stdout,stderr=stderr,timeout=180)
assert p.returncode==0,(out/'diagnostic.stderr').read_text()[-10000:]
value=json.loads((out/'diagnostic.json').read_text());assert 'failure' not in value,value.get('failure')
print('Native MATCH counterfactual completed, exact native rows/scores preserved',flush=True)
