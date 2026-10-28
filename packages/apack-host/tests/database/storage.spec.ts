import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { APP_ENVS, appDataDirFor } from '@apackdev/sdk/env';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { DATABASE_FORMAT as ELMDB } from '@apackdev/ears/lmdb';
import { DATABASE_FORMAT as SQLITE } from '@apackdev/ears/sqlite';
import type { EarsDatabase } from '@apackdev/ears';
import { prepareImportRecovery } from '../../src/backup/recovery.ts';
import { configuredDatabaseFormat, openDatabaseStore, openRunHistory } from '../../src/database/index.ts';

const roots: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const schema = { getRegisteredEntityTypes: () => new Set(['Probe']), getRegisteredRelationKinds: () => new Set<string>(), getRegisteredRoles: () => new Set<string>() };
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-sqlite-profile-')); roots.push(dir); return dir; };
it('keeps elmdb as the normal default', () => { vi.stubEnv('APACK_STORAGE_FORMAT', undefined); vi.stubEnv('APACK_USER_DATA_DIR', undefined); expect(configuredDatabaseFormat()).toBe(ELMDB); });
it('refuses unknown boot formats', () => { vi.stubEnv('APACK_STORAGE_FORMAT', 'fiction/99'); expect(() => configuredDatabaseFormat()).toThrow('Unsupported database storage format'); });
it.each([undefined, 'relative/profile'])('requires explicit absolute candidate storage (%s)', dir => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', dir);
  expect(() => configuredDatabaseFormat()).toThrow('explicit absolute');
});
it.each(APP_ENVS)('refuses the default %s profile without opening it', env => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', appDataDirFor(env));
  expect(() => configuredDatabaseFormat()).toThrow('isolated profile');
});
it('selects both real stores and preserves the profile when selection is omitted on reopen', () => {
  const dir = root(), paths = _appDataPaths(dir);
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema }), runs = openRunHistory(paths.runHistory);
  opened.push(primary.database, runs.database);
  expect(primary.database.format).toBe(SQLITE); expect(runs.database.format).toBe(SQLITE);
  primary.database.close(); runs.database.close();
  vi.stubEnv('APACK_STORAGE_FORMAT', undefined);
  expect(() => openDatabaseStore({ path: paths.lmdb, schema })).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(() => openRunHistory(paths.runHistory)).toThrow(expect.objectContaining({ code: 'STORAGE_MISMATCH' }));
  expect(fs.existsSync(path.join(paths.lmdb, 'data.mdb'))).toBe(false);
  expect(fs.existsSync(path.join(paths.runHistory, 'data.mdb'))).toBe(false);
});
it('uses the explicitly supplied CLI profile for the isolation check', () => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE); vi.stubEnv('APACK_USER_DATA_DIR', root());
  expect(() => configuredDatabaseFormat(appDataDirFor('production'))).toThrow('isolated profile');
});

it('refuses children of a default profile and symlink aliases without creating their targets', () => {
  vi.stubEnv('APACK_STORAGE_FORMAT', SQLITE);
  expect(() => configuredDatabaseFormat(path.join(appDataDirFor('test'), 'candidate'))).toThrow('isolated profile');
  const alias = path.join(root(), 'alias'); fs.symlinkSync(appDataDirFor('test'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => configuredDatabaseFormat(alias)).toThrow('isolated profile');
});

it.each([ELMDB, SQLITE])('blocks writable recovery opens without salvaging either %s store', format => {
  const dir = root(), paths = _appDataPaths(dir);
  const primary = openDatabaseStore({ path: paths.lmdb, schema, storageFormat: format });
  const history = openRunHistory(paths.runHistory, { storageFormat: format });
  primary.engine.create('Probe', { id: 'Probe-incumbent' });
  primary.database.close(); history.database.close();
  const session = path.join(path.dirname(paths.lmdb), '.apack-import-interrupted');
  prepareImportRecovery(session, [{ name: 'lmdb', path: paths.lmdb, format }, { name: 'runHistory', path: paths.runHistory, format }]);
  expect(() => openDatabaseStore({ path: paths.lmdb, schema, storageFormat: format }))
    .toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(() => openRunHistory(paths.runHistory, { storageFormat: format }))
    .toThrow(expect.objectContaining({ code: 'RECOVERY_REQUIRED' }));
  expect(fs.readdirSync(path.dirname(paths.runHistory)).some(name => name.includes('.unreadable-'))).toBe(false);
  const inspected = openDatabaseStore({ path: paths.lmdb, schema, readOnly: true, storageFormat: format });
  opened.push(inspected.database);
  expect(inspected.engine.query('Probe').ids()).toEqual(['Probe-incumbent']);
  const inspectedHistory = openRunHistory(paths.runHistory, { readOnly: true, storageFormat: format });
  opened.push(inspectedHistory.database);
  expect(inspectedHistory.database.isOpen).toBe(true);
});
