// Persistent value-index generations, advanced in short transactions on the owning foreground connection.
// Foreground writes always maintain the admitted generation; reads use primary values until readiness commits.
import type { SqliteDatabase } from './database.ts';

export interface SqliteValueIndex {
  type: string;
  field: string;
}
export interface SqliteIndexBuild extends SqliteValueIndex {
  generation: number;
  state: 'building' | 'ready' | 'failed';
  afterSeq: number;
  throughSeq: number;
  error: string | null;
}

interface SqliteIndexState {
  generations: ReadonlyMap<string, number>;
  pending: boolean;
}

export class SqliteIndexBuilds {
  private generations: ReadonlyMap<string, number> = new Map();
  private timer?: NodeJS.Immediate;
  private retry?: NodeJS.Timeout;
  private stopped = false;
  private pending = false;
  private retryFailures = false;
  lastError?: unknown;
  readonly batchRows = 32;
  readonly sliceMs = 4;

  constructor(private readonly db: SqliteDatabase, private readonly canRun: () => boolean,
    private readonly checkRevision: () => void,
    private readonly refile: (id: string, type: string, seq: number, field: string, generation: number) => void) {
    if (!db.readOnly) db.sql.exec(`
      CREATE TABLE IF NOT EXISTS value_index_builds(type TEXT NOT NULL,field TEXT NOT NULL,generation INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('building','ready','failed')),after_seq INTEGER NOT NULL,through_seq INTEGER NOT NULL,error TEXT,PRIMARY KEY(type,field));
      CREATE TABLE IF NOT EXISTS value_index_gc(type TEXT NOT NULL,field TEXT NOT NULL,generation INTEGER NOT NULL,
        PRIMARY KEY(type,field,generation));
      CREATE INDEX IF NOT EXISTS value_index_build_state ON value_index_builds(state,generation,type,field);`);
    this.reload();
  }
  private key(type: string, field: string): string { return JSON.stringify([type, field]); }
  /** Prepare cache state while the schema transaction can still roll back; acceptance after COMMIT performs no IO. */
  readState(): SqliteIndexState {
    const rows = this.db.all('SELECT type,field,generation,state FROM value_index_builds');
    return { generations: new Map(rows.map(row => [this.key(String(row.type), String(row.field)), Number(row.generation)])),
      pending: rows.some(row => row.state === 'building' || (this.retryFailures && row.state === 'failed')) || this.db.get('SELECT 1 FROM value_index_gc LIMIT 1') !== undefined };
  }
  acceptState(state: SqliteIndexState): void { this.generations = state.generations; this.pending = state.pending; }
  reload(): void { this.acceptState(this.readState()); }
  generation(type: string, field: string): number | undefined { return this.generations.get(this.key(type, field)); }
  ready(type: string, field: string): boolean {
    if (this.generation(type, field) === undefined) return false;
    return this.db.get("SELECT 1 FROM value_index_builds WHERE type=? AND field=? AND state='ready'", [type, field]) !== undefined;
  }
  statuses(): SqliteIndexBuild[] {
    return this.db.all('SELECT * FROM value_index_builds ORDER BY type,field').map(row => ({
      type: String(row.type), field: String(row.field), generation: Number(row.generation),
      state: row.state as SqliteIndexBuild['state'], afterSeq: Number(row.after_seq), throughSeq: Number(row.through_seq),
      error: row.error === null ? null : String(row.error),
    }));
  }
  /** Called inside the schema transaction; unchanged logical indexes keep their generation and progress. */
  admit(indexes: readonly SqliteValueIndex[], generation: number): void {
    const desired = new Set(indexes.map(index => this.key(index.type, index.field)));
    const existing = this.db.all('SELECT type,field,generation FROM value_index_builds');
    const known = new Set(existing.map(row => this.key(String(row.type), String(row.field))));
    for (const row of existing) if (!desired.has(this.key(String(row.type), String(row.field)))) {
      this.db.run('INSERT OR IGNORE INTO value_index_gc VALUES (?,?,?)', [row.type, row.field, row.generation]);
      this.db.run('DELETE FROM value_index_builds WHERE type=? AND field=?', [row.type, row.field]);
    }
    const through = Number(this.db.get('SELECT coalesce(max(seq),0) n FROM entities')!.n);
    for (const index of indexes) {
      if (known.has(this.key(index.type, index.field))) continue;
      const populated = this.db.get('SELECT 1 FROM entities WHERE type=? LIMIT 1', [index.type]) !== undefined;
      this.db.run('INSERT INTO value_index_builds VALUES (?,?,?,?,?,?,NULL)',
        [index.type, index.field, generation, populated ? 'building' : 'ready', 0, through]);
    }
  }
  /** A fresh owner retries a failed transaction from its last committed cursor. */
  resume(): void {
    this.retryFailures = !this.db.readOnly && this.db.get("SELECT 1 FROM value_index_builds WHERE state='failed' LIMIT 1") !== undefined;
    this.reload();
    this.wake();
  }
  wake(): void {
    if (!this.pending || this.stopped || this.db.readOnly || !this.db.isOpen || this.timer || this.retry || !this.canRun()) return;
    this.timer = setImmediate(() => {
      this.timer = undefined;
      const outcome = this.step();
      if (outcome === 'progress' || (outcome === 'failed' && this.pending)) this.wake();
      if (outcome === 'busy') this.retry = setTimeout(() => { this.retry = undefined; this.wake(); }, 20).unref();
    }).unref();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearImmediate(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = undefined;
    this.retry = undefined;
  }
  /** One bounded batch, exposed internally so contracts can interleave foreground work deterministically. */
  step(): 'progress' | 'idle' | 'paused' | 'busy' | 'failed' {
    if (this.stopped || !this.db.isOpen || this.db.readOnly || !this.canRun()) return 'paused';
    let begun = false;
    let job: ReturnType<SqliteDatabase['get']>;
    try {
      this.db.sql.exec('BEGIN IMMEDIATE');
      begun = true;
      this.checkRevision();
      if (this.retryFailures) {
        this.db.run("UPDATE value_index_builds SET state='building',error=NULL WHERE state='failed'");
      }
      job = this.db.get("SELECT * FROM value_index_builds WHERE state='building' ORDER BY generation,type,field LIMIT 1");
      if (job) {
        const rows = this.db.all(`SELECT id,type,seq FROM entities WHERE type=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?`,
          [job.type, job.after_seq, job.through_seq, this.batchRows]);
        const started = performance.now();
        let processed = 0, after = Number(job.after_seq);
        for (const row of rows) {
          this.refile(String(row.id), String(row.type), Number(row.seq), String(job.field), Number(job.generation));
          after = Number(row.seq);
          processed++;
          if (performance.now() - started >= this.sliceMs) break;
        }
        const ready = processed === rows.length && rows.length < this.batchRows;
        this.db.run('UPDATE value_index_builds SET after_seq=?,state=? WHERE type=? AND field=? AND generation=?',
          [after, ready ? 'ready' : 'building', job.type, job.field, job.generation]);
      } else {
        const gc = this.db.get('SELECT * FROM value_index_gc ORDER BY type,field,generation LIMIT 1');
        if (!gc) { this.db.sql.exec('ROLLBACK'); this.pending = false; this.retryFailures = false; return 'idle'; }
        const result = this.db.run(`DELETE FROM field_index WHERE rowid IN (SELECT rowid FROM field_index
          WHERE type=? AND field=? AND generation=? LIMIT ?)`, [gc.type, gc.field, gc.generation, this.batchRows]);
        if (Number(result.changes) < this.batchRows)
          this.db.run('DELETE FROM value_index_gc WHERE type=? AND field=? AND generation=?', [gc.type, gc.field, gc.generation]);
      }
      this.db.sql.exec('COMMIT');
      this.retryFailures = false;
      return 'progress';
    } catch (error) {
      if (begun && this.db.sql.inTransaction) {
        try { this.db.sql.exec('ROLLBACK'); }
        catch (rollback) {
          this.lastError = new AggregateError([error, rollback], 'Index batch and rollback failed');
          this.pending = false;
          this.stop();
          return 'failed';
        }
      }
      const code = (error as { code?: unknown })?.code;
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return 'busy';
      this.lastError = error;
      this.pending = false;
      this.retryFailures = false;
      if (code === 'SCHEMA_CHANGED') { this.stop(); return 'failed'; }
      if (job) {
        try { this.db.run("UPDATE value_index_builds SET state='failed',error=? WHERE type=? AND field=? AND generation=?",
          [error instanceof Error ? error.message : String(error), job.type, job.field, job.generation]);
          this.pending = this.db.get("SELECT 1 FROM value_index_builds WHERE state='building' LIMIT 1") !== undefined || this.db.get('SELECT 1 FROM value_index_gc LIMIT 1') !== undefined;
        }
        catch (report) { this.lastError = new AggregateError([error, report], 'Index batch failed and its failure could not be recorded'); }
      }
      return 'failed';
    }
  }
}
