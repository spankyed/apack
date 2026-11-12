# Goal: one interpreter, and a view over the rows it sends

> **Archived 2026-11-12: merged, with one required check still open.** The broker's mutation gate (its `mutants`
> job) has no answer, and the Current handoff below records it. Archiving does not close it, and it is not
> transferred to [goal-terminal-parity](../../goals/goal-terminal-parity.md), which covers view parity only.
> Reopen this goal, or run the gate as its own task, before treating it as complete.

**Status: merged, with one acceptance check unanswered.** It is on `master` in two repositories: this one
(#410) and `apack-terminal` (its #2), which holds the broker and the view (`view/`, the
`apack-terminal-view` package) and which this one pins at its `master`. What is unanswered is the
broker's mutation gate; the handoff below has it.

## Why

[The integration review](../issues/ISSUE-ghostty-integration-review.md) found the broker and the window
interpreting terminal output with different builds of the core, and disagreeing. The live defects were fixed on
`master`. What is left is the structure that produced them: two interpreters, bytes crossing the app as text
through the API process, a scrollback held twice, and a screen the broker keeps that nothing reads.

**The window stops interpreting.** The broker is the only interpreter and sends each view the rows that
changed. The window paints rows and sends input events.

```
pty ── broker (libghostty-vt 1.0: the only interpreter)
        ├─ control, JSON lines ───── API process: create, kill, resize, events, command records
        └─ rows, binary frames ── relay (Electron utility process) ── MessagePort ── window: view
```

## Decisions

Taken with the user on 2026-11-10 unless marked.

- **D1 — a view over broker rows.** Repairing the emulator in the window (taking upstream's fixes, moving it
  onto the 1.0 WebAssembly build) is dropped: it repairs something the window will not have.
- **D2 — one pull request per repository, at the end.** Nothing merges until it works together.
- **D3 — every user-facing half is built**, and more: command blocks, rewind, background sessions, remote
  targets, find, file links, paste confirmation, bell/notification/progress on the tab, inline images.
- **D4 — the byte-stream session API stays** (`services.terminal`'s `onOutput`, `pause`, `resume`, `signal`,
  `owns`). `session/claude-code-integration-relanded` consumes it. A session is sent bytes only when its owner
  gave an `onOutput`; the terminal feature gives none. *(mine)*
- **D5 — `PROTOCOL_VERSION` stays 1.** Both halves move in this change.
- **D6 — text over the control channel stays text.** The 2026-11-08 measurement stands for JSON; what removes
  the lossy hop is that the window no longer receives bytes at all. *(mine)*

## The design

### Broker

- **Connections.** A `view` role beside `client` and `lifetime`, on the same listener, speaking length-prefixed
  binary. Each connection has its own outgoing queue; answers go to whoever asked. Session events go to the
  control client.
- **Frames, paced by acknowledgement.** A view attaches to a session and is sent a frame when the published
  screen has changed and it has acknowledged the last one. A frame: sequence, epoch, `H`, grid, retained
  scrollback, cursor, modes a view needs (alternate screen, mouse tracking), and the rows changed since the
  frame that view acknowledged. A view that stops acknowledging costs nothing.
- **Row numbering.** Absolute line `L`: history is `L < H`, the active area is `H … H+rows-1`, the oldest line
  held is `H - scrollback_rows`. `H` advances by an exact count, read from a tracked grid reference pinned at
  the active area's top before a feed. A reflow or an erased scrollback bumps the epoch and views drop their
  caches.
- **What changed.** One render state per session. Its dirty flags are conservative, so the broker keeps a hash
  per active row and resends a row only when its encoded form moved.
- **Synchronized output** (mode 2026) through the core's render-hold callback: capture at the hold's start,
  publish nothing until it ends, one second at most.
- **History on request**, by line range. First choice: scroll the terminal's viewport under the session lock,
  read through the render state, scroll back. Kept only if the invariant test below holds with it; otherwise
  an encoded ring of rows as they leave the active area.
- **Input is encoded here**: key, mouse, paste and focus events from a view go through the core's encoders,
  which read the terminal's real modes. An unsafe paste is refused so the window can ask.
