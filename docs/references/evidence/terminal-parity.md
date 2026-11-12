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

## What this does not establish

- **OSC 52 in the app.** The broker reports the write. The window drops it when no window has focus
  (`writeClipboard`, `packages/default-setup/src/features/code/fe/features/terminal/state.ts`). That is Phase 1's
  defect, and the check above stops at the broker's event.
- **Auto-scroll and the wheel in a real window.** Both are proven with the view's source double. No run of the
  Electron app has exercised them yet.
- **The kitty flag's end-to-end coverage for every key.** One key, Escape, is checked under the flag and without it.
