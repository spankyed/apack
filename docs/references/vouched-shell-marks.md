# Vouched shell marks

How a terminal's command records are kept from being forged by what is printed into the terminal. The
broker's half is specified in its own repository (`apack-terminal`: `docs/architecture/design.md`,
`protocol.md`); this is the app's half and the contract between the two.

## What it is for

A shell tells the terminal where its commands begin and end by printing marks the terminal reads and does
not draw. The broker keeps a record per command from them: the line, the directory, how it ended, and the
rows its output is on. Anything that prints can print a mark — a file shown with `cat`, a log line, a
network response — so a record built from any mark read is a claim by whatever is running in the pty.

That is tolerable while a person is the only reader. It is not once a flow or an agent reads
`session.commands()` (`@apackdev/sdk/services/terminal.ts`) and acts on "the build passed".

**It stops forged content, not hostile code.** A program running as the user in that shell can find the
key: the hook unsets the environment variable so a child does not inherit it, but the shell's starting
environment is readable by the same user on Linux (`/proc/<pid>/environ`). Never describe this as a
boundary against local programs.

## The rules

1. **One mode per session, fixed when it is spawned.** The code feature mints a key (16 random bytes, hex)
   for every shell it arranges a hook for, puts it in the shell's environment as `APACK_MARKS_KEY`, and
   passes it to the broker in the spawn (`marksKey`). That session is **keyed**: its command records, and
   its answer to "is a command running", come only from marks that carry the key. A session spawned
   without one — a terminal on a target, a shell with integration switched off, `cmd` — is **claimed**:
   every mark is believed, and everything it reports is typed as a claim.
2. **Two keyed marks, each numbered.** A start (command N is beginning, here is its line) and a finish
   (command N ended, here is its status and directory). A finish closes only the start with its number.
3. **Numbers only go up.** The key appears in the terminal's own output, so a captured log or a session's
   recording printed back would otherwise forge marks. A mark whose number is not past the last accepted
   start is refused.
4. **Free text is last**, so nothing a command line or a path holds can sit where the number or the key
   is read from. The line and the directory are percent-encoded, every control character included, so
   none can end the sequence it is carried in.
5. **An unvouched status never has the type of a status.** A record's `outcome` is one tagged value
   (`CommandOutcome`): `running`, `exited` with a code, `unknown` with why (`no_status`, `superseded`,
   `session_ended`), or `claimed` with whatever status was claimed. `exited` is built only from a keyed
   finish. `commandSucceeded` answers `true` for `exited` with 0 and for nothing else.
6. **Refusals are counted.** `facts()` reports `vouched` and `refused`, so a hook out of step or a stream
   that forges is visible rather than looking like a shell that marks nothing.

## The marks

```
ESC ] 633 ; V ; S ; <seq> ; <key> ; <line> BEL
ESC ] 633 ; V ; F ; <seq> ; <key> ; <status> ; <cwd> BEL
```

The hooks (`packages/default-setup/src/features/code/be/services/shell-integration.ts`) go on printing
the standard prompt marks, OSC 133 and OSC 7: the terminal core flags prompt rows from them and a tab's
title follows the directory. In a keyed session the broker takes no record and no "idle" from them.

## What each shell does

| Shell | Start is printed | The line is |
|---|---|---|
| zsh | from `preexec`, for every line | the whole line |
| fish 3 and 4 | from its `fish_preexec` event | the whole line |
| PowerShell | from its wrapper around `PSConsoleHostReadLine`, which is what reads a line | the whole line |
| bash 4.4 and later | from `PS0`, for every line bash reads and runs | the whole line, from history, when history can vouch for it; empty otherwise |
| bash before 4.4 (macOS's `/bin/bash`) | from the `DEBUG` trap, before the line's first simple command | the whole line from history when it can vouch for it; the first simple command otherwise |
| `cmd` | never: it has no hook language | — (the session is claimed) |

Known limits, each stated where the hook is written:

- **bash, a line history did not keep.** A leading space under `ignorespace`, a `HISTIGNORE` match,
  history switched off — and, under `ignoreboth` (Debian's and Ubuntu's default), the last line entered
  again, which history cannot tell from a hidden one. The record, its number and its outcome are right;
  the line is empty on a bash with `PS0`.
- **bash before 4.4.** A line that is only a `( … )` is not marked, and one that begins with one is
  started when its first simple command outside it runs.
- **bash prints `PS0` to standard error**, so a shell whose standard error is not the terminal loses its
  starts.
- **PowerShell takes the key out of its environment after the user's profile has run**, so a program
  the profile starts inherits it. bash, zsh and fish take it out before the user's configuration is read.
- **A record's `cwd`** is where the shell was when the command ended in a keyed session, which is what a
  keyed finish carries, and where it began in a claimed one.
- **Nothing here has run on Windows** outside the broker's own CI, whose Windows job runs one keyed case
  through a ConPTY. The PowerShell hook was run on Linux.

## Where it is proven

- The broker's suite: properties over generated input (bytes that do not hold the key change no record;
  the session's own stream fed again changes nothing), and cases against the real binary.
- `packages/default-setup/tests/features/code/be/services/shell-marks.spec.ts` runs bash and zsh for
  real: every keyed mark carries the key and the next number, a command's child has no key in its
  environment, and the fields are where the grammar says for a line holding `;`, the mark's own text, or
  control characters.
- `terminal-vouches-for-its-marks.spec.ts`: the code feature mints a key where it arranges a hook and
  none where it does not.
- fish and PowerShell run by hand in containers, and the built app driven with a forged finish:
  [evidence](../goals/evidence/terminal-view.md).
