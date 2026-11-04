// What a chain run keeps of its steps' output, and the four things that have to be true of where it keeps it.
//
// The chain's own file runs the chain on import, so the decisions live in `scripts/lib/chain-evidence.ts`
// where a spec can reach them without starting a build — the same arrangement `chain-output.spec.ts` and
// `chain-lock.spec.ts` have, and the reason both of those are pure specs over imported functions.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { STAMP_DIR } from '../../../scripts/lib/chain-stamps.ts';
import {
  KEEP_RUNS, RUNS_DIR, deadlinesHit, evidenceFile, evidenceHeader, evidenceLine, openRunEvidence, runId, runsToPrune,
} from '../../../scripts/lib/chain-evidence.ts';

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-evidence-'));
  temps.push(dir);
  return dir;
};

const ended = (over: Partial<{ code: number; ms: number; output: string }> = {}) =>
  ({ code: 0, ms: 1_000, output: 'what the step said', ...over });

describe('where a chain run keeps its evidence', () => {
  /**
   * The trap, and the reason the directory is not called `runs.json`. `pruneStamps` in `scripts/chain.ts`
   * walks the stamp directory and removes every `.json` that is not a live step's stamp — and it calls
   * `rmSync` with no `recursive`, so a directory named that way is not merely deleted: the call throws, and
   * a throw out of `pruneStamps` is reported as "the chain itself failed".
   *
   * Asserted against `pruneStamps`' own predicate rather than against the string `'runs'`, as
   * `chain-lock.spec.ts` does for the lock file: a case pinning the name passes while the coupling it
   * stands for rots. The `rmSync` half is demonstrated rather than argued, because "it would be worse than
   * deleted" is not a claim anyone can check by reading it.
   */
  it('is in the stamp directory, under a name pruneStamps will neither delete nor choke on', () => {
    expect(path.dirname(RUNS_DIR)).toBe(STAMP_DIR);
    const prunes = (name: string) => name.endsWith('.json');
    expect(prunes(path.basename(RUNS_DIR)), `${path.basename(RUNS_DIR)} would be pruned`).toBe(false);
    // The predicate is the live one, not a lookalike: it is what prunes a stamp
    expect(prunes(path.basename(path.join(STAMP_DIR, 'typecheck.json')))).toBe(true);

    // And what the name avoids: the prune's own `rmSync` call, against a directory named the other way
    const named = path.join(tempDir(), 'runs.json');
    fs.mkdirSync(named);
    expect(() => fs.rmSync(named)).toThrow();
  });

  /**
   * A run's name sorts by time as a string, which is the whole of how the prune knows which to keep — it
   * stats nothing. Keeping that true is why the date leads and why every field is fixed width.
   */
  it('names a run so that sorting the names sorts the runs', () => {
    const first = runId(new Date('2026-10-09T23:59:59.500Z'), 10);
    const second = runId(new Date('2026-10-10T00:00:00.100Z'), 9);
    expect(first).toBe('2026-10-09T23-59-59Z-10');
    expect([second, first].sort()).toEqual([first, second]);
  });

  /** Without the `Z` the name reads as local time, which is the one reader's own clock and not this one */
  it('says that a run time is UTC', () => {
    expect(runId(new Date('2026-10-10T08:00:00.000Z'), 1)).toBe('2026-10-10T08-00-00Z-1');
  });

  describe('which runs it keeps', () => {
    const ids = (...hours: number[]) => hours.map((hour) => runId(new Date(Date.UTC(2026, 9, 10, hour)), 1));

    it('removes all but the newest, whatever order they were read in', () => {
      const all = ids(1, 2, 3, 4, 5, 6, 7);
      // Readdir order is not chronological order, and on a case-insensitive filesystem need not be sorted
      // at all: the firing case is the list arriving shuffled
      const shuffled = [all[3], all[0], all[6], all[2], all[5], all[1], all[4]] as string[];
      const pruned = runsToPrune(shuffled, 3);
      expect(pruned.sort()).toEqual(ids(1, 2, 3, 4).sort());
      expect(pruned).not.toContain(all[6]);
    });

    it('leaves alone anything that is not a run', () => {
      expect(runsToPrune([...ids(1, 2), 'notes.txt', 'half-written', ''], 0)).toEqual(ids(2, 1));
    });

    it('keeps everything while there are fewer than the limit', () => {
      expect(runsToPrune(ids(1, 2), KEEP_RUNS)).toEqual([]);
    });
  });

  it('names a step\'s file as its stamp is spelled', () => {
    expect(path.basename(evidenceFile('/runs/one', 'test:unit:host'))).toBe('test-unit-host.log');
  });

  /** A log that outlives the summary has to say for itself how its step ended */
  it('heads each file with how that step ended', () => {
    expect(evidenceHeader('build:default-setup', ended({ code: 0, ms: 23_700 }))).toBe('# build:default-setup — exit 0 after 23.7s');
    expect(evidenceHeader('test:smoke', ended({ code: 1, ms: 6_000 }))).toBe('# test:smoke — exit 1 after 6.0s');
    expect(evidenceHeader('build:runtime', { ...ended({ ms: 300_000 }), timedOut: true }))
      .toBe('# build:runtime — timed out after 300.0s');
  });

  describe('what it writes, and when', () => {
    /** Under a temp root, because the suite holding this spec is itself a chain step */
    const opened = () =>
      openRunEvidence({ startedAt: new Date('2026-10-10T08:00:00Z'), pid: 1, root: tempDir() });

    it('creates nothing until something is kept, so a cached run leaves no directory', () => {
      const run = opened();
      expect(run.kept()).toBe(0);
      expect(fs.existsSync(run.dir)).toBe(false);
    });

    it('writes the header above the step output, and counts what it kept', () => {
      const run = opened();
      run.keep('build:default-setup', ended({ code: 1, ms: 2_000, output: 'the compiler said this' }));
      expect(fs.readFileSync(evidenceFile(run.dir, 'build:default-setup'), 'utf-8'))
        .toBe('# build:default-setup — exit 1 after 2.0s\nthe compiler said this');
      expect(run.kept()).toBe(1);
    });

    /**
     * The files a failed step wrote, kept before the next run can overwrite them.
     *
     * The paths are repo-relative. Use a private fixture tree so a concurrent Playwright run cannot
     * clear it, and this check never writes into that run's output.
     */
    it('copies the files a failed step wrote in, named for the step', () => {
      const run = opened();
      fs.mkdirSync(path.join(REPO_ROOT, '.apack'), { recursive: true });
      const left = fs.mkdtempSync(path.join(REPO_ROOT, '.apack', 'chain-evidence-'));
      temps.push(left);
      const target = path.relative(REPO_ROOT, left);
      fs.writeFileSync(path.join(left, 'kept-probe.log'), 'what the app said');
      expect(run.keepFiles('test:smoke', [target])).toEqual([target]);
      expect(fs.readFileSync(path.join(run.dir, 'test-smoke.files', path.basename(left), 'kept-probe.log'), 'utf-8'))
        .toBe('what the app said');
    });

    /** A step can fail before writing anything, which is not a second failure to report */
    it('skips a path that is not there, and keeps the ones that are', () => {
      const run = opened();
      expect(run.keepFiles('build:default-setup', ['tests/nothing-wrote-this'])).toEqual([]);
      expect(run.kept()).toBe(0);
      expect(fs.existsSync(run.dir), 'and wrote no directory for it').toBe(false);
    });

    /**
     * The printed path and the written path come from one place. This is the half that goes stale in
     * silence: a line naming a directory nothing wrote is indistinguishable from evidence that is simply
     * missing, and the whole point of the line is that someone follows it later.
     */
    it('names the directory it wrote into', () => {
      const run = opened();
      run.keep('build:default-setup', ended());
      const line = evidenceLine(run.dir, run.kept());
      expect(line).toContain(path.relative(REPO_ROOT, run.dir));
      expect(line).toContain('1 step');
      expect(evidenceLine(run.dir, 2)).toContain('2 steps');
    });
  });
});

