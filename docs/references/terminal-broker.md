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

**The broker is the only thing that interprets a program's bytes.** A window draws a terminal and
interprets nothing: it is sent the rows that changed, as characters with their styles, and paints them
(`apack-terminal-view`, a third sibling checkout). There is one copy of the screen, so there is nothing for
two copies to disagree about — the cursor a program is told about is the cursor that is drawn, and a
question a program asks the terminal is answered once, by the broker, however many windows are showing it.

**A terminal answers what a program asks it, and the broker is what answers.** ConPTY's first act is a
cursor-position request (`ESC [ 6 n`) and it waits for the reply before initialising — so on Windows a
session nobody answers never starts. The broker's core computes those replies — collected through
`libghostty-vt`'s write-to-pty callback — and the reader thread writes them back. A POSIX pty asks nothing,
which is why this was invisible until the suite first ran on Windows.

**The broker is told what the window looks like, because it answers for it.** A session is started with the
colours it is drawn in (`Spawn.colors`, from `be/terminal-colors.ts`) and a resize carries the size of one
cell in pixels, so a program asking the terminal for its background or its size hears the window's. Until a
window has measured a cell a size in pixels is not answered at all. Grapheme clustering (mode 2027) is on,
and the Kitty image protocol is on for a session a window draws (`Spawn.images`) and off for any other,
so a program asking whether it may send an image is told yes only where something would draw it.

**A shell's exit is waited for, not inferred from its output ending.** A POSIX pty gives EOF on the master
when the last slave closes; a ConPTY does not, because the broker still holds the pseudoconsole. The exit is
the one signal both platforms give, and waiting on it still polls nothing. A session whose shell has gone is
forgotten as its exit is reported, so a later write is refused by code rather than reaching a dead handle.

## How a window draws a terminal

A window opens **its own connection to the broker** and greets as a `view`. Its preload opens the socket
(`packages/preload`), main says where the socket is and what to greet it with, and a pack is handed the
byte stream by `terminalViews()` (`@apackdev/sdk/fe`). The API process is not on this path: a terminal's
rows and its keys cross no process but the broker and the window.

After the greeting the connection is length-prefixed binary (`src/view/wire.rs` in the broker,
`src/broker/wire.ts` in the view). Its two halves are in two repositories and meet in a file of vectors
the broker writes from its encoder; `packages/repo-checks/tests/terminal-view-vectors.spec.ts` holds the
two copies to being one file at the commits pinned here.

- **A frame is what changed since the frame that view last drew**, and the next is sent only once the
  last was acknowledged. A window that stops drawing — hidden, busy, gone — is sent nothing and costs
  nothing; a fast program is drawn at the rate the window paints, not at the rate it prints.
- **Lines are numbered absolutely.** History is fetched by line when a view scrolls to it, so a window
  holds the rows it has been shown and nothing else, and a hundred thousand lines of history cost a window
  nothing until it looks.
- **Input is encoded by the broker.** A view sends the key, the pointer event or the paste as it happened,
  and the broker's core turns it into bytes by the modes the program actually set. A paste that could run
  a command is refused until the person has seen it.
- **Selection, search and links are asked of the broker** — the word at a cell, the text of a range, where
  a string appears — because the core's rules for them are the ones every other terminal built on it has.
- **What a program does that is not on its screen is an event** on the control connection: a title, a
  bell, a clipboard write, a notification, progress, and each command the shell marks (OSC 133, OSC 633).
  The pack's shell integration arranges for zsh, bash and fish to mark them.

## What outlasts a shell

- **A recording.** A session opened with `record` writes what its program printed to a file — the bytes,
  each resize, and every megabyte the screen written out whole. A session opened with `restore` begins
  with everything that file holds, which is how a terminal comes back with its screen after its shell is
  replaced or the app restarts; `Rewind` opens the file as a session with no process, which a window draws
  like any other and seeks through. The pack records exactly where it restores terminals, in the app's
  data directory, in a file only the user can read, and removes it when the terminal is closed.
- **The shell itself, where asked.** `Keep` marks a session to outlive the app's hold on the broker. The
  broker then stays for as long as it has one, and the next start finds it with `Sessions` and takes it up
  again.

## A terminal somewhere else

`apack-terminal proxy <socket>` is a process's stdin and stdout as a connection to the broker on that
socket, starting one if there is none. Run under `ssh host` or `docker exec -i`, it is a connection to a
broker on another machine or in a container.

