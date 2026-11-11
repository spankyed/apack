# A nonce on the marks a shell reports its commands with

Status: deferred by request, 2026-11-11. Options laid out, none chosen, nothing started. Resume when
something acts on a command's recorded exit status or output without a person looking at it — that is the
condition, and it is checked rather than assumed (see *When to resume*).

## Context

A shell tells the terminal where its commands begin and end by printing marks the terminal reads and does
not draw: OSC 133 (`A` a prompt, `C` a command's output begins, `D;<status>` it ended), OSC 633's `E`
(the command line) and OSC 7 or `633;P;Cwd=` (the directory). The code feature's hooks arrange for bash,
zsh, fish and PowerShell to print them (`packages/default-setup/src/features/code/be/services/shell-integration.ts`),
and the broker turns them into command records: a line, a directory, two times, an exit status, and the
rows its output is on (`apack-terminal`: `src/markers.rs`, `Reported` in `src/vt/mod.rs`, `src/commands.rs`).

**The broker believes any mark it reads, and anything that prints can print one.** `cat` of a crafted
file, a `curl` response, a log line or a commit message containing `ESC ] 133 ; D ; 0 BEL` ends the
running command's record with a status of zero and cuts its recorded output short; one containing
`633;E;…` renames it. The broker's own documentation says so — a mark is a *claim* by whatever is running
in the pty, not a fact about the machine — and the window shows records as what the shell said.

What that costs depends on who reads a record:

- **A person**: a mark in the gutter in the wrong colour, or *Copy Last Command Output* copying less than
  was printed. Wrong, and visibly beside the output that caused it.
- **A flow or an agent** reading `session.commands()` and `session.commandOutput()`
  (`@apackdev/sdk/services/terminal.ts`): a failed build recorded as passed, with nothing to compare it
  against. This is the case the nonce is for.

## What a nonce is, and what it stops

The app gives each session a random value when it starts the shell. The hook attaches it to the marks it
prints, and the broker takes a mark for a command record only when it carries the session's value. VS
Code's shell integration does this for `633;E`.

**It stops hostile content, not hostile code.** A program running as the user in that shell can find the
value: the hook can keep it in a shell variable and unset the environment variable so children do not
inherit it, but on Linux the shell's starting environment is still readable by the same user
(`/proc/<pid>/environ`). Printing something is the realistic way a mark is forged — a file, a network
response — and that is what a value the content cannot know closes. Say this where the feature is
described; a nonce presented as a security boundary against local programs would be a claim the design
does not make.

## The three ways to go

| | What carries the nonce | What a forged mark can still do | Size |
|---|---|---|---|
| **1. Every mark** | prompt, start, end and line, all as OSC 633 with the value | nothing to a command record | the whole of *Design* below |
| **2. The facts only** | the command line (`E`) and the end with its status (`D`) | split a record or move where its output begins; not fake a status or a line | about half: no change to how prompts and starts are read |
| **3. Leave it** | nothing | everything above | none; the documentation already says marks are claims |

Option 2 exists because of one complication in option 1, below. The choice between them is the first
thing to decide at resume.

## Design (option 1)

### The complication: the core reads OSC 133 itself

`libghostty-vt` parses OSC 133 natively and reports prompt starts, output starts and command ends through
its own callbacks, with no field for a nonce; fish 4 prints those marks itself, whatever hook is
installed. OSC 633 the core does not read, and hands over whole through its unknown-sequence callback,
which is where `markers.rs` reads it.

So a session with a nonce takes its command records from OSC 633 alone:

- The hooks print `633;A`, `633;B`, `633;C`, `633;D;<status>` and `633;E;<line>`, each with the value as
  a last field, and stop printing 133 for the moments they print 633 for. `markers.rs` already reads all
  five 633 kinds.
- `Reported` ignores the core's semantic-prompt callbacks **for command records** in such a session. The
  core still parses 133 — it cannot be told not to — and its own prompt marking on rows is left alone:
  what a view draws as a prompt row is not a command record.
- fish 4's native marks are therefore ignored for records, and the fish hook prints the 633 set on every
  version rather than only before 4.

A session started without a nonce — a target's shell with no hook, a shell the user configured themselves —
behaves as it does today: marks are claims, 133 and 633 both read.

### Broker (`apack-terminal`)

- `Request::Spawn` gains `marks_nonce: Option<String>`. `PROTOCOL_VERSION` stays 1.
- `markers::read` answers the nonce a mark carried beside the marker; `Reported` holds the session's and
  drops, for records, a mark that carries another or none. The directory (`P;Cwd=`, OSC 7) is a claim
  either way and is left unchecked: it moves a tab's title, not a record's status.
- The value is compared whole. It needs no constant-time comparison: it is not a credential, and the
  only thing that could time the comparison is the program already printing to that pty.
- Tests, against the real parser: a stream holding a forged `133;D;0`, `633;D;0` with no value and
  `633;D;0` with a wrong one leaves the running command running; the same marks with the value end it;
  a session with no nonce reads all of them as it does today.

### Hooks (`shell-integration.ts`)

- Each hook reads the value from an environment variable the session is started with, keeps it in a
  variable of its own, and unsets the environment variable so a child does not inherit it.
- bash, zsh, fish, PowerShell: every mark printed as 633 with the value. cmd has no hook language to do
  it in; its prompt string would carry the value in the clear on every prompt, which is the same
  exposure as any other shell's and is acceptable, or cmd is left without a nonce — decide when there.
- `shell-marks.spec.ts` runs bash and zsh for real and asserts the value is on every mark and absent
  from a child's environment; fish and PowerShell are run by hand in containers as they were on
  2026-11-11 ([evidence](../../goals/evidence/terminal-view.md)).

### App

- `services.terminal.open` gains the nonce among its options (`@apackdev/sdk/services/terminal.ts`,
  `api:update`), `@apackdev/host` passes it in the spawn, and the code feature mints one per session
  where it arranges a hook and passes none where it does not (a target, integration switched off).
- A restored or re-adopted session keeps the value the broker was given at its spawn; the app holds none
  after starting it and needs none.

## What option 2 changes

Only `633;E` and `633;D` carry the value, and only the line and the status are refused without it. 133 is
read as today, fish 4 keeps its own marks, and the hooks add a `633;D;<status>;<value>` beside the `133;D`
they already print. A forged `133;D` then still ends a record — with no status, which a reader has to
treat as *unknown* rather than *succeeded*. That reading has to be written down for whoever consumes
`exitStatus: null`, or the option buys less than it looks.

## When to resume

Check, do not assume: search for callers of `commands()` and `commandOutput()` outside the terminal
feature's own window code. On 2026-11-11 there were none — the SDK members exist and the only reader is a
person looking at the gutter. The first flow, action or agent integration that reads a command's status
or output and acts on it is the consumer that makes a forged mark cost something, and this work belongs
in or before that change.
