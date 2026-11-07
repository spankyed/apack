# The terminal broker

A terminal's process is owned by `apack-terminal`, a Rust process outside the app's API process. A pack asks
`services.terminal` for a session; nothing in a pack, and nothing in the API, holds a pty.

The broker lives in a sibling checkout, linked as `vendor/apack-terminal` and pinned by
`vendor/apack-terminal.rev`. Run `npm run link:apack-terminal` to make the link; the linker refuses a
checkout that is not one and one that does not hold the pin.

## Why it is a separate process

Three things, stated precisely because a fourth is routinely offered and is not one of them:

- **Native process-tree ownership.** Job Objects are the mechanism on Windows and no JS binding supplies
  them. This is what a terminal needs to kill the tree a command left behind.
- **A lifetime that is not the API's.** An addon in the API process dies with it. A broker does not, which is
  what makes a session surviving a reload or a restart possible at all.
- **ABI independence.** A standalone binary does not care about Electron's Node, which removes the last
  native module needing an `electron-rebuild`.

**Not** off-loop VT parsing: `worker_threads` already keeps compiler work off a loop in this repo, so that
is a benefit of leaving the API process rather than a reason to choose a language.

## Two layers

| Layer | What it owns | Where |
|---|---|---|
| the process layer | spawn, the pty, the lifetime, the bounded coalesced output channel. Nothing here knows what a screen is | `src/session.rs`, `src/output.rs` |
| the terminal capability | the VT core, the cursor, which screen is showing, a bounded run of lines above the viewport | `src/screen.rs` |

The second layer exists because a session's state must not depend on a window being alive to hold it: a
session nobody is drawing still has a screen, and `Request::Screen` answers it.

**Both the broker and the renderer parse the same bytes, and only one is right.** The renderer keeps xterm.js
because it owns interaction — selection, reflow, IME — and nothing in the app may read that copy as a fact.
The broker is the authority and is fed before the bytes leave for the renderer, which is the only direction in
which a disagreement is merely stale rather than wrong.

## The protocol

Rust is the source of truth; `protocol/protocol.ts` is generated from it with ts-rs and committed in both
repositories. On this side it is a **recorded file**: `npm run protocol:check` re-derives it by asking ts-rs
to generate the declarations again from the linked checkout and compares, and `npm run protocol:update`
writes it. The check runs as part of `npm run typecheck`.

It is a typecheck leg rather than a chain step because its source is a gitignored, machine-specific symlink —
there is nothing in this repository for the chain's graph to order it against. On a machine with no checkout
linked it says so on its result line and passes; a checkout that has wandered off the pin is refused, naming
both commits.

Newline-delimited JSON, because the first consumer is a Node client and a debuggable frame is worth more than
a compact one. Every connection's first message is `hello` with a protocol number; anything else is refused
with `HANDSHAKE`, and nothing can be asked before it. That is what makes a stale pin a clear refusal rather
than a strange bug.

## Bounded output

Output is coalesced per session on a 16 ms window — one frame at 60 Hz — or a 64 KiB cap, and is bounded by
credit: 64 coalesced messages may be in flight, and a flush waits when none is free. **Answers carry no
credit**, so a reply to a query the terminal made is never held behind a megabyte of output.

A flush that had to wait reports `Throttled` with the microseconds it waited. It is a wait and not a loss: the
pty's own buffer fills behind it and the process feels it, so every byte still arrives.

The budget this buys is derived rather than chosen: a message leaves when the window closes or the cap fills,
so a run of a given length cannot produce more than one per window plus one per cap. Measured in the app over
the same corpus either side of the change: **64 KiB of output was 115 messages and is 6**.

## The socket

A 0700 directory under the system temporary directory, named for a hash of the data dir — one broker per data
dir. It is not in the data dir, and the reason is a hard limit: `sockaddr_un.sun_path` holds 104 bytes on
macOS, and a data dir under a long home directory, a synced folder or a long profile name is longer than
that. A path that still does not fit is refused naming the limit.

## What is not there yet

- **A session does not outlive its client.** The broker ends a connection's sessions when the connection
  closes, which is the backstop for an app that quits, crashes or is killed — a pack's `onShutdown` is
  synchronous and runs in `process.on('exit')`, where no socket write completes. Surviving a client, attach
  and detach, and reattach belong to the host session service.
- **One connection at a time.** A second client is the same piece of work.
- **Windows.** `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and ConPTY's resize and exit are claimed on a Windows run
  or not at all; see the [Windows development VM guide](guides/windows-development-vm.md).
- **A packaged build ships no broker.** The binary is resolved from `APACK_TERMINAL_BINARY` or the linked
  checkout's debug build. Per-platform builds, their signing and crash-restart belong with the composition
  that ships it.
