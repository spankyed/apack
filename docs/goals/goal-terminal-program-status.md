# Goal: a terminal's program says what it is doing, and the app listens (OSC 7501)

**Status: planned, 2026-11-16.** Nothing is started. Owners: the terminal broker (`spankyed/apack-terminal`),
the host's broker client and terminal service (`packages/apack-host`), the SDK's terminal contract
(`packages/apack-sdk`) and the Code feature (`packages/default-setup/src/features/code`).
[The second goal](goal-needs-you.md) builds on Phases 1 to 3 of this one.

Written so that an implementer who did not write it can finish it. Every seam is named with a file and a line,
read at the commits under Verified seams. Re-read each before editing.

## Prompt

````text
# Goal: a terminal's program status (OSC 7501) reaches the app, which shows it and acts on it

Implement docs/goals/goal-terminal-program-status.md. Follow CLAUDE.md and docs/AGENTS.md, and in the
broker repository its own CLAUDE.md and docs/architecture/testing.md.
Read Scope, Decisions, Phases, Constraints and Current handoff before continuing.
The survey was made at monorepo c7d4ec6ce5 and apack-terminal db029f4; inspect current code before
relying on it. Follow the current checkout arrangement and preserve unrelated work.

Work the phases in order. A phase is finished when its Done-when conditions hold on current source.
Each phase ends with evidence written to docs/references/evidence/terminal-program-status.md.

Finished when:
- Every phase's Done-when holds on current source, with source commits and evidence recorded.
- The final validation under Closing passes.
- docs/references/terminal-broker.md and the broker's docs/architecture/protocol.md describe the contract.
- Outcome is written, the goal is archived, links are repaired and the closure is committed.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
````

## Why

A terminal tab cannot say whether the agent inside it is working, finished or waiting on the person. The
app knows that only for agents a flow runs, which report through a structured stream. For an agent a
person starts by hand in a tab there has been nothing but the screen.

OSC 7501, the Program Status Protocol, is that missing report. A program writes
`ESC ] 7501 ; state=blocked:kind=permission:app=codex ST` to its own terminal. The specification is at
<https://www.superlogical.com/rex/docs/build/program-status>, revision 0.4 of 2026-10-10.

What was established on 2026-11-16:

- **Codex sends it today, unasked.** Codex 0.167.0, run in a captured pty with no prompt typed, sent
  `state=idle:app=codex`, `state=working:app=codex`, `state=idle:app=codex`. Its source
  (`codex-rs/tui/src/terminal_program_status.rs`) also sends `blocked` with `kind=permission`, `question`
  or `auth`, `done`, `error`, and `clear` on exit, suspend and hand-off.
- **Claude Code asks first.** The 2.1.323 binary holds `probe: no reply to OSC 7501 ; ?` and
  `probe: OSC 7501 reply`. What it sends once answered is unobserved, which is Phase 0.
- **The broker's VT core already reads it.** `ghostty-vt-rs-sys` 0.3.0 has `TerminalOption::PROGRAM_STATUS`
  and a callback type; the broker does not set it, so every report is dropped and no support query is
  answered.

## Scope

In:

- The broker keeps each session's status records by the specification's rules, answers the support
  query, and reports the records to its clients.
- The host and the SDK carry them to a pack as an event, in `facts()` and in a session's summary.
- The Code feature shows them on a terminal's tab, tells the person when a terminal needs them, checks
  the repository when an agent's turn ends in a terminal, and raises a flow event.

Out:

- **One list across terminals and threads, the dock badge, a jump hotkey.** That is
  [the second goal](goal-needs-you.md).
- **Answering a blocked program from outside its terminal.** The app never types for the person
  (Decision D7).
- **Reading an agent's state off its screen.** A program that sends no reports has no status here. The
  screen-rule design stays in [the deferred target](../deferred/terminal-runtime-refactor-target.md).
- **The app's own commands sending reports** (`npm run chain`, `apack pack build`). Wanted, and not in
  this goal: a command run as `npm run chain` has `npm` in front, so its records would fail the check
  in Decision D5 until that rule learns npm scripts. Open it as its own change after this goal closes.
