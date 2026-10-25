import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createEarsEngine, type EARS } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/lmdb';
import { databaseBackupStore, readBackup, importDatabase } from '@apackdev/host/backup';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { findDatabaseWriter, publishRunningApp, openDatabaseStore, readInstalledSchema } from '@apackdev/host/database';
import { runHistoryAt } from '../_support/run-history.ts';
import { db } from '../../src/commands/db';

/** The database at `dir` and an engine over it, declaring the notes these cases write and look for */
function notesAt(dir: string, { readOnly = false } = {}) {
  const database = openDatabase({ path: dir, readOnly });
  const engine = createEarsEngine({ database });
  if (!readOnly) engine.admin.declare({ types: { Note: { required: [] } }, relations: {}, roles: [] });
  return { database, notes: engine };
}

it('creates an importable backup with media and run history, and refuses overwrite and nested destinations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-backup-'));
  const source = path.join(root, 'source');
  const out = path.join(root, 'backup');
  const io = { out: vi.fn(), err: vi.fn() };
  try {
    const paths = _appDataPaths(source);
    const primary = notesAt(paths.lmdb);
    primary.notes.create('Note', { id: 'Note-a' as EARS.EntityId });
    primary.database.close();
    const history = runHistoryAt(paths.runHistory);
    history.put({ id: 'RunNode-a', rootId: 'RunNode-a', kind: 'flow', label: 'Run', status: 'completed', startedAt: 0 });
    history.close();
    fs.mkdirSync(paths.media, { recursive: true });
    fs.writeFileSync(path.join(paths.media, 'asset.txt'), 'media');
    await db(['backup', '--data-dir', source, '--out', out], io);
    expect(fs.statSync(out).mode & 0o777).toBe(0o700);
    expect(readBackup(out)).toMatchObject({ databases: ['lmdb', 'runHistory'], hasMedia: true });
    expect(fs.readFileSync(path.join(out, 'media/asset.txt'), 'utf8')).toBe('media');
    const copy = notesAt(path.join(out, 'lmdb'), { readOnly: true });
    expect(copy.notes.query('Note').ids()).toEqual(['Note-a']);
    copy.database.close();
    await db(['backup', 'verify', out, '--json'], io);
    expect(JSON.parse(io.out.mock.lastCall![0])).toMatchObject({ valid: true, path: out });
    const restoreContext = resolveAppEnvironment({ env: 'production', userDataDir: path.join(root, 'restored') });
    const restored = _appDataPaths(restoreContext.userDataDir);
    // The app the backup restores into declares the notes, as the pack installed there would
    const installed = readInstalledSchema(restoreContext);
    const { database, engine } = openDatabaseStore({
      path: restored.lmdb,
      schema: { ...installed, getRegisteredEntityTypes: () => new Set([...installed.getRegisteredEntityTypes(), 'Note']) },
    });
    const runHistory = runHistoryAt(restored.runHistory);
    try {
      await importDatabase({ lmdb: databaseBackupStore(database), runHistory: databaseBackupStore(runHistory.database) }, out, restored.media, { log: { info: () => {}, warn: () => {} } });
      expect(engine.query('Note').ids()).toEqual(['Note-a']);
      expect(runHistory.get('RunNode-a')).toMatchObject({ id: 'RunNode-a', status: 'completed' });
      expect(fs.readFileSync(path.join(restored.media, 'asset.txt'), 'utf8')).toBe('media');
    } finally { database.close(); runHistory.close(); }
    const running = publishRunningApp(source);
    try {
      await expect(db(['backup', '--data-dir', source, '--out', path.join(root, 'while-running')], io)).rejects.toThrow('Quit the app');
      expect(findDatabaseWriter(source)).toBeNull();
    } finally { running(); }
    const raced = path.join(root, 'raced');
    const racingIo = { out: vi.fn(), err: (message: string) => {
      if (message.startsWith('Backup completed:')) {
        fs.mkdirSync(raced);
        fs.writeFileSync(path.join(raced, 'keep'), 'other writer');
      }
    } };
    await expect(db(['backup', '--data-dir', source, '--out', raced], racingIo)).rejects.toThrow();
    expect(fs.readFileSync(path.join(raced, 'keep'), 'utf8')).toBe('other writer');
    expect(fs.readdirSync(root).filter(name => name.startsWith('.apack-backup-'))).toEqual([]);
    expect(findDatabaseWriter(source)).toBeNull();
    fs.renameSync(path.join(out, 'media'), path.join(out, 'lost-media'));
    await expect(db(['backup', 'verify', out], io)).rejects.toThrow('media directory is missing');
    fs.renameSync(path.join(out, 'lost-media'), path.join(out, 'media'));
    const metadataPath = path.join(out, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, includesMedia: false }));
    fs.renameSync(path.join(out, 'media'), path.join(out, 'saved-media'));
    fs.writeFileSync(path.join(out, 'media'), 'invalid media file');
    await expect(db(['backup', 'verify', out], io)).rejects.toThrow('not a directory');
    fs.rmSync(path.join(out, 'media'));
    fs.renameSync(path.join(out, 'saved-media'), path.join(out, 'media'));
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    fs.rmSync(path.join(out, 'runHistory'), { recursive: true });
    io.out.mockClear();
    await expect(db(['backup', 'verify', out, '--json'], io)).rejects.toThrow('Missing backup databases');
    expect(io.out).toHaveBeenCalledOnce();
    expect(JSON.parse(io.out.mock.lastCall![0])).toMatchObject({ valid: false, path: out, error: expect.stringContaining('Missing backup databases') });
    expect(findDatabaseWriter(source)).toBeNull();
    await expect(db(['backup', '--data-dir', source, '--out', out], io)).rejects.toThrow('already exists');
    await expect(db(['backup', '--data-dir', source, '--out', path.join(source, 'nested')], io)).rejects.toThrow('outside');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
