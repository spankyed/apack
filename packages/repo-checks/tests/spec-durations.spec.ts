// What a pool run's own reporter recorded, which is no longer a parse: the shapes a console line could
// take are vitest's business and this reads a typed object instead. The gate over it is pinned in both
// directions, because the two are
// not symmetrical — a marked spec that reads fast fails the step, and an unmarked one that reads slow is
// only ever reported, since load can inflate a duration and cannot shorten one.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { WORTH_NAMING_MS,
  asDuration, asLocalTime, durationCacheDir, durationsOf, markedSpecs, placementOf, pruneDurationCache,
  cachedDurations, halfBound, halfTotal, KEPT_RUNS, outlierIn, quantileOf, readDurationRuns, readDurations,
  slowestFiles,
  slowReason, tailBar,
  trendOf, writeDurations, type FileDuration,
} from '../../../scripts/lib/spec-durations.ts';
import { UNIT_SUITES } from '../../../scripts/lib/unit-suites.ts';
import { CONFIG_BY_HALF, type Half } from '../../../scripts/lib/spec-halves.ts';
import type { ReportedRun } from '../../../scripts/lib/spec-durations-reporter.ts';

/** Two suites that really exist and really hold these files, since attribution is by path on disk */
const HOST = UNIT_SUITES.filter((suite) => ['apack-host', 'apack-sdk'].includes(suite.dir));
const ONE = UNIT_SUITES.filter((suite) => suite.dir === 'apack-host');

/** A row as a run reports one. `collectMs` defaults to a figure no case asserts unless it says so. */
const row = (dir: string, file: string, ms: number, overheadMs = 0): FileDuration =>
  ({ dir, file, ms, overheadMs, half: file.endsWith('.integration.spec.ts') ? 'integration' : 'fast' });

const temp: string[] = [];
const tmpdir = (): string => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-durations-'));
  temp.push(made);
  return made;
};
afterEach(() => {
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A module as the durations reporter records one */
const mod = (project: string, file: string, ms: number, skipped = false, overheadMs = 0) =>
  ({ project, file, ms, overheadMs, skipped, overBudget: [] });
const reported = (...modules: ReturnType<typeof mod>[]): ReportedRun =>
  ({ projects: [...new Set(modules.map((one) => one.project))], modules });

/**
 * Every file the run reported, attributed to the suite that holds it.
 *
 * **This replaced a parse of vitest's console output, and most of the cases went with it.** There were
 * five that existed only because of what a console line is: a bare line and a piped `|name|` label and a
 * coloured one (three spellings of the same fact), a path-vs-label preference for the one relative path
 * two suites share, a `(ms|s)` unit arm no vitest 3.2.4 line can produce, and a pair holding the refusal
 * that told "the format moved" apart from "nothing ran". The reporter states the project and the
 * duration, so none of those is a question any more — and the refusal is now the caller's, over a file
 * that never arrived, which is a stronger thing to check than a format that looks wrong.
 */
describe('durationsOf', () => {
  it('attributes a module to the suite whose project reported it', () => {
    const run = reported(
      mod('@apackdev/host', 'tests/database/write-lock.spec.ts', 4890),
      mod('@apackdev/sdk', 'tests/build/generate-entries.spec.ts', 17745),
    );
    expect(durationsOf(run, HOST)).toEqual([
      row('apack-host', 'tests/database/write-lock.spec.ts', 4890),
      row('apack-sdk', 'tests/build/generate-entries.spec.ts', 17745),
    ]);
  });

  /**
   * The path that two suites share, which a parse could only resolve from a label.
   *
   * `tests/source-layout.spec.ts` is in both `api` and `renderer`, and the old reading fell back to
   * looking for the file on disk whenever vitest had printed no label — which it does for any
   * single-project run. The project is stated now, so the collision cannot arise.
   */
  it('keeps two suites\' identically-named specs apart', () => {
    const covered = UNIT_SUITES.filter((suite) => ['api', 'renderer'].includes(suite.dir));
    const run = reported(
      mod('@app/renderer', 'tests/source-layout.spec.ts', 55),
      mod('@app/api', 'tests/source-layout.spec.ts', 31),
    );
    expect(durationsOf(run, covered)).toEqual([
      row('renderer', 'tests/source-layout.spec.ts', 55),
      row('api', 'tests/source-layout.spec.ts', 31),
    ]);
  });

  /**
   * A skipped module is dropped, and that is a correctness fix rather than a port.
   *
   * The console prints a skipped file with no duration at all, so the parse excluded it by accident — the
   * pattern required a time. A reporter gives it `0`, and counting a file that never executed as a 0ms
   * reading would pull its half's quantile bar down. `default-setup`'s `claude-code-permission-flow`
   * sits behind a `describe.skipIf` today, so this has a live subject.
   */
  it('drops a module that did not run, which reports 0 rather than nothing', () => {
    const run = reported(
      mod('@apackdev/host', 'tests/database/write-lock.spec.ts', 4890),
      mod('@apackdev/host', 'tests/skipped-entirely.spec.ts', 0, true),
    );
    expect(durationsOf(run, ONE)).toEqual([row('apack-host', 'tests/database/write-lock.spec.ts', 4890)]);
  });

  it('takes a half from the filename, as every other consumer of a spec path does', () => {
    const covered = UNIT_SUITES.filter((suite) => suite.dir === 'apack-cli');
    const run = reported(
      mod('@apackdev/cli', 'tests/build/facade-typing.integration.spec.ts', 39800),
      mod('@apackdev/cli', 'tests/commands/run-install.spec.ts', 3234),
    );
    expect(durationsOf(run, covered).map((found) => found.half)).toEqual(['integration', 'fast']);
  });

  it('says nothing about a run that reported no modules', () => {
    expect(durationsOf({ projects: ['@apackdev/host'], modules: [] }, ONE)).toEqual([]);
  });

  // Named rather than dropped: a silent drop takes the file out of the ranking, the gate and the cache at
  // once. The cause is narrower than it was — a workspace name and its vitest project name having
  // diverged — and it is the same divergence `projectsThatDidNotRun` refuses on
  it('refuses a module whose project is none of the covered suites', () => {
    const run = reported(mod('@apackdev/no-such-project', 'tests/a.spec.ts', 10));
    expect(() => durationsOf(run, ONE)).toThrow(/is none of the 1 suite/);
  });
});

describe('quantileOf', () => {
  it('takes the nearest rank, so every value it returns is one that was measured', () => {
    expect(quantileOf([10, 20, 30, 40], 0.5)).toBe(20);
    expect(quantileOf([10, 20, 30, 40], 0.9)).toBe(40);
  });

  it('has no answer for an empty set, rather than zero', () => {
    expect(quantileOf([], 0.9)).toBeUndefined();
  });
});

describe('tailBar', () => {
  // The two halves are separate populations — measured 2026-10-05, a 16ms median against 4,870ms — so a
  // bar taken over both describes neither. Today each pool measures one half, so this is construction
  // rather than a live gate, and the case is what holds the construction
  it('is each half\'s own, not one bar over both', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, index) => row('apack-host', `tests/f${index}.spec.ts`, (index + 1) * 10)),
      ...Array.from({ length: 10 }, (_, index) => row('apack-cli', `tests/g${index}.integration.spec.ts`, (index + 1) * 4000)),
    ];
    expect(tailBar(rows, 'fast')).toBe(180);
    expect(tailBar(rows, 'integration')).toBe(36_000);
    // And the number a bar over both would be, which is neither of them
    expect(quantileOf(rows.map((found) => found.ms), 0.9)).toBe(28_000);
  });

  it('has no bar for a half this run did not measure', () => {
    expect(tailBar([row('apack-host', 'tests/a.spec.ts', 10)], 'integration')).toBeUndefined();
  });
});

