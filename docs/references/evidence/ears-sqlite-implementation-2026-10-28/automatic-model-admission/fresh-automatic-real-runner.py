from pathlib import Path
import subprocess,hashlib,json,os,time
r=Path('/metrics');o=Path('/results');inputs=json.loads((o/'final-inputs.json').read_text())
for name,sha in inputs.items():assert hashlib.sha256((r/name).read_bytes()).hexdigest()==sha
base=r/'docs/references/evidence/ears-sqlite-implementation-2026-10-28/admission-commit-batching/probe-source.mjs';s=base.read_text();originalSha=hashlib.sha256(base.read_bytes()).hexdigest()
assert originalSha==json.loads((r/'docs/references/evidence/ears-sqlite-implementation-2026-10-28/admission-commit-batching/source.json').read_text())['probeSha256']
needle="    db.sql.exec('BEGIN IMMEDIATE');try{models.enqueue(job);db.commitWrite();}catch(error){if(db.sql.inTransaction)db.sql.exec('ROLLBACK');throw error;}";assert s.count(needle)==1;s=s.replace(needle,'    // Exercise normal owner eligibility: no explicit enqueue in this harness.')
s=s.replace('let db,models,nativeCalls=0;', 'let db,models,nativeCalls=0,automaticEnqueues=0,admissionPages=0,admissionReferences=0;')
needle='  const e = createEarsEngine({database:db}), ids=[], updates=[];';assert needle in s
s=s.replace(needle,'''  if(models) {
    const enqueue=models.enqueue.bind(models);
    models.enqueue=(...args)=>{automaticEnqueues++;return enqueue(...args);};
    const all=db.all.bind(db);
    db.all=(sql,parameters=[])=>{
      const answer=all(sql,parameters);
      if(sql.startsWith('WITH admission_page AS MATERIALIZED')) {
        assert(answer.length<=128);admissionPages++;admissionReferences+=answer.length;
        assert(answer.every(row=>!Object.values(row).some(value=>value instanceof Uint8Array)));
      }
      return answer;
    };
  }
''' +needle)
needle="assert.equal(report.modelAdmission.state.state,'ready');";assert needle in s;s=s.replace(needle,"if(size>4096)assert.equal(report.modelAdmission.state.state,'ready');else assert.equal(report.modelAdmission.state,undefined);")
s=s.replace("stage:'native-model-ready',samples:report.modelAdmission.state.samples", "stage:report.modelAdmission.state?'native-model-ready':'native-model-not-required',samples:report.modelAdmission.state?.samples??0")
needle="  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);\n  report.checkpointProbe.filesAfterAdmission";assert needle in s;s=s.replace(needle,'''  const hits=e.query('Row').near(queryVectors[0],{k:10}).ids();assert.equal(hits.length,10);
  report.automaticAdmission={enqueues:automaticEnqueues,pages:admissionPages,references:admissionReferences,
    firstQueryHits:hits.length,nativeCandidateCalls:nativeCalls,explicitHarnessEnqueues:0};
  if(size>4096){assert.equal(automaticEnqueues,1);assert(nativeCalls>0);}
  else{assert.equal(automaticEnqueues,0);assert.equal(nativeCalls,0);}
  assert.equal(db.sql.pragma('synchronous',{simple:true}),2);
  report.checkpointProbe.filesAfterAdmission''')
file=r/'packages/apack-ears/bench/sqlite/automatic-admission-probe.mjs';file.write_text(s);(o/'automatic-admission-probe.mjs').write_text(s)
(o/'automatic-probe-source.json').write_text(json.dumps({'base':'844e0f6184978565b126b2cccf08ad082c291350','overlay':inputs,'baseProbeSha256':originalSha,'automaticProbeSha256':hashlib.sha256(s.encode()).hexdigest(),'changes':'remove explicit harness enqueue; measure normal model-owner eligibility; verify no native training for small scope and actual EARS/native route for large scope; independent admission-only diagnostic, not full query/recall acceptance'},indent=2)+'\n')
rows=[]
for size in [1000,99900]:
 name='automatic-real-'+str(size);args=['node','--import','tsx',str(file),'/corpus','/truth/truth.json',str(size),'/results/'+name+'.json','native-diagnose'];start=time.monotonic()
 with (o/(name+'.log')).open('w') as f:p=subprocess.run(args,cwd=r,env=os.environ|{'EARS_TEST_SOURCE':'844e0f6184978565b126b2cccf08ad082c291350','EARS_VEC1_EXTENSION':'/metrics/patched/vec1.so','EARS_CHECKPOINT_PROBE':'auto'},stdout=f,stderr=subprocess.STDOUT,timeout=480)
 rows.append({'label':name,'args':args,'exitCode':p.returncode,'seconds':time.monotonic()-start});(o/'automatic-probe-results.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,p.returncode,flush=True)
 assert p.returncode==0,(o/(name+'.log')).read_text()[-10000:]
 report=json.loads((o/(name+'.json')).read_text());assert report['completed'] and report['synchronous']==2 and report['checkpointProbe']['admissionAutoThreshold']==1000 and report['checkpointProbe']['finalCanonicalRowsVerified']==size
