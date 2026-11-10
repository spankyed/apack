# Issue: Terminal integration — review findings and path forward

**Date:** 2026-10-01 — findings re-verified against the tree 2026-11-07
**Status:** Every finding is closed — 54 marked and 6 struck, of 60. Decisions D1–D8 below are settled and
D9–D11 live in the goal; T4, M3, G3, G6, G7 and F18 are struck, the rest were fixed. Kept for what the
findings were and what each cost; the evidence table carries the dispositions
**Severity:** Critical — one finding writes user credentials to disk in plaintext; two more can lose work
**Component:** `packages/default-setup/src/features/code` — terminal (xterm.js front end, node-pty back end),
plus the app plumbing it depends on (`packages/main`, `packages/api`, `@apackdev/host/bus`)

**Delivery is owned by [goal-terminal-ownership](../archive/goals/goal-terminal-ownership.md).** This document owns
the findings, the root causes and decisions D1–D8; the goal owns the outcome, the execution order and
completion, and cites those decisions rather than restating them. Its D9–D11 settle what this document left
open. A finding's disposition and the evidence that closed it live in
[the evidence record](../references/evidence/terminal-ownership.md), not here; a row is struck here as it
closes there.

## Symptom

The terminal is reported as "super buggy in general, especially in the FE UX", with no reproducible bug list
behind it. This document is that list.

## How this was reviewed

Two rounds.

**Round 1** — four manual passes over the feature's own eight files (2,743 lines): ownership and lifecycle,
the output hot path, process safety, completeness. Produced F1-F17. That round was, by construction, a
static read of one feature, on the happy path, on macOS, in one window.

**Round 2** — six parallel reviews against falsifiable hypotheses, each covering an axis round 1 could not
see, plus a git-history pass. Produced S, M, X, T, L and G below, **corrected two round-1 findings**, and
returned several useful negative results.

**Line numbers predate the `apack` rename and the window-storage migration, and are refreshed as each
finding is touched.** The mechanisms have held every spot-check so far; the citations have not. The migration
is the reason: a `window-storage` pack rule now refuses a pack reaching `localStorage` itself, so the
terminal's persistence moved behind `surfaceStorage(featureRef('code'))` — the same synchronous backing store
at a different call site. Verifying a finding before acting on it belongs to the stage that acts, not to a
pass run first; the four harm findings (S1, S2, F9, F10) were checked on 2026-11-07 and are accurate.

Still not done: **nothing here was measured at runtime.** F3, F4, F5 and G1 are severity claims derived from
reading code; the goal's Phase G prices them.

---

## Corrections to round 1

**F1 was wrong about reachability, and the correction matters.** I claimed that opening one terminal in a
canvas tab *and* the panel leaves one blank, because the pool holds a single DOM wrapper. In a single window
that is **not reachable**: `fe/features/terminal/PanelTerminalSection.vue:110` makes a tabbed terminal
unclickable in the panel list, `:148` and `:156` offer "Open in Tab" / "Move back here" mutually exclusively
on `isInTab`, `fe/state.ts:864` repoints `panelTerminalId` away on `openTerminalInTab` (and explicitly does
`tabbedIds.add(ev.terminalId)` to compensate for the stale context), and the canvas mounts a terminal only
when its tab is active. The move paths were traced in both directions and are safe — detach precedes attach
in every case, by Vue's queue phases.

What survives of F1 is narrower and still worth fixing: **`terminalPool.detach(id)` never checks that the
caller owns the attachment** (`fe/utils/terminal-pool.ts:260-272`), so this correctness rests on Vue's flush
ordering rather than on an invariant the pool enforces. And the blank *is* reachable with a second window —
see M3. So F1 is reclassified: **Low as a single-window defect, High as a structural fragility that M3
converts into a real one.**

**What that unreachability is not: evidence of a design.** Exclusivity here is emergent, not stated. There is
no comment, contract or spec asserting it anywhere in the feature. `isInTab` is a one-line computed over tab
paths (`PanelTerminalSection.vue:255-256`) used five times in a template — to grey a row, to append "(in
tab)" to a tooltip, to no-op a click, and to swap a context-menu item. Those are display concerns, and the
tooltip says what the helper was written for; the invariant is a side effect. The tell is `fe/state.ts:864`,
whose `tabbedIds.add(ev.terminalId)` hand-patches exactly the stale-`context` bug that **T1 reports as
unfixed** in a sibling handler: one site noticed, the other did not. And the enforcement already has a hole —
**M3 is a path that forgot the rule**, producing the two-hosts-one-node state through a broadcast reply. So
the behaviour is accretion that happens to compose, and it carries no weight as precedent.

**F14 is sharper than stated.** Shell integration is not merely off by default: there is exactly one line
ever written for `enableShellIntegration` (`+ enableShellIntegration: false,`), so the subsystem behind it
— `injectShellIntegration`'s three shell branches, the OSC 7/633/1337 parsing, `updateCwd`, `CWD_CHANGED`
— has in all likelihood **never executed for any user**. The title is set once at creation from
`path.basename(cwd)` (`be/services/terminal.ts:80`) and never follows `cd` for anyone. A default that looks
defensive is simply unfinished. X4 adds that on Windows it does nothing even when switched on.

---

## Findings

Severity-ordered. `F` = round 1, `S` = security, `M` = multi-window, `X` = platform, `T` = tab/panel
orchestration, `L` = lifecycle and persisted data, `G` = agent sessions.

**A ✔ means the row is closed**, with its disposition and evidence in
[`docs/references/evidence/terminal-ownership.md`](../references/evidence/terminal-ownership.md) — that table
is where a finding's *state* lives, and this one stays what the findings *are*. A row without one is open,
and the evidence table says what each is waiting for.

