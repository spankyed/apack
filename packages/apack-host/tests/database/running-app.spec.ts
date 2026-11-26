// findRunningApp: an app runs on a data dir when a live process holds `app.lock` or `api-runtime.json`;
// stale files don't count.
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
  return { userDataDir, runtimeFile: path.join(_appDirOf(userDataDir), 'api-runtime.json') };
}

/** What a running API publishes: its process id (and optional tool socket) in `api-runtime.json`. */
function publishRuntime(dir: string, { pid = process.pid } = {}): void {
  fs.writeFileSync(path.join(_appDirOf(dir), 'api-runtime.json'), JSON.stringify({ pid }));
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

  it('counts a live api-runtime.json record ({ pid } or { pid, socket, token }) and ignores stale or garbled ones', async () => {
    const live = context();
    publishRuntime(live.userDataDir);
    expect(findRunningApp(live)).toEqual({ why: `its API is running (pid ${process.pid})`, pid: process.pid });

    const stale = context();
    publishRuntime(stale.userDataDir, { pid: await exitedPid() });
    expect(findRunningApp(stale)).toBeNull();

    for (const content of ['not json', '3001', '{}', JSON.stringify({ pid: 'x' })]) {
      const garbled = context();
      fs.writeFileSync(garbled.runtimeFile, content);
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

  it('answers before the API has published api-runtime.json, and while a crashed one is restarting', async () => {
    const ctx = context();
    const stop = publishRunningApp(ctx.userDataDir);
    try {
      expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.pid})`);

      publishRuntime(ctx.userDataDir, { pid: await exitedPid() });
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

describe('the way out of a refusal', () => {
  it("names the app's marker, and doesn't name api-runtime.json, which clears itself", () => {
    const ctx = context();
    fs.writeFileSync(appLockFile(ctx.userDataDir), JSON.stringify({ pid: process.pid, machine: os.hostname(), since: '' }));
    expect(findRunningApp(ctx)?.marker).toBe(appLockFile(ctx.userDataDir));

    fs.rmSync(appLockFile(ctx.userDataDir));
    publishRuntime(ctx.userDataDir);
    expect(findRunningApp(ctx)?.why).toMatch(/its API is running/);
    expect(findRunningApp(ctx)?.marker, 'api-runtime.json is bound by its boot, so it needs no way out').toBeUndefined();
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

describe('findRunningApp, on an api-runtime.json left by a previous boot', () => {
  it('ignores an api-runtime.json that predates this boot, whatever pid it names', () => {
    const ctx = context();
    publishRuntime(ctx.userDataDir);
    expect(findRunningApp(ctx)?.why).toMatch(/its API is running/);

    backdateToPreviousBoot(ctx.runtimeFile);
    expect(findRunningApp(ctx)).toBeNull();
  });

  it("still counts the app's own file a live process holds, however old it is", () => {
    const ctx = context();
    appLock(ctx.userDataDir, anApp());
    backdateToPreviousBoot(appLockFile(ctx.userDataDir));

    expect(findRunningApp(ctx)?.why).toBe(`its process is running (pid ${process.pid})`);
  });
});
