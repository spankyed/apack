import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEarsEngine } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/sqlite';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { holdDatabaseWriteLock } from '@apackdev/host/database';
import { runHistoryAt } from '../_support/run-history.ts';
import { dbDump, dbLoad } from '../../src/commands/db/logical';
import { db as command } from '../../src/commands/db/index';
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const parent = fs.mkdtempSync(path.join(tmpdir(), 'apack-db-logical-')); roots.push(parent);
  const profile = path.join(parent, 'profile'); fs.mkdirSync(profile);
  vi.stubEnv('APACK_STORAGE_FORMAT', 'sqlite/1'); vi.stubEnv('APACK_USER_DATA_DIR', profile);
  const paths = _appDataPaths(profile), db = openDatabase({ path: paths.lmdb, syncs: false,
    schema: { types: { Row: { required: [], search: { fields: { title: 1 } } } }, relations: {}, roles: [] } });
  const e = createEarsEngine({ database: db }); e.create('Row', { id: 'Row-one', title: 'needle', negative: -0 }); db.close();
  fs.mkdirSync(paths.media, { recursive: true }); fs.writeFileSync(path.join(paths.media, 'asset'), 'media retained');
  const output: string[] = [], errors: string[] = [];
  return { parent, profile, paths, primary: path.join(parent, 'primary.ears'), runs: path.join(parent, 'runs.ears'),
    output, errors, io: { out: (text: string) => output.push(text), err: (text: string) => errors.push(text) } };
}
function inspect(f: ReturnType<typeof fixture>) {
  const db = openDatabase({ path: f.paths.lmdb, readOnly: true });
  try { const e = createEarsEngine({ database: db }); return { sequence: e.lastCommit(), ids: e.query('Row').ids(), negative: e.getAttr('Row-one', 'negative') }; }
  finally { db.close(); }
}
function mutate(f: ReturnType<typeof fixture>) {
  const db = openDatabase({ path: f.paths.lmdb, syncs: false });
  try { createEarsEngine({ database: db }).write('Row-one').set('title', 'changed after dump'); } finally { db.close(); }
}
it('routes real dump/load commands, validates dry run, restores primary bytes and preserves media', async () => {
  const f = fixture(); await command(['dump', '--data-dir', f.profile, '--primary', f.primary], f.io);
  expect(fs.statSync(f.primary).size).toBeGreaterThan(0); mutate(f); const before = inspect(f);
  await command(['load', '--data-dir', f.profile, '--primary', f.primary], f.io);
  expect(inspect(f)).toEqual(before); expect(f.output.at(-1)).toContain('Dry run: nothing was changed');
  await command(['load', '--data-dir', f.profile, '--primary', f.primary, '--force'], f.io);
  expect(f.output.at(-1)).toBe('Loaded logical archives.');
  expect(Object.is(inspect(f).negative, -0)).toBe(true); expect(inspect(f).sequence).toBeGreaterThan(before.sequence);
  const db = openDatabase({ path: f.paths.lmdb, readOnly: true });
  try { expect(createEarsEngine({ database: db }).query('Row').search('needle', { fuzzy: false }).ids()).toEqual(['Row-one']); } finally { db.close(); }
  expect(fs.readFileSync(path.join(f.paths.media, 'asset'), 'utf8')).toBe('media retained');
});
it('dumps and loads history alone without replacing or advancing primary', async () => {
  const f = fixture(), history = runHistoryAt(f.paths.runHistory);
  history.put({ id: 'RunNode-one', kind: 'flow', label: 'one', status: 'completed', startedAt: 1 }); history.close();
  const before = inspect(f); await dbDump(['--data-dir', f.profile, '--runs', f.runs], f.io);
  const changed = runHistoryAt(f.paths.runHistory); changed.put({ id: 'RunNode-two', kind: 'flow', label: 'two', status: 'completed', startedAt: 2 }); changed.close();
  await dbLoad(['--data-dir', f.profile, '--runs', f.runs, '--force'], f.io);
  expect(inspect(f)).toEqual(before);
  const restored = runHistoryAt(f.paths.runHistory, { readOnly: true });
  try { expect(restored.get('RunNode-one')).toMatchObject({ label: 'one' }); expect(restored.get('RunNode-two')).toBeUndefined(); } finally { restored.close(); }
});
it('validates both selected inputs before replacing primary or history', async () => {
  const f = fixture(), history = runHistoryAt(f.paths.runHistory); history.put({ id: 'RunNode-one', kind: 'flow', label: 'one', status: 'completed', startedAt: 1 }); history.close();
  await dbDump(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.runs], f.io);
  const valid = fs.readFileSync(f.runs); fs.writeFileSync(f.runs, valid.subarray(0, -1)); mutate(f); const before = inspect(f);
  await expect(dbLoad(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.runs, '--force'], f.io)).rejects.toThrow();
  expect(inspect(f)).toEqual(before);
  fs.writeFileSync(f.runs, valid);
  await dbLoad(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.runs, '--force'], f.io);
  expect(inspect(f).sequence).toBeGreaterThan(before.sequence);
  expect(f.output.at(-1)).toBe('Loaded logical archives.');
});
it('refuses all missing-history selections before creating an output archive', async () => {
  const f = fixture();
  await expect(dbDump(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.runs], f.io)).rejects.toThrow('No run history');
  expect(fs.existsSync(f.primary)).toBe(false); expect(fs.existsSync(f.runs)).toBe(false);
});
it('refuses existing and duplicate output paths before exporting any selected store', async () => {
  const f = fixture(); fs.writeFileSync(f.runs, 'incumbent');
  await expect(dbDump(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.runs], f.io)).rejects.toThrow('target exists');
  expect(fs.readFileSync(f.runs, 'utf8')).toBe('incumbent'); expect(fs.existsSync(f.primary)).toBe(false);
  await expect(dbDump(['--data-dir', f.profile, '--primary', f.primary, '--runs', f.primary], f.io)).rejects.toThrow('different output');
  expect(fs.existsSync(f.primary)).toBe(false);
});
it('refuses output inside the source profile, including an existing parent alias', async () => {
  const f = fixture(), alias = path.join(f.parent, 'alias'); fs.symlinkSync(f.profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(dbDump(['--data-dir', f.profile, '--primary', path.join(alias, 'nested.ears')], f.io)).rejects.toThrow('outside the source profile');
  expect(fs.existsSync(path.join(f.profile, 'nested.ears'))).toBe(false);
});
it('refuses managed writer contention for dump and forced load without changing data', async () => {
  const f = fixture(), before = inspect(f), lock = holdDatabaseWriteLock(f.profile, 'other writer');
  try {
    await expect(dbDump(['--data-dir', f.profile, '--primary', f.primary], f.io)).rejects.toThrow('other writer');
    await expect(dbLoad(['--data-dir', f.profile, '--primary', f.primary, '--force'], f.io)).rejects.toThrow('other writer');
  } finally { lock.release(); }
  expect(inspect(f)).toEqual(before); expect(fs.existsSync(f.primary)).toBe(false);
});
it('requires explicit files and a named profile, and exposes both help entries', async () => {
  const f = fixture();
  await expect(dbDump(['--data-dir', f.profile], f.io)).rejects.toThrow('--primary and/or --runs');
  await expect(dbLoad(['--primary', f.primary], f.io)).rejects.toThrow('Name the data dir');
  await expect(dbLoad(['unexpected', '--data-dir', f.profile, '--primary', f.primary], f.io)).rejects.toThrow('Unexpected argument');
  await command(['dump', '--help'], f.io); expect(f.output.at(-1)).toContain('lossless logical archives');
  await command(['load', '--help'], f.io); expect(f.output.at(-1)).toContain('Without --force');
});
