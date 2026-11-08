// findRunningApp: an app runs on a data dir when its API's port file names a port that answers, or a live process
// holds the Electron instance lock; stale files don't count
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appLockFile, findRunningApp, publishRunningApp } from '../../src/database/running.ts';
import { removeTempDirs, tempDir } from './fixtures.ts';
import { _appDirOf } from '@apackdev/sdk/env';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

afterEach(removeTempDirs);

function context() {
  const userDataDir = tempDir('running-app-');
  return { userDataDir, apiPortFile: path.join(_appDirOf(userDataDir), 'api-port') };
}

/** What a running API publishes: its port and its process */
function publishApi(dir: string, { port = 3001, pid = process.pid } = {}): void {
  fs.writeFileSync(path.join(_appDirOf(dir), 'api-port'), JSON.stringify({ port, pid }));
}

/** A pid no process has any more */
async function exitedPid(): Promise<number> {
  const exited = execFileWhileWorking(process.execPath, ['-e', '']);
  await exited;
  return exited.child.pid!;
}

/** What the app process publishes while it is using a data dir */
const appLock = (dir: string, held: Record<string, unknown>) => fs.writeFileSync(appLockFile(dir), JSON.stringify(held));
const anApp = (pid = process.pid, machine = os.hostname()) => ({ pid, machine, since: new Date().toISOString() });

/** Backdate a file to before this machine booted, as a previous boot's leftover would be */
function backdateToPreviousBoot(file: string): void {
  const before = new Date(Date.now() - os.uptime() * 1000 - 60_000);
  fs.lutimesSync(file, before, before);
}

