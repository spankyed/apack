// Offline semantic comparison runs on private snapshots; it never repairs the incumbent being audited.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from './database.ts';
import { searchTable, type SqliteIndexJob } from './index-builds.ts';

export interface SqliteAuditReport {
  scope: 'primary-values-and-active-derived-indexes';
  sequence: number;
  ok: boolean;
  issues: string[];
  issueCount: number;
  checkedEntities: number;
  checkedRelations: number;
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
function primaryData(db: SqliteDatabase, report: SqliteAuditReport, issue: (message: string) => void): void {
  let page: Array<{ id: string; type: string }> = [];
  const decode = () => {
    try { db.hydrate(page); }
    catch (error) {
      const code = (error as { code?: string })?.code;
      if (code && code !== 'CORRUPT' && !code.startsWith('SQLITE_CORRUPT')) throw error;
      // Isolate a damaged value only on the exceptional path; healthy pages use grouped reads.
      for (const row of page) try { db.hydrate([row]); }
      catch (cause) {
        const selected = (cause as { code?: string })?.code;
        if (selected && selected !== 'CORRUPT' && !selected.startsWith('SQLITE_CORRUPT')) throw cause;
        issue(`${row.id}: primary values cannot be decoded`);
      }
    }
    page = [];
  };
  for (const value of db.statement('SELECT id,type,seq,trashed FROM entities ORDER BY seq').iterate()) {
    const row = value as { id: string; type: string; seq: number; trashed: number };
    report.checkedEntities++;
    if (typeof row.id !== 'string' || !row.id.startsWith(row.type + '-') || !Number.isSafeInteger(row.seq) || row.seq < 1 ||
        (row.trashed !== 0 && row.trashed !== 1)) issue(`${row.id}: invalid primary catalog record`);
    page.push(row); if (page.length === 128) decode();
  }
  if (page.length) decode();
  for (const value of db.statement(`SELECT r.id,r.info,s.id source_id,t.id target_id FROM relations r
    LEFT JOIN entities s ON s.id=r.source LEFT JOIN entities t ON t.id=r.target ORDER BY r.seq`).iterate()) {
    const row = value as { id: string; info: Uint8Array | null; source_id: string | null; target_id: string | null };
    report.checkedRelations++;
    if (row.source_id === null || row.target_id === null) issue(`${row.id}: relation endpoint is missing`);
    if (row.info !== null) try { db.unpack(row.info); } catch { issue(`${row.id}: relation info cannot be decoded`); }
  }
  for (const row of db.statement(`SELECT o.entity_id FROM value_overflow o LEFT JOIN entities e ON e.id=o.entity_id
    WHERE e.id IS NULL ORDER BY o.entity_id,o.field`).iterate()) issue(`${(row as {entity_id: string}).entity_id}: orphan overflow value`);
  for (const type of db.all('SELECT name FROM value_types')) {
    const layout = db.values.layout(String(type.name));
    if (!layout) { issue(`${type.name}: missing primary layout`); continue; }
    for (const row of db.statement(`SELECT v.entity_id FROM ${layout.table} v LEFT JOIN entities e ON e.id=v.entity_id AND e.type=?
      WHERE e.id IS NULL ORDER BY v.entity_id`).iterate(type.name)) issue(`${(row as {entity_id: string}).entity_id}: orphan primary value row`);
  }
}

function metadataAndEmbeddings(db: SqliteDatabase, issue: (message: string) => void): void {
  const maximum = Number(db.get(`SELECT max(n) n FROM (SELECT coalesce(max(seq),0) n FROM entities
    UNION ALL SELECT coalesce(max(seq),0) n FROM relations)`)!.n);
  let next: unknown;
  for (const row of db.statement('SELECT key,value FROM meta ORDER BY key').iterate()) {
    const entry = row as { key: string; value: Uint8Array };
    let value: unknown;
    try { value = db.unpack(entry.value); } catch { issue(`${entry.key}: metadata cannot be decoded`); continue; }
    if (entry.key === 'seq') next = value;
    if (['seq', 'commit', 'schemaRevision'].includes(entry.key) &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (entry.key === 'seq' ? 1 : 0)))
      issue(`${entry.key}: invalid metadata counter`);
  }
  if (maximum > 0 && (typeof next !== 'number' || next <= maximum)) issue('seq: next identity does not exceed stored primary sequences');
  for (const value of db.statement(`SELECT c.entity_id,c.chunk,c.dims,c.embedding FROM chunks c
    JOIN index_builds j ON j.generation=c.generation WHERE c.embedding IS NOT NULL ORDER BY c.entity_id,c.chunk`).iterate()) {
    const row = value as { entity_id: string; chunk: number; dims: number; embedding: Uint8Array };
    const bytes = row.embedding;
    let valid = Number.isSafeInteger(row.dims) && row.dims > 0 && bytes instanceof Uint8Array && bytes.byteLength === row.dims * 4;
    let nonzero = false;
    if (valid) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 0; offset < view.byteLength; offset += 4) {
        const component = view.getFloat32(offset, true);
        if (!Number.isFinite(component)) { valid = false; break; }
        if (component !== 0) nonzero = true;
      }
    }
    if (!valid || !nonzero) issue(`${row.entity_id} chunk ${row.chunk}: invalid Float32 cosine embedding`);
  }
}

