// What `npm run typecheck` runs, as data.
//
// Separate from `scripts/typecheck.ts` for the same reason `chain-steps.ts` is separate from `chain.ts`: that
// module runs the checks when imported, so nothing may import it to ask a question. `chain-inputs.spec.ts`
// asks one — whether anything in the chain runs `schema:check` and `exports:check`, which are reachable only
// through here — and importing the runner for that answer cost 11s of collection time before this split.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { rootScripts } from './npm-scripts.ts';
import type { TimeoutClass } from './step-timeouts.ts';
import { PACKAGE_DIRS } from './workspace-deps.ts';

/**
 * How long any leg may run before its process group is killed — one compiler or one walk in one process,
 * which is what `quick` names (`step-timeouts.ts`).
 *
 * Declared once here rather than on each `Leg`, where eighteen entries would hold the same value and
 * `SIZE_MS`' doc has the argument against that. Read by the runner (`scripts/typecheck.ts`) and by the
 * chain, which runs these same legs as steps (`TYPECHECK_STEPS`, `chain-steps.ts`) — one declaration, so the
 * two cannot disagree, which they could when each named the class itself. A leg that ever wants longer is
 * what adds the field.
 */
export const LEG_TIMEOUT: TimeoutClass = 'quick';

export interface Leg {
  /** What `npm run` calls it, and what a failure is reported as */
  readonly name: string;
  /** Spelled out rather than derived — see the header */
  readonly command: string;
  /**
   * What this leg checks, **only where its script cannot say**.
   *
   * Absent is the common case and the right one: twelve of these legs name their workspace in the script
   * itself (`--workspace`, or `tsc -p packages/x`), so `scopeOf` reads it from there and a declaration
   * would be a second copy of a fact.
   *
   * Declare one when the script names nothing usable, and the entry is then a claim with something to say:
   * `'repo'` for a leg that walks the whole tree, or a list for one whose subject the command line does not
   * mention. `scopeOf` refuses a leg with neither, because an empty scope means empty inputs, and a step
   * with empty inputs depends on nothing, sorts first and never goes stale.
   */
  readonly scope?: readonly string[] | 'repo';
  /**
   * Files this leg's compiler reads that no workspace scope can name, because they belong to no workspace.
   *
   * Three legs have any, and only two kinds of file. `typecheck:api`'s three programs each resolve through
   * the root `package.json`, which `scope: ['api']` cannot express. `typecheck:main` and `typecheck:preload`
   * compile `types/`, the repo-root ambient declarations their tsconfigs `include`.
   *
   * **A file inside a workspace does not belong here.** Naming one means an edge no declaration describes;
   * declare the workspace dependency instead, so `workspaceDeps` finds it like any other.
   *
   * Declared rather than derived from the dep file, for the reason a dep file is never a key — it records
   * what was read *last* time, so a leg that starts reading one would not be invalidated by the thing it
   * started reading.
   *
   * It exists because the root manifest left `ROOT`: when every step declared it, this was covered by
   * accident. `dep-files.integration.spec.ts` is what found that gap and the `types/` one, and what keeps
   * this list honest.
   */
  readonly alsoReads?: readonly string[];
}

/** The testing workspace's harness contracts compile these application-owned helpers. */
export const PERFORMANCE_SCENARIO_INPUTS = [
  'tests/performance/scenario.ts', 'tests/performance/view-completion.ts', 'tests/performance/window.ts',
] as const;

/** The first ordering constraint: every other job reads what it builds */
export const ENSURE = 'packages:ensure';

/**
 * Every leg, in the order a failure is reported in — which is this order and not the order they finish, so a
 * run reads the same way twice.
 *
 * `packages:ensure` first because `check:specifiers` and `typecheck:pack` read the built packages.
 * Everything else is independent, and that is the claim this file makes by running them at once: nothing here
 * writes what another leg reads. The checks are all `--check`/`--noEmit` halves, which is what makes that
 * plausible, and `--cores 1` is how to test it if a leg ever starts behaving differently in company.
 */
export const TYPECHECK_LEGS: readonly Leg[] = [
  { name: ENSURE, command: 'npm run packages:ensure', scope: ['apack-ears', 'apack-sdk', 'apack-ui', 'apack-cli', 'apack-testing'] },
  { name: 'typecheck:renderer', command: 'npm run typecheck:renderer', alsoReads: ['build/build-metadata.ts', 'package.json'] },
  { name: 'typecheck:api', command: 'npm run typecheck:api', alsoReads: ['package.json'] },
  { name: 'typecheck:ears', command: 'npm run typecheck:ears' },
  { name: 'typecheck:sdk', command: 'npm run typecheck:sdk' },
  { name: 'typecheck:host', command: 'npm run typecheck:host' },
  { name: 'typecheck:ui', command: 'npm run typecheck:ui' },
  { name: 'check:specifiers', command: 'npm run check:specifiers', scope: 'repo' },
  { name: 'exports:check', command: 'npm run exports:check' },
  { name: 'schema:check', command: 'npm run schema:check' },
  { name: 'typecheck:scripts', command: 'npm run typecheck:scripts', scope: 'repo' },
  { name: 'typecheck:cli', command: 'npm run typecheck:cli', alsoReads: PERFORMANCE_SCENARIO_INPUTS },
  { name: 'typecheck:pack', command: 'npm run typecheck:pack' },
  // Both compile `../../types/**/*.d.ts` through their own tsconfig `include`
  { name: 'typecheck:main', command: 'npm run typecheck:main', alsoReads: ['types'] },
  { name: 'typecheck:preload', command: 'npm run typecheck:preload', alsoReads: ['types'] },
  { name: 'check:tiers', command: 'npm run check:tiers', scope: 'repo' },
  { name: 'lint:check', command: 'npm run lint:check', scope: 'repo' },
];