**The marks are kept by hand against that table, and nothing holds the two together.** This said they were
derived "so the two cannot disagree about what is done", and they already had: F18 was dissolved in the
evidence table on 2026-11-08 and read as the last open finding here until 2026-11-09. Nothing reads either
document, so the claim was a property nobody implemented. It is written as what it is now, because a table
that says it cannot drift is worse than one that admits it can — a reader trusts the first and checks the
second. The evidence table is the record; a disagreement is this file being stale.

| | Sev | Finding | Where |
|---|---|---|---|
| **S2** ✔ | **Critical** | Every terminal keystroke is logged at `info` and written to `main.log` + `main.jsonl` in plaintext | `apack-host/src/bus/client-events.ts:54` |
| **S1** ✔ | **High** | The API process's whole env — app API token included — is handed to every pty | `be/services/terminal.ts:318-331`, `main/.../api-server/config.ts:100` |
| **S3** ✔ | **High** | The restore path spawns a persisted `shell` and `cwd` with no validation | `be/services/terminal.ts:379-385` |
| **F3** ✔ | **High** | O(n²) string accumulation per terminal, on the renderer's main thread | `fe/utils/terminal-events.ts:111` |
| **F4** ✔ | **High** | One bus event per pty chunk; no coalescing, no flow control | `be/features/terminal.ts:76` |
| **F5** ✔ | **High** | Resize storm, amplified into an EARS write per resize | `be/services/terminal.ts:153`, `TerminalView.vue:159,190,195` |
| **F7** ✔ | **High** | `restoreAll` SIGKILLs a stored pid and its process group, unbounded | `be/services/terminal.ts:366` |
| **F9** ✔ | **High** | Every terminal error is silently swallowed | `fe/features/terminal/state.ts:250` |
| **L2** ✔ | **High** | `restoreAll` is unbounded and `killAll` never marks rows closed, so active rows grow forever | `be/services/terminal.ts:232-245`, `:347-355` |
| **M2** ✔ | **High** | The pty's size is owned by whichever window fitted last | `TerminalView.vue:159-199`, `be/services/terminal.ts:153-163` |
| **X1** ✔ | **High** | Windows: no terminal process is ever killed when the app quits | `be/services/terminal.ts:51-55`, `main/.../process-manager.ts:153` |
| **X2** ✔ | **High** | Windows: closing a terminal leaves its children, and may leave the terminal undead | `be/services/terminal.ts:199-230` |
| **X3** ✔ | **High** | Windows/Linux: Ctrl+R reloads the window and Ctrl+W closes it while typing in a shell | `main/src/modules/app-menu.ts` (was `MacOSAppMenu.ts:12`) |
| **G1** ✔ | **High** | Agent streaming rewrites the whole message to EARS every 80 ms and re-broadcasts it | `content/actions/claude-code/_helpers/stream-writer.ts:54,64` |
| **L1** ✔ | Medium | `restoreTerminalsActor` has no `onError`: a rejection stops the terminal system for the session, silently | `be/features/terminal.ts:302-310` |
| **T1** ✔ | Medium | `handleTerminalClosed` can pick the just-closed terminal as the next panel terminal | `fe/features/terminal/state.ts:321` |
| ~~**T4**~~ | ~~Medium~~ | **Fixed.** `pendingTarget`/`pendingCommand` were single uncorrelated slots for N in-flight creates; the intent is keyed by the envelope's call now (`pendingOpens`) | `fe/features/terminal/state.ts` |
| **T3** ✔ | Medium | The 2,500 ms restore settle drops terminal tabs *and* rewrites the persisted list without them | `fe/state.ts:560-564,1208-1218` |
| **T2** ✔ | Medium | A pinned terminal tab becomes a permanent ghost when its terminal dies | `fe/utils/tab-management.ts:29` |
| **T5** ✔ | Medium | "Open Terminal Here" spawns a terminal without expanding the panel | `fe/features/CodePanelHeader.vue:22` |
| ~~**M3**~~ | ~~Medium~~ | **Fixed.** `terminal.CREATED` was broadcast and every window consumed it as if it had asked; the opening is a `reply` to the asker's connection now (`terminal.OPENED`) | `be/features/terminal.ts` |
| **M1** ✔ | Medium | Two windows write the same persisted-output key from differently-based copies | `fe/utils/terminal-events.ts` |
| **M4** ✔ | Medium | A window attaching after a pty replacement content the dead shell's scrollback with no seam | `fe/utils/terminal-pool.ts:164-178` |
| **M5** ✔ | Medium | Every window restores and rewrites the one persisted-tabs key | `fe/utils/persisted-tabs.ts` |
| **L3** ✔ | Medium | No Terminal row is ever deleted; `terminalCommands.delete` is dead code | `be/repository/index.ts:136-145` |
| **F6** ✔ | Medium | Up to 1 MB of synchronous window storage per terminal per output burst | `fe/utils/terminal-events.ts` (via `surfaceStorage`) |
| **F8** ✔ | Medium | First pty output can be lost before `onData` is registered | `be/features/terminal.ts:131` |
| **F10** ✔ | Medium | No WebGL context-loss recovery | absent |
| **F11** ✔ | Medium | Clear doesn't survive a restart | `fe/canvas/TerminalView.vue:133` |
| **F12** ✔ | Medium | Paste bypasses bracketed paste in two of three paths | `TerminalView.vue:125`, `terminal-pool.ts:201` |
| **X4** ✔ | Medium | Windows: shell integration is inert even when enabled | `be/services/terminal.ts:334-344` |
| **X5** ✔ | Medium | Windows: an OSC 7 URL decodes to an unusable path, which is persisted and respawned from | `be/features/terminal.ts:49,66` |
| **X6** ✔ | Medium | Windows: the run-script path sends LF, which does not submit a line | `fe/features/terminal/state.ts:290` |
| **X9** ✔ | Medium | Windows: `resize`/`write` have no error handling; ConPTY throws for ~1 s after exit | `be/services/terminal.ts:145-165` |
| **X10** ✔ | Medium | Windows/Linux: the code surface's `cmd`-based hotkeys can never match | `apack-sdk/src/fe/hotkeys.ts:31` |
| **X11** ✔ | Medium | Linux: the `$SHELL`-missing fallback is a hardcoded `/bin/bash` | `be/services/terminal.ts:48` |
| **X12** ✔ | Medium | Windows: `pwsh.exe`/`bash.exe`/`wsl.exe` are silently replaced by PowerShell 5.1 | `be/services/terminal.ts:25-37` |
| **G2** ✔ | Medium | `ELECTRON_RUN_AS_NODE=1` is handed to every agent child and everything its Bash tool spawns | `claude-code/runner.ts:117-121` |
| ~~**G3**~~ | ~~Medium~~ | **Dissolved.** What `killAllHandles()` ends is the conversation and native-terminal model `session/claude-code-integration` introduces; master's handle store holds query handles alone, and those die with the exiting process — the only moment the hook runs | `src/features/hooks.ts` |
| **G4** ✔ | Medium | "Open in terminal" hands the resumed CLI an env the agent runner exists to scrub | `be/services/terminal.ts:38-45` |
| ~~**G6**~~ | ~~Medium~~ | **Fixed.** The close is bounded by the child's own progress rather than a clock; a child gone silent without exiting is terminated, and a real exit failure still throws | `claude-code/query.ts` |
| **S4** ✔ | Medium | `openLink` and the in-app tab path apply no scheme filter; only the external branch does | `apack-sdk/src/fe/navigation.ts:32-35` |
| **F13** ✔ | Low | The shell allow-list is inert on the default path | `be/services/terminal.ts:276` |
| **F14** ✔ | Medium | Shell integration is typed into the running shell, and its default has only ever been written `false` | `be/services/terminal.ts:334-344`, `apack.json` `features.code.settings` |
| **F15** ✔ | Low | Focus is stolen on every attach | `TerminalView.vue:202`, `PanelTerminalSection.vue:316` |
| **F16** ✔ | Low | Unhandled clipboard promise rejections | `terminal-pool.ts:194,200` |
| **F17** ✔ | Low | Module-scope `document` listener is never removed | `terminal-pool.ts:355` |
| ~~**F18**~~ | ~~Medium~~ | **Dissolved.** The resize was never lost: `TerminalInfo.cols`/`rows` is the size **at publication**, which is what its one consumer wants — the pool building the emulator, whose fit replaces it on the next frame — and the contract says so now. It was a drive scenario's expectation of the field, not the code | `be/features/terminal.ts` `resizeTerminal` (answers only on failure), `fe/features/terminal/state.ts` (`terminals`) |
| **F1** ✔ | Low | `detach` does not verify attachment ownership (see Corrections) | `terminal-pool.ts:260-272` |
| **F2** ✔ | Medium | The panel scroll-jacks during output | `PanelTerminalSection.vue:296` |
| **T6** ✔ | Low | "Restart Terminal" loses the tab's pin, group and position | `fe/canvas/canvas.vue:277-285` |
| **T7** ✔ | Low | The panel's attach watcher never tears down when its terminal disappears | `PanelTerminalSection.vue:545-559` |
| **T8** ✔ | Low | The panel list discards the terminal's title in favour of the cwd basename | `fe/composables/useTerminalActions.ts:34` |
| **T9** ✔ | Low | `moveTerminalToPanel` leaves an emptied tab group rendered | `fe/state.ts:869-885` |
| **T10** ✔ | Medium | During a restore, **every** `saveTabsAction` persists a list without the tabs still arriving, not only the settle | `fe/state.ts:248-252` (`persistCodeTabs`) |
| **L6-L8** | Low | `terminal.INITIAL_OUTPUT`, `CODE_STARTUP` and the `terminal.CREATE` inbox shape are dead or disagree | `be/contract.ts:188`, `fe/contract.ts:122` |
| **M6** ✔ | Low | Every window loads every persisted terminal buffer into memory | `fe/utils/terminal-events.ts:19-35` |
| **X7** ✔ | Low | Windows: three FE paths split cwd on `/`, so the whole path becomes the name | `useTerminalActions.ts:34`, `fe/state.ts:155` |
| **X8** ✔ | Low | Windows: a terminal at a drive root is titled "root" | `be/services/terminal.ts:80` |
| **X13** ✔ | Low | Windows: `name: 'xterm-256color'` is inert and the pty inherits no `TERM` | `be/services/terminal.ts:87-93` |
| ~~**G7**~~ | ~~Low~~ | **Fixed.** The stderr kept for a post-mortem is a bounded tail, and the bytes that fall off are counted rather than hidden | `claude-code/stderr-tail.ts` |

