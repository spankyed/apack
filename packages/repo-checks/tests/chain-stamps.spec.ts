import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { CHAIN_STEPS } from '../../../scripts/lib/chain-steps.ts';
import { stampFor } from '../../../scripts/lib/chain-stamps.ts';
import { evidenceOrRefuse } from './_support/evidence.ts';
import { population } from '@apackdev/sdk/testing';

/**
 * The stamp store holds a record for each cached step and for nothing else.
 *
 * "Nothing else" is about the records, which is what every case here and `pruneStamps` itself read — both
 * filter the directory to `.json`. Two other things live beside them under names chosen so that filter
 * passes over: the chain's lock, and a directory per run of what its steps said (`chain-evidence.ts`,
 * whose spec holds that naming).
 *
 * Two ways the records can go wrong, and only one of them is cosmetic.
 *
 * **A stamp for an uncached step is a bug.** A step declaring `neverCachedBecause` must run every time,
 * and `runAndStamp` returns before `stampedRun` for one. If a stamp appears for such a step, that branch
 * has stopped holding and the chain is skipping work it promised always to do — the failure
 * `packages:ensure` is uncached *because of*: it reported `cached` while `packagesBuiltOrRefuse()`
 * refused, and five files of tests were skipped behind it.
 *
 * **A stamp for a step that no longer exists is a record with no subject.** This chain grew one —
 * `typecheck.json` outlived the step when it became eighteen. Harmless by itself, and exactly the shape
 * the rest of this work removes, so `pruneStamps` clears both on every run.
 *
 * Evidence-dependent, like the dep files: a checkout that has never run the chain has no store, and both
 * gates then have nothing to read. What that costs and what it does about it is `_support/evidence.ts`,
 * whose two answers the last describe here drives — a skip naming the remedy outside a chain run, and a
 * refusal inside one, where the run asking is the run that produces the evidence.
 */
const STAMP_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'apack-chain');
const stampName = (step: string): string => `${step.replace(/[:/]/g, '-')}.json`;

/**
 * A store's records, asked of a directory: the real one for the gates, a planted one for the cases that fire
 * them. One reader for both, so the mutations exercise the gate rather than a copy of it — and the filter
 * stays the single account of what counts as a record.
 */
const stampsIn = (dir: string): string[] => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
  : []);
const stamps = (): string[] => stampsIn(STAMP_DIR);

/** The steps that promise to run every time, which a stamp is how the chain breaks */
const uncachedSteps = (): string[] => CHAIN_STEPS
  .filter((step) => step.neverCachedBecause !== undefined)
  .map((step) => step.name);

/** The two kinds of record that should not be in a store, asked of its names */
const stampedUncached = (records: readonly string[]): string[] =>
  records.filter((file) => uncachedSteps().some((name) => stampName(name) === file));
const stampedUnknown = (records: readonly string[]): string[] => {
  const known = new Set(CHAIN_STEPS.map((step) => stampName(step.name)));
  return records.filter((file) => !known.has(file));
};

/**
 * The store, or the reason there is none — evaluated once, so a refusal names its cause once rather than
 * per case, and the cases below read a decision rather than each making it.
 */
const STORE = evidenceOrRefuse({
  what: 'stamp store at node_modules/.cache/apack-chain',
  from: 'npm run chain',
  present: stamps().length > 0,
});

