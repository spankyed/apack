import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteValues } from '../../src/sqlite/values.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const paths: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function root() { const path = mkdtempSync(join(tmpdir(), 'ears-database-identity-')); paths.push(path); return path; }
function openFailure(path: string, readOnly: boolean) {
  let db: SqliteDatabase | undefined;
  try { db = new SqliteDatabase({ path, readOnly, syncs: false }); }
  catch (error) { return error; }
  finally { db?.close(); }
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite database identity', () => {
  it('persists the application identity and current format before normal reopen', () => {
    const path = root(), db = new SqliteDatabase({ path, syncs: false }); db.close();
    const sql = new NativeDatabase(join(path, 'data.sqlite3'), { readonly: true });
    try {
      expect(sql.pragma('application_id', { simple: true })).toBe(0x45415253); // EARS
      expect(sql.pragma('user_version', { simple: true })).toBe(1);
    } finally { sql.close(); }
    const readOnly = new SqliteDatabase({ path, readOnly: true }); readOnly.close();
  });

  it.each([false, true])('refuses a foreign valid SQLite database without initializing or changing it (readOnly=%s)', readOnly => {
    const path = root(), file = join(path, 'data.sqlite3'), foreign = new NativeDatabase(file);
    foreign.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('keep this data')"); foreign.close();
    const before = readFileSync(file), names = readdirSync(path).sort();
    expect.soft(openFailure(path, readOnly)).toMatchObject({ code: 'WRONG_FORMAT' });
    expect.soft(readFileSync(file)).toEqual(before);
    expect(readdirSync(path).sort()).toEqual(names);
  });

  it.each([
    ['application_id', 0], ['application_id', 0x12345678], ['user_version', 0], ['user_version', 2],
  ] as const)('refuses an owned-looking database with %s=%i without repairing its identity', (pragma, value) => {
    const path = root(), file = join(path, 'data.sqlite3'), db = new SqliteDatabase({ path, syncs: false }); db.close();
    const raw = new NativeDatabase(file); raw.pragma(`${pragma}=${value}`); raw.close();
    const before = readFileSync(file);
    expect.soft(openFailure(path, false)).toMatchObject({ code: 'WRONG_FORMAT' });
    expect(readFileSync(file)).toEqual(before);
  });

  it('rolls back identity and every primary initializer together, preserving the original refusal', () => {
    const path = root(), file = join(path, 'data.sqlite3');
    const full = Object.assign(new Error('injected initialization storage refusal'), { code: 'SQLITE_FULL' });
    const initialize = vi.spyOn(SqliteValues.prototype, 'initialize').mockImplementationOnce(() => { throw full; });
    expect(openFailure(path, false)).toBe(full);
    initialize.mockRestore();
    const raw = new NativeDatabase(file, { readonly: true });
    try {
      expect(raw.pragma('application_id', { simple: true })).toBe(0);
      expect(raw.pragma('user_version', { simple: true })).toBe(0);
      expect(raw.prepare('SELECT count(*) n FROM sqlite_schema').get()).toEqual({ n: 0 });
    } finally { raw.close(); }
    const retry = new SqliteDatabase({ path, syncs: false }); retry.close();
    const reopened = new SqliteDatabase({ path, readOnly: true }); reopened.close();
  });

  it.each(['meta', 'entities', 'relations', 'embedding_values', 'value_types', 'value_fields', 'value_overflow', 'admitted type values'])(
    'refuses missing authoritative %s without recreating it', storage => {
      const path = root(), file = join(path, 'data.sqlite3'), db = new SqliteDatabase({ path, syncs: false,
        schema: toElmdbSchema({ types: { Note: { required: [], fields: { body: { type: 'string' } } } }, relations: {}, roles: [] }) });
      createEarsEngine({ database: db }).create('Note', { id: 'Note-held', body: 'surviving primary data' });
      const table = storage === 'admitted type values' ? db.values.layout('Note')!.table : storage;
      db.sql.exec(`DROP TABLE ${table}`); db.close();
      const before = readFileSync(file);
      expect.soft(openFailure(path, false)).toMatchObject({ code: 'CORRUPT' });
      expect(readFileSync(file)).toEqual(before);
      const raw = new NativeDatabase(file, { readonly: true });
      try { expect(raw.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(table)).toBeUndefined(); }
      finally { raw.close(); }
    });

  it('refuses an unclaimed empty file on a read-only open without initializing it', () => {
    const path = root(), file = join(path, 'data.sqlite3'), raw = new NativeDatabase(file); raw.close();
    const before = readFileSync(file);
    expect.soft(openFailure(path, true)).toMatchObject({ code: 'WRONG_FORMAT' });
    expect(readFileSync(file)).toEqual(before);
  });


  it.each([false, true])('preserves a foreign committed WAL after its writer dies (readOnly=%s)', readOnly => {
    const path = root(), file = join(path, 'data.sqlite3'), wal = file + '-wal';
    const driver = createRequire(import.meta.url).resolve('better-sqlite3');
    const child = spawnSync(process.execPath, ['-e', `
      const Database = require(${JSON.stringify(driver)}), fs = require('node:fs');
      const db = new Database(${JSON.stringify(file)});
      db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('committed foreign data')");
      fs.writeSync(1, 'committed'); process.kill(process.pid, 'SIGKILL');
    `], { encoding: 'utf8', timeout: 5000 });
    expect(child.error).toBeUndefined();
    expect(child.stdout).toBe('committed');
    expect(existsSync(wal)).toBe(true);
    const before = readFileSync(file), committed = readFileSync(wal);
    expect(committed.length).toBeGreaterThan(0);
    expect.soft(openFailure(path, readOnly)).toMatchObject({ code: 'WRONG_FORMAT' });
    expect.soft(readFileSync(file)).toEqual(before);
    expect(existsSync(wal)).toBe(true);
    expect(readFileSync(wal)).toEqual(committed);
  });

});
