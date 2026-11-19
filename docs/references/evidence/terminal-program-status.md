# Evidence: a terminal's program status (OSC 7501)

Checkpoint log for [the program status goal](../../archive/goals/goal-terminal-program-status.md). Each phase adds a
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

## Phase 1. The broker (2026-11-17)

`apack-terminal`, branch `feat/program-status`: `a78236f` and `7209375`, merged as `b367539`
([spankyed/apack-terminal#57](https://github.com/spankyed/apack-terminal/pull/57)). Release
`bin-b367539c88595320507d6a9f4592b3a7d18b1031` is published with its `SHA256SUMS`.

- **What landed:** `src/status.rs` (the records and their rules), the core's `PROGRAM_STATUS` callback
  (`src/vt/settings.rs`, `src/vt/mod.rs`), `Event::ProgramStatus`, `StatusRecord`, `statuses` on `Facts`
  and `SessionSummary`, `Until::Status`, the check against the foreground group leader (`front_of`,
  `src/session.rs`), `tests/status.rs`, three cases in `tests/broker.rs`, the fuzz target `status`, and
  `docs/architecture/protocol.md`.
- **Suite:** `cargo test --test suite`, 599 passed before the second commit's two added assertions.
- **Pull request checks:** 18 of 18 passed, the Windows and Linux suites among them.
- **`cargo xtask pre-push`:** passed in 803 s. Of the change's 85 mutants, 67 were caught and 18 do not
  compile.
- **The first pass found three survivors, and each was a defect in the change, not in the gate:**
  - `Screen::statuses_stirred` and `Records::stirred` answering `true`. Asking whether the records had
    changed without taking it could not be told from always answering yes; the only difference was a
    process lookup on every read. The reader now takes the change where it notices it
    (`take_statuses_stirred`) and then tells the records (`tell_statuses`), and a case holds each answer.
  - `&&` as `||` in `confirmed`. An alias was read as either half of its pair, so `claude` in front
    confirmed a record naming `codex`. A case holds it.
- **No test broker was left running** after either mutation run (`ps` for the mutants' build directory).
- **One decision made while writing it:** a replayed recording needs no check on the replay clock. Both
  replay paths end in `forget_the_shell`, which now drops the records with what the shell said.
- **Not changed:** `fuzz/Cargo.lock` is one dependency behind the root lockfile on `master`, from a change
  before this one. `cargo check --locked` in `fuzz/` fails for that reason; without `--locked` the targets
  compile. Left for its own change.

## Phase 2. The pin, the host and the SDK (2026-11-17)

Monorepo branch `session/terminal-program-status`: `de083926a2` (host and SDK) and `b9eea77dc4` (the pin,
`b367539`).

- `npm run pin:apack-terminal -- b367539c88595320507d6a9f4592b3a7d18b1031` wrote the pin and fetched and
  verified the macOS build. The binary's hash moved on all three platforms, since the binary did.
- `packages/apack-host/tests/broker/program-status.spec.ts`, against the pinned release build with no
  override: 3 passed. A report a shell prints arrives as the event, `facts()` and `sessions()` answer the
  same records, a second client that adopts the session reads them, and a wait for a status is met.
- `npm run api:update`: `services.api.md` gained `ProgramStatusRecord`, the `programStatus` event and
  `statuses` on `TerminalFacts` and `TerminalSessionSummary`, and nothing else.
- `npm run typecheck`: all checks passed.
- The link in this worktree points at the broker worktree `program-status`, which holds the pin. The main
  broker checkout was detached at the previous pin by other work and was left as it was.

## Phase 3. The Code feature (2026-11-17)

`9220a73e58`, and `dad36ae161` for a defect the real app showed.

- `tests/features/code/be/terminal-says-what-its-programs-are-doing.spec.ts`: 11 passed. The set told
  whole and carried in the list; text without invisible formatting; the seen mark written and not
  repeated; kept after the shell goes and dropped for the next one; an adopted terminal starting from its
  summary and its mark; a mark for another session read as nothing seen; the repository check when a
  record leaves `working`; the flow event per state entered; none for a `mismatched` record; a flow that
  listens running; no error with none listening.
- `tests/features/code/fe/features/terminal/terminal-status.frontend.spec.ts`: 16 passed.
- `npm run facade:update -w @app/default-setup`: the report gained the two events, `TerminalStatus`, the
  row's seen mark, `statuses` on `TerminalInfo`, the setting and `recordStatusSeen`, and nothing else.
- **Two changes from the goal as written, both narrower than a decision:**
  - A window says the person looked when what waits is `blocked` as well as `done` or `error`. Otherwise a
    window that had raised a notification for a blocked terminal had no way to learn the person looked at
    it in another window.
  - The frontend spec found the notify-once rule broken as first written: a program going blocked, then
    working, then blocked was told twice. Only looking at the terminal re-arms the notification now.
- **A defect that predates this goal, fixed because Phase 4 could not pass without it:** `Tabs.vue` draws a
  tab's label in four places and only one drew the terminal's badge, so in three layouts no terminal badge
  of any kind showed. All four draw it now.

## Phase 4. The real app (2026-11-17)

`npm run dev:drive -- drive/terminal-program-status.ts` on the built app at `dad36ae161`, with the pinned
release broker and no override: passed in 51 s. The script is under the ignored `drive/`, and its
screenshots and report are in `.apack/drive/`, neither committed.

A reporter (`sh -c`, which is the program in front while it runs and names itself) printed each state five
seconds apart in one terminal; a second terminal's `sh -c` printed a record naming `codex`.

| Condition | Result |
|---|---|
| Each badge is drawn | `working`, `blocked` with `permission`, `question` and `auth`, `error`, `done`: each held by the window as `matched` and screenshotted. The tabs' marks read `done` and, faint, `blocked` |
| A record naming another program | `mismatched`, drawn faint, with the tooltip saying a program other than the one in front reported it |
| A second window shows the same | the code surface popped out: `done`, unseen |
| A window reload keeps them | `done` after `reload()` |
| Restarting the API brings the same set back | the API process was killed (pid 60227) and main restarted it (pid 71183): `done`, still unseen |
| Looking clears its badge in both windows | `seen` in the main window and in the popped-out one |
| Codex shows its idle status | `codex` typed into a terminal, no prompt: `idle`, `app=codex`, `matched` |

**What the first runs taught, which is the protocol working:** a shell's own `printf` reports and is gone
in the same read, since a program's records go with its command. A status is only ever seen from a
program that keeps running.

## Closing (2026-11-17 to 2026-11-19)

Source: `session/terminal-program-status`
([spankyed/apack#533](https://github.com/spankyed/apack/pull/533)). The branch was merged with `master` twice
while closing: `5e11427c03`, which took `master`'s packaging change and elmdb pin, and `0725fbca4a`, which
took `master`'s broker pin, `3b538ca`. That pin is a later commit of the broker's `master` and contains
`b367539`; the protocol module and the generated types are the same at both.

### The strict runs: passed

`gh workflow run ci.yml --ref session/terminal-program-status -f strict_chain=true`:

| Run | Source | Result |
|---|---|---|
| [44158508186](https://github.com/spankyed/apack/actions/runs/44158508186) | `4fde23efdc`, before either merge | All six jobs passed. The app half passed on its second attempt |
| [44563012157](https://github.com/spankyed/apack/actions/runs/44563012157) | `5e11427c03`, the first merge | All six jobs passed on the first attempt |
| [44574494019](https://github.com/spankyed/apack/actions/runs/44574494019) | `8a303d0e9d`, the second merge and the closure | All six jobs passed on the first attempt |

The six jobs are producers, both integration shards, both native shards, and the app half with the remaining
checks.

In the first run's app half, one e2e spec of 52 failed on the first attempt,
`tests/e2e/ui/settings-help.spec.ts:53`, on a 10-second wait for a surface to be selected. It does not touch
a terminal, and passed unchanged when the job was run again. Its cause was not diagnosed.

Two earlier dispatches were cancelled because they were on commits before a fix.

### The second merge, checked alone

`0725fbca4a` differs from the source of the second strict run by the broker pin only. Against the pinned
release build of `3b538ca`, on the development machine:

- `packages/apack-host/tests/broker/program-status.spec.ts`, which starts a real broker: 3 of 3.
- `tests/e2e/app-integration/terminal-view.spec.ts` and `surface-sends.spec.ts`: 10 of 10.

### The local chain: not passed in one run

`npm run chain` was run eleven times on this branch and never passed whole. Runs 1 to 6 were on the source
before the first merge, runs 7 to 11 on `5e11427c03`. What each stopped at:

| Run | Stopped at | Cause |
|---|---|---|
| 1 | `test:e2e`, 2 of 52 | Whole-test timeouts in `db-write-through-boot` and `settings-recovery`. Both passed alone, in 19 s and 7 s. Every step before e2e had passed |
| 2 | `test:unit:host` | **A defect, fixed** (`49df58fb43`): the packaged app left out the broker's license files, and the resolver answers no binary without them |
| 3 | `test:integration` | `spec-durations-reporter.integration.spec.ts`, a CPU-measurement case. Passed alone three times of three |
| 4, 5 | `test:unit:pack` | **Caused by this change, fixed** (`4fde23efdc`): every test passed, and the new backend spec sat in the pool's slow tail, which moved the tail's edge past a spec marked `@slow`. Split into two specs |
| 6 | `test:integration` | Not diagnosed. Stopped by hand |
| 7 | `test:e2e`, 3 of 52 | `surface-sends.spec.ts:116` on a 30-second poll for a pack reload, and `terminal-view.spec.ts:79` and `:143` on waits for a program's output. Both files passed alone, 10 of 10 |
| 8, 9 | `test:unit:pack` | The `@slow:` marker gate, with all 1752 tests passing. `harness-app-stop.spec.ts` and `send-to-system-diagnostics.spec.ts`, neither changed here, read below the pool's p90, which was 9.1 s and then 10.6 s. Run 10 passed this step unchanged once `npm run check:idle` passed |
| 10 | `test:native` | Docker was not running, so the step exited at once |
| 11 | `test:e2e`, 1 of 52, and `test:native`, 1 of 79 | `surface-sends.spec.ts:116` again: the app's log shows the reload taking 40 s, against 2 s when the file is run alone. And `frontend-resources-watch.native.spec.ts`, "watches initially empty external Tailwind content through nested directory links", on a build deadline after the step had run 100 minutes in the container; the step reported its process tree waiting on storage for 95 s. That case was not run alone |

The machine was the limit for the runs that were not defects. On 2026-11-17 its load average read between 30
and 260 on ten cores, most of it macOS file indexing (`fseventsd`, `mds_stores`,
`StorageManagementService`), and it slept during one run. On 2026-11-19 it read between 30 and 80, from other
work running on the machine.

So the goal's closing condition "`npm run chain` passes on the final source" is **not met**. Every step of
the chain has passed on this branch in some run, and the strict runs passed all of them; neither is the
single local pass the condition asks for. The goal was closed on the strict run by the lead developer's
decision on 2026-11-19, with this recorded.

### What the closing runs found beyond the goal

- **The packaged app would have had no terminal**: it left out the broker's license files, and the resolver
  answers no binary without them. `49df58fb43` fixed that here; `master` fixed it too, by shipping every
  license file, and the first merge took `master`'s `electron-builder.mjs` and `packaged-app-files.spec.ts`
  in place of this branch's.
- **`packaged-app-files.spec.ts` passed in run 1 and failed in run 2 with nothing about it changed.** Its
  population was what the install put in `packages/terminal-broker/bin`, which no step's fingerprint covered,
  so the host pool had kept an earlier result. Whether `master`'s version of the spec has the same gap was
  not checked.
- **Two checks fail under load alone**: the pack pool's `@slow:` marker gate, whose bar is the run's own p90
  and so rises with the slowest files while a spec that mostly waits stays where it was, and the 30-second
  poll on a pack reload in `surface-sends.spec.ts`. Neither was changed here.