describe('slowReason', () => {
  it('reads the marker out of a leading comment block', () => {
    const source = ['// A subject line', '//', '// @slow: it spawns seven processes', 'import * as fs from \'node:fs\';'].join('\n');
    expect(slowReason(source)).toBe('it spawns seven processes');
  });

  // The header is where a reader who opened the file because it was slow will look, and restricting the
  // scan to it is also what keeps a test's own body from carrying one by accident
  it('does not read a marker past the header', () => {
    const source = ['import * as fs from \'node:fs\';', '', '// @slow: not a header'].join('\n');
    expect(slowReason(source)).toBeUndefined();
  });

  it('has no reason for a header that carries none', () => {
    expect(slowReason('// Just a subject line\nimport x from \'y\';')).toBeUndefined();
  });

  /**
   * A block-comment header carries one too, and reading only `//` lines was the defect.
   *
   * 14 of this repo's 326 specs open with a block, and on every one of them a marker was ignored
   * *silently*: the gate read the spec as unmarked, which it reports rather than fails, so a contributor
   * following the documented convention got no marker and no complaint about it either.
   */
  it('reads the marker out of a block-comment header, which is how most headers here are written', () => {
    const source = ['/**', ' * What this spec covers.', ' *', ' * @slow: it compiles a program per case', ' */', 'import x from \'y\';'].join('\n');
    expect(slowReason(source)).toBe('it compiles a program per case');
  });

  it('reads one written as a single-line block', () => {
    expect(slowReason('/* @slow: it spawns a compiler */\nimport x from \'y\';')).toBe('it spawns a compiler');
  });

  // A header is whichever comment forms open the file, in any order — the rule is where the code starts
  it('keeps reading line comments after a block header closes', () => {
    const source = ['/** A subject. */', '// @slow: still the header', 'import x from \'y\';'].join('\n');
    expect(slowReason(source)).toBe('still the header');
  });

  it('still stops where the code starts, past a block header', () => {
    const source = ['/**', ' * A subject.', ' */', 'import x from \'y\';', '', '// @slow: not a header'].join('\n');
    expect(slowReason(source)).toBeUndefined();
  });
});

