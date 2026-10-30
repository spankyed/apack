const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const source = fs.readFileSync('/verifier.mjs','utf8');
const helpers = source.slice(source.indexOf('// Require named safety witnesses'),source.indexOf("const evidence = resolve("));
const select = source.slice(source.indexOf('  const publication ='),source.indexOf('  const logical ='));
const begin = source.indexOf('  requirePassingCases(publication,'), end = source.indexOf('\n',source.indexOf('  requirePassingCases(identity,'));
assert(begin >= 0 && end > begin, 'The actual verifier must invoke both required case checks');
const check = new Function('assert','host','ears',helpers+select+source.slice(begin,end)+`
return {publication: publication.length, identity: identity.length};`);
const host = JSON.parse(fs.readFileSync('/identity/host-full.json','utf8')), ears = JSON.parse(fs.readFileSync('/identity/ears-full.json','utf8'));
const rows = [];
function pass(name,h=host,e=ears){const result=check(assert,h,e);rows.push({name,passed:true,result});}
function refuse(name,edit){const h=structuredClone(host),e=structuredClone(ears);edit(h,e);assert.throws(()=>check(assert,h,e),/required case must execute|selected case must pass|duplicate witness/);rows.push({name,refused:true});}
const publicationCase=h=>h.testResults.find(t=>t.name.replaceAll('\\','/').endsWith('/tests/database/storage.spec.ts')).assertionResults;
const identityCase=e=>e.testResults.find(t=>t.name.replaceAll('\\','/').endsWith('/tests/sqlite/database-identity.spec.ts')).assertionResults;
pass('all actual passing witnesses');
refuse('missing foreign-history refusal',(h)=>{const cases=publicationCase(h),i=cases.findIndex(t=>t.fullName.includes('foreign valid SQLite history'));assert(i>=0);cases.splice(i,1);});
refuse('skipped WRONG_FORMAT classification',(h)=>{const t=publicationCase(h).find(t=>t.fullName.includes('never treats WRONG_FORMAT'));assert(t);t.status='pending';});
refuse('missing foreign WAL identity',(h,e)=>{const cases=identityCase(e),i=cases.findIndex(t=>t.fullName.includes('foreign committed WAL'));assert(i>=0);cases.splice(i,1);});
refuse('skipped primary refusal',(h,e)=>{const t=identityCase(e).find(t=>t.fullName.includes('missing authoritative entities'));assert(t);t.status='pending';});
refuse('duplicate safety witness',(h)=>{const cases=publicationCase(h);const selected=cases.find(t=>t.fullName.includes('never treats'));assert(selected);cases.push({...selected});});
const extra=structuredClone(host);publicationCase(extra).push({fullName:'refuses stale future publication case',status:'passed'});pass('additional passing case does not break inventory',extra);
const windows=structuredClone(host),windowsEars=structuredClone(ears);for(const report of [windows,windowsEars])for(const t of report.testResults)t.name=t.name.replaceAll('/','\\');pass('Windows separator normalization',windows,windowsEars);
fs.writeFileSync('/out/verifier.json',JSON.stringify({sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),checks:rows},null,2)+'\n');console.log(rows);
