import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEarsEngine, type EngineSchema } from '../../src/index.ts';
import { toElmdbSchema } from '../../src/schema.ts';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const held: SqliteDatabase[] = [];
const paths: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of held.splice(0)) db.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const schema: EngineSchema = { types: { Row: { required: [], shortCode: 'OLD' } }, relations: {}, roles: [] };
const next = toElmdbSchema({ ...schema, types: { Row: { required: [], shortCode: 'NEW' } } });
function open(path?: string) {
  if (!path) { path = mkdtempSync(join(tmpdir(), 'ears-schema-admission-')); paths.push(path); }
  const db = new SqliteDatabase({ path, syncs: false, schema: toElmdbSchema(schema) });
  held.push(db);
  return db;
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite schema admission ownership', () => {
  it('allows changing an unused prefix', () => {
    const db = open();
    db.setSchema(next);
    const e = createEarsEngine({ database: db }), id = e.create('Row', {}).id();
    expect(e.getAttr(id, 'shortCode')).toMatch(/^NEW-/);
  });

  it('checks issued prefixes after acquiring writer ownership, including commits with no schema change', () => {
    const db = open(), other = open(db.path), e = createEarsEngine({ database: other });
    const before = db.schema, revision = db.get('SELECT value FROM meta WHERE key=?', ['schemaRevision']);
    const exec = db.sql.exec.bind(db.sql);
    let inserted = false;
    vi.spyOn(db.sql, 'exec').mockImplementation(sql => {
      if (sql === 'BEGIN IMMEDIATE' && !inserted) { inserted = true; e.create('Row', { id: 'Row-first' }); }
      return exec(sql);
    });
    expect(() => db.setSchema(next)).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGE_REFUSED' }));
    expect(inserted).toBe(true);
    expect(db.schema).toEqual(before);
    expect(db.get('SELECT value FROM meta WHERE key=?', ['schemaRevision'])).toEqual(revision);
    expect(db.sql.inTransaction).toBe(false);
    expect(e.getAttr('Row-first', 'shortCode')).toMatch(/^OLD-/);
    expect(createEarsEngine({ database: db }).getAttr('Row-first', 'shortCode')).toMatch(/^OLD-/);
    expect(() => db.setSchema(next)).toThrow(expect.objectContaining({ code: 'SCHEMA_CHANGE_REFUSED' }));
  });
});
