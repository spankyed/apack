import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRunHistory } from '../../src/database/open.ts';
import { databaseStorage } from '../../src/database/storage.ts';
import type { EarsDatabase } from '@apackdev/ears';
import * as recovery from '../../src/backup/recovery.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(format: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-quarantine-publication-')); roots.push(root);
  const dir = path.join(root, 'run-history'), db = openRunHistory(dir, { storageFormat: format }); db.database.close();
  const file = path.join(dir, format === 'sqlite/1' ? 'data.sqlite3' : 'data.mdb');
  fs.writeFileSync(file, Buffer.alloc(16384, 7));
  return { root, dir, file, before: fs.readFileSync(file), aside: () => fs.readdirSync(root).filter(name => name.startsWith('run-history.unreadable-')) };
}
describe.each(['elmdb/1', 'sqlite/1'])('quarantine publication (%s)', format => {
  it('syncs the rename before opening a replacement and the parent after creating it', () => {
    const f = fixture(format), sync = recovery.syncRecoveryDirectory, states: boolean[] = [];
    vi.spyOn(recovery, 'syncRecoveryDirectory').mockImplementation(dir => {
      expect(dir).toBe(f.root); expect(f.aside()).toHaveLength(1);
      states.push(fs.existsSync(f.dir)); sync(dir);
    });
    const replacement = openRunHistory(f.dir, { storageFormat: format });
    try { expect(states).toEqual([false, true]); expect(fs.readFileSync(path.join(f.root, f.aside()[0], path.basename(f.file)))).toEqual(f.before); }
    finally { replacement.database.close(); }
  });
  it.each([0, 1])('reports publication uncertainty and retains the quarantine when parent sync %i fails', failAt => {
    const f = fixture(format), failure = Object.assign(new Error('injected parent sync failure'), { code: 'EIO' });
    const sync = recovery.syncRecoveryDirectory; let calls = 0;
    vi.spyOn(recovery, 'syncRecoveryDirectory').mockImplementation(dir => { if (calls++ === failAt) throw failure; sync(dir); });
    let caught: unknown;
    try { const unexpected = openRunHistory(f.dir, { storageFormat: format }); unexpected.database.close(); }
    catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'PUBLICATION_NOT_DURABLE', cause: failure, quarantinePath: path.join(f.root, f.aside()[0]) });
    expect((caught as AggregateError).errors).toContain(failure);
    expect(fs.readFileSync(path.join(f.root, f.aside()[0], path.basename(f.file)))).toEqual(f.before);
    expect(fs.readdirSync(path.join(f.root, 'db-readers'))).toEqual([]);
    expect(fs.existsSync(path.join(f.root, 'db-recovery.lock'))).toBe(false);
    expect(fs.existsSync(f.dir)).toBe(failAt === 1);
  });
  it('retains directory authority if publication cleanup cannot close the replacement', () => {
    const f = fixture(format), sync = recovery.syncRecoveryDirectory;
    const failure = new Error('injected publication sync failure'), cleanup = new Error('injected close failure');
    let calls = 0, held: EarsDatabase | undefined;
    vi.spyOn(recovery, 'syncRecoveryDirectory').mockImplementation(dir => { if (calls++ === 1) throw failure; sync(dir); });
    const storage = databaseStorage(format), open = storage.open.bind(storage);
    vi.spyOn(storage, 'open').mockImplementation(options => {
      const db = open(options), close = db.close.bind(db);
      db.close = vi.fn(close).mockImplementationOnce(() => { throw cleanup; }); held = db; return db;
    });
    try {
      let caught: unknown;
      try { openRunHistory(f.dir, { storageFormat: format }); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ code: 'PUBLICATION_NOT_DURABLE', databaseConnectionUnclosed: true, cause: failure });
      expect((caught as AggregateError).errors).toContain(cleanup);
      expect(fs.readdirSync(path.join(f.root, 'db-readers'))).toHaveLength(1);
      expect(fs.readFileSync(path.join(f.root, f.aside()[0], path.basename(f.file)))).toEqual(f.before);
    } finally { held?.close(); }
    expect(fs.readdirSync(path.join(f.root, 'db-readers'))).toEqual([]);
  });

});
