from pathlib import Path
import tarfile,subprocess,shutil,os,json
r=Path('/metrics');r.mkdir();o=Path('/results')
with tarfile.open('/source.tar') as t:t.extractall(r)
subprocess.run(['git','init','-q',str(r)],check=True)
subprocess.run(['git','-C',str(r),'add','-f','.'],check=True)
subprocess.run(['git','-C',str(r),'-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Exact source for report-verifier validation'],check=True)
p=r/'.temp/sqlite-platform';p.mkdir(parents=True)
for name in ['ears.json','host.json','runtime.json']:shutil.copy2(Path('/previous/platform')/name,p/name)
env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_PLATFORM_ARCH':'arm64'}
def run(name,args,negative=False):
 with (o/(name+'.txt')).open('w') as f:process=subprocess.run(args,cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=60)
 print(name,process.returncode,flush=True)
 assert (process.returncode!=0 if negative else process.returncode==0),(o/(name+'.txt')).read_text()[-12000:]
try:
 run('syntax',['node','--check','.github/scripts/ears-sqlite-platform.mjs'])
 run('lint',['node','/seed/node_modules/oxlint/bin/oxlint','.github/scripts/ears-sqlite-platform.mjs','-D','correctness'])
 run('positive-report',['node','.github/scripts/ears-sqlite-platform.mjs','verify'])
 positive=(p/'ears.json').read_bytes()
 try:
  shutil.copy2('/previous/negative-native-selection.json',p/'ears.json')
  run('negative-native-fallback',['node','.github/scripts/ears-sqlite-platform.mjs','verify'],negative=True)
  shutil.copy2(p/'verification.json',o/'negative-verification.json')
 finally:(p/'ears.json').write_bytes(positive)
 run('restored-report',['node','.github/scripts/ears-sqlite-platform.mjs','verify'])
finally:shutil.copytree(p,o/'platform',dirs_exist_ok=True)
