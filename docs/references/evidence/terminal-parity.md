# Terminal parity: evidence

Checkpoint log for [the terminal parity goal](../../goals/goal-terminal-parity.md). Each entry records its date,
source commits, exact commands and results, and what it does not establish.

## Phase 0 — verify what is present (2026-11-12)

Source: `apack-terminal` branch `session/terminal-parity-view` at `25fad72` (from broker `master` `f385161`);
monorepo branch `session/terminal-parity-work` at `f4746a9ee5` (`master`).

| Behaviour | Check | Result |
|---|---|---|
| Kitty keyboard protocol reaches a program end to end | `a_program_that_asks_for_the_kitty_keyboard_protocol_is_sent_keys_as_it_encodes_them` (broker, `tests/view_broker.rs`) | pass |
| Cursor key reaches a full-screen program that asked for no mouse (the path a wheel notch takes) | `a_cursor_key_sent_to_a_full_screen_program_that_asked_for_no_mouse_reaches_it` (broker) | pass |
| Wheel decision: a notch is an arrow key on the alternate screen, and a mouse-reporting program is sent the wheel | `the wheel` cases in `view/tests/interaction.spec.ts` | pass (65 of 65 in that file) |
| Drag past an edge scrolls, faster the further past | `scrolls the view while it is dragged past an edge, faster the further past, and stops when it is let go` (`view/tests/interaction.spec.ts`) | pass |
| OSC 52 write reaches a client as a clipboard event | `a_programs_title_clipboard_and_commands_are_told_to_the_client` (broker, `tests/view_broker.rs`) | pass |

Commands:

    cargo test --test suite -- a_program_that_asks_for_the_kitty_keyboard_protocol a_cursor_key_sent_to_a_full_screen_program
    # in view/
    npx vitest run tests/interaction.spec.ts

## Phase 1 — OSC 52 writes reach the clipboard (2026-11-12)

Source: monorepo `session/terminal-parity-work` (this commit); broker `session/terminal-parity-view` at `e2075c6`.

**The defect, as found.** The broker reports a program's write (`Event::Clipboard`), the backend forwards it to the
windows (`terminal.CLIPBOARD`), and `writeClipboard` returned early on `!document.hasFocus()` and swallowed any
rejection. A write that arrived while the app had no focus was dropped without a trace.

**The change (D1).** The main process writes the clipboard (`packages/main/src/modules/clipboard-access.ts`, handler
`clipboard:write-text`), reached from the window through the bridge `clipboard.writeText`, typed in
`packages/apack-sdk/src/fe/electron-api.ts` and declared in `packages/apack-sdk/etc/fe.api.md`. The window's handler
no longer checks focus. The bridge answers whether the text was written.

**Read refusal (D2).** The broker installs no read callback. The test below pins that a read is answered nothing.

| Behaviour | Check | Result |
|---|---|---|
| The main process writes text and says it did; refuses non-text and text longer than `MAX_CLIPBOARD_TEXT`; writes exactly the maximum | `packages/main/tests/clipboard-access.spec.ts` | pass (5 of 5) |
| A window hands the write to the main process whether or not the document has focus | `terminal-says-and-outlasts.frontend.spec.ts`, "is handed to the main process" | pass |
| A window does not write through the browser, which refuses an unfocused document | same file, "is not written by the window itself" | pass |
| Mutation: the focus gate put back in `writeClipboard` | the two window cases above | both fail, as they should; file restored |
| A read request is answered nothing and reports no clipboard event | `a_program_that_asks_what_the_clipboard_holds_is_answered_nothing` (broker, `tests/view_broker.rs`) | pass |
| The broker's view-connection suite | `cargo test --test suite -- view_broker` | 27 of 27 |
| Typecheck | `npm run typecheck` | pass |
| Affected specs | `npm run spec` | 216 files, 1,441 tests pass |

