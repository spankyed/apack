# No check that reports nothing

*Revision 2. Revision 1 is committed at `fc02483de` and was wrong in its premise; the review that found that is
below, because the reasoning is the part worth keeping.*

## What revision 1 got wrong

It proposed a new `@app/fixtures` workspace, a `filesIn` vocabulary, a ban on all 79 raw directory reads across 41
spec files, and a guard spec to hold the line. The evidence for all of it was four checks said to pass green over
a missing build output. **That was predicted, not measured, and it is false.**

| # | defect | the measurement |
|---|---|---|
| 1 | **The premise.** The four "silently green" checks are all already guarded. | `published-specifiers`, `published-ui-dist` and `dependency-runtime` each sit under a `describe.skipIf`; and `readdirSync` on a directory that does not exist throws `ENOENT` rather than returning `[]`, so a moved path fails loudly. The demonstrated hazard was zero files. |
| 2 | **The size was set by the guard, not by the risk.** | 79 call sites migrated to close a hazard measured at 0. The only *exact* population for a static rule is "every directory read", so the rule's detectability chose the scope. That is the tail wagging the dog. |
| 3 | **It guards the wrong half.** | The vacuity in these specs lives in the *filter* — `files.filter((f) => f.endsWith('.vue'))` — not in the walk. Proving `files` non-empty says nothing about whether the filter can still match. Only a firing case does. |
| 4 | **It would have caused a regression.** | `published-declarations.integration.spec.ts` already asserts `toBeGreaterThan(100)`. Migrating it onto a `>0` helper weakens a floor the repo had already invented — a fifth private copy of the principle that revision 1 missed and would have flattened. |
| 5 | **Two functions where one option is better.** | `filesIn` / `filesInAllowingNone` gives a frictionless escape hatch: the first failure a developer hits, they switch names. One `population(what, xs, { atLeast })` handles the floor, and an explicit `atLeast: 0` reads as a deliberate exemption at the call site. |
| 6 | **The chunk order buried the value.** | The guard, which forced the 79, landed last; the one finding with independent evidence landed second. |

Defect 1 is the one that matters: **a plan whose premise is a prediction is the same defect it was written to fix.**

## What the evidence does support

Re-measuring found the real vector, and it is not empty walks. **30 conditional skips across 22 spec files, and
14 of them skip on `!PACKAGES_BUILT`** — nine of those thirteen files being the whole of `@app/internal-publish-checks`.

`packagesBuiltOrRefuse` (`packages/apack-host/src/build/packages-built.ts:629`) throws on unbuilt packages **only
under `process.env.CI`**, and this repo's CI is off by design — `.github/workflows/ci.yml` has its triggers
commented out. So locally it returns `false` and thirteen spec files quietly report nothing. That is not a
hypothetical: CLAUDE.md already records the event, from the other direction, where it *was* caught —
*"the step reported `cached` while `packagesBuiltOrRefuse()` refused, so every step reading the built packages
failed at collection (five files, thirty-three tests skipped)."*

And the repo's own machinery has the hole in exactly that shape. `scripts/lib/spec-cost.ts` treats "skipped" as a
deliberate third state and exports `nowRunning` — *"a spec recorded as skipped that has since started running"* —
with **no inverse**. Skipped becoming running is noticed. Running becoming skipped is not.

## The plan

### 1. A check may not silently skip itself

`packagesBuiltOrRefuse` refuses whenever the packages are not built, not only under CI, naming the build command
as it already does. An explicit `APACK_ALLOW_UNBUILT=1` covers the deliberate case — running one spec without
paying for a build — so the escape is visible in the shell rather than implied by an unset variable.

**The fourteen `describe.skipIf(!PACKAGES_BUILT)` sites stay.** The opt-out still yields `false`, so they remain
correct and become reachable only when someone asked for them — which is better than deleting them and is a
correction to this plan's first draft. What changes is that the default path can no longer reach them silently.
`published-packages.ts:52`'s doc comment moves with the behaviour, since its first clause stops being true.

