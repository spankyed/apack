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

## What this does not establish

- **Real-window behaviour.** The write path is proven at the bridge and the handler with stubs. No run of the Electron app
  has copied a program's text with the app unfocused.


- **OSC 52 in the app.** The broker reports the write. The window drops it when no window has focus
  (`writeClipboard`, `packages/default-setup/src/features/code/fe/features/terminal/state.ts`). That is Phase 1's
  defect, and the check above stops at the broker's event.
- **Auto-scroll and the wheel in a real window.** Both are proven with the view's source double. No run of the
  Electron app has exercised them yet.
- **The kitty flag's end-to-end coverage for every key.** One key, Escape, is checked under the flag and without it.