describe('asLocalTime', () => {
  /**
   * A stored stamp is UTC and a printed one is the reader's own clock, and conflating them printed a time
   * four hours out — past 20:00 at UTC-4, tomorrow's date. The value exists to say how stale an answer is,
   * which is a comparison against the clock on the wall.
   */
  it('renders a UTC stamp on this machine\'s clock rather than slicing the ISO string', () => {
    const iso = '2026-10-05T23:49:17.566Z';
    const at = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    expect(asLocalTime(iso)).toBe(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`);
    // The failure, stated as the thing that must not happen: the old rendering was a slice of the string
    if (at.getTimezoneOffset() !== 0) expect(asLocalTime(iso)).not.toBe(iso.slice(0, 16).replace('T', ' '));
  });

  it('hands back a stamp it cannot parse, rather than a line of NaN', () => {
    expect(asLocalTime('not a date')).toBe('not a date');
  });
});

describe('markedSpecs', () => {
  // Derived from the tree rather than listed, and asserted non-empty: a scan that found nothing would
  // satisfy every assertion the gate makes over it
  it('finds the markers the repo really carries', () => {
    const found = UNIT_SUITES.flatMap((suite) =>
      [...markedSpecs(path.join(REPO_ROOT, 'packages', suite.dir))].map(([file]) => `${suite.dir}/${file}`));
    expect(found.length, 'no spec carries a @slow: marker, so the gate over them looks at nothing')
      .toBeGreaterThan(0);
    for (const marked of found) expect(marked).toMatch(/\.spec\.ts$/);
  });
});

describe('placementOf', () => {
  const nine = [5, 10, 15, 20, 25, 30, 35, 40, 45].map((ms, index) => row('apack-host', `tests/f${index}.spec.ts`, ms));
  const marked = (file: string, reason = 'a reason'): Map<string, Map<string, string>> =>
    new Map([['apack-host', new Map([[file, reason]])]]);
  /** Every case below had the whole half to judge from, which is what lets the gate speak at all */
  const WHOLE = { whole: true } as const;

  /**
   * The bar alone, with the absolute floor taken out of the way.
   *
   * **The two guards want opposite things of a fixture, which is why they are named apart here.** These
   * rows are milliseconds apart and production's floor is ten seconds, so a case about the quantile has to
   * lift the floor to say anything, and a case about the report has to drop it. Each guard then gets its
   * own case at the real value — `leaves a marked spec alone while it is still slow in absolute terms` and
   * `names none of a half whose slowest files are small in absolute terms` — so neither is only ever
   * exercised at a value no run uses.
   */
  const BAR_ONLY = { ...WHOLE, worthNamingMs: Number.POSITIVE_INFINITY } as const;

  /** And the report's side: named whatever its size, so what the case is about is the ranking */
  const ANY_SIZE = { ...WHOLE, worthNamingMs: 0 } as const;

  it('fails a marked spec that is no longer in its half\'s tail, quoting its reason', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    const { stale } = placementOf(rows, marked('tests/f0.spec.ts', 'it spawns seven processes'), BAR_ONLY);
    expect(stale).toEqual([
      { dir: 'apack-host', file: 'tests/f0.spec.ts', ms: 5, bar: 45, reason: 'it spawns seven processes' },
    ]);
  });

  /**
   * The file that *is* the bar is not below it.
   *
   * A nearest-rank quantile returns one of the readings, so a marked spec can land exactly on its half's
   * p90 and `<=` would call it stale for an arithmetic reason. The chain caught this on 2026-10-06:
   * `facade-typing-published` at 23.5s against a 23.5s p90, third of 28 files, where `ceil(0.9 * 28)`
   * lands on it — and the remedy it printed was to drop a true marker from a 23.5s spec.
   */
  it('leaves alone the marked spec whose own reading is the bar', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 46), row('apack-host', 'tests/mid.spec.ts', 45)];
    const bar = tailBar(rows, 'fast')!;
    expect(bar, 'the fixture puts a marked file exactly on the bar').toBe(45);
    expect(placementOf(rows, marked('tests/mid.spec.ts'), BAR_ONLY).stale).toEqual([]);
  });

  /**
   * And a marked spec that is still large is never called stale, whatever its neighbours did.
   *
   * "No longer in the slow tail" is not the claim a marker makes. A half whose every file is big has a big
   * p90, and telling someone to drop the marker from a 20s spec because its neighbours grew past it is
   * advice that is simply false.
   */
  it('leaves a marked spec alone while it is still slow in absolute terms', () => {
    const big = Array.from({ length: 9 }, (_, index) =>
      row('apack-host', `tests/big${index}.spec.ts`, WORTH_NAMING_MS * (index + 3)));
    const rows = [...big, row('apack-host', 'tests/marked.spec.ts', WORTH_NAMING_MS * 2)];
    expect(placementOf(rows, marked('tests/marked.spec.ts'), { whole: true }).stale,
      'under its half\'s bar, and still 20s').toEqual([]);
  });

  it('leaves a marked spec that is still in the tail alone', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    expect(placementOf(rows, marked('tests/slow.spec.ts'), BAR_ONLY).stale).toEqual([]);
  });

  // The other direction, and the reason it is not a failure: load inflates a duration by a measured 1.27x
  // median and 3.29x at worst, so a busy machine can put a file here on its own
  it('reports an unmarked spec in the slowest few without failing', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    const { stale, unmarked } = placementOf(rows, new Map(), ANY_SIZE);
    expect(stale).toEqual([]);
    expect(unmarked.map((found) => found.file)).toEqual(['tests/slow.spec.ts']);
  });

  it('bounds that report by the ranking, not by the bar, since a tenth of a half is over it by construction', () => {
    const many = Array.from({ length: 100 }, (_, index) => row('apack-host', `tests/f${index}.spec.ts`, index * 10));
    expect(placementOf(many, new Map(), ANY_SIZE).unmarked).toHaveLength(5);
    expect(placementOf(many, new Map(), { ...ANY_SIZE, limit: 2 }).unmarked).toHaveLength(2);
  });

  /**
   * And the ranking cannot carry it either, which is what the absolute floor is for.
   *
   * The case above is the reason: in a half of a hundred files the slowest five are above its p90 by
   * construction, so without a floor this report names five files forever however small they are. Observed
   * 2026-10-06 before the floor existed — three `default-setup` specs at 469ms, 591ms and 1.4s, in a half
   * whose p90 is ~450ms. The only way to quiet that is to mark a 591ms spec slow, which is annotating a
   * file to satisfy an instrument rather than because it is true.
   */
  it('names none of a half whose slowest files are small in absolute terms', () => {
    const many = Array.from({ length: 100 }, (_, index) => row('apack-host', `tests/f${index}.spec.ts`, index * 10));
    expect(placementOf(many, new Map(), { whole: true }).unmarked, 'the real floor mutes a 990ms tail')
      .toEqual([]);
    const big = [...many, row('apack-host', 'tests/huge.spec.ts', WORTH_NAMING_MS + 1)];
    expect(placementOf(big, new Map(), { whole: true }).unmarked.map((found) => found.file))
      .toEqual(['tests/huge.spec.ts']);
  });

  // A nearest-rank quantile of a small population is its maximum, and then nothing is above the bar —
  // including the slowest file. A pool runs the projects whose inputs moved, so a run of one small
  // project is ordinary: measured 2026-10-05, `publish-checks` alone is four files and `renderer` eight
  it('checks no marker in a half too small to have a tail, and says which half', () => {
    const four = [1000, 2000, 3000, 3035].map((ms, index) => row('apack-host', `tests/f${index}.spec.ts`, ms));
    const { stale, unplaceable } = placementOf(four, marked('tests/f0.spec.ts'), BAR_ONLY);
    expect(stale, 'a bar that is its own population\'s maximum places nothing, so it may fail nothing')
      .toEqual([]);
    expect(unplaceable).toEqual([{ half: 'fast', files: 4, why: 'too few files' }]);
  });

  it('says nothing about a half the run never measured', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    expect(placementOf(rows, new Map(), WHOLE).unplaceable).toEqual([]);
  });

  /**
   * And the same principle one step out: a project that *did* run is not evidence either, while the
   * projects beside it are missing.
   *
   * The case below already refuses to judge a marked spec whose project did not run, "the alternative
   * being a gate whose answer depends on which projects happened to be stale" — which is exactly what the
   * bar was, since it is the run's own p90. These two hold the same rows and differ only in `whole`, so
   * what changes the answer is the guard and not the data: a marked spec at a constant 2,900ms is stale
   * against a whole half and unjudged against part of one.
   */
  it('judges no marker from part of a half, however far under that part\'s bar a marked spec sits', () => {
    const slower = [8000, 7000, 6000, 5000, 4000, 3500].map((ms, index) => row('apack-host', `tests/s${index}.spec.ts`, ms));
    const faster = [100, 90, 80, 70].map((ms, index) => row('apack-host', `tests/q${index}.spec.ts`, ms));
    const rows = [row('apack-host', 'tests/marked.spec.ts', 2900), ...slower, ...faster];

    const partial = placementOf(rows, marked('tests/marked.spec.ts'), { whole: false });
    expect(partial.stale, 'it has not moved; only its neighbours have').toEqual([]);
    expect(partial.unplaceable).toEqual([{ half: 'fast', files: 11, why: 'a partial run' }]);

    const complete = placementOf(rows, marked('tests/marked.spec.ts'), BAR_ONLY);
    expect(complete.stale.map((found) => found.bar), 'the same rows do fail a whole half, so the guard is '
      + 'what differs and not the population').toEqual([7000]);
  });

  it('still ranks a partial run, since the ranking is a report and not a gate', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    expect(placementOf(rows, new Map(), { ...ANY_SIZE, whole: false }).unmarked.map((found) => found.file))
      .toEqual(['tests/slow.spec.ts']);
  });

  // A marked spec in a project the pool did not run is not evidence either way. The alternative is a gate
  // whose answer depends on which projects happened to be stale
  it('ignores a marked spec that this run did not measure', () => {
    const rows = [...nine, row('apack-host', 'tests/slow.spec.ts', 5000)];
    expect(placementOf(rows, marked('tests/never-ran.spec.ts'), BAR_ONLY).stale).toEqual([]);
  });
});

describe('slowestFiles', () => {
  it('ranks a half by duration, which is the one thing vitest does not print', () => {
    const rows = [1328, 1255, 2443, 2838, 2478, 3163].map((ms, index) => row('apack-host', `tests/f${index}.spec.ts`, ms));
    expect(slowestFiles(rows, 'fast', 3).map((found) => found.ms)).toEqual([3163, 2838, 2478]);
  });
});

describe('the duration cache', () => {
  it('keeps a suite\'s two halves apart, so one run does not clobber the other\'s', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 10)]);
    writeDurations(root, [row('apack-cli', 'tests/b.integration.spec.ts', 9000)]);
    writeDurations(root, [row('apack-cli', 'tests/c.spec.ts', 20)]);
    expect(readDurations(root, 'apack-cli', 'integration')?.ms).toEqual({ 'tests/b.integration.spec.ts': 9000 });
    expect(readDurations(root, 'apack-cli', 'fast')?.ms).toEqual({ 'tests/c.spec.ts': 20 });
    expect(fs.readdirSync(durationCacheDir(root)).sort())
      .toEqual(['apack-cli.fast.json', 'apack-cli.integration.json', 'apack-host.fast.json']);
  });

  // The answer a fresh clone gives, and the one `spec:dry` has to be able to print around
  it('has no answer where no run has measured, rather than a zero', () => {
    expect(readDurations(tmpdir(), 'apack-host', 'fast')).toBeUndefined();
  });

  it('has no answer for a half-written file, which means the same thing', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 10)]);
    const file = path.join(durationCacheDir(root), 'apack-host.fast.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 12));
    expect(readDurations(root, 'apack-host', 'fast')).toBeUndefined();
  });

  it('records when it measured, so a reader can say how old the answer is', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 10)], '2026-10-05T12:00:00.000Z');
    expect(readDurations(root, 'apack-host', 'fast')?.measuredAt).toBe('2026-10-05T12:00:00.000Z');
  });
});

/**
 * What a run measured, as against what the machine happens to hold.
 *
 * A pool runs only the projects whose inputs moved, so a step can run, find none of them stale and measure
 * nothing at all. Observed before this filter existed: a chain step returned in 0.8s and printed 17.3s of
 * file time over 100 files, which a direct run minutes earlier had measured. True of the machine, false of
 * that step. `since` is what makes the report a claim about one run.
 */
describe('cachedDurations', () => {
  const ONE_SUITE = UNIT_SUITES.filter((suite) => suite.dir === 'apack-host');
  const withRun = (measuredAt: string): string => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 1200)], measuredAt);
    return root;
  };

  it('reads what the cache holds when no run is named', () => {
    expect(cachedDurations(withRun('2026-10-01T00:00:00.000Z'), ONE_SUITE, 'fast')).toHaveLength(1);
  });

  it('keeps a record the named run wrote', () => {
    const root = withRun('2026-10-02T00:00:00.000Z');
    expect(cachedDurations(root, ONE_SUITE, 'fast', new Date('2026-10-01T00:00:00.000Z'))).toHaveLength(1);
  });

  // The firing case: the step ran, measured nothing, and the records predate it
  it('leaves out a record older than the run being reported on', () => {
    const root = withRun('2026-10-01T00:00:00.000Z');
    expect(cachedDurations(root, ONE_SUITE, 'fast', new Date('2026-10-02T00:00:00.000Z'))).toEqual([]);
  });
});

/**
 * A half's whole weight, which is the number a ranking cannot give.
 *
 * The two come apart exactly where it matters: measured 2026-10-05, the five slowest files hold 46% of
 * `repo-checks`' fast half and 97% of `apack-sdk`'s. And the shape no top-five can show at all is many
 * files each creeping a little — 349 of 388 fast-half files are under 500ms and total 24.1s between them,
 * so every one of them could double without entering any ranking.
 */
describe('halfTotal', () => {
  const rows = [
    row('apack-host', 'tests/a.spec.ts', 1200),
    row('apack-host', 'tests/b.spec.ts', 300),
    row('apack-cli', 'tests/c.integration.spec.ts', 40_000),
  ];

  it('sums one half and counts its files, leaving the other half out', () => {
    expect(halfTotal(rows, 'fast')).toEqual({ ms: 1500, overheadMs: 0, files: 2 });
    expect(halfTotal(rows, 'integration')).toEqual({ ms: 40_000, overheadMs: 0, files: 1 });
  });

  // Summed beside `ms` rather than into it: the pack pool is 19.9s of tests against 163.8s of import and
  // setup, so a half's weight that left the second out would be off by eight
  it('sums overhead beside tests, as a second quantity', () => {
    const rows = [row('a', 'tests/one.spec.ts', 700, 1700), row('a', 'tests/two.spec.ts', 300, 1600)];
    expect(halfTotal(rows, 'fast')).toEqual({ ms: 1000, overheadMs: 3300, files: 2 });
  });

  it('is zero over no files, which is a total and not an absence', () => {
    expect(halfTotal([], 'fast')).toEqual({ ms: 0, overheadMs: 0, files: 0 });
  });
});

/**
 * Which of the two things that can bound a half's run actually does.
 *
 * `max(floor, work/cores)` was prose in `measure-suites.ts`' header for a month and existed nowhere in
 * code, and the gap is why `generate-entries.spec.ts` was split for nothing: an 18.3s floor read as
 * binding against a `work/cores` of 8.7s taken from test time alone, where the honest figure including
 * import and setup was 28.1s and the half was work-bound throughout.
 */
describe('halfBound', () => {
  // The host pool's own figures, 2026-10-06: 141.4s of tests, 139.6s of overhead, a 10.0s floor, 10 cores
  const host = [row('apack-sdk', 'tests/compiles.spec.ts', 10_000, 1000),
    row('apack-sdk', 'tests/shapes.spec.ts', 9400, 1000),
    // the rest of the half, spread as 280 files are rather than heaped into one that would be the floor
    ...Array.from({ length: 280 }, (_, n) => row('a', `tests/rest-${n}.spec.ts`, 436, 491))];

  it('measures the floor by what a file cost, not by its test time alone', () => {
    expect(halfBound(host, 'fast', 10).floorMs, 'compiles: 10.0s of tests and 1.0s around them')
      .toBe(11_000);
  });

  it('calls a half work-bound when its work outweighs its slowest file', () => {
    const bound = halfBound(host, 'fast', 10);
    expect(bound.floorMs, 'the floor is what the file cost, tests and overhead').toBe(11_000);
    expect(bound.perCoreMs / 1000, 'tests and overhead, over the cores').toBeCloseTo(28.1, 0);
    expect(bound.binds).toBe('work');
  });

  /**
   * **And it refuses to judge a half whose records predate overhead, rather than reaching the wrong verdict.**
   *
   * The figures are the ones the mistake was made on: `generate-entries.spec.ts` at 18.3s in a fast half of
   * 86.5s of test time. From test time alone that is a `work/cores` of 8.7s against an 18.3s floor —
   * floor-bound, and a file worth splitting. With the import and setup the same half also costs it is 22.6s
   * and work-bound, and splitting the floor could buy nothing. It bought nothing.
   *
   * So a record with no overhead figures gets both numbers, because they are facts about what is recorded,
   * and no verdict — the one it would reach is the wrong one, and a missing overhead always errs toward
   * calling the floor binding.
   */
  it('refuses a verdict where overhead was never recorded, and says how many files', () => {
    const floor = row('apack-sdk', 'tests/generate-entries.spec.ts', 18_300, 0);
    const rest = Array.from({ length: 287 }, (_, n) => row('a', `tests/rest-${n}.spec.ts`, 238, 0));
    const bound = halfBound([floor, ...rest], 'fast', 10);
    expect(bound.perCoreMs / 1000, 'tests alone, which is half the truth').toBeCloseTo(8.7, 0);
    expect(bound.floorMs).toBe(18_300);
    expect(bound.binds, 'and the figure that would have been drawn from it is not drawn').toBe('unknown');
    expect(bound.unmeasured).toBe(288);
  });

  // The same half once overhead is recorded: work-bound, as it really was
  it('judges it work-bound once the overhead is there', () => {
    const floor = row('apack-sdk', 'tests/generate-entries.spec.ts', 18_300, 1000);
    const rest = Array.from({ length: 287 }, (_, n) => row('a', `tests/rest-${n}.spec.ts`, 238, 483));
    const bound = halfBound([floor, ...rest], 'fast', 10);
    expect(bound.perCoreMs / 1000).toBeCloseTo(22.6, 0);
    expect(bound.binds).toBe('work');
    expect(bound.unmeasured).toBe(0);
  });

  it('calls a half floor-bound when one file really does exceed its work', () => {
    const rows = [row('a', 'tests/one.spec.ts', 60_000, 100), row('a', 'tests/two.spec.ts', 1000, 100)];
    expect(halfBound(rows, 'fast', 10).binds).toBe('floor');
  });

  it('answers for a half it has no rows for, rather than dividing by nothing', () => {
    expect(halfBound([], 'fast', 10)).toEqual({ floorMs: 0, perCoreMs: 0, binds: 'work', unmeasured: 0 });
    expect(halfBound(host, 'fast', 0).perCoreMs, 'a box with no cores is not a division').toBe(0);
  });
});

/**
 * Whether a half's slowest files stand apart from the rest of it.
 *
 * **Nothing in this repo fires it today, so every case here is the firing case.** A detector whose
 * reporting branch no case reaches is the "gate nothing has watched fail" the root guide names, so the
 * ratios below are the only place that branch is ever taken. The line it feeds is covered separately —
 * `poolDurationLines`' describe in `unit-pool.spec.ts` plants a cache under a temp root and reads the text
 * back — and what stays unchecked is `scripts/chain.ts` assembling those lines, which runs the chain on
 * import and so cannot be imported.
 *
 * The rows below are the recorded pre-split world: `generate-entries.spec.ts` at 18.3s over a 4.9s peer,
 * which is what it read in five of the window's runs (3.39-4.09x) before it became five files.
 */
describe('outlierIn', () => {
  // Overhead left at zero so each peer's cost is its `ms`, which keeps the ratios in these cases readable
  const peers = [row('apack-host', 'tests/write-lock.spec.ts', 4900),
    row('apack-cli', 'tests/run-install.spec.ts', 4000),
    row('apack-host', 'tests/published-manifest.spec.ts', 3400),
    row('apack-ui', 'tests/store.spec.ts', 3300)];

  it('reports one file standing above its half, with the ratio the caller prints', () => {
    const found = outlierIn([row('apack-sdk', 'tests/generate-entries.spec.ts', 18_300), ...peers], 'fast')!;
    expect(found.above.map((r) => r.file)).toEqual(['tests/generate-entries.spec.ts']);
    expect(found.belowMs).toBe(4900);
    expect(found.ratio).toBeCloseTo(3.73, 1);
  });

  /**
   * And two files that are large together, which a floor-to-next test cannot see.
   *
   * The ratio between them is ~1, so comparing only the first to the second reports nothing. Checking the
   * step after the second finds it. This is the case that made the generalisation worth three comparisons.
   */
  it('reports the two slowest when they are large together', () => {
    const rows = [row('a', 'tests/one.spec.ts', 20_000), row('a', 'tests/two.spec.ts', 20_000), ...peers];
    const found = outlierIn(rows, 'fast')!;
    expect(found.above.map((r) => r.file)).toEqual(['tests/one.spec.ts', 'tests/two.spec.ts']);
    expect(found.ratio).toBeCloseTo(4.08, 1);
  });

  /**
   * **A file whose cost is all setup is an outlier too, which it was not for one commit.**
   *
   * Comparing `ms` alone, a spec with a thirty-second setup and no test time would be invisible — and `ms`
   * is about half of what a file costs. In the pack pool every file carries ~1.7s of setup.
   */
  it('reports a file whose cost is its setup rather than its tests', () => {
    const rows = [row('a', 'tests/heavy-setup.spec.ts', 100, 29_900), ...peers];
    const found = outlierIn(rows, 'fast')!;
    expect(found.above.map((r) => r.file)).toEqual(['tests/heavy-setup.spec.ts']);
    expect(found.ratio, '30.0s of cost over a 4.9s peer').toBeCloseTo(6.1, 0);
  });

  // The other direction, and the one that is true of this repo on every run
  it('says nothing about a half whose slowest files are in line with it', () => {
    const rows = [row('a', 'tests/one.spec.ts', 10_000), row('a', 'tests/two.spec.ts', 9400),
      row('a', 'tests/three.spec.ts', 9000), ...peers];
    expect(outlierIn(rows, 'fast')).toBeUndefined();
  });

  /**
   * And nothing about a file that is out of line but too small to act on.
   *
   * The pack pool's own reading: its slowest file is 4.2s at 1.90x its next, which clears the ratio and is
   * not work anyone should do. Without the size floor this would report on every run.
   */
  it('says nothing about a small file, however far out of line', () => {
    const rows = [row('a', 'tests/one.spec.ts', 4200), row('a', 'tests/two.spec.ts', 2200),
      row('a', 'tests/three.spec.ts', 900)];
    expect(outlierIn(rows, 'fast'), 'a 4.2s file at 1.9x is not a splitting job').toBeUndefined();
    // Drop the floor and it reports — at the *widest* qualifying step, which here is after the second
    // file (2.2s over 0.9s) rather than after the first (4.2s over 2.2s). That is the k-scan choosing.
    expect(outlierIn(rows, 'fast', { floorMs: 500 })!.ratio, 'and the floor is what muted it')
      .toBeCloseTo(2.44, 1);
  });

  it('asks only about its own half, and needs something below the step', () => {
    const mixed = [row('a', 'tests/one.integration.spec.ts', 40_000), ...peers];
    expect(outlierIn(mixed, 'integration'), 'one file is a half with no peer to stand above').toBeUndefined();
    expect(outlierIn([], 'fast')).toBeUndefined();
  });
});

/**
 * The window each record keeps, and the one thing it must not become.
 *
 * It holds `KEPT_RUNS` readings so a creep is visible on a line already being printed. What it is *not* is
 * the window this branch deleted: that one chose which half a spec belonged in, and because the choice was
 * impossible the readings needed hysteresis, a band, a tie rule, a machine field and two idle floors.
 * Nothing compares these against an edge, which is why there is no threshold here to get wrong.
 */
describe('the duration window', () => {
  it('keeps the newest run first and the older ones behind it', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 1200)], '2026-10-01T00:00:00.000Z');
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 2900)], '2026-10-02T00:00:00.000Z');
    const runs = readDurationRuns(root, 'apack-host', 'fast')!;
    expect(runs.map((run) => run.measuredAt)).toEqual(['2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
    expect(readDurations(root, 'apack-host', 'fast')!.ms['tests/a.spec.ts'], 'the newest is what prices a plan').toBe(2900);
  });

  // Bounded is the whole claim: the file count never moves, so `pruneDurationCache` still answers for
  // every name in the directory, and what a record holds cannot grow without limit either
  it(`keeps at most ${KEPT_RUNS} runs`, () => {
    const root = tmpdir();
    for (let n = 0; n < KEPT_RUNS + 4; n += 1) {
      writeDurations(root, [row('apack-host', 'tests/a.spec.ts', n)], `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z`);
    }
    const runs = readDurationRuns(root, 'apack-host', 'fast')!;
    expect(runs).toHaveLength(KEPT_RUNS);
    expect(runs[0]!.ms['tests/a.spec.ts'], 'the newest survives').toBe(KEPT_RUNS + 3);
  });

  /**
   * And a record from before `collectMs` keeps its `ms`, with no collection figures rather than none at all.
   *
   * The compatibility the window already had, extended to the second map: such a record holds real
   * measurements, and refusing it to insist on a field no reader of `ms` needs would throw evidence away.
   * A consumer of collection sees zero, which is what "no figure" means here — `cachedDurations` fills it
   * the same way.
   */
  it('reads a record from before overhead was recorded, with ms intact', () => {
    const root = tmpdir();
    fs.mkdirSync(durationCacheDir(root), { recursive: true });
    fs.writeFileSync(path.join(durationCacheDir(root), 'apack-host.fast.json'), JSON.stringify({
      runs: [{ measuredAt: '2026-10-01T00:00:00.000Z', ms: { 'tests/a.spec.ts': 500 } }],
    }));
    const record = readDurations(root, 'apack-host', 'fast')!;
    expect(record.ms['tests/a.spec.ts'], 'the measurement it does have').toBe(500);
    expect(record.overheadMs, 'the one it does not, as an absence rather than a refusal').toEqual({});
    expect(cachedDurations(root, UNIT_SUITES.filter((s) => s.dir === 'apack-host'), 'fast')[0]!.overheadMs)
      .toBe(0);
  });

  // Both maps are keyed alike and written together, so a reader cannot get one spec's tests with another's
  // collection
  it('round-trips overhead beside tests, under the same keys', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 1200, 900),
      row('apack-host', 'tests/b.spec.ts', 300, 2400)], '2026-10-02T00:00:00.000Z');
    const record = readDurations(root, 'apack-host', 'fast')!;
    expect(record.ms).toEqual({ 'tests/a.spec.ts': 1200, 'tests/b.spec.ts': 300 });
    expect(record.overheadMs).toEqual({ 'tests/a.spec.ts': 900, 'tests/b.spec.ts': 2400 });
  });

  it('has no window where no run has measured, and none for a half-written file', () => {
    const root = tmpdir();
    expect(readDurationRuns(root, 'apack-host', 'fast')).toBeUndefined();
    fs.mkdirSync(durationCacheDir(root), { recursive: true });
    fs.writeFileSync(path.join(durationCacheDir(root), 'apack-host.fast.json'), '{"runs": [{"measu');
    expect(readDurationRuns(root, 'apack-host', 'fast')).toBeUndefined();
  });
});

describe('trendOf', () => {
  const twoRuns = (first: number, second: number): string => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', first)], '2026-10-01T00:00:00.000Z');
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', second)], '2026-10-02T00:00:00.000Z');
    return root;
  };

  it('reports the oldest reading the window holds, and how many it rests on', () => {
    expect(trendOf(twoRuns(1200, 2900), 'apack-host', 'fast', 'tests/a.spec.ts')).toEqual({ was: 1200, runs: 2 });
  });

  // No verdict and no threshold: a drop is reported exactly as a rise is, because nothing acts on either
  it('reports a spec that got faster the same way', () => {
    expect(trendOf(twoRuns(2900, 1200), 'apack-host', 'fast', 'tests/a.spec.ts')).toEqual({ was: 2900, runs: 2 });
  });

  it('has nothing to say about a window of one, or a spec the window has not seen twice', () => {
    const root = tmpdir();
    writeDurations(root, [row('apack-host', 'tests/a.spec.ts', 1200)], '2026-10-01T00:00:00.000Z');
    expect(trendOf(root, 'apack-host', 'fast', 'tests/a.spec.ts'), 'one reading is not a trend').toBeUndefined();
    writeDurations(root, [row('apack-host', 'tests/b.spec.ts', 90)], '2026-10-02T00:00:00.000Z');
    expect(trendOf(root, 'apack-host', 'fast', 'tests/b.spec.ts'), 'seen in one run of two').toBeUndefined();
  });
});

describe('asDuration', () => {
  // The fast half's median is 16ms, which `(ms / 1000).toFixed(1)` renders as `0.0s` — so most of a
  // ranking of that half was printing the same three characters
  it('reads a fast spec in milliseconds and a slow one in seconds', () => {
    expect(asDuration(16)).toBe('16ms');
    expect(asDuration(999)).toBe('999ms');
    expect(asDuration(1000)).toBe('1.0s');
    expect(asDuration(17_745)).toBe('17.7s');
  });
});

/**
 * What a prune leaves, which is what says a file in the cache answers for nobody.
 *
 * The live set is the halves a suite *has*, read from the configs in the tree it is given — not every half
 * there is. A cross product admits `<dir>.integration.json` for the nine packages with one config, and a
 * name no run would write is one the prune then never removes, which is the growing cache its own comment
 * warns about. These cases build the tree too, since the configs are what the answer is derived from.
 */
describe('pruneDurationCache', () => {
  /** A root holding the configs a real checkout would, so the derivation has something to read */
  const rootWith = (halves: Readonly<Record<string, readonly Half[]>>, records: readonly string[]): string => {
    const root = tmpdir();
    for (const [dir, has] of Object.entries(halves)) {
      const at = path.join(root, 'packages', dir);
      fs.mkdirSync(at, { recursive: true });
      for (const half of has) fs.writeFileSync(path.join(at, CONFIG_BY_HALF[half]), '');
    }
    fs.mkdirSync(durationCacheDir(root), { recursive: true });
    for (const name of records) fs.writeFileSync(path.join(durationCacheDir(root), name), '{}\n');
    return root;
  };
  const left = (root: string): string[] => fs.readdirSync(durationCacheDir(root)).sort();

  const split = UNIT_SUITES.find((suite) => fs.existsSync(path.join(REPO_ROOT, 'packages', suite.dir, CONFIG_BY_HALF.integration)))!;
  const single = UNIT_SUITES.find((suite) => !fs.existsSync(path.join(REPO_ROOT, 'packages', suite.dir, CONFIG_BY_HALF.integration)))!;

  it('finds both kinds of suite in the real tree, or the cases below prove nothing', () => {
    expect(split, 'no unit suite has an integration config').toBeDefined();
    expect(single, 'every unit suite has an integration config').toBeDefined();
  });

  it('keeps both halves of a suite whose package has both configs', () => {
    const root = rootWith({ [split.dir]: ['fast', 'integration'] }, [`${split.dir}.fast.json`, `${split.dir}.integration.json`]);
    pruneDurationCache(root);
    expect(left(root)).toEqual([`${split.dir}.fast.json`, `${split.dir}.integration.json`].sort());
  });

  // The firing case the cross product did not have: a record for a half its package has no config for is
  // one no pool would ever write, and the old live set called it alive
  it('drops an integration record for a suite with no integration half', () => {
    const root = rootWith({ [single.dir]: ['fast'] }, [`${single.dir}.fast.json`, `${single.dir}.integration.json`]);
    pruneDurationCache(root);
    expect(left(root)).toEqual([`${single.dir}.fast.json`]);
  });

  it('drops a record for a package that is gone', () => {
    const root = rootWith({ [single.dir]: ['fast'] }, ['no-such-package.fast.json']);
    pruneDurationCache(root);
    expect(left(root)).toEqual([]);
  });

  it('leaves anything that is not a record alone, and a missing directory is not an error', () => {
    const root = rootWith({ [single.dir]: ['fast'] }, ['README.md']);
    pruneDurationCache(root);
    expect(left(root)).toEqual(['README.md']);
    expect(() => pruneDurationCache(tmpdir())).not.toThrow();
  });
});
