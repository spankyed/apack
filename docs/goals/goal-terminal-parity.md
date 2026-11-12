# Goal: terminal view parity, and command blocks

**Status: planned.** Owner: the terminal view (`vendor/apack-terminal/view`) and the Code surface
(`packages/default-setup/src/features/code`). Builds on [the view goal](../archive/goals/goal-terminal-view.md), which is merged.

## Prompt

````text
```text
# Goal: terminal view parity, and command blocks

Implement docs/goals/goal-terminal-parity.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Decisions, Phases and Current handoff before continuing.
The survey was made at master 32ca2031a2; inspect current code before relying on it.
Work phases in order. Each phase is finished when its Done-when conditions hold on current source.
Commit validated checkpoints as you go. Do not expand or reduce scope without user authorization.
```
````

## Why

The view is minimal by design: the broker interprets and the view paints. The survey against xterm.js and
ghostty-web (both read from source, not from their READMEs) found what a user will notice, and the one
defect that matters:

- **OSC 52 writes are dropped silently whenever no window has focus.** The broker reports them correctly. The
  window's handler (`writeClipboard`, `packages/default-setup/src/features/code/fe/features/terminal/state.ts`)
  returns early on `!document.hasFocus()` and swallows any rejection. Nothing tests the path.
- **Confirmed present, unverified end to end:** drag auto-scroll (`DRAG_LINES_PER_SECOND`, `view.ts`), wheel to
  full-screen programs (the wheel handler sends the wheel to a program that asked for the mouse, and arrow keys
  on the alternate screen, `view.ts` near `wheel`), kitty keyboard input (the view reports physical keys and the
  broker's core encodes them).
- **Missing:** copy-on-select, a minimum contrast ratio, rectangular selection, command blocks.
- **Correction:** double-click word and triple-click line selection exist (`view.ts`, the click count sets
  `Granularity`).

## Scope

In:
- Every item in Phases 0 to 7.
- Repositories: `monorepo` (Code surface, app settings, Electron main and preload) and `apack-terminal`
  (view and broker). The view changes ship in `apack-terminal` and are pinned here after they land.

Out:
- Ligatures. The painter draws cell by cell, so shaping them is a painter rewrite. Reconsider only if a user asks.
- Sixel images. Add them only when a tool we use emits them.
- Touch input. This is a desktop app.
- The screen export. Deferred until someone asks for it.
- Any change to `PROTOCOL_VERSION`, which stays 1.

## Current handoff

- Worktrees (created 2026-11-12, each on its own branch):
  - `monorepo-worktrees.noindex/terminal-parity` on `session/terminal-parity-work`: the Code surface, settings, Electron main and preload. Its `vendor/apack-terminal` links to the broker worktree below.
  - `apack-terminal-worktrees.noindex/terminal-parity` on `session/terminal-parity-view`: the view and the broker. Changes to it are committed there and pinned from the monorepo only after they land.
  - This document: `monorepo-worktrees.noindex/native-stall` on `session/terminal-parity-goal`, PR #444.
- Pin: the monorepo's `master` pins the broker at `efe5d84`, which is 24 commits behind the broker's `master`. Bump `vendor/apack-terminal.rev` in the same change that lands the first view commit.
- Phase 0 is done. Its results are in [the evidence record](../references/evidence/terminal-parity.md): kitty
  keys and the cursor key into a real pty pass, the view's wheel and auto-scroll tests pass, and OSC 52 reaches
  the broker's client. The app side of OSC 52 is Phase 1's defect, not a Phase 0 result.
- Phase 1 is done, with its results in the evidence record: the main process writes the clipboard, the window no
  longer checks focus, and a read request is answered nothing. Its limits (an 8 MiB refusal shown to nobody, and
  one write per window) are stated there.
- Phase 2 is done in code and checks: [the evidence record](../references/evidence/terminal-parity.md#phase-2--copy-on-select-2026-11-12).
  The broker pull request (spankyed/apack-terminal#16) is open and green, but its merge was denied by the permission
  system, so the app pins its branch commit for now. Repin to the merge commit once it lands.
- Phase 3 is done in code and checks: [the evidence record](../references/evidence/terminal-parity.md#phase-3--minimum-contrast-ratio-2026-11-12). The app pins the view commit that carries it.
- Phase 4 is done: [the evidence record](../references/evidence/terminal-parity.md#phase-4--the-canvas-painter-under-heavy-output-and-the-gpu-decision-2026-11-12). Neither machine's p95 frame exceeds 16 ms, so the GPU renderer (D5) is not built.
- Phase 5 is done: [the evidence record](../references/evidence/terminal-parity.md#phase-5--rectangular-selection-2026-11-12). The app pins the view commit that carries it.
- Phase 6 is done: [the evidence record](../references/evidence/terminal-parity.md#phase-6--the-accessible-document-2026-11-12). The VoiceOver checklist is written there; running it is a follow-up, not a condition.
- Next deliverable: Phase 7 (command blocks: re-run and copy any command, failure highlight, then fold).
- Unresolved: none. Nothing in this goal depends on a manual step; see D6.

## Decisions

Each decision is the path I'd take. Where the user has not decided, these stand.

- **D1 — OSC 52 writes go through the main process, not the window.** The main process is the one writer, and it
  needs no focus. The window keeps forwarding the broker's event but no longer writes. A write is still gated by
  `terminalClipboardWrite`. *Why:* the focus rule is a workaround for "more than one window hears the event" and
  that is solved by having one writer. The broker already reports the write as taken, so a program never retries.
- **D2 — OSC 52 reads are refused.** A program asking to read the clipboard gets no answer. *Why:* a read hands
  whatever the person copied to any program that prints the right sequence. Ghostty asks; we refuse, because a
  prompt the person has to answer for every read is noise and the safe default is the only one that never leaks.
- **D3 — copy-on-select is off by default**, as in iTerm2 and macOS Terminal, with an option in Code settings.
  *Why:* on by default it overwrites the clipboard on every selection, which surprises most people on macOS.
- **D4 — the minimum contrast ratio is off by default (1.0)**, as in xterm.js. It is set per session. *Why:* a
  default changes every colour in every program; people who need it set it, and a default of 4.5 would alter
  programs that chose their colours deliberately.
- **D5 — the GPU renderer is built only if the Phase 4 measurement fails.** *Why:* a WebGL painter is a large
  rewrite, and the measurement decides whether it is needed.
- **D6 — the goal's completion is judged on the automated accessibility contract alone.** A VoiceOver run is a
  follow-up, not a condition. It is written as a checklist in evidence, and whenever someone runs it, its result is
  recorded there. Nothing in this goal waits on it, and a failing VoiceOver result opens a new fix, not a reopening
  of this goal. *Why:* completion must not depend on a step no agent can perform.
- **D7 — command blocks belong to the Code surface.** The view learns one generic thing (collapsed line ranges).
  It never learns what a command is. *Why:* the view is reusable and must not depend on a shell's markers.
- **D8 — rectangular selection is Alt-drag on Linux and Windows, Option-drag on macOS**, as in xterm.js.
  Linear selection stays the default. *Why:* it is what users of xterm-derived terminals expect.
- **D9 — the kitty keyboard protocol is verified, not reimplemented.** If the end-to-end test passes, nothing
  changes. If it fails, the fix goes in the broker's key path, not in the view. *Why:* the core already encodes keys.

## Phases

Each phase names its deliverable, its dependencies, and what is done when it finishes.

### Phase 0 — verify what is present

- **Deliverable:** one end-to-end check each for kitty keyboard, the wheel into `less`, drag auto-scroll, and
  an OSC 52 write from a program that runs in the terminal.
- **Dependencies:** none.
- **Done when:** each has a recorded result in evidence, pass or fail. A fail opens its own phase fix, under the
  phase it belongs to.

### Phase 1 — OSC 52 writes reach the clipboard (D1, D2)

- **Deliverable:** the main process writes clipboard text on the broker's event, through a preload call. The
  window's `writeClipboard` is removed. Read requests are refused in the broker's callback.
- **Dependencies:** Phase 0's OSC 52 check, for the baseline.
- **Done when:**
  - a test with no window focused shows the clipboard written;
  - a test shows `terminalClipboardWrite: false` writes nothing;
  - a broker test shows a read request is refused and nothing is written back to the program;
  - the frontend spec for the window path is replaced by the main-process test.

### Phase 2 — copy-on-select (D3)

- **Deliverable:** an option on the view (`copyOnSelect`, default `false`) that copies the selection on mouse-up.
  An app setting in Code settings passes it through.
- **Dependencies:** none beyond the view's `onCopy`, which exists.
- **Done when:** the view test shows a selection copies only when the option is on; the settings test shows the
  value reaches the view.

### Phase 3 — minimum contrast ratio (D4)

- **Deliverable:** `minimumContrastRatio` on the view (default `1`). When set, a cell's foreground moves away from
  its background until the WCAG ratio reaches the minimum. Results are cached by colour pair.
- **Dependencies:** none.
- **Done when:**
  - known pairs (black on black, white on white, and one that already passes) are checked against the WCAG formula;
  - a mutation check breaks the adjustment and is caught;
  - the default leaves every colour unchanged.

### Phase 4 — canvas painter timing (D5)

- **Deliverable:** a timing harness that drives the view with a full-screen repaint of coloured text, 200×50 cells,
  and reports the frame time at the 95th percentile.
- **Dependencies:** none.
- **Done when:** the harness runs in the Linux test container and on the Mac, and the result is in evidence.
  **Decision gate:** a p95 frame time above 16 ms on either machine means D5 starts the GPU renderer as a new phase.
  Otherwise D5 closes with the numbers.

### Phase 5 — rectangular selection (D8)

- **Deliverable:** `shape: 'linear' | 'block'` on the view's selection. Alt-drag (Option-drag on macOS) makes a block
  selection. Text extraction takes each row's column range. Copy respects the shape.
- **Dependencies:** none.
- **Done when:** a test over a wide-character row checks the text a block selection copies; a test checks linear
  selection is unchanged.

### Phase 6 — screen reader (D6)

- **Deliverable:** an automated contract for what the accessibility tree exposes (role, label, and the text
  attribute the view publishes), and a VoiceOver checklist written into evidence for a later run. The checklist
  covers at least two steps on macOS: VoiceOver reads the screen text of a running session, and typing into the
  terminal's input field works with VoiceOver on. Each step says what was heard or typed, so a later run can be
  compared with it.
- **Dependencies:** none.
- **Done when:** the automated contract passes and the checklist is written. The goal completes on this. A
  VoiceOver run, when someone does one, is recorded in evidence as a follow-up and blocks nothing.

### Phase 7 — command blocks (D7)

Phases 7.1 and 7.2 need only the Code surface. Phase 7.3 needs the view primitive from `apack-terminal`.

- **7.1 — re-run and copy any command.** Deliverable: the command list (from the view's `commands`) with a
  per-row action to copy that command's output, or to re-run its text through the view's text input.
  Dependencies: none. Done when: a test re-runs a command and copies a chosen command's output.
- **7.2 — failure highlight on the block header.** Deliverable: the header tints by exit outcome, reusing the
  gutter's colours. Dependencies: 7.1. Done when: a test shows a non-zero exit tints its header and a claimed
  status is shown as a claim.
- **7.3 — fold command output.** Deliverable, in two repositories:
  - in `apack-terminal`: collapsed line ranges. A range draws as one header row, and scrolling and selection map
    through it. The view knows nothing of commands.
  - in `monorepo`: the Code surface collapses each command's output range through that primitive.

  Dependencies: 7.1, and the view primitive landing and being pinned. Done when: a fold hides and restores
  output, survives scrolling and resize, and a copy of a folded block still copies its full output.

## Acceptance

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| OSC 52 writes reach the clipboard with no focus | Reported by the broker; the window drops them (`state.ts`) | none | Phase 1 |
| OSC 52 reads are refused | not verified | none | Phase 1 |
| Kitty keyboard works end to end | the view reports keys; the core encodes | none | Phase 0 |
| Wheel reaches `less` and `vim` | the wheel handler, `view.ts` | none | Phase 0 |
| Drag auto-scroll | `DRAG_LINES_PER_SECOND`, `view.ts` | none | Phase 0 |
| Copy-on-select, default off | missing | — | Phase 2 |
| Minimum contrast ratio, default off | missing | — | Phase 3 |
| Painter timing decided | not measured | — | Phase 4 |
| Screen reader contract (automated) | partial | — | Phase 6 |
| Rectangular selection | missing | — | Phase 5 |
| Re-run and copy any command | `commands` exists, no UI | — | Phase 7.1 |
| Failure highlight on blocks | the gutter colours exist | — | Phase 7.2 |
| Fold command output | missing | — | Phase 7.3 |

## Constraints

- `PROTOCOL_VERSION` stays 1 (see [the view goal](../archive/goals/goal-terminal-view.md)).
- No backward-compatibility shims. A changed contract moves every caller in the same change.
- Mutation-check the guards. A test that restates its implementation does not count.
- Validate in the bounded way CLAUDE.md describes: focused specs during a phase, the chain at a converged checkpoint.
- Changes to `vendor/apack-terminal` are committed there and pinned here only after they land.
- Do not edit release or version metadata.
- Each phase ends with its evidence written to `docs/references/evidence/terminal-parity.md`.