Commands:

    # in packages/main/
    npx vitest run tests/clipboard-access.spec.ts
    # in packages/default-setup/
    npx vitest run tests/features/code/fe/features/terminal/terminal-says-and-outlasts.frontend.spec.ts
    # in the broker checkout
    cargo test --test suite -- a_program_that_asks_what_the_clipboard

**Limits, chosen here and stated so they can be overruled.**

- A text longer than 8 MiB is refused and nothing is written. The window does not tell the person; the refusal is
  visible only as a clipboard that did not change. Telling the person needs a backend toast, which is out of this phase.
- Every window that shows the code surface hears the event and asks, so with two windows the same text is written twice.
  The result is the same text.
- The bridge is pack-facing too (`PackFacingBridge` omits only the API token and performance), because the
  default-setup pack is the caller. A pack frontend can now write the clipboard through the main process. The browser's
  own `navigator.clipboard` was already open to packs, so this adds no reach beyond what they had, but it is a new
  public member and is reported in the SDK report.

## Phase 2 — copy-on-select (2026-11-12)

Source: broker `session/terminal-parity-view` at `0c8d6cd` (pull request spankyed/apack-terminal#16, which carries
`51dd0aa` the view change and the rustfmt fix after it); monorepo `session/terminal-parity-work` (this commit), with
`vendor/apack-terminal.rev` naming `0c8d6cd`.

**What it does.** The view's option `copyOnSelect` (off by default) copies a selection the person made on release: a drag,
or a word or line from a double or triple click. A press a program is reporting is not copied. `setCopyOnSelect` changes
it while the view is up. In the app a Code setting, `copyOnSelect` (off by default), carries through the Code surface's
`FEATURE_SETTINGS_UPDATED` to the terminal pool, which gives it to every view, those up now and those made later.

| Behaviour | Check | Result |
|---|---|---|
| Off by default, so a drag is not copied on its own | `does not copy by default: the person asks for it with a copy` (`view/tests/interaction.spec.ts`) | pass |
| Copied as the pointer is let go, not before | `copies a dragged selection when the option is set, as the pointer is let go` | pass |
| A double-click word is a selection, and is copied | `copies a word selected by a double click, which is a selection too` | pass |
| `setCopyOnSelect` changes it while the view is up | `is changed while the view is up by setCopyOnSelect` | pass |
| A click that selects nothing copies nothing | `does not copy a click that selects nothing` | pass |
| Mutation: the copy-on-release condition removed | the copy and default cases above | fail, as they should; file restored |
| The whole view suite | `npx vitest run` in `view/` | 331 of 331 |
| The pool gives the setting to views made after it, and to those already up, and takes it back off | `is given to every view, the ones already up as well as those made after it is set` (`terminal-pool.frontend.spec.ts`) | pass |
| The Code surface passes a settings update to the pool, and a setting that is not there is off | `gives the copy-on-selection setting to the terminal pool as it changes, and off when it is not set` (`state.spec.ts`) | pass |
| Typecheck, including the pack's types and the facade report | `npm run typecheck` | pass |
| Affected specs | `npm run spec` | 216 files, 1,443 tests pass |

**What this does not establish.**

- The settings form row (`settings.vue`) is checked by the typecheck, not by a spec: the repo has no spec for that form.
- No run of the Electron app has selected text with the setting on and seen it on the clipboard.
- The broker pull request is not merged yet. Its checks passed on `0c8d6cd` (17 of 17). The merge was denied by the
  permission system on 2026-11-12, so the app's pin names a branch commit, which CI can clone, until it is merged. Repin
  to the merge commit after it lands.

## Phase 3 — minimum contrast ratio (2026-11-12)

Source: broker `session/terminal-parity-view` at `d1dc1ac` (the view change; the app pins it in `vendor/apack-terminal.rev`).

