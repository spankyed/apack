# Per-spec stamps for the expensive halves

Status: deferred, 2026-10-23. Scoped, not designed in detail and not started. Resume only on the evidence
named under "When to resume"; it shares its hardest part with [affected-only selection](affected-selection.md),
and whichever of the two is built first builds that part for both.

## Context

The integration and native halves run every stale project as one `vitest run --bail=1`, and `stampedRunAll`
(`packages/apack-host/src/build/packages-built.ts`) stamps the projects a run covered only if the whole run
passed. So a single failure leaves every project unstamped, and the next chain reruns the whole step.

**Stamping per project instead was scoped and rejected, on two findings:**

- **One project is almost all of the cost.** Measured 2026-10-23, a quiet `npm run test:integration` on a
  ten-core Mac: `@apackdev/cli` was 2,424s of the half's 2,506s of file time (96.7%), `@app/internal-repo-checks` 49s
  and `@app/internal-publish-checks` 33s. Failures land in the CLI, so keeping the others' stamps saves about 3% of a
  rerun.
- **A real failure does not rerun with the same inputs.** It is fixed by a code change, the change moves the
  suite's fingerprint, and every spec in the suite reruns whatever was stamped. A partial stamp pays only for a
  rerun of unchanged code — a flake — which the deadline policy (`DEADLINE_FACTOR`,
  `scripts/lib/unit-suites.ts`) already targets.

**What would make a remaining failure cheap is a stamp per spec, keyed by that spec's own inputs**, so a fix
reruns the specs that reach what it changed and keeps the rest. That is this plan.

## The shape

1. **A spec's inputs** are the union of:
   - its static import closure, which `scripts/lib/module-graph.ts` already walks;
   - what it reads of the **built** packages at run time — the CLI's `dist`, the SDK's — which no import graph
     shows, since most integration specs spawn `bin/apack.mjs` or a build. This is the follow-up
     [affected-only selection](affected-selection.md) names as out of its scope ("recorded per-spec reads of
     the built output"), on the `dep-files.ts` pattern of recording actual reads;
   - the suite-wide inputs every spec shares: its config, `setupFiles`/`globalSetup` closure, and the pool's
     own machinery (`SUITE_RUNNER`, `scripts/lib/chain-steps.ts`).
2. **A per-spec stamp** records the fingerprint of those inputs and the reads it was taken from, written only
   for a spec whose every test passed. `--bail=1` stays: a spec it cancelled or never started is not stamped,
   so it runs next time — which is the point of keeping integration fail-fast.
3. **The pool runs the stale specs only**, passing their paths to vitest (`--passWithNoTests`), and refuses a
   run in which a requested file did not report, since vitest's path filters are substrings — the same guard
   affected selection needs.
4. **The chain step stays one step.** Its own stamp still means "every spec of every project is stamped
   against current inputs"; the per-spec records live under the pool's cache, as its per-project ones do now.

**Why recorded reads are a sound key, and where they are not.** A spec's next run can only read a new file
because something it already read changed — and that change is in its recorded set, so the spec reruns and
records again. That is the dep-file argument build systems rest on. It fails for a read the code makes
conditionally on something outside the set (an environment variable, the clock, the machine), which is why the
suite-wide inputs stay in every spec's key and why the recording must cover the processes a spec spawns, not
only its worker.

## What to expect

- **Package source edits will still rerun most of the CLI suite.** Most of its specs spawn the CLI or run a
  pack build, and so read most of the built CLI and SDK; their recorded inputs will overlap nearly completely.
  The win concentrates on edits to a spec's own `tests/` tree, its fixtures, and packages it does not load.
  Measure that before building anything (below).
- **A stamp per spec multiplies the records**: 45 CLI integration files plus the native half, each with a read
  set of thousands of paths. Store digests per path once per run, not per spec.

## When to resume

Both, not either:

1. The chain's own evidence shows reruns after real failures still cost after the deadline policy has been in
   use: `npm run chain` evidence under `node_modules/.cache/apack-chain/runs/` with `test:integration` or
   `test:native` failing on a code defect, then rerun whole.
2. A measured payoff: over a sample of recent fix commits, how many integration specs' recorded reads would
   have excluded the change. Affected selection's `--dry --affected` is the instrument once it exists; until
   then, a one-off script over `module-graph.ts` and a recorded-reads run of the CLI suite.

If the payoff is a few specs per typical fix, close this rather than build it.

## Out of scope

- Per-project stamps: rejected above.
- The host and pack unit pools: they already run one vitest per project, and a project there is cheap.
- Changing `--bail=1`: integration stays fail-fast (root `CLAUDE.md`, "Keep validation bounded").
