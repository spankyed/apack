# Goal: the next terminal features

**Status: implemented.** All seven phases have their work, evidence and gap notes in [the evidence record](../references/evidence/terminal-next-features.md). Open, and needing a person at a real window: the IME checklist (D6), and the real-app checks listed in the evidence. Phase 0 is done; see [the evidence record](../references/evidence/terminal-next-features.md). Start only after [the terminal parity goal](../archive/goals/goal-terminal-parity.md) is closed
(it is closed on `master` as of 2026-11-12; its strict-chain run is the last check on it).
Owner: the terminal view and broker (`vendor/apack-terminal`) and the Code surface
(`packages/default-setup/src/features/code`).

This document is written so that an implementer who did not write it can finish it. Every seam is named with a
file and a line. Where the line numbers were read from a survey rather than from the file you will work in, the
phase says so and asks you to re-read before editing. Read Scope, Decisions and Constraints in full before Phase 1.

## Prompt

````text
Implement docs/goals/goal-terminal-next-features.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Decisions, Phases and Current handoff before continuing.
Work phases in order. A phase is finished when its Done-when conditions hold on current source, not when its
code compiles. Commit validated checkpoints as you go. Do not expand or reduce scope without user authorization.
Each phase ends with evidence written to docs/references/evidence/terminal-next-features.md.
````

## Why

The parity goal shipped the view's copy path, contrast, selection shape, and command blocks. Seven features a
user of a daily terminal notices are still missing or only partly present:

1. Scrollback search, with next and previous match.
2. Clickable hyperlinks (OSC 8).
3. Synchronized output (DEC mode 2026), so full-screen programs stop flickering mid-repaint.
4. IME and composition input (CJK and other input methods).
5. Bell: a visual cue, and an optional system notification.
6. Drag-and-drop of files onto the terminal, inserting their quoted paths.
7. Cursor style and blink, configurable in Code settings.

They are ordered in Phases by cost and dependency, not by the list above. Shell integration (OSC 133) is
already present for command blocks and is out of scope here (see Scope).

## Scope

