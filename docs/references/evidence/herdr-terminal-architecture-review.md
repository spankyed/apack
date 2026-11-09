# Herdr terminal architecture review

Date: 2026-11-07. Source: `/Users/spankyed/Develop/Projects/apack/herdr`, clean checkout at
`ee5bfb5041bb3e4a49d591c72308aae3c81ecdde`. apack baseline:
`b71d0033151008288e64d92d59020118171987a3`, with unrelated work in progress left untouched.

This is a source review, including implementation, characterization tests and relevant history. The
tests cited below were inspected, not executed. It establishes code contracts and architectural risks;
it does not establish live Claude/Codex detection accuracy or comparative performance. The resulting
design is [Terminal runtime refactor target](../../deferred/terminal-runtime-refactor-target.md).

## Findings that determine the recommendation

1. **Keeping an emulator alive across view mounts is already an apack capability.** Our
   `terminal-pool.ts` owns the emulator, detached wrapper, output subscription and replay boundary;
   `TerminalView.vue` attaches and detaches that wrapper. Herdr's additional capability is retaining a
   process and parsed terminal state in a server independent of its clients, with headless semantic
   reads and agent observations. Its pane/terminal separation is also still in transition.
2. **Agent observability is the most valuable product capability to adopt.** Herdr joins process
   identity, the parsed live screen, OSC metadata and integration reports into an effective agent
   state. It exposes explanations, waits and notifications, making many terminals manageable.
3. **Claude and Codex status is heuristic in this revision.** Their installed hooks report session
   identity only. No-match for a recognized agent becomes `Idle`; that is explicitly tested. We should
   adopt its observation pipeline while replacing that fallback and separating availability,
   completion, failure and attention.
4. **The best architectural investment is a session authority independent of presentation.** Rust is
   justified by native process ownership, a headless terminal core and a separate failure boundary.
   A Rust rewrite that retains UI-dependent state, unbounded queues and ambiguous status would miss
   the value.

## What the code actually separates

| Source at the reviewed revision | Observed contract | Implication for apack |
|---|---|---|
| [PaneState](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane/state.rs) | A pane refers to an opaque terminal ID; `seen` and right-click policy live on the pane | Keep session identity independent of tab/panel placement; read receipts belong to presentation |
| [TerminalRuntimeRegistry](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/terminal/runtime_registry.rs) | Live resources are outside pure app state, keyed by terminal ID | Separate process handles and tasks from serializable domain state |
| [TerminalRuntime](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/terminal/runtime.rs) | Delegates construction, render, input, history and detection to `pane::PaneRuntime`; signatures still accept `PaneId`, ratatui geometry and render signals | This is an improving boundary, not a finished UI-neutral terminal library to import wholesale |
| [TerminalState](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/terminal/state.rs) | Centralizes hook authority, fallback state, session identity, metadata and managed-agent startup | Copy the single arbitration point; avoid concentrating every agent concern in one large record |
| [AppState](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/app/state.rs) | Pure state still contains TUI palette, sidebar, modal, focus and runtime/session facts | Pure data is testable, but purity alone does not establish a clean server/client boundary |

The meaningful comparison is therefore **per-renderer persistence in apack versus server-owned terminal
authority in herdr**, not pooled versus unpooled emulators. Our pool already solves tab-remount lifetime;
it does not survive renderer loss or independently answer what a hidden agent is doing.

## Trace of Claude and Codex observation

### Agent identity comes before screen classification

`detect::detect_agent_with_osc` returns `Unknown` immediately when no agent is identified. The process
probe in `pane.rs::spawn_basic_detection_task` identifies the foreground job through platform process
inspection, rather than calling every prompt-like string Claude. `pane/background_agent.rs` retains an
exact agent process using PID plus a process start token when job control moves it into the background.
It distinguishes a suspended agent, an exited agent and a different process of the same agent kind.

This is worth adopting. It prevents a screen detector from claiming that `cat` printing a Claude
transcript is a live Claude session. It is still limited by wrappers, containers and remote processes;
an explicit launch identity is stronger than inference from an executable name.

Sources: [process/detection runtime](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane.rs),
[background agent tracking](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane/background_agent.rs).

### Detection reads the live bottom, independently of user scrolling

`GhosttyPaneTerminal::detection_text_for_cache` reaches `ghostty_detection_text_for_cache`, which reads
recent terminal text using the terminal's row count. The detector does not classify whatever viewport
the user happens to be reading. OSC 0/2 title and OSC 9 progress evidence are retained separately and
cleared when the foreground agent changes. Terminal state is parsed while no client is displaying it.

