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