- **Private keys or states.** A gap in the protocol, such as an interrupted turn, is proposed upstream.
- **Status in recordings.** A rewind shows the screen.
- Any change to `PROTOCOL_VERSION`, which stays 1.

## Verified seams

Broker, at `db029f40babcf8435111f0a4ca70bf63be8a580f`:

- **Where the core's reports are registered:** `src/vt/mod.rs:421` `route_reports`. The reply path is
  `WRITE_PTY` at `:432` (`collect_reply`, `:1178`); the prompt callback is `SEMANTIC_PROMPT` at `:440`;
  the table of effect callbacks is `:460-490`, with `PROGRESS_REPORT` at `:479` and `note_progress` at
  `:1394` as the nearest model.
- **Effects:** `Effect` at `src/vt/mod.rs:828`. `take_effects` at `:1006` keeps only the last title and
  the last progress report of a read. `event_of` at `src/session.rs:1638` turns an effect into an event.
- **When a command ends:** `prompted` at `src/vt/mod.rs:1136` and `ended` at `:1147`. A keyed session
  ignores the unkeyed marks for everything but the directory (`apply`, `:1071-1080`). `session_ended` is
  `:958`, called from the exit path at `src/session.rs:1294-1300`.
- **Replay:** `Reported::set_clock` (`src/vt/mod.rs:992`) holds a time while recorded bytes are parsed;
  `src/screen.rs:952` sets it and `:977` clears it. Confirm that a rewind (`src/session.rs:1564`) and a
  restored session both parse through there.
- **The reader loop:** `src/session.rs:1204-1234` feeds, takes replies and effects, settles waits and
  sends events.
- **Foreground:** `foreground_of` at `src/session.rs:300` reads the process group leader's name with
  `sysinfo`, and answers `None` on Windows. `Foreground` is `src/protocol.rs:461`.
- **Protocol:** `Request` `:57`, `Until` `:418`, `Event` `:486`, `Facts` `:594`, `Event::Progress` `:653`,
  `SessionSummary` `:670`. A wait is checked in `holds`, `src/session.rs:241`.
- **The core's types:** `~/.cargo/registry/src/*/ghostty-vt-rs-sys-0.3.0/src/bindings.rs`:
  `ProgramStatusState` `:2696`, `ProgramStatusKind` `:2716`, `TerminalProgramStatus` `:2735`,
  `TerminalProgramStatusFn` and the record rules it leaves to the embedder `:2760`,
  `TerminalOption::PROGRAM_STATUS` `:3063`.
- **Tests and fuzzing:** `tests/effects.rs` covers the existing effects; `fuzz/fuzz_targets/` has five
  targets.

Monorepo, at `c7d4ec6ce5`:

- **Host client:** `packages/apack-host/src/broker/client.ts`: `BrokerSessionSummary` `:267`, the event
  type `:298`, the mapping `:313`, `wait` `:239`.
- **Host service:** `packages/apack-host/src/services/terminal.ts:285` maps `facts`; `adopt` `:432`,
  `sessions` `:436`.
- **SDK contract:** `packages/apack-sdk/src/services/terminal.ts`: `TerminalEvent` `:74`,
  `TerminalFacts` `:117`, `TerminalSession` `:197`, `TerminalSessionSummary` `:331`. It exposes no `wait`.
- **Code feature, backend:** `packages/default-setup/src/features/code/be/features/terminal.ts`: the news
  types `:58`, `onEvent` `:102`, the repository check a finished command sends `:106`, the progress case
  `:128`, the list answer `:207`. `be/services/terminal.ts`: `list` `:648`, `updateCwd` `:832`, the adopt
  path `:978`. `be/types.ts:319` `TerminalInfo`. `be/repository/index.ts:10` `TerminalEntity`.
  `be/contract.ts:355` `terminal.PROGRESS`.
- **Code feature, frontend:** `fe/features/terminal/state.ts`: `TerminalActivity` `:61`, the event `:138`,
  the system notification a program asks for `:472`, the bell's notification `:484-499`, the reducer
  `:522-531`. `TerminalActivityBadge.vue` draws a tab's badge; `TerminalTabBadge.vue` feeds it.
