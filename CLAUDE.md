# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Where a new lesson goes, because this file is loaded into every session:** the rule lives here in its imperative form with one citation; its evidence lives in `docs/`.
A paragraph of measurement, a list of what was tried first, or the history of something that no longer
exists is the sign it belongs there — [`archive/references/pipeline-lessons.md`](docs/archive/references/pipeline-lessons.md)
for what a rule cost to learn, [`archive/references/pipeline-commands.md`](docs/archive/references/pipeline-commands.md) for
what a flag was measured against, [`archive/references/recorded-files.md`](docs/archive/references/recorded-files.md)
for the two recorded files that were built and deleted, and `docs/archive/goals/` for a goal that
closed. This is the repo's own comment rule — *"a comment is for whoever opens the file cold, not for
whoever reads the diff"* — applied to the guide that states it, which is the easiest place to exempt.

There is deliberately **no line-count gate**: that would be a figure with no decision behind it, which the
rule below on figures rejects. The guard is this paragraph, where the next person adding a lesson reads it.

## Overview

apack is an Electron desktop app with an actor-based architecture. Both frontend and backend are built on XState state machines that communicate through typed events.

- **Backend** (`packages/api/`) — Node.js server (`node:http` + `ws`) using tRPC: transport, process boot and the composition of the app runtime (`@apackdev/host`: XState actor systems, packs, services) over elmdb databases (`@apackdev/ears/lmdb`)
- **Frontend** (`packages/renderer/`) — Vue 3 + Tailwind CSS surface system, each surface is an XState actor with designated UI areas (canvas, panel)
- **Electron main** (`packages/main/`) — Module-based process manager that spawns the API server and manages windows
- **Preload** (`packages/preload/`) — IPC bridge exposing safe APIs to renderer
- **Default Setup** (`packages/default-setup/`) — the pack the app ships, installed into the data dir at first boot and loaded from there like any other: features, steps, and content sources (actions, prompts, flows, notes, commands) that `apack pack build` compiles into `packages/default-setup/dist/` from `apack.json` `content.sources` (see `packages/default-setup/CLAUDE.md` and `docs/public-facing/content.md`)
- **Repo checks** (`packages/repo-checks/`) — the specs whose subject is the repo's own tooling: the chain's graph and cache keys, the recorded spec costs, and the scripts under `scripts/`. A workspace because a spec needs one, and because `npm run spec` routes a `scripts/` change here (see `packages/repo-checks/CLAUDE.md`)

Monorepo using npm workspaces. Requires Node >= 23.5.0.

## Parallel editing sessions

Use the current checkout by default. Create a separate branch and worktree when requested or when
isolation is clearly needed, such as concurrent editing sessions or work that must stay separate from
the active branch. For an isolated session, start with `npm run session:new -- <name>` (or an explicit
`git worktree add` outside the main checkout) and continue all edits, staging and validation there.
Never share `node_modules`, generated output or the staging index between worktrees.
Repository dev, drive and database scripts default to a separate profile in linked worktrees;
explicit profile/storage overrides are intentional sharing, so use them only when requested.

Before combining concurrent branches, run `npm run session:check -- <branch> [branch...]` from
the clean target checkout. It pins the committed inputs, merges in a detached worktree and runs the
full strict chain. Merge only those tested commits; rerun if any input advances.
See [worktree development](docs/references/worktree-development.md).

## Naming

- Name operations by their API family. Keep conventional `get` / `set` / `delete` for keyed stores and property accessors; `get` may return absence. Use `find` for searches and domain queries, and an explicit name such as `getOrThrow` when absence throws. Return types and documentation state the absence contract.
- `read` reads disk, `fetch` crosses the network, `load` loads executable code, and `resolve` computes an answer. Collections may be empty.
- Qualify exported type names by their owner; never export bare `Context`, including aliases.
- Keep meaningful machine, execution, compiler and RPC contexts. Use `Args` for operation inputs, `Scope` for ambient dependencies and `Environment` for resolved environment/path information.
- Name the object or its role (`Summary`, `Metadata`, `Snapshot`, `Definition`, lifecycle stage). A suffix alone is not a defect; preserve useful domain/library vocabulary.
- Name ambiguous inputs by what they hold: dispatch kind, input path and provenance are different contracts. Keep graph `source`/`target` and native/library APIs.
- Review naming in context: the owner, operation and neighboring API family determine whether a name is clear. See [the naming goal](docs/archive/goals/goal-naming-conventions.md).

**A feature's frontend half is a surface; its backend half is a system.** Reserve **plugin** for the three
vocabularies where it really is one: a **ProseMirror `Plugin`** this app constructs inside a tiptap
extension, a bundler plugin (Vite, rollup, PostCSS, esbuild) and a plugin of a third-party CLI this app
drives (`claude plugin`). **A pack's editor contribution is not one of them**: it is
`extensions.textEditor`, and one file per extension under a `tiptap/extensions/` directory holds its
Plugin private — see [the editor-extension convention](docs/archive/goals/goal-editor-extensions.md).
`packages/repo-checks/tests/surface-vocabulary.spec.ts` holds that list and is the rule.

**Never find-and-replace over `plugin`.** One of those three cannot be caught by a compiler: the CLI's
names reach a subprocess argv, where a rename typechecks and then calls a subcommand that does not exist.
A window-storage key was a fourth such vocabulary until keys stopped being hand-written — a surface's are
derived from its ref (`surfaceStorage`, `@apackdev/sdk/fe`), and the `window-storage` pack rule refuses
a pack reaching `localStorage` itself.

Reserve **artifact** for app artifact contributions and viewers. Use **build** for compiled pack/app output,
**release file** for downloads, and **recorded file** or **report** for checked-in generated files. Preserve
third-party API names such as electron-builder’s `artifactName` and GitHub’s `upload-artifact`.

## Release metadata

Do not edit release/version metadata unless the user explicitly asks for a release or version bump. This includes `package.json` version fields, `package-lock.json` root package versions, app version constants, release notes, changelogs, and generated release files. The release process owns those changes.

## Backward compatibility

**There is none to keep, and assuming otherwise is the more expensive mistake.** Change a signature, a manifest key,
a published export or a stored field's name outright, and migrate every in-repo caller, test, fixture, template and
doc in the same change. No dual-read of an old key and a new one, no alias, no deprecation window, no shim.

That is not a stylistic preference, it rests on a fact: **no pack exists outside this repo.** Third-party
distribution is not built — `resolveFromRemoteRegistry` (`packages/apack-cli/src/commands/install.ts:17`) throws
for every name it is given — so every pack that exists is in this tree, where a rename is a change the typecheck
proves you finished. Weighing a design against packs that might be installed weighs it against nothing, and that
caution has a real cost: it is how a repo with no users takes on the constraints of one.

**Stored developer data is not a compatibility requirement.** Normal boot, writes and imports use the
current contract. Do not add fallback reads, invalid-value grandfathering, old-format conversion or new
entities to preserve obsolete fields. The lead developer's backed-up data is a separate operational task:
if conversion is necessary, perform it explicitly on a copy, outside normal runtime behavior. Preserve
current-format overrides when a pack is disabled or uninstalled; that is supported lifecycle behavior.
Versioned migrations for future deliberate data changes are separate from supporting obsolete formats.

**Storage formats are 1 until a release has users.** A change to how data is stored edits format 1 in place: no bump,
no upgrade step, and nothing for derived data, which `rebuild()` builds. Our own databases are reset, or converted once
by hand on a copy. The tag of the first release that ships to people other than us locks format 1, and only from then
does each layout change bump the format with its upgrade step. Why, and what it changed:
[storage-format-one.md](docs/archive/plans/storage-format-one.md).

**Revisit this when a third-party pack can actually be installed from a registry.** That is the condition. Until it
holds, "an installed pack might depend on this" has no subject, and a plan that treats it as a constraint should say
so out loud so the claim can be checked.

## What to run after a change