- **Reads for a view**: the word or line at a cell, the text of a range, search, the hyperlink at a cell.
- **Effects from the core's callbacks**, as control events: clipboard writes, title, bell, notification,
  progress, program status. OSC 633 arrives through the unknown-sequence callback, so `markers.rs`'s scanner
  goes. Shell facts are pushed (`CommandStarted`, `CommandFinished`, `CwdChanged`), not polled.
- **Command records**: a bounded ring per session with the command line, directory, times, exit status and
  tracked references to its output; one command's output can be read as text.
- **History**: a configurable size (target 100,000 lines), compressed while a session is idle.
- **Images**: Kitty graphics on again once a view draws them; placements in frames, pixels once per image.
- **Recording**: per session, opt-in, an append-only log of pty bytes with snapshot keyframes under a size
  budget. Restore seeds a new session from the last snapshot. Rewind is a read-only session rebuilt from a
  keyframe and the bytes after it, which a view attaches to like any other.
- **Outliving the app, and running elsewhere**: `apack-terminal proxy <socket>` pipes stdio to a broker on
  that socket and starts one if absent, so `ssh host apack-terminal proxy PATH` or
  `docker exec -i c apack-terminal proxy PATH` is a pipe to one long-lived broker per machine. A session can
  be marked to survive the app's hold ending.

### View (`apack-terminal-view`)

No core, no WebAssembly, no Zig, no bun: npm, vite, vitest. It draws from a `TerminalSource` (plain objects:
frames, rows as runs of text with a style and a link, fetch, input methods) and owns the DOM, painting,
scrolling, selection, text input, links and the accessibility mirror. Painting is WebGL2 with a glyph atlas
and the 2D canvas as a fallback behind one interface. Upstream's unmerged renderer work (coder/ghostty-web#162)
is evaluated as a starting point and used only if it survives its own tests against this row model.

### App

- **Relay**: an Electron utility process holds the connections to brokers and serves each window a
  `MessagePort`. The API process is not on this path.
- **SDK**: a frontend port member hands a pack a byte stream for a session; a pack never touches the preload.
- **Pack**: `terminal-pool.ts` owns a row store per terminal and hosts mount views over it. The output
  broadcast, its acknowledgement, the clipboard scanner, the scroll compensation, the paste interception and
  the frame-loop reach are deleted.
- **Vendoring**: the view as an npm package resolved through a vendored checkout's link, replacing the
  `ghostty-web` dependency.

## Phases

Each ends in something checked. A phase is not started on a red one.

| | Phase | Ends when |
|---|---|---|
| **0** | **Owed checks and baselines, on `master` as it is.** The broker's mutation gate over the earlier change; the chain; the window fixes driven in the real app; the three defects reproduced on `5bc0ba224e`; new `terminal-throughput` and `terminal-echo` scenarios run against the current emulator. | Each has a result in the evidence file, and a defect found on `master` has its own fix. |
| **1** | **Contracts.** The view wire format, the `TerminalSource` interface, and test vectors both sides decode. | A vector written by the broker is read by the TypeScript codec and back. |
| **2** | **Broker.** Connections, publisher, frames, numbering, holds, history, input, reads, effects, command records, history size. | The invariant: a model view that applies every frame it is sent holds exactly the terminal's screen and history, over generated streams. `cargo xtask pre-push` green. |
| **3** | **View.** Row store, scroll model, painter, input, selection, links, accessibility, fit. | Its suite passes against a fake source; a recorded session renders in a browser page. |
| **4** | **Data plane.** Relay, port handoff, SDK port. | A page in the real app receives frames for a session without the API process carrying them. |
| **5** | **Cutover.** The pack on the view; the old path deleted; the view vendored. | Typecheck, the code feature's specs, `test:smoke`, and the journeys read real screen text. |
| **6** | **Features.** Shell integration that marks commands for zsh, bash and fish; command blocks; find; file links; paste confirmation; tab indicators; images. | Each has a journey in `drive/` and a spec. |
| **7** | **Recording.** Restore, rewind, background sessions. | A terminal's screen survives an app restart; a session marked to keep running is attached to at next start. |
| **8** | **Remote.** Proxy mode, targets in settings, "New terminal on…". | A terminal runs in the Linux test container and is drawn in the app. |
| **9** | **Acceptance.** The scenarios against the baselines; the strict chain; the broker's gate; the docs; the three pull requests. | Results recorded; pull requests open. |

