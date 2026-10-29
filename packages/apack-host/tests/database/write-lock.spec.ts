// The lock a tool holds while it changes a data dir's database, which an app checks before it opens the same one
//
// Its subprocesses are real ones, each compiling this package's source through tsx, so what the cases
// below wait for is a file appearing or going. Every wait is driven by that file and bounded by the suite's
// own `testTimeout` — see `waitFor`, which is where the bound being the suite's is load-bearing.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess, type StdioOptions } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoDatabaseWriter, findDatabaseWriter, holdDatabaseWriteLock } from '../../src/database/write-lock.ts';
import { INTERRUPTS } from '../../src/exclusive-lock.ts';

// Windows child.kill()/process.kill() force termination rather than delivering catchable POSIX events.
// Console Ctrl-C/Break delivery needs a real console harness; it is not qualified by these process kills.
const POSIX_INTERRUPTS = INTERRUPTS.filter(signal => signal !== 'SIGBREAK' && signal in os.constants.signals);
const FORCED_INTERRUPTS: readonly NodeJS.Signals[] = process.platform === 'win32'
  ? ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGKILL'] : ['SIGKILL'];
import { removeTempDirs, tempDir } from './fixtures.ts';
import { _appDirOf } from '@apackdev/sdk/env';

const locks: Array<{ release(): void }> = [];
/** Every child a case spawned, so reaping one is not something a case has to remember */
const children: ChildProcess[] = [];
afterEach(async () => {
  // Before the temp dirs go: a live holder has a lock file open inside one of them
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  for (const lock of locks.splice(0)) lock.release();
  removeTempDirs();
});

const hold = (dir: string, what = 'apack db reset') => {
  const lock = holdDatabaseWriteLock(dir, what);
  locks.push(lock);
  return lock;
};

const lockFile = (dir: string) => path.join(_appDirOf(dir), 'db-write.lock');

/** The module under test, loaded by a child process that holds a real lock and waits to be signalled */
const SRC = new URL('../../src/database/write-lock.ts', import.meta.url).href;
/** The child is plain node, so it needs the TypeScript loader this suite already runs under */
const TSX = createRequire(import.meta.url).resolve('tsx/esm');

/**
 * What every child below checks, and why it has to check anything.
 *
 * `afterEach` is not reached when the worker running a case is torn down, which is what happens to a case
 * vitest fails for taking too long: the continuation holding the kill stays pending and the child goes on
 * running. A holder's whole job is to sit there, so it sat there for eight days — one per interrupt over
 * three runs. `process.ppid` moving is the exact signal, since a child is reparented only once the process
 * that spawned it has gone.
 */
const EXITS_WHEN_ORPHANED =
  "const parent = Number(process.env.SPEC_PARENT_PID);" +
  "const orphaned = () => process.ppid !== parent;";

// `node -e` has no script slot, so the arguments start at argv[1]
const HOLD_UNTIL_SIGNALLED = EXITS_WHEN_ORPHANED +
  "const [, dir, src] = process.argv;" +
  "import(src).then(({ holdDatabaseWriteLock }) => { holdDatabaseWriteLock(dir, 'apack db import');" +
  "  setInterval(() => { if (orphaned()) process.exit(0); }, 250); });";

/**
 * Takes the lock as soon as `<dir>/GO` appears, and says whether it got it. Spinning on the file is what
 * puts the racers at the same instant: spawning them is seconds apart, and the race is microseconds. It says
 * `READY` on stderr first, so the parent writes `GO` only once every racer is already spinning for it.
 *
 * The orphan check goes inside the loop rather than on a timer, because the spin blocks the event loop.
 */
const RACE_FOR_LOCK = EXITS_WHEN_ORPHANED +
  "const [, dir, start, src] = process.argv;" +
  "const fs = require('node:fs');" +
  "import(src).then(({ holdDatabaseWriteLock }) => {" +
  "  process.stderr.write('READY');" +
  "  while (!fs.existsSync(start)) { if (orphaned()) process.exit(0); }" +
  "  try { holdDatabaseWriteLock(dir, 'a racer'); process.stdout.write('ACQUIRED'); }" +
  "  catch { process.stdout.write('refused'); }" +
  "  setTimeout(() => {}, 500);" +
  "});";

/** A child that cannot outlive this run: reaped in `afterEach`, and self-reaping if that is never reached */
function spawnChild(body: string, args: readonly string[], stdio: StdioOptions): ChildProcess {
  const child = spawn(process.execPath, ['--import', pathToFileURL(TSX).href, '-e', body, ...args], {
    stdio,
    env: { ...process.env, SPEC_PARENT_PID: String(process.pid) },
  });
  children.push(child);
  return child;
}

