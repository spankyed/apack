// How a chain run puts a step on a line. The chain's own file runs the chain on import, so the formatting lives
// in `scripts/lib/chain-output.ts` where a spec can reach it without starting a six-minute build.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstChange, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS, orderedSteps } from '../../../scripts/lib/chain-steps.ts';
import { withRecordedSeconds } from '../../../scripts/lib/step-durations.ts';
import { briefly, criticalPathLine, pathSavingsLine, declaredAt, dim, DRY_REASON_COLUMN, howLong, identicalRewrites, marker, movedWhileItRan, oneLine, REASON_COLUMN, staleLines, STEP_NAME_WIDTH, TIME_COLUMN, voidedLine, whenChanged, wrapAt, writerOf } from '../../../scripts/lib/chain-output.ts';

describe('wrapAt', () => {
  /**
   * The whole point: a continuation indented to the reason's own column reads as part of that row. Wrapped to
   * column 0 it reads as another step's line, which is what a 180-character reason did to every run that
   * printed one.
   */
  it('indents what it wraps to the column the reason starts at, and leaves what fits', () => {
    const wrapped = wrapAt(10, 'one two three four five six seven', 24);
    expect(wrapped.split('\n')).toEqual(['one two three four', '          five six seven']);
    expect(wrapAt(46, 'never cached', 120)).toBe('never cached');
  });

  /** A path or a flag cut in half is worse than a ragged edge, so a word longer than the room keeps its line */
  it('does not break a word that is wider than the room', () => {
    expect(wrapAt(10, `short ${'x'.repeat(40)}`, 30)).toBe(`short\n${' '.repeat(10)}${'x'.repeat(40)}`);
  });

  /** A narrow terminal still gets a column to wrap to, rather than one word per line */
  it('keeps a floor under the room it wraps to', () => {
    expect(wrapAt(100, 'one two three four five', 101).split('\n')[0]).toBe('one two three four');
  });
});

describe('oneLine', () => {
  /** The slowest tests are a list to scan, and wrapping them costs three lines each on a narrow terminal */
  it('cuts a name to the room it has, says it cut, and leaves one that fits', () => {
    expect(oneLine(10, 'a test with a very long name indeed', 30)).toBe('a test with a very…');
    expect(oneLine(46, 'a quick test', 120)).toBe('a quick test');
  });
});

describe('dim', () => {
  /** A log file and a CI capture are not terminals, and an escape code in one is noise nobody asked for */
  it('leaves text alone when the output is not a terminal', () => {
    expect(dim('cached')).toBe(process.stdout.isTTY ? '\u001B[2mcached\u001B[22m' : 'cached');
  });
});

describe('writerOf', () => {
  const steps = [{ name: 'build:default-setup', outputs: ['packages/demo-pack/generated'] }, { name: 'typecheck' }];

  it('names the step whose outputs hold the file', () => {
    expect(writerOf('packages/demo-pack/generated/library.content.json', steps)).toBe('build:default-setup');
  });

  /** Nobody's output is the interesting answer: an undeclared write is the one there is something to do about */
  it('answers nothing for a file no step declares', () => {
    expect(writerOf('tests/packs/probe.txt', steps)).toBeUndefined();
  });
});

/**
 * Which of `whenChanged`'s four readings voids a step's pass. Only one does, and the three that do not are
 * each a reason the chain must stay green: an ordinary cache miss, a change that cannot be placed, and a
 * stamp with no brackets to place it against. A chain that went red for any of them would go red for an edit
 * made deliberately while a long run finished, which is how a report gets ignored.
 *
 * The cases iterate every reading rather than naming the one that fires, so a fifth could not arrive
 * unwatched — `whenChanged`'s return type is the population.
 */
describe('movedWhileItRan', () => {
  const readings = ['while it ran', 'since it ran', 'though its mtime predates the run', ''] as const;

  it('voids a pass only for a change inside the run', () => {
    const voided = readings.filter((when) => movedWhileItRan([{ when }]));

    expect(voided, 'the other three are reasons not to fail, not weaker versions of the same one').toEqual(['while it ran']);
  });

  it('finds one among several, since a step reads more than one file', () => {
    expect(movedWhileItRan([{ when: 'since it ran' }, { when: '' }, { when: 'while it ran' }])).toBe(true);
    expect(movedWhileItRan([{ when: 'since it ran' }, { when: '' }])).toBe(false);
  });

  // A declared-set change has no files at all, so there is nothing to place and nothing to void
  it('says nothing is voided when no file moved', () => {
    expect(movedWhileItRan([])).toBe(false);
  });
});

