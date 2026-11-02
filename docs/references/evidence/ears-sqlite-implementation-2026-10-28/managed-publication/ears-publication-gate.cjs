const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const file='/electron/.github/scripts/ears-sqlite-platform.mjs',source=fs.readFileSync(file,'utf8');
const select=source.slice(source.indexOf('  const publication ='),source.indexOf('  const logical ='));
const checks=source.slice(source.indexOf('  assert.equal(publication.length'),source.indexOf('  assert(selected.length'));
assert(select.includes('const publication')&&checks.includes('publication.every'));
const verify=new Function('host','assert',select+checks+'return publication;');
const host=JSON.parse(fs.readFileSync('/results/host-final.json','utf8'));
const selected=verify(host,assert);assert.equal(selected.length,27);
const picked=selected[0].fullName,variants=[];
for(const kind of ['missing','skipped']){
 const changed=JSON.parse(JSON.stringify(host));
 for(const result of changed.testResults){
  if(kind==='missing')result.assertionResults=result.assertionResults.filter(a=>a.fullName!==picked);
  else for(const a of result.assertionResults)if(a.fullName===picked)a.status='pending';
 }
 let failure;
 try{verify(changed,assert)}catch(error){failure=error}
 assert.equal(failure?.code,'ERR_ASSERTION',kind);
 variants.push({kind,code:failure.code,message:failure.message});
}
fs.writeFileSync('/results/publication-gate.json',JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),hostReportSha256:crypto.createHash('sha256').update(fs.readFileSync('/results/host-final.json')).digest('hex'),passed:27,controls:variants},null,2)+'\n');
console.log('Actual platform verifier accepts 27 witnesses and refuses missing/skipped cases');
