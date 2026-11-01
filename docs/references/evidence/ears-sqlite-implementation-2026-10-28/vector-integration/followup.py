from pathlib import Path
import subprocess,os,json,time,hashlib
r=Path('/metrics');o=Path('/results');os.chdir(r)
source='de48f5a9242a1b64592a4cc9f173e5e73e2d5ee2'
hashes={'packages/apack-ears/src/sqlite/vectors.ts': '8b09ffc049d8ab9f9b9565a270e26572f28c69839eec563a70d52cc38acf7ac2', 'packages/apack-ears/tests/sqlite/vector-execution.spec.ts': '50a9fb3c533c3fac1c1ac17b04b8aff8d1fc28cd91ae29761e590d896dfc9f94'}
for path,expected in hashes.items():assert hashlib.sha256((r/path).read_bytes()).hexdigest()==expected
subprocess.run(['git','add',*hashes],check=True)
subprocess.run(['git','-c','user.name=SQLite diagnostic','-c','user.email=diagnostic@localhost','commit','-qm','Committed source correction after diagnosed plain Node failure'],check=True)
(o/'source-correction.json').write_text(json.dumps({'source':source,'from':'6822956968','changedFilesSha256':hashes,'scope':'Only two tracked source corrections; previous source-node failure retained; all other runtime/build inputs unchanged'},indent=2)+'\n')
os.environ['EARS_TEST_SOURCE']=source;os.environ['EARS_EVALUATION_BACKEND']='sqlite'
results=[]
def check(name,args,negative=False):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=240)
 rec={'label':name,'args':args,'exitCode':p.returncode,'expectedFailure':negative,'seconds':time.monotonic()-start,'source':source}
 results.append(rec);(o/'correction-results.json').write_text(json.dumps(results,indent=2)+'\n');print(rec,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-12000:]
 return (o/(name+'.txt')).read_text()
base=['npm','test','-w','@apackdev/ears','--']
check('corrected-types',['npm','run','typecheck','-w','@apackdev/ears'])
check('corrected-source-vector',base+['tests/sqlite/source-node.spec.ts','tests/sqlite/vector-execution.spec.ts','--maxWorkers=2'])
mutations=[('candidate-prefix','packages/apack-ears/src/sqlite/vectors.ts','if (count <= 4096) return exact();','if (true) return exact();','bounds exact reranking'),
 ('safe-directions','packages/apack-ears/src/sqlite/vectors.ts','const safe = value.squared < 1e-20 || value.squared > 1e20 ? value.bytes : null;','const safe = null;','keeps finite cosine'),
 ('projection-rebuild','packages/apack-ears/src/sqlite/database.ts',"this.sql.exec('DELETE FROM embedding_search');",'/* mutation: retain corrupt derived projections */','audits missing or corrupt')]
for name,file,before,after,test in mutations:
 path=r/file;original=path.read_bytes();assert original.count(before.encode())==1
 try:
  path.write_bytes(original.replace(before.encode(),after.encode()))
  log=check('mutation-'+name,base+['tests/sqlite/vector-execution.spec.ts','-t',test,'--maxWorkers=1'],True)
  assert 'AssertionError' in log and test in log
 finally:path.write_bytes(original)
 assert hashlib.sha256(path.read_bytes()).hexdigest()==hashlib.sha256(original).hexdigest()
subprocess.run(['git','diff','--exit-code'],check=True)
check('corrected-ear-build',['npm','run','build:package','-w','@apackdev/ears'])
check('corrected-api',['npm','run','api:check','-w','@apackdev/ears'])
check('corrected-lint',['npm','run','lint:check'])
check('corrected-specifiers',['npm','run','check:specifiers'])
check('corrected-ears-all',base+['--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/corrected-ears.json'])
check('corrected-host-storage',['npm','test','-w','@apackdev/host','--','tests/backup/recovery.spec.ts','tests/backup/recovery-crash.spec.ts','tests/backup/import.spec.ts','tests/backup/import-transaction.spec.ts','tests/backup/logical.spec.ts','tests/backup/logical-crash.spec.ts','tests/backup/storage.spec.ts','tests/database/storage.spec.ts','tests/database/open-app-database.spec.ts','tests/database/write-lock.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/host.json'])