describe('findRunningApp', () => {
  it('finds nothing in a data dir with neither file', () => {
    expect(findRunningApp(context())).toBeNull();
  });

  it('counts a port file whose API process is running', () => {
    const live = context();
    publishApi(live.userDataDir, { port: 3001 });
    expect(findRunningApp(live)?.why).toBe(`its API is running on port 3001 (pid ${process.pid})`);
  });

  it("doesn't count a port file a crashed run left behind, or one it can't read", async () => {
    const crashed = context();
    publishApi(crashed.userDataDir, { pid: await exitedPid() });
    expect(findRunningApp(crashed)).toBeNull();

    for (const content of ['not json', '3001', JSON.stringify({ port: 3001 }), JSON.stringify({ port: 'x', pid: process.pid })]) {
      const garbled = context();
      fs.writeFileSync(garbled.apiPortFile, content);
      expect(findRunningApp(garbled), content).toBeNull();
    }
  });

  it("counts the app's own file while its process runs, and not one a crash left", async () => {
    const live = context();
    appLock(live.userDataDir, anApp());
    expect(findRunningApp(live)?.why).toBe(`its process is running (pid ${process.pid})`);

    const crashed = context();
    appLock(crashed.userDataDir, anApp(await exitedPid()));
    expect(findRunningApp(crashed)).toBeNull();
  });

  // It guards a database, so a file it cannot resolve means an app may be using the dir. Chromium's lock,
  // which this replaced, was the other way round: unreadable, or Windows, and the answer was "no app".
  it("counts one it can't check: another machine's, or one it can't read", () => {
    const remote = context();
    appLock(remote.userDataDir, anApp(process.pid, 'another-machine.local'));
    expect(findRunningApp(remote)?.why).toMatch(/its process is running on another-machine\.local/);

    for (const content of ['not json', '{}', JSON.stringify({ pid: 'x', machine: 'h' }), JSON.stringify({ machine: 'h' })]) {
      const unreadable = context();
      fs.writeFileSync(appLockFile(unreadable.userDataDir), content);
      expect(findRunningApp(unreadable)?.why, content).toMatch(/is there and can't be read/);
    }
  });

  // The window the port file cannot cover: the app is up and its API has not published a port yet, or is
  // being restarted after a crash. Without this a tool would take the write lock, and the API would then
  // refuse to come back.
  it('answers before the API has published a port, and while a crashed one is restarting', async () => {
    const ctx = context();
    const stop = publishRunningApp(ctx.userDataDir);
    try {
      expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.pid})`);

      // The API boots, then crashes: its port file names a process that has gone
      publishApi(ctx.userDataDir, { pid: await exitedPid() });
      expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.pid})`);
    } finally {
      stop();
    }
    expect(findRunningApp(ctx)).toBeNull();
  });

  it('removes only its own on the way out, not one a restarted app replaced it with', () => {
    const ctx = context();
    const stop = publishRunningApp(ctx.userDataDir);
    appLock(ctx.userDataDir, anApp(process.ppid));

    stop();

    expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.ppid})`);
  });

  // The pid alone can't tell the runs apart: the OS reuses pids, so a crashed app's replacement can hold
  // the one that crashed. What each run writes about itself is what makes its own marker its own.
  it("leaves a later run's marker alone even when it holds the same pid", () => {
    const ctx = context();
    const stop = publishRunningApp(ctx.userDataDir);
    const later = { pid: process.pid, machine: os.hostname(), since: new Date(Date.now() + 1000).toISOString() };
    appLock(ctx.userDataDir, later);

    stop();

    expect(findRunningApp(ctx)?.why, "the earlier run removed the later one's marker").toBe(
      `its process is running (pid ${process.pid})`,
    );
  });
});

// `readApiEndpoint` bounds its answer by the boot that wrote the port file, where a wrong "nothing is
// running" costs a connection error to a dead port. The app's own file does not: there a wrong answer lets
// a tool write while the app has the database open, so its pid is taken at face value.
// A refusal has to say how to get out of itself. The app marker survives a crash, and `lockIsHeld` takes its
// pid at face value, so one naming a pid the OS has since reused reads as an app that is running — and
// without the file named, the data dir is one no tool can ever write to again.
describe('the way out of a refusal', () => {
  it("names the app's marker, and doesn't name the port file, which clears itself", () => {
    const ctx = context();
    fs.writeFileSync(appLockFile(ctx.userDataDir), JSON.stringify({ pid: process.pid, machine: os.hostname(), since: '' }));
    expect(findRunningApp(ctx)?.marker).toBe(appLockFile(ctx.userDataDir));

    fs.rmSync(appLockFile(ctx.userDataDir));
    publishApi(ctx.userDataDir);
    expect(findRunningApp(ctx)?.why).toMatch(/its API is running/);
    expect(findRunningApp(ctx)?.marker, 'a port file is bound by its boot, so it needs no way out').toBeUndefined();
  });

  it('names it for a marker it cannot resolve, and one from another machine', () => {
    const unreadable = context();
    fs.writeFileSync(appLockFile(unreadable.userDataDir), 'not json');
    expect(findRunningApp(unreadable)?.marker).toBe(appLockFile(unreadable.userDataDir));

    const remote = context();
    fs.writeFileSync(appLockFile(remote.userDataDir), JSON.stringify({ pid: 1, machine: 'another-host.local', since: '' }));
    expect(findRunningApp(remote)?.marker).toBe(appLockFile(remote.userDataDir));
  });
});

describe('findRunningApp, on a port file left by a previous boot', () => {
  it('ignores a port file that predates this boot, whatever pid it names', () => {
    const ctx = context();
    publishApi(ctx.userDataDir);
    expect(findRunningApp(ctx)?.why).toMatch(/its API is running on port 3001/);

    backdateToPreviousBoot(ctx.apiPortFile);
    expect(findRunningApp(ctx)).toBeNull();
  });

  it("still counts the app's own file a live process holds, however old it is", () => {
    const ctx = context();
    appLock(ctx.userDataDir, anApp());
    backdateToPreviousBoot(appLockFile(ctx.userDataDir));

    expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.pid})`);
  });
});