## Rules for this goal

- A capability the core reports as unsupported, a toolchain change, or a measurement worse than its baseline
  is a finding to report, not something to work around.
- Never mutation-test signal or kill code.
- The chain runs on a quiet tree. Docs are edited between runs, not during one.

## Current handoff

- **Evidence.** [evidence/terminal-view.md](../../goals/evidence/terminal-view.md).
- **Done: phases 0 to 8**, with what was not driven end to end named in the evidence. A terminal in the app
  is drawn from rows the broker sends, over a connection the window opens itself; the emulator, the output
  broadcast and its flow control are gone. Commands are marked, text is found, paths open, a tab shows what
  its program said, a terminal keeps its screen across a restart and can keep its shell, a recording is
  looked back through, images are drawn, and a terminal can run on a target.
- **Changed from the design above, with why.**
  - *No relay process for the app's own broker.* A window's preload opens the broker's socket itself, which
    is the shortest path there is and needs no second process to supervise. A relay exists only in front
    of a target's command (`broker/relay.ts`), in the API process, where each connection is one run of it.
  - *The TypeScript codec lives in `apack-terminal-view`*, where the TypeScript toolchain is, held to
    vectors the broker writes.
  - *The view is a package of the broker's repository* (`view/` there), not a third vendored checkout. As
    a repository of its own it made a change to the wire three pull requests, a vectors file copied by
    hand and two pins that had to move in one commit, with a repo check here to notice when they had not.
    In the broker's repository the view's suite reads the vectors where the encoder writes them, a change
    to the wire is one commit, and this repository has one pin.
  - *Painting is 2D canvas.* The painter is behind an interface; a GPU painter is decided by phase 9's
    measurement against the baseline, not assumed.
  - *A keyframe is the core's VT dump, not its snapshot format.* The core has a snapshot encoder that also
    carries images; a recording's keyframe is the sequences that redraw the screen, which a replay feeds
    like any other bytes. A restored terminal therefore comes back without its images.
  - *Recording follows the existing `restoreTerminals` setting* rather than a setting of its own: a
    recording is what lets a restored terminal come back with its screen.
  - *A terminal on a target has no shell integration and no recording.* Both are files on this machine.
- **Read three times, and driven.** The three branches were read independently three times and what
  the reads found was fixed; a terminal's screen was driven across a restart of the app, and a
  terminal in the Linux test container was drawn in the app and taken up again as the same shell.
  The evidence has both, and the one container run in thirty that failed, with what was ruled out.
- **Changed by the reads.** A row carries its own styles and links; a frame carries the colours a
  program changed; a broker holds a lock on its socket; a terminal on a target is not reached by the
  app starting, and is listed *not connected* until a person starts it; a path a program printed opens
  at its line, by the reveal the search panel already used.
- **The strict chain passed on `master`**, all six jobs, on `fe363300fd` with the broker pinned at its
  `master` (`7eb912fa`): run 43065653768.
- **Open: the broker's mutation gate has no answer.** Its `mutants` job has never finished over this
  change. Until 2026-11-11 it failed in its unmutated baseline on a case that depended on the machine's
  load; with that case fixed it ran for the first time, on the broker's `master`, and the runner was lost
  four and a half hours in, leaving no log and no list of survivors. The evidence has what is known.
  The next action is to learn why before running it again: how many mutants the change holds, how long
  one takes, and whether one of them is what stopped the runner.
- **Resolved: Windows has been run.** The PowerShell hook and the proxy through the real broker, and
  the view's drawing, composition and third-level keys in a browser there
  ([evidence](../../goals/evidence/terminal-view.md#the-view-in-a-browser-on-windows--2026-11-12)). What it rests
  on is said there: AltGr was an event built to Chromium's shape, not a key pressed.