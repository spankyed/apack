from pathlib import Path
import subprocess,os,json
r=Path('/metrics');o=Path('/results')
base=['node','../../scripts/with-source.mjs','node','../../node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','--maxWorkers=1','--reporter=default','--reporter=json']
def run(label,file,pattern,negative=False):
 with (o/(label+'.log')).open('w') as f:p=subprocess.run([*base,file,'-t',pattern,'--outputFile=/results/'+label+'.json'],cwd=r/'packages/apack-ears',stdout=f,stderr=subprocess.STDOUT,timeout=90)
 d=json.loads((o/(label+'.json')).read_text());assert (p.returncode!=0 and d['numFailedTests']==1 if negative else p.returncode==0),(label,(o/(label+'.log')).read_text()[-6000:]);print(label,p.returncode,flush=True)
run('physical-positive-index','tests/sqlite/vector-index.spec.ts','preserves the incumbent|older read snapshot')
run('physical-positive-model','tests/sqlite/vector-models.spec.ts','pending and failed physical refresh|interrupted private projection|admits public refresh')
controls=[('retire-before-ready','vector-index.ts','    const inserted=this.db.run(','    this.db.run("UPDATE vector_indexes SET state=\'retiring\' WHERE generation=? AND state=\'ready\'",[job.generation]);\n    const inserted=this.db.run(','tests/sqlite/vector-index.spec.ts','preserves the incumbent'),('gate-incumbent-on-training','database.ts','    this.nativeReader ??= new SqliteVectorIndex(this, this.nativeExtension);', "    if(this.get('SELECT state FROM vector_training WHERE generation=?',[generation])?.state!=='ready')return;\n    this.nativeReader ??= new SqliteVectorIndex(this, this.nativeExtension);",'tests/sqlite/vector-models.spec.ts','pending and failed physical refresh'),('unbounded-retirement','vector-index.ts','return Number(this.db.run(`DELETE FROM ${name} WHERE rowid IN (SELECT rowid FROM ${name} LIMIT ?)`,[limit]).changes)<limit;','return Number(this.db.run(`DELETE FROM ${name}`,[]).changes)<limit;','tests/sqlite/vector-index.spec.ts','preserves the incumbent')]
for label,name,before,after,file,pattern in controls:
 p=r/'packages/apack-ears/src/sqlite'/name;original=p.read_bytes();s=original.decode();assert s.count(before)==1,(label,s.count(before))
 try:p.write_text(s.replace(before,after));run(label,file,pattern,True)
 finally:p.write_bytes(original)