**Run `npm run chain`; it costs what you changed.** Each step declares what it reads
(`scripts/lib/chain-steps.ts`), is fingerprinted over exactly that, and is skipped when nothing under it
moved, so working out which suite covers an edit is the graph's job. A step that only consumes a
deterministic build stays cached through a rebuild from unchanged input; `npm run check:repro` keeps the
builds reproducible. `npm run chain -- --dry` prints the plan and why each step is or is not cached. What
each case costs, measured: [pipeline-lessons.md](docs/archive/references/pipeline-lessons.md#what-a-change-costs-the-chain).

**`npm run chain -- --no-native` is the everyday local gate when your change does not touch the compiler.**
It leaves out `test:native` — compiler runtimes, native fixtures and live watchers, the longest step — and says
so on the result line. On a Mac it is also the run that needs no Docker, since native is the one step that
uses the container. Run the full chain when you change `packages/apack-cli/src/build/`, the captured
runtime or watcher code, or anything native; the strict gate always runs it.

**Use `npm run spec` while working and the chain when done.** With no arguments it runs the specs your
uncommitted changes affect; with a source file, the specs that import it. A change to `scripts/` or a vitest
config routes to `@app/repo-checks`. It names the specs the module graph cannot reach — a pack suite, which
resolves the published `dist`, an integration half behind a second config, and a pack's content sources and
build inputs, which reach their specs only through `apack pack build` — and `npm run spec:full` runs them.
The routes are data (`scripts/lib/spec-plan.ts`).

Three things the chain cannot work out for you, because they rewrite files you commit. **Read the
regenerated diff before committing it**: every line should be the edit you just made.

- **A public export of `@apackdev/ears`, `/sdk` or `/ui`** — `npm run api:update`, and commit `etc/`.
- **default-setup's facade** — `npm run facade:update -w @app/default-setup`, and commit
  `etc/pack-types.api.md`. The chain's `facade:check` replays the verified build (`--from-build`); the
  pack-local command derives from source.
- **A pack's content source (`src/content/`)** — when only `contentHash`/`rowSha256` moved, re-record with
  `npm run content-parity:update -w @app/default-setup`; never edit a hash by hand.
  `packages/default-setup/tests/content/CLAUDE.md` has the rule for what a golden records.

`npm run typecheck` fails on a stale API report, facade report, exports map or schema
(`RECORDED_FILE_CHECKS`, `scripts/lib/typecheck-jobs.ts`).

**A recorded file is a derivation: it re-takes its answer on every run and compares.** Re-taking means
running whatever produces it, not comparing against a file an earlier command left. Add no **proxy** (a hash
of what the inputs are believed to be, whose remedy writes) and no **sample** (a recorded measurement); price
the derivation first — `api:check` and `packages:check` are cheap enough to be chain steps. Why, and what
each cost: [recorded-files.md](docs/archive/references/recorded-files.md#the-recorded-file-checks).

What a chain step costs is a reading: a machine-local window of recent passing runs
(`scripts/lib/step-durations.ts`), never a committed figure.

The chain is the normal repository gate. **Automatic CI is disabled, on purpose:**
`.github/workflows/ci.yml` has its `push` and `pull_request` triggers commented out while this is a
single-contributor repo. Do not report their absence as a failure or enable them. Manual platform and
strict-chain dispatches remain available and are used where the execution boundary below or an active
goal requires them; cite actual results, not an assumption that all CI runs or never runs.

**CI may fail a check, never a clock.** Every kill deadline is a declared class rather than a multiple of a
measurement (`scripts/lib/step-timeouts.ts`), and what a step costs is a reading of the machine it ran on.
**Do not gate any of this on `process.env.CI`**: a CI-gated refusal never fires. The condition is the
machine, which is a fact a run can check.

### Keep validation bounded

Use the approved [Windows development VM](docs/references/guides/windows-development-vm.md) for
interactive Windows compiler/native debugging and focused validation instead of dispatching CI for
each experiment. Coordinate one expensive execution owner, use two cores and deallocate when idle.
**Native execution runs in the Linux test container, not on the developer's daily-use Mac**: native fixtures,
repeated captured-runtime execution and startup/cancellation batches execute fresh native files and runtime
copies that macOS security-assesses one by one. `npm run chain` runs `test:native` there (`linuxOnMac`,
`scripts/lib/chain-steps.ts`), and `npm run test:linux -- <command>` runs any command there
(`scripts/linux-runner.ts`; Docker/OrbStack must be running). Do not bypass the guard with fabricated runner
variables. Dispatch CI only for what a Linux container cannot cover: the macOS-only native cases (Electron's
framework copy, signed Mach-O) with `gh workflow run ci.yml --ref <branch> -f compiler_macos=true`, and clean
Windows verification with `compiler_windows=true`. Stop local testing immediately if unrelated apps stop
launching; preserve evidence without changing macOS security settings. Cause remains unproven in the
[launch incident](docs/references/evidence/build-input-snapshot-proof.md#macos-launch-policy-investigation-2026-10-17). The integration half runs directly: its builds reuse the shared compiler store, so
macOS assesses each runtime once. Live watcher cases belong in `*.native.spec.ts`; pure unit checks stay in the
fast half.
`test:linux` limits each run's entire container to 6 GiB RAM, no additional swap and two CPUs,
including installation, builds and subprocesses. Coordinate one expensive run across worktrees;
separate containers each receive their own allowance. These limits do not cover Docker image builds
or commands run directly on the Mac. Use `npm run test:linux -- npm run test:integration` when the
integration pool needs this resource boundary; do not retry an out-of-memory run automatically.
Run required final strict acceptance with `gh workflow run ci.yml --ref <branch> -f strict_chain=true`: it
runs strict `--all` on disposable macOS runners as parallel jobs (`strict-chain.yml`): a producers job, then
two integration shards, two native shards, and the app half with the remaining checks, beside each other on
its outputs — five, the most macOS jobs a free account runs at once — each with two cores and its own
per-step evidence.

Before a checkpoint's broad run, state what it must prove and which required checks cover it. Run the
chain after the focused checks converge. On failure, inspect the preserved evidence and reproduce the
specific failing case; do not use another broad run to diagnose it. After a fix, run that case and the
affected suite. Repeat or broaden only for a named coverage gap, such as concurrency that the isolated
case cannot exercise. State that gap before launching the command.

If a failure recurs without a diagnosis, stop broad reruns and report the blocker, evidence and next
diagnostic action. Keep unrelated failures separate from the checkpoint's implementation scope; do not
silently turn validation into a tooling or performance project. Do not change deadlines, assertions or
input scope merely to obtain a pass. A focused pass does not establish a required broad gate; run the
required final gate once fixes converge, and retain any unresolved acceptance explicitly.

With Vitest projects, verify the effective deadline: project test/hook settings can override CLI
flags. Keep diagnostic overrides scoped to the selected case and preserve their exact source. See the
[async-loader budget evidence](docs/references/evidence/build-input-snapshot-proof.md#async-loader-namespace-observation-checkpoint-2026-10-18).

Keep direct pool output live and integration fail-fast. Collect additional failures only in a deliberate
diagnostic run; see [the early-failure checkpoint](docs/archive/references/evidence/settings-and-pack-contracts.md#bounded-compiler-cost-and-early-failure-checkpoint-2026-10-17).

Freeze every captured input while a pack build runs, including pack-local guides. The chain skipping a
documentation change does not mean that file is outside the pack compiler's captured namespace.

Commit validated logical checkpoints before expanding implementation. Keep one current handoff in the
owning goal: source state, proven checks, unresolved failures and the next action. Historical run logs
are evidence, not instructions to repeat the same runs. See [the validation-loop lesson](docs/archive/references/pipeline-lessons.md#validation-loops).

Things that waste the most time, in order:

- **Running anything after a doc or a CLAUDE.md edit.** No step declares `docs/` and `fingerprintUnit` skips
  every `CLAUDE.md`, so nothing needs to run. The exceptions are a spec that asserts the text and a code fence
  someone will copy. **A comment inside a source file is not one of these**: it moves the file's fingerprint;
  `npm run chain -- --dry` says what it reaches.
- **Sizing an optimisation from a duration.** A step off the critical path buys nothing, a step on it is
  capped by the second-longest route, and a cold chain is core-bound. Read `npm run chain -- --dry --all`'s
  path and savings before measuring a ratio.
- **Running `npm run build:runtime` to test a change no build output depends on.** The renderer and API build
  from source.
- **Running an E2E suite to find a bug you have a stack trace for.** Build once with `sourcemap: true`, decode
  the mapping, read the source.
- **Re-running the full chain after a fix to a thing the chain already covered.** The suite that caught it
  proves the fix.
- **Reading the source twice to explain a bug the running app would show you.** One instrumented E2E run is
  decisive; the run you already did wrote the app's output to `tests/results/app-<workerIndex>.log`
  (`tests/e2e/CLAUDE.md`).
- **Reading a chain step's `cached` as "the thing it guarantees is true".** It means only that its declared
  inputs have not moved ([cache layers](docs/references/cache-layers.md)).
- **Running suites concurrently before the packages are built.** Run `npm run packages:ensure` once first.

Rules that pay for themselves:

- **Measure before you optimise, and before you accept someone else's measurement.**
- **Measure the build that ships, not source run through a dev loader.** A loader compiles with its own
  options — `tsx` sets esbuild's `keepNames` — and those can be most of what you timed
  ([pipeline-lessons.md](docs/archive/references/pipeline-lessons.md#rules-that-pay-for-themselves-the-evidence)).
- **Attribute a concurrent pipeline's cost with a CPU profile, not by timing its stages.** Per-stage wall
  clock double-counts overlap; use `node --cpu-prof` with self time per package.
- **Start a process asynchronously in an integration or native spec.** A synchronous one blocks the worker, so
  no case timeout fires and vitest's 60s RPC window expires. Use `promisify(execFile)` with a timeout, or
  `runCommand` (`packages/apack-cli/tests/_support/run-command.ts`) for a CLI or vitest process tree;
  `check:specifiers` refuses the rest (`findSyncSpawnsInSlowSpecs`).
- **A mutation check is worth more than a re-run.**
- **But a mutation check does not redeem a test that mirrors the code.** Ask whether the code could be
  correct but different; a case every behaviour-preserving rewrite fails encodes the code. A pure re-route
  needs no new spec, and a `toContain` over source text belongs in `check:specifiers` or nowhere.
- **A check that reports nothing may have looked at nothing.** Derive the subject from the declaration that
  defines it and assert it is not empty; where the input is data, mutate it in the test.
- **A result that is partial says so**, in one of four shapes: refuse (`packagesBuiltOrRefuse`), a distinct
  exit code (`npm run spec`'s 3), a named bucket beside the total (`pricedSpecs`' `unpriced`), or a clause on
  the success line (the chain's `(N of M cached)`). Never silent.
- **A check that cannot fail today is a gate or an assertion.** A gate needs a firing case; an assertion needs
  a comment naming the edit that would make it fire.
- **A list and its type are one declaration** (`const XS = [...] as const; type X = (typeof XS)[number]`).
- **A stamp directory has one writer, held by a lock beside it** (`holdExclusiveLock`; `holdChainLock` is the
  worked example). The lock file must not end in `.json`.
- **A cache needs a key that cannot go stale, or a scope in which it cannot — and a reset hatch is neither.**
  Content-key a file, scope a tree ([cache layers](docs/references/cache-layers.md)).
- **A comment is for whoever opens the file cold, not for whoever reads the diff.** Write the state of the
  thing, never its edit history — `it was X until <date>`, `renamed from`, `this used to be` belong in the git
  log. This governs a guide's prose as much as a `//` comment.
- **A comment justifying something by a past failure names what prevents that failure now**: this code and
  how it fails, another file, or that nothing checks it.
- **Keep readings; do not decide with them.** A reading that informs a column needs no band, floor or machine
  field; one compared against an edge needs all of them, and the edge can usually be declared instead.
- **Load inflates a duration and cannot deflate it.** Gate only on *measured faster than declared* (the
  `@slow:` marker gate); *measured slower* is only ever a report.
- **A test's budget and its deadline are two numbers.** A vitest config declares `DEADLINE_FACTOR` times its
  size (`scripts/lib/unit-suites.ts`): a pass past the budget is reported under the step, and only the deadline,
  which catches a hang, fails one. Never raise a budget to get a pass.

[`docs/archive/references/pipeline-lessons.md`](docs/archive/references/pipeline-lessons.md) has what each of these cost to
learn.

### What a test may read

**A step that does not need the built app must not reach one.** `needsApp` (`scripts/lib/chain-steps.ts`) is
derived: a step needs the app when it declares one of `build:runtime`'s outputs among its inputs. A step that
reaches the app without declaring it has to run after `build:runtime` and can no longer be cached or
reordered; a check that genuinely needs the app declares it, and the fix is never to delete the check.
`npm run check:tiers` scans each step's npm script for app launches the inputs cannot show. A producer
(`build:runtime`) writes the app and does not count as reading it.

Split a check at that boundary: `test:external-pack` is `:contract` and `:fork` (no app) and `:app`;
`test:packaged-authoring` is `:author` and `:app`, handing over a work dir through `tests/authoring-handoff`,
which stays **outside** the checkout so the pack cannot resolve `@apackdev/*` from the workspace
`node_modules`. History: [pipeline-lessons.md](docs/archive/references/pipeline-lessons.md#what-a-test-may-read).

## Commands

**A figure in prose earns its place by sizing a choice; one a record owns is named, not copied.** A
measurement a decision cites carries its date and conditions, as `npm run measure` prints them. Nothing holds
prose to code: point at the record or command that derives a figure.

**Script names say whether they write:**

- `<name>:check` / `<name>:update` — a recorded file, both halves with the same noun (`api:*`, `facade:*`,
  `schema:*`, `exports:*`, `content-parity:*`). Only a name ending in `update` rewrites a committed file. Give a
  new recorded file both halves.
- `<action>:<scope>` — an action over part of the repo: `typecheck:renderer`, `test:unit`, `build:api`.
- `<action>:<variant>` — a variant of one action: `build:dev`, `test:watch`, `lint:fix`.

[`docs/archive/references/pipeline-commands.md`](docs/archive/references/pipeline-commands.md#command-notes) has what each
command below was measured against.

```bash
npm run dev                      # Prepare the pack, then dev mode with hot reload and drive support
npm run dev:inspect              # The same with Electron's Node debugger
npm run dev:open                 # Open/reuse the built app and hold it; no builds or watchers
npm run build:api                # Build backend only
npm run build:default-setup      # Build the built-in pack (`apack pack build`) and ensure package bundles
npm run build:runtime            # Build the app runtime after build:default-setup
npm run build:production         # Full production build (build/build.sh)

npm run typecheck                # Every leg below plus check:specifiers, lint:check and the recorded-file
                                 # checks, at once (-- --cores 1 runs them serially)
npm run typecheck:renderer       # Frontend only (vue-tsc)
npm run typecheck:api            # Backend only, plus the api's scripts
npm run typecheck:ears           # @apackdev/ears only
npm run typecheck:sdk            # @apackdev/sdk only
npm run typecheck:host           # @apackdev/host only
npm run typecheck:ui             # @apackdev/ui only
npm run typecheck:cli            # @apackdev/cli + @apackdev/testing
npm run typecheck:scripts        # scripts/, tests/ and the repo/publish check packages
npm run typecheck:pack           # @app/default-setup only
npm run exports:check -w @apackdev/ui  # A stale exports map or a component without an entry

npm run spec                     # The specs your uncommitted changes affect. Exit 1 failed, 2 too wide (listed),
                                 # 3 nothing covers the target
npm run spec -- <target>         # A source file, spec, directory or name fragment; `-` onward goes to vitest
npm run spec:dry [...]           # The plan and what it last cost here, running nothing
npm run spec:full [...]          # Plus pack suites behind a build and integration halves
npm run chain                    # Before a merge: every check in dependency order, cached per step. Output per
                                 # step under node_modules/.cache/apack-chain/runs/; one run per checkout.
                                 # `npm run chain -- --help` lists its flags

npm test                         # Fresh builds and every suite, without test-result caches
npm run test:e2e                 # Playwright E2E — a harness, not a gate (see below)
npm run test:unit                # The host pool and the pack pool (scripts/lib/unit-suites.ts)
npm run test:unit:host           # One pool, only the projects whose inputs changed
npm run test:unit:pack           # The pack pool, resolving the published dist
npm run test:integration         # Every suite's expensive half, as one vitest run at half the cores
npm run test:native              # The native half (*.native.spec.ts), one file at a time, a 300s budget a case
npm run test:linux -- <command>  # Run a command in the Linux test container (the chain does for test:native on a Mac)
npm run test:external-pack       # Both halves of the fixture-pack check
npm run test:external-pack:contract  # Validate, build, typecheck, harness specs — no app
npm run test:external-pack:fork  # Build and archive the shipped-pack fork — no app
npm run test:external-pack:app   # Each pack's Playwright suite (needs build:default-setup && build:runtime)
npm run test:packaged-authoring  # Author, build, test and install a pack from the packed tarballs
npm run test:packaged-authoring:author  # The half that needs no app
npm run test:packaged-authoring:app     # The half against the built app
npm run bench -w @apackdev/ears  # EARS engine benchmark (packages/apack-ears/CLAUDE.md)

npm run db:query -- "<code>"     # apack db query on the dev app's data (also db:exec, db:repl, db:inspect, db:runs,
                                 # db:export, db:import, db:reset, db:clear-settings; app closed for changes)

npm run api:check                # Fails if a public entry's API changed without updating etc/ reports
npm run api:update               # Regenerate etc/<entry>.api.md and .component.md (packages:build first)
npm run facade:check             # Chain: the verified build against etc/pack-types.api.md
npm run facade:check -w @app/default-setup  # The same, derived from source
npm run facade:update            # Derive from source and update the report
npm run schema:update            # -w @apackdev/sdk: regenerate apack.schema.json
npm run schema:check             # -w @apackdev/sdk: fails if apack.schema.json is stale
npm run content-parity:check     # -w @app/default-setup: written entities against tests/content/__golden__
npm run content-parity:update    # -w @app/default-setup: re-record them, deliberately

npm run measure -- "<cmd>"       # Time a command on a quiet machine; prints a citable median with conditions
                                 #   --runs N  --against "<B>"  --trials N  --busy N  --idle PERCENT  --force
npm run measure:loop -- "<cmd>"  # How long each process went without turning its event loop, against birpc's 60s
npm run check:idle               # Is this machine quiet enough to measure on (exit 1 below IDLE_FLOOR)

npm run check:specifiers         # Every import rule over the repo; paths for per-file rules; --rule, --list
npm run specifiers:fix           # Rewrite the specifiers the rules can repair; --dry prints
npm run lint:check               # oxlint (correctness rules only), plus eslint in the renderer
npm run lint:fix                 # Rewrite what it can

npm run packages:build           # Build the published packages' dist and bundles
npm run packages:check           # publint + attw over a tarball packed from each published tree
npm run check:repro              # Build everything twice and compare — a diagnostic, run after a bundler bump
```

### E2E visual testing

**Drive the app from `drive/`, with `npm run dev:drive`** (a pack author passes `--`): open what you built,
click through it, read state back, screenshot it. Nothing collects or gates on those scripts. For one
question, `npm run dev:eval` and its neighbours ask the app `npm run dev` holds over its debug port and print
one JSON object; with no app they exit 3, and `--spawn` starts one. `docs/public-facing/cli.md` has the verbs.

**`tests/e2e/smoke/` is a gate**, as its own chain step (`test:smoke`): the app launches, reaches
`connected`, has its surfaces, and runs in its own data dir.

**The rest of the suite is not a gate.** A spec earns a place there when it asserts something a future change
could break **and** needs the real process boundary (`app-integration/dev-reload.spec.ts` is the example);
anything else is a harness test or a driving script. `npm run chain -- --e2e` runs the suite after
`test:smoke`; `npm run test:e2e` runs it alone.

Playwright tests launch the full Electron app and interact via `window.applicationState` (the XState actor). Use to visually verify UI changes.

```bash
npm run test:e2e                     # Run all E2E tests
npm run test:e2e -- smoke                    # One directory: smoke, ui or app-integration
DEBUG_E2E=1 npm run test:e2e                  # With Electron stdout/stderr logging
npm run test:headed                   # Show the app's windows, to watch a test drive it. Under Playwright
                                      # they are never shown or focused (PLAYWRIGHT_VISIBLE, the guard in
                                      # packages/main WindowManager, the splash and the protocol handler)
npm run test:explorer                 # Playwright's UI mode: its test explorer, with a timeline and DOM
                                      # snapshots. Playwright's own window, not the app's — the two are
                                      # orthogonal, and `--debug` is a third thing (the Inspector)
```

This suite takes no screenshots — looking at the app is `drive/`'s job, and `npm run dev:drive` saves to `drive/screenshots/`. The `app` fixture provides `navigate(surfaceId)`, `screenshot(name)`, `sendEvent(event)`, `getState()`, `getContext()`, `waitForState(check)`, and `waitForSurface(surfaceId)`.

The fixture is `@apackdev/testing` (`packages/apack-testing/src/index.ts`), which every spec imports directly, as a pack's own do. It launches Electron, finds the main window via `window.applicationState`, bypasses onboarding, and provides the `AppDriver` API. External packs share the same fixture — `apack pack init-tests` scaffolds tests in a pack repo, then `apack pack test` runs them in a local checkout (`--app`) or a downloaded apack Beta (`--channel beta`). Set `PACK_DIR=/path/to/pack` to sync/build a pack and wait for its surfaces.

For full fixture lifecycle, API reference, and ad-hoc testing pattern, see `tests/e2e/CLAUDE.md`. For external pack testing details, see `packages/apack-testing/CLAUDE.md`.

## Architecture

### Event-driven actor system

Every backend **system** and frontend **surface** is an XState state machine. They communicate via a central event bus:

- **Backend → Frontend**: `broadcastToSurface(name, event)`, in a system's actions or anywhere else; actions use `services.emitter.broadcastToSurface`. It goes over the bus, so it reaches **every** window showing that surface — a surface runs once per window. The renderer's `sendToSurface(name, event)` is the other half: straight to this window's actor. **A broadcast does three jobs and only one of them is an answer** — a notification nobody asked for, a view's data fetch, and a command's result — and which one an event is doing decides both its channel and its shape: a notification is never correlated, a fetch wants its answer in a slot keyed by what was asked, and a command's result is **replied** rather than broadcast, correlated by the envelope's call. `packages/default-setup/CLAUDE.md` has the three with the worked examples; getting it wrong is where an answer taken for the wrong request comes from
- **Frontend or backend → System**: `sendToSystem(systemId, event)`, typed with the events each system declares (own systems by feature id, a dependency's as `<dependency>/<feature>`; actions name every system `<pack>/<feature>`)
- **System → System**: `sendToSystem(name, event)`, the same typed send a surface uses; no pack code looks up another system's actor. `sendToSystem({ role }, event)` reaches whichever system plays a role (`{ role: 'brain' }` with `TRIGGER_BRAIN_EVENT` fires a flow event), and `host/bus` takes `PACK_CHANGED` (`HostSystemEvents`)
- **Child actors are private**: a feature spawns its children with an `id` and no `systemId`, and reaches them through its own snapshot's `children`; another feature sends the feature an event, which it routes to the child (the code surface routes `<child>.*` events by prefix)
- **Frontend**: a component reaches its own surface with `useSurface()` (`@apackdev/sdk/fe`); the host renders each surface's canvas, panel and chat in a `SurfaceScope` for it, and the app's Settings view renders each surface's settings form in one. No pack code looks up another surface's actor, and no feature imports another's frontend at all (the `cross-feature-imports` pack rule, run by `apack pack validate` for every pack and by `check:specifiers` for this repo's): what a feature offers the rest is its surface's `Contract` — the state it publishes, read with the `useSurfaceState`/`readSurfaceState` its `#generated/fe` generates, and the inbox others may send, which types the sends. `openSurface` (`#generated/fe`) takes only the names the pack can write (`SurfaceName`: its own features, its dependencies' `<pack>/<feature>`), so a misspelled target doesn't compile; a target that arrives as data (a link block's) opens through `untypedOpenSurface(ref, event?)` (`@apackdev/sdk/fe`), which refuses a string that isn't a ref and asks the shell to open the rest: the shell waits for a surface whose pack's frontend is still loading, and tells the user about a ref no pack provides once loading has settled Actor replacement remounts the `SurfaceScope` subtree, so setup-time actor captures belong to one lifetime; what a component holds for the user until it is saved is a `useSurfaceDraft` (`@apackdev/sdk/fe`), which the remount — a reconnect causes one — hands back.
- Pack code takes `broadcastToSurface`/`sendToSurface`/`sendToSystem` from `#generated/events`; `onConnected`/`onIncoming` come from `@apackdev/sdk/events`. `check:specifiers` rejects the host's raw event paths (its root event bus and API client) and the untyped sends in pack sources
- **Addressing is an envelope**: a send is a message, `{ to, event, from?, via?, client?, sender?, call?, answering? }`, and `event` arrives exactly as the sender wrote it, so an event may carry any field, `surfaceId` or `systemId` included. `from` is the id of the pack that sent it, stamped by the sends `#generated/events` builds; `via` is what within that pack made the send when the pack alone doesn't say — `action:<label>` for an action, stamped by the emitter `createActionEmitter` builds per run, the same string that names the action's logger. `from` keeps one meaning, the pack, so nothing parsing it as a `<packId>/<featureId>` ref gets a wrong answer; `via` names a source, of which an action is one — `reportError`'s sends carry the source they were given and no `from`, having no pack to name. Between them every send carries a pack, a source, or both, except `services.emitter` reached outside an action, where neither is in scope. Nothing routes or refuses on either: every diagnostic that reports an undeliverable message names them — the bus's drops, `receiveClientEvent`'s errors, the shell's toast for an in-window send that reaches no surface (however long it waited for its pack), and the shell's warning for a backend send that does. All of them go through one `senderSuffix` (`@apackdev/sdk/events`), so they word it the same. `client` is the one field that routes, and so the one a sender never sets: it names the connection to deliver to, absent meaning every connection, and the API mints it per WebSocket connection and stamps it on the way in (`createContext`, `packages/api/src/transport/context.ts`) — which is what makes it a return address nobody can forge. `sender` is the other half of a return address: the ref of the participant that sent it, which is what an answer is addressed to. It is stamped where a send is *made* — during the handling of another message, from the delivery in scope — because a pack's generated sends know their pack and not which of its features called them, and it is accepted from the wire where `client` is not, since the client is the only party that knows which of its surfaces asked and every caller already holds the API token anyway. A system answers with `reply(event)` from `@apackdev/sdk/events`, which names no address at all: it reads the message being handled and sends to its `sender` on its `client`. Nothing is stamped onto the event, so a return address is never a field of the event — the invariant `outgoing-events.spec.ts` pins. Three doors set the scope — the bus routing to a system, `sendToSurfaceActor` (the one function every send to a surface's actor goes through) and `useSurface`, so a component's own send is named too — which between them cover every send pack code makes; each records the event it delivers, and a handler is handed `reply` only for that event (or that same object forwarded to a child), never for an event its machine made while handling it; `reply` throws rather than broadcasting for a send made from nothing (a timer, a subscription, host plumbing). **`call` is the call a message *is* and `answering` the call it *answers*, and between them they are the app's one correlation.** Every send mints a call (`createSends`), `reply` stamps `answering` with the call it was entered under, and a delivery door puts that on the delivered event under a reserved key — which is the only channel to a transition guard, since a guard is handed `{ context, event }` and nothing else. **No event type declares a correlation field, and none should.** Pack code never reads the raw value: it asks `answersCall(event, outstanding)` where it holds one outstanding ask, or keys several with `recordCall`/`settleCall`, both from `@apackdev/sdk/events`; `newCall()` mints one where the id is needed before the send (an `enqueueActions` body). `_callOf` is host-only — a raw call invites `===` against a stored one, which answers *true* when both are absent, so a guard written the obvious way admits an answer nobody asked for. A spec driving a machine with no delivery door in front of it builds an answer with `answerTo` (`@apackdev/sdk/testing`), and the `reserved-event-keys` pack rule refuses a pack writing the key itself. The API's `bus.send` schema names `from`, `via`, `call` and `answering` so a client's send and a backend's answer both keep them, and omits `client` on purpose; every other field a client invents is still dropped there, so a field added to the envelope and not to that schema arrives as `undefined`. The bus, the API's `bus.send` and its subscription, and the renderer route on `to`; messages sent in go to systems, messages sent out to surfaces. The subscription routes on `client` too, which is why a window never sees a message that was not for it.

A system's contract declares its `context` and its `incoming`, `internal` and `outgoing` event unions as one type, which `defineSystem<Contract>()` takes and `apack.json` names. System code lives in `packages/default-setup/src/features/<name>/be/system.ts`, its contract in `be/contract.ts` beside it; its identity is its feature's, from `apack.json`, which codegen passes to `packSystem`; a feature's designation comes only from `apack.json` `features.<id>.designation`, and is a role rather than a name: it need not equal the feature id. The bus machine is `createBusMachine` in `packages/apack-host/src/bus`; `createAppBus(registry)` there composes it with the app's root event bus (the api's tRPC event sources), and `packages/api/src/runtime/index.ts` starts it. Systems register through the app's registry (`createPackRegistry()` in `packages/apack-host/src/packs/registry.ts`, its `registerPack()`). Every pack's systems and surfaces run under `<packId>/<featureId>`, built-in packs included — the app itself is the pack `host` (`host/bus`, `host/application`, `host/packs`, `host/settings`), so there is no namespace of bare ids and a pack can't take the id `host`. Pack code names features — its own by id, every other (the host's too) as `<packId>/<featureId>`; the ref it runs under is spelled the same, so a bare name is only short for the pack's own: the sends (`broadcastToSurface`/`sendToSurface`/`sendToSystem`) and `openSurface`, generated in `#generated/events` and `#generated/fe`, resolve the name (`resolveName`, `@apackdev/sdk/ids`, is the one rule; `splitRef` takes a ref apart). The registries resolve what registrations name: a pack registers its `features` keyed by feature id on both sides (`PackRegistration.features`: each one's system, surface, role, services and settings; `PackFERegistration.surfaces`), each registry runs every feature at its ref, and both refuse a key that isn't a feature id (`FEATURE_ID_PATTERN`, `@apackdev/sdk/ids`).

**One name per concern, `untyped` for the unchecked half.** A pack reaches most of the SDK through its generated
facades, which check the name and the payload against what the pack and its dependencies declare. Every such helper
has an untyped twin for a target that arrives as data or for host code, which has no pack to be typed against, and
the twin is the typed name with `untyped` in front: `query`/`untypedQuery`, `create`/`untypedCreate`, `upsert`/`untypedUpsert` and `write`/`untypedWrite` (`@apackdev/sdk/ears`),
`useSurfaceState`/`useUntypedSurfaceState`, `readSurfaceState`/`readUntypedSurfaceState`, `openSurface`/`untypedOpenSurface`
(`@apackdev/sdk/fe`), `broadcastToSurface`/`untypedBroadcastToSurface` and `sendToSystem`/`untypedSendToSystem`
(`@apackdev/sdk/events`). The point is that a call site says whether the compiler checked it without anyone reading
the imports, so a new escape hatch takes the prefix rather than a new verb or the same name in another module.

The `_` prefix is a different axis and doesn't combine with it: `_sendToLocalSurface` and `_rootEvents` are
host-only, which `check:specifiers` enforces by the underscore, and packs may not import them at all — where an
`untyped*` helper is something a pack may use and simply isn't checked on.

**That is the `_` that carries a rule. A `_` on a local or a parameter is an unrelated convention** — a binding
deliberately left unused, as `_z` and `_flowId` are in an action's signature, which oxlint prescribes and nothing
enforces. The two never collide in practice, one being an export and the other never one. The trap is reaching
for the second on dead code: a declaration nobody reads is not deliberately unused, it is simply gone, and
prefixing it hides it from the gate that just found it.

### SDK packages

`@apackdev/sdk` is the pack-facing API; host-only modules live in the private `@apackdev/host` (`packages/apack-host`). Packs, built-in or external, import only `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/ui`; host code (api, renderer, CLI and testing) also uses `@apackdev/host`; default-setup, tests included, does not depend on it. `npm run check:specifiers` rejects `@apackdev/host` in pack sources and CLI templates, and `apack pack build` fails a pack bundle that imports it. Pack code reads relations with `findRelations` and queries untyped with `untypedQuery` (`@apackdev/sdk/ears`), reaches host-implemented data operations through `services.appData` (reset and backup export/import), `services.onboarding` (completion state), `services.runHistory` (flow runs, recorded while they run and kept after), `services.secrets` (the user's API keys as metadata: list, select, rename, delete; never values) and `services.filesystem` (files and folders on disk, as text), and calls models through `services.inference` (AI SDK 7's `generateText`/`streamText`, `createAgent`, `embed`/`embedMany`, `generateImage`, `generateSpeech`, `transcribe` and `rerank`, with `provider:model` ids checked against `providerCapabilities`, `output` as an `Output` or plain data like `{ type: 'object', schema }`, and the key the user selected per provider, never the environment; packs import pure pieces like `tool` from `ai`).

Layers, each importing only the ones above it (`check:specifiers`, `findUpwardImports`, and each `package.json`'s `@apackdev` dependencies):

| Layer | Holds |
|---|---|
| `@apackdev/ears` | the engine, the EARS types, the database port (`/lmdb`: opening elmdb databases) |
| `@apackdev/sdk` | the pack contract and pack runtime: registries of what packs registered, the services' contracts, event sends, logging and error reports over the bound bus, the SDK entities and their repositories, the `HostRuntime` port |
| `@apackdev/host` | the app runtime, and the app's own features: `features/` is the pack `host` (`application`, `packs` and `settings`, each `{be,fe}` as any pack's are), and beside it what every pack runs on — the six app services (`/services`), app state (`/app-state`), `/packs` and `/packs/runtime`, `/bus`, `/migrations`, `/secrets`, the frontend's plumbing (`/fe`) and its database opened outside it (`/database`) |
| `packages/api` | transport (`node:http`, `ws`, the tRPC routers, the log stream), process boot and composition (`runtime/index.ts`); `src/` is one folder per job — `boot/`, `runtime/`, `transport/`, `adapters/` — which `packages/renderer/src` mirrors with `views/` added |
| `packages/renderer` | the frontend composition: binds the frontend port, and composes the host's shell with the window's I/O (the API client, the pack loader, storage, the toast and error page); `src/` is the API's four job folders plus `views/` |

**Those five are the layers worth reading; `findUpwardImports` enforces twelve.** The rest are tooling and
shells — `@apackdev/ui` (which may reach `@apackdev/sdk` and nothing else), `@apackdev/testing`, `@apackdev/cli`,
`@app/main`, `@app/preload` (the narrowest: a sandboxed bridge may not reach the app runtime),
`@app/repo-checks` and `@app/publish-checks` — and what each may import is in `LAYERS`
(`scripts/check-import-specifiers.ts`). A hand-written list says nothing about the workspaces it omits, so
the rule derives its own population instead: a workspace holding code has a layer or is a pack, whose imports
the pack rules govern more narrowly. Deriving it rather than listing it is what surfaces a workspace nobody
added.

What crosses to the app follows one rule, **bind resources, derive behaviour**. A resource has identity per running app (the event bus, the engine and its data, the registered packs, services doing I/O on user data or keys) and is a `HostRuntime` member; behaviour over a resource is SDK code, written once for the app, tests and tooling. So event sends, logging and error reports are SDK code over the bound bus, not host implementations. `services` holds nine host services (`HostServices`, reserved names in host's `packs/registry.ts`): the SDK implements `logger` and `emitter` over the bound bus and `repository` over the registered packs, and the app implements seven, `appData`, `onboarding`, `runHistory`, `inference`, `secrets`, `filesystem` and `settings`: contract types in `@apackdev/sdk/services/<name>.ts`, implementation in `@apackdev/host/services/<name>.ts`, test doubles in `@apackdev/sdk/testing`'s in-memory runtime (`fakeInference`, `addTestSecret`). Host-only modules (`/app-state`, `/migrations`, `/packs/runtime`, `/bus`, `/secrets`) aren't reachable from the SDK.

- `@apackdev/ears` (`packages/apack-ears`, see its CLAUDE.md) — the EARS engine, published like the SDK and imported by no other `@apackdev` package: `createEarsEngine`, `defineEars`, the core `EARS` namespace (an entity type is any name: the engine declares none, and a relation is not an entity; `RESERVED_ENTITY_TYPES`, `Relation` and `Sequence`, are what its own ids are written with, and no pack may declare them), `BaseEntity`/`EntityShapes`/`ShapeOf`/`EntityNameArg`, `EarsError`, etc. The engine is an instance: `createEarsEngine({ database, warn?, freeze? })` returns a new engine over an elmdb database, whose schema says its entity types, relation kinds, roles and row rules (no `@apackdev/ears` module keeps anything at module scope, `tests/no-module-state.spec.ts`), whose members are its operations (`query`, `create`, `upsert`, `write`, `transact`, relation reads), with `admin` beside them (`clear`, the raw listings, `bulkLoadAttr` and `bulkLoadRelation`, and direct attribute and relation writes); a program is handed it typed `Ears`, without `admin`, which only its creator holds. Nothing in the package acts on an engine it wasn't given. The app's engine is the SDK's (`@apackdev/sdk/ears`): `boundEars()`, and the operations over it that code calls without holding an engine (`untypedQuery`, `untypedCreate`, `findRelations`, …), which throw naming the fix when none is bound; `bindHost` binds the app's (`HostRuntime.ears`), `startTestRuntime` a test engine (`resetTestData` replaces it), and tooling binds its own with the host-only `_bindEars` or passes one (`exportFlowsToDSL(dir, { engine })`). A pack's repositories arrive in its registration (`PackRegistration.repositories`) and are the registry's, not the engine's: `repository` (`@apackdev/sdk/services`) reads them from the bound `HostRuntime.packs` (`repository(name)`). It's a shared-instance package with the SDK: `SHARED_INSTANCE_PACKAGES` in `@apackdev/host/build/shared-deps` is the one list the bundler externals, the pack loader's bridge (generated `packs/runtime/sdk-modules.ts`, `npm run sdk-modules:update -w @apackdev/host`), the harness bridge and `bundle-package` derive from; `check:specifiers` rejects those consumers naming the packages themselves, and upward imports (`@apackdev/ears` imports no `@apackdev/*`, `@apackdev/sdk` only `@apackdev/ears`, `@apackdev/host` only those two and never the API).
- What the SDK adds to the engine: its `EARS` (the engine's types plus `SDK_ENTITIES`/`SDK_REL_KINDS`) and the SDK entity shapes, from `@apackdev/sdk/types` (and the root), and the SDK entities' repositories from `@apackdev/sdk/repositories` (`flowRepository`, `actionRepository`, `promptRepository`, `documentRepository`, `collectionRepository`; default-setup's flows, actions, prompts and library repositories build their views over them). Packs get typed `query`/`create`/`upsert`/`write`/`transact`/`newId`/`getAttr` from `#generated/ears` (a literal entity name must be one the pack or its dependencies declare, its `EntityName`; a name typed `string` passes unchecked; ids from typed queries carry their entity type, a plain `EARS.EntityId` is accepted anywhere; the writes name only the shape's declared fields and check their values when they know the entity; `EARS.RelKind` and `EARS.RoleKind` are closed over the pack's, its dependencies' and the SDK's relation kinds and roles (`apack.json` `data.relations`, `data.roles`), which every link, walk, link filter and role write or query takes, and the engine refuses any other at runtime; the SDK owns the flow model (Flow, Node, Action, Prompt) and the document model (Document, Collection, and the `parent_of` that nests folders), defined in `apack-sdk/src/types/sdk-entities.ts`, and no pack declares them — **a pack declares content writers only for entity types it owns, so an SDK entity's writers are the SDK's too**, named by `sdkContentWriters` (`apack-sdk/src/content/writers.ts`) rather than registered, there being no pack that could contribute them; the host declares `AppState` and `Settings`, which packs reach only through `services.settings`), `repository` (typed with the repositories declared in `apack.json` `features.<id>.repositories`) from `#generated/repository`, and `broadcastToSurface`/`sendToSurface` (keyed by receiving surface: its own feature's system's outgoing events, plus the inbox that surface's `Contract` declares, which `apack.json` names at `features.<id>.surface.contract`) and `sendToSystem` (keyed by receiving system; a pack without systems sends to its dependencies') from `#generated/events`. A system's events come from the contract `apack.json` names at `features.<id>.system.contract` — a declared type in a leaf module (`be/contract.ts`), read without resolving the machine — so how its entry is declared can't change them; the generated pack entry asserts that `defineSystem<Contract>()` names that same contract. `apack pack build` bundles a pack's facade types into `dist/types/pack-types.d.ts` (and its snapshot), so dependents' facades include them. `check:specifiers` rejects raw `broadcastToSurface`/`sendToSurface`/`sendToSystem` imports in pack sources.
- `@apackdev/ears/lmdb` opens elmdb databases: `openDatabase({ path, schema?, readOnly?, syncs? })`, and `createTemporaryDatabases()` for tests and tooling; nothing opens on import. `elmdb` is a dependency of `@apackdev/ears`, linked from the checkout `vendor/elmdb` points at (`npm run link:elmdb`, pinned by `vendor/elmdb.rev`; `packages/api` depends on it too, for the packaged app). Only `/lmdb` imports `elmdb`: the api's composition (`runtime/index.ts`) opens the app's database and the run history's through `@apackdev/host/database` (`openDatabaseStore`, `openRunHistory`), each with an engine of its own, and binds `createHostRuntime({ database, runHistory, engine, packs, … })`; host code (`@apackdev/host/services`, `/backup`) takes each database as an argument; packs, pack tests and the pack bridges never load it (`APP_ONLY_EXPORTS`); `check:specifiers` (`findElmdbImports`) enforces it. No code reaches engine state except through an engine's `admin`, which the package's exports enforce: an admin write is a member of an engine's admin face and no entry exports one, so `import { bulkLoadAttr } from '@apackdev/ears'` doesn't compile.
- `@apackdev/sdk/events` — messaging: `sendToSurface`, `sendToSystem` (a system by ref, or `{ role }`), `onConnected`, `onIncoming`, `defineEvents` and the event map types (`HostSurfaceEvents`, `HostSystemEvents`). Frontend-safe; shared with pack frontends as the `sdkEvents` global. It sends over the bound app's bus (`HostRuntime.transport`), or in the renderer over the frontend port's `client`. `broadcastToSurface` (and `services.emitter.broadcastToSurface`) goes through the bus actor, so it's dropped until a client connects, and reaches every window; the renderer's `sendToSurface` goes straight to this window's actor.
- `@apackdev/sdk/logger` — `createLogger(source, { debug? })` (debug gated per source by `setDebugEnabled`), `reportError` (a system error, sent to the app as `SYSTEM_ERROR`, or with `step` a flow step's error recorded on its run node) and `onLog`. SDK code over the bound bus: a logger emits redacted log events there (the api prints each once), and with no app bound (the CLI, tooling) writes to the console. Backend pack code doesn't call `console.*` — a pack rule (`@apackdev/cli`'s `build/pack-rules.ts`), so `apack pack validate` and `apack pack build` refuse it for any pack and `check:specifiers` for this repo's; a pack may allow it through `apack.json` `checks.allow`.
- `@apackdev/sdk/templates` — `executeTemplate`, `createTemplateResolver`. `@apackdev/sdk/env` — `resolveAppEnvironment`, `getAppVersion`. `@apackdev/sdk/runtime` — the one port to the app: `HostRuntime` (`transport.rootEvents`, `ears`, `packs`, `appVersion`, `services`: `appData`, `onboarding`, `runHistory`, `inference`, `secrets`, `filesystem`, `settings`, and the optional `redaction`, which tells log redaction which runs of characters are key values this process used — absent in a runtime with no secrets of its own), bound once per process with `bindHost` (the api binds `createHostRuntime(...)`, `startTestRuntime` an in-memory one), and the renderer's `bindFeHost({ application, secrets, client, packs })`; an unbound use throws naming them. The registered packs are an instance too: the program that assembles an app creates one (the api's composition root `createPackRegistry()`, the renderer `createFePackRegistry()`, the harness one per test file, the CLI one per build) and binds its read face (`PackRegistryView`, `FePackRegistryView`); the SDK's registries of what packs registered (designations, steps, artifacts, blocks, content writers, appliers, feature settings defaults, pack services, and in the renderer text editor extensions and DSL types) read the bound one, and no SDK or host module keeps them at module scope. Everything a pack contributes arrives in its `PackRegistration`/`PackFERegistration` (appliers and DSL types included); there's no registry for pack code to write to. Contexts without an app (SDK specs, a pack test filling a registry directly) use `testPacks` from `@apackdev/sdk/testing`. Also the `@internal` `_rootEvents` (the bound bus). `secretsClient` (`@apackdev/sdk/fe`) reads the frontend port's `secrets`; no general API client reaches the SDK.
- `@apackdev/sdk/fe` — pack-facing: `Surface`, `PackFERegistration`, `safeEvents`, `useSurface`/`SurfaceScope` (`fe/actor-system.ts`), `useUntypedSurfaceState`/`readUntypedSurfaceState` and `surfaceIsRunning` (`fe/surface-state.ts`: another surface's state by ref, untyped — the escape hatch beside the typed readers `#generated/fe` generates from each surface's contract, as `untypedQuery` is beside `query`. They hand back a value and never the actor, and `TSelected | undefined`, since a ref is a name and nothing about a name says the surface is running; the reactive one follows the surface arriving and reloading, not only changing), `useShell` (`fe/shell.ts`: the app shell's state and commands, typed by `HostShell`; no pack code holds the shell's actor), `untypedOpenSurface` (`fe/navigation.ts`), `secretsClient`, the settings composables (`fe/settings.ts`: `useAppSettings`, `usePackSettings`, `useFeatureSettings`, `useSettingsDraft`, `useSettingsSave` and `useSettingsStatus` follow the settings until the calling scope is disposed, so they run in a component's setup and never inside a `computed`). A change names its owner explicitly (the app, a pack and group, or a feature by its ref), and the whole path is inside it, etc.
- `@apackdev/host/fe` — host-only: `createFePackRegistry()`, the renderer's registered pack frontends (`registerPackFE`, `getRegisteredSurfaces`, app extensions); `createShellMachine`, the app shell over the I/O it's given (`ShellClient`, pack frontends, storage, notify, the event target), which the renderer composes with the window's and a test with fakes; and the `host/packs` feature's frontend (`fe/packs/`), beside the system that answers it — the Packs surface's machine, pack-frontend loading over `PackFrontendIO` (the window's `import()` and stylesheets), the install a deep link asks for, and `runWindowStorageMigrations`, the window-storage counterpart of the app's migrations. It re-exports the `host/settings` feature's frontend too (`features/settings/fe/machine.ts`: `createSettingsMachine(io)`, over the restart and report the renderer gives it). `src/fe/index.ts` is where all three features' frontends are named — the package's export surface, which is why naming them there isn't the cross-feature import `check:specifiers` refuses; a port both the shell and the packs feature need (`ShellPackFrontends`) lives at the seam in `src/fe/` rather than in either.
- `@apackdev/host/settings` — host-owned app, pack-group and feature preferences: `createSettingsStore({ ears, catalog, onCatalogChanged })` owns the current overrides and their common validated writer. `createSettingsService(store)` supplies administration to host composition and caller-bound access to packs. Installed declarations remain available when executable pack code is disabled; default-setup supplies no app defaults or whole-document assembly. The per-window runtime precedes the shell, and the Settings view is a subscriber and editor. The backend system and view machine live in `features/settings/{be,fe}`; Vue forms live in `packages/renderer/src/views/settings/`.
- `@apackdev/host/views` — the views windows are subscribed to: `createViewHost({ ears, packs })` resolves each request (a feature's ref, a view's name, its arguments) to that feature's view in the registered pack (`PackFeature.views`, from `defineViews` in `@apackdev/sdk/framework` and `apack.json` `features.<id>.views`) and runs it as one engine watch per distinct request, however many windows share it. A pack's registration changing (`PackRegistry.onRegistrationChanged`) restarts its watches on the new code. The API serves it as `views.watch`, one tRPC subscription per `useView`, so a socket closing ends its window's; the harness's `app.watchView` and shell subscribe to the test file's.
- `@apackdev/host/packs`, `/packs/runtime`, `/packs/dev-server`, `/backup`, `/build/discover`, `/build/shared-deps`, `/build/source-resolution` — pack registration (`createPackRegistry()`: the registered packs as an instance, with their shutdown hooks), discovery, registry, installer, updater, pack layout and module bridge (the CLI imports this barrel, which never imports `/packs/runtime`); the pack runtime the app runs, on the registry it's given (loader, SDK bridge, lifecycle, reload, writing, the host `packs` system); the `apack pack dev` server marker the `pack://` handler proxies to; backups of both databases (elmdb's compacted copy); build-time pack discovery and host-shared dependency lists; the `@apackdev/source` condition helpers and the check that a process resolves workspace source, not `dist`.
- `@apackdev/host/exclusive-lock` — one writer at a time for a file two processes would otherwise interleave on: `holdExclusiveLock({ file, what, refuse })`, `findLockHolder`, `readLock`, `INTERRUPTS`. The mechanism only — the lock file's name and the refusal's wording belong to whoever takes it, which `database/write-lock.ts` (a tool changing a data dir), the CLI's code generation and the chain's `holdChainLock` each do. `wx` is the acquisition, so two arriving together cannot both win; a lock whose holder has exited is taken over, and one that cannot be read or names another machine counts as held.
- `@apackdev/host/process-liveness` — what a running process left on disk and whether it is still there: `lockIsHeld`, `recordIsStale`, and `readApiEndpoint` for the port file a running API publishes.
- `@apackdev/host/private-file` — `writePrivateFile`: a 0600 atomic write (unique temporary, fsync, directory sync, a Windows rename retry), for a file only the user should read. Neutral rather than under `/secrets`, because the secrets store is one caller and neither the API's port and token files nor a session file is a secret. The app's own plumbing, so packs never reach it.
- `@apackdev/host/bus` — `createBusMachine`, the backend bus (spawns registered systems, routes events, pack activate/teardown/reload), `createAppBus()`, the app's composition of it, and `receiveClientEvent()`, the check, log and send behind the API's `bus.send`. It never imports the pack loader; the pack test harness runs the same machine.
- `@apackdev/host/migrations` — the app's migrations runners (`runAppMigrations`, `runPackMigrations`; see Migrations below). Host-only, never bridged to packs.
- `@apackdev/host/services` — the host's implementations of the services packs reach through `services` (`app-data.ts`, `onboarding.ts`, `run-history.ts`, `inference.ts`, `secrets.ts`, `filesystem.ts`, `settings.ts`, each named after its contract and delegate in `@apackdev/sdk/services`). `createHostRuntime({ database, runHistory, engine, transport, appVersion, packs })` (`services/index.ts`) is the only place the app's `HostRuntime` is assembled, over the app's database (`appData` uses it) and the run history's database and engine (`runHistory`); the API's composition binds it. `appData.reset()` resets the whole app: stores and keys, each pack's `onInit` and boot apply, then the host's `runAppMigrations(registry)`. `src/services` holds only those services and the index (`tests/boundaries.spec.ts`). A service's implementation never lives in the API, which keeps only transport, process boot and composition (`packages/api/tests/source-layout.spec.ts` lists its files); the API's tRPC procedures delegate to host (`receiveClientEvent`, `secretsStore`/`secretsSnapshot`, `getLoadedPackEntries`).
- `@apackdev/host/app-state` — host-only: the app's own state, one `AppState` row (`hasOnboarded`, `version`, `packVersions`, `failedAgainst`, `surfaceVisibility`, `lastActiveSurface`) that only host code reads and writes (`appState`), and each pack's applied content — the revision its content was applied from and, per item, a hash per part of what that apply wrote (`appliedContent`, `applied-content.ts`), which is the whole of what makes applying a pack's content a three-way merge rather than a hash comparison. The host registers all three entity types next to the SDK's, with `Settings` (`HOST_ENTITY_TYPES`), and no pack may declare any of them. Packs learn whether the user onboarded through `services.onboarding.isComplete()`/`complete()`, the renderer through the application surface's `CLIENT_CONNECTED`. Resetting settings doesn't touch it; `appData.reset()` empties it with the rest.
- `@apackdev/host/secrets` — host-only, never bridged to packs: the store of the user's API keys (metadata plain, values AES-256-GCM encrypted in `secrets.json`, the data key in a `KeyVault`: the OS credential store via `@napi-rs/keyring`, or a file in the test environment or after the user allows unprotected storage). Values reach it only through the API's `secrets.*` tRPC procedures, off the event bus (`forwardSecretsChanges()` tells every system that declares it takes `SECRETS_CHANGED` that keys changed, never their values); inference reads them with `secretsStore.keyFor(provider)`. The API logger and error reports redact key-shaped strings.
- `@apackdev/ui` (`packages/apack-ui`) — Vue components, editors and UI composables (`@apackdev/ui/design/button`, `@apackdev/ui/components/tiptap/TiptapEditor`, `@apackdev/ui/composables/useDebounce`). Published as compiled JS (tsdown, with vue-tsc declarations). Packs use the host's copy at runtime: the renderer serves every export as a build entry and names it in the document's import map, and the pack FE bundler leaves `@apackdev/ui` imports external, unless `apack.json` sets `fe.bundleUi`. Contracts and host-shared state (`useShell`, menu state, the text editor extension and DSL type lookups) stay in `@apackdev/sdk/fe`; `@apackdev/sdk` must not import `@apackdev/ui`.
- `@apackdev/sdk/utils` — **Node-only**: re-exports everything (pure + Node-dependent). Backend code imports from here.
- `@apackdev/sdk/utils/pure` — **environment-agnostic**: pure utilities only (`compareVersions`, `detectChanges`, `BinaryOperator`, `toMap`, `randomId`, etc.). Frontend/renderer code must import from this path (or a specific sub-path like `@apackdev/sdk/utils/compare-versions`), never from `@apackdev/sdk/utils`.

The freshness rule itself lives in `@apackdev/host/build/packages-built`, and everything that needs it imports it by that name: a relative import of a repo-root script would put the repo root into `@apackdev/testing`'s declaration emit and move every declaration its bundle publishes. `scripts/ensure-packages-built.ts` is only the command over it. The packages' build scripts live in the repo's `scripts/` for the same reason — `build-package.ts` (`@apackdev/ears` and `@apackdev/sdk`, which build alike) and `build-ui-package.ts` — so that no package's own `scripts/` imports a package above its layer, and the layer rule holds as written rather than through a re-export. `check:specifiers` (`findPackageScriptImports`) holds the other half: a package's own `scripts/` imports that package's `src/` and its declared dependencies and nothing else, because a module under the repo's `scripts/` belongs to no package — so `npm run spec` cannot route a change to it back to a spec that covers it, and a package reaching in there is a spec that will one day not run, reported green.

Relative imports in `@apackdev/ears`, `@apackdev/sdk`, `@apackdev/host`, `@apackdev/ui` and `@apackdev/testing` name the `.ts` source (`./query.ts`); tsc (`rewriteRelativeImportExtensions`) and tsdown write `.js` into the output. `npm run check:specifiers` (part of `npm run typecheck`) rejects relative `.js` specifiers there. Workspace tsconfigs that compile this source need `allowImportingTsExtensions`. Generated pack code (`generate-entries`) keeps `.js`.

When adding new utils, put pure functions in the appropriate file under `utils/` and re-export from `pure.ts`. Node-dependent code stays in the existing Node modules and is re-exported only from `index.ts`.

`@apackdev/ears`, `@apackdev/sdk` and `@apackdev/ui` each declare an exports map whose every entry resolves source under the `@apackdev/source` condition and `dist/` otherwise. **What they publish is that manifest derived, not that manifest**: `stagePublishTree` (`@apackdev/host/build/published-manifest`) writes `packages/<pkg>/publish/` at build time — the manifest without its source branches, without an entry a source branch was the whole of, and without `scripts`, beside a copy of what `files` names. A tarball ships no `src/`, and Node picks a matching condition and *then* requires the file, so a published source branch is a resolution failure for anyone who enables the condition rather than a fallback to `dist` — without the staging step the three maps name 99 files no tarball holds. `@app/publish-checks`' `published-manifest-paths` holds all five published trees to naming only files their tarball contains. **Two of the three maps are written, one is derived**, which is why only one has a staleness check: `@apackdev/ears` (3 entries) and `@apackdev/sdk` (31) list their exports by hand, so the map *is* the definition of public — a module nobody listed is private, and the first import of one fails at resolution with `ERR_PACKAGE_PATH_NOT_EXPORTED`, while `build-package`'s `assertExportTargetsBuilt` catches the other direction, an entry pointing at something that wasn't built. `@apackdev/ui` (69) computes its map from `src/` instead, since a component is public unless it is a spec or under `internal/`; that gives two things that can disagree, so `exports:check` compares them and `exports:update` rewrites the map. Adding a public module to `ui` means regenerating; adding one to `ears` or `sdk` means listing it. **A host config declares that condition outright; a pack's config declares none.** The host configs name it — tsconfig `customConditions`, Vite/Vitest `resolve.conditions`, esbuild/tsup `conditions`, `node --conditions` (the CLI bin's resolve hooks in source mode, the API process the app spawns from source) — and nothing infers it from an install. `npm run check:specifiers` fails a host config that omits it and a pack config that declares it. Two tables in `scripts/lib/import-source-conditions.ts` record the configs that do the opposite on purpose, each with its reason, and report an entry that has stopped applying: `RESOLVES_DIST_BY_DESIGN` (host configs resolving `dist`, such as the API Extractor tsconfigs) and `DECLARES_SOURCE_BY_DESIGN` (pack configs declaring the condition). The second is empty and meant to stay much the smaller of the two: it is for a host-side config that physically sits in a pack's tree, which is usually better moved out, and never for making a pack's own build work — that pack would then build unlike every pack author's, which is the failure the rule exists to prevent. Its doc comment has the full rule.

A pack — built-in (`packages/default-setup`), fixture (`tests/packs/*`) or external — is built and tested by `apack pack build` and `apack pack test`, which resolve the `@apackdev` packages' published `dist`: the one layout a pack author ever has. The app's own builds are host builds and compile that same pack's sources with the condition (`renderer/vite.config.ts`, `api/tsup.config.ts`), so in a checkout that `dist` has to exist and match the source beside it: `npm run packages:ensure` (`scripts/ensure-packages-built.ts` over `@apackdev/host/build/packages-built`) rebuilds it when `@apackdev/ears`, `@apackdev/sdk`, `@apackdev/ui`, `@apackdev/testing` or `@apackdev/cli` is stale, and `npm run typecheck`, `npm test`, `npm run build:default-setup`, `npm run typecheck:pack` and `npm run test:external-pack` all run it first, as `apack pack test` and `apack pack dev` do for a pack linked to a checkout. `@apackdev/testing` resolves its built bundle whoever loads it, the repo's own E2E included, so the fixture a pack runs is the one this repo runs. While `npm run dev` is running, the renderer and the API follow your `@apackdev` source edits live (both declare the condition), but everything `apack pack build` produced for the built-in pack — its compiled content, facade types, step build and content runtime — was made against `dist` as it stood when the command ran, and default-setup's own tsconfig declares no condition, so your editor type-checks it against that `dist` until something rebuilds it. `packages/apack-testing/CLAUDE.md` lists every entry point that does. Node commands that load workspace source run through `node scripts/with-source.mjs <command>`, which appends the condition to `NODE_OPTIONS` (`npm run test:e2e`, the api's `db:*` scripts); run Playwright through `npm run test:e2e -- <args>`, which carries the condition. The CLI and the API's dev boot fail when they would resolve a checkout's `dist` instead of its source. `npm run packages:build` writes `dist/`; `npm run exports:update -w @apackdev/ui` regenerates the UI exports map after adding or removing a module. To publish a `@apackdev/ui` component, add a `.ts` entry module next to it (`design/button.ts`: `export { default } from './button.vue'; export * from './button.vue';`) and run `exports:update`. TypeScript can't resolve an exports target that is a `.vue` file, so the entry is what consumers import. SFCs without an entry are internal: other `@apackdev/ui` files import them by relative path, and `exports:update` fails if code outside `@apackdev/ui` imports one.

When adding new EARS or FE exports, put them in the correct barrel. Tag exports only the host uses `@internal` and name them `_x`: the underscore is what makes the boundary checkable, so pack code importing one fails `check:specifiers` (and `apack pack build`, for an external pack). A pack that needs one needs it promoted to public API instead. After changing public exports, run `npm run api:update` in `packages/apack-sdk` (or `packages/apack-ears`, `packages/apack-ui`) and commit the updated `etc/*.api.md` reports. A UI component's props, emits, slots and exposed members are reported in `etc/<entry>.component.md`, so changing them needs `api:update` too. The pack-facing SDK exposes no `any` (`published-sdk-any.integration.spec.ts` fails when an export does; use `unknown` or a generic); `@apackdev/ears`, `@apackdev/sdk` and `@apackdev/ui` support TypeScript 5.7 and later (`packages/typescript-floor`; `ai` 7's declarations need it).

**Typed EARS types are change-controlled.** `apack-ears/src/{entities,runtime,typed}.ts`, `apack-sdk/src/types/{entities,sdk-entities}.ts` and the generated `PackShapes`/`EntityName` are a specified contract that editor completions depend on. Don't widen or rewrap them to make a call site compile; fix the call site (explicit shape, `EntityName` constraint, `untypedQuery` from `@apackdev/sdk/ears`). Read `packages/apack-sdk/TYPED-EARS.md` and follow its checklist, including checking completions, before any change.

### Data layer (EARS)

Custom entity-attribute-relation graph database (`@apackdev/ears`) on [elmdb](https://github.com/spankyed/elmdb) (`@apackdev/ears/lmdb`), a Rust engine over LMDB. The engine reads and writes the database itself and keeps no copy of it in memory: a write commits as it returns, and group commit makes it durable within a second (`durable()` and `transact(fn, { durable: true })` for sooner; see `packages/apack-ears/CLAUDE.md`, Persistence). A manifest's names are elmdb's: an entity type PascalCase, an indexed or required field lowerCamelCase, a relation kind or role snake_case.

- `createEarsEngine()` — an engine instance (the app creates one at boot; tests and tooling create their own)
- `query(type)`, `query.ids(ids)`, `query.all()` — queries (synchronous, do NOT await); `query` refuses a name that isn't a registered type
- `create(type, row)`, `upsert(type, { id, ...row })`, `write(id)` — writes (synchronous); a created row is the whole row (its fields, and its `id`/`createdAt`/`updatedAt` when it brings them), and must hold every field its shape requires — at compile time for a typed one, and at runtime for every write, the engine refusing an incomplete row (`REQUIRED_FIELD`), and a value its field's type doesn't take (`FIELD_TYPE`), from the row rules codegen reads off each pack's shapes; an entity type whose manifest declares a short code prefix (its entry's `shortCode`, three uppercase letters, unique across every pack) has `create` number every row `<prefix>-<n>`; its shape declares no `shortCode` (codegen refuses one), and `#generated/ears` types the field from the entry (`ShortCodeOf<'Thread'>` is `` `THR-${number}` ``); the short code is engine-owned — a row brings one only on import, as `<prefix>-<n>` held by no other entity, and nothing writes it after — so a code finds its entity with the typed query, `query(type).where('shortCode', code)`, which the value index answers, and `entityTypeOfShortCode(code)` (`@apackdev/sdk/services`, the registered packs' prefixes) names the type of a code whose type isn't known; `write` refuses an id no entity has, and every attribute write refuses the engine's own (`id`, `entityType`, `shortCode`, `createdAt`, `role`); a relation is not an entity, and its id is an `EARS.RelationId` that `write` refuses at compile time — `getRelation` and `findRelations` read relations, `updateRelation` changes one and `removeRelation` removes it
- `transact(fn)` — runs `fn` as one unit, elmdb's: undone and never committed when it throws
- `query(type).search(text, options?)` — the type's text index (its manifest entry's `search`), most relevant first;
  `near(vector)`, `like(id)` and `hybrid(text, vector)` rank by its vector index (`embed`), whose changed chunks wait,
  unfound, until `embedPending()` (`@apackdev/sdk/services`) embeds them through `services.inference`; `hits()` answers
  scores and highlights (`packages/apack-ears/CLAUDE.md`, Search and Vector search)
- `watch(read, observer)` — runs a pure read of the engine again after every commit that wrote into what it read
  (elmdb's tracked reads), delivering each changed result with the commit's sequence (`lastCommit()`)
- Repository pattern: a feature's `be/repository/index.ts` exports `<name>Queries`/`<name>Commands` objects (usually from `queries.ts`/`commands.ts`), declared in `apack.json` `features.<id>.repositories` as `"path#export"`; code reaches them through `repository` from `#generated/repository`
- A pack's repository can expose another package's repository methods (default-setup's `actionQueries.byId` is the SDK's `actionRepository.byId`), so its code reaches its data through `repository` alone. It takes them by reference (`byId: actionRepository.byId`), never wrapped in a function that re-declares the signature, and adds its own views beside them
- Each entity's repository lives with the package that declares it: the SDK's entities' in `@apackdev/sdk/repositories`, a pack's in its features, the host's `AppState` in `@apackdev/host/app-state`. No package reads another's repositories through a cast of the registry, and nor does a pack: `repository as unknown as` is the `repository-casts` pack rule, so `apack pack validate`, `build` and `test` refuse it for any pack and `check:specifiers` (`findRepositoryCasts`) for this repo's packages. The generated facade is exempt, being this cast by design

### Frontend surface system

Each surface registers: `id`, `label`, `icon`, `state` (XState machine), `canvas` (required), `panel` (optional). Surfaces are spawned on demand by the application actor. State selectors use `useSelector` from `@xstate/vue`. Surface machines and views live in `packages/default-setup/src/features/<name>/fe/`. A component reads its feature's data with `useView` (`#generated/fe`, typed by the feature's `views`): a live read the backend runs again after every commit that changes its result, sent to that window alone; a surface drawn in several areas follows its views from its machine with `fromView` instead, and asks for what it starts from on `SURFACE_STARTED`, the one startup event that arrives in a delivery naming it. Presentation and binding targets are declared in `apack.json` `features.<id>.surface`: `generate-entries` assembles them into `src/__generated__/pack-entry-fe.ts`, which `apack pack build` bundles into the pack's `dist/runtime/fe.js`. **Every** pack's frontend is loaded from `pack://<id>/runtime/fe.js` by the shell, the one the app ships included; a dev server serves it from that source file instead (`virtual:dev-pack-frontends`), which is what makes a `.vue` edit patch the component.

### Key patterns

- **An event either carries data or asks for it, and exactly one asks.** A system handles `SEND_STATE` by broadcasting what its surface starts from. The bus sends it after every fact that could have changed what a system holds — a client connected, a pack changed, the data was replaced, systems were spawned — so a system wires publishing once instead of once per cause, and a new cause costs it nothing. It is sent after the fact, so a system drops work held over rows that are gone before it describes itself, and only once a client has connected, since entering `clientSeen` asks everyone anyway Frontend-bearing packs wait for acknowledgment of their current runtime before startup and state-publication requests; pack/data facts still reach their systems.
- **A fact is for what publishing cannot fix, so handling one means a system does something special.** `CLIENT_CONNECTED` (the brain remembers frontend readiness; threads records sent commands), `PACK_CHANGED { packId }` (runtime lifecycle notifications; Help and Settings follow committed declaration changes directly), `DATA_REPLACED` (the brain kills a flow running over rows that are gone). Every other system handles none of them. A client connection reaches the systems of any pack with frontend code — the ones the app ships included — once the renderer has loaded that frontend (`bus.packClientReady`), and again when its subscription reconnects
- When a feature's settings change (any way: a setting, the settings replaced or reset, a pack's defaults), the app's settings system (`host/settings`) sends its system `FEATURE_SETTINGS_UPDATED { settings, changes }` and its surface `FEATURE_SETTINGS_UPDATED { settings }`. The SDK declares it for every system (`SystemEvents`) and surface (`SURFACE_EVENT_TYPES`), so no pack does, and the bus drops one to a feature running no such actor without a warning
- Use `safeEvents<ReceivableEvents>()` for typed event handling
- Use `breadcrumb()` / `breadcrumbWithParams()` for surface navigation
- Frontend components should be "dumb" — emit events up to root components which forward to the surface state machine

### App environment

**Runtime environment and data paths come from one resolver**: `@apackdev/sdk/env`'s `resolveAppEnvironment({ env?, userDataDir? })`. Those are two axes and one word was doing both jobs — `APP_NAMES[env]` decides the app name, the URL scheme and so Electron's own storage, while the same value decided *where* the data went, as a default a profile overrides. Don't read `NODE_ENV`, `PLAYWRIGHT_TEST` or platform paths to decide which data dir to use.

`APACK_ENV` and `APACK_USER_DATA_DIR` are the **handoff**, not the selector: how a parent process tells a child what it is and where its data is. `--host`/`APACK_HOST` is what a person types, and the two are deliberately different names — collapsing them would put the choice and the answer under one word, which is the confusion the resolver exists to end.

- The log directory is the one app path the resolver doesn't give you: only the Electron process can ask the platform for it. `packages/main/src/app-environment.ts` resolves it once — `app.getPath('logs')`, or `<userDataDir>/logs` when the run was given its own data dir — and hands it to electron-log, to the API (`APACK_LOG_DIR`) and to the IPC that opens the log file, so none of them decides it for itself.
- The Electron main process infers the environment once at startup (`packages/main/src/app-environment.ts`): Playwright → `test`; packaged builds → the channel from `build/build-metadata.ts` (`production` | `beta` | `preview`; an unstamped packaged build refuses to start); source runs → `APACK_ENV` if set, else `development`. It passes `APACK_ENV` and `APACK_USER_DATA_DIR` to the API process. `npm run build:preview -- --version 0.4.0` creates a local unsigned preview with separate data and shared main/API version metadata; see `docs/references/preview-builds.md`.
- Anything started without them throws instead of falling back to production. Manual API boots must pass both, pointing at a copy of user data: `cd packages/api && APACK_ENV=development APACK_USER_DATA_DIR=<copy> NODE_ENV=development API_PORT=3099 SHIPPED_PACKS_DIR=$PWD/.. node ../../scripts/with-source.mjs node dist/server.js`. Such an API makes up its own token and writes it to `<copy>/api-token`; send that to call it.
- The API takes calls only with a token. Electron main creates one per app run and passes it to the API (`APACK_API_TOKEN`); an API started without one makes up its own; the app's windows read it through the preload (`api:token`) and send it when connecting, and in development (or when it made up its own) the API writes it to `apiTokenFile` for local tools (`apack pack dev`, default-setup's watcher), which send it in `API_TOKEN_HEADER`. That header and the address the API listens on (`API_HOST`, `127.0.0.1` only) are defined once, in `@apackdev/sdk/utils/pure`, so the renderer's client uses the same ones.
- CLI commands pass `{ env }` explicitly (`install`/`uninstall`/`list`/`open` default to production; `--profile` selects storage; installed-app commands use `--channel`).

### Migrations

**A migration declares which version line it is on, and nothing infers it.** A pack files each one in
`apack.json` under `migrations.app` or `migrations.pack`, keyed by the version it targets — because a bare
version does not say what it is a version of. The manifest entry declares its description and `up` export target; the module exports only `up()`.
Codegen assembles the `PackMigration { target, … }` the
runners take from the manifest key, so a version is written in exactly one place and the line in exactly
one. There is no `src/migrations/index.ts` — the manifest is the list.

Migrations live with their pack and are declared in its manifest or native composition data. Native app-line
migrations use the app version; native pack-line migrations require the pack's own declared version.
The host and default-setup currently declare none.
`@apackdev/host/migrations` supplies runners used at boot, reset and backup import. Historical settings
conversion is removed; the current settings contract applies throughout normal runtime behavior.

- `runAppMigrations(registry)` — every registered pack's `app`-line migrations, run when `stored app version < target <= app version` (`getAppVersion()`, the bound runtime's); records `AppState.version`. A prerelease counts as its release (`0.4.0-beta.2` runs the `0.4.0` migrations, again on each new beta), and a development build (`APACK_ENV=development`) runs every pending migration on every boot. A failed migration stops the rest and records nothing, and `startPacks()` then runs no pack migration or apply; the next boot retries. Data with no recorded version is new and at the app version.
- `runPackMigrations(targets)` — every registered pack's `pack`-line migrations, against that pack's own version (`stored < target <= manifest version`); records `AppState.packVersions[packId]`.

Both read `registry.packMigrationTargets(line)`, so **neither asks where a pack came from**: a pack the app ships may be on either line and so may an external one. Routing on provenance instead is the trap — it makes one `0.4.0` mean the app's release in a pack the app ships and the pack's own version in every other, so a user's build installed at a shipped pack's id has its migrations compared against the wrong thing.

Rules for default-setup migrations (details in `packages/apack-host/src/migrations/CLAUDE.md`):

- **Target the next release version** — name the file after the version it targets (e.g. `0.2.4.ts` runs when the app is released as 0.2.4+). Several changes for one release go in the same file.
- **Never bump `package.json` version manually** — the release process handles version bumps. Migrations are written ahead of time to target the upcoming release.
- **Declare it in `packages/default-setup/apack.json`** under `migrations.app`, keyed by that version; `apack pack add migration <version> --app` writes the entry and the file, and `npm run build:default-setup` regenerates the pack entry. A pack whose data moves when the pack does uses `migrations.pack`, which is that command's default.
- **Idempotent guards** — always check if the change is needed before applying (e.g. `if (!value) set(value)`), since migrations run again on every development boot, on each beta of their release, and after a reset.

### Path aliases

- API imports use file-relative paths, so its workspace type entry resolves from source in other packages.

## Tech stack

XState v5 (state machines everywhere), tRPC v11 (typed RPC), Vercel AI SDK 7 (model calls through `services.inference`: Anthropic, OpenAI, Google, Groq, Mistral, Cohere), Zod (validation), Vue Flow (node-based editor), Monaco Editor, Tiptap (rich text), xterm.js + node-pty (terminal), elmdb on LMDB (persistence), Vite (bundler), Oxlint + ESLint (linting).
