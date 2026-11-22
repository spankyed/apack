// What `npm run check:repro` compares, asserted without building anything — two full builds is not a unit
// test, so the script is split (`scripts/repro.ts` orchestrates, `scripts/lib/repro.ts` decides) precisely so
// the deciding half can be watched failing here.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';
import { BUILD_UNITS, REPO_ROOT, type BuildUnit } from '@apackdev/host/build/packages-built';
import { APP_OUTPUTS, CHAIN_STEPS, PACK_OUTPUTS } from '../../../scripts/lib/chain-steps.ts';
import { compare, KNOWN_IRREPRODUCIBLE, partition, reproPaths, snapshot } from '../../../scripts/lib/repro.ts';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};

/**
 * Steps that write something another step reads without it being a build's output, so this command does not
 * build them twice and compare them. Each is a test step whose product is a test input.
 *
 * By step rather than by path, because a step's output list moves and its job does not. An entry is dead text
 * the moment the step is renamed, which the case below refuses.
 */
const NOT_A_BUILD_STEP: Readonly<Record<string, string>> = {
  'test:external-pack:contract': 'builds the fixture packs it then drives, which are a test input rather than a shipped build',
  'test:external-pack:fork': 'caches a fork archive under node_modules/.cache for the step that reads it',
  'test:packaged-authoring:author': 'hands a work dir to its app half, deliberately outside the checkout',
};

/**
 * Every output one step writes and another reads that the population does not cover.
 *
 * Extracted so the firing cases can hand it a table that breaks: a case restating the comparison inline would
 * prove the fixture wrong rather than the rule reporting it.
 */
const uncovered = (
  steps: readonly { name: string; inputs?: readonly string[]; outputs?: readonly string[] }[],
  population: readonly string[],
): string[] => {
  const read = new Set(steps.flatMap((step) => step.inputs ?? []));
  return steps.filter((step) => NOT_A_BUILD_STEP[step.name] === undefined)
    .flatMap((step) => (step.outputs ?? [])
      .filter((out) => read.has(out))
      .filter((out) => !population.some((covered) => out === covered || out.startsWith(`${covered}/`)))
      .map((out) => `${step.name} writes ${out}, which another step reads and this compares nothing of`));
};

describe('what check:repro compares', () => {
  /**
   * Derived from the declarations that already say where a build writes, so a sixth package or a fourth app
   * tree is covered on the day it is added rather than the day someone remembers this file.
   */
  it('is every build unit output, the pack outputs and the app outputs', () => {
    const paths = reproPaths();
    expect(paths, 'the population is empty, so the check would compare nothing').not.toEqual([]);
    for (const pack of PACK_OUTPUTS) expect(paths).toContain(pack);
    for (const app of APP_OUTPUTS) expect(paths).toContain(app);
    // Every unit's declared outputs, repo-relative, and no path outside the repo
    for (const unit of Object.values(BUILD_UNITS)) {
      for (const out of unit.outputs) expect(paths).toContain(path.relative(REPO_ROOT, out).split(path.sep).join('/'));
    }
    expect(paths.filter((p) => p.startsWith('..'))).toEqual([]);
  });

  /**
   * The completeness question, asked of the chain rather than of this file: anything one step builds and
   * another caches on is something a second build has to agree about, or the step reading it goes stale once
   * per build and nothing says why.
   *
   * Three build steps satisfy it today. A fourth fails here rather than being quietly uncompared, which is
   * the whole reason this is derived instead of a list of the three.
   */
  it('covers every build output another step caches on', () => {
    const read = new Set(CHAIN_STEPS.flatMap((step) => step.inputs ?? []));
    const producers = CHAIN_STEPS.filter((step) => NOT_A_BUILD_STEP[step.name] === undefined)
      .map((step) => ({ name: step.name, consumed: (step.outputs ?? []).filter((out) => read.has(out)) }))
      .filter(({ consumed }) => consumed.length > 0);
    // Each producer guarded, never a floor under their sum: one of them ceasing to be found leaves the others
    // above any such floor, and then the rule below is asked about a shorter population than it claims
    for (const { name, consumed } of producers) population(`${name}'s outputs that another step reads`, consumed);
    expect(producers.map(({ name }) => name),
      'a build step arrived or stopped being found; the rule below is only as wide as this list')
      .toEqual(['packages:ensure', 'build:default-setup', 'build:runtime']);
    expect(uncovered(CHAIN_STEPS, reproPaths()),
      'a build output the chain caches on is compared by nothing, so a second build could change it unnoticed')
      .toEqual([]);
  });

  // The rule, watched failing: it agrees today, and an assertion over agreement cannot fail on its own
  it('would report a build output that nothing compares', () => {
    const steps = [{ name: 'build:runtime', outputs: ['packages/renderer/dist', 'packages/elsewhere/dist'] },
      { name: 'test:smoke', inputs: ['packages/elsewhere/dist'] }];
    expect(uncovered(steps, reproPaths()))
      .toEqual([expect.stringContaining('build:runtime writes packages/elsewhere/dist')]);
  });

  it('would report an exception naming a step the chain does not have', () => {
    const absent = Object.keys(NOT_A_BUILD_STEP).filter((name) =>
      !CHAIN_STEPS.some((step) => step.name === name));
    expect(absent, 'an exception for a step that no longer exists is dead text reading as coverage').toEqual([]);
  });

  /**
   * The emptiness guard, watched failing. A check whose population comes from someone else's declaration can
   * be emptied by a change to that declaration, and the failure mode is silence — it compares nothing and
   * passes. Handing in an empty map is the only way to see the branch taken.
   */
  it('refuses an empty population instead of passing over nothing', () => {
    expect(() => reproPaths({} as Record<string, BuildUnit>, [])).toThrow(/derived no output paths/);
  });
});

