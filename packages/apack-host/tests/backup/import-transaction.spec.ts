import nativeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) fs.removeSync(root); });
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

it.skipIf(process.platform === 'win32').each(['copy', 'parent'])('refuses before replacement when syncing the recovery %s fails', async point => {
  const { root, primary, backup, media, store } = fixture();
  const replaceWith = vi.fn(store.replaceWith), accept = vi.fn(), restored = vi.fn();
  const failure = Object.assign(new Error('recovery preparation sync failed'), { code: 'EIO' });
  const files = new Map<number, string>();
  const open = nativeFs.openSync.bind(nativeFs), close = nativeFs.closeSync.bind(nativeFs), sync = nativeFs.fsyncSync.bind(nativeFs);
  vi.spyOn(nativeFs, 'openSync').mockImplementation((file, flags, mode) => { const fd = open(file, flags, mode); files.set(fd, String(file)); return fd; });
  vi.spyOn(nativeFs, 'closeSync').mockImplementation(fd => { files.delete(fd); close(fd); });
  vi.spyOn(nativeFs, 'fsyncSync').mockImplementation(fd => {
    const file = files.get(fd);
    if (point === 'copy' ? file?.endsWith(path.join('rollback', 'lmdb', 'data.mdb')) : file === root) throw failure;
    sync(fd);
  });
  syncBuiltinESMExports();
  await expect(importDatabase({ lmdb: { ...store, replaceWith } }, backup, media, { log, accept, restored })).rejects.toBe(failure);
  expect(replaceWith).not.toHaveBeenCalled(); expect(accept).not.toHaveBeenCalled(); expect(restored).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(primary, 'data.mdb'), 'utf8')).toBe('incumbent');
  expect(() => assertNoImportRecovery(primary)).not.toThrow();
  expect(fs.readdirSync(root).some(name => name.startsWith('.apack-import-'))).toBe(false);
});


it('retains prepared incumbent recovery when background restart fails after accepted import',async()=>{
  const {root,primary,backup,media,store}=fixture();
  const restart=Object.assign(Error('background restart refused'),{code:'SQLITE_IOERR',backgroundRecoveryFailed:true});
  const managed:BackupStore={...store,async withExclusiveWrites(operation){await operation();throw restart;}};
  let failure:unknown;try{await importDatabase({lmdb:managed},backup,media,{log});}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'RECOVERY_REQUIRED',dataInstalled:true,cause:restart});
  const recovery=(failure as {recoveryPath:string}).recoveryPath;
  expect(fs.readFileSync(path.join(recovery,'lmdb/data.mdb'),'utf8')).toBe('incumbent');
  expect(fs.readFileSync(path.join(primary,'data.mdb'),'utf8')).toBe('candidate');
  expect(()=>assertNoImportRecovery(primary)).toThrow(expect.objectContaining({code:'RECOVERY_REQUIRED',recoveryPath:recovery}));
  expect(path.dirname(path.dirname(recovery))).toBe(root);
});

it('retains the original refusal and restored incumbent when background restart also fails',async()=>{
  const {primary,backup,media,store}=fixture();
  const refused=Error('acceptance refused'),restart=Error('background restart refused');
  const managed:BackupStore={...store,async withExclusiveWrites(operation){
    try{return await operation();}catch(error){throw Object.assign(new AggregateError([error,restart],'Maintenance and restart failed',{cause:error}),{backgroundRecoveryFailed:true});}
  }};
  let failure:unknown;try{await importDatabase({lmdb:managed},backup,media,{log,accept:async()=>{throw refused;}});}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'RECOVERY_REQUIRED',dataInstalled:false});
  const inner=(failure as AggregateError).cause as AggregateError;expect(inner.errors).toEqual([refused,restart]);
  expect(fs.readFileSync(path.join(primary,'data.mdb'),'utf8')).toBe('incumbent');
  expect(fs.readFileSync(path.join((failure as {recoveryPath:string}).recoveryPath,'lmdb/data.mdb'),'utf8')).toBe('incumbent');
});


it('finishes background recovery before the outer replacement lifecycle announces completion',async()=>{
  const {backup,media,store}=fixture();let paused=false,announced=false;
  const managed:BackupStore={...store,async withExclusiveWrites(operation){paused=true;try{return await operation();}finally{paused=false;}}};
  await importDatabase({lmdb:managed},backup,media,{log,accept:async()=>{expect(paused).toBe(true);},withReplacement:async perform=>{
    const result=await perform();expect(paused).toBe(false);announced=true;return result;
  }});
  expect(announced).toBe(true);
});

it('retains a prepared incumbent when outer acceptance cleanup refuses after installation',async()=>{
  const {primary,backup,media,store}=fixture(),cleanup=Error('settings cleanup refused');
  let failure:unknown;try{await importDatabase({lmdb:store},backup,media,{log,withReplacement:async perform=>{await perform();throw cleanup;}});}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'RECOVERY_REQUIRED',dataInstalled:true,cause:cleanup});
  expect(fs.readFileSync(path.join((failure as {recoveryPath:string}).recoveryPath,'lmdb/data.mdb'),'utf8')).toBe('incumbent');
  expect(fs.readFileSync(path.join(primary,'data.mdb'),'utf8')).toBe('candidate');
});