**What it does.** `Theme.minimumContrast` (`view/src/draw.ts`, `view/src/contrast.ts`) is the least WCAG contrast ratio a
character is drawn at against what it sits on. The default, 1 or unset, leaves every colour the program chose. A colour
that falls short moves toward black or white, whichever gives more contrast, by the smallest step that reaches the minimum.
Where a character is selected, the contrast is measured against the selection's background. The setting is per view,
as decision D4 says, and `setTheme` changes it while the view is up. No app setting is added: D4 makes it a session
property, and no user-facing option was asked for.

| Behaviour | Check | Result |
|---|---|---|
| WCAG values for known colours: black on white is 21, mid grey on white is 4.48, a colour on itself is 1, white and black are the ends of luminance | `view/tests/contrast.spec.ts`, "the contrast ratio" | pass |
| A colour already far enough is kept as the program chose it | `is the one the program chose when that is far enough` | pass |
| Across a grid of foregrounds, backgrounds and minimums, the minimum is met wherever it is reachable, and the most contrast black or white can give where it is not | `is moved until it reaches the minimum, and no further than it has to go` | pass |
| The unreachable case goes to black or white | `goes to black or white when nothing nearer is far enough` | pass |
| The draw path: palette 1 on the theme background is drawn at the minimum; with no minimum or 1 it is the program's colour | `view/tests/contrast.spec.ts`, "a character drawn with a minimum contrast" | pass |
| Mutation: the adjustment removed from the draw path | the draw case | fails, as it should; file restored |
| The whole view suite | `npx vitest run` in `view/` | 342 of 342 |
| Typecheck and format | `npm run typecheck` in `view/`; `cargo fmt --all -- --check` | pass |

**What this does not establish.** The app does not set a minimum, so no user sees this yet. The adjustment runs per glyph
against a cached table; its cost on a full repaint is what Phase 4 measures.

## Phase 4 — the canvas painter under heavy output, and the GPU decision (2026-11-12)

Source: broker `session/terminal-parity-view` at `abb1c7e` for the harness (`view/bench/`) and `d1dc1ac` for the view
(`bench/run-painter-timing.mjs` is the runner; the harness draws through the real `CanvasPainter`).

**The harness.** `view/bench/painter-timing.ts` drives the view with a 200 by 50 screen where every row changes on every
frame and every character takes one of sixteen colours. It times each `paint` call, and each frame from sent to
acknowledged, after the first five frames.

**The results.** Percentiles in milliseconds, 295 frames each.

| Machine | Minimum contrast | Paint p50 / p95 / max | Frame p50 / p95 / max | Load while measured |
|---|---|---|---|---|
| Mac, headless Chrome 156 (software canvas) | off | 4.7 / 4.9 / 5.1 | 9.9 / 11.2 / 11.6 | 44 to 59 |
| Mac, headless Chrome 156 (software canvas) | 4.5 | 4.9 / 5.3 / 5.5 | 10.0 / 11.9 / 12.4 | 40 to 59 |
| Linux test container, headless Chrome 140 | off | 5.3 / 6.0 / 7.5 | 9.4 / 10.8 / 12.8 | container load 1.0 at start |

Commands:

    # Mac, from view/ with the vite dev server on :5199
    npx vite --port 5199
    PLAYWRIGHT=<playwright-core> CHROME=<headless shell> node bench/run-painter-timing.mjs frames=300
    node bench/run-painter-timing.mjs frames=300 minimumContrast=4.5
    # Linux container: the monorepo's .apack/painter-container.sh, run by npm run test:linux

**The decision (D5).** The gate was a p95 frame above 16 ms on either machine. Neither machine exceeds it, in the off
or the contrast-on configuration, so the GPU renderer is not started, and D5 closes here with these numbers.

**What this does not establish.**

- These are headless Chromium's canvas, which is software rendering. The application draws in Electron, which composites
  on the GPU, so its frame times are not these numbers. The gate is passed here, and the application's own figure is not
  measured.
- The measurement is a worst case by construction: every row changes on every frame. A screen that changes a few rows
  paints less.
