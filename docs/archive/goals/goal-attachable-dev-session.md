> **Written in session** `75ab9455-5ee8-4b50-8043-6d5f22284a4a` (Claude Code, 2026-10-09). Resume it with `claude -r 75ab9455-5ee8-4b50-8043-6d5f22284a4a`.
>
> **Done and closed** (branch `AS/attachable-dev-session`). All seven phases implemented and committed, and
> the three claims Phase 5's Done-when left standing on nothing are closed — the idle reap is built, the
> `apack test` claim has a gated case, and the install hint has a firing one (*Closing the three Done-when
> gaps*, at the foot). The Outcome has what each phase settled and the measurements. Two corrections the
> work found and fixed: `APACK_ENV` must not collapse into `APACK_BUILD`, and `--fresh` on the one-shot
> path resolved the wrong data dir, because "which data dir" had two answers and nothing made them meet.
> The text below is the goal as written, corrected in place where the work found a decision wrong.

```
# Goal: dev holds the app, drive attaches to it — and the two words stop colliding

Implement docs/goals/goal-attachable-dev-session.md on the current branch, at or after 3d5b21d45 — the base its
Background was surveyed at.
Before Phase 1, confirm the base: packages/apack-cli/src/app/instances.ts, src/commands/instances.ts,
src/app/app-target.ts's parseAppFlags, and packages/apack-testing/src/engine/{server,marker,session}.ts
all exist at HEAD. If they don't, stop and say so — the plan was surveyed somewhere else.

Read Background, Decisions, Phases and Constraints first, then the three plan docs they cite:
docs/plans/profiles-not-instances.md, one-storage-axis.md and attachable-dev-session.md. Those hold the
detail; this doc holds the order, the decisions and the stop condition. Decisions are final: implement
them, don't reopen them or stop to ask.

Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — a standing rule,
not this goal's choice): change signatures, move modules, migrate every in-repo caller, test, fixture,
template and doc in the same change, and fix forward. Stored user data would be the exception, and there is
none here: the one on-disk thing this renames is the profiles directory, which carries disposable dev data
and is **not** migrated (Decision 2).

Finished when:
- Phases 1-7 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- `--instance`, `--ephemeral`, `--app` and `--app-root` name nothing in the CLI; `--profile`, `--fresh`,
  `--fresh --rm` and `--build` do. No profile is named after a build.
- `apack dev` exists, `apack run` does not, and `dev` runs in a checkout with no pack.
- **If and only if Phase 6 ran** (its measurement is the condition): drive's `--serve`/`--attach` are gone
  with apack-testing/src/engine/{server,marker}.ts and apack-cli/src/app/drive-{engine,one-shot}.ts. If
  it did not, this goal is still finished, and the Outcome says so with the number that decided it.
- A live `dev` or `npm start` publishes <dataDir>/session.json; `drive` attaches to one, refuses when
  there is none and starts one with `--spawn`; `apack test` publishes none.
- The debug port is on in `development` only, and a spec fails if a packaged or test context gets it.
- Decision 8's lock question is settled by observation, and all three places say the same thing.
- `npm run typecheck`, `npm run spec` over each touched package, `npm run chain`, plus `npm test -- smoke`
  and a real `apack dev` with `drive --eval` against it.
- Every `drive` path says whose app it joined, or what it started and how to end it; `apack profiles`
  shows which data dirs have a live app; cli.md carries the "Which app, and how long it lives" table.
  The attach plan's "Telling the user" is the spec for all three.
- A final summary: phase -> done/deferred, evidence, and the conventional choices made.
- The three plan docs and this doc are in docs/archive/plans/ and docs/archive/goals/, each with its
  status blockquote, this doc with an Outcome section, committed.

Commit as you go: each phase when its "Done when" holds and the checks are green, conventional message,
no Co-Authored-By or session lines, `git commit -- <paths>` naming only that phase's files. Check
`git diff --cached` first — another session stages files in this checkout.

Never:
- the standing list in Constraints (git and publishing, real data dirs, broad process kills, preload,
  example pack, release metadata, typed EARS, compat shims, loosened assertions).
- enable the remote debugging port anywhere but a `development` build.
- delete the Playwright test runner or the `drive/` script path: `drive <script>` stays a Playwright run.
- rename `apack build`, or give it a build flag.
```

## Background (2026-10-09, at 3d5b21d45 on master)

Three commands launch the app and each owns the one it launched. `run` is a supervisor plus the pack
watch/rebuild/reload loop and a Vite dev server; `drive` launches its own app through Playwright's test
runner, because Electron allows one app per data dir and `run` already has it; `test` launches its own
hermetically. `drive --serve` exists to work around that — an HTTP server, a token, a file in
Playwright's `outputDir`, a ready-line protocol and a `/close` verb, so that one app survives between an
agent's questions.

Underneath it, one word does two jobs. `resolveAppContext` (`packages/apack-sdk/src/env/index.ts:107`)
derives an app's **identity** from `env` (`APP_NAMES[env]`, which decides the app name and so Electron's
own storage) and its **location** from the same value, as a default that `APACK_USER_DATA_DIR`
overrides. They come apart for every instance, every drive session and every E2E worker, and the CLI
already selects them two different ways: `-d`/`-b` name a *data dir* on `db`, `install`, `list` and
`uninstall`, while `--app beta` names a *binary* on `run`, `drive` and `test`.

The three plan docs hold the detail, the measurements and the rejected alternatives:

| Plan | What it is |
|---|---|
| [`profiles-not-instances.md`](../plans/profiles-not-instances.md) | the rename, no behaviour |
| [`one-storage-axis.md`](../plans/one-storage-axis.md) | `--build` and `--profile`, two axes two words |
| [`attachable-dev-session.md`](../plans/attachable-dev-session.md) | `dev` publishes, `drive` attaches |

## Spike results (2026-10-09)

Recorded in full in [`attachable-dev-session.md`](../plans/attachable-dev-session.md) ("The spike"). The
spike code is thrown away; everything a phase needs is in that table. The row that decides the design:
**reconnect after a full disconnect, 11ms, pages still live** — a launched Playwright `Page` dies with
its window, where a CDP client re-attaches, which is why a long-lived session rots and an attachable app
does not.

Not covered by the spike, so a phase proves each: `--spawn` under contention, the idle timeout, the
environment gate, and the end-to-end cost of a one-shot.

## Decisions

Final.

1. **Three changes in this order: rename, then attach, then vocabulary.** The rename comes first, because
   it gives `--profile` its name before the attach work changes what that flag *means*. The vocabulary
   change goes **last**, which is a correction: it sat third of seven, and nothing in the attach work
   reads a build — the session file is `<dataDir>/session.json`, the reclaim is per data dir, the idle
   reap is per profile — while it is the one phase that reopens `-d`/`-b`. Third, it could block the
   goal's own content behind a flag argument; last, it blocks nothing. The cost of moving it is that the
   `development`-only debug gate is written against `resolveAppContext`'s current signature and then
   once more against the new one — **one call site, one line**, which the attach plan's Security section
   already commits to ("one call site, one gate"). Accepted.
