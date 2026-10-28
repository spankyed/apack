// One owning scheduler advances persistent value/search generations in short transactions.
// Primary values remain authoritative; incomplete value indexes fall back, search reports readiness explicitly.
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';

export type SqliteIndexKind = 'value' | 'text' | 'trigram' | 'vector';
export interface SqliteIndexSpec {
  type: string;
  name: string;
  kind: SqliteIndexKind;
  definition: Record<string, any>;
}
export interface SqliteIndexJob extends SqliteIndexSpec {
  generation: number;
  state: 'building' | 'ready' | 'failed';
  afterSeq: number;
  throughSeq: number;
  error: string | null;
}
export interface SqliteIndexBuild {
  type: string;
  field: string;
  generation: number;
  state: SqliteIndexJob['state'];
  afterSeq: number;
  throughSeq: number;
  error: string | null;
}
interface SqliteIndexState { generations: ReadonlyMap<string, number>; retries: ReadonlySet<number>; pending: boolean }
const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
export function searchTable(index: SqliteIndexSpec & { generation: number }): string {
  return (index.kind === 'trigram' ? 'tri_' : 'fts_') + createHash('sha256')
    .update(JSON.stringify([index.type, index.name, index.definition, index.generation])).digest('hex').slice(0, 24);
}

export class SqliteIndexBuilds {
  private generations: ReadonlyMap<string, number> = new Map();
  private timer?: NodeJS.Immediate;
  private retry?: NodeJS.Timeout;
  private stopped = false;
  private pending = false;
  private preferGC = false;
  private readonly retries = new Set<number>();
  private readonly waiters = new Set<{ resolve(): void; reject(error: unknown): void }>();
  lastError?: unknown;
  readonly batchRows = 32;
  readonly sliceMs = 4;