- The Mac was under load from other work throughout, so its figures are upper bounds.

## Phase 5 — rectangular selection (2026-11-12)

Source: broker `session/terminal-parity-view` at `6fe0ef1` (the view change); the monorepo pins it in `vendor/apack-terminal.rev`.

**What it does.** A drag that begins with Alt held selects the rectangle between its two cells: each line covers the same
columns, and the text is each line's own columns joined by newlines, each asked of the source as its own span. On a Mac,
Option sets the same modifier, so Option-drag is the same gesture (decision D8). A drag without Alt is the linear selection
it was before, and a word or line selection is never a block. No app change is needed: the view takes the modifier from
the pointer.

| Behaviour | Check | Result |
|---|---|---|
| The rectangle covers the same columns on each line from its first to its last, and nothing below it | `covers the same columns on every line from its first to its last, and nothing beyond them` (`view/tests/block-selection.spec.ts`) | pass |
| The same rectangle dragged up and to the left | `is the same rectangle dragged up and to the left as down and to the right` | pass |
| Copied as each line's own columns, joined by newlines | `is copied as each line's own columns, joined by newlines` | pass |
| A drag without Alt is the linear selection it was | `is not made by a drag without Alt, which selects the text between its ends` | pass |
| Mutation: copy ignores the block | the copy case | fails, as it should; file restored |
| The whole view suite | `npx vitest run` in `view/` | 346 of 346 |
| Typecheck and format | `npm run typecheck` in `view/`; `cargo fmt --all -- --check` | pass |

**What this does not establish.** Alt-drag has not been tried in a real window. Each line is asked for on its own, so a block
of many lines makes many asks; the cost is not measured.

## Phase 6 — the accessible document (2026-11-12)

Source: broker `session/terminal-parity-view` at `4d1cd7c` (tests only; the view's source is unchanged since `6fe0ef1`).

**The automated contract.** `view/tests/accessibility.spec.ts` pins what a screen reader is given:

| Behaviour | Check | Result |
|---|---|---|
| A document named Terminal, in the view's own element | `is a document named Terminal, found in the view's own element` | pass |
| One text element per screen row, holding that row's text | `has one text element a screen row, holding that row's text` | pass |
| A row that did not change is not touched, which a mutation observer checks | `is rewritten only where a row changed: a row that did not change is not touched at all` | pass |
| The last drawn frame is named | `says which frame was last drawn, so a test or a reader can tell the screen has caught up` | pass |

Mutation: a mutant that rewrites every row (the check `mirrored[index] === row` removed) fails the unchanged-row case, and
the file is restored. Full view suite: 350 of 350.

**The manual checklist (not a condition of this goal, per decision D6).** A person runs this once on the Mac, with VoiceOver
on (Command-F5), in the Code surface's terminal, and records the result here with the date and the build:

1. Focus the terminal. VoiceOver names the document Terminal.
2. Read the document with VoiceOver's reading commands. The screen's rows are read in order, once each.
3. Type `echo hello` and press Return. The typed text and the output `hello` are read.
4. Run `seq 1 200`. The output is not read a row at a time as it arrives: a reader can stop it with Control.
5. Run `less` on a file, and leave it. The alternate screen is read, and quitting it returns the reader to the shell.
6. Select a line with a drag and copy it. The copy reaches the clipboard, and the reader does not stop.
7. Record: VoiceOver version, macOS version, the build, each step's result, and anything read that should not have been.

The checklist's result is recorded here when someone runs it. A failing step opens a fix; it does not reopen this goal.

## What this does not establish

- **Real-window behaviour of the clipboard write.** The write path is proven at the bridge and the handler with stubs. No
  run of the Electron app has copied a program's text with the app unfocused.
- **Auto-scroll and the wheel in a real window.** Both are proven with the view's source double. No run of the Electron
  app has exercised them yet.
- **The kitty flag's end-to-end coverage for every key.** One key, Escape, is checked under the flag and without it.
