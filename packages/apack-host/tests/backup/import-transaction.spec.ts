import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assertNoImportRecovery } from '../../src/backup/recovery.ts';
import { importDatabase, type BackupStore } from '../../src/backup/index.ts';

// Exercise the rollback's order without opening native databases: the backup reads as an empty database, and the
// store's files are text. import.spec covers real databases.
vi.mock('@apackdev/ears/lmdb', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/ears/lmdb')>(),
  openDatabase: () => ({ path: '', readOnly: true, isOpen: true, schema: null, stats: () => ({ types: {}, relations: {}, fileBytes: 0 }), close: () => {} }),
}));

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.removeSync(root); });
const log = { info: () => {}, warn: () => {} };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-import-transaction-'));
  roots.push(root);
  const primary = path.join(root, 'lmdb');
  const backup = path.join(root, 'backup');
  const media = path.join(root, 'media');
  fs.outputFileSync(path.join(primary, 'data.mdb'), 'incumbent');
  fs.outputFileSync(path.join(backup, 'lmdb', 'data.mdb'), 'candidate');
  fs.outputFileSync(path.join(backup, 'media', 'asset'), 'candidate media');
  fs.writeJsonSync(path.join(backup, 'metadata.json'), { databases: ['lmdb'] });
  const store = {
    path: primary,
    format: 'elmdb/1',
    withExclusiveWrites: <T>(operation: () => Promise<T>) => operation(),
    copyTo: (dest: string) => fs.copy(primary, dest),
    replaceWith: (dir: string) => fs.copySync(path.join(dir, 'data.mdb'), path.join(primary, 'data.mdb')),
  } satisfies BackupStore;
  return { root, primary, backup, media, store };
}

it('retains incumbent files through acceptance and restores them before the restored data is announced', async () => {
  const { root, primary, backup, media, store } = fixture();
  const read = () => fs.readFileSync(path.join(primary, 'data.mdb'), 'utf8');
  const restored = vi.fn(async () => { expect(read()).toBe('incumbent'); });
  await expect(importDatabase({ lmdb: store }, backup, media, { log, restored, accept: async () => {
    expect(read()).toBe('candidate');
    const pending = fs.readdirSync(root).find(name => name.startsWith('.apack-import-'))!;
    expect(fs.readFileSync(path.join(root, pending, 'rollback/lmdb/data.mdb'), 'utf8')).toBe('incumbent');
    throw new Error('hydration refused');
  } })).rejects.toThrow('hydration refused');
  expect(restored).toHaveBeenCalledOnce();
  expect(read()).toBe('incumbent');
  expect(fs.existsSync(media)).toBe(false);
  expect(fs.readdirSync(root).some(name => name.startsWith('.apack-import-'))).toBe(false);
});

it('preserves both failures and the durable recovery path if the restored data is refused too', async () => {
  const { root, backup, media, store } = fixture();
  let failure: unknown;
  try {
    await importDatabase({ lmdb: store }, backup, media, { log,
      accept: async () => { throw new Error('candidate hydration'); },
      restored: async () => { throw new Error('incumbent hydration'); },
    });
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AggregateError);
  const aggregate = failure as AggregateError;
  expect(aggregate.errors.map(error => error.message)).toEqual(['candidate hydration', 'incumbent hydration']);
  const recovery = aggregate.message.split('retained at ')[1];
  expect(path.dirname(path.dirname(recovery))).toBe(root);
  expect(fs.readFileSync(path.join(recovery, 'lmdb/data.mdb'), 'utf8')).toBe('incumbent');
});

it('rolls back a replacement that committed before reporting failed sync', async () => {
  const { root, primary, backup, media, store } = fixture();
  const read = () => fs.readFileSync(path.join(primary, 'data.mdb'), 'utf8');
  const failure = Object.assign(new Error('replacement committed but sync failed'), { code: 'NOT_DURABLE' });
  let replacements = 0;
  const committedError: BackupStore = {
    ...store,
    replaceWith(dir) {
      store.replaceWith(dir);
      if (++replacements === 1) {
        expect(read()).toBe('candidate');
        throw failure;
      }
    },
  };
  const restored = vi.fn(async () => { expect(read()).toBe('incumbent'); });
  await expect(importDatabase({ lmdb: committedError }, backup, media, { log, restored })).rejects.toBe(failure);
  expect(replacements).toBe(2);
  expect(restored).toHaveBeenCalledOnce();
  expect(read()).toBe('incumbent');
  expect(fs.readdirSync(root).some(name => name.startsWith('.apack-import-'))).toBe(false);
});

it('retains a prepared recovery journal and never replays an uncertain replacement', async () => {
  const { root, primary, backup, media, store } = fixture();
  const cause = Object.assign(new Error('commit acknowledgement lost'), { code: 'COMMIT_UNKNOWN' });
  const replaceWith = vi.fn((dir: string) => {
    const session = fs.readdirSync(root).find(name => name.startsWith('.apack-import-'))!;
    const marker = fs.readJsonSync(path.join(root, session, 'recovery.json'));
    expect(marker).toMatchObject({ format: 'apack-import/1', state: 'prepared', stores: [{ name: 'lmdb', path: primary, format: 'elmdb/1' }] });
    store.replaceWith(dir);
    throw cause;
  });
  const accept = vi.fn(), restored = vi.fn();
  let failure: unknown;
  try { await importDatabase({ lmdb: { ...store, replaceWith } }, backup, media, { log, accept, restored }); }
  catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'COMMIT_UNKNOWN', cause });
  expect(replaceWith).toHaveBeenCalledOnce();
  expect(accept).not.toHaveBeenCalled(); expect(restored).not.toHaveBeenCalled();
  const recovery = (failure as Error & { recoveryPath: string }).recoveryPath;
  expect(fs.readFileSync(path.join(recovery, 'lmdb/data.mdb'), 'utf8')).toBe('incumbent');
  expect(fs.readFileSync(path.join(primary, 'data.mdb'), 'utf8')).toBe('candidate');
  expect(() => assertNoImportRecovery(primary)).toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED', recoveryPath: recovery }));
});