### S2 — keystrokes on disk (verified against the live log)

The chain, each link read: `terminal-pool.ts:227` `term.onData(sendInput)` fires per keystroke →
`fe/features/terminal/state.ts:78` forwards `terminal.TERMINAL_INPUT { terminalId, data }` over
`sendToSystem`, so it goes through the API's `bus.send` → `apack-host/src/bus/client-events.ts:54` logs
`{ …, event: summarizeEventForLog(event) }` → `client-events.ts:19-34` shortens **arrays** over 5 items, so
a string payload passes through whole → `api/src/adapters/logging.ts:37` prints it →
`main/.../process-manager.ts:45` → `main/.../logger.ts:55,84` writes `main.log` **and** `main.jsonl`.

Measured on this machine, 2026-10-01: **3,074** `TERMINAL_INPUT` records in `main.log` and **159,014** in
the last 200 MB of `main.jsonl`.

`onData` fires on key presses regardless of terminal echo, so a passphrase typed at `sudo`, `ssh`, GPG or
`npm login` — never shown on screen — is on disk in cleartext. `logger.ts:73` redacts only key-shaped
strings the process already knows. It went unnoticed because the Logs surface hides the `app-events` source
by default (`features/logs/settings.ts`, `showAppEvents: false`); the UI hides it, the file does not. These
are long-lived files that the app's own "open log file" IPC exposes and that users attach to bug reports.

