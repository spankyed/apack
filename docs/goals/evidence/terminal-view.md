# Evidence: one interpreter, and a view over the rows it sends

Results for [the goal](../goal-terminal-view.md), by phase. Each reading carries its date and conditions.

## Phase 0 — owed checks and baselines, on `master`'s code

Monorepo `6a5b677019`, broker `102ca53`, 2026-11-10, this Mac (load average 6–14 while these ran: a busy
machine, so every duration below is an upper reading).

### The broker's mutation gate over the earlier change

`cargo xtask pre-push --base facc376`, 96 mutants: 79 caught, 8 unviable, 7 timed out, **2 survived — and the
gate passed**. cargo-mutants exits 3 for a timeout and 2 for a survivor, and 3 wins when a run has both; the
gate and the CI job both accepted 3.

- The gate and `.github/workflows/mutants.yml` now read the survivors from the list the run writes (broker
  `8d31d88`).
- The two survivors are closed (broker `0fef59f`): the overflow path of a cell read has a case, and its
  filter for a null code point is gone, being unreachable there; refusing images no longer tolerates a core
  built without the protocol, which `tests/core_features.rs` rules out.
- Re-run over those two commits: 3 mutants, 3 caught.

The seven timeouts are all in `Screen::read`'s loop bound and are the suite's deadline ending a loop that
no longer ends.

### The chain