/**
 * The line those steps get. **Printed whether or not `--strict` is on**, which is the whole of what the flag
 * gates: a reader who is told only "will not be cached next run" reads the step's `ok` as a pass, and it was
 * not one. The flag decides whether the chain stops a merge, not whether the reader is told.
 */
describe('voidedLine', () => {
  it('names the step and says its result does not describe this tree', () => {
    const line = voidedLine(['typecheck'], false);

    expect(line).toContain("typecheck's result does not describe this tree");
    expect(line, 'read, not written — the step is the victim here, not the culprit').toContain('it read files that changed while it ran');
  });

  it('offers the flag when it is off, and does not when it is on', () => {
    expect(voidedLine(['typecheck'], false)).toContain('--strict fails the run on this.');
    expect(voidedLine(['typecheck'], true), 'it already did').not.toContain('--strict');
  });

  // One defect can void many steps at once: api:check rebuilding @apackdev/testing mid-chain once left twenty
  it('counts them rather than listing twenty names in a sentence', () => {
    const line = voidedLine(['a', 'b', 'c'], true);

    expect(line).toContain("3 steps' results do not describe this tree");
    expect(line).toContain('they read files that changed while they ran');
  });
});

describe('whenChanged', () => {
  const ranFrom = Date.parse('2026-09-27T12:00:00.000Z');
  const ranUntil = Date.parse('2026-09-27T12:01:00.000Z');

  /** A write inside the run is the case with an ordering to fix; one after it is usually the reader's own edit */
  it('places a change inside the run, and after it', () => {
    expect(whenChanged(ranFrom + 1000, ranFrom, ranUntil)).toBe('while it ran');
    expect(whenChanged(ranUntil + 1000, ranFrom, ranUntil)).toBe('since it ran');
  });

  /**
   * The file differs from what the stamp recorded at `takenAt`, so an mtime older than that is not telling the
   * truth — something restored it. Saying "while it ran" there invents a window, which is the whole mistake this
   * report was rebuilt to stop making.
   */
  it('refuses to place a change whose mtime predates the run', () => {
    expect(whenChanged(ranFrom - 1000, ranFrom, ranUntil)).toBe('though its mtime predates the run');
  });

  /** A stamp from before the run window was recorded says nothing about when, and must not guess */
  it('says nothing when the stamp cannot place it', () => {
    expect(whenChanged(ranFrom, ranFrom, undefined)).toBe('');
    expect(whenChanged(ranFrom, undefined, ranUntil)).toBe('');
    expect(whenChanged(undefined, ranFrom, ranUntil)).toBe('');
  });
});

describe('identicalRewrites', () => {
  const [from, until] = [Date.parse('2026-09-27T12:00:00.000Z'), Date.parse('2026-09-27T12:01:00.000Z')];
  const at: Record<string, number> = {
    'src/rewritten.ts': from + 10_000,
    'src/touched-later.ts': until + 10_000,
    'src/untouched.ts': from - 90 * 24 * 60 * 60 * 1000,
    'src/changed.ts': from + 20_000,
  };
  const under = (differing: string[] = [], window: [number | undefined, number | undefined] = [from, until]) =>
    identicalRewrites({
      recorded: Object.keys(at), differing: new Set(differing), mtimeOf: (file) => at[file], from: window[0], until: window[1],
    });

  it('counts a file whose bytes match and which was written inside the run', () => {
    expect(under(['src/changed.ts'])).toEqual(['src/rewritten.ts']);
  });

  /**
   * Measured rather than reasoned: a rewriter left running past `typecheck`'s window produced exactly this, and
   * the report was right to say nothing — mtime records the last write, so this can only undercount.
   */
  it('leaves out one whose last write landed after the run finished', () => {
    expect(under(['src/changed.ts'])).not.toContain('src/touched-later.ts');
  });

  /** A file that differs is a cause, and a cause must never be demoted to a harmless footnote */
  it('leaves out every file that differs, whatever its mtime says', () => {
    expect(under(['src/changed.ts', 'src/rewritten.ts']), 'a file that differs was counted as harmless').toEqual([]);
  });

  it('counts nothing when the stamp cannot say when the run was', () => {
    expect(under([], [undefined, until])).toEqual([]);
    expect(under([], [from, undefined])).toEqual([]);
  });
});

