// What the API's boot makes of what a killed process left in the data dir. Both shapes are settled before
// any pack loads — the write lock gates the store opening, and `prepareHostDataDirs` runs just after — and
// both are answered by a pid, which is why each carries a record of the boot it was written in.
//
// The unit tests for these live in @apackdev/host. This one boots the real composition, because what both
// regressions broke was the lifecycle: one refused to start at all, the other deleted a pack on the way up.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _appDirOf } from '@apackdev/sdk/env';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-boot-recovery-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const backend = await import('../../src/runtime/index.ts');

/** A process id no process has any more */
async function exitedPid(): Promise<number> {
  const exited = execFileWhileWorking(process.execPath, ['-e', '']);
  await exited;
  return exited.child.pid!;
}

const packsDir = path.join(_appDirOf(dataDir), 'packs');
const stagingDir = `.demo-pack.previous-${await exitedPid()}-a1b2c3d4`;

beforeAll(async () => {
  // A lock an `apack db` command left behind when it was killed outright — the one way out that releases
  // nothing. Its pid is gone, so nothing is changing the database.
  fs.mkdirSync(_appDirOf(dataDir), { recursive: true });
  fs.writeFileSync(path.join(_appDirOf(dataDir), 'db-write.lock'), JSON.stringify({
    pid: await exitedPid(), machine: os.hostname(), what: 'apack db import', since: new Date().toISOString(),
  }));

  // An install interrupted between moving the old copy aside and placing the new one: `demo-pack` is gone
  // and the moved-aside copy is the only one left. This data dir has no installed-packs record, as a fresh
  // one does not, and as one whose record will not parse does not either.
  fs.mkdirSync(path.join(packsDir, stagingDir), { recursive: true });
  fs.writeFileSync(
    path.join(packsDir, stagingDir, 'apack.json'),
    JSON.stringify({ id: 'demo-pack', name: 'Demo Pack', version: '1.0.0' }),
  );

  await backend.setupBackend();
});

afterAll(() => {
  backend.backendActor?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the API boot, on what a killed process left behind', () => {
  it('starts on a lock whose holder is gone, instead of refusing until someone deletes the file', () => {
    // It got past assertNoDatabaseWriter: the store that gate stands in front of is open
    expect(fs.existsSync(path.join(_appDirOf(dataDir), 'ears-db'))).toBe(true);
  });

  it("restores an interrupted install's only copy, with no record to say the pack is still wanted", () => {
    expect(fs.existsSync(path.join(packsDir, 'demo-pack', 'apack.json'))).toBe(true);
    expect(fs.readdirSync(packsDir).filter((name) => name.startsWith('.demo-pack'))).toEqual([]);
  });
});
