import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [action,root,operation,sourceRoot=process.cwd()] = process.argv.slice(2);
const moduleUrl=file=>pathToFileURL(path.join(sourceRoot,'packages/apack-ears/src',file)).href;
const {SqliteDatabase}=await import(moduleUrl('sqlite/database.ts'));
const {createEarsEngine}=await import(moduleUrl('index.ts'));
const {toElmdbSchema}=await import(moduleUrl('schema.ts'));
const schema={types:{Row:{required:[]}},relations:{},roles:[]};
const dir=path.join(root,'database');
const db=new SqliteDatabase({path:dir,syncs:true,...(action==='write'?{schema:toElmdbSchema(schema)}:{})});
const e=createEarsEngine({database:db});
const payload={title:'candidate acknowledgement must not be assumed',negative:-0,body:'durable marker '.repeat(256)};
if(action==='write') {
  e.create('Row',{id:'Row-before',title:'incumbent',negative:-0});
  fs.writeFileSync(path.join(root,'before.json'),JSON.stringify({sequence:db.sequence,ids:e.query('Row').ids(),synchronous:db.sql.pragma('synchronous',{simple:true}),journalMode:db.sql.pragma('journal_mode',{simple:true}),node:process.version,arch:process.arch,sqlite:db.sql.prepare('SELECT sqlite_version() version').get().version}));
  fs.writeFileSync(process.env.EARS_LOST_ACK_ARM,'armed');
  fs.writeSync(1,'ATTEMPT\n');
  const attempt=()=>{
  if(operation==='write')e.create('Row',{id:'Row-candidate',...payload});
  else if(operation==='unit')e.transact(()=>{e.create('Row',{id:'Row-candidate',...payload});e.create('Row',{id:'Row-unit-peer',title:'same logical commit'});});
  else if(operation==='bulkLoad')db.bulkLoad([{load:'entity',id:'Row-candidate',fields:payload}]);
  else if(operation==='schema')e.admin.declare({...schema,types:{...schema.types,Added:{required:[]}}});
  else throw Error('Unknown operation');
  };
  if(process.env.EARS_LOST_ACK_RETURN_EIO) {
    let failure;try{attempt();}catch(error){failure=error;}
    if(failure) {
      let fenced=false,readErrorCode;
      try { e.query('Row').ids(); } catch(error) { fenced=error===failure;readErrorCode=error.code; }
      fs.writeFileSync(path.join(root,'error.json'),JSON.stringify({returned:true,code:failure.code,causeCode:failure.cause?.code,fenced,readErrorCode}));
      fs.writeSync(1,'ERROR_RETURNED\n');
      process.kill(process.pid,'SIGSTOP');
      process.exit(94);
    }
  } else attempt();
  fs.writeFileSync(path.join(root,'ack.json'),JSON.stringify({returned:true,sequence:db.sequence}));
  fs.writeSync(1,'ACK\n');
} else {
  const before=JSON.parse(fs.readFileSync(path.join(root,'before.json'),'utf8'));
  const ids=e.query('Row').ids(), errorMode=action==='read-error';
  const committed=operation==='schema'?!!db.schema.types.Added:ids.includes('Row-candidate');
  const error=errorMode?JSON.parse(fs.readFileSync(path.join(root,'error.json'),'utf8')):undefined;
  const expected=operation==='schema'||errorMode&&!committed?['Row-before']:operation==='unit'?['Row-before','Row-candidate','Row-unit-peer']:['Row-before','Row-candidate'];
  assert.deepEqual(ids,expected);assert.equal(db.sequence,before.sequence+(errorMode?Number(committed):1));
  assert(Object.is(e.getAttr('Row-before','negative'),-0));
  if(!errorMode)assert(committed);
  if(errorMode&&committed)assert(error.fenced,'An error-returned persisted commit must quarantine its handle');
  if(operation==='schema')assert.equal(!!db.schema.types.Added,committed);
  else if(committed) {
    const row=e.getRow('Row-candidate');assert.equal(row.title,payload.title);assert.equal(row.body,payload.body);assert(Object.is(row.negative,-0));
  }
  const snapshot={ids,sequence:db.sequence,negativeZero:true,observedCommitted:committed,...(errorMode?{error}:{}),...(operation==='schema'?{schemaAdded:committed}:{})};
  const nextType=operation==='schema'&&committed?'Added':'Row',nextId=nextType+'-recovered';
  e.create(nextType,{id:nextId,title:'one explicit next write'});assert.equal(db.sequence,snapshot.sequence+1);
  fs.writeFileSync(path.join(root,'reopen.json'),JSON.stringify({...snapshot,recoveredSequence:db.sequence}));
}
db.close();
