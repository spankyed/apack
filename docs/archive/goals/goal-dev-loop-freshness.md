> **Written in session** `36f122d9-3a1e-40ef-988d-40b2574fc098` (Claude Code, 2026-09-18). Resume it with
> `claude -r 36f122d9-3a1e-40ef-988d-40b2574fc098`.

Status: completed 2026-11-04 on `session/dev-loop-freshness`, with the ears watch in
[#338](https://github.com/spankyed/apack/pull/338). The [Outcome](#outcome-2026-11-04) owns closure. The survey
below is dated 2026-11-03 at `1b69d15677` and describes the code before this work.

```text
# Goal: a package edit during a dev session refreshes that package's dist, and costs only what it affects

Implement docs/archive/goals/goal-dev-loop-freshness.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Current handoff, Decisions, Phases and Constraints before continuing.
The survey was made at 1b69d15677 on master; inspect current code before relying on it.
Decision 1 is the owner's and blocks Phase 2. Phases 1, 3 and 4 do not wait for it.
Follow the current checkout arrangement and preserve unrelated work. Phase 1 needs its own worktree.

Finished when:
- Every row of the acceptance table is met on current source, with its evidence recorded.
- Focused watcher specs and npm run chain pass; the chain includes test:native for this code.
- packages/apack-testing/CLAUDE.md and root CLAUDE.md describe the resulting behaviour.
- Record Outcome, archive the goal, repair links and commit closure.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
```

## Scope and background

**Outcome:** while `npm run dev` or `apack pack dev` runs, editing a source of a published `@apackdev` package
brings that package's `dist` up to date on its own, at a cost proportionate to what the edit affects.

**Why `dist` matters during a session.** `packages/default-setup/tsconfig.json` declares no condition, because it
is a pack config, so the editor and every pack build read the packages' `dist`: at `1b69d15677`,
`ts.resolveModuleName` under that config lands `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/ui/design/button`
in `packages/apack-*/dist/*.d.ts`. An SDK type edit stays invisible there until something rebuilds `dist`.

**Out of scope:** pack descriptor, codegen and catalog freshness. Each watched rebuild publishes one complete
verified build, and a failed one retains the accepted build (`startPackBuildWatcher`, `publishPackBuild`), which
is what the completed [discovery work](../plans/discovery-without-activation.md) required
([closure](goal-settings-and-pack-contracts.md#outcome-2026-10-19)). This goal must not weaken that.

### What runs today

| Loop | Follows | Where |
|---|---|---|
| Renderer Vite server | `@apackdev/*` source and pack frontends, through the `@apackdev/source` condition | `packages/renderer/vite.config.ts`, `virtual:dev-pack-frontends` |
| API `tsup --watch` | `packages/api/src`, `apack-host/src`, `apack-sdk/src`, then main restarts the API child. **Not `apack-ears/src`, though the bundle inlines ears** (Decision 4) | `build:dev:watch`, `packages/api/package.json`; `packages/main/src/modules/api-server/dev-reloader.ts` |
| Pack watcher | The pack's authored inputs and compiler inputs, including its workspace dependencies' files | `apack pack build --watch` (forked by `packages/dev-mode.js`) and `apack pack dev` (`commands/dev.ts`), both `startPackBuildWatcher`, `apack-cli/src/build/watch.ts` |

### How a package edit reaches `dist` today

Every `createPackBuilder().build()` calls `ensureCheckoutPackages(root)` first, and again for the CLI's own
checkout when it differs (`apack-cli/src/build/build-process.ts`), which runs `npm run packages:ensure` in that
checkout. That covers a one-shot build, `npm run dev`'s startup, and every watched rebuild in both sessions, and it is a no-op
for a pack whose packages are installed. So the ensure is per build, not once at startup, and any edit
that reaches the pack watcher refreshes every stale unit.

Whether an edit reaches it was probed read-only at the surveyed commit, running `compilerWatchPaths`,
`compilerWatchTargets` and `createCompilerWatchMatcher` on `packages/default-setup` (a change event on an existing file):

| Edited | Pack watcher fires |
|---|---|
| `apack-sdk/src`, `apack-ears/src`, `apack-ui/src`, `apack-host/src` | yes |
| each of those packages' `dist`, and `apack-cli/dist/package` | yes |
| `apack-testing/src`, `apack-cli/src` | **no** |

Which units an edit makes stale comes from `BUILD_UNITS` (`@apackdev/host/build/packages-built`), which holds five:
`@apackdev/ears`, `/sdk`, `/ui`, `/testing`, `/cli`. The last two inline the shared-instance packages and host from
source, so:

| Source edited | Stale units |
|---|---|
| `apack-ui/src` | ui |
| `apack-sdk/src` | sdk, testing, cli |
| `apack-ears/src` | ears, testing, cli |
| `apack-host/src` | testing, cli (and ears, sdk and ui for the `src/build` modules `compiled()` names) |

**Read from source, not observed:** no dev session was run for this survey. Three consequences follow from the code and
Phase 1 must confirm them:

- **An SDK edit costs a complete pack build, probably two.** `publish()` records the signature taken before
  `ensureCheckoutPackages` rewrites `dist`. The signature covers `dist`, so the check after the build differs and asks for another run,
  and that run differs from the recorded signature too.
- **An SDK or ears edit replaces the compiler.** The CLI bundle is the compiler (`compilerPackageDirectory`) and it
  inlines both, so its identity moves and the builder captures a new installation.
- **A held lock recovers without another edit.** A `freshness` build waits up to `LOCK_WAIT_MS` for a live holder and
  rechecks. Past that bound the error is logged and the holder's eventual write to `dist` fires the watcher again.
  A holder that writes nothing needs a later edit.

### Readings

Taken 2026-11-03 at `1b69d15677`, load average 7 to 10, on the developer's Mac, under `tsx` with the source condition:

| | |
|---|---|
| All five units' fresh check through one `freshnessSweep`, inputs and output digests, against scratch stamps | 82ms median of 9 |
| Distinct non-prose input files across the five units | 775 files, 5.0MB |
| One cold `compilerWatchPaths` on default-setup, a single sample | 19.0s, 53,817 paths, 27 subscriptions (9 recursive) |

The first row is why the check is not the cost to optimise, and the last is why a pack-watcher pass is not
cheap: `publish()` calls `refreshInputs` before and after each build, reusing only the tooling half of that read.

Not measured: `npm run packages:ensure` (this checkout has no `node_modules/.cache/apack-packages-build`, so it would
have rebuilt all five under other sessions), `build:package` and `apack pack build` for default-setup, for the same
reason. Phase 1 takes them in a worktree.

## Outcome (2026-11-04)

A package edit during a session now refreshes the `dist` it made stale and runs at most one pack build. The readings
are in [the evidence record](../references/evidence/dev-loop-freshness-2026-11-04.md).

- **Double build:** removed. A watcher pass runs the ensure before it reads its inputs, so a rewritten `dist` is in
  the signature it compares. The frontend watcher no longer counts an unread file's new bytes or a package build's
  writes as a change, because those events can arrive long after that signature.
- **Coverage:** every `BUILD_UNITS` input of the pack's and the CLI's checkouts is watched.
- **Failed and idle passes:** a refresh with its inputs and outputs unmoved spawns nothing and repeats any failure,
  which ended a retry loop that ran about every 45 s with no edits.
- **Early cutoff (skipping the pack build when a refresh leaves `dist` unchanged):** closed, not built. A pack build
  is slow enough to interrupt work, at 84 to 99 s alone and about 150 to 260 s from save to publication at load 7 to
  17, so the first condition for building it is met. The second is not: only 4.4% of recent commits to these
  packages' source changed nothing but comments or blank lines, and any other change moves `dist`. Most of the time
  before a build starts is the watcher's input read, which is a better place to look if this cost matters later.

**Unproven or left open:**

- Missed file events under load remain, and one leaves `dist` stale until the next edit. Four edits were lost in one
  session here. Their cause is not proven, because no independent watcher ran beside them.
- `test:linux`'s prep timed out three times here at 600 s under load, and a killed prep leaves a
  `packages/default-setup/.apack/build.lock` that makes the next run wait.
- The readings are from a busy machine, with one sample each.

## Acceptance

| Requirement | Result | Evidence |
|---|---|---|
| Editing `@apackdev/ears`, `/sdk` or `/ui` source during a session rebuilds that package's `dist` on its own, within a few seconds | Met, at 6 to 19 s from the event, on a busy machine | Evidence record |
| ~~It does so without a full build of the shipped pack~~ | Withdrawn by Decision 1: a package edit that moves what the pack builds against costs one complete build | `watch-package-edit.native.spec.ts` counts one build |
| The trigger is derived from `BUILD_UNITS`, so a unit's new input needs no second edit | Met | `packageInputWatchPaths`, `compiler-watch` specs |
| A build failing mid-edit leaves the session running, and the next save retries | Met, observed | Evidence record, broken-build rows |
| A held build lock leaves the session running and refreshes `dist` without another edit | Met for a holder that writes `dist`, observed | Evidence record, lock rows |
| The same holds for `apack pack dev`, and an installed pack starts no package build | Met through the one watcher; `dev` itself was not run | `checkout-packages.spec.ts`, specs for an installed pack |
| `packages/apack-testing/CLAUDE.md` says what happens | Met | That guide, root `CLAUDE.md`, `packages/apack-cli/CLAUDE.md` |

## Decisions

1. **Decided by the owner: withdraw the requirement.** One complete build per package edit that moves what the pack
   builds against, with the second build removed. The options as they stood: the required outcome said no
   full pack build, on the reasoning that its time is not worth what it refreshes. Every firing edit got one,
   which does keep the facade, compiled content and step build current during a session.
   - **Keep the requirement.** A package edit runs the ensure, and the pack rebuilds only if its accepted build is
     affected. The saving is largest for `@apackdev/ui`, which replaces no compiler. For the SDK and ears it needs a
     ruling on whether a moved compiler identity alone rebuilds, since that identity conservatively says the output
     came from another compiler. `dist/build-inputs.json` records what a build observed and is a candidate for the
     test (hypothesis, not established). Costs the most code, and it touches the freshness barrier discovery relies on.
   - **Withdraw it.** Accept one complete build per package edit, fix the second build, and record why. Least
     code, keeps everything coherent, and costs a full pack build per save of SDK or UI source; Phase 1 prices it.
2. **No second watcher over the same sources.** A separate package watcher beside the pack watcher would fire on the
   same edit and contend for the same lock, with two publishers for one `dist`. New triggers join `startPackBuildWatcher`, whose `coalescingRunner` already debounces to idle (300ms), runs one
   pass at a time and collapses mid-run edits into one further run.
3. **Freshness goes through the one rule.** No `tsc --watch` or `tsdown --watch` per package: that is long-running
   toolchains rebuilding on every save whether or not anything reads the output. `stalePackageUnits` decides and
   builds only what is stale. Reaching it through `npm run packages:ensure` stays: `ensureCheckoutPackages` serves a
   pack whose checkout need not be the CLI's own, and a build spawns `npm run build:package` regardless. The stat-before-hash
   proposal stays rejected; the comment on `fingerprintInputs` holds its measurements.
4. **Decided by the owner: add ears to the API watch**, in [#338](https://github.com/spankyed/apack/pull/338).
   `build:dev:watch` named `apack-host/src` and `apack-sdk/src`, and the API bundle inlines ears, so a backend ears
   edit reached no running API.

## Phases

### Phase 1 — observe the loop

- **Deliverable:** a dated reading of what an edit costs, replacing the "read from source" claims above, in
  `docs/references/evidence/`.
- **Dependencies:** a linked worktree (`npm run session:new -- <name>`), which has its own `dist` and profile.
- **Done when:** with `npm run dev` running there, one edit each to `apack-ui/src`, `apack-sdk/src` and
  `apack-ears/src` is recorded with units rebuilt, pack builds run, and time until `dist` is current and until the
  pack is published; plus one mid-edit build failure and one lock held from another terminal. The cold `packages:ensure`,
  each `build:package` and the pack build are timed with date and load.

### Phase 2 — the package-edit response

- **Deliverable:** one package edit produces the pack builds Decision 1 chose, and never a second caused only by the
  ensure rewriting `dist`. The fix for that second build applies under either answer.
- **Dependencies:** Decision 1; Phase 1's reading.
- **Done when:** a native watcher spec against a fixture counts builds for a package edit, and fails when the second
  build returns. Discovery's guarantees hold: a descriptor-affecting edit still publishes coherently, and a failed
  rebuild retains the accepted build. Phase 1's scenario is re-run and recorded.

### Phase 3 — coverage from `BUILD_UNITS`

- **Deliverable:** an edit to any `BUILD_UNITS` input of the checkout the pack builds against requests a pass, with no
  second list. Outputs stay excluded, as they are in the fingerprint.
- **Dependencies:** none; the pack's checkout (`checkoutFor`) need not be the CLI's, whose `REPO_ROOT` `BUILD_UNITS` is
  built on, so settle which units apply first.
- **Done when:** a spec adds an input to a unit in a fixture and an edit there requests a pass; `apack-testing/src`
  and `apack-cli/src` edits fire on the real tree; a pack with installed packages subscribes to nothing extra.

### Phase 4 — the record

- **Deliverable:** `packages/apack-testing/CLAUDE.md` states the current behaviour, and root `CLAUDE.md` agrees.
- **Dependencies:** Phases 2 and 3 for the final wording. The purely wrong statements can be corrected first.
- **Done when:** the doors tables (four fixers, four checkers) match the doors that exist, naming the watched rebuild as door 3's
  trigger, and these are corrected:
  - Door 3's `commands/{build,test,run}.ts`: the callers are `build/build-process.ts`, `commands/test.ts` and
    `commands/drive.ts`.
  - "A fixer belongs to the command a user runs… `build()` stays clean", and its claim that
    `checkout-packages.spec.ts` pins that placement: the refresh is per builder build, and the spec's own comment says so.
  - `apack pack build --skip-fe` as `npm run dev`'s launcher: it runs `apack pack build`.
  - "built-in packs' backends are bundled into the API": a pack's backend loads from its installed build.
  - "Frozen at the moment the command ran… nothing rebuilds them while the app runs", and the following paragraph's
    claim that the editor stays stale during a session.
  - The matching sentence in root `CLAUDE.md` ("While `npm run dev` is running…").

## Constraints

Work that rewrites `dist` or launches the app goes in its own worktree while other sessions share the main checkout.
Native and live-watcher specs run through `npm run chain` or `npm run test:linux -- <command>` on a Mac.