/**
 * `--dry` has one line per step and a cold tree makes every step stale, so what moved has to fit the row it is
 * already on. It replaces a sentence that was identical for every stale step.
 */
describe('firstChange', () => {
  const nothing = { gained: [], lost: [], changed: [], added: [], removed: [] };

  it('leads with the verb, so a column of these lines reads down', () => {
    expect(firstChange({ ...nothing, changed: ['scripts/chain.ts'] })).toBe('changed scripts/chain.ts');
    expect(firstChange({ ...nothing, added: ['tests/packs/probe.txt'] })).toBe('added tests/packs/probe.txt');
    expect(firstChange({ ...nothing, removed: ['src/gone.ts'] })).toBe('removed src/gone.ts');
  });

  it('counts the rest across all three kinds, since the row has no room for them', () => {
    expect(firstChange({ ...nothing, changed: ['a.ts', 'b.ts'], added: ['c.ts'], removed: ['d.ts'] }))
      .toBe('changed a.ts (and 3 more)');
  });

  /** A unit that gained a watched path is stale before a byte moved, so naming a file would name a non-cause */
  it('names a declared path over any file', () => {
    expect(firstChange({ ...nothing, gained: ['tests/acceptance'], changed: ['a.ts'] })).toBe('gained tests/acceptance');
    expect(firstChange({ ...nothing, lost: ['tests/old'] })).toBe('lost tests/old');
  });

  /** Empty rather than a guess, so the caller falls back to the reason it already had */
  it('says nothing when there is nothing to name', () => {
    expect(firstChange(nothing)).toBe('');
  });
});

