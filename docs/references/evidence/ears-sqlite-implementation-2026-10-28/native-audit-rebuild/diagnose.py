from pathlib import Path
import subprocess,os,json
r=Path('/metrics');o=Path('/results');p=r/'packages/apack-ears/tests/sqlite/vector-models.spec.ts';original=p.read_bytes();s=original.decode();needle="    await vi.waitFor(()=>expect(models.hasWork()).toBe(false),{timeout:5000});";assert s.count(needle)==1
try:
 p.write_text(s.replace(needle,"    const steps=vi.spyOn(db.indexBuilds,'step');try {"+needle+"}catch(error){console.log('RETIREMENT_DIAGNOSTIC',JSON.stringify({jobs:db.indexBuilds.jobs(),gc:db.all('SELECT generation,kind,reusable FROM index_gc'),models:db.all('SELECT * FROM vector_indexes'),training:db.all('SELECT generation,state,error FROM vector_training'),steps:steps.mock.results.map(r=>r.value),rows:db.all('SELECT count(*) n FROM ann_1_base'),pending:(db.indexBuilds as any).pending,schedulerStopped:(db.indexBuilds as any).stopped,admissionDirty:[...(models as any).admission.dirty],admissionScan:(models as any).admission.scan,stopped:(models as any).stopped,error:String(models.lastError),indexError:String(db.indexBuilds.lastError)}));throw error;}"))
 env=os.environ|{'EARS_EVALUATION_BACKEND':'sqlite','EARS_VEC1_EXTENSION':'/metrics/packages/apack-ears/dist/sqlite/native/linux-arm64/vec1.so'}
 with (o/'retirement-diagnostic.log').open('w') as log:proc=subprocess.run(['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--maxWorkers=1','--project','@apackdev/ears','packages/apack-ears/tests/sqlite/vector-models.spec.ts','-t','does not enqueue or keep polling a failed logical'],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90)
 print((o/'retirement-diagnostic.log').read_text()[-13000:])
finally:p.write_bytes(original)