In:
- Phases 1 to 7 below, one per feature, in the order given.
- Repositories: `monorepo` (Code surface, Code settings, the SDK's bridge types, Electron main and preload) and
  `apack-terminal` (broker and view).

Out:
- Ligatures. The painter draws cell by cell; shaping them is a painter rewrite. Revisit only if a user asks.
- Inline images (kitty graphics protocol, iTerm2 inline images). No tool we run emits them yet. Add them only when
  one does, as a separate goal. Sixel stays out, as in the parity goal.
- Touch input. This is a desktop app.
- Screen export.
- Any change to `PROTOCOL_VERSION`, which stays 1. A new request or event is additive and is allowed; a new
  version number is not (see Constraints).
- Shell integration. OSC 133 already drives command blocks (see Verified seams). Improving its reliability is a
  separate goal, to be opened only if a measured failure shows up.

## Verified seams

These were read at the pin, broker commit `3a2140cc8dd24a1c62b60a4d723b264a53a91c1d` (the commit `master` pins).
Re-check each one before editing; a line number moves when the file changes.

- **Search.** Broker: `src/screen.rs:1261` `search(text, history)`, `src/session.rs:797` `search`,
  `src/protocol.rs:401` `SearchMatch`, `src/protocol.rs:540` the `Search` reply. View:
  `view/src/source.ts:393` `search(needle)`, `view/src/view.ts:381` calls it. Not present: next and previous
  navigation, highlights, a find bar.
- **OSC 8.** Broker: `src/vt/rows.rs:364-365` reads `HAS_HYPERLINK` per cell; `rows.rs:473` and `rows.rs:484` read
  the URI with `ghostty_grid_ref_hyperlink_uri`. The core stores the link; the broker keeps no table of its own.
  View: `view/src/links.ts:4-20` defines `Link` with kind `declared` or a detector name; `links.ts:38` is the bare
  URL detector; `view/src/view.ts:81` is the callback on a modifier-click.
- **Mode 2026.** Broker: `src/vt/mod.rs:426` sets `RENDER_HOLD`; `src/screen.rs:219` holds the hold state;
  `src/screen.rs:296-304` scans raw input for `CSI ? 2026 h/l`; the hold module defers drawing while held;
  `publish` carries a `held` flag to the view. View: no handling found.
- **Bell.** Broker: `src/vt/mod.rs:1248` `note_bell`, `Effect::Bell` (`tests/effects.rs` covers it).
  App: `packages/default-setup/src/features/code/be/features/terminal.ts:116` emits `terminal.BELL`;
  `fe/features/terminal/state.ts:42-47`; `fe/features/terminal/TerminalActivityBadge.vue:17-20` shows a badge.
  View: no bell handling.
- **IME.** View: `view/src/input.ts:95` creates the hidden `<textarea>`; `input.ts:109` listens to
  `compositionstart`; `input.ts:110` to `compositionend`; the handlers are around `input.ts:222-236`; keydown
  guards for `isComposing`, `Dead` and keyCode 229 are around `input.ts:158-163`. The Code surface has none.
- **Cursor and blink.** Broker: `src/vt/rows.rs:162-167` `CursorRead { shape, blinking }`; `rows.rs:668-686` maps
  the core's style to shape (1 bar, 2 underline, 3 hollow block); `src/vt/mod.rs:568-581` sets the default style
  (bar) and default blink. View: `view/src/view.ts:12` `BLINK_MS = 530`; `view.ts:1010` the blink timer;
  `view.ts:827-831` gates blink on focus. App: no cursor settings in `fe/features/terminal` or `settings.vue`.
- **Drag and drop.** View: no `dragover`, `drop` or `dataTransfer` handling. App: `packages/apack-sdk/src/fe/electron-api.ts:52`
  declares `getPathForFile(file)`, the bridge that turns a dropped `File` into a path; explorer and tab drag and drop
  exist but are unrelated.
- **OSC 133.** Broker: `src/vt/mod.rs:406-412` registers `SEMANTIC_PROMPT`; `mod.rs:1137-1170`
  `note_semantic_prompt`; `src/commands.rs` keeps a record per command. App:
  `packages/default-setup/src/features/code/be/services/shell-integration.ts` emits 133 A/B/C/D for bash, zsh and
  fish. OSC 633 is used only for the working directory.

## What the libraries do, and what we take

Read from primary sources (xterm.js master, `addons/addon-search/src/SearchAddon.ts`,
`DecorationManager.ts`, `src/browser/input/CompositionHelper.ts`; the contour `synchronized-output.md`
specification; ghostty's OSC 8 page; the ghostty configuration reference; VS Code's xterm wrapper). Where a
source could not be read, the item says so.

### Scrollback search

- xterm.js (`SearchAddon`): matches are found across wrapped lines; the active match is selected and scrolled to
  the middle of the view; highlights are DOM decorations created per row; a highlight limit of 1000 caps them;
  an incremental refresh runs 200 ms after output goes quiet.
- Take: the 1000 highlight cap; the 200 ms quiet period before refreshing matches while output streams; scrolling
  the active match to the middle; the match count and index reported to the UI.
- Leave: DOM decorations, one per row, rebuilt on every search. The xterm source says so itself: its cost is O(n)
  on each search, and its decorations are not kept in step with scrolling. We paint highlights in the view's own
  paint pass (Phase 6).
- Note: xterm's `decorations` option only paints when set; its `DecorationManager` never re-syncs on scroll.

### OSC 8 hyperlinks

- ghostty (documented): syntax `ESC ] 8 ; params ; URI ESC \`, closed by an empty `ESC ] 8 ; ; ESC \`. Only
  `id` is a recognized parameter, and it groups cells that share both `id` and URI, which is what makes a link that
  wraps across rows hover as one.
- ghostty (documented): for `file://` URIs the host must be present, or the link is refused, because a hostless
  file link on a remote machine resolves to a local file.
- ghostty 1.4.0 (release notes): Cmd-click on a crafted OSC 8 link could open an unsafe local file or a custom
  scheme; the fix blocks unsafe targets and confirms custom schemes.
- ghostty configuration: `link-previews` takes `true`, `false` or `osc8`, so an app can show a preview for OSC 8
  links only.
