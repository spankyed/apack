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

**A terminal answers what a program asks it, and the broker is what answers.** ConPTY's first act is a
cursor-position request (`ESC [ 6 n`) and it waits for the reply before initialising — so on Windows a
session nobody answers never starts. In the app xterm.js replies, which would make a terminal with a window
work and one without never start: exactly the independence the broker exists for, false. `alacritty_terminal`
computes those replies and the reader thread writes them back. A POSIX pty asks nothing, which is why this
was invisible until the suite first ran on Windows.

**A shell's exit is waited for, not inferred from its output ending.** A POSIX pty gives EOF on the master
when the last slave closes; a ConPTY does not, because the broker still holds the pseudoconsole. The exit is
the one signal both platforms give, and waiting on it still polls nothing. A session whose shell has gone is
forgotten as its exit is reported, so a later write is refused by code rather than reaching a dead handle.

## The protocol

Rust is the source of truth, and the TypeScript is generated from it with ts-rs — **inside the npm package
the broker ships**, at `node/protocol.ts` there, where `cargo xtask check-generated` holds it to the Rust.
`client.ts` imports those types from `apack-terminal` like any dependency's.

This repository kept a copy of that file instead, with a script that re-derived and compared it and a
typecheck leg to run the comparison. All three are gone. The copy existed because nothing resolved through
the `vendor/apack-terminal` link, and the check could not fail where it mattered: CI never linked a
checkout, so it printed *not derived here* and passed — a gate that reports nothing because it looked at
nothing. The package resolves through the link now, so there is one file and nothing watching a second.

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

**A name, and its spelling differs by platform.** On POSIX it is a Unix socket in a 0700 directory under the
system temporary directory, named for a hash of the data dir — one broker per data dir. It is not in the data
dir, and the reason is a hard limit: `sockaddr_un.sun_path` holds 104 bytes on macOS, and a data dir under a
long home directory, a synced folder or a long profile name is longer than that. A path that still does not
fit is refused naming the limit.

On Windows it is a named pipe, `\\.\pipe\apack-terminal-<hash>`, because the transport refuses a
filesystem path there outright. The hash is the same one and does the same job: a pipe name is one flat
namespace for the machine, so it is what keeps one app's broker apart from another's.

## Owning a process tree

On POSIX, killing a session's shell makes the kernel send SIGHUP to the pty's foreground process group, which
takes the grandchildren with it — demonstrated rather than assumed, including with the pty master held open,
so it is the session leader's death that carries it.

Windows has no equivalent, which is what X1 and X2 are about. A Job Object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is held for the session's lifetime, so the kill *is* the close: the OS
ends every process in the job when the last handle goes, and a `kill`, a client disconnecting and a broker
that crashes all reap the tree by one mechanism rather than three paths remembering to walk it.

**`command-group` is not what does it.** It wraps `std::process::Command`, and `portable-pty` spawns the
child itself, so there is no `Command` to wrap; the job is assigned to the pid afterwards instead.

## What submits a line

Not the same on both platforms, and measured rather than assumed. Typed into a Windows console, `\n` is
echoed and never runs, `\r` alone does not get that far, and `\r\n` both echoes and runs. A POSIX pty's
line discipline takes `\n`. The app carries the answer on a session's descriptor, because a window cannot
know which shell is on the other end.

## What is not there yet

- **A session does not outlive its client.** The broker ends a connection's sessions when the connection
  closes, which is the backstop for an app that quits, crashes or is killed — a pack's `onShutdown` is
  synchronous and runs in `process.on('exit')`, where no socket write completes. Surviving a client, attach
  and detach, and reattach belong to the host session service.
- **One connection at a time.** A second client is the same piece of work.
- **The app on Windows.** The broker's own suite passes there in full — 12 of 12, on a Windows VM on
  2026-11-07 — and so does the parser's. What has not been done there is launching the Electron app itself.
  See the [Windows development VM guide](guides/windows-development-vm.md).
- **The channel's bounds on Windows.** `tests/channel.rs` is POSIX-only: its cases need a shell that produces
  a megabyte as fast as the pty takes it, which Windows has no one-liner for. The coalescing and the credit
  are the broker's own code and platform-independent; how much output it takes to fill a *named pipe*, which
  the bound's arithmetic includes, is not.
- **A packaged build ships no broker.** The binary is resolved from `APACK_TERMINAL_BINARY` or the linked
  checkout's debug build. Per-platform builds, their signing and crash-restart belong with the composition
  that ships it.
