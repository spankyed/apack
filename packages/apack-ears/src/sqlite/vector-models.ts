// Durable native training/admission attempts. The shared scheduler owns their writer transactions.
import { randomUUID, createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import type { SqliteEntityScope } from './query-scope.ts';
import type { SqliteIndexJob } from './index-builds.ts';
import { SqliteVectorIndex } from './vector-index.ts';
import { SqliteVectorTraining, type SqliteTrainedVectorModel } from './vector-training.ts';

interface SqliteModelOutcome { generation:number;attempt:string;model?:SqliteTrainedVectorModel;error?:unknown }
export interface SqliteModelStep { progressed:boolean;changedType?:string;accept():void }
const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
export class SqliteVectorModels {
  readonly index:SqliteVectorIndex;
  private readonly db:SqliteDatabase;
  private readonly trainer:SqliteVectorTraining;
  private readonly release:()=>void;
  private running?:Promise<void>;
  private outcome?:SqliteModelOutcome;
  private orphanSweep=false;
  private stopped=false;
  private stopping?:Promise<void>;
  lastError?:unknown;
  constructor(db:SqliteDatabase,extension:string) {
    if(db.sql.inTransaction)fail('UNIT_OPEN','Construct the native model owner outside a foreground transaction');
    this.db=db;this.release=db.claimVectorTrainingOwner();
    try {
      this.index=new SqliteVectorIndex(db,extension);this.trainer=new SqliteVectorTraining(db,extension);
      db.sql.exec(`CREATE TABLE IF NOT EXISTS vector_training(
        generation INTEGER PRIMARY KEY REFERENCES index_builds(generation) ON DELETE CASCADE,
        definition TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','training','trained','projecting','ready','failed')),
        attempt TEXT,model BLOB,model_sha256 TEXT,samples INTEGER,source_commit_hex TEXT,
        extension_sha256 TEXT,native_version TEXT,worker_sha256 TEXT,error TEXT);`);
      db.sql.exec('CREATE INDEX IF NOT EXISTS vector_training_state ON vector_training(state,generation)');
      this.orphanSweep=!!this.orphan();
      db.indexBuilds.attachVectorModels(this);
    } catch(error){this.release();throw error;}
  }
  hasWork():boolean {
    return this.orphanSweep||!!this.outcome||!!this.running||!!this.db.get("SELECT 1 FROM vector_training WHERE state IN ('pending','training','trained','projecting') LIMIT 1");
  }
  failure():Error|undefined {
    const row=this.db.get("SELECT generation,error FROM vector_training WHERE state='failed' ORDER BY generation LIMIT 1");
    return row?Object.assign(new Error(`Native vector model ${row.generation} failed: ${row.error}`),{code:'INDEX_FAILED'}):undefined;
  }
  private orphan():Record<string,any>|undefined {
    return this.db.get(`SELECT v.generation FROM vector_indexes v LEFT JOIN index_builds b ON b.generation=v.generation
      LEFT JOIN index_gc g ON g.generation=v.generation WHERE b.generation IS NULL AND g.generation IS NULL LIMIT 1`);
  }
  collectRetired(generation:number):boolean {
    this.writer();
    if(!this.db.get('SELECT 1 FROM vector_indexes WHERE generation=?',[generation]))return true;
    if(!this.index.collect(generation,32))return false;
    this.index.retire(generation);return true;
  }
  candidateOwners(generation:number,vector:Uint8Array,scope:SqliteEntityScope|null,exclude?:string):number[]|undefined {
    if(this.stopped||this.db.get('SELECT state FROM vector_training WHERE generation=?',[generation])?.state!=='ready')return;
    // A chunk cap is not an owner cap: expand when one owner has many close chunks.
    for(let limit=256;limit<=4096;limit*=2) {
      const rows=this.index.candidates(generation,vector,limit,scope,exclude);
      const owners=[...new Set(rows.map(row=>Number(row.owner)))];
      if(owners.some(owner=>!Number.isSafeInteger(owner)||owner<1))fail('CORRUPT','Invalid native candidate owner');
      if(owners.length>=256)return owners;
      if(rows.length<limit)break;
    }
    // Preserve the ordinary owner-level path when the native chunk budget cannot supply enough owners.
    return;
  }
  private writer():void {
    if(this.stopped||!this.db.isOpen)fail('CLOSED','Native model owner is closed');
    if(!this.db.sql.inTransaction)fail('UNIT_REQUIRED','Native model state requires writer ownership');
  }
  private job(generation:number):SqliteIndexJob {
    const row=this.db.get("SELECT type,name FROM index_builds WHERE generation=? AND kind='vector'",[generation]);
    if(!row)return fail('SCHEMA_CHANGED','Native model generation was retired');
    return this.db.indexBuilds.index(String(row.type),'vector',String(row.name));
  }
  enqueue(job:SqliteIndexJob):void {
    this.writer();const current=this.job(job.generation);
    if(JSON.stringify(current.definition)!==JSON.stringify(job.definition))fail('SCHEMA_CHANGED','Native model definition changed');
    this.db.run("INSERT INTO vector_training(generation,definition,state) VALUES (?,?,'pending') ON CONFLICT(generation) DO NOTHING",
      [job.generation,JSON.stringify(job.definition)]);
  }
  /** Only the managed exclusive writer may declare previous in-flight attempts abandoned on startup. */
  recover():void {
    this.writer();if(this.running)fail('TRAINING_ACTIVE','Drain this owner before recovery');
    this.db.run("UPDATE vector_training SET state='pending',attempt=NULL,error=NULL WHERE state='training'");
  }
  retry(generation:number):void {
    this.writer();this.db.run("UPDATE vector_training SET state='pending',attempt=NULL,error=NULL WHERE generation=? AND state='failed'",[generation]);
  }
  /** Claim durably before launching the read-only worker, always outside the scheduler's transaction. */
  start():boolean {
    if(this.stopped||!this.db.isOpen)fail('CLOSED','Native model owner is closed');
    if(this.db.sql.inTransaction)fail('UNIT_OPEN','Release the foreground transaction before launching training');
    if(this.running||this.outcome)return false;
    let generation:number,attempt:string,job:SqliteIndexJob;
    this.db.sql.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.get("SELECT generation FROM vector_training WHERE state='pending' ORDER BY generation LIMIT 1");
      if(!row){this.db.sql.exec('ROLLBACK');return false;}
      generation=Number(row.generation);job=this.job(generation);attempt=randomUUID();
      this.db.run("UPDATE vector_training SET state='training',attempt=?,error=NULL WHERE generation=? AND state='pending'",[attempt,generation]);
      this.db.commitWrite();
    }catch(error){if(this.db.sql.inTransaction)this.db.sql.exec('ROLLBACK');throw error;}
    const receive=(outcome:SqliteModelOutcome)=>{
      this.running=undefined;
      if(this.stopped||!this.db.isOpen)return;
      this.outcome=outcome;
      try{this.db.indexBuilds.wake();}catch(error){this.lastError=error;}
    };
    this.running=this.trainer.train(job).then(model=>receive({generation,attempt,model}),error=>receive({generation,attempt,error}));
    return true;
  }
  async settled():Promise<void>{await this.running;}
  /** Call accept only after COMMIT. A refusal/rollback must retain the model for a later attempt. */
  step():SqliteModelStep {
    this.writer();const received=this.outcome;
    if(received) {
      const row=this.db.get('SELECT state,attempt FROM vector_training WHERE generation=?',[received.generation]);
      if(row?.state==='training'&&row.attempt===received.attempt) {
        if(received.model) {
          const m=received.model;this.job(received.generation);
          this.db.run(`UPDATE vector_training SET state='trained',model=?,model_sha256=?,samples=?,source_commit_hex=?,
            extension_sha256=?,native_version=?,worker_sha256=? WHERE generation=? AND attempt=?`,
            [Buffer.from(m.model),m.modelSha256,m.samples,m.sourceCommitHex,m.extensionSha256,m.nativeVersion,m.workerSha256,received.generation,received.attempt]);
        } else {
          const error=received.error;
          this.db.run("UPDATE vector_training SET state='failed',error=? WHERE generation=? AND attempt=?",
            [JSON.stringify({message:error instanceof Error?error.message:String(error),code:(error as {code?:unknown})?.code}),received.generation,received.attempt]);
        }
      }
      return {progressed:true,accept:()=>{if(this.outcome===received)this.outcome=undefined;}};
    }
    const row=this.db.get("SELECT * FROM vector_training WHERE state IN ('trained','projecting') ORDER BY generation LIMIT 1");
    if(!row) {
      if(!this.orphanSweep)return {progressed:false,accept:()=>{}};
      const orphan=this.orphan();
      if(orphan){this.collectRetired(Number(orphan.generation));return {progressed:true,accept:()=>{}};}
      return {progressed:true,accept:()=>{this.orphanSweep=false;}};
    }
    const generation=Number(row.generation),job=this.job(generation);
    if(row.state==='trained') {
      if(!(row.model instanceof Uint8Array)||createHash('sha256').update(row.model).digest('hex')!==row.model_sha256)
        fail('CORRUPT','Stored training model does not match its identity');
      this.index.admit(job,row.model);
      this.db.run("UPDATE vector_training SET state='projecting',model=NULL WHERE generation=?",[generation]);
      return {progressed:true,accept:()=>{}};
    }
    const ready=this.index.step(generation,32);
    if(ready)this.db.run("UPDATE vector_training SET state='ready' WHERE generation=?",[generation]);
    return {progressed:true,...(ready?{changedType:job.type}:{}),accept:()=>{}};
  }
  stop():Promise<void> {
    if(this.stopping)return this.stopping;
    this.stopped=true;
    this.stopping=(async()=>{
      try{await this.trainer.stop();await this.running;}
      finally{this.outcome=undefined;this.release();}
    })();
    this.db.indexBuilds.detachVectorModels(this,this.stopping);
    return this.stopping;
  }
}