The polling task skips unchanged stable observations where its revision checks allow it. It also
avoids interpreting another foreground job's screen as the state of a background agent, and skips
screen arbitration while a supported full-lifecycle integration is authoritative. `DetectionTextCache`
checks revisions before and after extraction so an overlapping write does not validate a stale cache.

Sources: [terminal accessors and parsing](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane/terminal.rs),
[observation decisions and cache tests](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane/agent_detection.rs).

### The manifests describe recognizable UI evidence

The manifest engine compiles regexes, extracts named regions and evaluates explicit positive and
negative gates. The highest-priority matching rule wins; equal priority retains the earlier match.
Rules can mark transcript viewers as `skip_state_update`, preserving the prior state rather than
interpreting old conversation text as a new request for input. Validation bounds matcher/gate
complexity. Explain output includes the chosen rule, region, manifest version, fallback and evidence.

| Agent | Working evidence in the checked-in manifest | Attention evidence | Idle and ambiguity |
|---|---|---|---|
| Claude | Specific OSC-title spinner shapes; live activity/footer patterns; separate background-agent and background-MCP patterns | Approval/form footer controls, elicitation dialog shape and other constrained live UI regions | Prompt-box rule excludes approval controls; transcript-viewer rule skips updates; otherwise known-agent no-match falls back to idle |
| Codex | OSC-title spinner rule; elapsed-time/activity pattern before the current prompt; handling for queued inputs and a failed reconnect exclusion | `Action Required` title; trust/update dialogs; strong prompt/approval rules; weaker yes/no rules lower in priority | Nonempty title without working/attention evidence can mean idle; a transcript viewer skips updates; otherwise known-agent no-match falls back to idle |

A visible Codex composer is not treated as general turn completion: `codex_prompt_ready` is documented
and used as startup readiness evidence, since the composer can remain visible during a turn. That
distinction is useful and should survive our redesign.

Sources: [Claude rules](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/detect/manifests/claude.toml),
[Codex rules](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/detect/manifests/codex.toml),
[manifest engine](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/detect/manifest.rs).

### Hooks are not automatically lifecycle authority

Both `integration/assets/{claude,codex}/herdr-agent-state.sh` accept only the `session` action and send
`pane.report_agent_session`. Claude checks `SessionStart` and rejects subagent reports; Codex validates
session/transcript context. Their Windows scripts implement the corresponding integration. The
full-lifecycle allow-list in `detect/mod.rs::full_lifecycle_hook_authority` includes Pi, OMP,
MastraCode, OpenCode, Kilo and Kimi, **not Claude or Codex**.

The Claude installer explicitly removes previous working/blocked/idle hooks and installs a session
hook. History also shows Codex turn-status hooks added in `4b4705db`, then removed in `287da807`
(`fix: drop codex turn status hooks`). These facts do not prove all future lifecycle hooks are unusable;
they do disprove the claim that the current Claude/Codex badges are backed by authoritative hooks.

