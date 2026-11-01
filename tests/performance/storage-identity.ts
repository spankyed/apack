// Verify the disposable stores before recording a backend label; requested environment is not evidence.
import { closeSync, existsSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { _appDataPaths } from '@apackdev/sdk/utils';

export function performanceStorageFormat(userData: string, expected: string): string {
  if (!path.isAbsolute(userData) || !path.basename(userData).startsWith('apack-e2e-'))
    throw Error('Performance qualification requires its fresh disposable app profile');
  if (expected !== 'elmdb/1' && expected !== 'sqlite/1') throw Error('Unknown performance storage format');
  const stores = _appDataPaths(userData);
  for (const directory of [stores.lmdb, stores.runHistory]) {
    const sqlite = path.join(directory, 'data.sqlite3'), native = path.join(directory, 'data.mdb');
    if (expected === 'elmdb/1') {
      if (existsSync(sqlite) || !lstatSync(native).isFile() || lstatSync(native).size === 0)
        throw Error('Performance profile does not contain the requested native store markers');
    } else {
      if (existsSync(native) || !lstatSync(sqlite).isFile())
        throw Error('Performance profile does not contain the requested SQLite store markers');
      const fd = openSync(sqlite, 'r');
      try {
        const header = Buffer.alloc(100);
        if (readSync(fd, header, 0, header.length, 0) !== header.length
          || header.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0'
          || header.readUInt32BE(60) !== 1 || header.readUInt32BE(68) !== 0x45415253)
          throw Error('Performance profile lacks the persisted EARS SQLite identity');
      } finally { closeSync(fd); }
    }
  }
  return expected;
}
