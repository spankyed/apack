/**
 * The subject a check asserted over, confirmed to be there: a population it could not read is a check that
 * proves nothing, and a green run cannot tell you which kind it was.
 *
 * **Where a population is assembled from a written-down list of contributors, guard each one here rather than
 * the total.** A total cannot see one contributor go missing: `published-declarations` named three packages,
 * summed their declarations and put a floor under the sum, and two of the three could fail to install without
 * moving the total past it — so the check compiled what was left and reported green.
 *
 * **A walk is not immunity, and this comment used to say it was.** It cannot name something absent, but it
 * can fail to follow an edge, and then it is a written-down list wearing a walk's clothes. Five instances in
 * one day, 2026-09-28: a lint derivation that expanded each `npm run` once and so never saw the `-ws` fan-out
 * (858 files unexamined, green); a tsconfig check that read one config per workspace where three compile
 * `packages/server`; seven places deriving "the workspaces" by listing `packages/` rather than reading the
 * `workspaces` field that decides them; a fixture claiming every step and holding eleven of thirteen; and an
 * audit that grepped `src/` and `docs/` but not `tests/`. None of them was empty, so nothing here would have
 * fired. The question is not "derived or listed" but **derived from what defines the population, or from
 * something that agrees with it today** — and the answer is checkable: name the declaration out loud.
 *
 * `atLeast` is for one subject with a known shape, whose collapse would not take it to zero: a fixture manifest
 * declaring one feature names four paths, and three of them would satisfy a bare emptiness test. It is not a
 * way to cover several contributors at once — a floor chosen to span them is the shape above, and it hides
 * exactly what it is meant to catch. Where the count is a domain fact rather than a floor under the scan,
 * assert it directly instead; this is for "did I read anything real", not for what was read.
 */
export function population<T>(what: string, xs: readonly T[], opts: { atLeast?: number } = {}): readonly T[] {
  const atLeast = opts.atLeast ?? 1;
  if (xs.length < atLeast) {
    throw new Error(`${what}: found ${xs.length}, expected at least ${atLeast} — anything asserted over it would pass for the wrong reason`);
  }
  return xs;
}
