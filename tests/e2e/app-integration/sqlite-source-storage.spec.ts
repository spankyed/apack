import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@apackdev/testing';
import { _appDataPaths } from '@apackdev/sdk/utils';

test.skip(process.env.APACK_STORAGE_FORMAT !== 'sqlite/1' || !!process.env.APACK_HOST_EXECUTABLE,
  'Requires an explicitly selected isolated source SQLite app');

test('source SQLite app opens both managed stores with persisted EARS identity', async ({ electronApp, appPage: _ready }) => {
  const state = await electronApp.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData') }));
  expect(state.packaged).toBe(false);
  expect(state.userData).toMatch(/[\\/]apack-e2e-[^\\/]+$/);
  const stores = _appDataPaths(state.userData);
  for (const directory of [stores.lmdb, stores.runHistory]) {
    const file = fs.openSync(path.join(directory, 'data.sqlite3'), 'r');
    try {
      const header = Buffer.alloc(100);
      expect(fs.readSync(file, header, 0, header.length, 0)).toBe(header.length);
      expect(header.subarray(0, 16).toString('utf8')).toBe('SQLite format 3\0');
      expect(header.readUInt32BE(60)).toBe(1);
      expect(header.readUInt32BE(68)).toBe(0x45415253);
    } finally { fs.closeSync(file); }
    expect(fs.existsSync(path.join(directory, 'data.mdb'))).toBe(false);
  }
});