Sources: [Claude reporter](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/assets/claude/herdr-agent-state.sh),
[Codex reporter](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/assets/codex/herdr-agent-state.sh),
[Claude installer](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/integration/claude_settings.rs),
[authority classification](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/detect/mod.rs),
[Codex removal](https://github.com/herdrdev/herdr/commit/287da8072ff8363f406f5d8c4e52fd3227eea58e).

### Finished is inferred from a state transition

`AgentState` has `Idle`, `Working`, `Blocked` and `Unknown`. `app/actions.rs` recognizes a completion
transition when `Working` or `Blocked` becomes `Idle`, with acquisition/session-change suppression to
avoid some false initial completions. `app/agent_view.rs::status_name` displays idle plus unseen as
`done`. Notifications and completion sequence numbers are derived from those transitions.

This is a helpful attention workflow, but `done` is not a provider-reported successful outcome. A
canceled approval, an interrupted turn and a genuinely completed turn cannot be distinguished by
that four-state vocabulary alone. Process exit can also feed an idle observation. We should preserve
completion history and read receipts while representing outcome separately.

The most consequential fallback is explicit code, not an inferred defect:
`manifest.rs::fallback_explain` sets a recognized agent to `Idle`, with `visible_idle = false` and
`fallback_reason = default_known_agent_idle_fallback`. The test
`known_agent_no_match_defaults_to_idle_fallback` asserts it. `PendingIdleConfirmation` delays a
working-to-plain-idle observation using repeated checks and a cap; it does not turn absence of a match
into positive evidence. A changed CLI approval dialog could therefore appear idle after stabilization.

Sources: [state transitions and notifications](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/app/actions.rs),
[done presentation](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/app/agent_view.rs),
[fallback test](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/detect/manifest/tests.rs).

### Arbitration and explainability are worth taking

`TerminalState::recompute_effective_state` centralizes effective status. Full-lifecycle hook sources
have stronger authority; ordinary hook reports and screen blockers have conditional precedence.
Sequences, session references, process changes and suppression records stop old reports from taking
over a replacement session. `agent explain`, bounded terminal reads and event waits expose the model
to humans and automation instead of keeping it inside the renderer.

Our improvement should be a smaller typed evidence reducer with explicit epochs and source
capabilities. A report should say whether it knows identity, turn start, completion, approval or only
presentation. A hook with a session ID is not automatically authoritative about the whole lifecycle.

## Other strengths and their limits

### Terminal processing is independent of render demand

The PTY actor parses into a native terminal core and forwards generated replies. Hidden output still
updates terminal state. `RenderSignal` coalesces requests and retains source identity so the headless
server can avoid presentation work for sources hidden from all clients. Retained surfaces and dirty
row patches reduce redraw and fanout work. This separates mandatory parsing from optional frames.

The transport has distinct control, ordered and ordinary-render lanes. Ordinary render is one pending
slot, so a slow client does not create an unlimited frame backlog. Baselines advance through the
render stream machinery rather than assuming every prepared frame was delivered. These ideas apply
to Electron as well as a TUI.

**Limit:** `ClientWriterQueueState.control` is a `VecDeque` whose `send_control` appends without a byte
or item cap. The Windows PTY path has a bounded front input channel but an unbounded std-mpsc writer
channel behind it. The Unix actor also has pending write/control collections. Bounded admission at one
hop is not an end-to-end memory guarantee. Our design must account for every queue in bytes.

Sources: [render demand](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/render_signal.rs),
[client queues](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/client_transport.rs),
[render baselines](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/render_stream.rs),
[Unix I/O](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pty/actor/unix.rs),
[Windows I/O](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pty/actor.rs).

### Attach and observation have explicit roles

Client state distinguishes shell clients, terminal attach and terminal observe. Client-local focus,
surface-interest epochs and tab geometry controllers make competing client behavior explicit. In
particular, `resize_shell_tab_if_controller` refuses a resize from a client that does not control that
tab. This is stronger than our current last-window-to-fit behavior.

The cost is a complicated TUI/client projection boundary: shared tab topology, per-client locations,
foreground promotion, geometry ownership and presentation effects interact. apack needs one explicit
input/geometry controller per session and independent read-only viewers, without inheriting the whole
client-shell model.

Sources: [client state](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/clients.rs),
[geometry controllers](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/headless/client_views.rs),
[surface interest](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/headless/surface_interest.rs).

### Reattach and revive are separate operations

Detach leaves the server's PTYs alive. Cold restore creates fresh shells and can resume supported
agent sessions. Optional history is saved separately from layout. Atomic replacement writes and
syncs the temporary file before replacing it; recovery copies preserve prior data on failed saves.
This is much clearer than treating a saved PID as a process handle.

**Limit:** stored ANSI history is not a complete parser snapshot, as
`complete_history_replay_supports_plain_append` states in its own test. Unix live handoff transfers
PTY descriptors plus selected state and history; it has pause/commit/rollback machinery and a
non-Unix refusal. We should buy most of its benefit by keeping our broker alive across API/UI updates,
and accept an explicit broker maintenance restart before building cross-version descriptor handoff.

Sources: [restore](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/persist/restore.rs),
[atomic persistence](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/persist/io.rs),
[history characterization](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane/terminal/migration_tests.rs),
[handoff](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/headless/lifecycle.rs).

### Its tests encode difficult contracts

Useful examples include `processes_survive_during_and_after_detach`,
`detached_output_preserves_last_attached_pty_size`,
`same_tab_geometry_follows_meaningful_client_activity`,
`short_streams_are_invariant_at_every_byte_boundary`,
`incremental_rows_reconstruct_full_render`, and
`external_api_batches_preserve_fifo_and_leave_work_for_the_next_turn`. These target behavior across
failure and chunk boundaries, not only successful command execution.

Tests and profiling cover client loss, retained-surface deltas, metadata-only observers and pane
cardinality. However, the large process integration files inspected here include Unix-only gates;
their existence does not prove equivalent Windows coverage. Manifest-engine tests use synthetic rules,
not a compatibility corpus proving the checked-in Claude/Codex rules against real current CLIs.

Sources: [detach tests](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/tests/detach_reattach.rs),
[multiple clients](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/tests/multi_client.rs),
[event fairness](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/headless/tests/event_fairness.rs),
[scale profiling](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/server/render_scale_benchmark.rs).

## Parts to improve rather than copy

- **Session IDs and source epochs:** use them structurally to reject stale input and reports, instead
  of reproducing a growing set of agent-specific suppression cases in a large shared state object.
- **Shutdown:** `PaneRuntime::drop` performs synchronous staged termination with waits. Request and
  join asynchronous teardown explicitly; keep destructor cleanup as an emergency fallback.
- **Platform isolation:** platform modules exist, but `pane.rs`, `pane/terminal.rs` and the PTY actor
  still contain OS branches and policy. Put OS mechanisms behind narrow implementations and keep
  lifecycle/input policies shared and independently testable.
- **Security:** local socket permission restrictions are useful, but terminal output and hook
  identities remain untrusted. Do not copy payload logging such as the OSC debug evidence path or
  use inherited app credentials as a convenient CLI authentication mechanism.
- **Dependency ownership:** herdr ships its own `ghostty-vt` binding, vendored Ghostty source, local
  patches and a patched `portable-pty`. The patch index documents removal conditions and verification;
  adopt that maintenance discipline if needed, not the whole patch set.
- **Wait APIs:** `api/wait.rs` polls reads through the app dispatcher. Prefer revision-triggered bounded
  subscriptions; preserve deadlines, cancellation and explicit history-loss errors.
- **Product scope:** leave the TUI renderer, outer-terminal keyboard negotiation, remote/cloud
  orchestration, marketplace, updater and worktree UI out of our terminal refactor. apack already
  supplies application composition, packs, storage, navigation and agent orchestration.

Sources: [shutdown owner](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/pane.rs),
[wait implementation](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/src/api/wait.rs),
[patch maintenance](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/vendor/libghostty-vt.patches.md).

## apack baseline checked against code

The following are present in the inspected checkout; this is not a declaration that the earlier
issue's entire finding set is still open or already resolved:

- `terminal-pool.ts` already provides long-lived emulators, background output, attach/detach and
  suppression of synthesized replies during initial replay.
- `terminal-events.ts` now accesses browser storage through `surfaceStorage`, but still concatenates
  history strings and debounces full-value saves. The naming/storage abstraction change does not
  itself create a backend history authority.
- `be/services/terminal.ts` still owns node-pty in the API/pack process, writes dimensions into EARS,
  and restores saved rows as new shells. `features/hooks.ts` calls `killAll` at pack shutdown.
- Create replies now use addressed/correlated calls; the backend broadcasts list-change news
  separately. Preserve that solved request routing rather than proposing correlation as new work.
- Interactive agent CLIs inside a terminal and apack's structured Claude runner are different
  execution paths. Terminal heuristics should never replace the runner's explicit lifecycle data.

## Industry checks that affect the design

These are specific contracts to borrow, not claims that another product's complete architecture is
the right one for apack.

| Primary source checked 2026-11-07 | Relevant fact | Design consequence |
|---|---|---|
| [VS Code terminal persistence](https://code.visualstudio.com/docs/terminal/advanced) | Distinguishes process reconnection from process revive | Name and test these separately |
| [VS Code shell integration](https://code.visualstudio.com/docs/terminal/shell-integration) | Installs shell integration through launch arguments/environment and describes shell/remote limits | Launch-time capability, explicit degradation, no commands injected into an already active prompt |
| [WezTerm multiplexing](https://wezterm.org/multiplexing.html) | Separates attachable mux domains from GUI clients | Reuse session authority across presentations without importing its entire workspace model |
| [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/) | Parsing completion and watermarks are necessary across buffered transports | Count outstanding bytes through the consumer, not only socket-send success |
| [Microsoft ConPTY hosting](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session) | Synchronous channels need independently serviced I/O to avoid deadlocks | Share lifecycle semantics across OSes, not identical threading implementations |
| [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) | Jobs manage process groups and can terminate members on last-handle close | Explicit owned process containment; a saved PID is insufficient |
| [Ghostty VT C API](https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt.h) | Current header declares a stable C ABI from 1.0 and exposes terminal/render/input/snapshot facilities | Prefer an upstream VT boundary over maintaining another emulator |
| [Ghostty snapshot contract](https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/snapshot.h) | Full state includes parser continuation; incremental readiness exists; snapshot format 1 has no binary-compatibility guarantee yet | Prototype exact native/WASM restore with pinned builds; do not assume a stable disk/wire format |

The Ghostty observations concern current upstream headers, not the older Ghostty commit vendored by
the reviewed herdr tree. Header version macros do not by themselves prove a published binary release.
The [ghostty-web README](https://github.com/coder/ghostty-web/blob/main/README.md) and
[manifest](https://github.com/coder/ghostty-web/blob/main/package.json) establish a separate WASM/browser
integration. They do not establish support for importing those new upstream snapshots; that remains
a compatibility spike in the target design.
