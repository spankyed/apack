// Offline semantic comparison runs on private snapshots; it never repairs the incumbent being audited.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from './database.ts';
import { searchTable, type SqliteIndexJob } from './index-builds.ts';

export interface SqliteAuditReport {
  scope: 'physical-postings-and-active-derived-contents';
  sequence: number;
  ok: boolean;
  issues: string[];
  comparedIndexes: number;
}
function digest(db: SqliteDatabase, sql: string, parameters: unknown[] = []): string {
  const hash = createHash('sha256'), size = Buffer.alloc(4);
  for (const row of db.statement(sql).iterate(...parameters)) {
    const bytes = db.pack(row); size.writeUInt32BE(bytes.length);
    hash.update(size); hash.update(bytes);
  }
  return hash.digest('hex');
}
function contents(job: SqliteIndexJob): [string, unknown[]] {
  if (job.kind === 'value') return [
    'SELECT entity_id,type,field,value,seq FROM field_index WHERE generation=? ORDER BY entity_id,field,value', [job.generation],
  ];
  if (job.kind === 'vector') return [
    `SELECT entity_id,type,index_name,chunk,model,dims,hash,text,embedding FROM chunks WHERE generation=?
      ORDER BY entity_id,index_name,chunk`, [job.generation],
  ];
  const table = searchTable(job);
  return job.kind === 'text' ? [
    `SELECT entity_id,field,element,body,aliases,owner FROM ${table} ORDER BY entity_id,field,element`, [],
  ] : [`SELECT entity_id,raw,folded FROM ${table}_docs ORDER BY entity_id,raw,folded`, []];
}

/** Internal maintenance slice: active derived contents compared with reconstruction, on two private copies. */
export async function auditSqliteDatabase(source: SqliteDatabase): Promise<SqliteAuditReport> {
  return source.withExclusiveWrites(async () => {
    const root = mkdtempSync(join(tmpdir(), 'ears-sqlite-audit-'));
    let incumbent: SqliteDatabase | undefined, rebuilt: SqliteDatabase | undefined;
    const inspect = async (): Promise<SqliteAuditReport> => {
      const originalPath = join(root, 'incumbent'), rebuiltPath = join(root, 'rebuilt');
      source.backup(originalPath);
      incumbent = new SqliteDatabase({ path: originalPath, readOnly: true });
      const report: SqliteAuditReport = { scope: 'physical-postings-and-active-derived-contents', sequence: incumbent.sequence, ok: false, issues: [], comparedIndexes: 0 };
      for (const row of incumbent.all('PRAGMA integrity_check(100)')) {
        const message = String(Object.values(row)[0]); if (message !== 'ok') report.issues.push(message);
      }
      const jobs = incumbent.indexBuilds.jobs();
      for (const job of jobs) if (job.state !== 'ready') report.issues.push(`${job.type}.${job.name}: ${job.state}`);
      if (report.issues.length) return report;
      // FTS5's integrity command uses INSERT syntax, so run it only on the private writable snapshot.
      // rank=1 also compares external-content trigram postings against their documents (SQLite FTS5 §6.7).
      incumbent.close();
      incumbent = new SqliteDatabase({ path: originalPath, syncs: false });
      incumbent.indexBuilds.stop();
      for (const job of jobs) if (job.kind === 'text' || job.kind === 'trigram') {
        const table = searchTable(job);
        try { incumbent.run(`INSERT INTO ${table}(${table},rank) VALUES('integrity-check',1)`); }
        catch (error) {
          if ((error as { code?: string })?.code !== 'SQLITE_CORRUPT_VTAB') throw error;
          report.issues.push(`${job.type}.${job.name}: ${job.kind} posting integrity failed`);
        }
      }
      incumbent.backup(rebuiltPath);
      rebuilt = new SqliteDatabase({ path: rebuiltPath, syncs: false });
      rebuilt.rebuildIndexes(); await rebuilt.indexesReady();
      for (const job of jobs) {
        const fresh = rebuilt.indexBuilds.index(job.type, job.kind, job.name);
        const [before, beforeArgs] = contents(job), [after, afterArgs] = contents(fresh);
        if (digest(incumbent, before, beforeArgs) !== digest(rebuilt, after, afterArgs))
          report.issues.push(`${job.type}.${job.name}: derived ${job.kind} contents differ from primary reconstruction`);
        report.comparedIndexes++;
      }
      report.ok = report.issues.length === 0;
      return report;
    };
    let report: SqliteAuditReport | undefined, failure: unknown, failed = false;
    try { report = await inspect(); } catch (error) { failed = true; failure = error; }
    const cleanup: unknown[] = [];
    for (const db of [rebuilt, incumbent]) try { db?.close(); } catch (error) { cleanup.push(error); }
    try { rmSync(root, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
    if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup,
      'SQLite audit cleanup failed', { cause: failed ? failure : cleanup[0] });
    if (failed) throw failure;
    return report!;
  });
}