The app puts **a socket of its own in front of such a command** (`@apackdev/host`'s `broker/relay.ts`):
each connection to it is one run of the command. So the app's client and a window's own connection reach
a remote broker exactly as they reach the local one, and a remote terminal needs no second client and no
second protocol. `services.terminal.at({ command })` is the same service for that broker; a session says
which broker it is on (`TerminalSession.target`), and a window asks for its stream by that. A window can
be pointed only at a socket the app made for a target.

The code feature names targets in its settings (`terminalTargets`) and opens a terminal on one from the
panel's menu. Nothing of this machine's is asked of the far side — no shell, directory, startup file or
recording — so a terminal on a target has no command marks unless its own shell emits them, and is not
recorded. The broker's binary has to be installed there; nothing puts it there.

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

**The window bounds how often a busy session sends, not how soon a quiet one does.** It is measured from the
last flush, so the first bytes after a pause leave at once — a keystroke's echo is not held — and an idle
session waits on its reader and no timer.

A flush that had to wait reports `Throttled` with the microseconds it waited. It is a wait and not a loss: the
reader hands its chunks to the coalescer over a queue of eight (`READ_AHEAD`), so when credit runs out that
queue fills, the reader stops reading the pty, the pty's own buffer fills and the process blocks on its
write. Every byte still arrives, and the broker holds almost none of them.

**This channel is for a caller that reads a program's bytes** — a flow driving a CLI, a tool. A terminal
a person looks at is opened without it (`Spawn.output: false`): its screen reaches a window as frames, each
sent only when the last was drawn, so there is no stream to bound and nothing for the API to hold.

## Stopping one session, and signalling one program

**A pack never holds a pty**, and the three things that used to need one are requests now: `pause`/`resume`
on a session, `signal` to its process, its group or one pid inside its tree, and an `exit` that says whether
a code or a signal ended it. The reason to know this is the mistake it prevents — a feature that needs any
of the three reaches for `node-pty`, which puts a pty back in the API process and takes the Electron-ABI
rebuild with it. `findNodePtyImports` refuses that in pack sources, and these are what make the refusal
something a caller can comply with.

- **`pause` is a second class of flow control**, not the credit that bounds the channel. Credit bounds how
  much output is in flight for every session at once, because one connection carries them all — so reading
  that connection more slowly stalls every terminal in the app to slow one down. A pause stops one session
  being read, and the bytes stay in the kernel's pty buffer: it fills, the program blocks on its own write,
  and nothing accumulates anywhere. Two things follow and are the contract: the chunk a read already
  outstanding returns still arrives (as it does for `node-pty`'s `pause()`), and a paused session's screen
  stops being fed, so a `screen`, a `facts` and a `text` wait describe it as it was. An exit is unaffected.
- **A pause does not outlive the client that asked for one.** The connection leaving resumes everything,
  because the next client never asked and has no way to find out.
- **`signal` is for driving a particular program**, where `terminate` ends a session and its whole tree.
  `group` is `kill(-pid)` and no more: a shell with job control puts each background job in a group of its
  own, so a group signal does not reach one. A pid outside the session's tree is refused
  (`OUTSIDE_SESSION`), which is what makes naming one safe to offer at all — a pid is a number any caller
  can produce. POSIX only: Windows answers `UNSUPPORTED` rather than approximating signals.
- **An exit is a code or a signal, never both.** `portable-pty` reports a killed child as code 1 with the
  system's description of the signal, so a shutdown the app asked for and a crash were the same `1`. The
  signal travels by name, inverted from that description against the same `strsignal` in the broker's own
  process, because the description is prose written for a person and translated.

## A question is a request, not a signal that happens to be refused

`owns` asks whether a pid is inside a session's tree, answered by the same walk the `pid` scope's refusal
uses — so what a caller reads and what it would have been refused cannot disagree.

**It exists because a signal is an act.** A caller that wanted the answer rather than the effect had nothing
to ask, so it reached for the act, or walked the parent chain itself with `/bin/ps`. The second is the worse
of the two: a separate implementation of the broker's own invariant, free to disagree with it, and off POSIX
it finds no `ps`, answers *not owned* for everything, and refuses every claim without saying why.

**What needs it is a claim nobody can check from outside**: a process says *"I am yours, pid N"* over a
socket of its own, where the pid is whatever it chose to write, and admitting it is an authorization
decision about a tree the broker owns. **The pid is the correlation**, not the session — a caller admitting
several claims has more than one outstanding, and an answer taken for another pid's is one admitted or
refused wrongly. Windows refuses with a code rather than answering `false`, the job-object route being
unwritten until it can be claimed on that platform.

## A spawn can keep a name out of its child

A session inherits the broker's environment, and `env` adds to it — so `unset` is the only way to make a
name *absent*. An owner starting the user's shell wants the inheritance; one starting a particular program
often wants the opposite, and what it is usually subtracting is a credential: a CLI that found the app's own
API key would authenticate as the app rather than as whoever the user signed in as.

**This is the half of a `node-pty` spawn that does not survive being ported naively.** `pty.spawn(…, {env})`
*replaces* a child's environment, so deleting a name from the object deleted it from the child; `open`'s
`env` adds, and a delete there removes nothing. `unset` is applied after `env`, so absence is what an owner
gets when it asks for both.

## The socket

**A name, and its spelling differs by platform.** On POSIX it is a Unix socket in a 0700 directory under the
system temporary directory, named for a hash of the data dir — one broker per data dir. It is not in the data
dir, and the reason is a hard limit: `sockaddr_un.sun_path` holds 104 bytes on macOS, and a data dir under a
long home directory, a synced folder or a long profile name is longer than that. A path that still does not
fit is refused naming the limit.

On Windows it is a named pipe, `\\.\pipe\apack-terminal-<hash>`, because the transport refuses a
filesystem path there outright. The hash is the same one and does the same job: a pipe name is one flat
namespace for the machine, so it is what keeps one app's broker apart from another's.

**A 0700 directory is the POSIX half of who may connect, and a pipe has no such answer.** The default
descriptor a Windows pipe gets grants read access to Everyone, so the broker creates its listener with one
of its own — the starting account and `SYSTEM`, in a protected DACL — and refuses to listen rather than
fall back if it cannot be built. The broker owns that decision and has read it back off a live pipe:
`docs/architecture/windows-pipe-access.md` in its repository.

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

## Who holds a session, and what a broker's death costs

**A session outlives the client that opened it, and dies with whoever owns the broker.** A connection greets
as one of two roles. A `client` operates sessions — opens them, writes to them, reads their screen — and
leaving does not end them. A `lifetime` connection asks for nothing and is sent nothing; it exists so that the
sessions end when the app does. Electron main holds that one, because it is the only process whose lifetime is
the app's: a descriptor closes on process death however the process died, so a crash or a kill reaps the
shells exactly as a clean quit does, and there is no path that has to remember to. With no owner connected the
broker falls back to ending its sessions when the last client leaves, which is what stops a dev run or a test
leaving a shell behind.

A client that comes back takes a surviving session up by its id (`adopt`) and reads what it missed from the
broker's own screen, rather than from anything a window kept.

**When the broker dies, every session dies with it, and the app is told so.** A pty dies with the process that
owns it, so the connection closing is the news: the client reports every session it held as exited without a
status — the shape a single shell's death already arrives in — and the window keeps the terminal and labels
its transcript. The service then forgets that broker, so the next session starts a fresh one through the lazy
start; there is no supervisor beside it. A start that keeps failing is tried three times against one binary
and then refused with what the broker itself said, and rebuilding the binary is what earns a fresh budget.

A client that chooses to leave is the opposite case and is recorded rather than inferred, so quitting the app
draws no crash notice in any of its terminals.

## What submits a line

Not the same on both platforms, and measured rather than assumed. Typed into a Windows console, `\n` is
echoed and never runs, `\r` alone does not get that far, and `\r\n` both echoes and runs. A POSIX pty's
line discipline takes `\n`. The app carries the answer on a session's descriptor, because a window cannot
know which shell is on the other end.

## What is not there yet

- **The app on Windows.** The broker's own suite passes there in full — 12 of 12, on a Windows VM on
  2026-11-07 — and so does the parser's. What has not been done there is launching the Electron app itself.
  See the [Windows development VM guide](guides/windows-development-vm.md).
- **The channel's bounds on Windows.** `tests/channel.rs` is POSIX-only: its cases need a shell that produces
  a megabyte as fast as the pty takes it, which Windows has no one-liner for. The coalescing and the credit
  are the broker's own code and platform-independent; how much output it takes to fill a *named pipe*, which
  the bound's arithmetic includes, is not.
- **A packaged build ships no broker.** The binary is resolved from `APACK_TERMINAL_BINARY` or the linked
  checkout's debug build. Per-platform builds and their signing belong with the composition that ships it.