A deny-list of event names will rot the way S1's env deny-list did. The default for a payload at that seam
must be "not logged".

### S1 — the app's control plane in every shell's environment

`sanitizeEnvironment` is `{...process.env}` minus six names (`be/services/terminal.ts:38-45`), applied on
both spawn paths (`:85`, `:376`). The env it copies is the one Electron main built for the API process,
which sets `APACK_API_TOKEN` (`main/src/modules/api-server/config.ts:100`) along with `API_PORT`,
`APACK_USER_DATA_DIR`, `APACK_LOG_DIR` and `SHIPPED_PACKS_DIR`. None is on the deny-list.

What the token buys is wider than a secrets read — `secrets.*` returns metadata only
(`api/src/transport/secrets.ts:14-43`), correcting the original hypothesis. The escalation is `bus.send`:
the Database system accepts `EXECUTE_TRANSACTION { code }` (`features/database/be/types.ts:46`), run through
`new Function` with no isolation (`apack-sdk/src/database-console/index.ts:104-111`) **inside the API
process** — the process holding the decrypted secrets data key. `bus.sub` streams results back.

Severity is higher in the shipped app, not lower: `apiTokenFile` is written only in development or when the
API invented its own token (`api/src/transport/websocket.ts:120-125`), so in a packaged build the pty env is
the only path. A postinstall hook in any dependency installed from that terminal inherits it without looking.

The fix is an **allow-list** (PATH, HOME, LANG, TERM, shell vars), not a deny-list, plus a spec asserting no
app-owned variable appears in a spawned pty's env — the absence of that test is why the deny-list went stale.

### S3 — a stored string treated as an executable

`be/services/terminal.ts:379-385` spawns `persistedTerminal.shell` with `cwd: persistedTerminal.cwd`.
`validateShell` (`:276`) and `validateCwd` (`:292`) run only on the create path. `restoreTerminals` defaults
to `true`, so this runs at every boot. Writes to a Terminal row therefore become an executable launched at
next start, and such writes exist: the database console's `EXECUTE_TRANSACTION`, `apack db exec`, and a
backup import, which replaces the LMDB folders wholesale with no row-level validation
(`apack-host/src/backup/index.ts:124-137`). "Import a backup someone sent you" is enough.

Ordering: F13 must be settled first, because the allow-list's current fallback is the value it just
rejected, so validating on restore would be inert.

### L2 — active rows grow without bound, and restore is unbounded

Two facts compose. `killAll` disposes `exitDisposable` *before* `pty.kill()`
(`be/services/terminal.ts:232-245`), so the `onExit` callback that calls `markClosed` never fires, and
`killAll` never calls it either — and `killAll` is the clean-shutdown path (`src/features/hooks.ts:12-16`).
**So every terminal open at a clean quit stays `active: true` forever.** Meanwhile `restoreAll`'s loop
(`:347-355`) has no count check, and `maxTerminals` counts `this.terminals.size`, not rows.

With `restoreTerminals: true` the two cancel out. With it **off** — a one-click toggle at
`fe/settings.vue:209` — `restoreAll` returns early and nothing ever reads or clears those rows; each run adds
more. Toggle it back on and the next boot spawns one shell per accumulated row, in a loop with **no `await`**,
synchronously on the API's event loop, each feeding F3's accumulator and F6's `localStorage` write.
`maxTerminals` is also read as `?? 0` = no limit, and the settings form offers a one-click "no limit".

This also sharpens **F7**: because `killAll` never clears `active` or the pid, the "kill orphaned process
from previous session (e.g. after a crash)" block runs on **every normal restart**, for every terminal. The
comment understates when the pid-recycling hazard is live.

### T3 — the restore race is narrowed, not closed

The deferral is correct in one direction: `restorePersistedTabs` runs in the machine's `entry`, so
`pendingTerminalTabIds` is set before any backend event arrives. But the fallback is a fixed 2,500 ms timer,
and the backend answers at exactly one reliable moment. `be/features/terminal.ts:302-309` keeps
`REFRESH_LIST`, `CREATE_TERMINAL`, `CLOSE_TERMINAL` and `OPEN_TERMINAL_TAB` in `idle` only, so both front-end
prompts — `initializeSurface`'s `REFRESH_LIST` and `CODE_CONNECTED` — are **dropped** while
`restoreTerminalsActor` is still spawning stored ptys. If `TERMINALS_LISTED` lands after the settle, the
settle has already cleared `pendingTerminalTabIds` *and* called `persistCodeTabs` on an `openFiles` that
never received the terminal tabs — so the tab layout is erased from `localStorage`. The ptys are alive and
listed in the panel; their tabs are gone for good.

Same mechanism: a `terminal.CREATE` in that window produces neither `CREATED` nor `ERROR` — dropped by the
machine, so not even F9's swallowed-error case.

### T4 / M3 — one slot, N requests, and a broadcast reply

Found independently by four of the six reviews, which is why it is listed once. `createTerminal` overwrites
`pendingTarget`/`pendingCommand` on every `terminal.CREATE` (`fe/features/terminal/state.ts:71`);
`handleTerminalCreated` consumes whatever is there when the next `terminal.CREATED` arrives, with nothing
tying a reply to its request — and `CREATED` is a `broadcastToSurface` (`be/features/terminal.ts:133`), so it
reaches every window for every creation.

- One window: run "build" then "test" from the Run Script popover before the first reply → **`test` runs in
  the build terminal** and the second terminal runs nothing.
