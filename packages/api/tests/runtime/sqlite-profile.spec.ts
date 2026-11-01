import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { EarsDatabase } from '@apackdev/ears';
import { DATABASE_FORMAT as SQLITE } from '@apackdev/ears/sqlite';
import { DATABASE_FORMAT as ELMDB } from '@apackdev/ears/lmdb';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { boundHost, unbindHost } from '@apackdev/sdk/runtime/internals';
import { untypedCreate, untypedQuery } from '@apackdev/sdk/ears';
import { databaseStorage, openAppDatabase, openRunHistory, startDatabaseBackground, closeDatabases } from '@apackdev/host/database';
import { openAppStore, setupBackend } from '../../src/runtime/index.ts';
import { restoreConsole } from '../../src/adapters/logging.ts';

const roots: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => { restoreConsole(); unbindHost(); vi.restoreAllMocks(); for (const db of opened.splice(0)) db.close(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function profile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-sqlite-profile-')); roots.push(dir);
  vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_USER_DATA_DIR', dir); vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE);
  return dir;
}
function open() { const app = openAppStore(); opened.push(app.database, app.runHistory.database); return app; }

it('opens both real app stores on SQLite and persists SDK operations across a restart', async () => {
  const dir = profile(), first = open();
  expect(first.database.format).toBe(SQLITE); expect(first.runHistory.database.format).toBe(SQLITE);
  await Promise.all([first.database.indexesReady(), first.runHistory.database.indexesReady()]);
  untypedCreate('Prompt', { id: 'Prompt-sqlite', label: 'SQLite profile', inputs: {}, templateFn: 'return ""' });
  first.database.close(); first.runHistory.database.close(); unbindHost();
  const second = open();
  expect(untypedQuery.withTrashed('Prompt').ids()).toEqual(['Prompt-sqlite']);
  expect(second.engine.getRow('Prompt-sqlite')?.label).toBe('SQLite profile');
  expect(fs.existsSync(path.join(_appDataPaths(dir).lmdb, 'data.mdb'))).toBe(false);
});

it('opens the same candidate through the normal offline app-database constructor', async () => {
  const dir = profile(), app = open();
  untypedCreate('Prompt', { id: 'Prompt-tool', label: 'CLI profile', inputs: {}, templateFn: 'return ""' });
  app.database.close(); app.runHistory.database.close(); unbindHost();
  const tool = await openAppDatabase({ env: 'test', userDataDir: dir });
  try { expect(tool.database.format).toBe(SQLITE); expect(tool.ears.query('Prompt').ids()).toEqual(['Prompt-tool']); }
  finally { tool.close(); }
});

it('closes the primary if the run-history backend refuses and leaves no host bound', () => {
  const dir = profile(), native = openRunHistory(_appDataPaths(dir).runHistory, { storageFormat: ELMDB }); native.database.close();
  const storage = databaseStorage(SQLITE), original = storage.open.bind(storage), acquired: EarsDatabase[] = [];
  vi.spyOn(storage, 'open').mockImplementation(options => { const db = original(options); acquired.push(db); opened.push(db); return db; });
  expect(() => openAppStore()).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(acquired).toHaveLength(1); expect(acquired[0]!.isOpen).toBe(false);
  expect(() => boundHost()).toThrow('No host is bound');
  expect(fs.readdirSync(path.dirname(_appDataPaths(dir).runHistory)).some(name => name.includes('.unreadable-'))).toBe(false);
});


it('waits for real populated search admission through the live registry readiness port', async () => {
  profile(); const app = open();
  app.engine.admin.declare({ types: { AdmissionRow: { required: [] } }, relations: {}, roles: [] });
  for (let i = 0; i < 150; i++) app.engine.create('AdmissionRow', { id: `AdmissionRow-${i}`, title: `marker ${i}` });
  app.engine.admin.declare({ types: { AdmissionRow: { required: [], substrings: ['title'] } }, relations: {}, roles: [] });
  expect(() => app.engine.query('AdmissionRow').matching('marker').count()).toThrow(expect.objectContaining({ code: 'INDEX_BUILDING' }));
  await app.packs.indexesReady();
  expect(app.engine.query('AdmissionRow').matching('marker').count()).toBe(150);
});


it('drains an acquired model owner when the other store refuses normal API startup', async () => {
  const dir = profile(), paths = _appDataPaths(dir), storage = databaseStorage(SQLITE);
  const start = storage.startBackground!, acquired: EarsDatabase[] = [];
  const failure = Object.assign(new Error('fixture history model startup refusal'), { code: 'BACKGROUND_OWNER_EXISTS' });
  vi.spyOn(storage as { startBackground: typeof start }, 'startBackground').mockImplementation(async database => {
    acquired.push(database); opened.push(database);
    if (database.path === paths.runHistory) throw failure;
    await start(database);
  });
  await expect(setupBackend()).rejects.toBe(failure);
  expect(acquired).toHaveLength(2); expect(acquired.every(database => !database.isOpen)).toBe(true);
  vi.restoreAllMocks();
  const peer = storage.open({ path: paths.lmdb }); opened.push(peer);
  await startDatabaseBackground(peer); await peer.indexesReady(); await closeDatabases([peer]);
});
