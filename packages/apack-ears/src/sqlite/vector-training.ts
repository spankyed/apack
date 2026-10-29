// A read-only worker owns model training. Only the scheduler may later install its result.
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import type { SqliteIndexJob } from './index-builds.ts';

export interface SqliteTrainedVectorModel {
  generation: number;
  model: Uint8Array;
  modelSha256: string;
  samples: number;
  sourceCommitHex: string;
  extensionSha256: string;
  nativeVersion: string;
  workerSha256: string;
}
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
// CommonJS worker code has no source/dist URL convention and needs no TypeScript loader.
// Resolved dependencies and the extension come from the trusted owner, never stored data.
const workerCode = String.raw`
const {parentPort,workerData:a}=require('node:worker_threads');
const {createHash}=require('node:crypto'),{readFileSync}=require('node:fs');
const Database=require(a.databaseModule);
const sha=b=>createHash('sha256').update(b).digest('hex');
let db;
try {
  db=new Database(a.file,{readonly:true,fileMustExist:true,timeout:0});
  const extensionSha256=sha(readFileSync(a.extension));db.loadExtension(a.extension);
  if(sha(readFileSync(a.extension))!==extensionSha256)throw Object.assign(Error('Native extension changed'),{code:'NATIVE_CHANGED'});
  db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; BEGIN');
  const current=db.prepare("SELECT definition FROM index_builds WHERE generation=? AND type=? AND name=? AND kind='vector'").get(a.generation,a.type,a.name);
  if(!current||current.definition!==a.definition)throw Object.assign(Error('Vector training generation changed'),{code:'SCHEMA_CHANGED'});
  const sourceCommitHex=db.prepare("SELECT hex(value) value FROM meta WHERE key='commit'").get().value;
  const count=db.prepare('SELECT count(*) n FROM chunks c JOIN entities e ON e.id=c.entity_id WHERE c.generation=? AND c.embedding_id IS NOT NULL AND e.trashed=0').get(a.generation).n;
  if(count<64)throw Object.assign(Error('Not enough training vectors'),{code:'TRAINING_DATA'});
  const row=db.prepare('WITH eligible AS MATERIALIZED ('+
    'SELECT c.embedding_id,row_number() OVER (ORDER BY c.embedding_id)-1 rn,count(*) OVER () total '+
    'FROM chunks c JOIN entities e ON e.id=c.entity_id WHERE c.generation=? AND c.embedding_id IS NOT NULL AND e.trashed=0), '+
    'sample AS (SELECT embedding_id FROM eligible WHERE rn=0 OR (rn*?)/total!=((rn-1)*?)/total) '+
    'SELECT vec1_train(coalesce(p.normalized,v.embedding),?) model,count(*) samples '+
    'FROM sample s JOIN embedding_values v ON v.id=s.embedding_id LEFT JOIN embedding_search p ON p.embedding_id=v.id')
    .get(a.generation,BigInt(a.maxSamples),BigInt(a.maxSamples),JSON.stringify({distance:'cos',quantizer:'bq',nbucket:64,nthread:1}));
  if(!row.model||row.samples<64)throw Object.assign(Error('Not enough training vectors'),{code:'TRAINING_DATA'});
  const model=Uint8Array.from(row.model);
  if(model.byteLength>16*1024*1024)throw Object.assign(Error('Training model exceeds limit'),{code:'TRAINING_LIMIT'});
  const nativeVersion=db.prepare('SELECT vec1_info() value').get().value;
  db.exec('COMMIT');db.close();db=undefined;
  parentPort.postMessage({ok:true,generation:a.generation,model,modelSha256:sha(model),samples:row.samples,
    sourceCommitHex,extensionSha256,nativeVersion},[model.buffer]);
} catch(error) {
  try{db?.close();}catch{}
  parentPort.postMessage({ok:false,message:error.message,code:error.code});
} finally {parentPort.close();}
`;

