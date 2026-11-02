import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import NativeDatabase from 'better-sqlite3';
import { createEarsEngine } from '../../src/index.ts';
import { openDatabase, createTemporaryDatabases, DATABASE_FORMAT } from '../../src/sqlite/index.ts';

const schema = { types: { Note: { required: [] } }, relations: {}, roles: [] };
describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('the SQLite package entry', () => {
  it('opens an engine through the public factory and reopens it read-only', () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-sqlite-entry-'));
    try {
      const database = openDatabase({ path, schema, syncs: false });
      const e = createEarsEngine({ database });
      const id = e.create('Note', { title: 'held' }).id();
      database.close();
      const readOnly = openDatabase({ path, readOnly: true });
      try {
        expect(createEarsEngine({ database: readOnly }).getAttr(id, 'title')).toBe('held');
        expect(() => createEarsEngine({ database: readOnly }).write(id).set('title', 'bad'))
          .toThrow(expect.objectContaining({ code: 'READ_ONLY' }));
      } finally { readOnly.close(); }
      expect(DATABASE_FORMAT).toBe('sqlite/1');
    } finally { rmSync(path, { recursive: true, force: true }); }
  });

  it('owns temporary paths and exit listeners only while a database is open', () => {
    const initial = process.listenerCount('exit');
    const temporary = createTemporaryDatabases();
    expect(process.listenerCount('exit')).toBe(initial);
    const first = temporary.open(schema), second = temporary.open(schema);
    expect(process.listenerCount('exit')).toBe(initial + 1);
    first.dispose(); first.dispose();
    expect(existsSync(first.database.path)).toBe(false);
    expect(second.database.isOpen).toBe(true);
    temporary.disposeAll();
    expect(existsSync(second.database.path)).toBe(false);
    expect(process.listenerCount('exit')).toBe(initial);
    const later = temporary.open(schema);
    expect(process.listenerCount('exit')).toBe(initial + 1);
    later.dispose();
    expect(process.listenerCount('exit')).toBe(initial);
  });

  it('closes the real native connection when schema admission refuses opening', () => {
    const path = mkdtempSync(join(tmpdir(), 'ears-sqlite-refused-'));
    const close = vi.spyOn(NativeDatabase.prototype, 'close');
    try {
      expect(() => openDatabase({ path, schema: { types: { lowercase: { required: [] } }, relations: {}, roles: [] } }))
        .toThrow(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
      expect(close).toHaveBeenCalledTimes(1);
    } finally { close.mockRestore(); rmSync(path, { recursive: true, force: true }); }
  });

});
