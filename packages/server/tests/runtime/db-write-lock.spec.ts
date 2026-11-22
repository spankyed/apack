// The API refuses to boot while a tool (`apack db`) is changing the data dir's database: opening it would overwrite
// that change from this process's memory. See @apackdev/host/database's write lock.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-db-write-lock-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { setupBackend } = await import('../../src/runtime/index.ts');
const { holdDatabaseWriteLock } = await import('@apackdev/host/database');

const locks: Array<{ release(): void }> = [];
afterEach(() => { for (const lock of locks.splice(0)) lock.release(); });
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('the API boot', () => {
  it('refuses while a tool holds the database, naming it, and opens nothing', async () => {
    const lock = holdDatabaseWriteLock(dataDir, 'apack db reset');
    locks.push(lock);

    await expect(setupBackend()).rejects.toThrow(
      new RegExp(`The database in ${dataDir} is being changed by apack db reset \\(pid ${process.pid}\\)`),
    );
    // The boot stopped before it opened the store
    expect(fs.existsSync(path.join(dataDir, '.data', 'ears-db'))).toBe(false);
  });
});