describe('staleLines', () => {
  const under = (found: Partial<Parameters<typeof staleLines>[0]>) => staleLines({
    name: 'typecheck', nameWidth: 'typecheck'.length, gained: [], lost: [], files: [], identical: [], undiffable: undefined, ...found,
  // Matching the control character is the job: the chain's own output is coloured, and this reads it plain.
  // eslint-disable-next-line no-control-regex
  }).map((line) => line.replace(/\u001B\[\d+m/g, '').trimEnd());

  // A step with nothing to name still has to print its own name, or it vanishes from a report about it. Which
  // sentence fills that row is the stamp reader's to say: `diffableStamp` owns the wording, and this used to
  // hold a second copy of one of its sentences — printed, at one call site, about a step that had never run.
  it('prints the reason a stamp could not be read, rather than wording one of its own', () => {
    expect(under({ undiffable: 'has not run yet' })).toEqual(['  typecheck  has not run yet']);
  });

  it('says the inputs agree when there is nothing to name and the stamp was readable', () => {
    expect(under({})).toEqual(['  typecheck  nothing under its inputs differs now']);
  });

  /**
   * The first finding shares the step's row, and the rest sit under it — two lines of screen for the usual case
   * of one step and one file. Each path is padded to the widest this step names, so the qualifiers form a column.
   */
  it('names each file with what happened to it, when, and whose output it is', () => {
    expect(under({ files: [
      { file: 'tests/packs/probe.txt', how: 'changed', when: 'while it ran' },
      { file: 'packages/demo-pack/dist/content.json', how: 'added', when: 'since it ran', writer: 'build:default-setup' },
    ] })).toEqual([
        '  typecheck  tests/packs/probe.txt                 changed while it ran',
      "             packages/demo-pack/dist/content.json  added since it ran, build:default-setup's declared output",
    ]);
  });

  /** The verdict is the header's, not the row's — except when it is not the one every step here shares */
  it('prints a reason only when it is not the ordinary one', () => {
    expect(under({ reason: 'not built (no packages/apack-sdk/dist)', files: [{ file: 'src/a.ts', how: 'changed', when: '' }] }))
      .toEqual(['  typecheck  not built (no packages/apack-sdk/dist)']);
  });

  /**
   * The line the whole change is for. An identical rewrite is not a cause, and reading one as a cause is what
   * sent a diagnosis after the compiled content an E2E test rewrites; it is still worth saying, because a tree written
   * during every run is worth knowing about — and worth naming, since a count is not something anyone can know.
   */
  it('names the file whose mtime moved while its bytes did not', () => {
    expect(under({
      files: [{ file: 'tests/packs/probe.txt', how: 'changed', when: 'while it ran' }],
      identical: ['packages/demo-pack/dist/library.content.json', 'packages/demo-pack/dist/notes.content.json'],
    })).toEqual([
      '  typecheck  tests/packs/probe.txt  changed while it ran',
      '             · packages/demo-pack/dist/library.content.json and 1 more — touched during the run, not changed',
    ]);
  });

  /**
   * A unit that gains a watched path is stale before a byte moves, so a file list for that cause is empty —
   * printing both would read as a contradiction, and printing only the files would read as a bug.
   */
  it('reports a declared-set change instead of files, because no file moved', () => {
    expect(under({ gained: ['tests/acceptance'], lost: ['tests/old'] }))
      .toEqual(['  typecheck  its declared inputs moved: +tests/acceptance, -tests/old']);
  });

  it('counts the rest past the cap rather than filling the screen', () => {
    const files = Array.from({ length: 8 }, (_, index) => ({ file: `src/f${index}.ts`, how: 'changed' as const, when: '' as const }));
    const lines = under({ files, cap: 3 });
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toBe('             and 5 more');
  });

});

describe('declaredAt', () => {
  it('finds the line a step is declared on', () => {
    const table = ["  // why it is never cached", "  { name: 'test', neverCachedBecause: '…',", '  },'].join('\n');
    expect(declaredAt(table, 'test')).toBe(2);
  });

  /** A rename degrades to no pointer rather than to a wrong one, which is why the caller takes `undefined` */
  it('answers nothing for a name the table does not hold', () => {
    expect(declaredAt("  { name: 'test' },", 'build:default-setup')).toBeUndefined();
  });

  /**
   * A generated name is matched by prefix, and a prefix match is not a lookup — so these two cases are the
   * ones that say the answer is the step's own declaration rather than the first line that could pass for it.
   * Written tables, because the real one holds a single template and so cannot exercise either: the hazard is
   * a second generator arriving, which is exactly when nobody will be looking here.
   */
  it('points at the most specific generator, not the first one that prefixes the name', () => {
    const table = ['  { name: `test:${kind}`,', '  { name: `test:unit:${kind}`,'].join('\n');
    expect(declaredAt(table, 'test:unit:host'), 'the wider prefix answered for a name the narrower one generates').toBe(2);
    expect(declaredAt(table, 'test:smoke'), 'and the wider one still answers for what only it generates').toBe(1);
  });

  it('answers nothing when two generators are equally specific', () => {
    const table = ['  { name: `test:${kind}`,', '  { name: `test:${other}`,'].join('\n');
    expect(declaredAt(table, 'test:unit:host'), 'a pointer at one of two equal candidates is a guess').toBeUndefined();
  });
});

describe('briefly', () => {
  /**
   * A never-cached step's sentence explains a design choice and is the same on every run — the longest text on
   * the screen and the least specific to the run in front of you. So the run points at where the reasoning is
   * kept, `--dry` prints it, and the argument stays in the comment above the step, its only copy.
   */
  it('points at the reasoning for a step that is never cached, rather than repeating it', () => {
    expect(briefly('never cached: it drives real Electron, and a flaky pass cached green hides a failure',
      'scripts/lib/chain-steps.ts:518')).toBe('never cached — scripts/lib/chain-steps.ts:518');
  });

  it('still says the verdict when there is nowhere to point', () => {
    expect(briefly('never cached: it drives real Electron')).toBe('never cached');
  });

  it('leaves a reason that is about this run', () => {
    const why = 'its inputs changed since the last successful run';
    expect(briefly(why)).toBe(why);
  });
});

/**
 * And it lands on the step in the table a run actually points at. A pointer that resolves to an unrelated line
 * sends a reader somewhere with confidence, which is worse than printing nothing — and the only thing that could
 * move it is the table's own formatting, which nothing else here would notice.
 */
it('points at the line each never-cached step is declared on', () => {
  const table = fs.readFileSync(path.join(REPO_ROOT, 'scripts/lib/chain-steps.ts'), 'utf-8');
  const lines = table.split('\n');
  const neverCached = CHAIN_STEPS.filter((step) => step.neverCachedBecause !== undefined);
  expect(neverCached.length, 'no step is never cached, so this would pass over nothing').toBeGreaterThan(0);
  for (const step of neverCached) {
    const at = declaredAt(table, step.name);
    expect(at, `${step.name} is declared somewhere this cannot find`).toBeDefined();
    expect(lines[at! - 1]).toContain(`name: '${step.name}'`);
  }
});

/**
 * And every row agrees with the lines under it, for the name that is hardest to fit.
 *
 * Asserted with the **longest** declared step name, because the previous version of this case composed the
 * column from `'x'` — a name shorter than the width, so `padEnd` always applied and the assertion held whatever
 * the real names were. It passed while all three row shapes were a column out for `test:external-pack:contract`,
 * which is the one step in the table wider than the column was.
 *
 * The end-of-run report is not here: it sizes its column to the names it is printing, and `staleLines`' own
 * cases assert the rows it composes.
 *
 * It also holds that both rows wrap to the columns declared for them rather than to a literal, which is the
 * half of the old `composes both rows` case that this one did not already cover. The other half of that case
 * asserted `REASON_COLUMN - DRY_REASON_COLUMN === 8`, and went with it: both are now `STEP_NAME_WIDTH` plus a
 * constant, so the difference is arithmetic that cannot drift.
 */
it('lines every row up with what sits under it, for the widest step name', () => {
  const chain = fs.readFileSync(path.join(REPO_ROOT, 'scripts/chain.ts'), 'utf-8');
  expect(chain, 'a row pads the name by something other than the shared width').not.toMatch(/padEnd\(\d/);
  expect(chain, "a run's rows wrap to something other than the declared column").toContain('wrapAt(REASON_COLUMN');
  expect(chain, "`--dry`'s rows wrap to something other than the declared column").toContain('wrapAt(DRY_REASON_COLUMN');

  const widest = [...CHAIN_STEPS].sort((a, b) => b.name.length - a.name.length)[0]!.name;
  const name = widest.padEnd(STEP_NAME_WIDTH);
  // Built the way chain.ts builds them, so a change to either shape fails here rather than on a terminal.
  // `marker` is the width, not a literal: both of its answers must be one width or every row below a
  // marked step shifts, which is the whole failure these columns exist to prevent.
  expect(marker(true).length, 'the marker is not one width').toBe(marker(false).length);
  const mark = marker(true);
  expect(`${'ok'.padStart(7)} ${mark} ${name} ${'26.1s'.padStart(6)}  `.length, "a run row's reason").toBe(REASON_COLUMN);
  expect(`${'run'.padStart(7)} ${mark} ${name} `.length, "a --dry row's reason").toBe(DRY_REASON_COLUMN);
  expect(`${'ok'.padStart(7)} ${mark} ${name} `.length, "a run row's time").toBe(TIME_COLUMN);
});

/** So a step name longer than the column fails by name, rather than knocking every line under it one to the left */
it('keeps the name column at least as wide as the widest step name', () => {
  const widest = [...CHAIN_STEPS].sort((a, b) => b.name.length - a.name.length)[0]!.name;
  expect(STEP_NAME_WIDTH, `${widest} does not fit; widen STEP_NAME_WIDTH to ${widest.length}`)
    .toBeGreaterThanOrEqual(widest.length);
});

describe('howLong', () => {
  /**
   * An ordinary failure otherwise says only its exit code, and a reader has to find out by hand that it was
   * not killed.
   */
  it('says what it cost against what it usually costs here, and on what budget', () => {
    expect(howLong(60, 47_000, 10)).toBe(' after 47.0s, against 60s usually on a 10-core budget');
  });

  it('names one core as a core rather than a budget of one', () => {
    expect(howLong(60, 47_000, 1)).toContain('usually on 1 core');
    expect(howLong(60, 47_000, 1)).not.toContain('budget');
  });

  it('points at a serial run only when the step was slow enough for contention to explain it', () => {
    // Past double its usual cost
    expect(howLong(60, 130_000, 10)).toContain('--cores 1');
    // A step that failed at its normal speed failed on its merits, and suggesting a re-run would be noise
    expect(howLong(60, 61_000, 10)).not.toContain('--cores 1');
  });

  it('says nothing for a step with no reading here, rather than reporting undefined', () => {
    expect(howLong(undefined, 47_000, 10)).toBe('');
  });
});

/**
 * The line that answers "which step is worth making faster".
 *
 * It exists because a step's own duration does not answer it: the chain admits steps in parallel, so one
 * off the critical path runs inside the shadow of the ones on it and halving it saves nothing. Learned on
 * 2026-10-06 against `test:unit:pack`, which is 89% setup overhead — the worst-looking number in the suite,
 * and off the path, so the work would have bought no wall clock.
 */
describe('criticalPathLine', () => {
  /** A → B → C at 10s each, with D hanging off A, so the path is unambiguous and D is not on it */
  const chain = [
    { name: 'a', seconds: 10, dependsOn: [] },
    { name: 'b', seconds: 10, dependsOn: ['a'] },
    { name: 'c', seconds: 10, dependsOn: ['b'] },
    { name: 'd', seconds: 99, dependsOn: ['a'] },
  ];

  it('names the longest chain and what it costs, in order', () => {
    expect(criticalPathLine(chain, 'recorded'))
      .toBe('critical path 109s from recent runs (a -> d)');
  });

  // Measured wears no label, because the figure is the run's own
  it('names the source only for a plan', () => {
    expect(criticalPathLine(chain, 'measured')).toBe('critical path 109s (a -> d)');
  });

  it('says how many steps it assumed a cost for', () => {
    expect(criticalPathLine(chain, 'recorded', 2))
      .toBe('critical path 109s from recent runs; 2 of 4 steps have no reading here and count as 10s (a -> d)');
  });

  /**
   * **A need outside the list contributes nothing**, which is what makes the plan's path meaningful.
   *
   * `--dry` passes only the steps that would run, so a cached dependency has to count as free — it costs
   * this run nothing. Without that the plan would report a path through work it is going to skip.
   */
  it('counts only the steps it was given, so a cached dependency is free', () => {
    const planned = chain.filter((step) => step.name === 'b' || step.name === 'c');
    expect(criticalPathLine(planned, 'measured'), "a's 10s is not this run's")
      .toBe('critical path 20s (b -> c)');
  });

  it('says nothing of a path of one, where the step is its own line already', () => {
    expect(criticalPathLine([chain[0]!], 'measured')).toBe('');
    expect(criticalPathLine([], 'measured')).toBe('');
  });

  /**
   * And over the real table it names a path, so the line a dry run prints is not an artefact of a fixture.
   *
   * Asserted as a shape rather than a value: with no readings every step counts the same, so what must hold
   * is that the chain has a path at all.
   */
  it('finds a path through the chain this repo actually has', () => {
    const { steps, unread } = withRecordedSeconds(orderedSteps(CHAIN_STEPS), new Map());
    const line = criticalPathLine(steps, 'recorded', unread.length);
    expect(line, 'the chain is a graph, so it has a longest route through it').toMatch(/^critical path \d+s from recent runs; .+ \(.+ -> .+\)$/);
  });
});

/**
 * What shortening a step could buy, which is not what it costs.
 *
 * A step's saving is capped by the second-longest route, so the interesting case — and the one these
 * fixtures are built to show — is a long step worth almost nothing. Three proposals in one day were sized
 * by reading a duration and every one was bounded by a path nobody had computed.
 */
describe('pathSavingsLine', () => {
  /** `a -> b` is the longest route at 100; `c` is an independent route at 85, which is what caps a saving */
  const dense = [
    { name: 'a', seconds: 10, dependsOn: [] },
    { name: 'b', seconds: 90, dependsOn: ['a'] },
    { name: 'c', seconds: 85, dependsOn: [] },
  ];

  it('names each step on the path and what freeing it would buy, largest first', () => {
    expect(pathSavingsLine(dense)).toBe('the most any one can buy: b 15s, a 10s');
  });

  /**
   * The point of the line: `b` is 90 of the 100 and buys 15.
   *
   * Asserted as the relation rather than the number, because that is the claim — a duration is not a
   * saving — where the figures are only this fixture's.
   */
  it('reports a saving far below the duration where another route is close behind', () => {
    const b = dense.find((step) => step.name === 'b')!;
    const buys = Number(/b (\d+)s/.exec(pathSavingsLine(dense))![1]);
    expect(buys).toBeLessThan(b.seconds / 2);
  });

  // And the contrast: with no competing route, a step buys its whole duration — which is why
  // `packages:ensure`, the smallest step on the real path, is the one whose time is fully recoverable
  it('reports the whole duration where nothing else competes', () => {
    const chain = dense.filter((step) => step.name !== 'c');
    expect(pathSavingsLine(chain)).toBe('the most any one can buy: b 90s, a 10s');
  });

  it('names no step that is off the path, since freeing one shortens nothing', () => {
    expect(pathSavingsLine(dense)).not.toContain('c ');
  });

  it('says nothing of a path of one, where the step is its own answer', () => {
    expect(pathSavingsLine([dense[0]!])).toBe('');
    expect(pathSavingsLine([])).toBe('');
  });
});