- **Notifications:** `packages/preload/src/index.ts:62` `notify.show(title, body, tag)`;
  `packages/main/src/modules/notify-access.ts:54` shows a tag once per minute.
- **Settings:** `packages/default-setup/apack.json:661` `bellNotification`, the nearest model.
- **Flow events:** a system fires one with
  `sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType, payload })`, as
  `be/features/commit.ts:843` does.
- **Who checks the repository at a turn's end today:** only the flow actions
  `src/content/actions/claude-code/turn-completed.ts:66` and `codex/turn-completed.ts:36`.
- **The backend terminal double:** `packages/default-setup/tests/features/code/be/_support/terminal-broker.ts`.

## Decisions

- **D0. Phase 0 may spend model calls.** Up to five one-line prompts to each of Claude Code and Codex, on
  the owner's accounts. No other phase needs any.
- **D1. The protocol as written.** Revision 0.4. The VT core validates and decodes each report; the broker
  implements only the record rules the core leaves to the embedder.
- **D2. The broker owns the records, and is the only place their rules live.** Per session:
  - one record per `id`, and a report replaces its record whole;
  - `clear` removes a record and every record beneath it, and all of them with no `id`;
  - a record with no `app` is sent with its nearest ancestor's;
  - at most 256, removing the one updated longest ago;
  - when the session's command ends, `working`, `blocked` and `idle` records are removed and `done` and
    `error` are kept. "Ends" is the moment `ended` runs: the prompt in a session with no key, the keyed
    finish in a session with one. A prompt mark anything can print removes nothing in a keyed session.
  - when the session ends, the same removal, and what is left is sent before the exit;
  - a full reset arrives from the core as a `clear`.
- **D3. The whole set, on every change.** `Event::ProgramStatus { session, statuses }` carries every
  record of the session as it stands, at most once per read. Nothing downstream merges, and no consumer
  re-implements D2. `Facts` and `SessionSummary` carry the same set.
- **D4. A record on the wire:**

  ```rust
  pub struct StatusRecord {
      pub id: String,                 // "" is the program itself
      pub state: StatusState,         // Idle | Working | Blocked | Done | Error
      pub kind: Option<BlockedKind>,  // Permission | Question | Auth; only when Blocked
      pub progress: Option<u8>,
      pub app: Option<String>,        // after inheritance
      pub title: Option<String>,
      pub message: Option<String>,
      pub changed: u32,               // per session, moved by every accepted report
      pub since_ms: u64,              // when this record entered its state; unchanged by a report that keeps it
      pub confirmed: Confirmed,       // Matched | Mismatched | Unknown
  }
  ```

  `changed` is what "has the person seen this" is compared on. `since_ms` is for display and ordering
  only and decides nothing.
- **D5. A record is checked against the program in front.** Any program in a terminal can print a report
  naming another. When a read changes the records, the broker reads the foreground process group's
  leader once and stamps the records that read accepted:
  - `Matched`: the leader's `argv[0]` basename, without `.exe`, equals the record's `app` or an alias of
    it. When that basename is an interpreter (`node`, `bun`, `deno`, `python`, `python3`), the basename of
    its first script argument, without its extension, is compared instead. Case is ignored.
  - `Mismatched`: a leader was read and it is not that.
  - `Unknown`: the record has no `app`, no leader could be read, or the platform has no foreground group
    (Windows).

  The aliases are data in one broker module, starting with `claude-code` → `claude`. Phase 0 measures the
  leader's argv for both agents as installed, and the table is set from that before Phase 1 merges.
  `Foreground` on the wire does not change. The cost is stated: an agent started through an unusual
  wrapper reads `Mismatched`, keeps its tab badge and loses its notification.
- **D6. What the person has seen is the app's to know.** The broker has no acknowledge request. The Code
  feature keeps `statusSeen: { session, changed }` on the terminal's row. A `done` or `error` record is
  unseen while its `changed` is past that mark for the same session. The mark moves when the person looks
  at the terminal: its tab is the active one in a focused window.
- **D7. A record is a claim, shown and never acted on.** Nothing is typed into a terminal. `title` and
  `message` are plain text, with invisible formatting characters removed before they leave the backend.