describe('a failure on a deadline', () => {
  const failed = (output: string) => ({ code: 1, ms: 1_000, output });

  it.each([
    ['vitest', 'Error: Test timed out in 200000ms.'],
    ['a vitest hook', 'Error: Hook timed out in 240000ms.'],
    ['Playwright', 'Test timeout of 60000ms exceeded.'],
    ['runCommand', 'node apack.mjs: running past the 900000ms ceiling'],
  ])('is told apart from an assertion: %s', (_who, line) => {
    expect(deadlinesHit(line)).toBe(1);
    expect(evidenceHeader('test:integration', failed(`${line}\nmore\n`))).toContain("1 of its tests' deadlines hit");
  });

  it('leaves an assertion and a pass as they read', () => {
    expect(evidenceHeader('test:integration', failed('AssertionError: expected 1 to be 2'))).not.toContain('deadlines');
    // A pass that mentions one, a spec of the words themselves, isn't a failure on it
    expect(evidenceHeader('test:integration', { code: 0, ms: 1_000, output: 'Test timed out in 100ms' })).not.toContain('deadlines');
  });

  it('counts each one', () => {
    expect(deadlinesHit('Test timed out in 1ms\nTest timed out in 2ms\nHook timed out in 3ms')).toBe(3);
  });
});
