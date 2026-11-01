import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from '../../src/sqlite/database.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ears-file-ownership-')); roots.push(root);
  const path = join(root, 'store'), database = new SqliteDatabase({ path, syncs: false }); database.close();
  return { root, path, file: join(path, 'data.sqlite3') };
}
const names = ['data.sqlite3', 'data.sqlite3-wal', 'data.sqlite3-shm', 'data.sqlite3-journal'];
function refusal(path: string, readOnly: boolean) {
  let database: SqliteDatabase | undefined;
  try { database = new SqliteDatabase({ path, readOnly }); }
  catch (error) { return error; }
  finally { database?.close(); }
}

describe.runIf(process.env.EARS_EVALUATION_BACKEND === 'sqlite')('SQLite file ownership', () => {
  for (const readOnly of [false, true]) for (const name of names) {
    it.each(['symlink', 'hard link', 'directory', 'dangling symlink'] as const)(
      `refuses %s at ${name} before opening (readOnly=${readOnly})`, kind => {
        const { root, path, file } = fixture(), entry = join(path, name), outside = join(root, 'outside');
        copyFileSync(file, outside); const before = readFileSync(outside);
        rmSync(entry, { force: true });
        if (kind === 'symlink') symlinkSync(outside, entry, 'file');
        else if (kind === 'hard link') linkSync(outside, entry);
        else if (kind === 'directory') mkdirSync(entry);
        else { rmSync(outside); symlinkSync(outside, entry, 'file'); }
        expect.soft(refusal(path, readOnly)).toMatchObject({ code: 'IO' });
        if (kind === 'dangling symlink') expect(existsSync(outside)).toBe(false);
        else expect(readFileSync(outside)).toEqual(before);
      });
  }
  it.runIf(process.platform !== 'win32').each(names)('refuses a FIFO at %s without blocking the native opener', name => {
    const { path } = fixture(), entry = join(path, name); rmSync(entry, { force: true });
    expect(spawnSync('mkfifo', [entry]).status).toBe(0);
    // A synchronous native open cannot be interrupted by a test deadline. Bound the child instead.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { SqliteDatabase } from ${JSON.stringify(new URL('../../src/sqlite/database.ts', import.meta.url).href)};
      try { const db = new SqliteDatabase({ path: process.argv[1] }); db.close(); console.log('opened'); }
      catch (error) { console.log(error.code); }
    `, path], { encoding: 'utf8', timeout: 5_000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stdout.trim()).toBe('IO');
  });
  it.each([false, true])('refuses orphan sidecars before creating a main file (readOnly=%s)', readOnly => {
    const { path, file } = fixture(); rmSync(file);
    const wal = file + '-wal'; writeFileSync(wal, 'unclaimed sidecar');
    expect.soft(refusal(path, readOnly)).toMatchObject({ code: 'IO' });
    expect(existsSync(file)).toBe(false); expect(readFileSync(wal, 'utf8')).toBe('unclaimed sidecar');
  });
  it.each(names)('refuses an occupied backup namespace at %s', name => {
    const { root, path, file } = fixture(), target = join(root, 'backup'); mkdirSync(target);
    const outside = join(root, 'outside'); copyFileSync(file, outside); const before = readFileSync(outside);
    symlinkSync(outside, join(target, name), 'file');
    const database = new SqliteDatabase({ path });
    try { expect(() => database.backup(target)).toThrow(expect.objectContaining({ code: 'IO' })); }
    finally { database.close(); }
    expect(readFileSync(outside)).toEqual(before);
    if (name !== 'data.sqlite3') expect(existsSync(join(target, 'data.sqlite3'))).toBe(false);
  });
});
