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

### Hold timeout measurement (2026-11-12)

Commit `fad909e` on `session/next-features-measure` (from `origin/master`, `3b8ef5c`, where the broker work is merged
as #24 and #25) adds `benches/hold.rs`. Command: `cargo bench --bench hold` in the `next-features-measure` worktree.
It reports and never fails.

- **Machine:** `uname -m` arm64; 10 cores; **loaded**. Load average was 44.2 at the start of the session and 33 to
  36 during the runs (`uptime`), so the cost figures are upper bounds on an idle machine.
- **Release cost**, a full 200x50 repaint of coloured text inside `2026h`/`2026l`, timed from the hold's start to its
  release as the broker publishes it (`Screen::feed`), 200 runs. Run 1: p50 491 us, p95 621 us, max 805 us. Run 2:
  p50 475 us, p95 536 us, max 647 us. This is parse and publish cost. It is not how long a real program holds the
  screen, which the program sets.
- **View fetch** of the whole screen after release, the same 200 runs: run 1 p50 409 us, p95 487 us, max 769 us;
  run 2 p50 398 us, p95 456 us, max 615 us.
- **Never-released hold**, a program that writes `2026h` and nothing else, 5 runs: the view receives the broker's
  frame at 1.003 s and 1.001 s, and at most 1.006 s (run 2: p50 1.001 s, max 1.006 s). The limit fires.

**Decision:** `HOLD_LIMIT` stays at one second (`src/holds.rs:27`). The measured release cost is well under a
millisecond, so a 1 s ceiling does not come near a repaint. Nothing measured says a longer or shorter limit is
needed, and the hold length of a real full-screen program was not measured.

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

### Phase 2 gap closed

The two-windows gap above is closed in the main process: `registerNotifyHandler` in
`packages/main/src/modules/notify-access.ts` shows an identical title and body once per 1000 ms. Commit `e51bcbb09e`.

- `npm run spec -- packages/main/tests/notify-access.spec.ts`: 11 passed (3 new: two identical asks inside the window show
  one; different text inside the window is shown; an identical ask after 1000 ms is shown).
- `npm run typecheck:pack`: exit 0. `tsc --noEmit` in `packages/main`: exit 0.
- Mutation: the dedupe guard removed in a mutant copy under the scratchpad. The duplicate test fails (1 failed, 10
  passed); the original was restored and `cmp` reports it identical.

Remaining limit: dedupe is by text, so two different bells with the same text within a second show once.

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

## Phase 4 — OSC 8 hyperlinks (broker and view) (2026-11-12)

Broker branch `session/next-features-broker` (commits `e9ed0a2`, `6385234`), in the checkout
`apack-terminal-worktrees.noindex/next-features`. The app-side policy is not in this phase.

### The id finding

**The core does not expose the OSC 8 `id`, so grouping by id is impossible and grouping uses the URI alone.** Checked
against the sys crate the pin resolves to: `ghostty-vt-rs-sys` 0.3.0 in `Cargo.lock`, source under
`~/.cargo/registry`. Its `src/bindings.rs` has one hyperlink accessor, `ghostty_grid_ref_hyperlink_uri` (line 1106),
and its doc comment answers the URI only. A grep of the whole crate for `hyperlink` with an id finds no id accessor, no
id type and no id constant. The `HAS_HYPERLINK` cell flag (line 899) answers presence, not identity. The broker reads
the URI at `src/vt/rows.rs` lines 473 and 484, as before.

This checks the bindings the broker compiles against, not the libghostty-vt C header of the version it links. The crate
is the only place the broker reaches the core's hyperlinks, so no other call is missed.

### Decisions

- **No wire change.** A row already carries its own `links` table and a per-character `link` index, and the URI is the
  whole of what a link is on the wire. There is no id to add, so `src/protocol.rs`, `view/src/broker/wire.ts` and
  `node/protocol.ts` are untouched, and `PROTOCOL_VERSION` stays 1.
- **Wrapped links are joined by URI.** A declared link is one run per row it covers, and the view joins runs whose
  URIs match across a wrap. Two separate links with the same URI that sit side by side across a wrap are therefore one
  link to the hover. Nothing in the core can tell them apart.
- **The preview is `linkPreview: 'off' | 'osc8' | 'all'`, default `osc8`.** It controls only the pointer's title. A
  detected URL is not previewed by default. This is a visible change: a URL in the text that showed its title before
  now shows none unless the host passes `all`.

### Changes

- Broker, `tests/view_frames.rs`: `a_hyperlink_covers_its_cells_until_it_is_closed_and_an_id_does_not_change_the_uri`
  and `a_hyperlink_that_wraps_reports_its_uri_on_each_row_it_covers`. Both pass against the existing code, so they pin
  behaviour rather than add it.
- View, `src/links.ts`: `linkRuns` (and `LinkRun`) returns the runs a declared link covers across its wrap. A detected
  link is one run on its row.
- View, `src/view.ts`: the hover keeps every run and underlines each on its own row; `linkPreview` (`LinkPreview`) is an
  option, read in `previews()`.
- View tests: `links.spec.ts` (four `linkRuns` cases), `interaction.spec.ts` (the wrapped hover, the click's URI and
  kind, and each `linkPreview` value). Two existing title assertions were updated for the `osc8` default.

### Commands and counts

- `cargo test --test suite`: 438 passed, 0 failed (436 before, plus the two broker tests).
- `npm test` in `view/`: 17 files, 375 passed. `npx vitest run` in `view/` gives the same.
- `npx tsc --noEmit` in `view/`: no output.
- `cargo clippy --all-targets -- -D warnings`: finished with no warnings.
- The view's pre-change count was not taken, so no before-and-after delta is claimed for the view.

### Mutation

The grouping was broken by making `linkRuns` return only the run on the hovered row. Two of 86 tests in
`interaction.spec.ts` and `links.spec.ts` failed: `is underlined on every row it wraps over while the pointer is over
any of them` and `is one run on each row it wraps over, joined by its URI, from any of them`. The original was put back
and compared with `cmp` (identical). The broker tests were not mutated.

### Gaps

- **App side not in this phase.** The main-process scheme policy under D4 (`http`, `https`, `mailto` open directly), the
  app's `linkPreview` setting and its wiring into the code surface are not done.
- **Options at construction.** `linkPreview` is read when the view is made. A live change needs a new view, as the
  cursor options do.
- **Preview is the title only.** No overlay was built, since the view already shows hover only through the title and
  the underline.
- **Detectors do not wrap.** A detected link found across a wrap is one run on the row asked about, as before.
- **Not seen on screen.** No Electron window was run, so the underline and title were not checked by eye.

## Phase 4 — app side: link policy (2026-11-12)

The broker half is in the Phase 4 section above. This section is the app's half: what the main process does with a link
a terminal program printed or declared. Nothing is pushed.

### Decisions

- **A terminal's links have their own policy, and the shared one is unchanged.** `webUrlProblem` still lets only http
  and https through, and it still governs the in-app tab and every other door. The terminal's links go to a new channel,
  `shell:openTerminalLink`, decided in `packages/main/src/modules/terminal-link-access.ts`.
- **Decisions.** http, https and mailto open directly. A file link is refused whether or not it names a host; a refusal
  with a host says the file is on another machine or a network share. Any other scheme asks the person in a
  `dialog.showMessageBox` over the window that sent the link, with Cancel as the default and the escape. A link with
  credentials is refused without asking. A non-text link, or one longer than 8192 characters, is refused rather than cut.
  A link with no window to ask over is refused.
- **The question shows the full link, capped at 500 characters.** The brief named `summarizeUrl` for this text. It is
  not used there, because `summarizeUrl` drops the query, and the person deciding should see what they are opening.
  `summarizeUrl` is used for the log line, as the other doors do.
- **Routing.** In `terminal-pool.ts`, a link of kind `url` or `declared` goes to `openProgramLink`, which calls
  `window.electronAPI.shell.openTerminalLink`. A path link still goes to the file opener. `openLink` is kept for every
  other caller.
- **Behaviour change.** A terminal link previously went through `openLink`, which opens the in-app browser tab when one
  is designated. It now opens in the system browser, through `shell.openExternal`, as the policy in the main process
  does. The in-app tab is not used for terminal links.
- **Not decided here.** `javascript:` and `data:` are not in the refused set. They reach the question like any other
  scheme, and the default answer is Cancel. Whether they should be refused outright is open.

### Changes

- `packages/main/src/modules/terminal-link-access.ts`: `terminalLinkDecision`, `openTerminalLink`,
  `registerTerminalLinkHandler`, `MAX_TERMINAL_LINK_LENGTH`. Registered from `WindowManager.ts`.
- `packages/main/tests/terminal-link-access.spec.ts` (new), `packages/main/tests/electron-stub.ts` (a `dialog` and a
  `BrowserWindow` stand-in).
- `packages/preload/src/index.ts`: `shell.openTerminalLink`. `packages/apack-sdk/src/fe/electron-api.ts`: its type.
  `packages/apack-sdk/etc/fe.api.md`: one line, from `npm run api:update` (1 of 31 reports changed, and the diff holds
  only that line).
- `packages/default-setup/src/features/code/fe/utils/terminal-pool.ts`: `openProgramLink`, used by the non-path branch.
- `packages/default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts`: two cases (a url and a declared
  link reach the bridge; a path reaches the file opener and not the bridge).

### Commands and counts

- `npm run spec -- packages/main/tests/terminal-link-access.spec.ts`: 22 passed, 0 failed.
- `npm run spec -- packages/default-setup/tests/features/code/fe/utils/terminal-pool.frontend.spec.ts`: 35 passed,
  0 failed. Two cases were added; the count before them was not taken.
- `npm run spec` on `shell-access.spec.ts` (16), `clipboard-access.spec.ts` (8) and `notify-access.spec.ts` (8): all
  passed.
- `npm run typecheck:pack`: passed. `npm run typecheck` in `packages/main` and `packages/preload`: no output (passed).
- The renderer typecheck was not run. The `electronAPI` type change is additive.

### Mutation

- Scheme check dropped (every link opens directly, with no question): 5 of 22 failed, all in the custom-scheme and
  no-window and channel cases that depend on the question. Restored and confirmed with `cmp`.
- Confirm removed (the question's answer ignored, so a custom scheme opens whatever the person answers): 2 of 22
  failed: the Cancel case and the channel case that asks and must open nothing. Restored and confirmed with `cmp`.
- The mutant copies and the original are under the session scratchpad, not `/tmp`.

### Gaps

- **The `linkPreview` setting is not wired.** It is the broker-side option (`off`, `osc8`, `all`) and exists only on the
  unmerged broker branch. Wiring it into the view would fail typecheck against the pinned view, so it is blocked on that
  branch's merge. The default `osc8` behaviour is also not in the app yet.
- The frontend test stubs `window.electronAPI`, so it proves the routing, not the bridge's wire path. The main-process
  handler is tested through the stub's `ipcMain`, not a running Electron process.

### Phase 4 — review of the app side (2026-11-12)

- **Decided here, a deviation from D4:** `javascript:`, `data:` and `vbscript:` are refused outright and never put to
  the person. D4 said any other scheme asks first. These three run or display code, and no program's link needs one,
  so a question would only give a click-through to a script. Commit `4b02e3a8df`; the test is in
  `packages/main/tests/terminal-link-access.spec.ts` and a mutation (the refusal removed) fails it.
- **Behaviour change to confirm:** terminal links now open in the system browser through `shell:openTerminalLink`,
  not the in-app browser tab that `openLink` used. Nothing in D4 asked for this change.
- **Still open:** the `linkPreview` setting and its wiring (blocked on the broker merge); Phase 4's Done-when is not met
  until then. The grouping by OSC 8 `id` is impossible, since the core does not expose the id (see the broker section above).

### Phase 5 — drag and drop file paths (2026-11-12)

- **Shells supported:** `sh`, `bash`, `zsh`, `fish` and Git Bash's `bash.exe` (POSIX single quotes); `powershell.exe` and
  `pwsh.exe` (PowerShell single quotes, a quote doubled). Every other shell takes no drop: `cmd.exe`, `wsl.exe`, nushell,
  tcsh and an unnamed shell. `dropShellOf` answers `undefined` for them, so the drop is refused rather than guessed at.
  Which shell family applies comes from `TerminalInfo.shell`, the name the terminal row holds.
- **Decisions:**
  - Quoting lives in one pure module, `packages/default-setup/src/features/code/fe/utils/drop-text.ts`. The component
    calls `dropShellOf` and `dropText` and nothing else.
  - A PowerShell path holding one of the four typographic single quotes (U+2018, U+2019, U+201A, U+201B) is refused as a
    whole, since PowerShell has no escape for them inside a single-quoted string and would end the argument early.
    Doubling them was not used: the doubling behaviour could not be checked without `pwsh`, which is not installed here.
  - The drop reads paths through `window.electronAPI.fileUtils.getPathForFile` (the bridge at
    `packages/apack-sdk/src/fe/electron-api.ts`, exposed by `packages/preload/src/index.ts`). Its absence makes the drop a
    no-op. The goal named `getPathForFile` at line 52 without the `fileUtils` parent; the parent is the real path, as the
    existing drop targets in the Code surface use it.
  - The handler sits on the terminal's canvas container. A drag with no `Files` type is not taken (no `preventDefault`,
    no drop effect). A file drop calls `preventDefault` even when nothing is inserted, so the browser does not open the
    file in the window.
  - The text goes through the view's paste path (`attachment.paste`), so a bracketed-paste program is told it is a paste,
    and the pool's existing confirmation applies to any multi-line text.
  - No focus is taken on drop.
  - No broker or view change. The view has no drop handling and none was added.
- **Commands run:**
  - `npm run spec -- packages/default-setup/tests/features/code/fe/utils/drop-text.spec.ts`: 8 of 8 passed.
  - `npm run spec -- packages/default-setup/tests/features/code/fe/canvas/terminal-view-drop.frontend.spec.ts`: 6 of 6 passed.
  - `npm run spec -- packages/default-setup/tests/features/code/fe/canvas/terminal-view.frontend.spec.ts`: the existing
    canvas host spec, 5 of 5 passed, so the host's other behaviour is unchanged.
  - `npm run typecheck:pack`: passed (vue-tsc over the pack, tests included).
  - `npm run chain` was not run, as instructed.
- **Test method:** the POSIX case runs the shell itself. `/bin/sh -c "printf '%s\0' <text>"` prints each word the shell
  split the text into, and the test compares the words with the paths, so a path with a space, a single quote, a dollar
  sign and a backtick must come back as one argument each. The PowerShell case uses a small tokenizer written in the test
  for the single-quoted subset `dropText` produces: a quoted word is literal and a doubled quote inside one is a quote.
  The tokenizer is a stand-in, not a PowerShell run.
  The component cases use the canvas host's stand-in view, which records each `paste`.
- **Mutation results** (each mutant copied under the scratchpad, restored, and confirmed with `cmp`):
  - Quoting removed from the POSIX branch (raw paths joined by spaces): 3 of 8 failed in `drop-text.spec.ts`, including
    the space, quote, dollar and backtick shell-split test and the quote-escaping test.
  - `Files` check removed from the drop handler: 1 of 6 failed, the text-only drop test (the drop was taken over, so
    `defaultPrevented` was true).
  - `Files` check removed from the dragover handler: 1 of 6 failed, the "does not accept a drag that carries no files" test.
  - Note that removing the `Files` check from the drop handler alone is caught only through `preventDefault`. Without
    that assertion, the text-only drop would still insert nothing, because the empty path list inserts nothing.
- **Gaps:**
  - No real Electron drop was run. The component tests simulate `DragEvent`s with a `dataTransfer` object and stub the
    bridge; the real `webUtils.getPathForFile` path and the browser's own drag behaviour are unverified.
  - PowerShell is not run. Its quoting is checked by the stand-in tokenizer only, and `pwsh` is not installed here.
  - A drop on a `wsl.exe` terminal is refused, although a WSL shell could take Windows paths. This is a deliberate refusal,
    not a tested behaviour of WSL.
  - The Windows (`bash.exe`) path is covered only by the family mapping; no Git Bash run was done.

### Phase 6 — scrollback search (2026-11-12)

**Commits.** Broker branch `session/next-features-broker` in the worktree: `85dc7be` (broker, with `node/view-vectors.json`)
and `f9fa7eb` (view). App, master: `8d08e45ca1` (code); this section is the commit after it. Nothing pushed or
merged, and `vendor/apack-terminal.rev` is not moved, since the goal pins only after the broker lands on its `master`.

**Audit, before any change.** Where a search runs matters for the cap: the view's request (`ToBroker::Search`,
`src/main.rs:773`) goes to `session.find` (`src/session.rs:883`), then to the ghostty core's `find` (`src/vt/reads.rs:214`,
ceiling `SEARCH_MATCHES = 2_000` at `reads.rs:22`). `Screen::search` (`src/screen.rs:1282`, ceiling 100) answers the
protocol's `Request::Search`, which the view does not use. The core matches letters in either case, so the
case toggle needed a broker change.