- **D8. One notification per terminal until it is looked at.** A system notification is raised when a
  record that is not `Mismatched` enters `blocked`, `done` or `error`, the setting is on, and the window
  is not focused. After one is raised for a terminal, none is raised for it again until D6's mark moves.
  It names the terminal first: `<terminal title> — <app>`, then what it needs. It goes through the
  existing `notify.show` with a tag, so several windows raise one.
- **D9. A turn ending is a hint and an event.** When any record leaves `working`, the backend sends
  `CHECK_FOR_EXTERNAL_CHANGES`, as a finished command does. When a record that is not `Mismatched`
  changes state, it fires the flow event `terminal.status` with
  `{ terminalId, id, app, state, kind, previous }`.
- **D10. A wait can name a status.** `Until::Status { states }` is met while the session's root record is
  in one of `states`. Its first callers are this goal's own broker tests; the SDK still exposes no wait,
  and a pack follows status through the event.
- **D11. Recorded bytes report nothing.** While a recording is replayed, for a rewind or a restored
  session, a report creates no record and a support query gets no reply.
- **D12. Restart keeps them.** A session the service adopts starts with the statuses its summary carries.
  A terminal given a new session starts with none. A terminal whose shell has gone keeps the last set it
  was sent until it is closed.

## Phases

### Phase 0. What the two agents send

Run each agent in a pty that answers the support query with
`ESC ] 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ST`, and record
only the OSC 7501 sequences, in order, with the foreground group leader's argv at each
(`ps -o pid,pgid,args`). Cases per agent: start with no prompt; a one-line prompt that needs no tool; a
prompt that asks to run a shell command under the default permission mode, then deny it; exit. Record
each agent's version. Put the probe script under the ignored `.apack/`.

Deliverables: the sequences and argvs in the evidence record, and one fixture per agent in the broker
repository, `tests/fixtures/program-status/<agent>-<version>.txt`, one sequence per line. A fixture
holds 7501 sequences only, never screen bytes.

Done when: both fixtures exist; the evidence says, for each agent, which states and kinds it sent and
whether it asked first; D5's alias table is written down from the measured argvs. If Claude Code sends
nothing even when answered, the goal continues and the evidence says so.

### Phase 1. The broker

In a worktree of `apack-terminal`, on a branch with a pull request.

- A `src/status.rs` holding the records and D2's rules as plain data, tested without a pty.
- `route_reports` sets `PROGRAM_STATUS`; the callback copies the report's strings, which are valid only
  for the call, and applies it. `take_effects` adds at most one status effect per read, carrying the set.
- `ended` and `session_ended` apply D2's removal. Replay applies D11.
- The reader loop does D5's lookup once for a read that changed the records.
- `src/protocol.rs` gains `Event::ProgramStatus`, `StatusRecord`, `StatusState`, `BlockedKind`,
  `Confirmed`, `statuses` on `Facts` and `SessionSummary`, and `Until::Status`. The generated
  `node/protocol.ts` follows.
- Tests, through a screen fed bytes, as `tests/effects.rs` does:
  - every rule of D2, including a forged prompt mark in a keyed session removing nothing;
  - the support query's reply bytes;
  - each Phase 0 fixture ending in the set the evidence says it should;
  - a replayed recording creating no record and no reply;
  - `Until::Status` met, timed out and ended by exit;
  - facts and the summary carrying the set;
  - on Unix, a real session whose program reports its own name reading `Matched` and another name
    reading `Mismatched`.
- A fuzz target over arbitrary bytes that holds the store to its invariants: never more than 256
  records, none `working`, `blocked` or `idle` after an end.
- `docs/architecture/protocol.md` and the broker's CLAUDE.md describe the addition.

Done when: `cargo xtask pre-push` passes; the pull request's checks pass, the Windows job included; it is
merged; and the release `bin-<merge commit>` is published with its `SHA256SUMS`.

### Phase 2. The pin, the host and the SDK

On a monorepo branch from `npm run session:new -- terminal-program-status`.

- `npm run pin:apack-terminal -- <merge commit>`, check the broker checkout out at it, and
  `npm run link:apack-terminal`.
