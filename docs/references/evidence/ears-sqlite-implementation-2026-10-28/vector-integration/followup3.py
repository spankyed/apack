from pathlib import Path
import subprocess,os,json,time,hashlib
r=Path('/metrics');o=Path('/results');os.chdir(r)
source='de48f5a9242a1b64592a4cc9f173e5e73e2d5ee2'
hashes={'packages/apack-ears/src/sqlite/vectors.ts': '8b09ffc049d8ab9f9b9565a270e26572f28c69839eec563a70d52cc38acf7ac2', 'packages/apack-ears/tests/sqlite/vector-execution.spec.ts': '50a9fb3c533c3fac1c1ac17b04b8aff8d1fc28cd91ae29761e590d896dfc9f94'}
for path,expected in hashes.items():assert hashlib.sha256((r/path).read_bytes()).hexdigest()==expected
os.environ['EARS_TEST_SOURCE']=source;os.environ['EARS_EVALUATION_BACKEND']='sqlite'
results=json.loads((o/'correction-results.json').read_text())
def check(name,args,negative=False):
 start=time.monotonic()
 with (o/(name+'.txt')).open('w') as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=240)
 rec={'label':name,'args':args,'exitCode':p.returncode,'expectedFailure':negative,'seconds':time.monotonic()-start,'source':source}
 results.append(rec);(o/'correction-results.json').write_text(json.dumps(results,indent=2)+'\n');print(rec,flush=True)
 assert (p.returncode!=0 if negative else p.returncode==0),(o/(name+'.txt')).read_text()[-12000:]
 return (o/(name+'.txt')).read_text()
base=['npm','test','-w','@apackdev/ears','--']
def write_owned(path,data):
 temporary=path.with_name('.ears-vector-mutation-next')
 assert not temporary.exists()
 with temporary.open('xb') as stream:stream.write(data)
 temporary.replace(path)
(o/'corrected-api.txt').replace(o/'stale-packages-api.txt')
results[-1]['label']='stale-packages-api';(o/'correction-results.json').write_text(json.dumps(results,indent=2)+'\n')
check('corrected-packages-build',['npm','run','packages:build'])
check('corrected-api',['npm','run','api:check','-w','@apackdev/ears'])
check('corrected-lint',['npm','run','lint:check'])
check('corrected-specifiers',['npm','run','check:specifiers'])
check('corrected-ears-all',base+['--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/corrected-ears.json'])
check('corrected-host-storage',['npm','test','-w','@apackdev/host','--','tests/backup/recovery.spec.ts','tests/backup/recovery-crash.spec.ts','tests/backup/import.spec.ts','tests/backup/import-transaction.spec.ts','tests/backup/logical.spec.ts','tests/backup/logical-crash.spec.ts','tests/backup/storage.spec.ts','tests/database/storage.spec.ts','tests/database/open-app-database.spec.ts','tests/database/write-lock.spec.ts','--maxWorkers=2','--reporter=default','--reporter=json','--outputFile=/results/host.json'])
