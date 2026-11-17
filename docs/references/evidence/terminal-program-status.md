# Evidence: a terminal's program status (OSC 7501)

Checkpoint log for [the program status goal](../../goals/goal-terminal-program-status.md). Each phase adds a
section with its date, what was run, what it showed and what was not verified.

## Phase 0. What the two agents send (2026-11-17)

### Method

`.apack/probe-7501/probe.py` (ignored, not committed) starts `/bin/zsh -f -i` in a pty of 140 by 45, types
the agent's command, and plays a list of steps: wait, type text, press a key. It answers the support query
`ESC ] 7501 ; ? ST` with
`ESC ] 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ST`, and the other
queries a full-screen program asks at start. It records the body of every OSC 7501 sequence in order, and
at each one the arguments of the pty's foreground process group leader (`tcgetpgrp`, then
`ps -axo pid=,pgid=,args=`). The shell is started with every `CLAUDE*` and `ANTHROPIC*` variable removed, so
an agent runs as it does in a terminal a person opened. The working directory was
`.apack/probe-7501/work`.

Versions: Codex `codex-cli 0.167.0`, Claude Code `2.1.326`, macOS, Node 24.16.0.

Model calls spent: three one-line prompts to Codex. None to Claude Code, which is signed out on this
machine (`claude auth status` answers `"loggedIn": false`).

### Codex 0.167.0

Codex asks no support query and reports unasked. Every report carries `app=codex` and nothing else but
`kind`. No `msg`, `title`, `progress` or `id`.

| Case | What it sent, in order |
|---|---|
| Start, no prompt | `idle`, `working`, `idle` |
| A prompt answered with no tool (`Reply with the single word ok.`) | `working`, `done`, and `idle` at the next key press |
| A prompt whose command the sandbox refused outright | `working`, `done`. No `blocked`: the default sandbox failed the command without asking |
| With `-s read-only -a on-request`, a prompt to create a file | `working`, then `blocked:kind=permission` while the approval dialog showed |
| That request denied with Esc | `working`, `idle`. A denied turn does not report `done` |
| Exit (Ctrl-C twice) | `clear` |

The first prompt of the first run was typed into an update dialog Codex showed at start and was not sent
as a turn. Codex was not updated: `codex --version` answered 0.167.0 afterwards.

The foreground group leader at every report was the native binary, run as
`…/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`, alone in its group. The Node
wrapper `codex.js` is not the leader. At the final `clear` the leader was already gone or shown as
`(codex)`.

### Claude Code 2.1.326

Claude Code asks first: `ESC ] 7501 ; ?` about 2.5 s after start. Answered, it reports with
`app=claude-code`. What it does when the query goes unanswered was not run. One run made with the desktop
session's `CLAUDE*` variables still set sent no query and no report at all, which is why the probe
removes them.

| Case | What it sent, in order |
|---|---|
| Start, no prompt | the query, then `idle` |
| A prompt typed while signed out (`hi`) | `working`, then `blocked:kind=auth` with `msg` decoding to `Login reached its time limit · Please run /login` |
| The `/login` dialog opened and cancelled | nothing further |
| Exit (Ctrl-C twice) | `working`, then `clear` |

The foreground group leader at every report was run as `claude`, with up to nine other processes in its
group.

**Not observed:** a completed turn, `done`, `error`, `blocked` with `kind=permission` or `kind=question`,
`progress`, `title`, or an `id`. Each needs the standalone `claude` signed in. The goal continues without
them: the broker keeps whatever the protocol allows, and what Claude Code was seen to send is in its
fixture.

### What is run under another name than it reports

| Reported `app` | Leader's `argv[0]` basename | Rule |
|---|---|---|
| `codex` | `codex` | equal |
| `claude-code` | `claude` | alias `claude-code` → `claude` |

So Decision D5's table starts with that one alias. Neither agent is led by an interpreter as installed
here; the interpreter rule is kept for a tool run as `node <script>`.

### Fixtures

In `apack-terminal`, `tests/fixtures/program-status/`: `codex-0.167.0.txt` (15 sequences: the turns run,
then the approval run) and `claude-code-2.1.326.txt` (6 sequences), one sequence body per line, with a
README. They hold OSC 7501 sequences only.

### What the probe left behind

- `.apack/probe-7501/` in the main checkout: the script, its JSON output and an empty `work` directory.
- Three Codex sessions and four Claude Code starts recorded in each agent's own history for that
  directory.

### Corrections to the goal's Verified seams

The goal was surveyed at broker `db029f4`. Phase 1 was written at `2660f2f`, 71 commits later:

- The core's callbacks are registered in `src/vt/settings.rs` (`tell_reports`), not in
  `src/vt/mod.rs` `route_reports`.
- `src/vt/mod.rs`: `Reported` `:837`, `Effect` `:890`, `session_ended` `:1020`, `forget_the_shell` after
  it, `set_clock` `:1054`, `take_effects` `:1068`, `prompted` `:1198`, `ended` `:1209`, and `finished`
  after it, which is where every command ends, keyed or not.
- A replay ends in `forget_the_shell` (`src/screen.rs`, `rebuild` and `settle_restored`), which is where
  a rebuilt screen's records are dropped. No check on the replay clock is needed.
- `src/session.rs`: `holds` `:240`, `foreground_of` `:299`, the reader loop from `:1185`, the exit path
  from `:1284`, `summaries` `:1526`, `event_of` `:1642`.
- `src/protocol.rs`: `Until` `:431`, `Foreground` `:474`, `Event` `:499`, `Facts` `:607`,
  `SessionSummary` `:683`.
