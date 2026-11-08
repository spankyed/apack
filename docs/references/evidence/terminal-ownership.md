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
| F5 | dissolved | the service writes no row on resize (`be/services/terminal.ts`); `terminalCommands.resize` deleted as unread | `default-setup/tests/features/code/be/terminal-owns-no-process.spec.ts` "writes no row when a terminal is resized" | **the guard**: 24 resizes must leave `updatedAt` unmoved. Mutation-checked — any row write during a resize fails it. Its before is the priced 24 writes / 2,112 bytes above |
| F7 | dissolved | the Terminal entity declares no `pid`, `updatePid` is gone, and `restoreAll` reaches for no stored process; the live descriptor keeps a pid because the renderer tells a new shell from the old by it | `default-setup/tests/features/code/be/terminal-owns-no-process.spec.ts` "declares no pid on a Terminal row" | **the guard**: the attribute must not be on the row at all, which is what a later `restoreAll` would need. Mutation-checked — putting `pid` back fails it |
| F8 | dissolved | `services.terminal.open` takes the listeners, so they exist before the session does | `default-setup/tests/features/code/be/terminal-owns-no-process.spec.ts` "hands the output listener to the service at open" | **the guard**: what the shell writes immediately reaches the surface. Mutation-checked — a listener that drops it fails. The *given at open* half is the contract's second argument, which the typecheck requires |
| L2 | dissolved | `killAll` marks every row closed and `restoreAll` is no longer unbounded by a stored pid | `default-setup/tests/features/code/be/terminal-owns-no-process.spec.ts` "leaves no active row behind when every terminal is killed" | **the guard**: no active row survives `killAll`. Mutation-checked — dropping the `markClosed` fails it |
| F4 | dissolved | the broker coalesces output per session on a 16 ms window or a 64 KiB cap, and output is bounded by credit while answers carry none (`apack-terminal/src/output.rs`) | `apack-terminal/tests/channel.rs`, plus the `terminal-output` scenario re-run in the app: **6 messages for 64 KiB against 115 before** | **the budget, with a before and after**: ~96 messages per MB against the ~1,840 Phase G measured. Mutation-checked — flushing every chunk fails the coalescing case, and not reporting a wait fails the overload case |
| X1 | dissolved on POSIX, open on Windows | killing a session reaps its grandchildren; the broker owns the processes a run leaves behind, and ends a connection's sessions when it closes | `apack-terminal/tests/broker.rs` "killing a session takes the whole tree with it", "a client that disconnects leaves no shell running" | **the guard, with its mechanism measured**: a mutation keeping the pty master open still passed, so it is the kernel sending SIGHUP to the pty's foreground group when its session leader dies — a POSIX property. `command-group` is a dev-dependency for that reason | Windows: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and a Windows run, which the goal requires and a Mac cannot give |
| portable-pty validated | — | containment, cancellation and resize under an alternate screen | `apack-terminal/tests/broker.rs` three cases: a trapped, busy shell is still killed; `less` is resized three times, redraws, survives and still takes input | each its own case; the resize one is mutation-checked. Every read is bounded by the socket's receive timeout, after that mutation turned a blocking read into a ten-minute hang | ConPTY resize and exit need Windows |
| F3 | dissolved | the bus keeps no per-terminal string; the quadratic concatenation and the `getOutput` a replay read are deleted, not made cheaper | `default-setup/tests/features/code/fe/utils/terminal-events.spec.ts` "exposes no accumulated output to read back" | **the guard**: the prototype's own methods are asserted, so adding a buffer or a reader fails it. Mutation-checked — restoring the accumulation fails two cases |
| F6 | dissolved | no window-storage write at all; the debounced per-terminal copy and its pruner are deleted | `default-setup/tests/features/code/fe/utils/terminal-events.spec.ts` "writes nothing to window storage, however much output passes through it" | **the guard**: a megabyte through the bus must leave storage empty, read through the Storage API. Mutation-checked |
| the journeys the complaint was about | driven | `drive/terminal-journeys.ts` — open a terminal and run a build; scroll back during output; drag the divider mid-command; kill a terminal with a child process running; a renderer reload. With `terminal-alternate-screen.ts`'s tab switch and its `less`, that is the goal's list | the run's report and five screenshots, 2026-11-07 | **three of them answer in numbers, and each is a finding seen from the app.** Scrolled back to 30% with 4,000 lines still arriving, the viewport stayed at 19,420 of 64,735 — F2, which would have put it at the bottom. A terminal killed with a `sleep 600` under it left `childrenLeftRunning: []` from a child that existed before the kill — X1, through the broker rather than through a pid. And the build terminal came back after a renderer reload. No terminal error in the log | the app-restart journey is the renderer's half only; the other half is the Phase H fork |
| node-pty returning to the pack | test | `check:specifiers`' `findNodePtyImports`, the shape `APP_ONLY_EXPORTS` has for `@apackdev/ears/lmdb` applied to the one native module left | `repo-checks/tests/import-specifiers.integration.spec.ts` `findNodePtyImports`, three cases, plus the per-rule firing table | **the guard the goal's acceptance names for this row.** A pack asks `services.terminal` for a session; an addon loaded in a pack puts a pty back in the API process and brings the Electron-ABI rebuild with it. The subpath case matters because a binding is reached that way when the root is watched. #372's two pack importers have to migrate to the service before that branch merges, which is the seam Phase B built for them | — |
| F13 | dissolved | the allow-list is derived rather than listed: a shell is started when it is the user's own `$SHELL` or one `/etc/shells` names, which is what `chsh` validates against — so fish, nushell and a Homebrew bash are covered without anyone enumerating them, and the answer moves when a shell is installed rather than when a file is edited (`be/services/known-shells.ts`) | `default-setup/tests/features/code/be/services/known-shells.spec.ts`, eight cases | **the guard**: the fallback must be a *different* value from the one refused, which is the whole of the finding — the list that was here fell back to `$SHELL`, the same value that had just failed it on any machine whose login shell was not one of its eleven paths. Mutation-checked: restoring that shape fails a case, and so does matching on a basename, which let `/tmp/zsh` pass as `zsh`. One case reads the real `/etc/shells`, so the derivation has a subject on the machine it runs on | — |
| S3 | dissolved | a restored row's `shell` and `cwd` go through the same check a created one does, rather than straight to a spawn | `default-setup/tests/features/code/be/terminal-restores-data-not-a-command.spec.ts`, three cases | **the guard**: a row naming something this machine does not start must not be started, a directory that is not one must not be entered, and a row naming a real shell must still come back as that shell — the third is what stops the refusal being about restoring rather than about the value. Mutation-checked: spawning the row's shell fails the first. It could not have been written before F13, which is the ordering the review names: a check whose remedy is the value it refused changes no outcome | — |
| a session outliving its client (Phase H) | open | not attempted | — | — | **a fork the goal does not settle**, recorded in Current handoff rather than chosen: the broker ends a connection's sessions today, deliberately, because a pack's `onShutdown` cannot await a socket write — so it is the backstop for an app that quits, crashes or is killed. Keeping sessions across a disconnect removes that backstop, and the three candidate replacements (keep until killed; a grace period; Electron main ending the broker on `will-quit`) are each user-visible and each cost something different |
| a second window observing | test | nothing was needed on this side: a host attaching writes nothing to the shell and injects nothing — shell integration is injected once, at create | `default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts` "sends nothing to the shell when another host starts drawing it" | an assertion rather than a gate, and the comment says which edit would make it fire: anything written on attach. The resize half is M2's row above | — |
| M5 | dissolved | the shell answers `ownsAppLayout` on `SURFACE_STARTED` — the same fact it records the last-open surface by — and `persistCodeTabs` writes nothing without it; a popout reads the layout and writes none | `default-setup/tests/features/code/fe/state.spec.ts` "which window keeps the layout", three cases | **the guard**, and it took a mutation to make it one: the first version used a machine whose restore had not settled, which saves nothing at all, so all three cases passed with the gate removed — *a check that reports nothing may have looked at nothing*, inside the check. Over a window that would write, both mutations fail: every window writing, and the shell's answer never being recorded | — |
| M4 | dissolved | `markRestart` writes a seam naming the pid answering now, from `ensure` and from `syncProcesses` — so a window meeting a terminal whose process was replaced is told, whether it mounted before or after the list arrived | `default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts`, two cases | **the guard**: the seam must appear when the pid moved and must not appear when it did not. Mutation-checked both ways — writing no seam, and writing one on every list, each fail a case. A seam on every list would be noise in the one place a user is reading output | — |
| M1 | dissolved | there is no persisted output to write: the byte log and its window storage went with F3 and F6, so the key two windows fought over does not exist | `default-setup/tests/features/code/fe/utils/terminal-events.spec.ts` "writes nothing to window storage, however much output passes through it" | **the guard** is F6's: a megabyte through the bus must leave storage empty. Two windows cannot truncate each other's copy of something neither keeps | — |
| M2 | dissolved | the connection that opened a terminal owns its size (`be/services/terminal.ts`, `sizedBy`); a resize from another is silently ignored, and a session with no owner — a restored one — is taken by the first window that fits it. `client` is what makes it checkable: the API stamps it per connection and nobody can forge it | `default-setup/tests/features/code/be/terminal-one-window-sizes-it.spec.ts`, three cases | **the guard**: a second window's fit must never reach the pty, and the owner must keep sizing after it has tried — the second half is what stops "first writer wins" passing. Mutation-checked: letting every window size it fails all three. Silent on purpose, since nothing failed and telling the user their other window is wider is not a diagnostic they can act on | — |
| the output budget (Phase P) | test | the ceiling is derived from `OUTPUT_WINDOW` and `OUTPUT_CAP` rather than chosen: a message leaves when the window closes or the cap fills, so a run of a given length allows one per window plus one per cap plus the flush at exit | `apack-terminal/tests/channel.rs` "a megabyte of output is coalesced into far fewer messages than chunks" | **load-independent by derivation**, which `messages < 200` was not — a round number is either slack on this machine or flaky on a busy one. Mutation-checked: flushing every chunk puts a megabyte at 1,073 messages against a budget of 93. The before and after over Phase G's own corpus are the `terminal-output` scenario's: **115 messages for 64 KiB, then 6** | the scenario records the reading; the assertion is where the bounds are declared |
| an alternate-screen app moved around (Phase P) | driven | `drive/terminal-alternate-screen.ts` — `less` over a 500-line file, through two window resizes, a tab switch away and back, and the panel taking the same session over, then `G`/`g`/`q` and a command after | the run's report (one session throughout, same id and pid at every stage, never more than one, **no terminal error in the app's log**) and eight screenshots | **driven, and it says which half is which.** The report is machine-checked; whether the screen is *intact* is in the screenshots, because xterm draws to a canvas and no assertion in this repo can read one. What they show: `less` reflowed from 23 rows to 19 and redrew after the resizes, came back whole after the tab switch, redrew again in the panel, and left the alternate screen onto a primary screen still holding the whole session's history. A machine-checkable version needs the broker's screen read reaching the app, which is Phase A's | the canvas goes blank when the panel takes the session over — one wrapper, one place in the DOM, which is D2's one visible host per session rather than a defect |
| the socket path (found by driving) | test | `apack-host/src/services/terminal.ts` — the broker's socket is a 0700 directory in the temporary one named for a hash of the data dir, not a file in the data dir, and a path that still does not fit is refused naming the limit | the drive above, which could not open a terminal at all until this changed | **the defect was invisible to every test and fatal in the app**: `sockaddr_un.sun_path` holds 104 bytes on macOS, and a disposable profile's data dir is longer than that, so the broker exited with *local socket name length exceeds capacity of sun_path* and every terminal failed. A user under a long home directory, a synced folder or a long profile name would have hit the same wall | — |
| the throttle report (found by driving) | test | `apack-terminal/src/output.rs` — `take` times the condvar it waits on rather than the mutex it holds to reach it, and the wait is reported in microseconds | `apack-terminal/tests/channel.rs` "a producer nobody is holding up reports no throttling" and "a saturating producer reports that it was throttled rather than losing output" | **the overload case was passing for the wrong reason.** A megabyte with a stalled reader arrives as sixteen coalesced messages and never touches the bound — about 4 MiB in flight plus the socket's own buffers — so nothing was ever throttled, and what made the case green was the lock-timing bug reporting every flush. The app's log took a line per flush saying it had waited `0ms`. Both halves are mutation-checked: timing the mutex fails the first case, not reporting fails the second, and the second now saturates with 64 MiB read one event per 20 ms rather than by outrunning the shell | — |
| the renderer's seam (Phase P's deliverable) | test | `fe/utils/terminal-pool.ts` — `attach` hands back a `TerminalAttachment`, which owns this host's size observer, scroll and selection listeners and is the whole of a host's reach into the terminal. Both hosts hold one and no emulator type; `@xterm/*` is imported by this module alone | `default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts`, 11 cases; `npm run check:specifiers` rule `findEmulatorImports` | **two guards, one structural and one behavioural.** The rule fails an `@xterm/*` import anywhere else *and* fails when the owner has stopped importing one, so it cannot pass by having no subject. The spec covers the behaviour: four mutations — releasing without naming the host, a released attachment still reporting, a second host not told where the session stands, and `followOutput` not telling its host — each fail a case. The third paste path, which sent the text as a keystroke, went with the rewrite | mounting either component in jsdom needs the surface scope and reka-ui; what the components do with the attachment is read |
| the VT core (Phase B's second layer) | test | `apack-terminal/src/screen.rs` — `alacritty_terminal` fed the same bytes the renderer draws, **before** they leave for it; 1,000 lines of history as a declared constant; `Request::Screen` answers the viewport with up to the history asked for, and `BrokerSession.screen()` is the app's side | `apack-terminal/tests/parser.rs` (4 cases, 8 streams, 256 proptest cases); `tests/broker.rs` "a session answers a bounded screen read"; `apack-host/tests/broker/client.spec.ts` "reads a session's screen, and gives each answer to the session that asked" | **the parser is tested as a parser**, which is what Phase P asks for: `insta` snapshots of the grid, and the same stream split at every byte boundary — exhaustively for one cut, one byte at a time, and at arbitrary cuts — demanding the same grid. Mutation-checked four ways: not feeding the screen, ignoring the history asked for, resetting the parser per chunk, and keeping the wide-char spacers each fail a case. The client's correlation is mutation-checked separately | ConPTY's screen needs a Windows run |
| the protocol as a recorded file | test | `scripts/broker-protocol.ts` with `protocol:check`/`protocol:update`, a chain step and a member of `RECORDED_FILE_CHECKS`, so a stale copy fails `npm run typecheck` | its own halves: `protocol:update` rewrote the file for the `Screen` message and `protocol:check` then passed; the refusal for an off-pin checkout fired on the first run, naming both commits | **it re-derives rather than compares**: the answer is re-taken by asking ts-rs to generate the declarations again from the pinned checkout's Rust, which is this repo's rule for a recorded file. It is 0.4s warm. Where it cannot look — no `vendor/apack-terminal` linked — it says so on its result line rather than passing silently | — |
| L3 | dissolved | `markClosed` trashes the row, which is the one way a Terminal row ends; the unreached `delete` beside it is gone, and with the row removed rather than annotated the `active` attribute and the `closedAt` nothing read are both unnecessary — `terminalQueries.all()` replaces `active()` | `default-setup/tests/features/code/be/terminal-owns-no-process.spec.ts` "leaves no row behind when every terminal is killed (L2, L3)" | **the guard**: after `killAll` the query must answer nothing at all, not merely nothing active. Mutation-checked — annotating the row instead of trashing it fails it. The typecheck took the rest: dropping `active` from the shape named its two readers | — |
| F1 | test | `fe/utils/terminal-pool.ts` — `detach(terminalId, host?)` checks that the host asking is the one attached; both call sites name their container | `default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts` "leaves the wrapper where it is when a host that no longer holds it detaches", "detaches when the host that holds it asks" | the spec: dropping the check fails the first case and leaves the second passing, which is the pair the finding needs. Mutation-checked | — |
| F2 | test | one pin state per session in the pool (`isPinned`), which the panel's write handler now reads instead of scrolling unconditionally; the panel registers its own viewport scroll listener to update it | the same spec, "keeps one scroll policy per session, whichever host reads it" and "reports a session it has never seen as following its output" | the spec: removing the `?? true` default fails the unseen-session case — a write arriving before the entry exists would silently stop scrolling. Mutation-checked, and the one-registration case below is what keeps the two hosts from each wiring their own | — |
| F1, F2 (the invariant) | test | — | the same spec, "wires input once per session, however many hosts draw it" | **the invariant the goal names**: one attached host, one `onData` registration, one scroll policy. Mutation-checked — wiring `onData` on every `ensure` fails it, which is what two hosts each registering would do | — |
| F10 | test | `terminal-pool.ts` `attach` — `addon.onContextLoss` disposes the addon, which drops xterm to its DOM renderer; the entry's reference is cleared so `dispose` does not touch it twice | no case: a lost GL context cannot be provoked in jsdom, and the handler is three lines whose body is `dispose` | `driven`: read against xterm's addon, which reports the loss and does not recover, and against the past commit that fixed a GL-context crash at teardown. The clearing half is covered by `dispose`'s existing path | a live GL-context loss is only observable in the app under memory pressure; not provoked |
| F11 | dissolved | nothing replays, because nothing keeps a copy to replay from — the byte log and its window storage went with F3 and F6, and `ensure` writes only its banner | `default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts` "replays nothing into a fresh emulator, so a cleared terminal stays cleared" | **the guard**: output emitted before an entry exists must not appear when one is created. Mutation-checked — restoring the accumulation *and* the replay (the regression this needs, in both files) fails it | — |
| F12 | test | both paste paths go through `term.paste`, which wraps the text in the bracketed-paste markers when the application asked for them | the same spec, "pastes through the emulator rather than as input" | the spec: sending the text as input instead fails it, and the case pastes a trailing newline so what it asserts is the defect — a pasted command running itself. Mutation-checked | — |
| F15 | test | `TerminalView.vue` no longer focuses on mount; the panel focuses only on the attach a `selectTerminal` caused, which is the one attach that is a request | the same spec, "takes no focus when a host attaches" | the spec covers the pool's half: adding a focus to `attach` fails it. The two component halves are read — the canvas's `onMounted` has no focus and exposes `focus()` for a real request, the panel's flag is set by `selectTerminal` alone | mounting either component in jsdom needs the surface scope and reka-ui; the components' halves are `driven` |
| F16 | test | `.catch(() => {})` on every clipboard promise, in the pool's key handler and the canvas's context menu | the same spec, "swallows a clipboard the window may not read" | **the guard is the run, not the case**: removing a `catch` makes the rejection unhandled, which vitest reports and exits 1 on — verified both ways (exit 1 with it removed, 0 restored) while all nine cases still pass. Stated plainly because a reader would otherwise look for a failing assertion | — |
| M6 | dissolved | there is no per-terminal buffer to load: the byte log and its window storage went with F3 and F6 | `default-setup/tests/features/code/fe/utils/terminal-events.spec.ts` "exposes no accumulated output to read back" | **the guard** is F3's: the prototype's own methods are asserted, so a buffer coming back fails it. A window cannot load what nothing keeps | — |
| X11 | dissolved | the `$SHELL`-missing fallback is `/bin/sh`, which POSIX guarantees, where `/bin/bash` is not on Alpine or on a stock Debian `sh`-only image | `default-setup/tests/features/code/be/services/known-shells.spec.ts` "answers the platform default where there is no $SHELL" | **the guard**: the case names both platforms' defaults, so changing either fails it. Closed by F13's work rather than separately | — |
| L1 | test | `restoreTerminalsActor` is invoked with an `onError` that reports and moves to `idle`, so a rejection no longer leaves the machine in `initializing`, where it handles nothing | `default-setup/tests/features/code/be/terminal-survives-a-failed-restore.spec.ts` | **the case covers the failure that can happen** — an open that fails, which `restoreAll` already survives per terminal — and the `onError` branch beside it **has no firing case**, which the source says plainly along with the edit that would give it one: everything `restoreAll` does per terminal is inside a `try`, and what is left outside is a settings read and a query. Recorded that way rather than implied, because a mutation removing `onError` passes | a firing case, if the branch is ever to be a gate rather than an assertion |
| T7 | driven | the panel's watcher detaches on **anything** that is not a terminal to draw, where it used to name two of the three cases — the third being a terminal gone from the list while still selected, which left both conditions true so neither branch ran | read, with the attachment seam beside it: a held attachment is now an object whose `release` is the only way out, so the case it leaves behind is visible rather than a disposables list | `driven`: mounting the panel in jsdom needs the surface scope and reka-ui, and what changed is a Vue watcher's `else if` becoming an `else`. The seam is what makes it safe to say so — `detachTerminal` releases one object, and releasing twice is a no-op | a component harness would make this a test rather than a reading |
| T10 | open | not attempted | — | — | recorded during this goal rather than by the review's rounds. `saveTabsAction` already returns early while a restore batch is in flight (`pendingTabOrder`), so the claim needs re-checking against that guard before it is acted on |
| F17 | open | not attempted | — | — | the pool's module-scope `apack:paste` listener is never removed. Its lifetime is the window's, which is the module's too, so what this costs is a reload's worth of listeners in a long-lived renderer rather than a leak that grows with use |
| G2 | test | `buildChildEnv` takes `agentChildEnvironment(process.env)` rather than `process.env` (`be/services/claude-code/runner.ts`), so the derived strip runs before the two deletes it kept | `default-setup/tests/features/code/be/services/shell-environment.spec.ts`, three cases | **the guard**: no name the declaration holds may survive, read from `APP_PROCESS_ENV_VARS` rather than written out. Mutation-checked — a strip that names only the loader variables fails it. An agent child also claims to be no terminal, which it is not: it reads stdout as a pipe, and `COLORTERM` there is a lie some CLIs act on | `runner.ts` moves substantially on #372; this change has to be carried there |
| G4 | test | `brokerEnvironment` (`apack-host/src/services/terminal.ts`) is what the broker is started with, and so what every shell it spawns inherits | `apack-host/tests/services/broker-environment.spec.ts`, five cases, **and the shell itself** in `drive/terminal-journeys.ts` | **the guard**, and it is in the host because the spawn is: this was the pack's, written for the `spawn` the pack used to do, and the broker taking that over left it with no caller — a shell inherited all ten again for the length of that change, which is how this was found. Mutation-checked both ways: starting the broker with the app's environment fails two cases, and a strip naming only the loader variables fails one. **Asked of a real shell** in the drive, because a unit test over either half can only say what it intends: `APACK_USER_DATA_DIR`, `ELECTRON_RUN_AS_NODE`, `SHIPPED_PACKS_DIR`, `API_PORT`, `APACK_API_TOKEN` and `NODE_OPTIONS` all empty, `TERM_PROGRAM=apack` present — which is what says the probe reached a shell this app started and not some other one, and the report carries `shellAnswered` so a probe that wrote nothing cannot read as a shell that inherited nothing | — |
| G6 | open | not attempted | — | — | `handle.close()` awaited without a timeout; `query.ts` moves substantially on #372, which the goal says to verify against first |
| G7 | open | not attempted | — | — | unbounded stderr per streaming agent child; `runner.ts` moves on #372, as G2 does |
| S4 | open | not attempted | — | — | `openLink`'s scheme filter is the SDK's navigation, and the review's own negative results record that the terminal cannot reach it: xterm's link addon matches `https?` only and the external branch already filters. It is in this document because it was found here, not because this feature can trigger it |
| X1, X2 | dissolved, **claimed on a Windows run** | `apack-terminal/src/tree.rs` — a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` held for the session's lifetime, so the kill *is* the close and a `kill`, a disconnect and a broker that crashes all reap the tree by one mechanism | `apack-terminal/tests/broker.rs` "killing a session takes the whole tree with it", run on the Windows VM 2026-11-07 | **reproduced before it was fixed** — *the grandchild 2944 outlived the session it belonged to* — and mutation-checked there: holding no job puts the case straight back. `command-group`, retired in this repo for exactly this moment, turned out not to apply and is deleted: it wraps `std::process::Command` and `portable-pty` spawns the child itself, so the job is assigned to the pid afterwards | — |
| F14 | test | shell integration is arranged when the shell starts, not typed into it afterwards (`be/services/shell-integration.ts`: bash `--init-file`, zsh `ZDOTDIR`, fish `XDG_DATA_DIRS`, each sourcing the user's own configuration first), and **the default is now on** (`apack.json` `features.code.settings`) | `default-setup/tests/features/code/be/services/shell-integration.spec.ts`, six cases; driven: a terminal told to `cd /tmp` reports `/tmp` and retitles itself (`.apack/drive/results/terminal-journeys.json`, `followedCd`) | the drive run is the guard that matters, because the unit cases pass whatever the default says: before the flip the same run answered `/Users/spankyed` for both `cwdBeforeCd` and `followedCd`, which is what *never ran for anybody* looks like from outside. Mutation-checked three ways | X4 is the Windows half and stays open |
| X4 | open | not attempted | — | — | Windows: shell integration is inert even when enabled. **D3 has landed and this is now the only thing standing between Windows and the capability**: `integrationFor` answers `undefined` on win32 on purpose, so a Windows terminal is exactly as it was. What it needs is PowerShell `-NoExit -Command` and cmd `/K` written and **run on Windows** — the mechanism is proven on POSIX and the goal admits a Windows claim only on the strength of a Windows run |
| X5 | dissolved | `be/utils/osc-cwd.ts` — one reader for all three sequences, which strips the slash a `file://` URL puts before a drive letter and spells the result the path's own way | `default-setup/tests/features/code/be/utils/osc-cwd.spec.ts`, six cases | **the guard**, and it needs no Windows machine: the path's own shape says what it is, so a case asserts `/C:/work` reads as `C:\work` while running on a Mac. Mutation-checked — keeping the leading slash fails two. With the restore path checking its directory (S3) the symptom had only got quieter: the terminal came back in the user's home rather than where they were | — |
| X6 | dissolved | `TerminalInfo.submit` carries what ends a line for *this* session's shell, computed where the shell is chosen (`submitFor`), and both run-script paths use it | `default-setup/tests/features/code/be/services/known-shells.spec.ts` "what submits a line"; `apack-terminal/tests/broker.rs`'s keystroke case requires the text **twice**, once echoed and once from the command that ran | **measured rather than asserted**, on Windows 2026-11-07: `\n` is echoed and never runs, `\r` alone does not get that far, `\r\n` both echoes and runs. That is also how the broker's keystroke case was found to be passing on the echo alone. A window cannot know which shell is on the other end, which is why this is on the descriptor rather than in the window | — |
| X7, X8 | dissolved | `fe/utils/terminal-name.ts` — one function where there were two copies, splitting on either separator and naming a drive root by its drive | `default-setup/tests/features/code/fe/utils/terminal-name.spec.ts`, six cases | **the guard**: `C:\Users\someone\project` must name `project` and `C:\` must name `C:`, neither of which needs Windows to assert. Mutation-checked — splitting on `/` alone fails. The two copies were already drifting, one saying `terminal.title` where the other said `terminalInfo.title` | — |

| X9 | dissolved, **claimed on a Windows run** | a session whose shell has gone is forgotten when its exit is reported, so a later write or resize is refused by code rather than reaching a dead handle (`apack-terminal/src/main.rs`, `session.rs`) | `apack-terminal/tests/broker.rs` "writing to a session whose shell has gone is refused", run on Windows 2026-11-07 | **writing the case found the defect**, and it was wrong on every platform: only `kill` removed a session, so the map grew with every shell the user exited and a later write answered `PTY` — the OS refusing a dead handle — where the true answer is that there is no such session. Mutation-checked | — |
| X12 | dissolved | a Windows shell is one of five **names** the machine resolves — `powershell.exe`, `pwsh.exe`, `cmd.exe`, `bash.exe`, `wsl.exe` — rather than a list of paths: the same derivation `/etc/shells` is on POSIX, asking what this machine has | `default-setup/tests/features/code/be/services/known-shells.spec.ts`, five Windows cases over a resolver | **the answer came from a Windows machine**: read off a stock Server 2025 image 2026-11-07, `powershell.exe`, `cmd.exe` and `wsl.exe` are in System32 and `pwsh.exe` and `bash.exe` are absent, which is why the old two-name list gave PowerShell 5.1 to anyone asking for `pwsh.exe`. A shell installed later is accepted with nothing here to edit, and a lookalike beside a real one is refused. Mutation-checked, and one case caught `path.basename` reading a Windows path on a Mac as its own basename — X7's mistake, made again | — |
| X13 | dissolved | `brokerEnvironment` declares `TERM: 'xterm-256color'`, which is what xterm.js draws | `apack-host/tests/services/broker-environment.spec.ts` "says what terminal this is, rather than letting the shell inherit an answer" | **the guard**: a `TERM` already in the environment must be overwritten, not kept — the case passes one in. Mutation-checked. **It was wider than the finding said**: the `name: 'xterm-256color'` option this named went with node-pty, `portable-pty` sets none, and nothing else did — so the shell took whatever the app process happened to have, which is the shell the app was launched *from* in development and nothing at all in a packaged app opened from the Dock. A shell with no `TERM` gives `less`, `vim` and `top` their dumb fallbacks, and nothing about that failure names the app | Windows: ConPTY's own handling, which needs a Windows run |
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

### The presentation channel after coalescing (Phase B) — 2026-11-07

The same scenario and corpus as Phase G's sustained-output reading, so the two are comparable, re-run in the
app with the broker owning the pty. 10 measured trials, all passed.

| | before (node-pty) | after (broker) |
|---|---|---|
| **Messages per 64 KiB** | 115 | **6** |
| Bytes on the bus | 76,824 | **66,905** |
| Renderer task time | 51.0 ms | **40.1 ms** |
| Delivery | 1,389 ms | 1,272 ms |

**19× fewer messages, and fewer bytes with them** — the envelope is paid once per flush rather than once per
pty read. About **96 messages per MB** against the ~1,840 the before implies, which is the budget F4's guard
holds.

**What has no case, recorded rather than implied.** Output spends credit and answers do not, so an answer is
never behind a megabyte of output. That split is guarded by its *structure* — `Outgoing::answer` carries no
credit — and **not** by a behavioural case: three mutations that gave answers output's credit passed every
case written for them (a saturating producer with an idle reader, a lowered bound, a request during
saturation), because in this design an answer is never waiting on anything. What deadlocks is a shared
**bounded** queue, which this is not and which no mutation small enough to model can make it. The edit to
watch for is one that bounds the queue itself; `src/output.rs` says so where that edit would be made.

### The output budget after the byte log went (Phase P) — 2026-11-07

The same corpus again, so all three readings compare: **7 messages median for 64 KiB** (5–7, 10 of 10
passed), against 6 with the byte log still in place and 115 before the broker. So deleting the renderer's
copies did not cost the budget the coalescer bought, which is what Phase P asks be asserted over the
baseline's own corpus.

Renderer task time read 56 ms against 40 ms, with a 139 ms maximum in the same run — this machine was not
quiet, and a latency from a loaded machine is a report and not a gate, so it is recorded and not cited.

**What the deletion costs, stated rather than discovered.** A *fresh* emulator now starts fresh: nothing
replays, because nothing keeps a copy to replay from. The common case is unaffected and that is measured —
the pool keeps the emulator alive across a host's teardown, so a reattach with 256 KiB of history is 5.55 ms
and sends no bytes. Serving history to a new emulator is the broker's bounded history, which is where one
copy belongs and which Phase B has not built.

### A terminal survives the API restarting (Phase H) — 2026-11-08

**Driven in the real app**: a terminal is opened, the API is killed by the pid in its own port file, and the
shell is still alive while the API is gone (`shellSurvivedTheApi`) and still listed once main has restarted
it (`terminalBackAfterApi`). Before the change it was gone and the restarted API spawned a replacement,
which its own log said in as many words — *"Restored terminal … as a new shell (pid 19614); the previous
process and its output are gone"*.

The decision is in the goal's Decisions section; what it took to make true is four changes that only work
together, and the fourth is the one that would have been missed:

- The client **connects to a broker already listening** before starting one. Without it the API takes the
  socket from main's broker with `try_overwrite` and the first one's sessions become unreachable with no
  error anywhere.
- The spawn is **detached and its handle released**, since the broker outlives whoever started it.
- `close()` **leaves** the broker rather than killing it — right before, exactly wrong now.
- **default-setup stopped killing every terminal on shutdown.** That hook was the orderly path while the
  broker ended a connection's sessions, and became the single thing preventing survival. Nothing failed
  when it ran: the terminals simply came back as new shells, and the only way to see it was the API's own
  log. A guard that is correct under one rule and silently destructive under its replacement is the shape
  worth remembering here.

**And a leak the hold made visible.** The broker ended its sessions when nobody held it and then went on
listening for ever, so one process accumulated per app launch — 31 were running on this machine, each
holding a socket, none holding a shell (checked: zero child processes between them). It now exits when its
connection count reaches zero. The count is taken from the accept rather than the handshake, which is what
makes zero safe: a caller that has connected and not yet greeted is already counted.

**What the host spec is for**, beside the broker's own: neither side can prove this alone. The broker's
suite shows that a `lifetime` connection holds its sessions; what it cannot show is that *this app's*
client and hold ask for those roles. A client that greeted as an owner would keep every shell running after
the app was gone, with every case on both sides still passing.

### The full chain passes, `test:native` included — 2026-11-08

`npm run chain` at `2b1ae253ad`: **passed in 2451.5s (24 of 33 cached) on a 10-core budget**, evidence in
`node_modules/.cache/apack-chain/runs/2026-11-08T01-28-27Z-8961`. `test:native` ran for 2276.2s — 19 files
passed and 4 skipped, 94 tests passed and 47 skipped, nothing failed. That is the goal's required integrated
validation; the strict dispatch is the remaining half.

**It took five attempts, and four of them failed for reasons that were not the code.** Worth recording
because each wore a convincing disguise:

1. **Interference.** A test file committed while the chain ran. The chain detected it itself — *"5 steps
   passed, then their inputs changed"*, naming the file — and failed at `test:external-pack:fork`. The
   inputs have to be frozen for a run's whole length, not just at its start.
2. **A stale sealed build.** Adding that same file left `build:default-setup` cached while the pack's
   recorded build went stale, so the fork step failed with `Compiler startup input changed:
   ["authored-files"]`. Recorded above as a defect; cleared by rebuilding the pack.
3. **A real finding of my own.** `identity-guard` caught a platform data dir in a spec fixture I had
   written earlier that day. It is the one failure in the five that was a defect, and it reached the tree
   at 16:43 while a chain reported passing at 17:47 — that run kept no `test-unit-host` evidence where the
   run that caught it does, so the step was cached rather than green. Whether that is a cache-key gap is
   not answerable now: the stamp that would say was cleared by the failure.
4. **A stale lock, twice, reading as a slow machine.** The container's `build:default-setup` was killed at
   its 600s deadline having spent the whole budget *waiting* on a `.apack/build.lock` left by the previous
   killed run. `apack pack build` waits for a running build rather than refusing, so each run inherited the
   last one's corpse and died the same way. It presents as "1.56x its usual 383.8s", which is exactly what
   a loaded machine looks like — two runs were spent on that reading, one of them after the machine had
   deliberately been quietened. Fixed in `scripts/linux-runner.ts`'s orphan cleanup under the volume lease,
   beside the three classes already there.

**The lesson the fourth one carries** is that a deadline kill says nothing about *why* a step was slow, and
a step that waits on a lock inside its own budget is indistinguishable from one doing slow work. The
timeout message already says *"a timeout alone does not distinguish slow progress from stalled work.
Inspect the run output before retrying or changing its budget"* — and the run output had the answer in it
both times.

### Phase A: facts out of the VT core — 2026-11-07

**What a session reports about itself, answered without a window.** The markers D3 arranges are now read
where the screen is (`apack-terminal/src/markers.rs`, at `4623a2a`), and three reads answer over the
protocol: `facts` (working directory, command line, whether one is running, the status the last one ended
with), `search` and `wait` (until idle, until text appears, until the process ends).

- **The scanner is its own pass, because the grid drops what it is reading.** `alacritty_terminal`
  implements the OSC codes a terminal acts on — a title, a colour, the clipboard — and ignores the rest,
  which is correct: a sequence it has no behaviour for must not disturb the screen. Shell integration *is*
  those ignored sequences, so they are taken from the same bytes before the grid sees them, and the stream
  reaches the grid untouched.
- **OSC 633**, VS Code's set, as Phase A requires: its rc scripts are readable, other tools emit it, and
  inventing sequences buys nothing and loses interop. OSC 7 and iTerm2's 1337 are read too, for a user whose
  own configuration already emits one.
- **Nothing polls.** A wait's condition is checked where the bytes land, so a caller pays a condition check
  per read rather than a request per tick. A session ending settles every wait on it, since nothing is
  coming; three things race to end one and a `settled` flag makes the answer exactly one.
- **Driven through a real socket in the real binary**: `apack-terminal/tests/broker.rs` has five cases for
  this, including a hidden session answering facts the shell stated, a search over its history, a wait that
  is answered when the command finishes, one that reaches its deadline, and a session ending settling both
  kinds at once. `tests/markers.rs` feeds every stream at every byte boundary and demands the same markers.

**`services.terminal` exposes none of it, deliberately.** The consumer Phase A is designed against — #372's
native adapter — is on another branch, and an export with no caller is one nobody has had to make answer a
real question. The capability is proven where it lives.

**A reported path is a claim, not a measurement.** The sequence is written by whatever is in the pty, which
need not be the shell and need not be honest, so `cwdFromOsc` refuses a claim longer than Linux's
`PATH_MAX` — the largest of the three platforms' ordinary limits, so nothing a shell can legitimately sit in
is refused — and refuses one carrying a control character rather than stripping it: stripping changes which
directory a path names, and refusing leaves the terminal where it was, which is the failure that loses
nothing. Decoding no longer throws either; a program emitting `%zz` from a prompt hook had the app log an
error on every prompt.

**One mutation did not fire, and the line it did not reach is gone.** A payload clear in the scanner's
overrun state was unreachable — entering that state already clears — and it was papering over the real
flaw, which was that an escape that turned out not to terminate put the scanner back to *collecting* the
tail of a string it had given up on. That is its own state now, and the mutation fires.

### node-pty's only remaining loader is its own health check — 2026-11-07

**Nothing in the app imports `node-pty` any more.** Checked by the AST rather than by grepping for the
name: the only `import`/`require` of it anywhere under `packages/` is in `repo-checks`' fixtures, which
exist to offend `findNodePtyImports` and must keep it. It is still a dependency of `packages/api` and
`packages/default-setup`.

**The one thing that still loads it is `build/prod/smoke-native.mjs`**, which spawns a shell through it to
prove the native module rebuilt correctly for Electron's ABI — so the dependency's last consumer is the
check that the dependency is healthy. That is circular rather than wrong, and it is the state Phase B was
supposed to reach: *"what disqualifies node-pty"* in the review is where it runs and what it is coupled to,
and neither is true of anything the app does now.

**Not removed here, deliberately.** What a package ships is release configuration, which this goal put
outside itself when it recorded the packaging findings in reading 2 rather than changing them — and that
reading is also what says the removal is worth taking: 264 KiB of JavaScript and 136 KiB of native binding
in every package, plus the **26 MB of Windows debug symbols** and **2.3 MB of `OpenConsole.exe`** that ship
by omission beside it. The guard against it coming back already exists both ways (`check:specifiers`
refuses the import in pack code, and `apack pack build` refuses a bundle carrying it), so what is left is a
dependency line and the smoke test that reads it, taken together or not at all.

### The seven journeys, checked by eye — 2026-11-07

The goal asks for the complaint to be answered and not only the findings: *"super buggy in general,
especially in the FE UX"*. All seven named journeys run, as `drive/terminal-journeys.ts`
(`npm run dev:drive -- --fresh --rm drive/terminal-journeys.ts`); screenshots in
`.apack/drive/screenshots/journey-*.png`, observations in `.apack/drive/results/terminal-journeys.json`.
`drive/` is scratch by design — three files tracked, nothing gates on a driving script — so this record is
the durable half.

| the journey | what it showed |
|---|---|
| open a terminal and run a build | 40 lines of build output, drawn |
| scroll back during output | the viewport stayed where it was put while 4,000 lines arrived |
| drag the divider mid-command | the pane resized while a loop kept printing; the command was still running after |
| switch tabs and come back | the surface's `activeFilePath` moved and came back, the shell behind the tab still ran a command, and the screenshot shows `marker-before-switching` still in the scrollback — the xterm was kept, not rebuilt |
| run `vim`, quit it, keep working | vim drew its empty-buffer column, `:q!` gave the shell back, and the shell ran a command afterwards |
| kill a terminal with a child process running | `childrenLeftRunning: []` — the child's pid is gone, asked of the OS rather than of the app |
| restart the app and find the terminal where it was | `buildTerminalSurvivedReload: true` |

Beside them: the shell inherits nothing of the app's identity (`shellInheritedNothingOfTheApps`), a terminal
follows `cd` (`followedCd`), and the app's log holds no terminal or broker error for the whole run
(`terminalErrors: []`).

**What the screen is, is not assertable from the page, and that is a fact about the app.** xterm draws to
three canvases and leaves no text in the DOM — probed 2026-11-07, `.xterm-rows` is absent and
`document.body.textContent` never carries a terminal's output. So a journey's screen is checked by eye from
its screenshot, and what a script can assert is the surface's own state and what the shell *did* — which
these ask by having it write a file and reading that file from outside the terminal. It is also D9's premise
shown rather than argued: the renderer's copy is pixels, so the authority has to be the broker's parse. A
first attempt asserted on `.xterm-rows` and reported five confident `false`s, which is exactly the shape
*"a check that reports nothing may have looked at nothing"* warns about.

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
