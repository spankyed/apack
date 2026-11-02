import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine } from '@apackdev/ears';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { databaseStorage, findDatabaseWriter, publishRunningApp } from '@apackdev/host/database';
import { db } from '../../src/commands/db';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-recover-cli-')); roots.push(profile);
  vi.stubEnv('APACK_STORAGE_FORMAT', 'sqlite/1');
  const paths = _appDataPaths(profile), session = '.apack-import-cli', dir = path.join(path.dirname(paths.lmdb), session);
  fs.mkdirSync(path.join(dir, 'rollback'), { recursive: true });
  const database = databaseStorage('sqlite/1').open({ path: paths.lmdb, schema: { types: { Probe: { required: [] } }, relations: {}, roles: [] }, syncs: false });
  try {
    const engine = createEarsEngine({ database }); engine.create('Probe', { id: 'Probe-before' });
    database.backup(path.join(dir, 'rollback/lmdb')); engine.create('Probe', { id: 'Probe-candidate' });
  } finally { database.close(); }
  fs.writeFileSync(path.join(dir, 'recovery.json'), JSON.stringify({ format: 'apack-import/1', state: 'prepared', stores: [{ name: 'lmdb', path: paths.lmdb, format: 'sqlite/1' }] }));
  return { profile, paths, session, dir, io: { out: vi.fn(), err: vi.fn() } };
}
it('inspects without changing data and restores only an explicitly selected session', async () => {
  const f = fixture();
  await db(['recover', '--data-dir', f.profile, '--json'], f.io);
  expect(JSON.parse(f.io.out.mock.lastCall![0])).toEqual([{ session: f.session, status: 'pending', recoveryPath: path.join(f.dir, 'rollback') }]);
  expect(fs.existsSync(path.join(f.dir, 'restore.json'))).toBe(false);
  await expect(db(['recover', '--data-dir', f.profile, '--restore'], f.io)).rejects.toThrow('--session');
  await expect(db(['recover', '--data-dir', f.profile, '--session', f.session], f.io)).rejects.toThrow('--restore');
  await db(['recover', '--data-dir', f.profile, '--session', f.session, '--restore', '--json'], f.io);
  expect(JSON.parse(f.io.out.mock.lastCall![0])[0]).toMatchObject({ session: f.session, status: 'recovered' });
  const database = databaseStorage('sqlite/1').open({ path: f.paths.lmdb, readOnly: true });
  try { expect(createEarsEngine({ database }).query('Probe').ids()).toEqual(['Probe-before']); } finally { database.close(); }
  expect(findDatabaseWriter(f.profile)).toBeNull();
});
it('requires a named target and refuses a running app without changing preparation', async () => {
  const f = fixture(); vi.stubEnv('APACK_USER_DATA_DIR', f.profile);
  await expect(db(['recover'], f.io)).rejects.toThrow('Name the profile');
  const stop = publishRunningApp(f.profile);
  try { await expect(db(['recover', '--data-dir', f.profile, '--session', f.session, '--restore'], f.io)).rejects.toThrow('Quit the app'); }
  finally { stop(); }
  expect(fs.existsSync(path.join(f.dir, 'restore.json'))).toBe(false);
  expect(fs.existsSync(path.join(f.dir, 'recovery.json'))).toBe(true);
});
