# Terminal session ownership — evidence

Checkpoint history and the acceptance table for
[goal-terminal-ownership](../../goals/goal-terminal-ownership.md). Findings keep their authoritative home in
[the terminal integration review](../../issues/ISSUE-terminal-integration-review.md); this record owns their
**disposition** and the evidence that closed each one.

## Acceptance table

One row per finding, added when the finding is touched rather than pre-seeded — the review document is the
list, and a copy of it here would drift from it.

A row closes only as the goal's decision D6 allows: a test that fails before the change and passes after, or
an explicit `driven: <what was done>` with the reason no test fits. `dissolved` records that the destination
removes the finding rather than fixing it, and names the construction that does.

| Finding | Disposition | Implementation | Evidence | Guard | Remaining |
|---|---|---|---|---|---|
| T4 | test | correlation work, pre-goal | `tests/features/code/fe/terminal-opens-for-the-asker.spec.ts` | the spec itself | — |
| M3 | test | correlation work, pre-goal | `tests/features/code/be/terminal-answers-the-asker.spec.ts` | the spec itself | — |
| S2 | test | `apack-host/src/bus/client-events.ts` — payload out of the log, `summarizeEventForLog` deleted | `apack-host/tests/bus/client-events.spec.ts` "lets no part of a payload reach a log, by any field" | the sentinel search over the serialized record: re-adding a payload under any key fails it. Mutation-checked — restoring `event` to the log fails 3 cases | — |
| S1 | test | the token captured and deleted at boot (`api/src/boot/config.ts`, called from `server.ts`); the shell's environment derived from `APP_PROCESS_ENV_VARS` (`apack-sdk/src/env/index.ts`, `default-setup/src/features/code/be/services/shell-environment.ts`) | `api/tests/transport/api-access.spec.ts` "is gone from the environment once captured"; `default-setup/tests/features/code/be/services/shell-environment.spec.ts` "keeps none of the variables the app set on its own process" | both specs, plus the typecheck: `getEnvironment`'s record is typed `AppProcessEnv`, so a variable added there and not named in the list, or named and not set, fails to compile. Mutation-checked three ways — dropping the `delete`, writing the strip list out by hand, and both directions of the record | closes G2 and G4 |
| F9 | test | every failure goes through one `failTerminal` (`features/code/be/features/terminal.ts`), which calls `reportError` and answers the asker; the surface's write-only `terminalError` field and its three `clearTerminalError` wirings deleted, the settle kept as `settleFailedAsk` | `default-setup/tests/features/code/be/terminal-failures-reach-the-user.spec.ts`, three cases | the spec: removing the `reportError` call fails all three. `terminal.ERROR` is also out of `TerminalNewsType`, so broadcasting one no longer type-checks | — |
| X3 | test | `main/src/modules/app-menu.ts` — renamed from `MacOSAppMenu.ts`, since it is no longer one platform's; `appMenuTemplate(platform, env)` is pure, and off macOS returns devtools and fullscreen alone so Electron's default is never what stands | `main/tests/app-menu.spec.ts`, six cases | the spec: an empty off-macOS template fails it (Electron's default would stand), and so does any accelerator or role carrying a key a shell needs. Mutation-checked both ways |
| X10 | test | `apack-sdk/src/fe/hotkeys.ts` — `cmd` resolves to the platform's accelerator, Meta on a Mac and Control elsewhere; `ctrl` unchanged, which is what the two `Ctrl+\`` defaults want | `apack-sdk/tests/fe/hotkeys.spec.ts`, seven cases over the shipped defaults | the spec, with the platform as an argument so both are checked from either. Mutation-checked: restoring the `=== event.metaKey` comparison fails four, and the three it leaves are the Mac and `ctrl` cases that must not move |
| the janitor's reach | test | `scripts/lib/vendored-checkouts.ts` — `rustCheckoutsIn` over `vendoredCheckouts(repoRoot)`, so `janitor.ts` names no checkout; `scripts/janitor.ts` keeps the fs walk and worktree listing | `repo-checks/tests/vendored-checkouts.spec.ts` | the spec mutates the listing: adding a link must change the answer, and an empty set throws rather than answering `[]`. Mutation-checked separately — filtering on the name `elmdb` fails the first, making the empty case fall through fails the second. Verified in place: `npm run janitor -- --dry` still reports the same four targets |
| the container's toolchain | test | `oneRustToolchain` in the same module, over every linked Rust checkout with elmdb's entry replaced by `APACK_LINUX_ELMDB_ROOT` when a run is qualifying a frozen one (`scripts/linux-runner.ts`) | `repo-checks/tests/vendored-checkouts.spec.ts`, four cases | the spec: a disagreement throws naming both paths and both channels, an unpinned checkout names the file, an empty set throws. Mutation-checked — taking the first channel fails the disagreement case. Verified in place: the resolved channel is still `1.99.1`, so the image key does not move |
| T1 | test | `fe/features/terminal/state.ts` — the replacement excludes the closed terminal by id rather than relying on a queued assign having landed | `tests/features/code/fe/features/terminal/panel-terminal.spec.ts` | the spec: restoring the snapshot-order dependence fails two cases, including the single-terminal one |
| T2 | test | `fe/utils/tab-management.ts` — `removeTabs` no longer exempts a pinned tab; every caller is a subject that is gone, and none is a user closing a tab | `tests/features/code/fe/utils/tab-management.spec.ts` | the spec: restoring the exemption fails two cases. `isPinned` elsewhere governs placement and drag-drop only, so nothing else relied on it |
| T3 | test | `fe/state.ts` — settling a restore writes nothing to storage, keeps the metadata of a path that has not arrived, and prunes groups against what is still expected | `tests/features/code/fe/state.spec.ts`, four cases | the spec: restoring the persist, the metadata clear or the open-files-only prune fails three cases. The every-startup `console.info` now fires only when something is outstanding |
| T5 | test | `fe/features/terminal/state.ts` — a terminal routed to the panel expands it, which covers every panel open rather than the one menu item | `tests/features/code/fe/features/terminal/panel-terminal.spec.ts` | the spec, plus the three assertions in `terminal-opens-for-the-asker.spec.ts` that name the panel update's shape |
| T6 | open | not attempted | — | — | its honest fix is restart-in-place, which needs the session generation **Phase H** delivers ("a crashed shell is a new generation whose predecessor's transcript is labelled history"). Carrying a tab's pin, group and position across a kill-then-create is a hack Phase H deletes — the shape T7 was excluded for. Closes there, `dissolved`, with the generation as its guard |
| T8 | test | `fe/composables/useTerminalActions.ts` — `customTitle` then `title`; the cwd derivation is the backend's and was being overridden here | `tests/features/code/fe/composables/use-terminal-actions.spec.ts` | the spec: restoring the cwd basename fails the case where a create passed a title |
| T9 | test | `fe/state.ts` — `moveTerminalToPanel` prunes the group it emptied, as the four other removals in that machine do | `tests/features/code/fe/state.spec.ts` | the spec: dropping the prune fails it |
| G3 | open | fixed on `session/claude-code-integration` (#372), not on master | `hooks.ts` calls `killAllHandles()` there | — | closes when #372 lands; confirm it survives the cleanup pass |

Disposition values: `test`, `dissolved`, `driven`, `open`.

**Guard** is required for `dissolved` and is what makes that disposition mean anything: the check that fails
if the construction which removed the finding is undone. A `dissolved` row with no guard is **not** closed —
it is unverified and stays `open`. For a `test` row the spec is its own guard. The goal's acceptance section
lists the guards its sixteen dissolved findings are expected to carry. A fix that exists only on an unmerged branch is
`open` with its branch named: the goal runs against master, and a row that reads closed because another
branch closed it is how a regression gets shipped.

## Checkpoints

None yet. Each entry carries its date, source commit, the exact commands run and their results, and any
limitation the run did not cover. A failed check stays visible until it is resolved.

### VT parsing cost (Phase G) — not taken

The reading that sizes the broker's parsing worker and its history cap, with its corpus and conditions. It
is not a decision input: D11 settles the broker's language on native process ownership and ABI
independence, neither of which a parsing reading speaks to. An earlier revision of the goal made this
reading the premise that chose the language, which would have answered a question whose real support lies
elsewhere — `worker_threads` is already how this repo keeps compiler work off a loop, so off-loop parsing
was never the discriminator.

### Terminal attach latency (Phase G, reading 1 of 6) — 2026-11-07

**One of Phase G's six readings, and it is not the one a user feels.** Recorded so the figure is cited
rather than copied; the other five are not taken.

`APACK_PERFORMANCE_SCENARIO=terminal-open npm run test:e2e -- --config tests/performance/playwright.config.ts`,
on a machine `npm run check:idle` passed at the 70% floor first.

| | |
|---|---|
| **Median** | **20.7 ms** |
| Range | 18–25 ms |
| Trials | 20 measured, 20 passed, 0 unsuccessful; 5 warmups, warm process, `lightweight` |
| Source | `a37ba66ceb`, clean; 6 build hashes and the elmdb pin `4b67670` recorded in the run's `manifest.json` |
| Machine | darwin arm64, 10 cpus, 32 GiB (identity `d74b1b3a…`) |
| Runtimes | Electron 44.9.3, Chromium 152.0.7977.167, app Node 24.22.0 |
| Fixture | `terminal-open-v1`, 25 terminals at 80×24, `/bin/zsh` (`sha256` in the manifest) |

**What it measures is attachment: from `terminal.CREATE` to a terminal attached and on screen**, which is
the surface recording it as the panel's and expanded plus xterm's renderer canvases in place. It is **not**
first-byte latency, and that is a limit of what the page can observe rather than a choice — xterm renders to
a canvas, so there is no `.xterm-rows` text to read the screen from, and the buffer lives in the xterm
instance inside the pack's module-scoped pool. The scenario's doc comment has the probe that established it.

**The consequence for Phase B is the point of taking it.** 20.7 ms says the renderer's half of opening a
terminal is nearly free, so what a user waits for is the pty spawning and the shell starting — which this
reading does not cover. So the goal's constraint that "the broker can lose on the metric it is measured by"
cannot be checked against *this* number: a broker adds its cost to the part that is still unmeasured. The
first-byte reading has to exist before the broker's first-open latency can be compared to anything, and it
needs a byte-level signal rather than the DOM.

### Baseline (Phase G) — the remaining five readings, not taken

Still outstanding: **sustained output responsiveness**, **large-history replay**, **memory with several
hidden sessions**, **resize behaviour** and **packaged payload size**, plus the parsing-cost reading
(`npm run measure:loop`). The first three need an output corpus and a byte-level completion signal, which
the attach reading above establishes is not available from the DOM — so that signal is the next thing to
build, and it serves the first-byte reading too.

The baseline is unrepeatable once Phase B moves state, and the
[ghostty-web migration](../../deferred/xterm-to-ghostty-web.md) requires the same measurement for its own
cutover, so both cite one reading rather than two. Each is recorded here when taken, with its machine, its
corpus and its conditions — the terminal scenario's `manifest.json` carries them, which is why Phase G's
instrument is `tests/performance/` and not a driving script.
