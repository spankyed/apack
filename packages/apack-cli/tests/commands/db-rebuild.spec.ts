import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EarsDatabase, type EARS } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { holdDatabaseWriteLock } from '@apackdev/host/database';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { runHistoryAt } from '../_support/run-history.ts';
import { dbAudit } from '../../src/commands/db/audit';
import { dbRebuild } from '../../src/commands/db/rebuild';

const paths: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'apack-db-rebuild-')); paths.push(path);
  vi.stubEnv('APACK_STORAGE_FORMAT', 'sqlite/1'); vi.stubEnv('APACK_USER_DATA_DIR', path);
  const directory = _appDataPaths(path).lmdb;
  const db = openDatabase({ path: directory, syncs: false, schema: { types: {
    Row: { required: [], search: { fields: { title: 1 } } },
  }, relations: {}, roles: [] } });
  const e = createEarsEngine({ database: db });
  e.create('Row', { id: 'Row-one', title: 'needle' });
  const sequence = e.lastCommit(); db.close();
  const observer = openDatabase({ path: directory, readOnly: true }); opened.push(observer);
  const output: string[] = [], errors: string[] = [];
  return { path, directory, sequence, observer: createEarsEngine({ database: observer }),
    output, errors, io: { out: (text: string) => output.push(text), err: (text: string) => errors.push(text) } };
}
it('dry runs without changing generations, then rebuilds the named SQLite profile and awaits readiness', async () => {
  const f = fixture();
  await dbRebuild(['--data-dir', f.path], f.io);
  expect(f.output.join('\n')).toContain('Dry run: nothing was changed');
  expect(f.observer.query('Row').count()).toBe(1);
  await dbRebuild(['--data-dir', f.path, '--force'], f.io);
  expect(f.output.at(-1)).toBe('Rebuilt derived indexes; all current generations are ready.');
  expect(() => f.observer.query('Row').count()).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGED' }));
  const reopened = openDatabase({ path: f.directory, readOnly: true }); opened.push(reopened);
  const e = createEarsEngine({ database: reopened });
  expect(e.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
  expect(e.lastCommit()).toBe(f.sequence);
});
it('refuses an existing managed writer before admitting a rebuild', async () => {
  const f = fixture(), lock = holdDatabaseWriteLock(f.path, 'other writer');
  try { await expect(dbRebuild(['--data-dir', f.path, '--force'], f.io)).rejects.toThrow('other writer'); }
  finally { lock.release(); }
  expect(f.observer.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
  expect(f.observer.lastCommit()).toBe(f.sequence);
  expect(f.output).toEqual([]);
});
it('refuses unexpected positional arguments before opening storage', async () => {
  await expect(dbRebuild(['unexpected'], { out: vi.fn(), err: vi.fn() })).rejects.toThrow('Unexpected argument unexpected');
});

it.each(['runs', 'all'])('rebuilds selected %s stores and retains the run history', async selection => {
  const f = fixture(), path = _appDataPaths(f.path).runHistory;
  const history = runHistoryAt(path);
  history.put({ id: 'RunNode-retained', kind: 'flow', label: 'retained', status: 'completed', startedAt: 1 });
  const sequence = history.database.sequence; history.close();
  await dbRebuild(['--data-dir', f.path, '--database', selection, '--force'], f.io);
  expect(f.output.some(line => line.startsWith('runs: Rebuilt'))).toBe(true);
  expect(f.output.some(line => line.startsWith('primary: Rebuilt'))).toBe(selection === 'all');
  const reopened = runHistoryAt(path, { readOnly: true });
  try {
    expect(reopened.get('RunNode-retained')).toMatchObject({ label: 'retained' });
    expect(reopened.database.sequence).toBe(sequence);
  } finally { reopened.close(); }
  if (selection === 'runs') expect(f.observer.query('Row').count()).toBe(1);
  else expect(() => f.observer.query('Row').count()).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGED' }));
});
it('refuses an absent selected history before rebuilding the primary store', async () => {
  const f = fixture();
  await expect(dbRebuild(['--data-dir', f.path, '--database', 'all', '--force'], f.io)).rejects.toThrow('No run history database');
  expect(f.observer.query('Row').count()).toBe(1);
  expect(f.output).toEqual([]);
});

it('audits a real read-only profile and reports its snapshot without changing generations', async () => {
  const f = fixture();
  await dbAudit(['--data-dir', f.path, '--json'], f.io);
  expect(f.output).toHaveLength(1);
  expect(JSON.parse(f.output[0]!)).toMatchObject({ database: 'primary', ok: true, sequence: f.sequence, checkedEntities: 1 });
  expect(f.observer.query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']);
  expect(f.observer.lastCommit()).toBe(f.sequence);
});
it('prints audit findings and fails without repairing a deliberately loaded dangling relation', async () => {
  const f = fixture(), writable = openDatabase({ path: f.directory });
  const e = createEarsEngine({ database: writable });
  e.admin.bulkLoadRelation('Relation-dangling' as EARS.RelationId, 'repair-fixture', 'Row-one' as EARS.EntityId, 'Row-missing' as EARS.EntityId);
  const before = e.lastCommit(); writable.close();
  await expect(dbAudit(['--data-dir', f.path, '--json'], f.io)).rejects.toThrow('Audit found issues in primary; no repairs were made');
  const report = JSON.parse(f.output[0]!);
  expect(report.ok).toBe(false); expect(report.issues).toContain('Relation-dangling: relation endpoint is missing');
  const reopened = openDatabase({ path: f.directory, readOnly: true }); opened.push(reopened);
  expect(reopened.sequence).toBe(before);
  expect(createEarsEngine({ database: reopened }).findRelations()).toHaveLength(1);
});
it('refuses audit while another managed writer owns the profile', async () => {
  const f = fixture(), lock = holdDatabaseWriteLock(f.path, 'other writer');
  try { await expect(dbAudit(['--data-dir', f.path], f.io)).rejects.toThrow('other writer'); }
  finally { lock.release(); }
  expect(f.output).toEqual([]);
  expect(f.observer.query('Row').count()).toBe(1);
});