describe('the comparison', () => {
  const snap = (files: Record<string, string>, dir = 'out'): ReadonlyMap<string, string> => {
    fs.rmSync(path.join(root, dir), { recursive: true, force: true });
    for (const [file, content] of Object.entries(files)) write(`${dir}/${file}`, content);
    return snapshot([dir], root);
  };

  it('says nothing about two builds that agree', () => {
    const before = snap({ 'a.js': 'x', 'nested/b.js': 'y' });
    const after = snap({ 'a.js': 'x', 'nested/b.js': 'y' });
    expect(before.size, 'nothing was hashed, so agreeing means nothing').toBe(2);
    expect(compare(before, after)).toEqual([]);
  });

  // One case per kind: a rewritten file is the symptom this goal is about, and the other two are how a build
  // that stopped emitting something, or started, would show up instead of being read as "unchanged".
  it('names a file whose bytes moved, one that vanished and one that appeared', () => {
    const before = snap({ 'same.js': 'x', 'moved.js': 'one', 'gone.js': 'z' });
    const after = snap({ 'same.js': 'x', 'moved.js': 'two', 'new.js': 'w' });
    expect(compare(before, after)).toEqual([
      { path: 'out/gone.js', kind: 'disappeared' },
      { path: 'out/moved.js', kind: 'changed' },
      { path: 'out/new.js', kind: 'appeared' },
    ]);
  });

  /** A path that does not exist contributes nothing rather than throwing, so a build that never ran reads as empty */
  it('passes over an output tree that is not there', () => {
    expect(snapshot(['never-built'], root).size).toBe(0);
  });
});

/**
 * The recorded exceptions, and the reason the table is empty.
 *
 * It held three, all of them `tsc` ordering a union's members differently between builds. They were fixed at
 * the emitter rather than accepted (`sortLiteralUnions`, the CLI's `types-bundler.ts`), so the table emptied.
 *
 * With nothing in it, asserting things *about* entries would pass over nothing — so the validator runs
 * against fixture tables that do have entries, and the real table is asserted empty separately. That way
 * neither half is vacuous: the rules are watched failing, and re-adding a row without a measurement fails a
 * case that says so.
 */
describe('the recorded irreproducible outputs', () => {
  /** What an entry must satisfy: a path the check actually compares, and a reason worth reading */
  const problems = (table: Record<string, string>, paths: readonly string[]): string[] => [
    ...Object.keys(table).filter((file) => !paths.some((p) => file === p || file.startsWith(`${p}/`)))
      .map((file) => `${file}: outside the compared trees`),
    ...Object.entries(table).filter(([, why]) => why.trim().length < 20).map(([file]) => `${file}: no reason given`),
  ];

  it('is empty, because the three it held were fixed rather than accepted', () => {
    expect(KNOWN_IRREPRODUCIBLE,
      'an entry here claims an output cannot be made reproducible. The three that were here were `tsc` union '
      + 'ordering and were fixed at the emitter; a new one needs the measurement that says this one cannot be')
      .toEqual({});
  });

  // The validator, watched failing — the half the empty table above cannot exercise
  it('would reject an entry naming a path the check never compares', () => {
    expect(problems({ 'packages/nowhere/dist/ghost.json': 'a reason long enough to pass the other rule' }, reproPaths()))
      .toEqual(['packages/nowhere/dist/ghost.json: outside the compared trees']);
  });

  it('would reject an entry with no reason, since that is a silenced failure', () => {
    const inside = `${reproPaths()[0]!}/x.js`;
    expect(problems({ [inside]: 'too short' }, reproPaths())).toEqual([`${inside}: no reason given`]);
  });

  it('accepts an entry that names a compared path and says why', () => {
    const inside = `${reproPaths()[0]!}/x.js`;
    expect(problems({ [inside]: 'tsc orders this union differently between builds; five hashes in six' }, reproPaths())).toEqual([]);
  });

  /** The split itself: a recorded path is reported, anything else fails the run */
  it('are reported while an unrecorded difference fails', () => {
    const { failing, known } = partition([{ path: 'packages/apack-sdk/dist/index.js', kind: 'changed' }]);
    expect(known).toEqual([]);
    expect(failing.map((d) => d.path)).toEqual(['packages/apack-sdk/dist/index.js']);
  });
});

/**
 * The trap this check would otherwise walk into, and the reason `scripts/repro.ts` runs codegen itself.
 *
 * `apack pack build` calls `generateEntries([])` with no `--force`, and `generate-entries` returns early when
 * `.apack/generate-entries.json` matches. So a round that leaves codegen to `apack pack build` re-hashes `src/__generated__`
 * without having regenerated it, and reports it identical — half of `PACK_OUTPUTS` passing for having been
 * looked at rather than checked.
 *
 * Asserted against the script's text because the alternative is running two real builds. It is a weaker check
 * than executing it, and it is the one that is affordable; what it pins is that the flag is not quietly
 * dropped.
 */
describe('the codegen the second build would otherwise skip', () => {
  it('is forced by the script, not left to apack pack build', () => {
    const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts/repro.ts'), 'utf-8');
    const call = /'generate:entries'[^\n]*\n?[^\n]*/.exec(script)?.[0];
    expect(call, 'scripts/repro.ts no longer runs generate:entries at all').toBeDefined();
    expect(call, "generate:entries runs without --force, so the second build reuses src/__generated__ and the "
      + 'check compares codegen output it never regenerated').toContain('--force');
  });
});