/**
 * Polls until `done`, or fails naming what it was waiting for rather than leaving that to the assertion.
 *
 * **Every budget passed here has to fit inside the suite's `testTimeout`**, which is the deadline that
 * actually fires. One past it can only ever end as vitest's generic timeout, with this case's cleanup
 * unreached — a boot budgeted at 60s in a suite that gives a test 15s is what left the holders above
 * running.
 */
async function waitFor(what: string, done: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function startHolder(dir: string): Promise<ChildProcess> {
  const holder = spawnChild(HOLD_UNTIL_SIGNALLED, [dir, SRC], ['ignore', 'ignore', 'pipe']);
  // A holder that dies on boot would otherwise be indistinguishable from a slow one until the timeout,
  // and its reason — an import this checkout's dist can't resolve, say — would be thrown away with it
  let stderr = '';
  holder.stderr!.setEncoding('utf-8');
  holder.stderr!.on('data', (chunk: string) => { stderr += chunk; });
  let died: string | null = null;
  holder.on('exit', (code) => { died = `the holder exited with code ${code}${stderr && `:\n${stderr}`}`; });
  // The holder compiles this package's source through tsx, which takes seconds when the whole unit suite
  // is running beside it. The release it is asked for afterwards is immediate, and is the thing under
  // test, so only the boot gets the long budget.
  await waitFor('the holder to take the lock', () => {
    if (died) throw new Error(died);
    return fs.existsSync(lockFile(dir));
  }, 9_000);
  return holder;
}

/** A pid no process has any more */
const exitedPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

describe('the database write lock', () => {
  it('stops listening for the process exiting once it is released', () => {
    const dir = tempDir('write-lock-');
    const before = process.listenerCount('exit');
    const lock = hold(dir);
    expect(process.listenerCount('exit')).toBe(before + 1);
    lock.release();
    lock.release();
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('is free in a data dir no tool is changing', () => {
    const dir = tempDir('write-lock-');
    expect(findDatabaseWriter(dir)).toBeNull();
    expect(() => assertNoDatabaseWriter(dir)).not.toThrow();
  });

  it('names the tool holding it, and is gone once released', () => {
    const dir = tempDir('write-lock-');
    const lock = hold(dir);
    expect(findDatabaseWriter(dir)).toBe(`apack db reset (pid ${process.pid})`);
    // A lock a killed tool left, whose pid something else now has, would otherwise leave no way forward
    expect(() => assertNoDatabaseWriter(dir)).toThrow(
      `The database in ${dir} is being changed by apack db reset (pid ${process.pid}). Wait for it to finish, then start ` +
      `apack again. If no tool is running, delete ${lockFile(dir)} and try again.`,
    );
    lock.release();
    expect(findDatabaseWriter(dir)).toBeNull();
    expect(fs.existsSync(lockFile(dir))).toBe(false);
    // Releasing again is harmless
    lock.release();
    expect(findDatabaseWriter(dir)).toBeNull();
  });

  it("releases only its own lock, never the one another tool holds", () => {
    const dir = tempDir('write-lock-');
    const lock = hold(dir);
    // Another tool took the lock over (this one's file was removed by hand, say)
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.ppid, machine: os.hostname(), what: 'another tool' }));
    lock.release();
    expect(findDatabaseWriter(dir)).toBe(`another tool (pid ${process.ppid})`);
  });

  it('refuses a second tool while it is held', () => {
    const dir = tempDir('write-lock-');
    hold(dir, 'apack db import');
    expect(() => holdDatabaseWriteLock(dir, 'apack db exec')).toThrow(
      `Another tool is changing the database in ${dir}: apack db import (pid ${process.pid}). If no tool is running, ` +
      `delete ${lockFile(dir)} and try again.`,
    );
  });

  it('preserves an incumbent after repeated refused acquisitions in the same process', () => {
    const dir = tempDir('write-lock-');
    const first = hold(dir, 'incumbent');
    const before = fs.readFileSync(lockFile(dir), 'utf8');
    for (let i = 0; i < 3; i++) {
      expect(() => holdDatabaseWriteLock(dir, 'refused contender')).toThrow('incumbent');
      expect(fs.readFileSync(lockFile(dir), 'utf8')).toBe(before);
      expect(findDatabaseWriter(dir)).toBe(`incumbent (pid ${process.pid})`);
    }
    first.release(); expect(findDatabaseWriter(dir)).toBeNull();
  });

  it('does not release a later acquisition in the same PID even with an identical timestamp', () => {
    const dir = tempDir('write-lock-'), first = hold(dir, 'first');
    const before = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8'));
    fs.rmSync(lockFile(dir));
    const second = hold(dir, 'second');
    const current = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')); current.since = before.since;
    fs.writeFileSync(lockFile(dir), JSON.stringify(current));
    first.release(); expect(findDatabaseWriter(dir)).toBe(`second (pid ${process.pid})`);
    second.release(); expect(findDatabaseWriter(dir)).toBeNull();
  });

  it('takes over a lock whose process has exited', () => {
    const dir = tempDir('write-lock-');
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: exitedPid(), machine: os.hostname(), what: 'a tool that died' }));
    expect(findDatabaseWriter(dir)).toBeNull();
    hold(dir);
    expect(findDatabaseWriter(dir)).toBe(`apack db reset (pid ${process.pid})`);
  });

  it('refuses a lock it cannot read, which is one missing what would resolve it', () => {
    for (const body of ['not json', JSON.stringify({ machine: os.hostname(), what: 'a tool' }), JSON.stringify({ pid: 1, what: 'a tool' })]) {
      const unreadable = tempDir('write-lock-');
      fs.writeFileSync(lockFile(unreadable), body);
      expect(findDatabaseWriter(unreadable)).toBe("a tool whose lock can't be read");
      expect(() => holdDatabaseWriteLock(unreadable, 'apack db reset')).toThrow(
        `Another tool is changing the database in ${unreadable}: a tool whose lock can't be read. If no tool is running, delete ${lockFile(unreadable)} and try again.`,
      );
    }
  });

  // Node runs no `exit` handler for a signal, so without the interrupt handlers Ctrl-C on any `apack db`
  // command left the lock behind and the next reader had to work out that its holder was gone. Only SIGKILL
  // can still do that, and nothing can catch it.
  it.skipIf(process.platform === 'win32').each(POSIX_INTERRUPTS)('releases the lock when the tool is interrupted with POSIX %s', async (signal) => {
    const dir = tempDir('write-lock-');
    const holder = await startHolder(dir);
    process.kill(holder.pid!, signal);
    await waitFor(`the ${signal} handler to release the lock`, () => !fs.existsSync(lockFile(dir)), 3_000);
    expect(fs.existsSync(lockFile(dir))).toBe(false);
  });

  it.each(FORCED_INTERRUPTS)('reclaims the lock after forced %s termination', async signal => {
    const dir = tempDir('write-lock-'), holder = await startHolder(dir);
    const exited = once(holder, 'exit');
    expect(holder.kill(signal)).toBe(true);
    await exited;
    // No handler ran: preserve the witness, then prove the next holder can reclaim the dead process's lock.
    expect(fs.existsSync(lockFile(dir))).toBe(true);
    expect(findDatabaseWriter(dir)).toBeNull();
    hold(dir, 'after forced termination');
    expect(findDatabaseWriter(dir)).toBe(`after forced termination (pid ${process.pid})`);
  });

  // The lock existed to keep two tools off one database and did not: it read "nothing holds it", then
  // wrote, and every racer did both in turn. Six for six, before `wx` made the create the acquisition.
  it('is taken by one of several tools that ask for it at the same moment', async () => {
    const dir = tempDir('write-lock-');
    const start = path.join(dir, 'GO');
    const racers = [...Array(6)].map(() => spawnChild(RACE_FOR_LOCK, [dir, start, SRC], ['ignore', 'pipe', 'pipe']));
    const said: string[] = [];
    const spinning = new Set<number>();
    let died: string | null = null;
    racers.forEach((racer, index) => {
      racer.stdout!.on('data', (d: Buffer) => said.push(String(d)));
      // A racer that dies on boot, as the holder above, plus the one thing that says it is in the loop
      racer.stderr!.setEncoding('utf-8');
      racer.stderr!.on('data', (chunk: string) => {
        if (chunk.includes('READY')) spinning.add(index);
        else died = `a racer wrote to stderr:\n${chunk}`;
      });
      racer.on('exit', (code) => { if (!said.length) died ??= `a racer exited with code ${code} before answering`; });
    });

    const booted = (): boolean => {
      if (died) throw new Error(died);
      return spinning.size === racers.length;
    };
    // They boot through tsx at their own pace, so the start file is what lets them act together — and every
    // racer says it is spinning for that file before any of them can see it. Waiting a fixed few seconds
    // instead was a guess at six tsx boots, and the guess outgrew the budget the suite gives a test.
    await waitFor('every racer to be spinning on the start file', booted, 9_000);
    fs.writeFileSync(start, 'go');
    await waitFor('every racer to answer', () => said.length === racers.length, 3_000);

    expect(said.filter((s) => s === 'ACQUIRED')).toHaveLength(1);
  });

  it("counts a lock from another machine, whose process it can't check", () => {
    const dir = tempDir('write-lock-');
    fs.writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid, machine: 'another-machine.local', what: 'apack db exec' }));
    expect(findDatabaseWriter(dir)).toBe('apack db exec on another-machine.local');
  });
});
