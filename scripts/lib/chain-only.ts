// `npm run chain -- --only <steps>` and `--shard k/N`: running part of the chain in one job, as data.
//
// Its own module for the reason `chain-flags.ts` is: `scripts/chain.ts` runs the chain when imported, so the
// decisions live here where a spec can ask them.

/** One shard of a pool's specs, as vitest's `--shard` takes it: 1-based, `index <= total` */
export interface Shard { readonly index: number; readonly total: number }

export function parseShard(value: string): Shard {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  const [index, total] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || index > total) throw new Error(`--shard takes k/N with 1 <= k <= N, not '${value}'`);
  return { index, total };
}

export const shardArg = (shard: Shard): string => `--shard=${shard.index}/${shard.total}`;

interface Selectable { readonly name: string; readonly dependsOn: readonly string[] }

/**
 * The named steps alone, with their edges to steps outside the selection removed.
 *
 * A producer left out is one whose outputs another job made, so it has to be current *here* before anything
 * that reads it runs: `whyNotCurrent` answers that for one producer (null when current), and any answer is a
 * refusal naming the step that needs it. Running against outputs that are missing or stale would pass over
 * nothing, which is the failure a split gate is most likely to hide.
 */
export function selectOnly<T extends Selectable>(steps: readonly T[], names: readonly string[],
  whyNotCurrent: (producer: string) => string | null): T[] {
  const wanted = new Set(names);
  const unknown = names.filter((name) => !steps.some((step) => step.name === name));
  if (unknown.length > 0) throw new Error(`--only names no chain step: ${unknown.join(', ')}`);
  const chosen = steps.filter((step) => wanted.has(step.name));
  const refusals: string[] = [];
  for (const step of chosen) {
    for (const producer of step.dependsOn.filter((need) => !wanted.has(need))) {
      const why = whyNotCurrent(producer);
      if (why !== null) refusals.push(`${step.name} reads ${producer}, which is not current here (${why})`);
    }
  }
  if (refusals.length > 0) {
    throw new Error(`--only refused: run the producers first, or download their outputs and stamps:\n  ${refusals.join('\n  ')}`);
  }
  return chosen.map((step) => ({ ...step, dependsOn: step.dependsOn.filter((need) => wanted.has(need)) }));
}

/**
 * Why `packages:ensure` is not current here, for `--only`'s producer check: the published packages it builds that
 * are stale, with each one's reason, or null when none is. The one never-cached producer, so it has no chain stamp
 * to read; its readers are told the packages are built (`APACK_PACKAGES_PREBUILT`), so a stale one left to them is
 * refused as though it went stale under a run that built it — true in a whole chain, where it ran first, and not
 * under `--only` that leaves it out, in a fresh checkout or after an edit. Asked here, it is refused before any step
 * starts, and says what would make it current.
 */
export function packagesNotCurrent(stale: readonly { workspace: string; reason: string }[]): string | null {
  if (stale.length === 0) return null;
  const which = stale.map(({ workspace, reason }) => `${workspace}: ${reason}`).join('; ');
  return `${which}; name packages:ensure in --only too, or run npm run packages:ensure first`;
}

/**
 * The jobs of the strict gate, which runs the chain as parallel CI jobs (`.github/workflows/strict-chain.yml`).
 *
 * Derived from the graph rather than listed, so a step added to the table lands in a job without an edit to
 * the workflow: `producers` is everything the two expensive pools transitively read, `integration` and
 * `native` are those pools, `app` is every step that reads the built app together with what it needs that
 * the producers do not make (the app build itself, and the halves that prepare for an app run), and `rest` is
 * the remainder, which reads the producers' outputs as well.
 */
export const STRICT_JOBS = ['producers', 'integration', 'native', 'app', 'rest'] as const;
export type StrictJob = (typeof STRICT_JOBS)[number];

export const POOL_JOBS: Readonly<Record<'integration' | 'native', string>> = {
  integration: 'test:integration',
  native: 'test:native',
};

/**
 * `typecheckLegs` joins the producers because `dep-files.integration.spec.ts` reads the build infos those legs
 * write, and no step declares them as outputs, so the graph alone cannot place them before the pool.
 * `readsApp` is `needsApp` (`chain-steps.ts`), passed in so this module stays a function of the graph.
 */
export function strictJobSteps(steps: readonly Selectable[], job: StrictJob, typecheckLegs: readonly string[],
  readsApp: (step: string) => boolean): string[] {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const closure = (roots: readonly string[], stop: ReadonlySet<string> = new Set()): Set<string> => {
    const found = new Set<string>();
    const visit = (name: string): void => {
      if (found.has(name) || stop.has(name)) return;
      found.add(name);
      for (const need of byName.get(name)?.dependsOn ?? []) visit(need);
    };
    for (const root of roots) visit(root);
    return found;
  };
  const legs = typecheckLegs.filter((name) => byName.has(name));
  const pools = new Set(Object.values(POOL_JOBS));
  // A pool's own name is a root rather than a member: the producers are what the pools read
  const producers = closure([...legs, ...[...pools].flatMap((pool) => byName.get(pool)?.dependsOn ?? [])]);
  const app = closure(steps.map((step) => step.name).filter(readsApp), producers);
  const members: Record<StrictJob, (name: string) => boolean> = {
    producers: (name) => producers.has(name),
    integration: (name) => name === POOL_JOBS.integration,
    native: (name) => name === POOL_JOBS.native,
    app: (name) => app.has(name),
    rest: (name) => !producers.has(name) && !pools.has(name) && !app.has(name),
  };
  return steps.map((step) => step.name).filter(members[job]);
}
