# Evidence: the next terminal features

Checkpoint log for [the next-features goal](../../goals/goal-terminal-next-features.md). Each phase appends a section
with its date, the commands run and their results, and what was not verified.

## Phase 0 — the seams at the pin (2026-11-12)

Checked at broker commit `3a2140cc8dd24a1c62b60a4d723b264a53a91c1d` (the commit `master` pins), in the checkout
`vendor/apack-terminal`, which was fast-forwarded to it. The survey that wrote the goal ran against an older checkout
(`efe5d84`), so its line numbers were rechecked here.

### Corrections to the goal's Verified seams

- **Search.** Broker `src/session.rs:802` `search` (was 797), `src/screen.rs:1261` `search` (unchanged). View
  `view/src/source.ts:393` `search(needle)` (unchanged), `view/src/view.ts:429` calls it (was 381).
- **OSC 8.** Confirmed: `src/vt/rows.rs:364-365` `HAS_HYPERLINK`, `rows.rs:473` and `484`
  `ghostty_grid_ref_hyperlink_uri`. Confirmed `view/src/links.ts` kinds.
- **Mode 2026. Correction, and a conflict with decision D5.** The goal said the view has no handling and the broker
  holds only by a byte scanner. Both are true in part. The broker already has a hold:
  - `src/vt/mod.rs:424-427` registers `RENDER_HOLD`, and `note_render_hold` (`mod.rs:1339`) records each change.
  - `src/holds.rs` ends a hold that a program never lets go of, after `HOLD_LIMIT`, which is **1 second**
    (`src/holds.rs:33`).
  - `src/screen.rs:301` `hold_piece` cuts reads at `2026h`/`2026l` so the terminal is looked at there.
  - `tests/holds.rs` covers the one-deadline-per-screen rule, using `\x1b[?2026h`/`l`.
  - The view (`view/src`) has no handling of a hold: the only "held" matches are comments.
  - **Conflict:** D5 sets the view's timeout at 150 ms. The broker already owns a 1 s limit that is tested. Phase 1
    must decide which owns the timeout. Do not add a second clock in the view.
