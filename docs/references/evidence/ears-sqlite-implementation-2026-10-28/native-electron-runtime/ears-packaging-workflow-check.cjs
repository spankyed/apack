const fs=require('node:fs'),yaml=require('yaml'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const file='/workflow.yml',doc=yaml.parse(fs.readFileSync(file,'utf8'));
assert(doc.on.workflow_dispatch.inputs.suite.options.includes('installed'));
assert.equal(doc.on.workflow_dispatch.inputs.repeat_each.default,1);assert.equal(doc.on.workflow_call.inputs.repeat_each.default,1);
const steps=doc.jobs.check.steps,validate=steps.find(s=>s.name==='Validate repetition count').run;
const cases=[['1',true],['20',true],['0',false],['21',false],['1.5',false],['1; exit 0',false]];
for(const [value,ok] of cases){const p=spawnSync('bash',['-c',validate],{env:{...process.env,APACK_E2E_REPEAT:value},encoding:'utf8'});assert.equal(p.status===0,ok,value);}
const installed=steps.find(s=>s.name==='Packaged native runtime');assert(installed.run.includes('node build/prod/smoke-native.mjs'));
const build=steps.find(s=>s.name==='Build unsigned installed Preview');assert(build.run.includes('npm run build:preview'));
const selected=steps.find(s=>s.name==='Selected external pack app suite');assert(selected.run.includes('--repeat-each "$APACK_E2E_REPEAT"'));
const lifecycle=steps.find(s=>s.name==='Installed SQLite app lifecycle');
assert(steps.some(s=>s.name==='Typecheck installed app contracts'));
assert.equal(lifecycle.env.APACK_STORAGE_FORMAT,'sqlite/1');assert(lifecycle.run.includes('APACK_HOST_EXECUTABLE='));
const verify=lifecycle.run.split("node - <<'NODE'\n")[1].split('\nNODE')[0];
const os=require('node:os'),path=require('node:path'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-report-'));
const title='packaged SQLite stores hold their model claims across the real API process';
const reportCases=[['passed',true],['missing-witness',false],['skipped',false]];
try {
 fs.mkdirSync(path.join(temp,'.apack/installed-evidence'),{recursive:true});
 for(const [kind,ok] of reportCases){
  const report={stats:{expected:6,unexpected:0,skipped:kind==='skipped'?1:0,flaky:0},suites:[{specs:kind==='missing-witness'?[]:[{title,ok:kind!=='skipped',tests:[{results:[{status:kind==='skipped'?'skipped':'passed'}]}]}]}]};
  const input=path.join(temp,'input.json');fs.writeFileSync(input,JSON.stringify(report));
  const p=spawnSync('node',['-e',verify],{cwd:temp,env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_NAME:input},encoding:'utf8'});assert.equal(p.status===0,ok,kind+' '+p.stderr);
  if(ok)JSON.parse(fs.readFileSync(path.join(temp,'.apack/installed-evidence/verification.json'),'utf8'));
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
fs.writeFileSync('/results/workflow-check.json',JSON.stringify({file:'.github/workflows/app-acceptance.yml',sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),parsed:true,repetitionCases:cases,installedUsesOrdinaryPreview:true,installedWitnessGuardCases:reportCases},null,2)+'\n');
console.log('Workflow parsed; repetition bounds and installed Preview invocation verified');
