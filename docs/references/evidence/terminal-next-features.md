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