`npm run chain` in this worktree: 28 of 29 steps passed, `test:smoke` among them. `test:integration` failed
on `packages/apack-cli/tests/commands/add-extensions.integration.spec.ts` ("declares each migration under its
version line"): *stalled: its worker's process tree used no CPU for 120s*, while the broker's mutation run
held the machine. Alone, the spec passes (18 of 18, 182 s). It is not terminal code and is not this goal's
to fix; it is a test that fails on a busy machine, which the repository counts as a defect in the test.

### The window's fixes, in the real app

`tests/e2e/app-integration/terminal-window-fixes.spec.ts`, against the built app with the real emulator, the
broker and a shell. Each case was also run with the window's four terminal files at `5bc0ba224e`, the commit
before the fixes:

| Case | Before the fixes | `master` |
|---|---|---|
| A program asking where the cursor is reads one answer | read `ESC[11;1R` twice | once |
| A paste holding the marker that ends a bracketed paste runs nothing | the text after it ran (`INJ-42` printed) | held as one paste |

**Not reproduced in the app:** a terminal opened after another was closed starting with the closed one's
cells. A case for it passed on both versions, so it proved nothing and was removed. The defect was
reproduced against the emulator's module alone (`ISSUE-ghostty-integration-review.md`), and the fix — a
module instance per terminal — is what `master` has.

### Baselines against the current emulator

`npm run test:e2e -- --config tests/performance/playwright.config.ts`, lightweight recording, five warmups.

| Scenario | Trials | Reading |
|---|---|---|
| `terminal-echo`: a typed character to the frame that painted it, 40 a trial | 20 | median 16.7 ms, p90 24.9 ms, max 25.8 ms |
| `terminal-output`, 64 KiB | 20 | 1,092 ms to the shell's exit; 7 output messages; renderer tasks 57 ms |
| `terminal-output`, 16 MiB (`APACK_PERFORMANCE_TERMINAL_BYTES=16777216`) | 5 | 2,312 ms; 263 output messages; renderer tasks 647 ms, script 442 ms |

The echo is quantized by the display: the emulator paints on the next frame, so 16.7 ms is one frame at
60 Hz. The 64 KiB reading is mostly the shell exiting, which is what ends the measurement.

## Phases 1–5 — contracts, broker, view, data plane, cutover

2026-11-10. Broker `75f6129`, view `cf6b53d`, this repository at the commit that pins them.

### The contract holds across the two repositories

`apack-terminal` writes `node/view-vectors.json` from its Rust encoder: every kind of message, as bytes and
as the value they mean (`tests/view_vectors.rs`, which fails when the file is not what the encoder writes).
`apack-terminal-view` holds a copy and its suite decodes each vector for a view and encodes each one for the
broker (`tests/wire.spec.ts`). The two copies are the same file, which
`packages/repo-checks/tests/terminal-view-vectors.spec.ts` holds them to at the commits pinned here.

### The broker

- **The invariant.** A model view that applies every frame it is sent holds exactly the terminal's rows —
  the screen, and every line of history it still holds — over generated streams, resizes, fetches and
  acknowledgements (`tests/view_model.rs`). Run at 4,000 cases while it was written, 256 as committed. It
  found one defect in the publisher: history erased with nothing on screen moving was not a change a view
  was told of.
- **Broken on purpose**, the same case failed for: no count of scrolled lines; a flood between two frames
  not named stale; a lost row mark not starting a new epoch; the shift between two captures ignored. It did
  not fail for two others, which are covered by direct cases instead (`tests/view_frames.rs`): a program
  holding the screen, and a switch between the two screens starting a new epoch.
- **Over a real socket and a real shell** (`tests/view_broker.rs`): keys typed through a view run, history
  is fetched by line, a paste that could run a command is refused until allowed, a view is sent the screen
  as it ended, and a view that stops acknowledging or sends nonsense costs nobody else anything. 60 runs,
  no failure.
- 211 tests. `cargo xtask pre-push` has not been run over this branch's later commits yet.
- **A flake that predates this work**: `broker::an_alternate_screen_app_survives_a_resize_and_keeps_answering`
  failed 1 run in 30 on `0fef59f`, before any view code, and 0 in 30 after. Not this goal's.

### The view

160 tests against a fake source and a fake broker that is itself held to the broker's vectors. It has only
been seen drawing in the app, below.

### In the app

`tests/e2e/app-integration/terminal-view.spec.ts`, against the built app, the broker and a shell:

| Case | Result |
|---|---|
| A shell is drawn, and what is typed into the view runs | passes |
| A program asking where the cursor is reads one answer | passes |
| A paste holding the end-of-paste marker is shown to the person, and runs nothing when they decline | passes |
| A program's clipboard request (OSC 52) reaches the surface | passes |

The screen is read off the page (`[data-terminal-text]`), which the view publishes; the API process carries
none of it. `test:smoke` passes (8). The full typecheck passes, and the specs the change affects: 571 files
in the host pool, 191 in the pack's.

### Not this goal's, found on the way

Two specs in `tests/e2e/app-integration/` fail, and neither is a gate:

- `surface-sends.spec.ts`, "the code system's file watcher…": fails at its first wait, a file read, before
  any terminal step. The explorer answers `explorer.FILE_CONTENT` by reply, and the spec's raw send has no
  return address for one. Its terminal half was changed here from the output broadcast to a clipboard
  request and cannot be seen passing until the first half does; the same claim is the last row above.
- `db-cli.spec.ts`: expects `apack db reset` beside a running app to be refused, and it exits 0.

## Phases 6–8 — features, recording, remote

2026-11-10. Broker `ca45ef1`, view `0628e7f`.

### A chain run that failed, and why it says nothing about the code

`npm run chain` on the cutover failed in `test:integration` with *Compiler resolution namespace changed
during discovery: …/apack-terminal…/node/view-vectors.json*, twice. The file is in the broker's npm
package, which a pack build captures, and it was re-recorded in the linked broker checkout while the step
ran: the run was not on a quiet tree, which is this goal's own rule. The run was stopped before its native
step finished. Nothing was changed for it; the chain is run again in phase 9 with the sibling checkouts
left alone.

### The shell marks its commands

`integrationFor` writes a hook for zsh, bash and fish that emits OSC 133 at a prompt, at a command's
output and at its end, with OSC 633's command line. Run under a pty against the real shells on this
machine (zsh 5.9, bash 3.2.57), with a user configuration that sets its own prompt hook, both emitted
`133;A`, `133;B`, `633;E;<line>`, `133;C`, `133;D;<status>` in that order for each command, and the status
of `echo one; false` was 1 in both — the user's hook did not replace it. bash reports the first simple
command of a line as the line, which is what `BASH_COMMAND` holds. fish was not installed and was not run.

### In the app

`tests/e2e/app-integration/terminal-view.spec.ts`, against the built app, the broker and a shell, beside
the four above:

| Case | Result |
|---|---|
| A finished command reaches the window (the menu's *Copy Last Command Output* is offered), and text typed is found from the find bar, *1 of N* | passes |
| A terminal's recording is looked back through: it shows the end, then — dragged to its first moment — a screen without what was typed; the shell that replaces the terminal's starts under what the last one printed | passes |
| A target named in the code settings' form is opened from the panel's menu, drawn and typed at; the broker it reached is listening where its command said | passes |

The second found a defect in the broker, fixed there (`339da87`): making a restored screen ready for a new
shell left the alternate screen whether or not it was on it, which also puts the cursor back where a
program last saved one, so a shell that had never been in an application was started over lines the last
one printed.

`test:smoke` passes (8). The full typecheck passes. The specs the change affects pass: 325 files in the
host pool, 194 in the pack's.

### The broker

247 tests. Beside the suites above:

- **A recording replays to what the live screen held** (`tests/recording.rs`): through output, a resize and
  an application on the alternate screen; from its last keyframe and, for a session picked up, from its
  first; cut off mid-entry; and kept inside its budget. A keyframe written row by row lost which rows were
  one wrapped line, found by the round trip and fixed by writing wrapped rows as the line they are.
- **Against the real binary and a real shell** (`tests/keeping.rs`): a kept session outlives its holder and
  is found by the next; the broker exits when its last kept session does; a session begins with the screen
  its recording holds, out of the application the last one was left in; a recording is looked back through
  and typing at it reaches nothing.
- **A proxy** (`tests/proxy.rs`): starts a broker where there is none, is the protocol byte for byte, and
  several arriving together start one — which fails every run without the claim that makes it so.
- **Images** (`tests/images.rs`): a Kitty image sent through the parser is told by the line it is on, which
  stays true after thirty lines scroll it into history, and its pixels are read in parts that join into
  the picture sent.

### The view

194 tests. Images were not seen drawn in the app: the suite proves which picture is drawn where, on a
canvas that records calls, and nothing here ran a program that sends one.

### A terminal on a target

`packages/apack-host/tests/services/terminal-target.spec.ts` runs the real broker behind its own proxy as
the far side — everything `ssh host apack-terminal proxy …` is but the transport: a session is opened and
typed at through the app's socket, a window's greeting on that socket is answered by the far broker, and a
command that reaches nothing says why (*No route to host*).

**Not done: a terminal in the Linux test container.** The goal's phase 8 ends with one drawn in the app.
That needs a Linux build of the broker inside the container, which was not made; what is proven is the
path with the far side on this machine.

### Not driven end to end

- **An app restart.** A terminal's screen surviving one, and a kept session being taken up at the next
  start, are proven in two halves — the broker's against the real binary (`tests/keeping.rs`), the pack's
  against a stand-in broker (`terminal-outlasts-its-shell.spec.ts`) — and by a restart of the terminal's
  shell in the real app, which is the same restore. The app itself was not quit and started again.
- **fish**, and **bash newer than 3.2**, whose `PROMPT_COMMAND` may be an array.
- **A notification raised with the system**, which needs the window not to have focus.

