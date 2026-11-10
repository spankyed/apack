# The Ghostty integration, reviewed against the running pieces

**Status: open.** A review on 2026-11-10 of the terminal as shipped by
[the one-VT-core goal](../archive/goals/goal-one-vt-core.md). Every figure below was taken that day against a
private broker started from the pinned binary and against `ghostty-web`'s own WebAssembly module run in Node;
nothing was measured in the running app unless it says so. The section headings say what was fixed the same day
and what is still open.

The work it leaves is listed at the end, in the order it is worth doing.

## What it found that the goal had claimed otherwise

**The two sides do not run one core.** The broker links `libghostty-vt` 1.0 (`vt-1.0.0`, `0fa3d577a561`,
2026-11-06). The window's `ghostty-web` 0.4.0-next.21 builds its module from Ghostty `5714ed07a101`
(2025-12-01) with `patches/ghostty-wasm-api.patch`, a C API of that project's own. The broker's commit is 5,511
ahead. The goal's conformance run compared the new broker core with the broker's *previous* parser and never
with the window, which is the comparison the goal was for.

Fed the same bytes, the two put the cursor in different columns for 7 of 19 strings:

| string | broker | window |
|---|---|---|
| heart with an emoji selector, a keycap | column 2 | column 3 |
| family joined by zero-width joiners | 7 | 3 |
| flag, thumb with a skin tone | 5 | 3 |
| two Unicode 17 emoji (`U+1FAEA`, `U+1F6D8`) | 3 | 2 |

Two causes. The broker left grapheme clustering (mode 2027) off where the window's build has it on — **fixed**,
the broker now sets it and keeps it across a reset. And the window's Unicode tables are a year older, which
only moving the window's core fixes — **open**.

## Defects, each with what was measured

### Fixed on 2026-11-10

| defect | evidence | the fix |
|---|---|---|
| A program's question to the terminal was answered twice | the broker answers `CSI 6n`, `CSI 5n`, `CSI c` and `CSI > c`, and so does the window's core, whose answers leave through the keystroke channel; the two even disagree on `CSI > c` (`>1;0;0c` and `>1;10;0c`). Read in both code paths and probed in each core; not captured in the app | the pool drops what the emulator sends while it is being written to |
| A paste could run commands | the pinned emulator wraps pasted text in the bracketed-paste markers as it is, so text holding `ESC [ 201 ~` ended the bracket early (CVE-2026-26982's shape; upstream's fix is unmerged) | every paste goes through `pasteSafe`, taken in the capture phase before the emulator sees it |
| Closing a terminal corrupted the next | on one shared module instance, a terminal opened after another was closed started with the closed one's cells, on the first cycle; a run with mixed emoji then trapped with *memory access out of bounds* | one module instance per terminal |
| A stalled consumer grew the broker without bound | with nobody reading its socket and `yes` running: 104 MiB at 0.5 s, 555 MiB at 3 s | the reader's queue to the coalescer is bounded, so the pty fills and the program blocks |
| Nothing bounded what the app sent on to a window | read in the code: output is broadcast and nothing acknowledged it | each output carries a position, a window answers with how far it has drawn, and the session is paused past a high mark |
| A keystroke's echo was held | median 8.8 ms, p90 18.2 ms, over 300 keystrokes: a free-running 16 ms window | the window is measured from the last flush, so a quiet session's bytes leave at once |
| The window kept a fraction of the promised scrollback | the emulator's option is bytes and was passed lines: 550–1,138 lines at 80 columns, 257–552 at 160, 198–434 at 200, against 1,000 | 4 KiB a line, which keeps at least 1,091 at 250 columns |
| The broker offered what the window cannot draw | it answered a Kitty image query `OK`, and palette entry 1 as Ghostty's red rather than the theme's | images are off; a session is started with the theme's colours and told the size of a cell |
| A bare line feed meant different things on the two sides | `convertEol` rewrote it to CR LF in the window only: `ab\ncd` left the cursor at column 5 in the broker and 3 in the window | the option is gone |
| The scroll hold misfired when history was dropped | the emulator drops a page at a time, so the scrollback shrinks across such a write and the difference went negative. Reasoned from the measured page behaviour and reproduced in the pool's spec; not reproduced in the app | `viewAfterWrite` counts the lines added from the output when the scrollback shrank |
| A hidden terminal went on painting | the emulator's frame loop runs from open to dispose whether or not its canvas is in the document | the pool stops it on detach and starts it on attach |
| Text reads split wrapped lines and truncated characters | a row was read as one line and a cell as its first code point | a screen read marks wrapped rows and reads every code point; a search joins wrapped rows |
| A text wait rescanned the whole history on every read | `Until::Text` searched 1,000 lines per pty read while outstanding | it scans the rows the read could have added |

### Still open

- **The window's core is not the broker's.** See above; the Unicode 17 widths still differ.
- **Nothing reads the broker's screen.** `screen`, `search` and `wait` have no caller in the app, so a window
  that reloads, a second window and a reloaded frontend start blank while the broker holds the history.
- **Drawing is a 2D canvas, and its read of the screen is quadratic.** The migration dropped xterm's WebGL
  renderer. The emulator's painter copies the whole viewport out of the core once per changed row: 0.64 ms a
  scrolling frame at 80×24, 6.3 ms at 200×50, 15.7 ms at 250×70, before any glyph is drawn. Upstream has an
  unmerged fix.
- **There is no throughput baseline.** `terminal-output`'s corpus is 64 KiB. The window's core parses 40–70 MiB/s
  in Node, so the ceiling is elsewhere and has not been found.
- **Output and input are text.** Bytes that are not UTF-8 are replaced before they reach the window, and input
  cannot carry them. This was a measured decision (`Event::Output` in the broker's `protocol.rs`: base64 is
  larger than JSON for real output) and the review listed it as a defect without having read that. It is left
  as it is; what it costs is non-UTF-8 output and legacy mouse reports, and it should be reopened only with a
  case that needs them.
- **The clipboard is read by a scanner in the window.** The core has a callback for it, and for the title, the
  bell, notifications and progress.
- **`ghostty-web` is a prerelease whose upstream has stalled**: one commit since July 2026, its core unmoved
  since December 2025, more than forty open pull requests, among them fixes for five of the defects above.

## What is left, in order

1. **A test that the broker and the window agree**, over a corpus, in the chain. It is the test the goal lacked.
2. **Restore a window from the broker's screen.** The 1.0 core can write a stream that recreates a screen in
   another terminal.
3. **Push shell facts as events** rather than asking after every chunk that holds an OSC.
4. **Move the clipboard, title and bell to the broker's callbacks** and delete `takeClipboardWrites`.
5. **Own the emulator.** `apack-terminal-view` is a clone of `ghostty-web` for this: take upstream's open fixes,
   then move it onto upstream's signed 1.0 WebAssembly build, which is what makes the two sides one core.
6. **A throughput benchmark and an in-app latency measure**, with baselines.
7. Larger, and each a decision of its own: a record per command for agents and the UI; the window pulling
   frames instead of parsing bytes; a direct channel between the window and the broker; sessions that are
   saved and can be rewound; a broker that runs remotely.
