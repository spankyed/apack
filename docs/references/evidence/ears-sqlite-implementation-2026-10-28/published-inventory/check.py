from pathlib import Path
import subprocess,json
r=Path('/metrics');o=Path('/results')
base=['node','scripts/with-source.mjs','node','node_modules/vitest/vitest.mjs','run','--config','vitest.integration.config.ts','--project','@app/publish-checks','packages/publish-checks/tests/published-sdk-types.integration.spec.ts','-t','ships no host-only module','--maxWorkers=1','--reporter=default','--reporter=json']
def run(label,negative=False):
 with (o/(label+'.log')).open('w') as f:p=subprocess.run([*base,'--outputFile=/results/'+label+'.json'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=90)
 d=json.loads((o/(label+'.json')).read_text());assert (p.returncode!=0 and d['numFailedTests']==1 if negative else p.returncode==0 and d['numPassedTests']==1),(label,(o/(label+'.log')).read_text()[-6000:]);print(label,p.returncode,flush=True)
run('inventory-positive')
p=r/'packages/publish-checks/tests/published-sdk-types.integration.spec.ts';original=p.read_bytes();s=original.decode();before="expect(packedRoots(PACKED_PACKAGES.sdk!)).toEqual(['apack.schema.json', 'dist', 'package.json']);";assert s.count(before)==1
try:p.write_text(s.replace(before,"expect(fs.readdirSync(sdk).sort()).toEqual(['apack.schema.json', 'dist', 'package.json']);"));run('inventory-old-installed-directory',True)
finally:p.write_bytes(original)