This costs nothing in any gated path — `npm run test:unit`, `npm run chain` and each package's `pretest` all run
`packages:ensure` first, so the packages are built every time it matters. It changes exactly one situation: a bare
run against an unbuilt tree now says so instead of passing.

**Prefer deleting the skip to detecting it.** A `nowSkipped` projection beside `nowRunning` was the other
candidate; it needs the run's per-file skip set at check time, which a spec inside that run cannot see, so it
lands in the runner instead. Making the state unreachable is smaller than building the machine that reports it.

### 2. One pack fixture

This finding stands on its own evidence and is unchanged from revision 1. `Given a pack that …` is written
privately across the repo under eight different names — `pack`, `makePack`, `writePack`, `packFixture`,
`packWithImports`, `packWithDefaults`, `packSource`, `packRepo`.

**Corrected after implementing** (the figure below was 35 spec files across six packages, in revision 2 and in
commit `38bc4cdec`): that count came from grepping those names, and it swept in things that build no pack — a
manifest object literal in `manifest-schema.spec.ts`, a compiled-content result in `edited-flows.spec.ts`, a temp
directory holding one `defaults.mjs`. **19 specs actually write a pack directory**, and the five variants
collapsed here were still the load-bearing ones. The weak shape has already cost twice:

- `apack-cli/tests/build/pack-rules.spec.ts` carries three shapes, one an `apack.json` written inline because
  neither of the other two could express a contract leaf.
- `internal-repo-checks/tests/import-specifiers.integration.spec.ts` records what it cost: *"there used to be two and the
  difference was invisible … `own-modules` and `contract-leaves` cannot fire there at all — measured. Half the
  sweep's fixtures were that shape, so for those rows those two rules' 'and no other rule claims it' said nothing:
  they were not able to claim."*

```ts
packFixture({ at?: string; files?: Record<string, string>; manifest?: PackManifestish }): string
```

Complete by default: a `package.json` with both subpath maps, an `apack.json` declaring one feature with **both**
halves' entries and contracts, and the files those paths name. `files` merges over the base, so a malformed-pack
case writes `files: { 'apack.json': '{}' }`; `at` defaults to a fresh `mkdtemp`.

The five variants collapse: `packWithImports` and the inline-manifest case in `pack-rules.spec.ts`, and
`packFixture` plus the contract-leaf describe's local `pack(files)` in `import-specifiers.integration.spec.ts`.
`pack()` stays only where a case is *about* a malformed or minimal pack. The other ~30 builders stay — they build
installers, releases, bundler inputs and E2E trees.

### 3. One population helper, where a floor already exists

```ts
population(what: string, xs: readonly T[], opts?: { atLeast?: number }): readonly T[]   // default atLeast: 1
```

Throws naming `what`, so it needs no test framework. It replaces the private copies that already exist:
`population()` in `packaged-app-files.spec.ts:87`, and three hand-written floors — `chain-inputs.spec.ts:614`
(`found.length > 5`), `fe-bundler-host-registry.integration.spec.ts:150` (`uiSources.length > 0`) and
`published-declarations.integration.spec.ts:49` (`toBeGreaterThan(100)`, whose floor is carried over, not
flattened).

Two sites that look like floors are **not** migrated: `spec-plan.spec.ts:198` (`ambiguous[0]!.specs.length > 4`)
and `fe-bundler-ui-theme.spec.ts:64` (`used.get('primary')!.size > 0`) assert about one item the scan found, not
that it found anything. Moving them would be churn, and would read as a population guard where none is meant.

**Home: `packages/apack-host/src/testing/`**, beside `packFixture`, exported as two entries in host's
hand-written map. No new workspace: every one of those files is in a package that already depends on
`@apackdev/host`. The one exception is `apack-sdk/tests/utils/import-is-the-verb.spec.ts`, which cannot import host
— `findUpwardImports` reads each layer's `tests/` and refuses a non-permitted `@apackdev/*` in the manifest at all —
so it keeps its own three-line guard with a comment saying why. **One file duplicating three lines is cheaper than
a workspace, its vitest project, its chain inputs and eleven devDependency lines**, which is what revision 1 spent
to reach eight files.