  private readonly db: SqliteDatabase;
  private readonly canRun: () => boolean;
  private readonly checkRevision: () => void;
  private readonly refile: (id: string, type: string, seq: number, field: string, generation: number) => void;
  constructor(db: SqliteDatabase, canRun: () => boolean, checkRevision: () => void,
    refile: (id: string, type: string, seq: number, field: string, generation: number) => void) {
    this.db = db; this.canRun = canRun; this.checkRevision = checkRevision; this.refile = refile;
    if (db.readOnly && (!db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='index_builds'") ||
        !db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='index_gc'"))) fail('CORRUPT', 'Missing index generation catalog');
    if (!db.readOnly) db.sql.exec(`
      CREATE TABLE IF NOT EXISTS index_builds(generation INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,
        kind TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('building','ready','failed')),
        after_seq INTEGER NOT NULL,through_seq INTEGER NOT NULL,error TEXT,UNIQUE(type,kind,name));
      CREATE TABLE IF NOT EXISTS index_gc(generation INTEGER PRIMARY KEY,type TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,reusable INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS index_build_state ON index_builds(state,generation);`);
    this.reload();
  }
  private key(type: string, field: string): string { return JSON.stringify([type, field]); }
  private specKey(index: SqliteIndexSpec): string { return JSON.stringify([index.type, index.kind, index.name]); }
  private job(row: Record<string, any>): SqliteIndexJob {
    let definition: unknown;
    try { definition = JSON.parse(String(row.definition)); } catch { return fail('CORRUPT', 'Invalid index definition metadata'); }
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) ||
        !['value', 'text', 'trigram', 'vector'].includes(row.kind) || !Number.isSafeInteger(row.generation) || row.generation < 1 ||
        !['building', 'ready', 'failed'].includes(row.state) || !Number.isSafeInteger(row.after_seq) ||
        !Number.isSafeInteger(row.through_seq) || row.after_seq < 0 || row.through_seq < row.after_seq)
      return fail('CORRUPT', 'Invalid index generation metadata');
    return { type: String(row.type), kind: row.kind, name: String(row.name), definition: definition as Record<string, any>,
      generation: row.generation, state: row.state, afterSeq: Number(row.after_seq), throughSeq: Number(row.through_seq),
      error: row.error === null ? null : String(row.error) };
  }
  private nextGC(): Record<string, any> | undefined {
    // Keep the latest complete vector generation available to an incomplete replacement. Older or partial
    // generations remain collectable; failed replacements do not spin forever on deferred retirement.
    return this.db.get(`SELECT g.* FROM index_gc g WHERE g.kind!='vector' OR g.reusable=0 OR
      EXISTS(SELECT 1 FROM index_gc newer WHERE newer.kind='vector' AND newer.type=g.type AND newer.name=g.name AND newer.reusable=1 AND newer.generation>g.generation) OR
      NOT EXISTS(SELECT 1 FROM index_builds active WHERE active.type=g.type AND active.kind='vector' AND active.name=g.name AND active.state!='ready')
      ORDER BY g.generation LIMIT 1`);
  }
  private hasWork(): boolean {
    return this.retries.size > 0 || this.db.get("SELECT 1 FROM index_builds WHERE state='building' LIMIT 1") !== undefined ||
      this.nextGC() !== undefined;
  }
  /** Prepare caches while admission can still roll back. Acceptance after COMMIT performs no IO. */
  readState(): SqliteIndexState {
    const rows = this.db.all('SELECT type,name,kind,generation,state FROM index_builds');
    const retries = new Set(rows.filter(row => this.retries.has(Number(row.generation))).map(row => Number(row.generation)));
    return { generations: new Map(rows.filter(row => row.kind === 'value').map(row =>
      [this.key(String(row.type), String(row.name)), Number(row.generation)])), retries,
      pending: retries.size > 0 || rows.some(row => row.state === 'building') || this.nextGC() !== undefined };
  }
  acceptState(state: SqliteIndexState): void {
    this.generations = state.generations; this.pending = state.pending;
    this.retries.clear(); for (const generation of state.retries) this.retries.add(generation);
  }
  reload(): void { this.acceptState(this.readState()); }
  generation(type: string, field: string): number | undefined { return this.generations.get(this.key(type, field)); }
  ready(type: string, field: string): boolean {
    if (this.generation(type, field) === undefined) return false;
    return this.db.get("SELECT 1 FROM index_builds WHERE type=? AND name=? AND kind='value' AND state='ready'", [type, field]) !== undefined;
  }
  index(type: string, kind: SqliteIndexKind, name: string): SqliteIndexJob {
    const row = this.db.get('SELECT * FROM index_builds WHERE type=? AND kind=? AND name=?', [type, kind, name]);
    if (!row) return fail('CORRUPT', `Missing index generation for ${type}.${name}`);
    return this.job(row);
  }
  requireReady(type: string, kind: SqliteIndexKind, name: string): SqliteIndexJob {
    this.db.trackRange(`rows:${type}`);
    const job = this.index(type, kind, name);
    if (job.state !== 'ready') fail(job.state === 'failed' ? 'INDEX_FAILED' : 'INDEX_BUILDING',
      `${type}.${name} ${job.state === 'failed' ? 'failed: ' + job.error : 'is being indexed'}`);
    return job;
  }
  statuses(): SqliteIndexBuild[] {
    return this.jobs().filter(j => j.kind === 'value').map(j => ({ type: j.type, field: j.name, generation: j.generation,
      state: j.state, afterSeq: j.afterSeq, throughSeq: j.throughSeq, error: j.error }));
  }
  jobs(): SqliteIndexJob[] { return this.db.all('SELECT * FROM index_builds ORDER BY generation').map(row => this.job(row)); }
  matches(specs: readonly SqliteIndexSpec[]): boolean {
    const current = this.jobs(), desired = new Map(specs.map(spec => [this.specKey(spec), JSON.stringify(spec.definition)]));
    return current.length === desired.size && current.every(job => desired.get(this.specKey(job)) === JSON.stringify(job.definition));
  }
  /** Retire private generations rather than clearing a live index inside schema admission. */
  private retire(job: SqliteIndexJob): void {
    this.db.run('INSERT INTO index_gc VALUES (?,?,?,?,?,?)', [job.generation, job.type, job.kind, job.name, JSON.stringify(job.definition), Number(job.state === 'ready')]);
    this.db.run('DELETE FROM index_builds WHERE generation=?', [job.generation]);
  }
  admit(specs: readonly SqliteIndexSpec[]): void {
    const desired = new Map(specs.map(spec => [this.specKey(spec), spec])), current = this.jobs();
    for (const job of current) {
      const next = desired.get(this.specKey(job));
      if (!next || JSON.stringify(next.definition) !== JSON.stringify(job.definition)) this.retire(job);
      else desired.delete(this.specKey(job));
    }
    const through = Number(this.db.get('SELECT coalesce(max(seq),0) n FROM entities')!.n);
    for (const spec of desired.values()) this.insert(spec, through);
  }
  private insert(spec: SqliteIndexSpec, through: number): void {
    const populated = this.db.get('SELECT 1 FROM entities WHERE type=? LIMIT 1', [spec.type]) !== undefined;
    this.db.run('INSERT INTO index_builds(type,kind,name,definition,state,after_seq,through_seq,error) VALUES (?,?,?,?,?,0,?,NULL)',
      [spec.type, spec.kind, spec.name, JSON.stringify(spec.definition), populated ? 'building' : 'ready', through]);
  }
  /** Missing physical groups get a new private generation; no partially trusted postings are reused. */
  restart(jobs: readonly SqliteIndexJob[]): void {
    const through = Number(this.db.get('SELECT coalesce(max(seq),0) n FROM entities')!.n);
    for (const job of jobs) { this.retire(job); this.insert(job, through); }
  }
  resume(): void {
    if (!this.db.readOnly) for (const row of this.db.all("SELECT generation FROM index_builds WHERE state='failed'")) this.retries.add(Number(row.generation));
    this.reload(); this.wake();
  }
  /** Wait only for active generations, not retirement. An explicit wait keeps the owning timer alive. */
  indexesReady(): Promise<void> {
    try {
      if (!this.db.isOpen) fail('CLOSED', 'The database is closed');
      this.checkRevision();
      if (!this.canRun()) fail('UNIT_OPEN', 'Commit or abort the open unit before waiting for indexes');
      const unfinished = this.jobs().filter(job => job.state !== 'ready');
      this.checkRevision();
      if (!unfinished.length) return Promise.resolve();
      if (this.stopped) throw this.lastError ?? Object.assign(new Error('Index scheduler is stopped'), { code: 'CLOSED' });
      const failed = unfinished.find(job => job.state === 'failed' && !this.retries.has(job.generation));
      if (failed) fail('INDEX_FAILED', String(failed.error));
      if (this.db.readOnly) fail('INDEX_BUILDING', 'A writable owner must finish indexing');
      this.pending = true;
      return new Promise<void>((resolve, reject) => { this.waiters.add({ resolve, reject }); this.wake(); if (this.waiters.size) { this.timer?.ref(); this.retry?.ref(); } });
    } catch (error) { return Promise.reject(error); }
  }
  private settle(): void {
    if (!this.waiters.size) return;
    try {
      const unfinished = this.jobs().filter(job => job.state !== 'ready');
      const failed = unfinished.find(job => job.state === 'failed' && !this.retries.has(job.generation));
      if (!failed && unfinished.length) return;
      for (const waiter of this.waiters) failed ? waiter.reject(Object.assign(new Error(String(failed.error)), { code: 'INDEX_FAILED' })) : waiter.resolve();
      this.waiters.clear(); this.timer?.unref(); this.retry?.unref();
    } catch (error) { this.lastError = error; this.pending = false; this.stop(); }
  }
  wake(): void {
    this.settle();
    if (!this.pending || this.stopped || this.db.readOnly || !this.db.isOpen || this.timer || this.retry || !this.canRun()) return;
    this.timer = setImmediate(() => {
      this.timer = undefined;
      const outcome = this.step();
      if (outcome === 'progress' || (outcome === 'failed' && this.pending)) this.wake();
      if (outcome === 'busy') {
        this.retry = setTimeout(() => { this.retry = undefined; this.wake(); }, 20);
        if (!this.waiters.size) this.retry.unref();
      }
    });
    if (!this.waiters.size) this.timer.unref();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearImmediate(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = undefined; this.retry = undefined;
    for (const waiter of this.waiters) waiter.reject(this.lastError ?? Object.assign(new Error('The database is closed'), { code: 'CLOSED' }));
    this.waiters.clear();
  }
  step(): 'progress' | 'idle' | 'paused' | 'busy' | 'failed' {
    if (this.stopped || !this.db.isOpen || this.db.readOnly || !this.canRun()) return 'paused';
    let begun = false, job: SqliteIndexJob | undefined, changed: string | undefined;
    try {
      this.db.sql.exec('BEGIN IMMEDIATE'); begun = true; this.checkRevision();
      const gc = this.preferGC ? this.nextGC() : undefined;
      const row = gc ? undefined : this.db.get(`SELECT * FROM index_builds WHERE state='building' OR generation IN (SELECT value FROM json_each(?)) ORDER BY generation LIMIT 1`, [JSON.stringify([...this.retries])]);
      job = row ? this.job(row) : undefined;
      if (job) {
        const started = performance.now();
        const rows = this.db.all('SELECT id,type,seq FROM entities WHERE type=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?',
          [job.type, job.afterSeq, job.throughSeq, this.batchRows]);
        const fields = job.kind === 'value' ? [job.name] : this.db.search.indexFields(job.definition);
        const values = job.kind === 'value' ? undefined : this.db.hydrate(rows as Array<{ id: string; type: string }>, fields);
        let processed = 0, after = job.afterSeq;
        for (let i = 0; i < rows.length; i++) {
          const entity = rows[i];
          if (job.kind === 'value') this.refile(String(entity.id), job.type, Number(entity.seq), job.name, job.generation);
          else this.db.search.refileIndex(values![i], Number(entity.seq), job);
          after = Number(entity.seq); processed++;
          if (performance.now() - started >= this.sliceMs) break;
        }
        const ready = processed === rows.length && rows.length < this.batchRows;
        this.db.run('UPDATE index_builds SET after_seq=?,state=?,error=NULL WHERE generation=?', [after, ready ? 'ready' : 'building', job.generation]);
        if (ready && job.kind !== 'value') changed = job.type;
        this.preferGC = true;
      } else {
        const retired = gc ?? this.nextGC();
        if (!retired) { this.db.sql.exec('ROLLBACK'); this.pending = false; this.settle(); return 'idle'; }
        const old = this.job({ ...retired, state: 'ready', after_seq: 0, through_seq: 0, error: null });
        let complete: boolean;
        if (old.kind === 'value') complete = Number(this.db.run(`DELETE FROM field_index WHERE rowid IN
          (SELECT rowid FROM field_index WHERE type=? AND field=? AND generation=? LIMIT ?)`, [old.type, old.name, old.generation, this.batchRows]).changes) < this.batchRows;
        else complete = this.db.search.collectIndex(old, this.batchRows);
        if (complete) this.db.run('DELETE FROM index_gc WHERE generation=?', [old.generation]);
        this.preferGC = false;
      }
      this.db.sql.exec('COMMIT');
      if (job) this.retries.delete(job.generation);
      if (changed) this.db.indexesChanged(changed);
      this.settle(); return 'progress';
    } catch (error) {
      if (begun && this.db.sql.inTransaction) {
        try { this.db.sql.exec('ROLLBACK'); }
        catch (rollback) { this.lastError = Object.assign(new AggregateError([error, rollback], 'Index batch and rollback failed', { cause: error }), { code: (error as { code?: unknown })?.code }); this.pending = false; this.stop(); return 'failed'; }
      }
      const code = (error as { code?: unknown })?.code;
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return 'busy';
      this.lastError = error; this.pending = false;
      if (code === 'SCHEMA_CHANGED') { this.stop(); return 'failed'; }
      if (job) {
        this.retries.delete(job.generation);
        try {
          this.db.run("UPDATE index_builds SET state='failed',error=? WHERE generation=?", [error instanceof Error ? error.message : String(error), job.generation]);
          this.pending = this.hasWork();
          if (job.kind !== 'value') this.db.indexesChanged(job.type);
        } catch (report) {
          this.lastError = Object.assign(new AggregateError([error, report], 'Index batch failed and its failure could not be recorded', { cause: error }), { code: (error as { code?: unknown })?.code });
          this.pending = false; this.stop(); return 'failed';
        }
      }
      if (!job) this.stop();
      else this.settle();
      return 'failed';
    }
  }
}