| Requirement | State | Where |
|---|---|---|
| Cmd/Ctrl+F opens the bar | present | `terminal-pool.ts:454` (`shortcut`), `:470` (`openFind`) |
| Enter next, Shift+Enter previous | present | `terminal-pool.ts:525` (bar keydown) |
| Escape closes | present | `terminal-pool.ts:524`; spec 'closes on Escape' |
| Case toggle, no regex (D10) | missing, filled | pool `Aa` button; view `find(needle, { matchCase })`; broker `case_sensitive` on the search request |
| Distinct highlight and active-match colour | present | `view.ts:1671` (`matchBackground`, `currentMatchBackground`) |
| Active match scrolled into view, in the middle | partial, left as is | `view.ts:548-556` (`showMatch`) centres only a match outside the visible rows; a match already on screen is not moved |
| At most 1000 highlights (D3), count reads `1000+` | missing, filled | view `MATCH_HIGHLIGHTS` (`view.ts:45`), `found.more`; pool `said()` |
| Matches refresh at most once per 200 ms of output | missing, filled | view `refreshMatches` (`view.ts:495`), `MATCH_REFRESH_MS` |
| Count and index in an `aria-live` region | missing, filled | pool: `role="status"`, `aria-live="polite"` on the count |
| Wrap-around, both ends | present | `view.ts:540` (`findNext`); spec 'steps to older matches ... round again' |
| Match across a wrapped line found once | present (broker) | `vt/reads.rs` via the core; `tests/view_reads.rs:103` `a_search_finds_text_that_wrapped` asserts one span |

