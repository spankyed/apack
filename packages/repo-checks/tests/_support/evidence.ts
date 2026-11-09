/**
 * What a check does when the observation it compares against is not there.
 *
 * Two checks here compare a declaration against an **observation** rather than against another declaration —
 * the stamp store a chain run leaves (`chain-stamps`) and what a compiler and a pack build report they read
 * (`dep-files`) — which is what makes them the only ones that can catch a read nobody modelled. The price is
 * that their subject does not exist until the thing that produces it has run, so a fresh clone and any
 * `npm ci` have none of it.
 *
 * **"No evidence" and "the evidence is wrong" are two results and must not share a shape.** A bare failure
 * for the first is indistinguishable from the second: it reports a defect the contributor's change did not
 * cause, hands them a twenty-minute remedy, and what that trains is ignoring a red test — which costs the
 * signal the check exists for. `packagesBuiltOrRefuse` is the named exemplar and the split is its: **skip
 * when the evidence is absent, refuse when it is there and wrong.** All the teeth are in the second, and
 * nothing here touches it.
 *
 * **A skip that can happen inside the gate is worse than the red test**, so the skip is impossible there:
 * `runningChain()` is the chain's own lock, held for the whole of a run, so a check asking it from inside one
 * refuses instead. Absent evidence in a chain run is itself worth refusing on — the run that produces the
 * evidence is the run that is asking.
 *
 * `population` (`@apackdev/sdk/testing`) is the neighbour and the other half of the same question: this one
 * answers whether there is anything to read, that one whether what was read is enough to assert over.
 */
import { runningChain } from '../../../../scripts/lib/chain-lock.ts';

/** Enough of vitest's test context to skip a case with its reason, so this module needs none of vitest */
interface Skippable {
  skip: (note?: string) => void;
}

/** An observation a check needs, and what the check does when it is not there */
export interface Evidence {
  /** Whether it is there, for a `describe.skipIf` over the cases that read it */
  readonly present: boolean;
  /**
   * Skips this case, naming what is missing and what produces it; does nothing when the evidence is there.
   *
   * Per case rather than once per file, because a skip is only worth anything if it is reported: vitest
   * counts a skipped case and prints the note, where a vacuously passing gate over an empty set says nothing
   * at all. That vacuous pass is the failure this whole module is about, one level down.
   */
  readonly orSkip: (ctx: Skippable) => void;
}

/**
 * The evidence a check is about to read, or the refusal/skip for its absence.
 *
 * Called at module scope, as `packagesBuiltOrRefuse` is, so a refusal is a collection failure naming the one
 * cause rather than the same message once per case.
 */
export function evidenceOrRefuse(
  { what, from, present, holder = runningChain() }: {
    /** What is missing and where it would be: `'stamp store at node_modules/.cache/apack-chain'` */
    what: string;
    /** The command that produces it, so the remedy is in the message rather than in someone's memory */
    from: string;
    /** Whether this checkout has it */
    present: boolean;
    /**
     * Who holds the chain lock, defaulting to whoever really does. Injected by the cases that drive both
     * answers: taking the real lock in a spec would refuse the chain run that is running the spec, which is
     * the trap `chain-lock.spec.ts` names.
     */
    holder?: string | null;
  },
): Evidence {
  if (present) return { present, orSkip: () => {} };
  const missing = `no ${what}: \`${from}\` produces it. An empty one is not a passing run.`;
  if (holder !== null) {
    throw new Error(`${missing}\n\nRefused rather than skipped: ${holder} is running, so this run is the `
      + 'gate and a skip in it would pass the chain over a check that looked at nothing.');
  }
  return { present, orSkip: (ctx) => { ctx.skip(missing); } };
}