- The host client maps the event, the summary and the wait; the host service maps `facts`.
- The SDK gains `ProgramStatusRecord`, the `programStatus` case of `TerminalEvent` carrying `statuses`,
  and `statuses` on `TerminalFacts` and `TerminalSessionSummary`. Run `npm run api:update` and read the
  diff.
- The backend terminal double learns the event and the summary's statuses.
- A host spec against the real broker (`packages/apack-host/tests/broker/client.spec.ts` is the model):
  a session whose shell prints a report gives the event, the facts and the summary; a second client that
  adopts the session after the first leaves reads the same set.

Done when: that spec passes, `npm run typecheck` passes, and the API reports are committed.

### Phase 3. The Code feature

Backend:

- `be/services/terminal.ts` holds each terminal's set beside its `cwd`, by D12.
- `onEvent` gains the `programStatus` case: store the set, broadcast
  `terminal.STATUS { terminalId, statuses, seen }` as news, and do D9.
- `TerminalInfo` carries `statuses` and `statusSeen`, so the list a window already fetches starts it
  with both.
- `terminal.STATUS_SEEN { terminalId }` from a window writes D6's mark on the row and broadcasts the
  news again.
- One function makes `title` and `message` plain, by D7.
- The setting `terminalStatusNotification`, default on, in `apack.json` and `fe/settings.vue`.
- After the contract's events change: `npm run generate:entries -w @app/default-setup`, then
  `npm run facade:update -w @app/default-setup`, and read the diff.

Frontend:

- `TerminalActivity` gains the record to show: the most urgent of `blocked`, unseen `error`, unseen
  `done`, `working`, `idle`.
- `TerminalActivityBadge.vue` draws it, with `data-terminal-status` and `data-terminal-status-kind` for
  tests. Its tooltip gives the app, the title, the message and how long it has been in that state. A
  `Mismatched` record is drawn muted, and its tooltip says a program other than the one in front
  reported it.
- Looking at a terminal that holds an unseen `done` or `error` sends `terminal.STATUS_SEEN`.
- The notification, by D8.

Tests, placed to mirror the source they cover:

- backend: the set stored and broadcast; a list answer carrying it; the seen mark written, and reset by
  a new session; an adopted terminal starting with its summary's set; a record leaving `working`
  sending the repository check; the flow event fired for a `Matched` and an `Unknown` record and not for
  a `Mismatched` one; a title holding a direction override arriving without it.
- a flow with a listener on `terminal.status` runs when the event fires, and with no listener nothing
  is reported as an error.
- frontend (`*.frontend.spec.ts`): each state's badge; the muted one; the notification raised once, not
  raised while focused, not raised for `Mismatched`, and not raised again until the terminal is looked
  at.

Done when: those pass and `npm run spec` passes for the change.

### Phase 4. The real app

A script under `drive/` opens a terminal and has its shell print reports naming the shell itself, so
they read `Matched`: `working`, `blocked` with each kind, `done`, `error`.

Done when, recorded with screenshots from `.apack/drive/screenshots/`:

- each badge is drawn;
- a second window shows the same;
- a window reload keeps them;
- restarting the API with the terminal kept brings the same set back;
- looking at a `done` terminal clears its badge in both windows;
- Codex started in a terminal, with no prompt typed, shows its idle status.

## Closing

- `npm run chain` passes on the final source, and one strict run is dispatched for it:
  `gh workflow run ci.yml --ref <branch> -f strict_chain=true`.
- [The broker reference](../references/terminal-broker.md) describes statuses: the record, who owns the
  rules, the check against the program in front, and that a record is a claim.
- The pull request is opened ready for review.

## Constraints

- Standing rules are the two repositories' CLAUDE.md files; this list adds only what is particular here.
- `PROTOCOL_VERSION` stays 1. Every addition is additive.
- The view that draws a terminal does not change. A status is not drawn in the terminal.
- No timer decides anything about a status. `since_ms` is shown and sorted on, never compared to decide.
- A fixture never holds screen bytes from an agent's session.

## Current handoff

- **Source:** nothing started. Monorepo `master` at `c7d4ec6ce5`; broker `master` at `db029f4`, which the
  app pins.
- **Next:** Phase 0.
- **Proven:** the facts under Why, on 2026-11-16.
- **Unresolved:** what Claude Code sends.