### 4. The firing tables

`import-specifiers` gets exhaustiveness free from `FIRES: Record<RuleId, …>`; the compiler refuses a missing key.
`pack-rules` splits across `FIRES_ON_A_FILE` and `FIRES_ELSEWHERE` and checks it at runtime. Merge them into one
`Record<PackRuleKey, { onFile?: …; elsewhere?: … }>`, delete the runtime completeness half, keep the staleness
half. No shared helper: one would be weaker than the type system.

## Not done, and what would change that

**No ban on raw directory reads, and no guard spec.** It was 41 files to close a hazard that measures at zero
today, and it guards the walk where the vacuity is in the filter. Revisit if a check is ever found green over a
population it did not read — that is the condition, and it has not happened. What would catch that class properly
is a firing case per check, which is a different and larger program than a population guard.

## Verification

Each is a mutation, per the repo's rule that breaking it on purpose proves more than a re-run.

| | |
|---|---|
| the skip is gone | clear `node_modules/.cache/apack-packages-build` and remove one `dist`, then run `npm test -w @app/internal-publish-checks`: it must fail naming the build command, where today nine files report green |
| the opt-out works | the same run with `APACK_ALLOW_UNBUILT=1` skips as before |
| nothing gated changed | `npm run chain` — `packages:ensure` precedes every step that reads a built package, so no step may newly refuse |
| the fixture bites | delete the manifest from `packFixture`'s default: the `contract-leaves` cases must fail. Today two of the three shapes cannot make that rule speak at all |
| ~~the floor is preserved~~ | **This row was unrunnable, and the floor it defends was the wrong shape. See "As shipped" below.** |
| `population` bites | call it on `[]`: throws naming the subject |
| the merged table bites | delete a key from the `Record`: a compile error, not a test failure |
| nothing else moved | `npm test -w @apackdev/cli`, `npm run test:integration -w @app/internal-repo-checks -w @app/internal-publish-checks`, expectations unedited |
| the gate | `npm run check:specifiers`, `npm run typecheck`, `npm run chain` |

## Risks

- **Part 1 changes a shared refusal that thirteen files sit behind.** It is the one part that can break a workflow
  rather than a test: anyone running a bare spec against an unbuilt tree now gets an error. That is the intent, and
  the env var is the release valve.
- **A more complete pack fixture can surface findings the old one could not.** That is the intent and also how it
  breaks: `offender()` in `pack-rules.spec.ts` asserts over every rule's findings. Run the suites; do not reason.
- **Mutation checks must not run in the working tree** — a broken line reached the index once already. Use a
  worktree or a copy.
- **Another agent is committing on this branch.** Explicit pathspecs per commit; re-run the mutations after a
  rebase rather than trusting the merge.

## Commit chunks

1. `packagesBuiltOrRefuse` refuses unless `APACK_ALLOW_UNBUILT`, and `published-packages.ts`' doc comment moves
   with it. The fourteen `skipIf` sites are untouched.
2. `population` in `@apackdev/host/src/testing/`, the three private floors and `packaged-app-files`' helper onto it,
   the sdk spec's local copy commented.
3. `packFixture` beside it, and the five variants in the two specs that collapse onto it.
4. `pack-rules`' two firing tables merge into one `Record`.

---

## Added for coordination (2026-09-28, another session)

Five concrete instances of this class landed and were removed in `1300e85a0`, in
`packages/internal-repo-checks/tests/chain-output.spec.ts` — 32 cases to 27. They are a **different vector** from the
conditional skips above: every one of them *ran*, and passed, and could not fail. They do not contradict the
condition in "Not done"; none was green over a population it had not read.

