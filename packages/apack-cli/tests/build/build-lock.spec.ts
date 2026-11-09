/**
 * One build of a pack at a time (`src/build/build-lock.ts`).
 *
 * Two builds of one pack stage into the same directory and each clears it as its first act, so without this
 * the second wipes the first's half-written tree and both rename something over `dist`. Nothing else excluded
 * them: `holdChainLock` keeps one chain run per checkout and `withBuildLock` one build of the five `@apackdev`
 * packages, and a pack's own build sat between the two.
 *
 * The mechanism — the take, the takeover of a dead holder's lock, the release on four interrupts, the bounded
 * retry — is `@apackdev/host/exclusive-lock`'s, covered from above by `apack-host/tests/database/write-lock.spec.ts`
 * with real processes. What is asked here is this caller's policy: where the file sits, that it waits, what it
 * says when the wait runs out, and that the wait is not a wait on itself.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackBuildLockHeld, holdPackBuildLock, packBuildLock, waitForPackBuild } from '../../src/build/build-lock';
import { buildStagingDir } from '../../src/build/build-publication.ts';

let root: string;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

const pack = (): string => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'build-lock-')));
  return root;
};

/** A lock a *live* process holds, which is the only kind that keeps anyone out: a dead holder's is taken over */
const heldByAnother = (file: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    pid: process.ppid, machine: os.hostname(), what: 'apack pack build', since: new Date().toISOString(),
  }));
};

/** A holder that does no work: what a wedged build looks like to a waiter */
const idleHolder = async (): Promise<ReadonlyMap<number, number>> => new Map([[1, 0]]);

describe('where the lock sits', () => {
  it('is inside the pack, under the directory every pack ignores', () => {
    expect(path.relative(pack(), packBuildLock(root))).toBe(path.join('.apack', 'build.lock'));
  });

  /**
   * The load-bearing one. A build clears its staging directory before it starts, so a lock *inside* that
   * directory is removed by its own holder and the next arrival takes it while the first is still building —
   * asserted against `buildStagingDir` rather than by spelling the path, because what matters is the
   * relationship between the two and a case pinning a string passes while that rots.
   */
  it('is not inside the staging directory a build clears first', () => {
    const staged = buildStagingDir(pack());
    const lock = packBuildLock(root);
    expect(lock.startsWith(`${staged}${path.sep}`), `${lock} would be cleared by the build that holds it`).toBe(false);
  });
});

describe('a second build', () => {
  it('takes the lock when nothing holds it, and gives it back', async () => {
    const lock = await holdPackBuildLock(pack(), { packId: 'demo', what: 'apack pack build' });
    expect(fs.existsSync(packBuildLock(root))).toBe(true);
    lock.release();
    expect(fs.existsSync(packBuildLock(root))).toBe(false);
  });

  /** Waiting is this caller's choice, where the chain refuses: two builds serialised are both correct */
  it('waits for a running build rather than refusing at once', async () => {
    heldByAnother(packBuildLock(pack()));
    let waitedFor: string | undefined;
    // A clock of its own, so the bound is reached without spending it: a case that sleeps puts a guess about
    // duration into every passing run, and `spec-waits` refuses one besides
    let clock = 0;
    let tries = 0;
    await expect(holdPackBuildLock(root, {
      packId: 'demo', what: 'apack pack build', idleMs: 5_000, readWork: idleHolder,
      onWait: (holder) => { waitedFor = holder; },
      now: () => clock,
      pause: async (ms) => { tries += 1; clock += ms; },
    })).rejects.toThrow(PackBuildLockHeld);
    expect(tries, 'it refused at once instead of retrying while the holder ran').toBeGreaterThan(1);
    expect(waitedFor, 'a wait that prints nothing reads as a hang').toContain('apack pack build');
  });

  it('cancels a parent waiting for another build without touching its lock', async () => {
    const file = packBuildLock(pack());
    heldByAnother(file);
    const signal = new AbortController();
    await expect(holdPackBuildLock(root, { packId: 'demo', what: 'waiting build', signal: signal.signal,
      onWait: () => signal.abort(new Error('Build cancelled')),
    })).rejects.toThrow('Build cancelled');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).pid).toBe(process.ppid);
  });

  it('names the holder, the pack and the file it is waiting on', async () => {
    const file = packBuildLock(pack());
    heldByAnother(file);
    const err = await holdPackBuildLock(root, { packId: 'demo-pack', what: 'apack pack build', wait: false })
      .then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(PackBuildLockHeld);
    const { message } = err as PackBuildLockHeld;
    expect(message).toContain('demo-pack');
    expect(message).toContain(path.relative(process.cwd(), file));
    expect(message, 'it says what to do when no build is running').toMatch(/delete .* and try again/);
  });

  /**
   * **A take by this process is refused at once, not waited for.** `exclusive-lock.ts`'s header makes
   * non-re-entrancy deliberate — a lock that succeeds when you already hold it cannot tell you that you hold
   * it twice — and waiting would turn that refusal into spending the whole bound to say the same thing.
   */
  it('does not wait for a lock this process already holds', async () => {
    const held = await holdPackBuildLock(pack(), { packId: 'demo', what: 'apack pack build' });
    try {
      let tries = 0;
      await expect(holdPackBuildLock(root, {
        packId: 'demo', what: 'a second build',
        pause: async () => { tries += 1; },
      })).rejects.toThrow(PackBuildLockHeld);
      expect(tries, 'it waited on itself, which cannot succeed, instead of refusing').toBe(0);
      expect(fs.existsSync(packBuildLock(root)), "the refused take removed the holder's own lock").toBe(true);
    } finally {
      held.release();
    }
  });
});