2. **`instance` becomes `profile`** throughout — flag, command, module, directory — and `--ephemeral`
   becomes `--fresh --rm`. **No migration of the old directory**, on the user's instruction: a one-shot
   rename is the kind of code nobody finds to delete later, and a profile is a disposable data dir by
   definition (`profiles.ts`' own first line). The cost is stated rather than handled — dirs under
   `<cli data>/instances/` are not listed or opened any more, and a developer who wants one moves it.
3. **`--build` replaces `--app` and `--app-root`, as one flag.** A value in the known-name set is a
   build, anything else is a path. "Channel" is rejected: `development` and `test` are not releases.
   `APACK_APP` and `APACK_ROOT` collapse the same way, into one variable holding either shape.
4. **`-d`, `-b` and `--production` stay, as `--build` shorthands** — `--build development`,
   `--build beta`, `--build production` — on every command that has them today. They keep working and
   change what they *mean*: a build rather than an environment.
5. **No profile is ever named after a build.** The four environments do not become built-in profiles;
   a build keeps its own default storage, and `--profile` is the only override.
6. **`apack build` keeps its name and gains no build flag.** `compile`, the only alternative, collides
   with `compilePack`, the content-compile step inside a build.
7. **The Playwright test runner stays**, and so does what it launches (Decision 15). `drive <script>`
   goes on being a Playwright run;
   `playwright-core` and `@playwright/test` are both optional peers of `@apackdev/testing`, imported
   lazily, with an install hint.
8. **What scopes Electron's single-instance lock is settled by observation, not by picking a doc.**
   `packages/main/CLAUDE.md` says the app name, `apack-cli/src/commands/drive.ts` says the data dir,
   and `SingleInstanceApp.ts` says "them". Determine it — two apps with the same name and different data
   dirs, then the reverse — and make all three say the same thing.
9. **No commits are squashed across phases.** A phase is separable only while it is finishing.
10. **What `--spawn` starts *is* `dev` — the same code path, watcher and all — never the Playwright
    fixture.** Two reasons, and the second is why "spawns it as `dev` does" was not enough. (a) `appLaunchEnv` sets
    `PLAYWRIGHT_TEST = 'true'` unconditionally (`apack-testing/src/launch-env.ts:16`), which
    `_inferElectronAppEnv` answers `test` to — so a fixture-launched app can never be `development`, the
    environment gate would refuse it the debug port, and it would be unattachable. Nothing the app can
    see distinguishes a `drive` app from an `apack test` app, so there is no second axis to gate on.
    (b) **The fixture is also the only thing that installs the pack under test.** With `PACK_DIR` set it
    builds the pack and installs it into the data dir (`apack-testing/src/index.ts:357`), which is
    exactly why `drive` does none of that itself (`drive.ts:477`: *"No build here: the fixture builds the
    pack itself"*). A spawn that copied dev's *environment* would hand a pack author an app without
    their pack, or with a stale copy of it. `dev` already does it — `installToApp` (`run.ts:61`, called at
    `:259`) is the pack install, and `ensureCheckoutPackages` beside it is the different job of building
    the `@apackdev` packages' `dist` that a pack compiles against — so spawning `dev` gets both for nothing.
    **No `dev --no-watch`.** A flag whose only purpose is to let one caller skip a step is the thing that
    drifts, and a watcher costs nothing while nothing is edited. It also keeps the "session file's writers
    are derived, not listed" population at the two the design already has, `dev` and `npm start`, rather
    than a third that nobody would think to look for.
    **Two things this requires of `dev`, and the first is a restructure rather than a flag.** `dev` gains a
    **launch-and-hold core**, with the whole pack loop conditional on there being a pack: today
    `findPackRoot` (`run.ts:156`) throws at a checkout root, so without this Decision 10 leaves this repo's
    own `npm run drive:eval` able to attach and unable to start one. With no pack, what is skipped is the
    build, `installToApp`, the watchers, the reload path, the Vite server and the `pack-dev-servers`
    marker — six things, not a branch — leaving the launch, the session file and the hold. **That is a new
    decision, not a reading of the attach plan's design block**, whose "the supervisor it already is"
    affirms the existing supervisor and is describing the delta from the engine (no HTTP, no engine, no
    Playwright) rather than a core with the pack work removed. The Files table is the accurate description
    of the work. Second, `--spawn` **spawns `dev` detached** (`.unref()`), because `dev` never returns and
    its own teardown closes the app it holds; the attach plan has both, with the signalling rule.
11. **`--spawn` with no profile named starts the `development` app, and `dev` reclaims one a tool
    started.** (With `--profile` it starts one there instead, and that one is reapable — Decision 12.)
    When an app *is* asked for, it is the developer's own data rather than a blank one, because a blank
    app cannot answer most of what `drive` is asked, and because `drive --eval` should keep one meaning
    rather than one per
    whichever app happened to be up. (Whether an app is started at all is Decision 16's: it is not, unless
    asked.) What makes starting the development app safe is
    the reclaim: on the development dir, `dev` reads the session file and, for `startedBy: drive`,
    SIGTERMs its `supervisorPid`, waits for exit and launches, saying what it took; for `startedBy: dev` it refuses
    as today, because a person's app is not a tool's to take. Without it an agent's one-shot would hold
    the dir and the developer's `npm start` would fail, blaming itself.
12. **The idle reap keys on `startedBy: "drive"` and a dir that is not `development`** — so it takes any
    profile a spawn used, whichever its name. The development app is exempt because it is the one somebody
    may be looking at, and a reclaim is what ends it instead (Decision 11). **Stating the key this way is a
    correction**: "a profile `drive` was asked to use" and "the `drive` profile" are different rules, and
    under the narrow one a `--spawn --profile myproject` app is reaped by nothing and reclaimed by nothing —
    the reclaim is per data dir, so `dev` would have to be pointed at `myproject` — which is the
    leave-a-process-behind problem Decision 16 exists to prevent, back on a non-default path.
    So **`--profile drive` is a convention and not a reserved name**: it is what the docs suggest calling a
    scratch, it needs no refusal in `profiles new`, and it idles out exactly as any other spawned profile
    does. A name is reserved only when something enforces it, and nothing here should.
13. **Every `drive` run says which path it took** — for a one-shot that is the answer's `state` field
    (Decision 17), and for `dev` it is prose, since a person is watching. **A run that started an app also
    says the app is still running and how to stop it**, because `--spawn` leaves a detached process behind
    and nothing on `development` reaps it (Decision 12): in a pack repo that is Electron, a file watcher
    and a Vite dev server, and in a checkout with no pack it is Electron alone. Decision 16 is what keeps
    this rare — it only ever happens because someone asked. The two ways
    out are `apack dev`, which reclaims it, and the `supervisorPid` in the session file. **An attach says
    whose app it joined**, as the answer's `startedBy` field (Decision 17) rather than as a sentence — "a previous question started it" is the
    case where nobody is minding the app, so it is the one that must not be silent.
    **And because a line printed once is not documentation**, `apack profiles` gains a *running* column —
    `supervisorPid`, `startedBy`, uptime, debug port, with the environments' data dirs beside the profiles — over
    `profileInUse` and `recordIsStale`, which already answer liveness. The run says it and the listing
    finds it later; that pair is the remedy, and an idle reap on `development` is not, for the reason
    Decision 12 gives. The attach plan's "Telling the user" has the exact lines and the user-facing table.
14. **Onboarding is dismissed on every path, and there is no policy flag.** The readiness wait becomes one
    extracted function, `waitForAppReady(page)`, called by the fixture, by `--spawn` and by attach alike:
    a single `waitForFunction` for `running === 'connected'` that calls `window.__disableOnboardingUI()`
    from *inside* the predicate. In-poll rather than check-then-dismiss, because onboarding can arrive at
    any point during the boot — `engine/index.ts:105` already learned that for `reloadWindow`, and the
    fixture's two-step form (`index.ts:495-507`) has the race it was fixed for. The hook is defined
    unconditionally (`renderer/src/main.ts:80`), so a CDP-attached page reaches it with no env gate in
    the way. **The accepted cost**: attaching to an app whose owner is sitting in onboarding completes
    the wizard for them. It is rare, it is a wizard rather than data, and Decision 13 makes it visible
    rather than silent. **The terminal state is a parameter with a default**, not a literal in the
    predicate, which is the whole of what keeps the deferred item below a line rather than a rewrite.
15. **A question attaches; a program gets a dir.** `drive --eval` attaches, and `drive <script>` goes on
    launching its own app through the fixture, in whichever profile it was given. That is a decision and
    not a leftover: a script is a sequence of clicks and reads whose result would otherwise depend on
    whatever surface was left open and whatever rows were half-edited, which is undeclared input. A script
    that wants the developer's *data* already has it — `--profile` hands the fixture that dir
    (`E2E_DATA_DIR`, `drive.ts:495`); what it cannot share is the *process*, costing a launch and the
    chance to watch it in the window already open. Making the fixture yield a connected page instead
    would change `electronApp`/`appPage`, the file every repo spec, both fixture packs and every external
    pack's suite imports, and would need a gate proving `apack test` can never take that path. Revisit
    from a measured complaint, never from the asymmetry alone.
16. **A one-shot refuses when no app is running, and `--spawn` is how you ask for one.** This replaces
    starting one on every miss and is the user's call, for the reason that settles it: the intuitive reading of
    `drive --eval` is *"ask the app"*, so with no app the answer is to say so — exit non-zero, naming
    `apack dev` and `--spawn` — rather than to acquire a process the question did not ask for. It is also
    what makes Decision 13's hygiene problem small: **nothing is left running that nobody asked for.**
    Spelled to match the `state: "spawned"` the answer carries, so the flag and the field are one word.
    **Two consequences of "refuses" worth stating**: a refused run must leave nothing behind, so the
    session file is read *before* a profile is resolved — `openProfile` creates-or-reuses, so the old
    order would mint an empty dir and then decline to use it; and `--fresh --spawn` is accepted as a
    no-op, since `--fresh` already implies `--spawn` and the two flags disagree about nothing.
    **And `--fresh --rm` on a one-shot means kill-then-remove**: `--fresh` implies `--spawn`, a spawned
    app persists, and `--rm` promises the dir is gone — so the app it just started is ended first. That
    is the only reading that keeps the flag's word; "the reap will get it" is a different promise. It is
    the one case where a one-shot ends an app outside the reclaim rule, on ownership rather than as an
    exception: it spawned that app itself and holds its `supervisorPid`.
    It does not weaken the case for deleting `--serve`: a spawned app stays, so a cold checkout costs one
    flag on the first question and an attach on every one after — `--serve`'s own bargain, with a flag in
    place of a long-lived foreground process. Everything Decisions 10-13 say about *how* an app is started
    and reclaimed still holds; only *when* has changed, from "on a miss" to "on request".
17. **A one-shot's stdout is one JSON object and nothing else**, so it pipes:
    `{"value": …, "state": "attached" | "spawned", "startedBy": "dev" | "drive", "supervisorPid": N}`.
    **No `ok` field — the exit code is the status, and there are three**: `0` with a value on stdout, `3`
    for *no app is running*, `1` for *the verb failed*. That removes `oneShotOutcome`'s trap (an
    `ok: false` inside a 200, so reading the status exited 0 on every real failure) and keeps the two
    non-zero answers apart, which matters because a miss is retryable with `--spawn` and a failed verb is
    not — the root `CLAUDE.md` rule *"a distinct exit code where 'nothing covered this' and 'everything
    passed' are different answers"*, at the code `npm run spec` already uses for it. Both non-zero paths
    put **nothing** on stdout, so a pipe never receives half an answer. `state` and `startedBy` belong in
    the data rather than in a sentence: the first says whether this question acquired a process, the second whose app answered — and
    `attached` + `startedBy: "drive"` is the case Decision 13 singles out, an app a previous question left
    that nobody is minding. `supervisorPid` is what ends it; prose goes to stderr, and only where something was left
    behind. **Two things count as left behind**: an app that is still running, and a *write to the user's
    data* — which is why completing onboarding (Decision 14) gets a line as surely as spawning does. An
    attach that changed nothing says nothing.

## Phases

### Phase 1 — profile replaces instance

[`profiles-not-instances.md`](../plans/profiles-not-instances.md), in full. Decisions 2 and 5.

**Done when:** `npm run spec packages/apack-cli` passes; no `instance` remains in a flag, a command
name, a printed string or a directory path; `--fresh --rm` removes what `--fresh` keeps; the old
profiles root is `<cli data>/profiles/` with no code that reads the old one.

### Phase 2 — the lock question

Decision 8, before anything depends on it. Determine what scopes the single-instance lock, and correct
whichever of the three places is wrong.

**Done when:** the observation is recorded in this doc's Outcome, and `packages/main/CLAUDE.md`,
`apack-cli/src/commands/drive.ts` and `SingleInstanceApp.ts` agree.

### Phase 3 — the port

[`attachable-dev-session.md`](../plans/attachable-dev-session.md), its phase 1. `appHelper(page,
resultsDir)` and `waitForAppReady(page)` extracted (Decision 14); `SessionPage` over a connected `Page`;
both paths live, neither deleted.

**Done when:** the launched and the connected session answer the same verb **identically** — the case
that proves one `SessionPage` serves both; the fixture reaches `connected` through `waitForAppReady` and
`npm test -- smoke` passes on it, which is what says the extraction kept the fixture's own behaviour;
`waitForAppReady`'s terminal state is a default-valued parameter rather than a literal, per Decision 14.
`npm run spec packages/apack-testing` passes.

### Phase 4 — the session file

That plan's phase 2. `dev` and `npm start` publish `<dataDir>/session.json` with the `supervisorPid` that
ends them; `drive` attaches to a live one and, **on a miss, keeps today's behaviour — it launches its own
through the fixture**; `test` publishes none. The refusal and `--spawn` are Phase 5's, deliberately: this
phase adds a fast path in front of what `drive` does today and takes nothing away, so landing it alone
leaves a cold `drive --eval` working exactly as it does now rather than regressed until Phase 5.

**Done when:** every "Done when" of that plan's phase 2; the environment gate's firing case passes (a
packaged or `test` context never gets the flag); `apack test` publishes no session file; **`apack dev`
at a checkout root publishes one**, which today throws before it can (Decision 10), while a run in a pack
repo still builds and installs that pack; the new `npm run dev` carries
`tsx scripts/drive-preflight.ts &&`, which `drive:serve` had and its replacement would otherwise lose —
a pack-less `dev` launches a built app without building it, so the stale-build nudge is the one thing
standing between that and opening yesterday's app in silence.

### Phase 5 — `--spawn`, and the answer's shape

That plan's phase 3, under Decisions 16 and 17. `--spawn` spawns `dev` (Decision 10) detached under
`holdExclusiveLock`, re-reading after acquiring, and that `dev` publishes the session file; **without the
flag a miss refuses**. A spawned app on a `drive` profile idles out; a `dev` one does not.

**Done when:** a miss **without** `--spawn` exits **3**, leaves **no profile directory behind** (the
mutation is resolving the profile before reading the session file, which is today's order and passes every
other case), writes nothing to stdout and names both
`apack dev` and `--spawn` — a gate over input, so the empty stdout is the half to assert, and 3 rather
than 1 is the half a caller needs (Decision 17), with a failed verb at 1 as the paired case; the answer is
`{value, state, supervisorPid}` and nothing else, with `state` reading `attached` and `spawned` in the two cases and
no `ok` field (the mutation is reintroducing one beside a non-zero exit); `dev` reclaims a
`startedBy: drive` app and refuses a `startedBy: dev` one — both halves, since that rule is what makes
`--spawn` safe (Decision 11), reclaiming unconditionally is the mutation, and the case must **spawn and
then reclaim** rather than hand-write a session file, or it passes while `startedBy` is never set to
`drive` at all; a spawned app is **attachable**, carrying a `debugPort` and answering a verb, which is the
case that fails the moment it routes through the fixture (Decision 10); **a `--spawn` in a pack repo
installs the pack**, the other half of Decision 10, which fails if it copied dev's environment rather than
spawning `dev`; two concurrent `--spawn` calls start **one** app (assert one `supervisorPid` — the lock's firing
case); onboarding is named when it was completed (Decisions 13 and 14), which a never-onboarded profile is
the case for; a spawned app on a profile **not named `drive`** idles out, a `dev` app on that same profile does not,
and a `development` one never does — three cases, since the key is two fields (Decision 12) and the
conventional name is the one value that cannot discriminate between the two readings;
`apack profiles` shows a running app with its `supervisorPid` and `startedBy`, and stops showing it once that app has
gone (both halves — a listing that cannot go back to empty is a stale record, not a status). Then measure
the end-to-end one-shot (`npm run measure`, per that plan's Verification) and record it in the Outcome.

### Phase 6 — the deletion

That plan's phase 4, **and only if Phase 5's measurement shows `--spawn` plus attach carries `--serve`'s load**. If
it does not, skip this phase, leave `--serve` in place, say so in the Outcome and go on to Phase 7:
phases 1-5 stand on their own, which is the property the phasing exists to give.

**Done when:** `--serve`, `--attach` and the four files are gone — the flag, not the word, which Deferred
reserves for the one choice that would still be real; the runner and `drive <script>` are
untouched (Decision 15); `npm run chain` passes; `npm test -- smoke` passes; a real `apack dev` answers
a `drive --eval` against it.

### Phase 7 — `--build`, one flag

[`one-storage-axis.md`](../plans/one-storage-axis.md). Decisions 3, 4, 5 and 6. **Last rather than third,
per Decision 1**: nothing in Phases 3-6 reads a build, and this is the one phase that reopens `-d`/`-b`.
It runs whether or not Phase 6 did.

**Done when:** `--build <name|path>` is the only build selector; `--app`, `--app-root`, `APACK_APP` and
`APACK_ROOT` name nothing; `-d`/`-b`/`--production` resolve through it; `resolveAppContext` takes a
build and an optional profile; the `development`-only debug gate is moved to the new signature with its
firing case still passing; `npm run spec packages/apack-cli packages/apack-sdk` and `npm run typecheck`
pass. Mutation: a bare value that is also a known name resolves as the name, and `./<name>` as the path.

## Deferred

Nothing here renames `apack build` (Decision 6) or reimplements the script runner (Decision 7). The
host-backend edit loop — no HMR, `npm run build:be` and a restart — is out of scope, and the attach plan
names it so this is not read as having addressed it.

**Driving the onboarding flow is deferred, and it is not this plan's gap.** The fixture dismisses
onboarding unconditionally and always has, so nothing can drive or test those screens: a search of
`tests/e2e/` finds no spec that does, and the one `onboarding` hit there is a `data-onboarding-id` used as
a selector for something else. Decision 14 keeps that behaviour and does not worsen it. What the real
caller wants is onboarding **left up** rather than refused — for someone working on those screens, the
onboarding screen *is* the ready state — so the shape is a terminal state on `waitForAppReady` and a
user-facing `drive` flag (and a fixture option) that selects it, never an inverted `dismissOnboarding`.
Decision 14 requires the default-valued parameter so that this stays an addition. Pick it up when someone
is actually editing onboarding.

**An attach mode for the fixture is deferred, not rejected** (Decision 15). It would let `drive <script>`
run against a live app instead of launching one, and the reason it is not here is cost and order: it
changes `electronApp`/`appPage`, needs a gate keeping `apack test` off that path, and trades per-script
isolation for it. The condition for picking it up is a script someone wanted to run against the app in
front of them and could not — not the observation that the two halves of `drive` behave differently.

**Its spelling is `--attach`, opting in**, and Phase 6 deletes that flag without retiring the word: for a
one-shot it has nothing left to select, which is a different thing from the concept going away. Two
corollaries. It must **not** be spelled as an inverse of `--fresh` — `--fresh` mints a clean data dir, and
making it also mean "launch your own app" fuses the storage axis with the app axis, which is the fusion
[`one-storage-axis.md`](../plans/one-storage-axis.md) exists to undo. And it must not acquire a second
word (`--live`, `--own-app`) for a concept these docs already name throughout: the churn of deleting a
flag and later restoring it is cosmetic, where two vocabularies for one idea is not.

## Constraints

The standing rules: commit each phase as it finishes, no attribution lines, `git diff --cached` first,
pushing and PRs on request; no publishing, releases or triggered workflows; no real data dirs, no broad
process kills by pattern, E2E in the `apack-test` namespace; preload, example pack and release-metadata
rules; typed EARS types are change-controlled; published packages take no `any` and need `api:update`
after an export change; `packages:build` before the CLI suite; migrations follow
`packages/apack-host/src/migrations/CLAUDE.md`; investigate failing tests and mutation-check new
guards; external packs stay first-class.

This goal's own:

- **The debug port is `development` only**, computed from `resolveAppContext()`, never from a flag or a
  file's contents, and bound to `127.0.0.1`. The session file is mode-0600 through `writePrivateFile`.
- **Keep renderer errors structured** when attached: a live listener from connect for new errors, the
  log for history, and an answer that says which. Do not collapse both into log text.
- **`setViewport` refuses when attached** rather than emulating, and says why.
- Run the narrow checks during a phase and the chain once at its end, per the root `CLAUDE.md` table
  ("What to run after a change").

## Outcome

### Phase 1 — profile replaces instance (`e1992b632`)

Done. `--instance` → `--profile`, `apack instances` → `apack profiles`, `src/app/instances.ts` →
`profiles.ts`, `instance-secrets.ts` → `profile-secrets.ts`, `<cli data>/instances/` → `profiles/`, and
`--ephemeral` → `--fresh --rm`. `npm run typecheck`, `npm run spec packages/apack-cli` (209 cases) and
`npm run chain` (198.3s) all green.

Three choices the plan left open, taken here:

- **No migration of the old directory**, on the user's instruction mid-phase: a one-shot rename reading
  `instances/` is the kind of code nobody finds to delete later, and what it would carry is disposable by
  definition. Decision 2 and the rename plan were corrected to match. The migration and its four cases were
  written, mutation-checked and then removed; what replaced them is a sentence. Cost on this machine: the
  old root held one empty `.ephemeral/` and no named profile, so nothing was orphaned in fact.
- **`apack profiles --ephemeral` became `--all`**, since Finished-when requires `--ephemeral` to name
  nothing in the CLI. `--all` is the usual spelling for including what a listing hides, and the CLI already
  uses it that way in `clean --all`.
- **`ephemeral` stays as the property and the `.ephemeral/` directory.** The flag changed; the concept did
  not, and renaming the field would have been a second vocabulary for one idea.

No scan was committed for "no `instance` left in a user-facing string". It was run by hand and is what found
the last four sites, but as a gate it would fire forever on the single-instance lock — the other sense of the
word, which the corrected prose now discusses more rather than less. A check whose subject is a finished
migration is neither a gate nor an assertion (root `CLAUDE.md`, "A check that cannot fail today").

### Phase 2 — the lock question

**The data dir scopes Electron's single-instance lock. The app name does not.** Observed 2026-10-09 with a
two-process probe, the pair Decision 8 asked for:

| Probe | Result |
|---|---|
| same app name, **different** data dirs | both took the lock (`lock=true`, `lock=true`) |
| **different** app names, same data dir | the second was refused (`lock=true`, `lock=false`) |

And the mechanism directly, rather than inferred from the pair: while the lock is held the data dir contains
`SingletonLock` (a symlink naming `<hostname>-<pid>`), `SingletonCookie` and `SingletonSocket` — Chromium's
`ProcessSingleton`, which lives in the user data directory. So `app.setPath('userData')` is what decides it
and `app.setName` is immaterial.

What that means for this goal: the four environments run side by side because their **dirs** differ, not
their names; a profile is what lets two apps of one environment coexist; and every refusal `drive` and
`dev` make is about one data dir, which is what the attach design already assumed.

Corrected: `packages/main/CLAUDE.md` (two places, which said the app name) and `SingleInstanceApp.ts`
(which said "them"). `apack-cli/src/commands/drive.ts` was already right and is unchanged.

### Phase 3 — the port (`2cbb84479`)

Done, and the design's one technical risk is retired: a connected page answers identically to a launched
one, sees the same renderer's writes, and survives the connection being dropped and remade.

`appHelper(page, screenshotDir)` and `waitForAppReady(page)` are free functions the fixture calls;
`engine/cdp-page.ts` has `attachToApp`, `readDevToolsPort` and `findWindow`. **`asSessionPage` needed no
change at all** — it already takes a `Page` and an optional window, so there is one set of verbs rather than
the two the plan expected ("the same body the fixture's uses" turned out to be the same *function*).

Two things worth keeping:

- **The window predicate is held by a unit, not by the E2E spec.** `pages()[0]` is the right window in this
  app today, so the end-to-end assertion passes with the predicate replaced by "take the first" — measured
  by doing it. `apack-testing/tests/engine/cdp-page.spec.ts` presents several targets on purpose and fails
  five of six cases on that mutation. The E2E spec now says it does not hold that claim.
- **A dependency correction, which was blocking the whole phase.** The root pinned `@playwright/test`
  exactly and floated `playwright` on `^`, so two `playwright-core` copies were installed and a connected
  `Page` was *not assignable* to a launched one. The three ship in lockstep; pinning them together leaves
  one copy. tsc then writes the canonical `playwright/test` specifier into the published declarations, so
  `playwright` joins `playwright-core` as an optional peer that names it — found by `published-imports`,
  which is the check that exists for exactly this.

**The missing-`playwright-core` install hint has a firing case, and getting one took a parameter.** The
throw was written in this phase and could not be reached: `playwright-core` resolves in any checkout or
install that can attach at all, so no test could make the import fail. `_chromium` takes its loader as a
parameter for that one reason, and three cases run it — a loader that rejects, a module that resolves
without a `chromium` (which read `connectOverCDP` off `undefined` before, and said neither the package nor
the fix), and the ordinary one. Both failure cases fail on the mutation that drops the hint.

That is the shape to copy for an unreachable remedy: a seam the caller never uses, rather than no case. It
is *not* the shape for an unreachable **assertion** about the program's own construction — that one wants a
comment naming the edit that would make it fire, per the root guide.

### Phase 4 — the session file (`fe963e92b`)

Done, and proven live rather than only in specs: `apack dev` at the checkout root with no pack held the app
and published a session, and `drive --state` against it answered in **1.15s**.

```
$ apack dev                       # at the repo root, no pack
  up on development data in <dir>
  attachable on debug port 60905 — `apack drive` can reach it
No pack here: holding the app. Ctrl-C to close it.

$ apack drive --state             # another terminal
Attached to the development app (pid 36307).
{"value":{"running":"connected"},"surface":"default-setup/threads","surfaces":[…]}
```

Four decisions the phase settled, each because the obvious placement was wrong:

- **The session module is `@apackdev/host/dev-session`, not the CLI's.** Two launchers publish one — `dev`, and
  the `npm start` loop that spawns Electron from `packages/main/vite.config.js` — so a CLI-owned module would
  have meant a second copy. The `pack-dev-servers` marker is in the host for that same reason.
- **`readDevToolsPort` went with it, after two wrong homes.** `@apackdev/testing` put a devDependency in the
  CLI's import graph, which `bundle-package.ts` refuses; `@apackdev/host/process-liveness` reads well but that
  module is about *whether a writer is still there*, and this answers *what port Chromium picked*.
- **`@apackdev/testing` is resolved at runtime by `drive`, never imported.** The CLI already reaches it that way
  for the Playwright binary, from the pack's own `node_modules` — so a pack drives with the harness it tests
  with. `attachedSession` was added there so the CLI asks for one thing rather than assembling five.
- **The pid means "the process whose death ends both"**, which differs in direction between the two
  launchers: `dev` records its own, because its teardown closes the app; `npm start` records Electron's,
  because that watcher exits *with* it.

Two gates caught real things, and both are the reason they exist: `published-imports` refused bare
`playwright` in the declarations (tsc writes the canonical `playwright/test` specifier), and
`sdk-bridge-drift` refused two new host exports that were neither bridged nor declared unbridged — both
host-only, now declared with the reason a pack must not have them.

**`--query` against the app I drove failed, and the failure was right.** The running app's *built* API
predates `host/drive`, so it broadcast where the session waits for a reply — which is what the stale-build
nudge on `npm run dev` exists to warn about, arriving unprompted as evidence that it is worth having.

Left for Phase 5, where Decision 17 defines it: the one-shot's **output shape**. The fast path currently
prints the engine's own result, so `--eval` without a `return` prints `{"ok":true}` rather than saying the
body returned nothing. `{value, state, startedBy, supervisorPid}` and the three exit codes replace it.

### Phase 5 — `--spawn`, the answer's shape, the reclaim (`5176a75a2`, `1a2ce7938`)

Done, and the bargain Decision 16 promised is measured rather than argued:

| | |
|---|---|
| no app, no `--spawn` | exit **3**, stdout **empty**, both ways forward named |
| `--spawn`, cold | **3.3s** — launch, attach, answer; `state: "spawned"`, and one stderr line |
| every question after | **0.9s** — `state: "attached"`, and **no stderr at all** |

`startedBy: "drive"` came back in the answer, which is the silent failure closed: `APACK_SESSION_STARTED_BY`
reached the spawned `dev`, so the app is reclaimable. Had it not, nothing would ever have been, and the
developer's `npm start` would have refused while blaming them.

**The reclaim, proven live in both directions.** `apack dev` on a dir a question was holding printed
*"Reclaiming the app a question started (pid 74945)… it has gone; starting yours"*, and the session then read
`startedBy: "dev"`. A second `dev` on the same dir answered *"Using the development app already running"* —
a person's app is not a tool's to take. And the convergence held: the next question attached to the
developer's app and said so. The decision is a function (`mayReclaim`) so both halves have a case, and
reclaiming unconditionally fails exactly the one that protects a person's app.

**The listing is the other half of the hygiene answer**, and the one that survives a scrolled terminal:
each row with a live session names who started it and the pid that ends it, on the environment rows as well
as the profiles, since the development dir is where a spawn lands by default.

Deferred from this phase, with the reason:

- **`--spawn` in a pack repo installing the pack has no case of its own**, beyond `dev` doing the installing
  (which `dev-install.spec.ts` covers) and `--spawn` spawning `dev` rather than copying its environment
  (which is one line and a type). The end-to-end case would launch an app per run in a fixture pack; the
  cheaper proof is that there is one launcher.

#### The measurement Phase 6 turns on

`npm run measure --runs 7`, 2026-10-10, 67-72% idle — an **end-to-end one-shot**, CLI start included, which
is what a question actually costs rather than the 74ms the spike measured for the connect alone:

| Asking one question of a live app | |
|---|---|
| `drive --attach` against a `--serve` session (what Phase 6 deletes) | **0.7s** median of 7 (0.7-0.7s) |
| `drive --eval` attached over CDP to an `apack dev` app | **1.0s** median of 7 (1.0-1.0s) |
| `drive --eval --spawn` against nothing, cold | 3.3s |

**So the deletion costs 0.3s per question, and the verdict is to take it.** The engine's own attach is
quicker — it is an HTTP request to a process that has already connected, where this starts Node, resolves
the harness, imports `playwright-core` and connects. What the 0.3s buys is the removal of 851 lines, an
HTTP server, a token, a marker in Playwright's `outputDir`, a ready-line protocol, a `/close` verb and two
generated `.mts` files — and, more to the point, of **a second long-lived app beside one that already
exists**, which is the sentence the whole plan rests on. The old README's "~0.35s instead of ~3.5s" made the
gap sound like 3x; measured against each other on the same box it is 1.4x.

The one thing the engine still does better is hold a *warm connection*, and nothing here recovers that for
a per-question process. If an agent asking fifty questions in a row ever makes 15s matter, the answer is a
session that keeps the CDP connection — which is this design with a server in front of it again, and worth
building only when something has paid that cost and said so.

### Phase 6 — the deletion (`fd621dddf`)

Done, on the measurement above. 851 lines in four files, plus two generated scripts, a Playwright config
helper, three specs and the `--serve`/`--attach` flags.

What is left is smaller in the way that matters rather than merely shorter: `drive` has **one path for a
question** (attach, or refuse, or `--spawn`) and **one for a script** (the Playwright runner, untouched),
where it had three sharing a config, a scaffold and a one-shot client. `@apackdev/testing/playwright` has two
helpers rather than three, and neither locks a setting any more — the handshake they were protecting is
gone, so there is no setting left that a pack changing it would break.

Verified after the cut, all three paths: a miss exits 3 and names both ways forward, `--spawn` answers and
leaves the app, and the next question attaches.

**Two gates caught orphans nothing else would have found**: `scaffold-templates` found a template nothing
rendered any more, and `chain-inputs` found six steps declaring inputs that named no file — which is a step
caching over a gap. Both are checks whose whole subject is a thing going stale quietly, and both fired on
the first run after the deletion.

One correction worth keeping: the old `drive/README.md` claimed the engine's attach was *"~0.35s instead of
~3.5s"*. Measured against the new path on one box it is 0.7s against 1.0s. The 3.5s was a cold one-shot —
two different comparisons quoted as one, which is what a figure without its conditions does.

### Phase 7 — `--build`, one flag (`8f5a0ded5`, `5014dad03`, `eca8156c0`)

Done, in three parts, and the third turned up the one thing the plan did not anticipate.

**The flag.** `--app` and `--app-root` were never two concepts: they split on the *shape of the value*, and
the name half accepted exactly one word. One flag and one line of disambiguation replace both — a value in
the known-name set is a build, anything else is a path — with `./beta` as the escape hatch for the day a
checkout is named after a channel. `APACK_APP` and `APACK_ROOT` collapse into `APACK_BUILD`, read before
anything can outrank it, which is what stops the two resolvers disagreeing about one value.

**The shorthands.** `-d`, `-b` and `--production` resolve through `--build` on every command that reads a
build's data, and `--build <name>` says the same thing in the one word the CLI now uses. Two things the old
flags could not do are now cases: a value that is not a build is refused *by name* with what the builds are,
and the shorthands are held to the long form pairwise.

Mutation-checked five ways, which between them reach all seven cases: `-b` mapped to `development` fails the
pairwise case and nothing else, the unknown-build refusal removed fails the refusal case, a `development`
default fails two, consuming `--build`'s value without advancing the index fails the leftovers case, and
reading only the inline `--build=` form fails four. The pairwise case is the one worth noting — it fails on
the *pair* rather than on either half, which is what says the two spellings are held together rather than
separately.

**The resolver.** `resolveAppContext({ build?, profile? })`, and `AppContext.build` rather than `.env`, so
one resolver does not answer in two vocabularies. 27 argument sites, 12 context reads, `AppPlace` and
`DbTarget`; `api:update` regenerated `env.api.md` and every line of it is this change.

**The finding: `APACK_ENV` does not collapse, and must not.** Decision 3 says `APACK_APP` and
`APACK_ROOT` become "one variable holding either shape", and the obvious next step is to make the app's own
`APACK_ENV` that variable too. It is the wrong step. `APACK_ENV` and `APACK_USER_DATA_DIR` are the
**handoff** — how a parent process tells a child what it is and where its data is, written by the CLI and by
Electron main — where `--build`/`APACK_BUILD` is a **selector** a person types. One is the question and the
other is the answer, and giving them one name is the same fusion this phase exists to end, one layer down.
So the selector collapsed and the handoff stayed, which is also why `APACK_ROOT` and
`APACK_APP_EXECUTABLE` survive as the fixture's inputs: those are two *kinds of answer*, not two spellings
of one question.

`npm test -- smoke` is what says the app still resolves its own identity and data dir after the rename — the
one claim no unit can make, since every path in a context is joined onto a dir the resolver chose.

### Closing the three Done-when gaps

The seven phases left three claims in Phase 5's Done-when standing on nothing, and the stop condition was
right to refuse them. What closed each, and what each turned up:

**The idle reap, built** (`reapsWhenIdle`, `idleVerdict`, `IDLE_REAP_MS` in `commands/dev.ts`;
`touchSession`/`lastAttachedAt` in `@apackdev/host/dev-session`). Deferred on the argument that Decision 16
had removed most of what it was for — true of the `development` dir, where `mayReclaim` answers, and false
of the case that remains. A `--spawn` on a **profile** is reclaimed by nothing, because
`apack dev --profile <name>` is not a command a developer happens to run, so before this it held a data
dir until the machine was rebooted. So the rule is two clauses and they fail to opposite mutations:
`startedBy: 'drive'` alone closes the app a developer is working in, the profile alone closes the app they
opened themselves.

Two things it needed that the deferral priced as new machinery, and neither was:

- **The record of when something last attached is the session file's mtime.** That is already what says a
  session is live (`recordIsStale` bounds the pid by it), so a driver bumping it forward says the one thing
  it has to, a supervisor reads it with one `stat`, and no field was added. A field would mean rewriting the
  file — an atomic rename, a new inode, a race with the supervisor's own unpublish — to carry what the
  filesystem carries. `askAttached` touches it twice, on attaching and on the way out, so a verb that waits
  a minute for a state does not expire underneath itself.
- **The watcher is a deadline re-derived, not a poll.** Each wakeup is the earliest moment the answer could
  have changed: the window has passed, or something attached since and the next wakeup is *its* deadline. An
  idle app wakes it once; one asked a question a minute wakes it once a minute. `againInMs` being `idleMs` —
  a fixed interval — is the mutation that case fails on.

Proven live rather than only in specs, with the window lowered to 20s for the run and restored: a
`--spawn --profile reap-probe` answered `{"state":"spawned","startedBy":"drive",...}`, the listing showed
the row as *running, started by a question*, and the supervisor closed itself and its app with
`Closing the app this question started: nothing has attached for …` in its log. The `development` half is
held by the spec, not a run: proving it live is a ten-minute wait for an app not to close, and the reclaim
it defers to was already proven live in Phase 5.

**`apack test` publishes no session file, with evidence** (`tests/e2e/smoke/smoke.spec.ts`). It was an
argument from the launcher list, and the look at the dir turned up the fact that makes it worth a gate:
**a test app is running with a debug port wide open.** Playwright drives Electron over CDP, so it launches
every app in the suite with `--remote-debugging-port` and Chromium writes the number into the data dir's
`DevToolsActivePort` — so a tool that *inferred* attachability would find a test run's app and drive it
mid-suite. The case asserts the port is present and the session is not, which is one claim rather than two:
the port is what there would be to infer from, and asserting it is also what stops the absence being read
off an empty or wrong directory. It earned that immediately — the first draft asserted `host.json` beside
the absence and failed, because the app's own files are a level down under `apack/`.

Mutation-checked on both halves, and the subject rather than the spec for the half that has one: making the
fixture publish a session after launch (four lines, as `apack dev` does) fails the case, and pointing the
read one directory down — the wrong-dir mistake the port assertion exists to catch — fails it with an
`ENOENT` naming the path.

**`--fresh` on the one-shot path resolved the wrong data dir, and the cause was two answers to one
question.** `attachPlace` answered `{ build: 'development' }` for `mode.kind === 'fresh'` while
`profileArgsFor` passed `--fresh` to the spawned `dev`, which mints a profile of its own — so
`drive --eval … --fresh` either attached to whatever was on the development dir, ignoring the flag, or waited
out the 120s deadline for a session at a path nothing would write. `--with-secrets` was dropped there too.
Nothing could catch it, because "which data dir" had two places to answer it and no case made them meet.

`askTarget` is the one answer: the dir to wait on and the flags that make `dev` open it, built together, so
`dir` is by construction the dir `spawnArgs` opens. The case that holds it is a **round trip** rather than
two assertions — `spawnArgs` go back through the parser `dev` uses, through its `profileFor`, to the dir it
would resolve — and reinstating the old split fails four of its cases.

`--fresh` resolves to a **name** here rather than to a minted dir, because a question has to know the dir
before the app exists and a name is the only thing both sides can agree on in advance. That also settles the
`--rm` question the deferral had left open: the dir is a *named* profile, so it is listed and reachable while
the app lives, which an app outliving its command needs — and `--rm` on a name is now an ordinary spelling
(`--profile <name> --rm`), honoured for a dir the run creates and **refused** for one already there, since
that holds data somebody kept. The hidden `.ephemeral/<pid>-<name>` form stays what `--fresh --rm` mints on
the script path, where the run does own the app for its lifetime.

**One bug in that fix was found by running it, after its specs passed**: `spawnDevApp` opens its log inside
the data dir before `dev` starts, so by the time `dev` opened the profile the *directory* was there and
`created` read false — refusing `--rm` for a dir the run was in the middle of creating. `created` is about
the **record**, not the directory: a dir with no `.apack-profile.json` is not a profile yet, which is the
rule `listProfiles` and `notAProfile` already read. Proven live afterwards: `--fresh` named a profile,
spawned into it and answered; the printed name attached on the next question (`state: "attached"`); and
`--fresh --rm`'s dir was gone once its supervisor exited.

### What a live `npm start` found, and why that item was in the Finished-when

Phase 4 recorded *"a live `dev` or `npm start` publishes `<dataDir>/session.json`"* having run only `apack
dev`. Running the other half found **two defects, neither reachable from any spec**, which is the argument
for that item being a live run rather than a case.

**`npm start` published nothing at all.** Its watcher asked `resolveAppContext()` with no argument, and
Phase 7 made the build something a *selector* names — so the only way to answer with no argument is the
`APACK_ENV` handoff, which a Vite watcher is not given (the app sets it for processes *it* spawns). The
app came up perfectly and reported `[dev] not attachable: App build unknown`, so the loop looked fine and
was simply undriveable. The fix is `{ build: 'development' }`, which is what the comment two lines above
the spawn already said this hook is: a development run by definition. Nothing could have caught it —
`resolveAppContext`'s `build` is optional *because* a spawned process legitimately omits it, so a no-argument
call typechecks everywhere and is only wrong in a process the app did not spawn.

**And `readDevToolsPort` trusted a port that was not this launch's.** Its own doc comment said a launcher
*"waits for a new one rather than trusting what is there"*, and the implementation read whatever was in
`DevToolsActivePort` — a file Chromium leaves behind, as watching it survive the app that wrote it showed.
So a session could name a port belonging to a browser that was gone, and `drive` then refused an app that
was running: a failure that reads as a bug in the attach rather than in the publish. It now takes `after`,
the instant before the spawn, and a file not newer than that is "not yet" exactly as an absent one is —
not optional, because a caller that forgets it is back to the defect. Both callers pass the instant from
before their launch.

Proven live afterwards: `npm start` published `{"debugPort":59047,…,"startedBy":"dev"}` 8s in, and
`apack drive --eval 'return document.title'` answered
`{"value":"Agent X","state":"attached","startedBy":"dev","supervisorPid":90993}`.

### The retired names, grep-verified rather than asserted

Phases 1 and 7 recorded that `--instance`, `--ephemeral`, `--app` and `--app-root` name nothing and that
`apack run` is gone. The command was gone (`Unknown command: run`); **the names were not**, and one of
them shipped:

- **`apack init` scaffolded `"dev": "apack run"`** into every new pack's `package.json`, so `npm run dev`
  in a scaffolded pack ran a command that does not exist.
- Two error messages told the user to pass `--app-root <path>` (`beta-app.ts`, and the fixture's
  app-resolution failure), `apack clean --apps` described the builds `--app beta` downloaded, and
  `apack profiles new` printed `apack run --profile <name>` as the next thing to type.
- `docs/public-facing/getting-started.md` and `architecture.md` carried `apack run`, `--app-root`,
  `--app beta` and `APACK_APP=beta` as commands to run.
- Around sixty source comments and spec names referred to `apack run`.

All of it moved. Three things deliberately left: `--ephemeral` in default-setup's codex actions, which is
the **codex CLI's** flag; a `.changeset` entry, which is published release notes; and other goals' and
plans' docs under `docs/goals/` and `docs/plans/`, which record what was true when they were written.

**The lesson is the method, not the list.** A record saying a name is gone is a claim about the whole tree,
and the only thing that establishes one is the grep. Four of these had been asserted in an Outcome and
committed.

### Two more properties that were recorded rather than checked

**"No profile is named after a build" was not enforced.** `apack profiles new beta` made the directory,
and so did `development` — which is this goal's own collision put back by the one input a user picks
freely: `--profile beta` and `--build beta` a letter apart, one a data dir and the other the app that
opens it. `profileNameProblem` refuses the whole name now, derived from `APP_ENVS` rather than a list of
its own, so a fifth build arrives refused rather than nameable. Every door goes through `profileDir`, so
`profiles new`, `dev --profile` and `drive --profile` all report it — checked at each, and mutation-checked
three ways: the refusal removed fails 8 cases, a hand-written list missing a build fails 4, and a
substring match fails the case that keeps `beta-work` usable.

**`cli.md`'s prose contradicted the table it introduces.** Above *"Which app, and how long it lives"* it
still said `apack drive` *"launches its own app rather than joining one `apack dev` already has"* — true
of the script half and the opposite of what a question does since Phase 3. The two halves are set out
separately now, and the table's own rows were checked against the behaviour rather than read: with an app
on the development dir **and** one on a profile, a `drive <script>` run launched a third in
`apack-e2e-Tvead9`, left both of the others running, and took its app and its dir with it when it
finished.

The listing was checked the same way, in both of its groups at once, since one live row had been the whole
of the evidence for it:

```
  development  0.3.14  …/apack-dev  (running, started by apack dev — pid 21460)
  listing-probe  2026-10-10 running, started by a question — pid 21012
```

**And the lock question's three places do say the same thing** (`packages/main/CLAUDE.md` twice,
`SingleInstanceApp.ts`'s comment with its observation, and `drive.ts`'s header): the lock is scoped by the
**data dir**, which is why four builds coexist and two apps on one dir cannot.

## Final summary

The goal asked for this as its last item, and it belongs here rather than in a terminal: a summary that
exists only in a session's output is not a record. The sections above have the detail; this is the state.

| Phase | Status | Commits | What says so |
|---|---|---|---|
| 1 profile replaces instance | done | `e1992b632`, `c6b2da9cc` | The four retired flags grep-clean across the tree; `profiles.spec.ts` holds the name rule, including that a build cannot be a profile name — which Phase 1 recorded and had not enforced. No directory migration, by instruction |
| 2 the lock question | done | `b06ea92c8` | A two-process Electron probe: same name, different dirs → both hold it; different names, one dir → the second is refused. All four places say *scoped by the data dir* |
| 3 the port | done | `2cbb84479`, `e45c40aff` | `debug-port-gate.spec.ts`, 6 cases, 4 firing on an ungated mutation; `cdp-page.spec.ts` holds the window predicate (5 of 6 fire on `pages()[0]`) and the absent-peer hint |
| 4 the session file | done | `fe963e92b`, `2233ecb40` | `apack dev` live in Phase 4; `npm start` only at the end, which is where its two defects were |
| 5 `--spawn`, the answer's shape | done | `5176a75a2`, `1a2ce7938`, `e45c40aff` | Exit 3 for a miss; 3.3s cold, 0.9s attached; reclaim and the idle reap both proven live |
| 6 the deletion | **ran** | `fd621dddf` | Its condition was the measurement — 0.7s against 1.0s, median of 7 — and 851 lines went |
| 7 `--build`, one flag | done | `8f5a0ded5`, `5014dad03`, `eca8156c0`, `a495544c5` | `target-build.spec.ts` mutation-checked five ways, reaching all seven cases; `env.api.md` regenerated |
| Docs | done | `d37bf30dc`, `7f8bbc918`, `5c854c470`, `b372c6d58` | Four docs under `docs/archive/`, each with a `**Done and closed**` blockquote; `doc-links.spec.ts` green |

**Nothing is deferred.** Phase 5's three open Done-when claims were closed in `e45c40aff`, and every
property the Outcome had asserted rather than checked has since been checked — four of them were wrong.

**Conventional choices made**, each where a detail was unspecified:

- The idle window is a constant, 10 minutes, with no flag or variable: long enough to keep the app between
  two questions, short enough that an interrupted loop costs minutes.
- The reap wakes on a deadline re-derived, never a fixed interval.
- `--rm` takes a name (`--profile <name> --rm`), honoured only for a dir the run creates.
- `created` means the profile record, not the directory.
- `_chromium` and `readDevToolsPort` take a parameter each — a loader, and the launch instant — because
  that is the only way their failing path has a case. `after` is required rather than optional.
- A profile name is refused for a whole build name only; `beta-work` stays an ordinary name.

**Four commits came after the phases**, each a defect the evidence rounds found rather than a phase's work:
`c6b2da9cc` (a profile nameable after a build), `35c61eb49` (`profileDir`'s containment check unable to
fire), `c932a2423` (`npm run spec` reporting nothing and passing) and `32bf82922` (the debug port ungated in
the `npm start` watcher). The first two belong to Phase 1's row and the last to Phase 3's; the third is the
instrument, not the subject.

**Verification at `319ed640b`**: `npm run typecheck` (19 jobs), `npm run chain` 159.4s, `npm test -- smoke`
5 passed, `app-integration` 14 passed, and every workspace suite with one — `@apackdev/cli` 573 + 209
integration, `@apackdev/host` 900, `@apackdev/sdk` 730, `@app/internal-repo-checks` 910, `@app/default-setup` 843,
`@apackdev/ears` 119, `@app/api` 110, `@apackdev/testing` 98, `@app/main` 32, `@app/internal-publish-checks` 8.

**Three workspaces have no suite**, so `npm run spec` over one reports exactly that and exits 3 —
`@app/preload`, `@app/internal-electron-versions`, `@app/internal-typescript-floor`. That is the whole answer the command can
give for them, and it is an answer rather than a silence only because `c932a2423` fixed it. This work
touched none of the three.

**And one row of the listing is not for a terminal to prove.** `production` is the user's real data and
testing it from the command line is human QA's, so its evidence is the dry run and spot check: the resolver
answers `…/Application Support/apack` matching `appDataDirFor('production')`, `debugPortArgsFor` gives it no
port, a profile may not take its name, and the dir holds no session and no `DevToolsActivePort`. The live
rows are `development` and `beta`; all four are covered through the `resolve` seam.

### Every guard, and the mutation that proves it

*"Every new guard is mutation-checked"* was done guard by guard as each landed, and scattered across the
sections above. Collected, because a claim about all of them should be checkable in one place — each row is
a mutation that was applied to the **subject**, run, and reverted in the same command:

| Guard | Mutation applied | Cases that failed |
|---|---|---|
| `debugPortArgs` | the environment gate removed | 4 of 6 |
| `mayReclaim` | reclaim unconditionally | 1 |
| `findWindow` | the predicate replaced by `pages()[0]` | 5 of 6 (the E2E spec passed — which is why the unit holds it) |
| `_chromium`'s install hint | the hint replaced by a bare throw | 2 |
| `parseTargetEnv` | `-b` → `development` | 1 (the pairwise case) |
| | the unknown-build refusal removed | 1 |
| | the default build → `development` | 2 |
| | `--build`'s value read without advancing | 1 |
| | only the inline `--build=` form read | 4 |
| smoke's "publishes no session" | the fixture publishes one, as `dev` does | 1 |
| | the read pointed one directory down | 1 (`ENOENT`, naming the path) |
| `reapsWhenIdle` | the profile clause dropped | 1 |
| | the `startedBy` clause dropped | 2 |
| `idleVerdict` | a fixed interval instead of the deadline | 1 |
| `touchSession` | made a no-op | 1 |
| | made to rewrite the record | 2 |
| `lastAttachedAt` | answers a time for no session | 1 |
| | stats the dir instead of the session | 2 |
| `askTarget`'s round trip | the old two-answer split reinstated | 4 |
| | made to create the dir it names | 1 |
| `profileFor`'s `--rm` refusal | the refusal removed | 1 |
| `openProfile`'s `created` | reads the directory again, not the record | 1 |
| `freshProfileName` | returns a constant | 1 |
| `readDevToolsPort`'s `after` | the mtime bound removed | 1 |
| | the slack widened to an hour | 1 |
| the build-name refusal | the refusal removed | 8 |
| | a hand-written list missing a build | 4 |
| | a substring match instead of the whole name | 1 |
| the profile name rule (Phase 1) | `_pathSegmentProblem` removed | 3 |
| `removeProfile`'s root guard | `notAProfile` removed | 5 |
| `removeProfile`'s in-use guard | the refusal removed | 2 |
| `profileDir`'s containment | the check removed | **0 — see below** |
| the environment row's session | the row stops carrying it | 6 |
| | the wording collapses to `(running)` | 1 |
| | the two starters swapped | 1 |
| | `inUse` ignored | 6 |
| `npm run spec`'s no-run guard | the guard removed | exit 3 → **0, silently** |
| `debugPortArgsFor` | the gate opens for every build | 3 |

**The debug port was open on any build `npm start` was pointed at**, which is the Never list, and the beta
row is what found it. There is no published Beta release — every tag is a `v0.3.x` production one — so
`--build beta` can resolve nothing and that row can never hold a downloaded build. A checkout *can* run as
the beta channel, because a source run takes its environment from `APACK_ENV`, and that is the launch that
exposed this: the watcher's hook is guarded by `NODE_ENV !== 'development'`, which is the **bundle's** mode
and says nothing about the environment the spawned app resolves. So it pushed `--remote-debugging-port=0`
unconditionally, and `APACK_ENV=beta npm start` was an unauthenticated port on a beta app — while the CLI's
identical decision had six cases guarding it.

The asymmetry was the cause, so the fix is one owner: `debugPortArgsFor(build)` in
`@apackdev/host/dev-session`, which `apack dev`'s `debugPortArgs(place)` now delegates to and the watcher
calls with the build `_inferElectronAppEnv` gives it — the app's own rule rather than a second copy. The
session follows the same gate, and the publisher's hardcoded `development` went with it: a beta run
publishes nothing because it is not attachable. Four cases, firing on a gate that opens for every build.

Proven live, and the same run is the beta row's evidence: `APACK_ENV=beta npm start` left **no**
`DevToolsActivePort` and **no** `session.json` in the beta data dir, and the listing read
`beta  0.3.14  …/apack-beta  (running)` — the no-session variant, which is the row an app with no port must
still produce, since what it guards is `apack db` writing underneath one.

**And `npm run spec` itself could report nothing and pass**, which is the instrument every claim of
coverage in this goal was made with. Asking it the literal question — *is `npm run spec` over each touched
package met for a workspace with no suite?* — printed **not one line** and exited **0**. Its documented
contract is exit 3, *"the target exists and no spec covers it, so nothing ran and nothing passed"*, and the
report behind that code is built per **run**: a plan with no runs in it had nothing to report, so the code
came out 0. The named-target case fell through the guard above it, which required `targets.length === 0`.

It says the sentence and exits 3 now, `--dry` still reporting an empty plan as a report, and the other two
codes are unchanged — 1 for a name that matches nothing, 2 for one wide enough to be a search. The fact it
rests on is a case in `spec-plan.spec.ts`: a workspace with no vitest config plans nothing and is neither
unmatched nor ambiguous.

This is the rule *"a check that reports nothing may have looked at nothing, and a green run cannot tell you
which"* holding in the command the rule is enforced with. **A goal that asks for a tool's output as
evidence is also a test of the tool**, and this one failed it eight rounds in.

**Two more environment-row facts, covered because the live run could not reach them.** The listing's
live-app annotation had exactly one piece of evidence — a `development` row with an app on it — and
launching one on each of the four is not available, `production` being the user's own data. The `resolve`
seam answers for all four now, with a real session file and port file per row: which starter is named, the
pid, a row for an app that published no session (a packaged build, which must still read as occupied
because what it guards is `apack db` writing underneath one), and a session whose process has gone. Four
mutations fire — the row dropping its session (6 cases), the wording collapsing to `(running)` (1), the two
starters swapped (1), and `inUse` ignored (6).

**Four Phase 1 directory guards were mutated too, and the fourth could not fire.** The name rule removed
fails 3 cases; `removeProfile`'s "not a profile" guard, 5; its in-use guard, 2. `profileDir`'s containment
check failed nothing — and the reason was not that it is unreachable behind the name rule, which it is, but
that **it could not fire at all**: it compared `path.resolve(root, name)` with `path.join(root, name)`, and
both normalise `..` identically, so the two sides agreed on every input. With the name rule weakened,
`../../apack` resolved to the real production data dir and was *returned*. It is `path.dirname(dir) !==
root` now — the claim its comment was always making — which throws under that same edit, and the comment
names the edit, since an assertion's firing case is an edit rather than an input.

That is the root guide's *"two clauses keeping it equal to the inputs cannot fail"* in a place where the
consequence is `fs.rm` on a directory nobody named. It had been read, reviewed and recorded as the belt to
the name rule's braces. **A guard whose mutation changes nothing is the finding**, not a gap in the test —
which is the one thing this table is for.

One mutation in the first attempt at `freshProfileName` was **malformed** — it added a parameter no caller
passes, so nothing fired, and nothing *should* have. It was replaced with the real failure mode (`askTarget`
creating the dir) rather than counted. A mutation that changes something unreachable proves nothing about
the test; it only proves the mutation was wrong.

**What this goal cost to get right, in one line**: the implementation was seven phases and the evidence was
four more rounds, because a record that asserts a property reads exactly like one that checked it.
