// The two questions asked about a pid on disk, and the opposite way each answers the doubt. Their callers
// cover them from above (staging recovery, findRunningApp, readApiEndpoint); this pins the contract itself,
// including the branch no caller can reach on purpose: a record that goes missing under the check.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockIsHeld, readApiEndpoint, recordIsStale } from '../src/process-liveness.ts';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const record = (name: string, { preBoot = false } = {}) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x');
  if (preBoot) {
    const before = new Date(Date.now() - os.uptime() * 1000 - 60_000);
    fs.utimesSync(file, before, before);
  }
  return file;
};

/** A pid no process has any more */
const exitedPid = async () => {
  const exited = execFileWhileWorking(process.execPath, ['-e', '']);
  await exited;
  return exited.child.pid!;
};

describe('lockIsHeld', () => {
  it('is held while its holder runs, and free once it has exited', async () => {
    expect(lockIsHeld(process.pid)).toBe(true);
    expect(lockIsHeld(await exitedPid())).toBe(false);
  });

  // A lock is never cleared by age, because a wrong "free" means two writers. There is no file argument to
  // clear it by; that the instance lock survives a backdated file is pinned in host's running-app.spec.

  // `process.kill(1, 0)` raises EPERM, not ESRCH: a process this user doesn't own is still a process
  it('counts a holder this process may not signal', () => {
    expect(lockIsHeld(1)).toBe(true);
  });
});

describe('recordIsStale', () => {
  it('trusts a record its writer is still running behind', () => {
    expect(recordIsStale(record('fresh'), process.pid)).toBe(false);
  });

  it('drops one whose writer has exited', async () => {
    expect(recordIsStale(record('crashed'), await exitedPid())).toBe(true);
  });

  // Pids are recycled, so after a reboot a crashed writer's record names an unrelated live process
  it('drops one written before this boot, whatever pid it names', () => {
    expect(recordIsStale(record('previous-boot', { preBoot: true }), process.pid)).toBe(true);
  });

  // Every caller reads the record and then checks it, so the file can go in between — staging recovery
  // reads a whole directory first, which is the widest window
  it('drops one whose file is gone by the time it is checked', () => {
    const file = record('vanishing');
    fs.rmSync(file);
    expect(recordIsStale(file, process.pid)).toBe(true);
  });
});

describe('readApiEndpoint', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-endpoint-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = () => path.join(dir, 'api-port');
  const write = (content: unknown) => fs.writeFileSync(file(), typeof content === 'string' ? content : JSON.stringify(content));
  /** A process id no process has any more */
  const exitedPid = async () => {
    const exited = execFileWhileWorking(process.execPath, ['-e', '']);
    await exited;
    return exited.child.pid!;
  };

  it('reads the API a running process published', () => {
    write({ port: 3001, pid: process.pid });
    expect(readApiEndpoint(file())).toEqual({ port: 3001, pid: process.pid });
  });

  it('reads nothing from a file a crashed run left behind', async () => {
    write({ port: 3001, pid: await exitedPid() });
    expect(readApiEndpoint(file())).toBeNull();
  });

  // Pids are recycled, so after a reboot a crashed run's file names an unrelated live process. Without the
  // boot bound `apack pack dev` and the pack watcher believe an API is there and talk to a port nobody holds.
  it('reads nothing from a file written before this boot, whatever pid it names', () => {
    write({ port: 3001, pid: process.pid });
    expect(readApiEndpoint(file())).toEqual({ port: 3001, pid: process.pid });

    const before = new Date(Date.now() - os.uptime() * 1000 - 60_000);
    fs.utimesSync(file(), before, before);
    expect(readApiEndpoint(file())).toBeNull();
  });

  it('reads nothing from a missing file, or one that makes no sense', () => {
    expect(readApiEndpoint(file())).toBeNull();
    for (const content of ['', 'not json', '3001', { port: 3001 }, { pid: process.pid }, { port: 0, pid: process.pid },
      { port: 70000, pid: process.pid }, { port: '3001', pid: process.pid }, { port: 3001, pid: -1 }]) {
      write(content);
      expect(readApiEndpoint(file()), JSON.stringify(content)).toBeNull();
    }
  });
});