- Two windows: window B asks for a tab; window A clicks New Terminal first → B opens a canvas tab onto **A's**
  terminal, and B's own falls through to the panel. M3's other direction silently detaches a popout's panel
  from the long-running process the user was watching.

**Both are fixed, and they needed two different mechanisms — which is the part worth carrying.** The two
bullets look like one bug and are not: one is *which window*, the other is *which ask*.

- **M3, the cross-window half, was addressed by addressing.** `terminal.CREATED` stayed a broadcast — every
  window's list should grow — and the opening moved to `terminal.OPENED`, which the backend `reply`s to the
  asker on the connection it asked from (`be/features/terminal.ts`). `tests/features/code/fe/terminal-opens-for-the-asker.spec.ts`
  holds the split.
- **T4, the one-window half, needed a correlation, and addressing cannot supply one.** A window can have two
  creates in flight and they are not interchangeable. The envelope's call is what names them: `terminal.CREATE`
  mints one, the intent is recorded under it (`pendingOpens`, keyed, replacing the two single slots), and the
  answer carries it back as `Message.answering` — which `callOf(event)` reads. A terminal's id is minted by
  the backend, so nothing *about the terminal* could have been the key; the call is about the ask instead.
  The "build then test" repro above is a case in that spec, asserted in the awkward order — the first ask
  answered second — since that is what a single slot gets wrong in both directions at once. An entry is
  removed by whichever answer settles it, `terminal.ERROR` included, so a failed create leaks nothing.

`packages/default-setup/CLAUDE.md`'s correlation section is where the general rule lives now.

### M — the multi-window amplifier

Popping out is one menu click (`renderer/src/views/WebApp.vue:144`), and the main window does not navigate
away, so "main on Code" + "popout on Code" is immediate. At most two windows can show Code
(`WindowManager.ts:25,151`).

The amplifier is broader: **every surface's actor is spawned in every window regardless of what that window
displays** (`apack-host/src/features/application/fe/machine.ts:416-418`), and the Code surface's `entry`
spawns the terminal child. So a popout of *Notes* runs a full Code surface and terminal child that receives
every terminal broadcast and writes every persisted key. M1, M3, M5 and M6 therefore need only a second
window of **any** surface.

Nothing reconciles cross-window state: no `storage` listener, no `BroadcastChannel`, and no `partition` in
`webPreferences`, so `localStorage` is genuinely one shared store.

**M4 defeats the fix committed as `508715336`.** That commit marks a seam when a pty is replaced under an
existing pool entry. A window that opens the terminal for the *first time* after the replacement builds a
fresh entry at the new pid and replays the pre-restart scrollback from `localStorage` with **no seam** — the
pid is not stored beside the persisted output. Two windows then show the same bytes, one labelled
discontinuous and one presented as continuous.

### X — the platform asymmetry

Three causes rather than thirteen bugs: process control is written in POSIX signals end to end (X1, X2);
shell assumptions are POSIX (X4, X6, X11, X12, X13); and paths are assumed `/`-separated on the way out of
the backend, where the backend's own `path.*` calls are correct but every FE display path and the OSC decoder
hand-roll it (X5, X7, X8). X3 and X10 are a fourth cause outside the feature — the app is configured for
macOS keyboard conventions only, and the terminal feels it most because a shell claims the same keys.

X1 and X2 were verified against `node_modules/node-pty@1.1.0` source rather than from memory:
`windowsTerminal.js:147` defers `kill`/`resize` until the first data event, `windowsPtyAgent.js:118-121`
throws on resize after exit, `:133-150` kills the console process list **asynchronously** via a forked
helper, and `:229` delays the exit event by 1,000 ms. `runShutdownHooks()` runs inside `process.on('exit')`,
where that async kill cannot complete even on a graceful exit.

### G — agent sessions, which stopped being pty-free while this document sat

**On master, Claude Code does not use `terminalService`.** `node-pty` has one importer in `src/`,
`terminalService` has two (the terminal system, and `hooks.ts` for `killAll`), and the agent path uses plain
`child_process.spawn`, reaching the UI through the chat/threads pipeline and never `terminal.*`. So F1-F17
do not reach agent sessions as the tree stands.