async function rebuildPrivateMembership(db: SqliteDatabase): Promise<void> {
  db.sql.exec('DELETE FROM value_members');
  let after = 0;
  for (;;) {
    const records = db.all('SELECT id,type,seq FROM entities WHERE seq>? ORDER BY seq LIMIT 128', [after]) as Array<{id: string; type: string; seq: number}>;
    if (!records.length) return;
    const rows = db.hydrate(records);
    db.sql.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) for (const [field, value] of Object.entries(row)) for (const member of db.values.members(value))
        db.run('INSERT OR IGNORE INTO value_members VALUES (?,?,?,?)', [row.id, field, member.kind, member.value]);
      db.commitWrite();
    } catch (error) { db.abortFailedOperation(error); }
    after = records.at(-1)!.seq;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
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
      const report: SqliteAuditReport = { scope: 'primary-values-and-active-derived-indexes', sequence: incumbent.sequence, ok: false, issues: [], issueCount: 0, checkedEntities: 0, checkedRelations: 0, comparedIndexes: 0 };
      const issue = (message: string) => { report.issueCount++; if (report.issues.length < 100) report.issues.push(message); };
      for (const row of incumbent.all('PRAGMA integrity_check(100)')) {
        const message = String(Object.values(row)[0]); if (message !== 'ok') issue(message);
      }
      primaryData(incumbent, report, issue);
      metadataAndEmbeddings(incumbent, issue);
      const jobs = incumbent.indexBuilds.jobs();
      for (const job of jobs) if (job.state !== 'ready') issue(`${job.type}.${job.name}: ${job.state}`);
      if (report.issueCount) return report;
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
          issue(`${job.type}.${job.name}: ${job.kind} posting integrity failed`);
        }
      }
      incumbent.backup(rebuiltPath);
      rebuilt = new SqliteDatabase({ path: rebuiltPath, syncs: false });
      rebuilt.rebuildIndexes(); await rebuilt.indexesReady();
      await rebuildPrivateMembership(rebuilt);
      const membership = 'SELECT entity_id,field,kind,value FROM value_members ORDER BY entity_id,field,kind,value';
      if (digest(incumbent, membership) !== digest(rebuilt, membership)) issue('Derived list membership differs from primary arrays');
      for (const job of jobs) {
        const fresh = rebuilt.indexBuilds.index(job.type, job.kind, job.name);
        const [before, beforeArgs] = contents(job), [after, afterArgs] = contents(fresh);
        if (digest(incumbent, before, beforeArgs) !== digest(rebuilt, after, afterArgs))
          issue(`${job.type}.${job.name}: derived ${job.kind} contents differ from primary reconstruction`);
        report.comparedIndexes++;
      }
      report.ok = report.issueCount === 0;
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
