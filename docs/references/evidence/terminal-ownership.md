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
| G1 | open | priced, not fixed — see [the pricing](#g1-priced-what-the-throttled-writer-writes-to-ears--2026-11-07) | three streaming runs at 24, 60 and 120 chunks; `ears.write` request bytes on the app database | — | the mechanism and its cost model are measured and the review's 15 MB figure confirmed. The fix is a delta feed beside a less frequent durable write, which is the output pipe's payload discipline the review assigns it to — the writer alone cannot fix it, since the 80 ms write is what updates the window |
| F5 | priced | not fixed — `services/terminal.ts:145` writes inside `resize()` | `terminal-resize` scenario: 24 resizes, 24 app writes, 2,112 bytes, 10/10 trials with min = max | — | dissolves in Phase B, whose acceptance names the guard ("a resize writes no application row"). This is its before |
| F18 | open | found by the resize scenario, not fixed | the scenario's first attempt timed out at `cols: 80` after 24 writes had landed | — | new; recorded in the review. Adjacent to M2 and not the same defect |
| F4 | priced | not fixed — one `broadcastToSurface` per pty chunk | `terminal-output` scenario: 64 KiB of output → 115 messages, 76,824 bytes, 10/10 trials | — | dissolves in Phase B, whose guard ("N MB of output produces at most M channel messages") now has its before: ~1,840 messages and 1.2 MB per MB |
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

### G1 priced: what the throttled writer writes to EARS — 2026-11-07

**The review states G1's severity is an inference from reading, and Phase G prices it. This is that price.**
Taken with the existing `streaming` scenario, which drives the real Claude Code chat flow through
`stream-consumer.ts`'s writer at `intervalMs: 80` — G1's exact subject — and reading the backend's
`ears.write` spans' `ears.request_bytes` on the app database. **Byte counts, not durations**: a span's
request size is unaffected by machine load, which is why these did not wait on `check:idle` and why no
latency from these runs is cited.

| | 24 chunks | 60 chunks | 120 chunks |
|---|---|---|---|
| Reply characters | 864 | 2,160 | 4,340 |
| App write spans | 39 | 51 | 70 |
| **App write bytes** | **9,726** | **30,054** | **95,924** |
| The writer's own (>150 B) | 7,238 | 27,566 | 93,450 |
| Flushes | 15 | 27 | 46 |
| Largest single write | 974 | 2,270 | 4,450 |
| **Bytes written per character** | **11.3** | **13.9** | **22.1** |
| Trials | 20 measured, clean | 10 measured, clean | 1, see below |

Fixtures `dee70d9e4785` and `1fb312fa24f6`; both runs' backend reports had `truncated: false`, `dropped: 0`.
The 120-chunk trial **failed on `backlog-progress-data` only** — `streamingBacklog` records at most 64
progress points — while its action completed correctly with a complete backend report, so its write data is
sound and its latency is not cited. The knob now refuses a count past 64 where the count is set, rather than
letting a correct stream fail its bookkeeping later.

**The mechanism is confirmed, not inferred: every flush writes the whole accumulated text.** The writer's
writes are a monotonic staircase in ~108-byte steps — the chunk size — `226, 235, 328, …, 875, 983, …,
4,386, 4,450` at 120 chunks. And the cost follows one model, which the three sizes confirm to within 10%:

> **bytes written ≈ flushes × (final size / 2)**, where **flushes ≈ duration / 80 ms**

Checked: 15 × 974/2 = 7,305 against 7,238; 27 × 2,270/2 = 30,645 against 27,566; 46 × 4,450/2 = 102,350
against 93,450. So it is **quadratic in reply length at a fixed chunk rate**, and linear in duration — which
is why bytes-per-character climbs from 11.3 to 22.1 as the reply grows.

**The review's headline figure survives being measured.** It estimated ~15 MB for a 40 KB reply over 60
seconds. The model gives 60,000/80 = 750 flushes at an average 20 KB payload = **15 MB** — the same answer,
now resting on a measured per-flush payload and a measured flush rate rather than on two assumptions. Worth
recording because the repo's rule is to measure before accepting someone else's measurement, including its
own, and here the inference was right.

**Also measured: the 24 small writes are fixed overhead, not per-chunk.** They stay at 24 whether the reply
has 24 chunks or 120, so they are the trial's other rows, and an earlier reading of them as one-per-chunk was
wrong.

**Where the fix belongs, which this pricing settles.** The writer cannot fix this alone: the window renders
streamed text from the **view** over the stored row, so the 80 ms write *is* the UI update, and lengthening
the interval degrades the stream rather than making it cheaper. The fix is a delta **feed** beside a much
less frequent durable write — which is what this pack's own rule already prescribes for a feed, "patch what
a window already holds, as streaming tokens would" — and that is the output pipe's payload discipline the
review assigns G1 to, not a change to `stream-writer.ts`. G1 therefore stays **open** with a measured price
and a named home, rather than closing on a fix that would trade the defect for a worse one.

### Packaged payload (Phase G, reading 2 of 6) — 2026-11-07

What the terminal stack costs in shipped output, which the broker and the ghostty migration both change.
Measured against the build at `be5e8aae87`: the frontend share by attributing each chunk's generated bytes
to its sourcemap's `sourcesContent` (so it is the bundled cost, not the `node_modules` cost), and the native
share from the files `electron-builder.mjs` actually includes.

| | bytes |
|---|---|
| **xterm in the pack's frontend** | **502 KiB** — xterm 318, addon-webgl 139, addon-unicode11 34, addon-clipboard 6, addon-web-links 3, addon-fit 2 |
| node-pty native, darwin-arm64 | 136 KiB (`pty.node` 84, `spawn-helper` 52) |
| node-pty's JavaScript | 264 KiB |
| node-pty native, win32-arm64 | 704 KiB (`pty.node` 288, `conpty.node` 296, `conpty_console_list.node` 120) |
| `third_party/conpty` OpenConsole | 2,508 KiB for both Windows arches |
| **win32-arm64 `.pdb` debug symbols** | **26,172 KiB** |

**Two of those rows ship and should not, which the filter shows rather than implies.**
`electron-builder.mjs`'s `files` excludes `*.map`, `*.ts`, tests and markdown, and `excludePrebuilds` drops
other platforms' `prebuilds/` — but neither excludes `*.pdb` nor `third_party/`. So a **Windows** package
carries ~26 MB of node-pty debug symbols nothing loads, and **every** package, the macOS one included,
carries 2.3 MB of Windows `OpenConsole.exe`. Recorded and not changed: packaging is release configuration
and outside this goal.

Net, the terminal stack is **~0.9 MB of code that does work** on macOS (xterm bundled, the native pty, its
JavaScript) beside 2.5 MB that is there by omission. That is the figure a single broker binary per platform
is compared against, and the comparison should use the 0.9 MB rather than the 29 MB a naive `du` of
`node-pty` suggests — the 64 MB that package occupies on disk is almost entirely other platforms' prebuilds
and their symbols.

### Resize behaviour (Phase G, reading 3 of 6), and F5 priced — 2026-11-07

`APACK_PERFORMANCE_SCENARIO=terminal-resize`, 24 resizes per action — the shape a panel drag has, one per
observed frame — counting `ears.write` spans on the app database. **Write counts, not durations**: identical
in every trial, where the durations are not and are not cited.

| | |
|---|---|
| Resizes per action | 24 |
| **App writes** | **24** |
| **App write bytes** | **2,112** (88 bytes each) |
| Trials | 10 measured, 10 passed; min = max on every count |

**F5 is exactly as claimed: one EARS write per resize, no coalescing.** `services/terminal.ts:145` writes
the row inside `resize()`, so a drag writes a row per frame. The guard Phase B's acceptance names for this —
"a spec asserting a resize writes no application row" — has its before: 24.

**And the scenario turned up F18, which the review did not have.** The first attempt completed on the
surface's record of its terminal's size and timed out at `cols: 80` while 24 writes had already landed:
`resizeTerminal` answers only on failure and broadcasts nothing, so **no window is ever told a resize
happened** and the `TerminalInfo` in a surface's `terminals` keeps the size the terminal was created with.
Asking for the list again is the only way a window learns its own terminal's size, which is what the action
now ends with. That is adjacent to M2 but not the same defect: M2 is about which window's size wins, this is
that none of them knows.

### Hidden sessions (Phase G, reading 4 of 6) — 2026-11-07

`APACK_PERFORMANCE_SCENARIO=terminal-hidden`, 12 measured trials, each opening one more terminal and
**keeping every earlier one alive** — so trial N runs with N sessions and only the newest visible, and the
reading is a curve rather than a number. 16 terminals at the end, all passed.

| sessions | backend heap | renderer heap | Nth open |
|---|---|---|---|
| 1 | 68.7 MiB | 40.2 MiB | 21.7 ms |
| 4 | 77.8 MiB | 45.6 MiB | 10.1 ms |
| 8 | 89.9 MiB | 46.0 MiB | 10.8 ms |
| 12 | 101.9 MiB | 52.6 MiB | 9.8 ms |
| 16 | 113.9 MiB | 50.2 MiB | 8.2 ms |

**~3.0 MiB of API-process heap and ~0.67 MiB of renderer heap per idle session** (45.2 MiB and 10.0 MiB
across 15 added sessions), so **16 idle terminals cost about 59 MiB of heap across the two processes**. That
is the figure the broker changes most directly: today each session's pty, its reader and its xterm live in
those two processes.

**Cite the heap, not the RSS.** `rssSampledMaxBytes` fell from 296 MiB to 129 MiB across the same run while
the heap rose monotonically — it is a per-trial maximum of a process that was shrinking from an earlier
peak, so it says more about when the collector ran than about what a session costs. The heap figures are
monotonic and linear, which is what a per-session cost should look like.

**And the Nth open does not get slower**: 8–11 ms at every count after the warmups, against the 20.7 ms
first-open median taken on a fresh app. So nothing in today's implementation degrades with session count,
which is a property the broker has to keep rather than one it needs to fix.

### Sustained output (Phase G, reading 5 of 6), and F4 priced — 2026-11-07

`APACK_PERFORMANCE_SCENARIO=terminal-output`: a fixed 64 KiB corpus (`head -c 65536 /dev/zero | tr '\0' x`),
10 measured trials, all passed. Completion is the shell exiting — the one end-of-output signal a page can
see, since xterm draws to a canvas.

**This reading needed instrumentation that did not exist.** Nothing recorded the app's outgoing traffic, so
`app.surface.send` was added at the API's `emitOutgoing` — the one funnel everything a client receives
passes through — carrying the event type, the target and the **byte size**, never the content. Checked
against the observer effect it could have introduced: the resize reading re-run with the recorder in place
is byte-for-byte what it was without it (24 writes, 2,112 bytes, min = max).

| | median | min | max |
|---|---|---|---|
| **Output messages** | **115.5** | 115 | 116 |
| **Bytes on the bus** | **76,824** | 76,709 | 76,915 |
| Renderer task time | 51.0 ms | 44.2 | 96.0 |
| Renderer script time | 18.8 ms | 16.0 | 30.0 |
| Delivery | 1,389 ms | 1,243 | 1,991 |

**F4 is as claimed: one bus event per pty chunk, no coalescing.** 64 KiB of output becomes **115 messages**
at ~665 bytes each, and **1.17 bytes cross the bus per byte the shell wrote** — the overhead being JSON
escaping and the envelope. Phase B's guard for this — "N MB of output produces at most M channel messages" —
now has its before: **115 messages and 76.8 KB per 64 KiB**, or about 1,840 messages and 1.2 MB per MB.

**Two things to carry into Phase B.** The renderer spends ~51 ms of task time on 64 KiB, so a megabyte of
output is roughly 800 ms of main thread at today's shape — which is the cost a bounded channel is meant to
cap. And delivery took 1.39 s for 64 KiB, which is the pipe's rate rather than the shell's: `tr` writes it
in small chunks and every one becomes a message.

**A correction worth recording.** A first attempt sent `terminal.TERMINAL_INPUT` to the surface — the
*system's* event name — which the surface's child drops silently, so the command never ran and only the
shell's prompt came back. I read that as the review's X6 (LF not submitting a line) reproducing on macOS and
was wrong: with `terminal.INPUT`, `\n` submits correctly. X6 stays a Windows finding. The near-miss is the
reason the rule says to measure before accepting a measurement, including one's own — and why the drop was
silent is itself worth noting beside F18.

### Large-history reattach (Phase G, reading 6 of 6) — 2026-11-07

`APACK_PERFORMANCE_SCENARIO=terminal-replay`: a terminal carrying **256 KiB** of scrollback, the action
navigating off the code surface and back. 10 measured trials, all passed.

| | median | min | max |
|---|---|---|---|
| **Reattach** | **5.55 ms** | 4.80 | 6.20 |
| Backend sends during it | **0** | 0 | 0 |
| Backend bytes during it | **0** | 0 | 0 |

**Nothing is replayed, which is why it is 5.55 ms.** The backend sends not one message, so the history does
not come back over the bus; and 5.5 ms is far too little to rebuild an emulator around 256 KiB. The pool
keeps the xterm alive across the host's teardown on purpose — `TerminalView.vue` says so where it detaches
("Detach the pool's wrapper from our container but DO NOT dispose the xterm") — so a reattach re-parents an
instance that never went away.

**So this reading is a property to preserve, not a cost to reduce**, and that is the opposite of what a
"replay" reading was expected to show. Two consequences for the rewrite:

- **Phase P must not make this a replay.** A presentation seam that discards the emulator on teardown would
  turn 5.5 ms into the cost of re-parsing 256 KiB, and the before above is what that regression would be
  measured against. The migration plan's own cutover wants the same number.
- **It is also F3 and F6's mechanism, shown rather than argued.** The window answers a reattach from a copy
  it is already holding, which is what those two findings are about — the second and third copies of the
  scrollback. Cheap reattach and duplicated scrollback are the same design decision, so Phase P trades one
  against the other rather than fixing both.

### Phase G's readings are complete

All six are above: attach latency, packaged payload, resize, hidden sessions, sustained output and
large-history reattach — with **G1, F4 and F5 priced** along the way, and **F18** found. Two things Phase G
asks for remain:

- **The parsing-cost reading** (`npm run measure:loop`), which the goal records as baseline data rather than
  a decision input, and which needs a quiet machine.
- **Declaring the bounds** as named constants "in the broker and the presentation seam" — which cannot land
  before those exist. The figures they take their values from are recorded here; the rule each takes is
  Phase G's to state when Phase B and Phase P build the places they live.

### Baseline (Phase G) — superseded

What no reading above covers, and why: **first-byte latency** and **whether a reattached screen's contents
are correct**. Both need a read through the emulator, which the DOM cannot give — xterm draws to a canvas
and its buffer is inside the pack's module-scoped pool. Phase P's seam provides it, and Phase P's own
acceptance already requires driving `vim`, `less` and `htop` through a reattach, which is the same read.

The baseline is unrepeatable once Phase B moves state, and the
[ghostty-web migration](../../deferred/xterm-to-ghostty-web.md) requires the same measurement for its own
cutover, so both cite one reading rather than two. Each is recorded here when taken, with its machine, its
corpus and its conditions — the terminal scenario's `manifest.json` carries them, which is why Phase G's
instrument is `tests/performance/` and not a driving script.