| what it asserted | why it could not fail |
|---|---|
| `staleLines` prints "its last run recorded no per-file digests" | the only caller asks about a step that just stamped, so the field is always there |
| `staleLines` prints "nothing under its inputs differs now" | the verdict and the diff come from one sweep, so a stale fingerprint implies a non-empty diff |
| `REASON_COLUMN - DRY_REASON_COLUMN === 8` | both became `STEP_NAME_WIDTH` plus a constant — arithmetic that cannot drift |
| `wrapAt` returns short input unchanged | the `if (length <= room) return text` line, restated |
| `oneLine` returns short input unchanged | the same line in the sibling function |

Two things this class shows that a static rule cannot reach, and both are measured rather than argued:

- **Vacuity is created by changes elsewhere.** The second row was reachable until `3b69501a2` made a sweep
  memoise its walk as well as its reads. That commit did not touch the case; it made the case's own docstring
  false ("the tree can move between the verdict and the diff"). So this is time-varying, and a rule that passes
  today says nothing about the same case next week.
- **And it is undone the same way.** The first row was unreachable from the post-run report, and `6db973378`
  gave `--dry` a second caller that reads stamps it did not write — where a stamp from before those fields
  existed is ordinary. The branch is live now and prints honestly. **Vacuity is a property of the set of
  callers, not of the code**, which is why no analysis of the assertion alone can decide it.

What did decide it, in every case: running the mutation. Break the thing on purpose, watch which case fails.
That is what found the five, and it is what proved the replacements bite.

One rule worth carrying, because deleting the whole branch was the wrong answer twice: **when the state is
impossible but the guard is load-bearing, delete the case and keep the guard**, with a comment naming the caller
it was written for. In `staleLines` both guards produce the step's own name row — without them a step vanishes
from a report about itself, which is worse than either impossible state.

And one datum for the "only a firing case" argument in defect 3 above: of the four defects found by review in
that work, **none was caught by a unit case**. Two cases have since been written that would have caught them,
and both do it the same way — by asserting against `CHAIN_STEPS`, the real table, rather than against a literal
chosen to make the assertion pass.

---

## As shipped (2026-09-28)

Four things diverged from this plan, recorded rather than edited away, as the document already does elsewhere.

**The "floor is preserved" verification row was unrunnable, and chasing it found a defect.** `atLeast: 1` over a
directory with one file passes, so there was no such mutation. Asking what the floor was really testing showed
that a floor over three packages' summed declarations cannot see one of them go missing: 233 between them, so
`ui` absent leaves 165 and `ears` absent leaves 205, both clearing 100, and the check compiles what remains and
reports green. Fixed in `ee54dd656` by guarding each named package instead of the sum, which removed the floor
and the constant with it — so §3's "whose floor is carried over, not flattened" describes something that no
longer exists. The principle is now in `population`'s doc comment (`4d7972c2e`): guard each contributor where
the list of them is written down; a population derived from a walk of the tree does not need it.

**§3 lists three floors moving onto `population`; two did.** `chain-inputs.spec.ts:614` stayed — it is a
dedicated case with its own message, which is the category §3 already lists as not migrated.

**§3 says the sdk spec "keeps its own three-line guard with a comment saying why"; no comment was added.**
`import-is-the-verb.spec.ts:60` turned out to be a dedicated case as well, not a copy of the helper, so there
was no duplication to explain.

**Chunk 1 was one site wider than written.** The same hand-written CI-gated throw in
`dependency-runtime.integration.spec.ts:12` moved to the same `APACK_ALLOW_UNBUILT` escape.

Two obligations the plan did not anticipate, both enforced by checks that already existed: a new `@apackdev/host`
export must be bridged or recorded in `UNBRIDGED_BY_DESIGN` (`sdk-bridge-drift`), and a new spec file needs
`npm run spec-cost:update -- --suite <dir>` — the no-argument form re-records every suite and rewrote 570 lines
across twelve files.