- xterm.js: `OscLinkProvider` and `OscLinkService` handle OSC 8 in the core; `addon-web-links` is the bare-URL
  detector.
- Take: the `id` grouping; the `file://`-needs-host rule; the 1.4 confirmation for custom schemes; the choice to
  preview OSC 8 links separately from bare URLs.
- Leave: a default that opens any scheme. Our default allows only `http`, `https` and `mailto`.

### Synchronized output (DEC mode 2026)

- contour specification: set `CSI ? 2026 h`, reset `CSI ? 2026 l`, query `CSI ? 2026 $ p`, reply
  `CSI ? 2026 ; Ps $ y` with Ps 0 (not recognized), 1 (set), 2 (reset), 3 (permanently set), 4 (permanently reset).
  Feature detection is: no reply, or Ps 0, means unsupported. While set, the terminal keeps parsing and the renderer
  keeps showing the last frame; on reset it shows the latest state.
- The specification gives no timeout value and says there is no consensus on one. It notes that a too-short timeout
  is no worse than none.
- xterm.js 6.0.0 release notes list "synchronized output support (DEC mode 2026)" (PR #5453). We have not read the
  PR, so Phase 1 reads the code before copying anything.
- Take: the Ps values for the query reply (so a program that asks gets the true answer); the rule that the renderer
  shows the last frame.
- Leave: no timeout. We set one (Phase 1), because a program that sets the mode and crashes would freeze the view.
  The specification does not say what the value should be; Phase 1 chooses it and records why.

### IME and composition

- xterm.js (`CompositionHelper`, read from `src/browser/input/CompositionHelper.ts`): listens to
  `compositionstart`, `compositionupdate` and `compositionend`; the helper textarea is positioned at the cursor's
  pixel cell, sized at least 1px (some IMEs break at zero size), and repositioned on a `setTimeout` because browsers do
  not fire IME events consistently. Composed text is sent to the program when composition ends, not during it.
  Keys 16, 17, 18, 20 and 229 do not end composition. Enter during composition sends the composed text
  immediately, before Enter runs. `_dataAlreadySent` stops a character being sent twice when keydown and the
  textarea diff both report it. The text after the cursor at `compositionstart` (`_compositionSuffix`) is excluded
  from the send, so existing text is not resent.
- Known approximation in xterm: the change detection uses `newValue.replace(oldValue, '')`, which removes the first
  occurrence only, so a repeated string can be misread. We diff by position instead.
- Known mislabel in xterm: its comment calls keyCode 229 "Enter". 229 means "the key is part of IME processing";
  the comment is wrong.
- Take: positioning the textarea at the cursor so the candidate window opens there; the suffix rule; the
  `_dataAlreadySent` dedupe; sending on composition end, and the forced send on Enter.
- Leave: the first-occurrence diff and the mislabel.

### Bell

- xterm.js: the core fires `onBell`; the core does nothing visible. Its `bellStyle` and `bellSound` are the app's
  to implement. Our broker already coalesces repeated bells (`src/vt/mod.rs:948-965` per the survey; re-check).
- ghostty: has bell features and an audio option in its configuration; the reference page we read was truncated
  before those entries, so we have not confirmed their defaults.
- VS Code: its terminal uses the bell event for a visual and sound setting; we did not read its implementation.
- Take: the split between what the core reports and what the app presents, which our app already has
  (`terminal.BELL` to a badge).
- Decide: the visual flash is on by default and the system notification is off by default (D7).

### Cursor style and blink

- ghostty configuration: `cursor-style` takes `block`, `bar`, `underline` or `block_hollow`; `cursor-style-blink` is
  three-state: unset means blink, `true` and `false` override it, and `null` defers to the program's DEC mode 12.
  That three-state is the good part.
- xterm.js and VS Code: VS Code maps its own `line` style to xterm's `bar` so its editor and terminal cursor match,
  and keeps separate active and inactive cursor styles. We take the separate inactive style.
- Take: three-state blink, deferring to the program; separate active and inactive styles.

### Drag and drop

- VS Code (read from its xterm wrapper only): inserts the dropped path, quoted for the shell. We did not read the
  quoting code; Phase 5 writes the quoting and tests it.
- Take: insert the path without a newline, so nothing runs.

## Decisions

Each is the path to take. Where a decision is marked "re-decide", the phase that owns it must check the stated
condition before proceeding, and record the outcome.

- **D1 — Work in this order: DEC 2026, bell, cursor, OSC 8, drag and drop, scrollback search, IME.** Cheapest and
  most self-contained first; the riskiest (IME, which needs a real input method to test) last.
- **D2 — Highlights for search are painted by the view, not DOM decorations.** *Why:* the xterm source shows
  decorations cost O(n) per search and drift on scroll; the view already paints a grid and a selection, so one more
  span type costs one more pass.
- **D3 — Search matches are capped at 1000 (xterm's `highlightLimit`).** Beyond the cap, the count reads "1000+"
  and navigation still works. *Why:* the cap bounds the paint and the search cost; a user who needs the 1001st
  match is rare, and "1000+" says so.
- **D4 — OSC 8 links open only `http`, `https` and `mailto` by default.** Any other scheme, and every `file://` link,
  asks for confirmation through the main process. A `file://` link without a host is refused outright. *Why:* ghostty
  1.4 shows the crafted-link risk; a confirmation is cheap and the refusal is exact.
- **D5 — Synchronized output has a timeout of 150 ms.** *Revised in Phase 0:* the broker already owns the hold and its one-second limit (`src/holds.rs`, `HOLD_LIMIT`), and that limit is tested. The view adds no second clock. Phase 1 measures the limit and records whether it stays at one second. The original text follows. When a program sets mode 2026 and does not reset it within
  150 ms of its last write, the view resumes painting. *Why:* the specification gives no value, and says a too-short
  timeout is no worse than none. 150 ms is long enough that a slow program rarely flickers and short enough that a
  stuck one is not visible for long. Phase 1 re-decides this from a
  measurement of the longest real frame the harness produces, and records it.
- **D6 — IME is tested automatically by driving the hidden textarea with synthetic composition events, and by a
  manual checklist with a real input method, recorded in evidence.** The goal completes on the automated tests. The
  checklist, like the parity goal's VoiceOver checklist (D6 there), is a follow-up whose result is recorded when run.
- **D7 — Bell: visual flash on by default; system notification off by default, and only when the window is not
  focused.** *Why:* a flash is local and expected; a notification that fires on every bell is noise.
- **D8 — Cursor blink is three-state: unset (the app's default), on, off, or "program decides"** (ghostty's
  `null`). Style and blink are per session, and a program's DECSCUSR choice wins over the app's default until the
  program resets it.
- **D9 — Drag and drop inserts the quoted path(s), separated by spaces, with no trailing newline.** Quoting is POSIX
  single quotes for bash, zsh and fish; on Windows it is the quoting for the shell the terminal runs, and Phase 5
  names which shells it supports.
- **D10 — Scrollback search has no regex option in this goal.** A plain text search with a case toggle. *Why:* the
  broker's `search(text, history)` takes text; a regex would change the broker's contract and is a separate decision.

## Phases

Each phase names its deliverable, its dependencies, the code it touches, the tests it needs, and what is done when
it finishes. A phase is not finished until its evidence section is written.

### Phase 0 — re-read the seams at the pin

- **Deliverable:** a short evidence section confirming each seam in Verified seams still exists at the pin, with the
  current line numbers. Any seam that moved is corrected in this document.
- **Why:** the survey's line numbers came from a checkout at `efe5d84`, not the pin. The primary checkout at
  `vendor/apack-terminal` is at `efe5d84`; check it out at `3a2140cc8dd24a1c62b60a4d723b264a53a91c1d` (or a branch
  at that commit) before reading.
- **Dependencies:** none.
- **Done when:** every seam in Verified seams is confirmed or corrected, and the corrections are in this document.

### Phase 1 — synchronized output (DEC mode 2026)

- **Deliverable:**
  - The view holds its paint while the broker reports `held`, and resumes on the reset or on the 150 ms timeout (D5).
  - The broker answers the DECRQM query `CSI ? 2026 $ p` with the Ps value for the current state (0 unsupported is
    never sent; we support it, so answer 2 when reset and 1 when set).
- **Read first:** `src/screen.rs:219` and `296-304`; the hold module; `view/src/` for the `held` flag at publish.
  Read the xterm.js PR #5453 before choosing how the timeout is counted, and record what it does in evidence.
- **Dependencies:** Phase 0.
- **Touches:** broker `src/screen.rs`, the hold module, the query path; view paint loop in `view/src/view.ts`.
- **Tests:**
  - A broker test sets mode 2026, writes output, and shows the publish carries `held` until reset.
  - A broker test shows the query reply is Ps 2 when reset and Ps 1 when set.
  - A view test shows paints are suppressed while held and resume on reset.
  - A view test shows the timeout resumes painting when no reset arrives within 150 ms.
  - Mutation check: break the suppression and confirm a test fails; break the timeout and confirm the stuck-program
    test fails.
- **Done when:** the tests above pass, the mutation checks are recorded, and the 150 ms value is recorded with the
  measurement behind it (D5).

### Phase 2 — bell

- **Deliverable:**
  - A visual flash on the terminal canvas when a bell arrives, default on. A 150 ms flash of the background, then
    back. Repeated bells within 500 ms do not stack (the broker already coalesces; the view also rate-limits).
  - A setting in Code settings for the flash (on, off) and the system notification (off by default). The
    notification is sent through the main process and fires only when the window is not focused (D7).
- **Read first:** `be/features/terminal.ts:116` (the emit), `fe/features/terminal/state.ts:42-47`,
  `TerminalActivityBadge.vue:17-20`.
- **Dependencies:** none beyond Phase 1 landing.
- **Touches:** view (`view.ts`, a flash in the paint pass); `fe/features/terminal/state.ts`; `settings.vue`;
  main-process notification call through a preload bridge (use the bridge pattern from the parity goal's
  `clipboard` bridge: `packages/main/src/modules/clipboard-access.ts` is the model).
- **Tests:**
  - A view test: a bell paints the flash for 150 ms and then the colours return.
  - A view test: two bells inside 500 ms paint one flash.
  - A frontend test: the flash setting off paints nothing.
  - A main-process test: the notification is sent only when the window is unfocused; with the window focused, none.
  - Mutation check: remove the focus gate and confirm the focus test fails.
- **Done when:** the tests pass and the mutation check is recorded.

### Phase 3 — cursor style and blink

- **Deliverable:**
  - Code settings: default cursor style (block, bar, underline), inactive style (hollow block by default), and blink
    (unset, on, off, or "program decides" per D8).
  - A program's DECSCUSR wins over the app's default until it resets; the app default reaches the broker through a
    new additive request (`SetCursorDefaults` or the nearest existing request; read `protocol.rs` first) so the broker
    applies it where it sets the default today (`src/vt/mod.rs:568-581`).
- **Read first:** `src/vt/rows.rs:162-167` and `668-686`; `src/vt/mod.rs:568-581`; `view.ts:12`, `190`, `827-831`,
  `1010`.
- **Dependencies:** Phase 2 (for the settings pattern).
- **Touches:** broker protocol and cursor defaults; view cursor drawing (`canvas-painter.ts:344-365`); `settings.vue`.
- **Tests:**
  - A broker test: a settings default for style and blink is reported in the cursor read; a program's DECSCUSR
    overrides it, and a reset returns to the default.
  - A view test: the inactive cursor draws in the inactive style when the view is unfocused.
  - A view test: "program decides" blinks only when the program's DEC mode 12 says so; "on" and "off" ignore it.
  - Mutation check: break the DECSCUSR precedence and confirm the precedence test fails.
- **Done when:** the tests and mutation check pass.

### Phase 4 — OSC 8 hyperlinks

- **Deliverable:**
  - A declared OSC 8 link is underlined on hover, groups by `id` so a wrapped link hovers as one, and opens on
    modifier-click (Cmd on macOS, Ctrl elsewhere).
  - The main process opens the link under D4: `http`, `https`, `mailto` open directly; any other scheme or any
    `file://` link asks first; `file://` without a host is refused.
  - A setting for link previews: off, on for all links, or OSC 8 only (ghostty's `osc8` value). Default: OSC 8 only.
- **Read first:** `view/src/links.ts:4-20`, `38`; `view/src/view.ts:81`; `rows.rs:364-365` and `473-484`.
- **Dependencies:** Phase 3.
- **Touches:** broker (if the URI read needs the `id` parameter: check whether `ghostty_grid_ref_hyperlink_uri`
  returns it; if not, the grouping is done by URI alone and this is stated in evidence); view link hover and click;
  main-process `openExternal` with the scheme check through a preload bridge.
- **Tests:**
  - A broker test: a cell written inside `OSC 8 ; ; URI` reports the URI; a cell after the close does not.
  - A view test: a wrapped link's cells share a link id and hover together.
  - A main-process test: `https` opens; `javascript:` and `file:` without host are refused; a custom scheme asks first.
  - Mutation check: allow every scheme and confirm the scheme test fails.
- **Done when:** the tests and mutation check pass, and the `id` behavior is recorded (whether the broker exposes it).

### Phase 5 — drag and drop file paths

- **Deliverable:**
  - Dropping one or more files on the terminal inserts their paths, quoted per D9, separated by spaces, no newline.
  - Paths come from the SDK bridge `getPathForFile` (`packages/apack-sdk/src/fe/electron-api.ts:52`).
  - The drop goes to the program through the same text path as a paste (bracketed when the program asked for it;
    see `view/src/input.ts:247` and the `paste` option at `input.ts:37`).
- **Dependencies:** Phase 4.
- **Touches:** view (a `dragover` and `drop` on the canvas, with `preventDefault`); `PanelTerminalSection.vue`
  (`fe/features/terminal`) if the drop is caught there; the quoting function (one place, tested per shell).
- **Tests:**
  - A quoting test per shell: a path with a space, a single quote, a dollar sign and a backtick comes back as one
    argument.
  - A view test: a drop inserts the quoted paths and no newline.
  - A view test: a drop of a non-file (text) inserts nothing.
  - Mutation check: drop the quoting and confirm the space-in-path test fails.
- **Done when:** the tests and mutation check pass. Which shells are supported is recorded.

### Phase 6 — scrollback search

- **Deliverable:**
  - A find bar over the terminal: Cmd/Ctrl+F opens it; Enter goes to the next match; Shift+Enter to the previous;
    Escape closes it. A case toggle (D10: no regex).
  - Matches are painted by the view's paint pass with a distinct highlight and an active-match colour; the active
    match scrolls to the middle of the view (xterm's behavior).
  - At most 1000 highlights (D3); above that, the count reads "1000+".
  - While output streams, matches refresh no more than once per 200 ms after output goes quiet (xterm's behavior).
  - The count and the active index are announced through an `aria-live` region in the find bar.
- **Read first:** `broker src/screen.rs:1261`, `session.rs:797`, `protocol.rs:401`, `540`; `view/src/source.ts:393`;
  `view/src/view.ts:381`. Note: the broker's `search` takes `history`; check what it returns for a wrapped match.
- **Dependencies:** Phase 5 (the view's key handling settles there).
- **Touches:** view (find state, paint pass, key handling in `view/src/input.ts`); `source.ts` (a next/previous step,
  or the view steps through the spans the broker returns); the find bar as a small Vue component in the Code surface.
- **Tests:**
  - A view test: next and previous step through matches in order and wrap around at both ends.
  - A view test: a match across a wrapped line is found once.
  - A view test: the active match is scrolled into view.
  - A view test: more than 1000 matches paints 1000 and reports "1000+".
  - A frontend test: the count and index reach the `aria-live` region.
  - Mutation check: break the wrap-around and confirm the wrap test fails.
- **Done when:** the tests and mutation check pass. The 200 ms refresh is covered by a test that drives output and
  advances fake timers.

### Phase 7 — IME and composition

- **Deliverable:**
  - The hidden textarea is positioned at the cursor's cell while composing, at least 1px in size, so the candidate
    window opens at the cursor.
  - Composed text is sent to the program when composition ends, not during it; Enter during composition sends the
    composed text first, then Enter.
  - Keys 16, 17, 18, 20 and 229 do not end composition.
  - The selection clears at composition start.
  - The character-diff uses position, not the first occurrence of a string (xterm's known approximation).
  - The `_dataAlreadySent`-style dedupe: a character reported by both keydown and the textarea diff is sent once.
- **Read first:** `view/src/input.ts:95-110`, `222-236`, `158-163`, `240`. Read xterm's `CompositionHelper.ts`
  (the approach is above) before writing.
- **Dependencies:** Phase 6.
- **Touches:** view `input.ts` only, plus a positioning helper in the view.
- **Tests (automated, D6):**
  - Drive `compositionstart`, `compositionupdate` and `compositionend` on the textarea with synthetic events and
    check what reaches the broker's input call: composed text once, after end.
  - Enter during composition sends the composed text before the newline.
  - A keydown of 229 does not end composition.
  - A repeated string composed twice sends both occurrences (the first-occurrence bug).
  - The textarea sits at the cursor's pixel cell during composition.
  - Mutation check: send during composition instead of at end, and confirm the first test fails.
- **Manual checklist (D6, a follow-up):** written into evidence: a Japanese input method (romaji to kana to kanji),
  a Chinese input method (pinyin), and a dead-key sequence (for example Option-e then e on macOS). For each: the
  candidate window opens at the cursor; the text appears once in the program; Enter during composition does what the
  checklist says. The checklist is run later and the result recorded; it does not block this goal.
- **Done when:** the automated tests and mutation check pass, and the manual checklist is written into evidence.

## Acceptance

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| DEC 2026 holds the frame and answers the query | broker `screen.rs:219`, `296-304`; no view handling | — | Phase 1 |
| Bell flashes, and notifies only when unfocused | `be/features/terminal.ts:116`; badge only | — | Phase 2 |
| Cursor style and blink in settings | broker `rows.rs:668`, `mod.rs:568`; no settings | — | Phase 3 |
| OSC 8 links hover, group, open safely | broker `rows.rs:364-484`; view `links.ts` | — | Phase 4 |
| Drop inserts quoted paths | `getPathForFile` bridge; no view handling | — | Phase 5 |
| Scrollback find with next and previous | broker `search`, view `search(needle)`; no navigation | — | Phase 6 |
| IME positions, composes once, sends on end | view `input.ts:95-163`; no positioning | — | Phase 7 |
| Manual IME checklist | — | — | follow-up (D6) |

## Constraints

- `PROTOCOL_VERSION` stays 1. A new request or event is additive: add it to `protocol.rs` and to the view's
  `broker/wire.ts` in one change, with both halves tested, as the parity goal did.
- No backward-compatibility shims. A changed contract moves every caller in the same change.
- Mutation-check every guard. A test that restates its implementation does not count.
- Validate in the bounded way CLAUDE.md describes: focused specs during a phase (`npm run spec`), the chain at a
  converged checkpoint (`npm run chain -- --no-native` for everyday work).
- Changes to `vendor/apack-terminal` are committed there and pinned here only after they land on the broker's
  `master`. Each pin names a commit on `master`.
- Do not edit release or version metadata.
- Each phase ends with its evidence written to `docs/references/evidence/terminal-next-features.md`.
- Strict acceptance at the end: `gh workflow run ci.yml --ref master -f strict_chain=true`, cited by run id.

## Current handoff

- Status: planned. Phase 0 is next. No code has changed for this goal.
- The primary `vendor/apack-terminal` checkout is at `efe5d84`. Work from `3a2140cc8d` (on the broker's `master`).
- Everything in Verified seams was read at `3a2140cc8d` by a survey, and Phase 0 re-confirms it.
- Unresolved: the xterm.js PR #5453 has not been read (Phase 1 reads it). The ghostty bell and audio defaults are
  unverified (Phase 2 reads the reference page past its truncation before choosing defaults).
- Unresolved: whether `ghostty_grid_ref_hyperlink_uri` returns the OSC 8 `id` (Phase 4 checks; if it does not, the
  grouping is by URI alone and says so).
