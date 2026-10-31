import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '@apackdev/testing';
import { _appDataPaths } from '@apackdev/sdk/utils';

test.skip(!process.env.APACK_HOST_EXECUTABLE || process.env.APACK_STORAGE_FORMAT !== 'sqlite/1',
  'Requires the installed Preview with explicit isolated SQLite selection');

test('packaged SQLite stores hold their model claims across the real API process', async ({ electronApp, appPage: _ready }) => {
  const state = await electronApp.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData') }));
  expect(state.packaged).toBe(true);
  expect(state.userData).toMatch(/[\\/]apack-e2e-[^\\/]+$/);
  const stores = _appDataPaths(state.userData);
  // Resolve the probe from the EARS owner, preserving its pinned addon version and private dependencies.
  const owner = createRequire(import.meta.url).resolve('@apackdev/ears/sqlite');
  const { tryLock } = createRequire(owner)('fs-native-extensions') as { tryLock(fd: number): boolean };
  for (const directory of [stores.lmdb, stores.runHistory]) {
    const file = fs.openSync(path.join(directory, 'data.sqlite3'), 'r');
    try {
      const header = Buffer.alloc(100);
      expect(fs.readSync(file, header, 0, header.length, 0)).toBe(header.length);
      expect(header.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\0');
      // The initial primary transaction publishes these header fields before entering WAL mode.
      expect(header.readUInt32BE(60)).toBe(1); // user_version
      expect(header.readUInt32BE(68)).toBe(0x45415253); // application_id: EARS
    } finally { fs.closeSync(file); }
    expect(fs.existsSync(path.join(directory, 'data.mdb'))).toBe(false);
    // Open an existing inode without creating/truncating it; the packaged API must still hold its kernel claim.
    const claim = fs.openSync(path.join(directory, '.native-model-owner.lock'), 'r+');
    try { expect(tryLock(claim)).toBe(false); }
    finally { fs.closeSync(claim); }
  }
});