describe('the chain stamps exactly the steps it caches', () => {
  /**
   * No two steps share a record, which the name alone does not promise.
   *
   * `stampFor` flattens `:` and `/` to `-` so the name is a legal filename everywhere, and **27 of the 29
   * step names are rewritten by it**. That transformation is not injective: `a:b`, `a/b` and `a-b` all come
   * out as `a-b`. Two steps landing on one file is not litter — a stamp is what the chain skips on, so the
   * two would mark each other fresh and the chain would report green for a step that never ran.
   *
   * The same invariant the pools hold ("give no two of their projects the same stamp") and the same defect
   * two halves of a suite had when they shared a key. This store was the only one of the three without it.
   *
   * Over the table rather than the store, so it answers on a checkout that has never run the chain.
   */
  it('give no two steps the same stamp, which the flattening does not promise', () => {
    expect(CHAIN_STEPS.length, 'the table emptied, so this passes over nothing').toBeGreaterThan(25);
    const names = CHAIN_STEPS.map((step) => path.basename(stampFor(step.name)));
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    expect([...new Set(duplicated)], 'two steps would write one stamp, so running either would mark the '
      + 'other fresh — rename one so their names differ by more than a separator').toEqual([]);
  });

  /**
   * And the collision is reachable, so the case above is a gate rather than an assertion.
   *
   * Over names rather than the table, because the table is green: these are the three spellings the
   * flattening cannot tell apart, and any two of them as step names would be the defect.
   */
  it('maps names differing only by a separator onto one file', () => {
    const collapsed = new Set(['a:b', 'a/b', 'a-b'].map((name) => path.basename(stampFor(name))));
    expect(collapsed.size, 'the flattening has become injective, so the case above now guards nothing '
      + 'reachable — say so there rather than leaving it reading as a gate').toBe(1);
  });

  it('reads a store with records in it, or says which run would have left them', (ctx) => {
    STORE.orSkip(ctx);
    population('chain stamps', stamps(), { atLeast: 10 });
  });

  it('holds no stamp for a step that declares it is never cached', (ctx) => {
    STORE.orSkip(ctx);
    population('uncached steps', uncachedSteps());
    expect(stampedUncached(stamps()), 'these steps promise to run every time and a stamp is how the chain '
      + 'skips one').toEqual([]);
  });

  it('holds no stamp for a step that is not in the table', (ctx) => {
    STORE.orSkip(ctx);
    expect(stampedUnknown(stamps()), 'a record whose subject has gone; pruneStamps clears these').toEqual([]);
  });
});

/**
 * And both gates fire, so neither is an assertion over a store that happens to be clean.
 *
 * The records are planted in a store of this case's own and read back through the same `stampsIn` the gates
 * use, which is what makes this the gate's own path rather than a restatement of its filter. Never in the
 * real store: a chain run beside this one caches on those records.
 */
describe('a store with the wrong records in it', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-stamps-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const plant = (...names: string[]): string[] => {
    for (const name of names) fs.writeFileSync(path.join(dir, name), '{}');
    // A name the filter must pass over, so a planted store is the real shape rather than records alone
    fs.writeFileSync(path.join(dir, 'chain.lock'), '{}');
    return stampsIn(dir);
  };

  it('reports a stamp for a step that promised to run every time', () => {
    const [uncached] = population('uncached steps', uncachedSteps());

    expect(stampedUncached(plant(stampName(uncached!)))).toEqual([stampName(uncached!)]);
  });

  it('reports a stamp whose step has gone from the table', () => {
    expect(stampedUnknown(plant('typecheck.json'))).toEqual(['typecheck.json']);
  });

  it('reports neither for the stamp of a step that is cached', () => {
    const cached = CHAIN_STEPS.find((step) => step.neverCachedBecause === undefined)!;
    const records = plant(stampName(cached.name));

    expect(stampedUncached(records)).toEqual([]);
    expect(stampedUnknown(records)).toEqual([]);
  });
});

/**
 * What the cases above do when the store is not there, which is the question `_support/evidence.ts` answers
 * and the one a fresh clone asks every time.
 *
 * Driven through an injected holder rather than the real lock, for the reason `chain-lock.spec.ts` gives:
 * this suite is itself a chain step, so a case taking `CHAIN_LOCK` would be refused by the run running it.
 * That `runningChain()` reads a held lock as held is that module's own question and its spec's.
 */
describe('a check with no evidence to read', () => {
  const absent = (holder: string | null) => evidenceOrRefuse({
    what: 'stamp store at node_modules/.cache/apack-chain', from: 'npm run chain', present: false, holder,
  });

  it('skips outside a chain run, naming what is missing and what produces it', () => {
    const notes: (string | undefined)[] = [];

    absent(null).orSkip({ skip: (note) => notes.push(note) });

    expect(notes.length, 'it passed the case over in silence, which is the red test it replaced wearing '
      + 'green').toBe(1);
    expect(notes[0], 'the remedy belongs in the note, not in whoever remembers it').toContain('npm run chain');
  });

  /**
   * The half that keeps the teeth. A chain run is the gate, and it is also the run that produces this
   * evidence — so no evidence there is a finding about the run, not about the contributor.
   */
  it('refuses inside one, since a skip there would be the chain passing over a check that read nothing', () => {
    expect(() => absent('npm run chain --all (pid 123)'))
      .toThrow(/Refused rather than skipped: npm run chain --all \(pid 123\) is running/);
  });

  it('skips nothing when the evidence is there', () => {
    const skipped: string[] = [];

    evidenceOrRefuse({ what: 'stamp store', from: 'npm run chain', present: true, holder: null })
      .orSkip({ skip: () => skipped.push('skipped') });

    expect(skipped, 'the evidence was there and the case was passed over anyway').toEqual([]);
  });
});
