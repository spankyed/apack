/**
 * Where the chain keeps a step's success record, and what a step's name becomes on the way there.
 *
 * The definition, not the command — `scripts/chain.ts` is the command over it, the same split as
 * `scripts/lib/unit-pool.ts` over `scripts/test-unit-pool.ts`. It is a module of its own for the same one
 * reason that one is: a spec has to be able to ask what the chain names a stamp, and `chain.ts` runs its
 * `main()` on import, so a spec cannot ask it there. The alternative is a spec that restates the
 * transformation below, which is a second copy of a cache key — the thing most worth not having two of.
 */
import * as path from 'node:path';
import { REPO_ROOT, type BuildUnit } from '@apackdev/host/build/packages-built';
import type { ChainStep } from './chain-steps.ts';
import { commandText, rootScripts } from './npm-scripts.ts';
import { poolForStep, measureCommandFor } from './unit-pool.ts';
import { box } from './core-budget.ts';
import { linkedOffPin, vendoredOffPin, type VendoredState } from './vendored-checkouts.ts';

/**
 * Beside the package builds' and the pools' stamps, in the same cache directory and the same format, so one
 * `fingerprintUnit` and one reader cover all three.
 *
 * It holds two other things, each named so that `pruneStamps` passes over it: the chain's lock
 * (`chain-lock.ts`) and a directory per run of what its steps said (`chain-evidence.ts`).
 */
export const STAMP_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'apack-chain');

/**
 * A step's stamp, named after the step with `:` and `/` flattened to `-`.
 *
 * **27 of the 29 step names are rewritten by this**, which is the thing worth knowing before going near the
 * cache by hand: `test:unit:pack` is kept in `test-unit-pack.json`, so an `rm` of the name the chain prints
 * removes nothing and says nothing. The flattening is for the filename's sake — `:` is illegal in one on
 * Windows and displays as `/` in the macOS Finder — and the names are kept rather than hashed so that the
 * directory can be read.
 *
 * **It is not injective, and `chain-stamps.spec.ts` is what makes that safe.** `a:b`, `a/b` and `a-b` all
 * come here as `a-b`, so two steps whose names differ only in a separator would share one record — and
 * sharing a record means running either one marks the other fresh, which is the chain skipping a step that
 * never ran. That is the same defect two halves of a suite had when they shared a key, and the same one the
 * pools' *"give no two of their projects the same stamp"* exists to prevent; this store was the only one of
 * the three without the check.
 */
export const stampFor = (step: string): string => path.join(STAMP_DIR, `${flatStepName(step)}.json`);

/**
 * The flattening itself, so that a step is spelled one way in everything this directory holds — its stamp
 * and, beside it, the evidence file `chain-evidence.ts` writes. Two copies of it would let the two names for
 * one step drift apart, which is the thing a reader of the directory would have to know about.
 */
export const flatStepName = (step: string): string => step.replace(/[:/]/g, '-');

/**
 * A chain step as a build unit: the same shape, so it goes through the same freshness check.
 *
 * Here rather than in `chain.ts` because the chain is not the only thing that wants to know whether a
 * step's output is current. `scripts/drive-preflight.ts` asks it of `build:runtime` and `build:default-setup` before
 * launching the app, and asking it any other way would be a second account of what those steps read.
 */
export function unitFor(step: ChainStep, budget?: number, vendored?: readonly VendoredState[]): BuildUnit {
  // Only for a step that declares the pins: those are what say it reads the vendored checkouts at all
  const offPin = !step.inputs.some((input) => /^vendor\/[^/]+\.rev$/.test(input)) ? ''
    : vendored === undefined ? linkedOffPin(REPO_ROOT) : vendoredOffPin(vendored);
  return {
    inputs: step.inputs.map((input) => path.join(REPO_ROOT, input)),
    outputs: (step.outputs ?? []).map((output) => path.join(REPO_ROOT, output)),
    excludes: (step.excludes ?? []).map((excluded) => path.join(REPO_ROOT, excluded)),
    ...(step.excludeSuffixes === undefined ? {} : { excludeSuffixes: step.excludeSuffixes }),
    // What `npm run <name>` resolves to, so a step's script is in its key without `package.json` being one
    command: commandText(step.name, rootScripts()) + (poolForStep(step.name) === undefined ? ''
      : `\n${measureCommandFor(step.name, budget ?? box())}`)
      // And what it ran against, where a vendored checkout is not what its pin names (`vendoredOffPin`)
      + (offPin === '' ? '' : `\n${offPin}`),
  };
}