- **Bell.** `packages/default-setup/src/features/code/be/features/terminal.ts:116-117` emits `terminal.BELL` (confirmed).
  Broker `Effect::Bell` at `src/session.rs:1597` and `src/vt/mod.rs:957` (was not on the survey's list; confirmed).
- **IME.** `view/src/input.ts:109` `compositionstart` (confirmed); no positioning helper exists in the view.
- **Drag and drop.** Confirmed absent in the view (no `dragover`, `drop` or `dataTransfer` in `view/src`). Bridge:
  `packages/apack-sdk/src/fe/electron-api.ts:52` `getPathForFile` (confirmed).
- **Blink.** `view/src/view.ts:23` `BLINK_MS = 530` (was line 12). The broker's default cursor: `src/vt/mod.rs:570`
  `default_cursor_is_a_blinking_bar` (a bar, blinking, fixed). No cursor setting exists in the app.
- **OSC 133.** Broker registers `SEMANTIC_PROMPT` at `src/vt/mod.rs:411-412`. App emits 133 A/C/D from
  `packages/default-setup/src/features/code/be/services/shell-integration.ts:196-198` (was 196-219 for the whole
  block). Command detection relies on these marks.

### Checks run

- `git -C vendor/apack-terminal rev-parse --short HEAD`: `3a2140c`.
- The greps above, with the file and line of each hit.
- No code was changed in Phase 0.

### Not verified

- Whether the broker's `HOLD_LIMIT` (1 s) is the right ceiling for real TUIs. Phase 1 measures it.
- `ghostty_grid_ref_hyperlink_uri` returning the OSC 8 `id`. Phase 4 checks it.
- The xterm.js PR #5453 that added mode 2026. Phase 1 reads it.

## Phase 1 — synchronized output (DEC mode 2026)

Broker branch `session/next-features-broker` in worktree `apack-terminal-worktrees.noindex/next-features`, based on
the pin `3a2140c`. Nothing is pushed or merged; the app pin still names `3a2140c` until the branch lands.

### Findings

- **Frames during a hold were already withheld.** `src/view/publish.rs` `owed()` (around line 97) holds frames while a
  program holds the screen, and `tests/view_frames.rs` `a_program_holding_the_screen_is_not_shown_half_drawn` passes
  at the pin. The view needed no change for this.
- **The fetch of on-screen lines was not.** `Publication::fetch` (`src/view/publish.rs`, around line 483) read the
  live terminal, so a fetch during a hold could show half-drawn text. Reproduced with a test that writes
  `\x1b[?2026h\x1b[1;1Hnew text` over `old text`: the fetch returned `new text`.
- **DECRQM was already correct.** The core answers through `WRITE_PTY` (`src/vt/mod.rs:379-404`, collected at
  `1131-1134`). Test `2b3fa04` pins the answers: `\x1b[?2026;2$y` when reset, `;1$y` when set, `;0$y` for an unknown
  mode. No code change.

### Decisions

- **Hold fetch (you chose "apply the fix and amend the invariant").** Commit `c2bcf8e`: during a hold, an on-screen
  line that a fetch returns is the row the last frame sent to a view carried. The shown rows are recorded when a
  frame is sent and cleared on a new epoch. Commit `a91ea40` amends the view-model oracle (`tests/view_model.rs`) to
  say this: outside a hold a fetch equals the terminal; during a hold an on-screen line equals the row of the last
  frame sent, from the view that has applied the most frames; a view in another epoch holds none of the current
  numbering, so its on-screen line is absent.
- **Still reading the live terminal during a hold:** `find`, `text_of`, `word_at` and `line_at`. Not changed in
  Phase 1; a known gap.
- **D5 timeout.** `HOLD_LIMIT` stays at one second (`src/holds.rs:27`). Not measured against a real full-screen
  program, since the hold length is set by the program and no real program was run. A parse-cost probe (a 240x80
  full repaint inside `2026h`/`l`, 19.8 KB) took at most 0.74 ms over 50 runs; that is parse cost, not hold duration.

### Checks

- `cargo test --test suite` on `c2bcf8e`/`a91ea40`: 430 passed, 0 failed (agent run, committed state). Lib: 16 passed.
- A rerun on `a91ea40` in this session: 429 passed, 1 failed. The failure is
  `keeping::a_session_begins_with_the_screen_its_recording_holds`.
- That test is flaky, and it is flaky at the pin too: `3a2140c` failed 1 of 4 runs, and `a91ea40` failed 1 of 4 in a
  separate sample. It is not caused by Phase 1. It is recorded as a pre-existing flake and is not fixed here.
- Mutation check: disabling the shown-rows branch in `fetch` makes
  `lines_fetched_while_the_program_is_holding_the_screen_are_those_from_before_the_hold` fail; restored, it passes.

### Not done in Phase 1

- The view paint loop (`view/src`) was not changed. Nothing in the view needed it, since frames are withheld in the broker.
- The broker branch is not merged, so the app pin is not moved. Merging it to the broker's `master` needs your
  authority.

## Phase 2 — bell (2026-11-12)

### Deviation from the goal

The goal put the flash in the view's paint pass. It is app-side instead: the view has no bell handling and receives no
bell event, and this phase did not add one. The terminal's state (`features/terminal/state.ts`) accepts the bell, starts
the flash, and ends it; `TerminalView.vue` binds a class on its container to whether the state says the terminal is
flashing. The flash therefore paints on the container's background, not the broker-painted grid, so it is a background
change that the canvas can cover (see Not verified).

Timing is owned by the state, not by a watch in the component: the accepted bell raises two timers on the machine,
`BELL_FLASH_MS` (150 ms, ends the flash) and `BELL_WINDOW_MS` (500 ms, ends the window in which a further bell is the
same bell). A bell inside the window changes nothing. The flash setting is read from the code surface's settings through
the parent context, as `getParentContext` already serves the terminal's other parent reads.

The existing `activity.bell` flag, which the tab badge shows and `terminal.SEEN` clears, is unchanged. The goal's
"cleared by the same state" is satisfied by the window timer rather than by `SEEN`, since a flash must end whether or
not the person looks.

### What changed

- Broker: no change. View (`view/`): no change.
- `apack.json` (`features.code.settings`): `bellFlash` (default `true`) and `bellNotification` (default `false`) in the
  schema, the required list and the defaults. `npm run generate:entries -w @app/default-setup` ran; the facade report
  gained the two fields and nothing else changed (`etc/pack-types.api.md`).
- `fe/features/terminal/state.ts`: `ringBell`, `endBellFlash`, `endBellWindow`, `showBellNotification`; context
  `bells`. `fe/canvas/TerminalView.vue`: `bellFlashing` selector and the container class. `fe/settings.vue`: two checkboxes.
- Main: `packages/main/src/modules/notify-access.ts` (length limits 200 title, 1000 body; refused, not cut), registered
  in `WindowManager.ts` beside the clipboard handler. Preload: `notify.show`. SDK: `_HostBridge.notify`, and
  `packages/apack-sdk/etc/fe.api.md` gained only the `notify` member (`npm run packages:build`, then `api:update`).

### Commands and results

- `npm run spec -- packages/main/tests/notify-access.spec.ts`: 8 passed.
- `npm run spec -- packages/preload`: 12 passed.
- `npm run spec -- packages/default-setup/tests/features/code/fe/features/terminal/terminal-bell.frontend.spec.ts`: 9 passed
  (flash for 150 ms and back; a run of bells in 500 ms is one flash; a bell during the flash does not restart it; a bell
  after the window is a new flash; flash off paints nothing; a flash is per terminal; notification asked only when
  unfocused and the setting is on; not when focused; not when off; one notification for a run of bells).
- `npm run spec -- packages/default-setup/tests/features/code/fe/canvas/terminal-view.frontend.spec.ts`: 5 passed (one new
  case: the container carries the flash while the state says it is flashing, and not after).
- `npm run spec -- packages/default-setup/tests/features/code/fe` (the whole code frontend): 32 files, 197 tests passed,
  run before the harness type fix below.
- `npm run typecheck:pack`: exit 0 after fixing the harness's context type (`bells` added to its declared context).
- `npx tsc --noEmit -p .` in `packages/main` and `packages/preload`: exit 0.
- `npm run chain` was not run, by instruction.

### Mutation checks

Each mutant was a copy in the scratchpad, copied over the file, run, and the original copied back and compared with `cmp`.
- Focus gate removed (`!document.hasFocus()` dropped from the notification condition): the focused-window case fails
  (`does not ask for a system notification while the window is focused`). 1 failed, 8 passed. Restored, `cmp` identical.
- Duplicate-bell guard removed (`if (context.bells[id] !== undefined) return` dropped): two cases fail
  (`flashes once for a run of bells inside 500 ms...` and `asks for one notification for a run of bells inside 500 ms`).
  2 failed, 7 passed. Restored, `cmp` identical.

### Not verified

- No run of the Electron app. The flash has not been seen on a real window, and whether a container background shows
  through the canvas is unknown; if the grid covers it, the flash is invisible and the next step is an overlay.
- The OS notification has not been displayed. The main handler is tested against a stub of `Notification`.
- Focus is `document.hasFocus()`, as the existing `notifySystem` uses it. No app-level focus state was found to use.
- Every window showing the code surface receives the bell. An unfocused window each asks for a notification, so two
  unfocused windows can show two. The `NOTIFIED` path avoids this with a shared tag; the bell path does not yet.

## Phase 3 — cursor style and blink (2026-11-12)

Broker commits on `session/next-features-broker` (worktree `apack-terminal-worktrees.noindex/next-features`, on top of
`a91ea40`): `72e658e` `feat(vt): a session's default cursor is set by a request`, and `f6165ee`
`feat(view): an inactive cursor style and a blink setting from the view's options`. Nothing is pushed or merged, and
the app pin still names `3a2140c`.

### The core's blink, measured

A throwaway probe on `Screen` and a `View` (the probe was reverted; the facts are now tests) gave:

- `CSI 2 q` reports a steady block; `CSI 5 q` a blinking bar; `CSI 6 q` a steady bar.
- `CSI ? 12 h` and `CSI ? 12 l` change the blink and not the shape. After `CSI 2 q`, `CSI ? 12 h` reports a blinking
  block; after `CSI 5 q`, `CSI ? 12 l` reports a steady bar.

So DECSCUSR's blink and DEC mode 12 are one setting in this core. The `ghostty-vt-rs-sys` header says that
`DEFAULT_CURSOR_BLINK` is what `CSI 0 q` restores, and that the render state's `blinking` is "based on terminal modes".

### Decisions

- **Blink values.** `program` is the core's setting, whichever of DECSCUSR or mode 12 set it last. `on` and `off` are
  the app's and override it in the view, for DECSCUSR's blink too, since it is the same bit. This is a judgment on
  D8, whose "a program's DECSCUSR choice wins" is about the shape. Phase 3's own test text says "on and off ignore a
  program's mode 12", and ghostty's `cursor-style-blink` overrides the program the same way.
- **Where the blink is applied.** The view, not the broker. The broker stores only what a reset returns to:
  `on` and `program` reset to a blinking cursor, `off` to a steady one. The broker still reports blinking as the
  program left it. One place draws the cursor, and the view tests need it there.
- **Style and precedence.** The request sets the core's default style and blink, and feeds `CSI 0 q` so the cursor
  takes the default now. A session still starts with a blinking bar, through the same call. A program's `DECSCUSR`
  wins until its next reset.
- **Consequence to know.** A request sent while a program has its own shape replaces that shape with the default. D8's
  "until the program resets it" holds for every choice made after the request. The app should send defaults at
  spawn, before the shell prints; that wiring is not in this phase.
- **Wire.** The control protocol gains `SetCursorDefaults { session, style, blink }` (`set_cursor_defaults`),
  with `CursorStyle` (`block`, `bar`, `underline`) and `CursorBlink` (`on`, `off`, `program`). `node/protocol.ts`
  was regenerated with `cargo xtask generate`; its diff is the variant and the two enums and nothing else. The view wire
  (`view/src/broker/wire.ts`) is unchanged, since no view-wire message and no `Cursor` field changed; the goal's
  "update wire.ts in the same change" applies to a view-wire change. `PROTOCOL_VERSION` stays 1.
- **Inactive style.** `ViewOptions.cursorInactive`, default `hollow`, which is what the view already drew. The painter
  is unchanged.
- **Unset.** The broker has no "unset": the app resolves it to one of the three values before sending. The view
  treats an absent `cursorBlink` as `program`, the behaviour before this phase.

### Commands and counts

- `cargo test --test suite`: 436 passed, 0 failed (430 before, plus 6 new). The Phase 1 flake
  (`keeping::a_session_begins_with_the_screen_its_recording_holds`) did not fail in this run.
- New broker tests, all passing: `view_frames::a_default_cursor_set_by_the_app_is_the_one_a_frame_shows`,
  `a_program_choice_wins_over_the_default_until_the_program_resets_it`,
  `a_reset_returns_to_a_blinking_cursor_for_on_and_program_and_a_steady_one_for_off`,
  `a_default_set_part_way_through_a_program_sequence_still_takes_the_cursor`,
  `decscusr_and_dec_mode_12_set_one_blink_between_them`, and `broker::setting_the_cursor_defaults_of_a_session_that_does_not_exist_is_refused_by_code`.
- `npm test` in `view/`: 366 passed, 17 files. `view/tests/view.spec.ts` has 49 passing, 4 of them new:
  the inactive style, and `on`, `off` and `program` blink.
- `npx tsc --noEmit` in `view/`: exit 0.
- `cargo fmt --all --check`: exit 0.
- `cargo clippy --workspace --all-targets -- -D warnings`: 2 errors, both in Phase 1's code and present at `a91ea40`:
  `tests/view_frames.rs:255` and `:260` (`redundant closure`, `map(|row| text(row))`). Nothing from this phase.
  Not fixed here, since it is outside this phase's change.
- `npm run chain` was not run, by instruction. `cargo xtask pre-push` (which includes the mutants job) was not run.

### Mutation checks

Each mutant was a copy in `monorepo/.apack/mutants/`, applied to the working file, and the original put back and
compared with `cmp` (identical both times).

1. **DECSCUSR precedence.** `Screen::feed` also feeds `CSI 0 q` after each program write, so the default always wins.
   Four tests fail and 46 pass. `a_program_choice_wins_over_the_default_until_the_program_resets_it` fails, but at the
   frame helper (`expected one frame, found []`) rather than at its precedence assertion, because the mutant leaves the
   cursor unchanged and no frame is sent. The failure is real, and the reason is less exact than it could be.
2. **Inactive style.** The branch hard-codes `'hollow'`. One test fails:
   `is drawn in the inactive style the view is given while the view does not have the keyboard`
   (`expected 'hollow' to be 'underline'`). 48 pass.
3. **Blink `off` ignored** (not asked for, cheap). `off` returns the program's blink. One test fails:
   `never hides a cursor the program blinks when the view is given off`. 48 pass.

### Gaps

- **App side is not in this phase.** The settings, the code surface's `TerminalView` options, the request sent from the
  app, and `settings.vue` land after this broker branch merges. Nothing sends `SetCursorDefaults` yet.
- **Recordings.** The request is not written to a session's recording, so a rewound recording does not show the reset.
- **A request mid-sequence.** The reset is fed through the parser, so a program's sequence split across two reads is
  ended by it, and the rest of that sequence is lost. The test covers that the default still takes effect, not the lost
  bytes.
- **Options at construction.** `cursorBlink` and `cursorInactive` are read when the view is made. A live change needs a
  new view.
- **Not seen on screen.** No real program and no Electron window were run. The cursor's look is unchecked.