**That is no longer the whole picture, and the difference matters more than the findings below.**
`session/claude-code-integration` (#372) adds a **native** half that runs the real `claude` TUI inside a pty
and parses its screen into structured dialogs. On that branch there are three pty owners
(`services/terminal.ts`, `claude-code/terminal-owner.ts`, `claude-code/background-attachment.ts`), a local
`claude-code/native-process-ownership.ts`, and an attach lifecycle of its own. So the agent path is a client
of the terminal capability rather than a stranger to it, and the goal designs that capability against the
TUI adapter for exactly this reason. The target shape is a non-blocking comment on #372.

**Re-verify every G finding against that branch before acting on it.** `runner.ts`, `handle-store.ts`,
`query.ts` and `hooks.ts` all move substantially there, and **G3 is already fixed** — `hooks.ts` calls
`killAllHandles()` on shutdown. The sketches below are against master.

It independently repeats the write-amplification class, and worse: **G1** flushes
`updateMessageState(messageId, { text: buffer })` with the *entire accumulated text* every 80 ms, and again
for thinking at 250 ms. A 60-second answer producing 40 KB is ~750 flushes averaging ~20 KB → **~15 MB of
LMDB writes and ~15 MB over the bus for 40 KB of text**, quadratic in message length, on every turn. The
event *count* is coalesced correctly; the payload is not, and it runs on every agent turn rather than only
while dragging a divider as F5 does.

**It was filed as a suspect for the write-discard issue
(`docs/archive/issues/postmortem-pattern-kill-note-loss.md`); that link is historical.** The buffering
adapter whose failure path discarded writes silently no longer exists — the data layer moved to elmdb, which
commits as it returns and keeps no copy in memory. So this is wasted work rather than a data-loss vector,
which is the defect on its own terms and not a smaller one. That postmortem still reads "it is not fixed, and
it is still happening"; whether the move closed it needs its own check, and the file being gone is not that
check.

**G3 is the mirror of F7**: the terminal over-kills a stale pid, while the agent path under-kills a live
child — `onShutdown` doesn't touch `activeHandles`, the child is spawned without `detached`, and
`runner.ts:331` signals only the CLI process where the terminal path uses `killProcessGroup`. Quit the app
mid-turn and `claude` keeps running, still using tools, still spending.

---

## Negative results

Recorded so they are not re-investigated.

- **Terminal output cannot produce a clickable `apack://` deep link.** Two independent facts:
  `@xterm/addon-web-links@0.11.0`'s only regex matches `https?` (read out of the shipped bundle) and no
  `urlRegex` option is passed; and `main/src/modules/shell-access.ts:13` allows only `http:`/`https:` for the
  external branch. The remaining gap is S4, which the terminal cannot reach.
- **Claude Code does not share the pty infrastructure** — **true on master only.** #372 gives it ptys of
  its own; see the G section. Recorded here because the original claim shaped this document's scope, and a
  negative result that has expired is worse than none.
- **`pty` resize does not oscillate between windows** — every re-fit trigger was traced and none is driven by
  another window or the backend. M2 is last-writer-wins, not thrash.
- **Keystrokes reach the pty once, not twice, with two windows.** `onData` is registered once per pool entry
  and each window has its own pool.
- **`terminalPool` is genuinely per-window** — built-in pack frontends are statically imported into the
  renderer bundle, so each BrowserWindow's realm evaluates its own singleton.
- **Persisted output is not duplicated across windows** — all windows write one key, so replay is one copy.
  The failure mode is truncation (M1).
- **One window cannot prune another's live persisted output** — both prune against the same broadcast list.
- **Tab reorder and drag key on id/path, not index** — verified through `useTabDragDrop` and `reorderTabs`.
- **A stale persisted terminal tab is dropped cleanly** — no ghost, no crash. The defect in that area is T3's
  loss path. (The pinned case is T2.)
- **`maxTerminals` is enforced on create** — the failure is only invisible, which is F9.
- **Round 1's `dataDisposable`/`exitDisposable` leak, `CLOSED` disposal, and `savedScrollFraction` math** were
  each checked and are correct; the newline-boundary trim is deliberate.
- **The same terminal in both canvas and panel is not reachable in one window** — see Corrections. This is a
  fact about today's behaviour and **not** an answer to round 1's open fork: the guards that produce it are
  display conditions, not a stated rule, and M3 already defeats them across windows.

---

## Root causes

1. **Ownership is diffused.** Three modules own parts of one terminal's lifecycle, so every invariant — one
   host, one handler set, one scroll policy — is a convention. F1, F2, F15, T1, T7 follow.
2. **There are three copies of the scrollback** (xterm's buffer, the bus's string, `localStorage`) and the two
   that were added are the slow, window-shared ones. F3, F6, F11, M1, M4, M6 follow.
3. **Request/reply is modelled as broadcast plus a shared slot.** No correlation id anywhere. T4, M3, and
   half of T3 follow.
4. **A deny-list is used where an allow-list is required** — for the pty env (S1) and for what the bus logs
   (S2). Both went stale because neither has a test that would notice.
5. **A persisted row is treated as a handle rather than as data** — the pid (F7, L2) and the shell path (S3).
6. **Process control, shell assumptions and path handling are POSIX-shaped end to end.** All of X.
7. **Nothing is observable.** No tests, one write-only error channel (F9), and the one log that would have
   shown the input problem is hidden in the UI by default.

---

## What comes after this, and what it changes here

Two deferred plans follow this work, in order: the
[ghostty-web migration](../archive/plans/xterm-to-ghostty-web.md) replaces the emulator, and the
[terminal runtime refactor](../deferred/terminal-runtime-refactor-target.md) moves process and
terminal-state authority into a host-owned service over a Rust broker. Neither is authorized, both are
undated, and this list is meant to land first. Reading them changes four things here, and it is cheaper to
know now than to discover at each stage:

- **The migration's primary replacement point is `terminal-pool.ts`** — the file the presentation phase rewrites.
  Its Phase 1 requirements *are* that phase's invariants, in its own words: one output subscription and input
  registration per entry, concurrent creation for one id deduplicated, asynchronous completion guarded
  against a disposed or replaced entry. So the two are not redundant, but that phase must **draw its boundary
  at the emulator**: the session owns lifecycle, ownership and subscription, and reaches the emulator
  through a seam narrow enough that the migration swaps an implementation rather than reopening ownership.
  Not an engine abstraction and not a selection flag — the migration refuses both, and so does this: one
  emulator at a time, the seam internal to the feature.
- **The baseline measurement is the migration's too.** It asks for first-open latency including
  WASM, sustained output responsiveness, large-history replay, memory with several hidden sessions, resize
  behaviour and packaged payload size, on one machine and corpus, with limits agreed *before* cutover.
  Measuring once and recording it where that plan can cite it is the whole of the saving.
- **The platform tier is dissolved rather than deferred.** X1 and X2 are node-pty's Windows
  behaviour, and the refactor gives PTY and ConPTY ownership to the broker. With no released build there are
  no Windows users to protect in the interim, so writing those fixes now is likely paying for code the
  refactor deletes. X3 and X10 are not in that category — they are the app's menu and hotkey handling, which
  no terminal plan touches.
- **S2 is confirmed by the refactor, not merely compatible with it.** It specifies that logs carry *"IDs,
  sizes, revisions and reason codes, not keystrokes, prompts, raw OSC or transcripts."* The decision below
  was reached independently; this is the same rule arrived at twice.

The one reversal is F14, recorded in decision 3.

## What each fix looks like

**Ordering belongs to the goal, not here.** These are the design sketches its phases cite — what a fix *is*,
not when it happens. Each heading names the goal phase that delivers it; where the two differ, the goal is
current. These groups carried stage numbers until the goal existed, and dropping them is deliberate: a
document with its own stage ordering beside a goal with phases is two plans for one body of work.

### The harm — independent of everything else *(goal: Phase T)*

1. **S2**: log the event type and target, never the payload, at the bus seam (decision 5), with the firing
   case that fails if a payload reaches a log.
2. **S1**: capture the token at boot and delete it from `process.env`, and strip the app's identity variables
   from spawned shells by a derived list (decision 4). Closes G2 and G4 with it.
3. **F9**: report terminal errors through `reportError`, which the shell already turns into a toast — not a
   new `HostShell` command. `HostShell` exposes no `notify`, so the mechanism this document first named does
   not exist; the one that does needs no new published API.
4. **F10**: add `onContextLoss`. Three lines; a past commit fixing a GL-context crash at teardown proves
   context loss happens here. **Provisional**: it is xterm's WebGL addon specifically, and the ghostty-web
   migration may remove the renderer it guards. Three lines is worth paying twice; a larger fix here would
   not be.

None depends on the restructure. 1 and 2 are the only items in this document that are about user harm rather
than user annoyance.

### Observability, before the hot path moves *(goal: Phase G)*

The pack suite is `environment: 'node'`, so `terminal-pool.ts` is unreachable by it. Add a jsdom project for
the pool and the bus, and `drive/` scripts for the interactive invariants. **This stage is also where F3, F4,
F5 and G1 get measured** — they are currently inferences, and the repo's own rule is to measure before
optimising *and before accepting someone else's measurement*, including mine.

### One owner per terminal *(goal: Phases B, H and P)*

A `TerminalSession` owning the xterm, the wrapper, the subscriptions and the pty wiring. Views become hosts
that receive a node and emit intent, and cannot register a handler. Fixes F1, F2, F15, T1, T7, and makes
M2/M3/M4 expressible as "a session belongs to one window".

**Whether a session may have more than one visible host is the open fork, and the argument is about ptys, not
about the current code.** A pty has exactly one `(cols, rows)` and emits one stateful stream — alt screen,
cursor, scroll regions all live in it — so two visible hosts at different sizes is not a bug to fix but a
contradiction, which is what M2 looks like in practice. That argues for one host per session, and it would
argue for it even if no guard existed today. The cost of choosing it is the use case it refuses: watching one
terminal in a popout on a second monitor. tmux answers that with per-client sizing or a smallest-common size;
choosing to support it means a real multiplexer (two xterms over one pty, with replay), which is materially
more work. Either way the rule belongs in **one owner** rather than in template conditions a new entry point
can forget — that part is settled by M3 regardless of which way the fork goes.

### The output pipe *(goal: Phases B and P)*

Coalesce pty data in the backend on a ~8 ms or size threshold; enable node-pty `flowControl` with ack-based
pause; replace the concat ring with a chunk list or drop the second copy and snapshot xterm's buffer with
`SerializeAddon`; move persistence off `localStorage`. Fixes F3, F4, F6, M1, M6, and makes F11 trivial. Apply the same payload discipline to G1, which is the same defect in another feature.

### Correlation and resize discipline *(correlation done; resize goal: Phase B)*

Give create a correlation id so a reply finds its requester, and scope a session to a window. Fixes T4, M3,
M5. Separately: one resize send per settled size, rAF-debounced, guarded on changed dimensions, and stop
writing EARS on resize at all. Fixes F5, which no longer bears on the write-discard investigation — see G1
for why that link lapsed.

### Stored rows are not handles *(goal: Phase B)*

Bound or remove the orphan kill (F7); make `killAll` mark rows closed and cap `restoreAll` (L2); validate
shell and cwd on restore after settling F13 (S3); delete or trash closed rows (L3); add `onError` to the
restore actor (L1).

### Platform *(X3 and X10 goal: Phase T; the rest held)*

X1/X2 need a Windows job object or an explicit tree kill, and a shutdown path that can await. X3 needs a
non-darwin menu. X10 needs `cmd`→`ctrl` normalisation. The rest of X follows from one allow-list and one
path-handling decision.

### Completeness, and shell integration *(goal: Phases A and P)*

Shell integration needs a decision, not a fix, because it has never run. The options, from cheapest:
**delete it** and title from the shell/process name; **listen instead of inject** via xterm's
`onTitleChange`, since most shells' prompts already emit OSC 0/2 and this needs no pty writes and works on
Windows; **do it properly VS Code-style**, injecting through the environment (`--init-file`, `ZDOTDIR`,
`XDG_DATA_DIRS`, `-NoExit`) and shipping rc scripts, which also buys per-command exit status and
re-run-command; or **ask the OS** for the foreground process and cwd from the pid, which needs no shell
cooperation. Then: `SearchAddon`, scrollback/font settings, bracketed paste everywhere, `TERM` set
explicitly, and the dead declarations (L6-L8).

Separate from the terminal but found here: **G2, G3, G4, G6** are four small, independent fixes to the agent
path, and **G1** belongs with the output pipe's payload discipline.

### What makes it stay fixed

- The `TerminalSession` seam, so a view *cannot* wire a handler.
- **Allow-lists with a firing test** for the two places a deny-list rotted: no app-owned env var in a pty, no
  event payload in a log. Each needs a test that fails when the list goes stale — that is what neither had.
- An invariant spec: one attached host, one `onData`/`onResize` per terminal, one window per session.
- A perf budget test: N MB of output must produce at most M events and at most K ms of main-thread time. The
  only thing here that would have caught F3, F4 and G1 before a user felt them.
- A correlation id on every request/reply pair, so "which reply is mine" is not answerable by luck.

## Decisions (D1–D8)

Settled 2026-11-07. D9–D11 are the goal's and are not repeated here. Each records what was chosen and what choosing it costs, so a later reader can reopen one
on its merits rather than rediscover the question.

1. **Restructure, not repair.** Seven of the root causes are structural, and the existing code is
   not a quality baseline, so the rewrite covers the ~1,340-line core (service 430, system 330, pool 362, bus
   218) against the invariants here, with the findings as its acceptance criteria. The cost is that it lands
   as one larger change rather than 58 reviewable ones; the alternative's cost is reasoning about a structure
   that is going to be deleted, once per finding.
2. **One visible host per session**, not a multiplexer. The argument is the pty's shape — one
   `(cols, rows)` and one stateful stream, so two visible hosts at different sizes is a contradiction rather
   than a bug, which is what M2 looks like in practice. It holds whether or not today's guards exist. The
   cost is the case it refuses: watching one terminal in a popout on a second monitor, which would need two
   xterms over one pty with replay. Revisit if that case is wanted.
3. **F14: fix the mechanism, keep the capability.** An earlier revision of this document chose to
   delete `injectShellIntegration` and take titles from xterm's `onTitleChange`. That was wrong, and the
   deferred [terminal runtime refactor](../deferred/terminal-runtime-refactor-target.md) is why: its
   agent-observation pipeline runs on *"parsed OSC command markers for cwd, prompt, command start/end and
   exit status"* and names VS Code's shell integration as the design to follow. Deleting that capability now
   means rebuilding it two plans later.
   What is defective is the **mechanism**, not the feature: `injectShellIntegration` types into the user's
   interactive shell, which echoes, races startup, needs a branch per shell and has none for PowerShell or
   cmd (X4). Replace it with launch-time injection — `--init-file`, `ZDOTDIR` over a temporary directory
   that sources the user's, `XDG_DATA_DIRS`, `-NoExit` — and ship the rc scripts as app assets. That also
   turns X4 from a dead end into a supported platform, and treats reported paths and titles as untrusted
   metadata, which the refactor requires.
   The cheap deletion remains available if the refactor is abandoned; it is a false economy while it is not.
4. **S1 is fixed at the source, not at the spawn.** The API token reaches every pty because
   `apiToken()` reads `process.env.APACK_API_TOKEN` lazily on every call
   (`packages/api/src/boot/config.ts`), so the variable has to stay set for the process's whole life and
   every child inherits it. Read it once at boot, memoise it and delete the variable; `apiTokenIsOwn()`
   reflects the captured provenance instead of re-reading. That removes the leak for **every** child the API
   spawns, now and later, rather than for the one spawn site a filter would cover, and it is asserted by a
   boot-time check that the variable is gone. The cost is that the token is no longer readable from the
   environment by anything that expects to find it there; nothing in this repo does, and a tool that wants
   it reads `apiTokenFile`.
   **The app's identity variables are stripped from spawned shells by a derived list**, not a written one:
   `APACK_ENV`, `APACK_USER_DATA_DIR`, `SHIPPED_PACKS_DIR`, `API_PORT`, `ELECTRON_RUN_AS_NODE` and
   `NODE_ENV` are what `packages/main/src/modules/api-server/config.ts` adds when it starts the API, and a
   user's shell inheriting them gets an `ELECTRON_RUN_AS_NODE=1` that breaks any Electron app they launch
   from it. Deriving the list from that construction is what makes a variable added there impossible to
   forget here; the hand-written `BLOCKED_ENV_VARS` deny-list in the terminal service is the shape that
   rots, and S2 is what that shape costs.
5. **The bus logs an event's type, target and sender — never its payload.** `TERMINAL_INPUT` carries a
   keystroke, so a payload at that seam is every password typed at a `sudo` or `ssh` prompt written to
   `main.log` and `main.jsonl`, which outlive the session and get attached to bug reports. Not behind the
   debug gate either: debug is what gets turned on when a terminal misbehaves, which is exactly when
   keystrokes would be captured. A per-type allow-list at the seam is the deny-list that rotted into this,
   so there is none; a payload worth reading is read at the handler, where what it holds is known. The cost
   is that one grep no longer reconstructs a session's traffic, and the guard is a sentinel search over the
   serialized record rather than a check for named fields.
6. **A finding closes with recorded evidence, in one of three shapes.** A test that fails before the change
   and passes after; or `dissolved`, which names the construction that removes the finding **and** a guard
   that fails if that construction is undone; or an explicit `driven: <what was done>` with the reason no
   test fits. A `dissolved` row with no guard is not closed, it is unverified. The record is
   [`docs/references/evidence/terminal-ownership.md`](../references/evidence/terminal-ownership.md), whose
   rows are added as findings are touched rather than pre-seeded, since this document is the list and a copy
   of it there would drift. A fix that exists only on an unmerged branch stays `open` with its branch named.
7. **The presentation rewrite lands as a series, where the core rewrite lands as one change.** D1's argument
   is that reasoning about a structure due for deletion costs more than one larger diff, and that holds for
   the service, system, pool and bus, which no user sees. It does not hold for the renderer: F1, F2, F3, F6,
   F10, F11, F12, F15 and F16 are each independently observable, so a regression in one is a bisect over the
   others, and a rewrite that lands as a single commit makes that bisect impossible exactly where the user
   notices. Phase P therefore lands per behaviour. The cost is that intermediate commits hold a seam that is
   half old and half new, which is why the one-host and single-registration assertions are specs rather than
   a final review.
8. **S2's remediation is the code fix only.** The log files already written are out of scope: the app log is
   off-limits for cleanup. The fix stops the accumulation, which is the whole of what is in scope here.