describe("the holder's work is the bound", () => {
  /** A holder slow only because the machine is busy is a queue, not a wedge, however long it takes */
  it('waits for as long as the holder works, and takes the lock once it is released', async () => {
    const file = packBuildLock(pack());
    heldByAnother(file);
    let clock = 0;
    let cpu = 0;
    let looks = 0;
    const lock = await holdPackBuildLock(root, {
      packId: 'demo', what: 'apack pack build', idleMs: 5_000,
      // Busy for far longer than the stall window, then done
      readWork: async () => new Map([[1, (cpu += 2_000)]]),
      now: () => clock,
      pause: async (ms) => { clock += ms; if (++looks === 200) fs.rmSync(file); },
    });
    expect(clock, 'a working holder was given up on').toBeGreaterThan(5_000);
    lock.release();
  });
});

/**
 * **The read side, which holds nothing.** A reader of *another* pack's output cannot take that pack's lock
 * while its own build holds its own: two locks acquired in an order neither caller controls is a deadlock
 * waiting for a dependency cycle. So a dependency read waits out a build in flight and then reads — which
 * covers a build already running when the read starts, and deliberately not one that starts during it.
 */
describe('waiting for a build without taking the lock', () => {
  it('returns at once when no build is running, and takes nothing', async () => {
    const root = pack();
    expect(await waitForPackBuild(root)).toBeUndefined();
    expect(fs.existsSync(packBuildLock(root)), 'a waiter must not create the lock it waits on').toBe(false);
  });

  it('names the build it waited for, and leaves that build holding its lock', async () => {
    const root = pack();
    heldByAnother(packBuildLock(root));
    let clock = 0;
    let looks = 0;
    const waited = await waitForPackBuild(root, {
      idleMs: 5_000, readWork: idleHolder,
      now: () => clock,
      pause: async (ms) => { looks += 1; clock += ms; },
    });
    expect(waited, 'it reports what it waited for, so a wait does not read as a hang').toContain('apack pack build');
    expect(looks, 'it gave up without looking again').toBeGreaterThan(1);
    expect(fs.existsSync(packBuildLock(root)), "the holder's lock is untouched").toBe(true);
  });

  /** A holder that stops working leaves the caller to read as it would have anyway, rather than hang */
  it('returns rather than hanging when the holder stops working', async () => {
    const root = pack();
    heldByAnother(packBuildLock(root));
    let clock = 0;
    await expect(waitForPackBuild(root, {
      idleMs: 1_000, readWork: idleHolder, now: () => clock, pause: async (ms) => { clock += ms; },
    })).resolves.toContain('apack pack build');
  });
});