**What was filled.**
- Broker: `ToBroker::Search` carries `case_sensitive` as its last field (`src/view/wire.rs`). `reads.rs` keeps, when
  it is set, only the matches whose text (`text_between`) equals the needle. The filter runs before the ceiling,
  so the answer is the newest 2,000 case-insensitive matches narrowed to the exact ones. The flag is additive
  within `PROTOCOL_VERSION` 1; both halves moved in one change.
- View: `find(needle, { matchCase })`, `Source.search(needle, caseSensitive)`, the flag on the wire, a 1000 cap on what
  is held and painted, `found.more`, and the refresh throttle (at most one pending refresh; a change while it waits
  is the next one's). `dispose` clears the timer.
- App: `Aa` toggle (`aria-pressed`), count in an `aria-live` region, `1000+` past the held matches, and the case flag
  passed to the view. Matching is case-insensitive by default, as the core's search was before this phase.

**Tests.**
- Broker: `a_case_sensitive_search_keeps_only_the_matches_in_the_needles_case` (new). The wrap-once test already
  existed. The view's search vector was re-recorded with `APACK_UPDATE_VECTORS=1`; the diff is the one search line
  (a trailing `00` flag byte and `"caseSensitive": false`).
- View, `interaction.spec.ts` 'finding text': the refresh test runs on fake timers and checks that a stream of output
  gives one search per 200 ms, a change during a search waits for the next interval, and nothing is searched early
  (199 ms, then 1 ms). New: the case flag reaches the source; 1500 matches paint 1000 and report `1000 of 1000+`
  or `1 of 1000+`; navigation wraps across the held matches. Two existing assertions gained `more: false`, and a test
  for "found nothing, then output brings one" moved to fake timers.
- App, `terminal-pool.frontend.spec.ts`: the count is `role="status"` and `aria-live="polite"`; typing searches
  case-insensitively; the toggle searches again with the case flag; the count reads `1000+`; Shift+Enter from the
  newest reaches `1000 of 1000+`, and Enter returns to `1 of 1000+`.

**Counts and commands.**
- Broker `cargo test --test suite`: 439 passed, 0 failed (the run before the vector re-record had 438 passed and the
  one vector test failing). `cargo clippy --all-targets -- -D warnings`: exit 0.
- View `npm test`: 377 of 377. `npx tsc --noEmit`: exit 0. Before this phase's count was not recorded, so no
  before-and-after figure is claimed.
- App `npm run spec -- .../terminal-pool.frontend.spec.ts`: 36 of 36 passed.
- App `npm run typecheck:pack`: exit 2, two errors, both in `terminal-pool.ts`. `found` lacks `more` (line 495) and
  `find` takes one argument (line 499). The app links the pinned `apack-terminal-view` build, which has neither.
  These clear when the broker branch lands on its `master` and the pin moves. Nothing else in the pack reports an error.
- `npm run chain` was not run, as instructed.

**Mutation checks** (each mutant copied under the scratchpad, applied, its named test run, the file restored, and
confirmed with `cmp`):
- View wrap-around clamped (`findNext` clamps instead of wrapping): 'steps to older matches ... round again' fails.
- View cap removed (`setMatches` holds everything): 'holds and paints at most a thousand matches' fails.
- View refresh throttle removed (no pending-timer guard): 'is searched for again when rows change' fails with
  `expected [ 'a', 'a', 'a', 'a' ] to have a length of 3`.
- App case flag dropped from the view call: pool spec fails, `expected false to be true`.
- App `1000+` suffix dropped: pool spec fails, `expected '1 of 1000' to be '1 of 1000+'`.
- Not run: a mutant of the broker's case filter in `reads.rs`. Its test is the only check of that filter.

**Gaps.**
- The app's typecheck is red until the pin moves (above).
- The case filter runs one `text_between` per match, so a case-sensitive search over 2,000 matches makes 2,000
  FFI reads. Not measured.
- Case-sensitive results are the exact matches among the newest 2,000 case-insensitive ones, so a rare exact match
  older than that is not found. The needle is a plain string in both modes.
- The 'centres' behaviour is only for an off-screen match; a match already visible is not moved.
- The refresh is a throttle with a trailing refresh: the first change starts a 200 ms wait, and changes during it
  share one refresh. A steady stream refreshes every 200 ms, and the last change is found within 200 ms of it.
- Not checked in a real window: the find bar's appearance, and VoiceOver announcing the count. The aria-live
  attribute is tested in the DOM, not by a screen reader.
- Finding: `Screen::search` (`screen.rs:1282`, ceiling 100) is not on the view's path, and its doc says it bounds
  every search. It is left alone here; it answers the protocol request and is a separate question.

## Phase 3 and 4 — app wiring (2026-11-12)

The broker and view halves are on the pin (`vendor/apack-terminal.rev` = `e7d0cfb`). This section is the app's half: the
Code settings that choose the cursor and the link preview, the request that sends the cursor default, and the view options
the pool makes each view with. No Electron window was run, so nothing below is checked by eye.

### Decisions

- **Blink is two values, and the unset one is the broker's reset value.** `cursorBlink` is `default` (unset), `on`, `off` or
  `program`. The broker's `SetCursorDefaults` gets `on` for unset and `on`, `off` and `program` as they are, so a reset returns
  to a blinking cursor for the default (D8). The view's override (`cursorBlink`) is `on` or `off` as chosen, and `program` for
  unset, so a program's own DECSCUSR choice holds until it resets. `cursorDefaultsOf` and `viewSettingsOf` hold this mapping.
- **The stored value for "unset" is the string `default`**, not an absent key, so the form has a selectable option and the
  schema stays a plain enum. Absent is also read as unset.
- **The cursor default is sent by the backend, not the window.** Only the backend holds the broker's control connection; a
  window's pool holds the view stream, which has no request for it. The code feature sends `set_cursor_defaults` after every
  session it obtains: at spawn (`open`), when a surviving session is taken up (`adopt`, both paths), and to every live
  terminal when the code settings change (`applyCursorDefaults`, called from the code system's `updateSettings`).
  The SDK's `TerminalSession.setCursorDefaults` and the host's `BrokerSession.setCursorDefaults` carry it; the request
  carries no reply, so a failed send is logged rather than failing the spawn.
- **The view options are read at construction, so a change makes the views again.** The view has `cursorInactive`,
  `cursorBlink` and `linkPreview` as construction options and no setters for them (the one setter it has is
  `setCopyOnSelect`). `TerminalPool.setViewSettings` records the new values and calls `draw` on every entry that has a
  view; `draw` disposes the old view and mounts the new one in the same container, as a shell replacement already does.
  A change that equals the current values makes no view. Views not yet drawn take the values as they are made.
  Cost: a view made again loses its scroll position and any selection. Not measured.
- **Inactive shape is one of the view's four shapes** (`block`, `bar`, `underline`, `hollow`), default `hollow`. Only the
  active shape goes through the broker, since the broker reports the shape a program set, and that is the frame's cursor.
- **Link preview**: `off`, `osc8` (declared links only) or `all`, default `osc8`, passed to the view as `linkPreview`. Its
  setting copy was corrected in the same commit to say it applies to every open terminal at once.

### Changes

- `packages/default-setup/apack.json`: `cursorStyle`, `cursorInactiveStyle`, `cursorBlink`, `linkPreview` in the code
  schema and defaults (`bar`, `hollow`, `default`, `osc8`); none added to `required`, as only the defaults are needed.
- `packages/default-setup/src/features/code/fe/settings.vue`: four selects after the copy-on-selection setting.
  `npm run generate:entries -w @app/default-setup` changed only the generated settings (gitignored); `facade:update` moved
  only `etc/pack-types.api.md`, by four optional keys.
- `packages/apack-sdk/src/services/terminal.ts`, `index.ts`, `etc/services.api.md` (`api:update`: 1 of 31 reports, the
  diff is the new type and method): `TerminalCursorStyle`, `TerminalCursorBlink`, `TerminalSession.setCursorDefaults`.
- `packages/apack-host/src/broker/client.ts`: `BrokerSession.setCursorDefaults`, sending `set_cursor_defaults`.
  `packages/apack-host/src/services/terminal.ts`: forwarded in `expose`.
- `packages/default-setup/src/features/code/be/services/terminal.ts`: `cursorDefaultsOf`, `arrangeCursor`,
  `applyCursorDefaults`; `open` split into `open` (arranges) and `spawn`. `be/system.ts`: `updateSettings` calls
  `applyCursorDefaults`.
- `packages/default-setup/src/features/code/fe/utils/terminal-pool.ts`: `ViewSettings`, `viewSettingsOf`,
  `setViewSettings`; `draw` passes the three options. `fe/state.ts`: `applyViewSettings` beside `applyCopyOnSelect`, on
  `CODE_STARTED` and `FEATURE_SETTINGS_UPDATED`.
- Tests: `tests/features/code/be/terminal-cursor-defaults.spec.ts` (new, 5 cases),
  `tests/features/code/be/_support/terminal-broker.ts` (records `cursors`),
  `tests/features/code/fe/utils/terminal-pool.frontend.spec.ts` (4 new cases), `tests/features/code/fe/state.spec.ts` (1 new
  case; the pool mock keeps the real `viewSettingsOf`).

### Commands and counts

- `npm run spec -- .../be/terminal-cursor-defaults.spec.ts`: 5 passed, 0 failed.
- The other backend terminal specs (`be/terminal-*.spec.ts`, 14 files, run as 11 plus the cases above): 63 passed, 0
  failed, across the 11 listed; the 4 others with the broker-client spec gave 31 and 26 passed.
  `packages/apack-host/tests/broker/client.spec.ts`: 26 passed.
- `terminal-pool.frontend.spec.ts`: 40 of 40 passed (35 before, 4 added here).
- `state.spec.ts`: 20 of 20 passed (1 added here).
- `npm run typecheck:pack`: exit 0, zero errors (the baseline was exit 0 before this section too).
- `npm run typecheck:sdk` and `npm run typecheck:host`: passed.
- `npm run chain` was not run, as instructed.

### Mutation

Each mutant was made in the source file, its named spec run, and the file restored from a copy under the scratchpad and
confirmed with `cmp` (identical in both cases).

- Cursor default not sent (the `setCursorDefaults` call in `arrangeCursor` replaced by a no-op): 3 of 5 failed in
  `terminal-cursor-defaults.spec.ts`: the spawn case, the program-decides case and the settings-change case.
- `linkPreview` default changed from `osc8` to `all` in `viewSettingsOf`: 2 of 40 failed in
  `terminal-pool.frontend.spec.ts`: the defaults case and the unknown-values case.

### Gaps

- **No Electron run.** The form's selects, the cursor shape and blink, and the link underline and preview were not looked
  at in a window.
- **View recreation on a settings change** loses scroll and selection in each drawn terminal. Not measured, and not
  avoided: a setter in the view would be the fix, and it is a view-side change.
- **`cursorBlink` `default` is stored, not absent.** The form and the schema agree; an external edit of the settings
  file that removes the key reads as `default` too, but was not tested.
- **The `TerminalSession.setCursorDefaults` contract is not exercised against the real broker** in an integration run.
  The host client spec covers the connection only at the level it covered before.
- **A target's sessions** also receive the cursor default at spawn and on change (the same `arrangeCursor`), which assumes
  the target's broker understands `set_cursor_defaults` at the same protocol version. Not tested on a target.

## Phase 7 — IME and composition

Branch `session/next-features-ime` in `apack-terminal` (worktree `apack-terminal-worktrees.noindex/ime`), from broker
`origin/master` at `e7d0cfb`. View commit `e218707` (`feat(view): composition sends once at its end, positioned at the
cursor and clears the selection`). Files: `view/src/input.ts`, `view/src/view.ts` (one line wiring the selection clear),
`view/tests/input.spec.ts`.

### What changed

- **Sent by position, at composition end.** The composition's text is the field's text between the caret at
  `compositionstart` and what follows it. Text already in the field, and text after the caret, are never sent. The
  send is at `compositionend`; `inserted` still ignores input while composing.
- **Enter during composition** sends the composed text so far, then Enter, and prevents the newline in the field. The
  composition itself is left to the input method.
- **Keys 229, 16, 17, 18 and 20** send nothing during composition and do not end it (nothing on a keydown ends it).
- **Selection clears** at `compositionstart` (`compositionStarted` option, wired to `selection.clear()` in the view).
- **Duplicate suppression.** A key's text is remembered, and an input event carrying the same text is not sent again.
- **Positioning.** The field sits at the cursor's cell while composing (the existing `moveTo` from the cursor row, fold
  header row kept); its height is at least 1 px.

### Tests

- View suite before the change: 17 files, 377 tests passing (`npm ci` then `npm test`, `npx tsc --noEmit` exit 0).
- After: 17 files, 389 tests passing; `tsc --noEmit` exit 0. Twelve tests added in a `composition` block of
  `view/tests/input.spec.ts`: once at end after updates; a repeated string composed twice; a repeated string diffed by
  caret position; text before composition and after the caret not sent; Enter sends the text then Enter; 229 during
  composition sends nothing and does not end it; 229 outside composition sends no key; shift, control, alt and caps
  lock do not end composition; a keydown and the input it reports send once; selection clears at start; the field sits
  at the cursor's cell with at least 1 px; a zero-height row still gives a 1 px field.
- Two existing fixtures were corrected: they put an uncommitted or empty value in the textarea at `compositionend`. A
  real browser holds the committed text there, which is what the send now reads. Their assertions are unchanged.

### Mutation

Each mutant was a copy under `/private/tmp/claude-501/-Users-spankyed-Develop-Projects-apack-monorepo/cbf295d0-79cb-4bdf-99e6-760919d3dad1/scratchpad/ime-mutants/`,
copied over `view/src/input.ts`, its spec file (`tests/input.spec.ts`) run, and the original restored and confirmed with
`cmp` (identical each time).

- Send during composition (the `inserted` composition guard removed): 4 of 37 failed in `input.spec.ts`: the
  composed-once test, the many-updates test, the 229-processing test and the modifiers test.
- First-occurrence diff (the composed text taken as the field minus its pre-composition value with `replace`): 2 of 37
  failed: the caret-position repeated-string test, and the Enter test (the end-of-composition path diffs against an empty
  pre-value and resends the committed text). The repeated-string-twice test passed under this mutant, so it does not
  by itself catch the first-occurrence bug; the caret test does.
- 229 guard removed from `read()`: 1 of 37 failed, the 229-outside-composition test.

### Manual checklist (D6 follow-up, not run)

Run in a window, with a real input method, and record each result here:

1. **Japanese (romaji, kana, kanji).** Type `nihon`, convert with Space, press Enter.
   - Candidate window opens at the cursor.
   - `日本` appears once in the program's line.
   - Enter during composition: record what happened (does the kana preedit get sent, or the committed text).
2. **Chinese (pinyin).** Type `ni hao`, pick a candidate with a number key.
   - Candidate window at the cursor; the chosen characters appear once.
3. **Dead key (macOS).** Option-e, then e.
   - The accent `é` appears once; no stray `e` or duplicate.

### Gaps

- **No real input method was run.** Everything above is driven by synthetic events in jsdom; browser ordering of
  `keydown` (229 or `Process`), `compositionend` and `input` is assumed, not observed.
- **Enter during composition** can double-send in Chrome if the input method still commits the text after the forced
  send: the preedit goes out at Enter and the committed text at `compositionend`. Only the checklist can show this.
- **Safari** delivers keydown 229 after `compositionend`, and 229 is treated as not-a-key, so an Enter that Safari
  reports only as 229 is dropped. This follows the spec's rule for 229; it is a known cost, not checked.
- **Browser repositioning on a timer** (xterm's `setTimeout` reposition) is not done; the field moves on paint only.
- **The `_compositionSuffix` case** of xterm (reconversion of text around the caret) is handled only by position in the
  field, which holds only what the composition put there; no real reconversion was tested.

## Gaps closed (2026-11-12)

Branch `session/next-features-gaps` (local, not pushed; worktree `apack-terminal-worktrees.noindex/gaps`), cut from
`origin/master` at `3b8ef5c`. Commits: `304f399` `fix(vt): a case-sensitive search goes to the end of the history
before its cap`, and `849a1f0` `feat(view): setters change the cursor and link settings on a view that is up`.
Nothing is pushed or merged, no PR is open, and `vendor/apack-terminal.rev` is not moved.

### Gap A: a case-sensitive search missed an old exact match (Phase 6)

- **Cause.** `vt/reads.rs` `find` stopped feeding the core once it had 2,000 case-insensitive matches, and the exact
  filter ran only on those. An exact match older than them was never seen.
- **Fix.** The 2,000 stop applies to a case-insensitive search only. A case-sensitive search runs to the end of the
  history. The filter is lazy, so it reads match text only until it has 2,000 exact matches. The 1,000 display cap in
  the view (D3) is unchanged.
- **Test.** `a_case_sensitive_search_finds_an_exact_match_older_than_the_case_insensitive_cap` (`tests/view_reads.rs`):
  the oldest line is the only exact `needle`, and 40,000 later lines read `Needle`. The exact search returns the oldest
  line. The case-insensitive search still returns 2,000.
- **Mutation.** The 2,000 stop restored for the case-sensitive path (`let enough = total >= SEARCH_MATCHES;`). The new
  test fails at its exact-match assertion (`left: []`). A first version with 2,500 later lines did not fail, because the
  core's first part already reached the oldest line, so the history was widened to span several parts. File restored, `cmp` identical.
- **Counts.** `cargo test --test suite`: 444 passed, 0 failed (443 before, plus the new test). `cargo fmt --all --check`
  exit 0. `cargo clippy --all-targets -- -D warnings` exit 0.

### Gap B: cursor and link settings remade the view (Phase 3, link preview)

- **Change.** `view/src/view.ts`: the inactive cursor shape, the blink mode and the link preview are fields, set from the
  constructor options (which still work). New `setCursorInactive(style)`, `setCursorBlink(mode)` and `setLinkPreview(mode)`
  take effect on the existing view. `setCursorBlink` restarts the blink phase as typing does. `setLinkPreview` updates
  the title of the link under the pointer. None of them remakes the view.
- **Tests.** Three in `view/tests/view.spec.ts` ('cursor settings changed on a view that is up') and one in
  `view/tests/interaction.spec.ts` (`setLinkPreview`). Each checks the next paint or title, the element's identity, the
  selection, and the scroll position, including a scrolled-up view.
- **Mutation.** Each setter in turn was given `this.follow(); this.selection.clear()`, which is what a rebuild does to
  scroll and selection. Each mutant's own test fails: `setCursorInactive`, `setCursorBlink` (its first test) and
  `setLinkPreview`. Each file restored, `cmp` identical.
- **Counts.** View `npm test`: 393 passed, 17 files (4 new). `npx tsc --noEmit` exit 0. Broker suite as above.

### Remaining limits

- **The app still remakes views.** It must switch from remaking views to these setters. That is a separate app change,
  made after this branch merges and `vendor/apack-terminal.rev` moves to it. Until then the app's pinned view has no setters.
- **A blink change restarts the blink phase.** A change to any blink mode shows the cursor at once.
- **Case-sensitive cost is not measured.** Such a search reads every match of the needle in the history, and keeps all
  the case-insensitive matches it finds. The exact filter reads text only as far as 2,000 exact matches.
- **`Request::Search` is untouched.** `Screen::search` (`screen.rs`, ceiling 100) has no case flag and is not on the
  view's path.
- **Not seen in a real window.** The cursor's look and the link title's timing are checked in jsdom only.