export class SqliteVectorTraining {
  private readonly db: SqliteDatabase;
  private readonly extension: string;
  private running?: { stop(error: Error): Promise<void> };
  constructor(db: SqliteDatabase, extension: string) { this.db=db;this.extension=extension; }
  private current(job: SqliteIndexJob): void {
    if(!this.db.isOpen)fail('CLOSED','The database is closed');
    const row=this.db.get("SELECT generation,definition FROM index_builds WHERE type=? AND name=? AND kind='vector'",[job.type,job.name]);
    if(job.kind!=='vector'||row?.generation!==job.generation||row?.definition!==JSON.stringify(job.definition))
      fail('SCHEMA_CHANGED','Vector training generation changed');
  }
  async train(job: SqliteIndexJob): Promise<SqliteTrainedVectorModel> {
    this.current(job);
    if(this.db.readOnly)fail('READ_ONLY','A writable owner must admit vector training');
    if(this.db.sql.inTransaction)fail('UNIT_OPEN','Release the foreground transaction before training');
    if(this.running)fail('TRAINING_ACTIVE','One native training worker may run per owner');
    const dimensions=job.definition.dims;
    if(!Number.isSafeInteger(dimensions)||dimensions<128||dimensions>4096||dimensions%8!==0)
      fail('UNSUPPORTED','Unsupported ANN training dimensions');
    const maxSamples=Math.min(20000,Math.floor(128*1024*1024/(dimensions*4)));
    const worker=new Worker(workerCode,{eval:true,workerData:{file:join(this.db.path,'data.sqlite3'),
      extension:this.extension,databaseModule:createRequire(import.meta.url).resolve('better-sqlite3'),
      generation:job.generation,type:job.type,name:job.name,definition:JSON.stringify(job.definition),maxSamples}});
    let release!:()=>void;
    const finished=new Promise<void>(resolve=>{release=resolve;});
    let failure: Error|undefined,answer: unknown;
    const stop=(error:Error)=>{failure??=error;void worker.terminate().catch(()=>{});return finished;};
    this.running={stop};
    const closed=()=>{void stop(Object.assign(new Error('The database is closed'),{code:'CLOSED'}));};
    this.db.closeSignal.addEventListener('abort',closed,{once:true});
    if(this.db.closeSignal.aborted)closed();
    return new Promise((resolve,reject)=>{
      worker.once('message',value=>{answer=value;});
      worker.once('error',error=>{failure??=error;});
      worker.once('exit',code=>{
        this.running=undefined;this.db.closeSignal.removeEventListener('abort',closed);release();
        try {
          if(failure)throw failure;
          if(code!==0||!answer)return fail('TRAINING_FAILED','Native training worker exited without a result');
          if(typeof answer!=='object')return fail('CORRUPT','Invalid native training reply');
          const reply=answer as Record<string,unknown>;
          if(reply.ok!==true)return fail(typeof reply.code==='string'?reply.code:'TRAINING_FAILED',String(reply.message));
          const model=reply.model,samples=reply.samples,sourceCommitHex=reply.sourceCommitHex,
            extensionSha256=reply.extensionSha256,nativeVersion=reply.nativeVersion,modelSha256=reply.modelSha256;
          if(!(model instanceof Uint8Array)||!model.byteLength||model.byteLength>16*1024*1024||
              reply.generation!==job.generation||typeof samples!=='number'||!Number.isSafeInteger(samples)||samples<64||samples>maxSamples||
              typeof sourceCommitHex!=='string'||!/^[A-F0-9]+$/.test(sourceCommitHex)||
              typeof extensionSha256!=='string'||!/^[a-f0-9]{64}$/.test(extensionSha256)||
              typeof nativeVersion!=='string'||!nativeVersion||typeof modelSha256!=='string'||
              createHash('sha256').update(model).digest('hex')!==modelSha256)
            return fail('CORRUPT','Invalid native training result');
          resolve({generation:job.generation,model,samples,sourceCommitHex,extensionSha256,nativeVersion,modelSha256,
            workerSha256:createHash('sha256').update(workerCode).digest('hex')});
        } catch(error){reject(error);}
      });
    });
  }
  async stop(): Promise<void> {
    await this.running?.stop(Object.assign(new Error('Vector training cancelled'),{code:'CANCELLED'}));
  }
}
