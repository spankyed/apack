import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DATABASE_FORMAT } from '@apackdev/ears/sqlite';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { appDataDirFor, _appDirOf } from '@apackdev/sdk/env';
import { findDatabaseWriter, openDatabaseStore, openRunHistory, readInstalledSchema } from '@apackdev/host/database';
import { db } from '../../src/commands/db';
import { parseDbArgs } from '../../src/commands/db/target';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-cli-sqlite-')); roots.push(root);
  const dir = path.join(root, 'profile'), paths = _appDataPaths(dir);
  vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_STORAGE_FORMAT', DATABASE_FORMAT);
  // The command's named target, rather than a parent process's profile, must own selection.
  vi.stubEnv('APACK_USER_DATA_DIR', undefined);
  const schema = readInstalledSchema({ userDataDir: dir, packsDir: path.join(_appDirOf(dir), 'packs'), installedPacksFile: path.join(_appDirOf(dir), 'installed-packs.json') });
  const app = openDatabaseStore({ path: paths.lmdb, schema, storageFormat: DATABASE_FORMAT });
  try { app.engine.create('Prompt', { id: 'Prompt-cli', label: 'before', inputs: {}, templateFn: 'return ""' }); }
  finally { app.database.close(); }
  const history = openRunHistory(paths.runHistory, { storageFormat: DATABASE_FORMAT }); history.database.close();
  fs.mkdirSync(paths.media, { recursive: true }); fs.writeFileSync(path.join(paths.media, 'asset'), 'media');
  return { root, dir, paths };
}
async function command(args: string[]) {
  const out: string[] = [], err: string[] = [];
  await db(args, { out: text => out.push(text), err: text => err.push(text) });
  return { out: out.join('\n'), err: err.join('\n') };
}
it('queries and writes the named SQLite profile through normal CLI commands', async () => {
  const f = fixture();
  const result = await command(['query', '--data-dir', f.dir, '--output', 'json', 'return query("Prompt").ids()']);
  expect(JSON.parse(result.out)).toEqual(['Prompt-cli']);
  await command(['exec', '--data-dir', f.dir, 'write("Prompt-cli").set("label", "after")']);
  const changed = await command(['query', '--data-dir', f.dir, '--output', 'json', 'return getRow("Prompt-cli").label']);
  expect(JSON.parse(changed.out)).toBe('after');
  expect(findDatabaseWriter(f.dir)).toBeNull(); expect(fs.existsSync(path.join(f.paths.lmdb, 'data.mdb'))).toBe(false);
});
it('backs up, verifies, reads history and restores both stores using the named target', async () => {
  const f = fixture(), backup = path.join(f.root, 'backup');
  await command(['backup', '--data-dir', f.dir, '--out', backup]);
  const verified = await command(['backup', 'verify', backup, '--json']);
  expect(JSON.parse(verified.out)).toMatchObject({ valid: true, databases: ['lmdb', 'runHistory'], storageFormats: { lmdb: DATABASE_FORMAT, runHistory: DATABASE_FORMAT } });
  const runs = await command(['runs', '--data-dir', f.dir, '--json']); expect(JSON.parse(runs.out)).toEqual([]);
  await command(['exec', '--data-dir', f.dir, 'write("Prompt-cli").set("label", "changed")']);
  await command(['import', '--data-dir', f.dir, '--force', backup]);
  const result = await command(['query', '--data-dir', f.dir, '--output', 'json', 'return getRow("Prompt-cli").label']);
  expect(JSON.parse(result.out)).toBe('before'); expect(fs.readFileSync(path.join(f.paths.media, 'asset'), 'utf8')).toBe('media');
  expect(findDatabaseWriter(f.dir)).toBeNull();
});

it('refuses default candidate storage during argument parsing before commands can take a write lock', () => {
  vi.stubEnv('APACK_ENV', 'test'); vi.stubEnv('APACK_STORAGE_FORMAT', DATABASE_FORMAT);
  vi.stubEnv('APACK_USER_DATA_DIR', undefined);
  expect(() => parseDbArgs(['--data-dir', appDataDirFor('test')], {}, 'usage')).toThrow('isolated profile');
});