/**
 * What a leg's own script names, and what of it this could not resolve — both, because the second is the
 * reason the first can be trusted as a cache key.
 *
 * **A parse that drops what it does not understand is the failure a declaration was guarding against.**
 * This read every `--workspace` and kept the ones that mapped to a package directory, which is a silent
 * narrowing: a scope short one workspace is a step that does not re-run when that workspace changes, and
 * nothing says so. Unresolved mentions are carried out of here instead, and `scopeOf` refuses rather than
 * answering with the remainder — the one property that makes deriving this no weaker than declaring it.
 *
 * Memoised for this process: the scripts are a file the chain reads once, and a leg's answer cannot change
 * inside one run. Nothing resets it, because nothing rewrites `package.json` mid-run — and a reset hatch is
 * a thing to forget (root `CLAUDE.md`, on caches).
 */
export interface ScriptScope { readonly dirs: readonly string[]; readonly unresolved: readonly string[] }
let scriptScopes: Map<string, ScriptScope> | undefined;
export function namedByScript(leg: string): ScriptScope {
  if (scriptScopes === undefined) {
    const all = rootScripts();
    const nameToDir = new Map(PACKAGE_DIRS.map((dir) => [
      (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf-8')) as { name: string }).name,
      dir,
    ]));
    scriptScopes = new Map(Object.entries(all).map(([name, command]) => {
      const mentions = [
        ...[...command.matchAll(/--workspace[= ]([^\s]+)|(?:^|\s)-w[= ]([^\s]+)/g)]
          .map((hit) => ({ as: 'workspace' as const, named: hit[1] ?? hit[2]! })),
        // `tsc -p packages/x` and `cd packages/x` name a directory where no `-w` does
        ...[...command.matchAll(/(?:tsc -p|cd) packages\/([^\s/]+)/g)]
          .map((hit) => ({ as: 'directory' as const, named: hit[1]! })),
      ];
      const resolve = ({ as, named }: { as: 'workspace' | 'directory'; named: string }): string | undefined =>
        (as === 'workspace' ? nameToDir.get(named) : (PACKAGE_DIRS.includes(named) ? named : undefined));
      return [name, {
        dirs: [...new Set(mentions.map(resolve).filter((dir): dir is string => dir !== undefined))].sort(),
        unresolved: mentions.filter((m) => resolve(m) === undefined).map((m) => m.named).sort(),
      }] as const;
    }));
  }
  return scriptScopes.get(leg) ?? { dirs: [], unresolved: [] };
}

/**
 * What a leg checks: what it declares, or what its script names.
 *
 * **The parse was already trusted before it was used for this.** `typecheck-legs.spec.ts` ran it to hold
 * each declared scope to the script, which made twelve of the eighteen declarations a second copy of a fact
 * the script already carried. A fact with two records is the thing this chain stopped keeping, so the
 * declaration went and the parse stayed.
 *
 * **It refuses rather than defaulting**, which is the whole safety argument. A leg whose script names no
 * workspace and declares no scope would otherwise get an empty one: empty inputs, so it depends on nothing,
 * sorts first, and never goes stale again. That is a silently-always-cached step, which is strictly worse
 * than a loud failure here — and the three legs with no dep file behind them (`typecheck:renderer`, `:main`,
 * `:preload`) are exactly the ones nothing else would catch it for.
 */
export function scopeOf(leg: Leg): readonly string[] | 'repo' {
  if (leg.scope !== undefined) return leg.scope;
  const { dirs, unresolved } = namedByScript(leg.name);
  // Refused, not answered with what was understood: a scope short one workspace is a step that stops
  // re-running when that workspace changes, and the narrowing leaves no trace
  if (unresolved.length > 0) {
    throw new Error(`${leg.name}: its script names ${unresolved.join(', ')}, which this cannot resolve to a workspace — declare a scope on the leg rather than deriving a shorter one`);
  }
  if (dirs.length === 0) {
    throw new Error(`${leg.name}: its script names no workspace, so declare a scope on the leg (or 'repo' if it walks the tree)`);
  }
  return dirs;
}
