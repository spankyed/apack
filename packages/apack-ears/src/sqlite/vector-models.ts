// Durable native training/admission attempts. The shared scheduler owns their writer transactions.
import { claimNativeVectorOwner } from './vector-owner.ts';
import { randomUUID, createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import type { SqliteEntityScope } from './query-scope.ts';
import type { SqliteIndexJob } from './index-builds.ts';
import { SqliteVectorIndex } from './vector-index.ts';
import { SqliteVectorAdmission } from './vector-admission.ts';
import { nativeVectorCandidateOwners } from './vector-candidates.ts';
import { SqliteVectorTraining, type SqliteTrainedVectorModel } from './vector-training.ts';

interface SqliteModelOutcome { generation:number;attempt:string;model?:SqliteTrainedVectorModel;error?:unknown }
export interface SqliteModelStep { progressed:boolean;changedType?:string;accept():void }
const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code});};
export class SqliteVectorModels {
  readonly index:SqliteVectorIndex;
  private readonly db:SqliteDatabase;
  private readonly trainer:SqliteVectorTraining;
  private readonly admission:SqliteVectorAdmission;
  private readonly release:()=>void;
  private running?:Promise<void>;
  private outcome?:SqliteModelOutcome;
  private orphanSweep=false;
  private stopped=false;
  private pauseDepth=0;
  private pausing?:Promise<void>;
  get isPaused():boolean{return this.pauseDepth>0;}
  private stopping?:Promise<void>;
  lastError?:unknown;
  constructor(db:SqliteDatabase,extension:string) {
    if(db.sql.inTransaction)fail('UNIT_OPEN','Construct the native model owner outside a foreground transaction');
    db.indexBuilds.assertNativeModelsAvailable();
    this.db=db;const releaseHandle=db.claimVectorTrainingOwner();
    let releaseFile:(()=>void)|undefined;
    try {
      const fileClaim=claimNativeVectorOwner(db.path);releaseFile=fileClaim;
      this.release=()=>{try{fileClaim();}finally{releaseHandle();}};
      this.index=new SqliteVectorIndex(db,extension);this.trainer=new SqliteVectorTraining(db,extension);
      this.admission=new SqliteVectorAdmission(db);
      db.sql.exec(`CREATE TABLE IF NOT EXISTS vector_training(
        generation INTEGER PRIMARY KEY REFERENCES index_builds(generation) ON DELETE CASCADE,
        definition TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','training','trained','projecting','ready','failed')),
        attempt TEXT,model BLOB,model_sha256 TEXT,samples INTEGER,source_commit_hex TEXT,
        extension_sha256 TEXT,native_version TEXT,worker_sha256 TEXT,error TEXT);`);
      db.sql.exec('CREATE INDEX IF NOT EXISTS vector_training_state ON vector_training(state,generation)');
      this.orphanSweep=!!this.orphan();
      db.indexBuilds.attachVectorModels(this);
    } catch(error){
      try{releaseFile?.();}
      catch(cleanup){throw Object.assign(new AggregateError([error,cleanup],'Native model construction and claim cleanup failed',{cause:error}),{code:(error as {code?:unknown})?.code});}
      finally{releaseHandle();}
      throw error;
    }
  }
  invalidateAdmission(dependencies:ReadonlyMap<string,ReadonlySet<number>>):void { this.admission.invalidate(dependencies); }
  committed(changes:ReadonlySet<string>):void {
    if(changes.has('all'))this.admission.invalidate(this.db.indexBuilds.nativeAdmissionDependencies);
    else this.admission.committed(changes);
  }
  hasWork():boolean {
    if(this.stopped||this.isPaused||!this.db.isOpen)return false;
    return this.admission.hasWork()||this.index.retirementPending()||this.orphanSweep||!!this.outcome||!!this.running||!!this.db.get("SELECT 1 FROM vector_training WHERE state IN ('pending','training','trained','projecting') LIMIT 1");
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
    this.index.retire(generation);return !this.db.get('SELECT 1 FROM vector_indexes WHERE generation=?',[generation]);
  }
  candidateOwners(generation:number,vector:Uint8Array,scope:SqliteEntityScope|null,exclude?:string,target?:number):number[]|undefined {
    if(this.stopped)return;
    return nativeVectorCandidateOwners(this.index,generation,vector,scope,exclude,target);
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
    if(this.isPaused)fail('BACKGROUND_PAUSED','Native model maintenance is in progress');
    this.writer();const current=this.job(job.generation);
    if(JSON.stringify(current.definition)!==JSON.stringify(job.definition))fail('SCHEMA_CHANGED','Native model definition changed');
    this.db.run("INSERT INTO vector_training(generation,definition,state) VALUES (?,?,'pending') ON CONFLICT(generation) DO NOTHING",
      [job.generation,JSON.stringify(job.definition)]);
  }
  /** Queue a replacement for an existing physical model; preserve its current pointer and logical data. */
  refresh(generation:number):void {
    if(this.isPaused)fail('BACKGROUND_PAUSED','Native model maintenance is in progress');
    this.writer();this.job(generation);
    if(!this.index.ready(generation))fail('INDEX_BUILDING','A ready incumbent is required for physical refresh');
    if(this.db.get("SELECT 1 FROM vector_indexes WHERE generation=? AND state!='ready'",[generation]))
      fail('REFRESH_ACTIVE','Finish projection and retirement before another physical refresh');
    const state=this.db.get('SELECT state FROM vector_training WHERE generation=?',[generation]);
    if(state?.state!=='ready'&&state?.state!=='failed')fail('TRAINING_ACTIVE','This generation already has an active training attempt');
    this.db.run("UPDATE vector_training SET state='pending',attempt=NULL,model=NULL,error=NULL WHERE generation=?",[generation]);
  }
  /** Only the managed exclusive writer may declare previous in-flight attempts abandoned on startup. */
  recover():void {
    this.writer();if(this.running)fail('TRAINING_ACTIVE','Drain this owner before recovery');
    this.db.run("UPDATE vector_training SET state='pending',attempt=NULL,error=NULL WHERE state='training'");
  }
  retry(generation:number):void {
    if(this.isPaused)fail('BACKGROUND_PAUSED','Native model maintenance is in progress');
    this.writer();this.db.run("UPDATE vector_training SET state='pending',attempt=NULL,error=NULL WHERE generation=? AND state='failed'",[generation]);
  }
  /** Claim durably before launching the read-only worker, always outside the scheduler's transaction. */
  start():boolean {
    if(this.isPaused)return false;
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
      if(this.stopped||this.isPaused||!this.db.isOpen)return;
      this.outcome=outcome;
      try{this.db.indexBuilds.wake();}catch(error){this.lastError=error;}
    };
    this.running=this.trainer.train(job).then(model=>receive({generation,attempt,model}),error=>receive({generation,attempt,error}));
    return true;
  }
  async settled():Promise<void>{await this.running;}
  /** Call accept only after COMMIT. A refusal/rollback must retain the model for a later attempt. */
  step():SqliteModelStep {
    if(this.isPaused)return {progressed:false,accept:()=>{}};
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
      // Finish one attempt before scanning more generations; the idle path launches pending training
      // outside this transaction. Eligibility must not starve worker launch or acknowledgement.
      if(this.db.get("SELECT 1 FROM vector_training WHERE state IN ('pending','training') LIMIT 1"))
        return {progressed:false,accept:()=>{}};
      if(this.index.collectSuperseded(32))return {progressed:true,accept:()=>{}};
      if(this.admission.hasWork())return this.admission.step(job=>this.enqueue(job));
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
    // Use the shared time slice, with a bounded 128-row page, to amortize FULL commits.
    const ready=this.index.step(generation,128);
    if(ready)this.db.run("UPDATE vector_training SET state='ready' WHERE generation=?",[generation]);
    return {progressed:true,...(ready?{changedType:job.type}:{}),accept:()=>{}};
  }
  /** Drain actual worker exit without releasing the cross-process claim or stopping logical indexing. */
  async withPaused<T>(operation:()=>Promise<T>):Promise<T> {
    if(this.stopped||!this.db.isOpen)fail('CLOSED','Native model owner is closed');
    if(this.pauseDepth++===0) {
      this.db.indexBuilds.nativeModelsPaused();
      this.pausing=(async()=>{await this.trainer.stop();await this.running;this.outcome=undefined;})();
    }
    let result:T|undefined,failed=false,problem:unknown;
    try{await this.pausing;result=await operation();}catch(error){failed=true;problem=error;}
    let resumeFailure:unknown,resumeFailed=false;
    if(this.pauseDepth>1)this.pauseDepth--;
    else {
      try {
        if(!this.stopped&&this.db.isOpen) {
          if(this.db.sql.inTransaction)this.db.abortFailedOperation(Object.assign(new Error('End the foreground transaction before resuming native models'),{code:'UNIT_OPEN'}));
          this.db.assertNativeMaintenance();
          this.db.sql.exec('BEGIN IMMEDIATE');
          try{this.db.assertNativeMaintenance();this.recover();this.db.commitWrite();}
          catch(error){this.db.abortFailedOperation(error);}
        }
        this.pauseDepth=0;this.pausing=undefined;this.db.indexBuilds.wake();
      } catch(error) {
        resumeFailure=error;resumeFailed=true;
        try{await this.stop();}catch(cleanup){resumeFailure=new AggregateError([error,cleanup],'Resuming native work and stopping its service failed',{cause:error});}
        this.pauseDepth=0;this.pausing=undefined;
      }
    }
    if(resumeFailed)throw Object.assign(new AggregateError(failed?[problem,resumeFailure]:[resumeFailure],
      failed?'Maintenance and native background recovery failed':'Maintenance completed but native background recovery failed',
      {cause:failed?problem:resumeFailure}),{code:((failed?problem:resumeFailure) as {code?:unknown})?.code,backgroundRecoveryFailed:true});
    if(failed)throw problem;
    return result as T;
  }
  stop():Promise<void> {
    if(this.stopping)return this.stopping;
    this.stopped=true;
    // With no running worker there is nothing asynchronous to join. A synchronous close may then
    // reopen immediately; active workers keep the descriptor until their actual exit below.
    if(!this.running) {
      this.outcome=undefined;
      try{this.release();this.stopping=Promise.resolve();}catch(error){this.stopping=Promise.reject(error);}
      this.db.indexBuilds.detachVectorModels(this,this.stopping);return this.stopping;
    }
    this.stopping=(async()=>{
      try{await this.trainer.stop();await this.running;}
      finally{this.outcome=undefined;this.release();}
    })();
    this.db.indexBuilds.detachVectorModels(this,this.stopping);
    return this.stopping;
  }
}
