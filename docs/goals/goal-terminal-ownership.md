# Terminal session ownership

Status: planned. No open decisions; Phase T is ready to start.

````text
```text
# Goal: one owner per terminal session, with every review finding closed by a test or by construction

Implement docs/goals/goal-terminal-ownership.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Current handoff, Decisions, Phases and Constraints before continuing.
The initial survey was made at c2bb387a1a on master; inspect current code before relying on it.
Follow the current checkout arrangement and preserve unrelated work.

Findings live in docs/issues/ISSUE-terminal-integration-review.md. Design lives in
docs/deferred/terminal-runtime-refactor-target.md and docs/deferred/xterm-to-ghostty-web.md.
Do not restate them here; cite them.

Every decision this goal needs is settled in its Decisions section. If you reach a fork it does not
settle, record the gap in Current handoff and stop; do not choose.

Finished when:
- Every required outcome and phase acceptance condition below is met on current source.
- Required integrated/final validation passes, with source commits and evidence recorded.
- Current reference/public docs describe the resulting contract.
- Record Outcome, archive completed work, repair links and commit closure.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
```
````

## Scope and background

**Outcome:** a terminal session has one owner. Processes, PTY/ConPTY, VT state and bounded I/O belong to a
single authority; a window observes a session rather than hosting it; the pack feature keeps application
behaviour. Every finding in the [terminal integration review](../issues/ISSUE-terminal-integration-review.md)
closes with a test in the resulting structure, or is recorded as dissolved by construction with its reason.

**Why one goal rather than three plans.** The review's fixes, the
[ghostty-web migration](../deferred/xterm-to-ghostty-web.md) and the
[runtime refactor](../deferred/terminal-runtime-refactor-target.md) are three different answers to *who owns
a terminal session*. This goal delivers the refactor's design and the review's findings together, and takes
the migration out of scope; the refactor remains the design authority for the broker, the host service and
the agent contracts, cited here rather than restated. Today nobody does: the renderer's pool owns the emulator, the pack's service owns the
pty. Run in sequence, ownership moves three times and each move rewrites the previous one's work. Counted
against the destination, sixteen findings — five of them High — stop existing rather than needing a fix:
F1, F2, F3, F4, F5, F6, F7, F8, L2, L3, M1, M2, M4, M5, X1 and X2. Fixing those first is paying for code the
destination deletes. X1 and X2 are in that list because D11 puts native process ownership in reach: Job
Objects are what own a Windows process tree, and no JS binding supplies them.

**Surveyed** at `c2bb387a1a` on `master`, 2026-11-07. Entry points: `packages/default-setup/src/features/code`
(`be/services/terminal.ts`, `be/features/terminal.ts`, `fe/utils/terminal-pool.ts`,
`fe/utils/terminal-events.ts`, `fe/canvas/TerminalView.vue`, `fe/features/terminal/PanelTerminalSection.vue`),
`packages/apack-host/src/bus/client-events.ts`, `packages/api/src/boot/config.ts`.

**Excluded, with disposition:**

- **Agent status rules** (is a Claude/Codex turn working, waiting or ready). Phase A builds the facts
  pipeline; the rules are product surface with their own iteration, and the refactor target warns herdr's
  can mistake an unrecognized screen for idle. Owner: a later goal, once facts exist.
- **G2–G7** (the agent path beyond G1), and the native-TUI adapter in #372. Their own goal, against the
  shape recorded on that PR, and Phase B's factoring is what makes it cheap:
  most of them dissolve against the process layer rather than needing fixes, so that goal is "migrate the
  agent path onto the broker", not "fix seven findings". G1 is in scope here because it is payload
  discipline rather than process ownership, and independent of everything else.
- **node-pty-shaped Windows findings** (X1, X2 and their neighbours). Dissolved by the spine rather than
  fixed separately — but **closed on a Windows run, not a Mac one**: Phase B writes them and their
  acceptance needs the [Windows development VM](../references/guides/windows-development-vm.md) and a
  `compiler_windows=true` dispatch. X3 and X10 are the app's menu and hotkeys, touch no terminal plan, and
  are in Phase T with the pack-shaped remainder of X (paths, `TERM`, Enter-as-LF, the shell allow-list).
- **Keeping sessions alive across app quit.** A lifecycle policy, not an ownership question; the refactor
  target records it as settings and acceptance rather than a side effect.

## Current handoff

- **Checkout:** `master` at `c2bb387a1a`. Nothing implemented for this goal.
- **Next deliverable:** Phase T's independent tracks, in any order, concurrently with Phase G's baseline.
  Phase B's first commit is the `apack-terminal` repository and its link (D11).
- **Proven checks:** none yet. The review's findings were re-verified against the tree on 2026-11-07 for
  S1, S2, F3, F9, F10 and L2; the rest carry pre-rename citations and are verified as each is touched.
- **Unresolved:** `docs/archive/issues/postmortem-pattern-kill-note-loss.md` still
  claims a live write-discard defect whose mechanism the move to elmdb removed; that claim needs its own
  check and is not this goal's.

## Decisions

Decisions D1–D8 are settled and owned by the review document's *Decisions* section; cite them there rather
than restating. In summary: restructure over repair (D1), one visible host per session (D2), shell
integration keeps its capability and loses its injection mechanism (D3), S1 fixed at the source by capturing
the token at boot (D4), the bus logs no payload (D5), a finding closes with recorded evidence (D6), the
presentation rewrite lands as a series (D7), S2's remediation is the code fix only (D8).

**D9 — the broker parses for facts, the renderer parses for display.** Settled; no spike needed, because
the alternatives fail on their own terms rather than on a measurement. Broker-only parsing makes the renderer
paint a remote grid, which means re-implementing selection, reflow and IME over a snapshot protocol — the
thing you do for a remote terminal and strictly worse for a local one. Renderer-only parsing is today's pool,
and it loses the refactor's headline gain: a hidden session has no state unless a window is alive to hold it.
So both parse the same bytes, authoritatively in one place: the broker owns facts and bounded history, the
renderer owns interaction. This is the arrangement the refactor target already describes — facts to the agent
reducer, a bounded presentation stream to the renderer — with the precision it also states: *multiple
parsing copies are acceptable as bounded replicas; multiple independent authorities are not.* The renderer's
parse is a replica. Where the two disagree, the broker is right, and nothing in the app may read the
renderer's copy as a fact.

**D10 — the renderer keeps xterm.js, and replacing the emulator is out of this goal.** Settled. The outcome
here is ownership; swapping emulators is the
[ghostty-web migration](../deferred/xterm-to-ghostty-web.md), which owns its own capability matrix, its own
offline packaged-WASM proof and its own stop conditions. Phase P's deliverable is the seam, built so that
migration becomes an implementation swap behind it rather than a second rewrite of ownership. Nothing in this
goal assumes xterm survives; nothing in it blocks on proving a replacement.

**D11 — a Rust broker in a sibling repo, owning processes for every client that needs them.** Settled.

**The destination is Rust because the broker is built once.** An earlier revision of this document chose a
Node broker on the grounds that Windows might never matter, which made the cheaper error the smaller first
step. Windows is a target, so that condition does not hold and the asymmetry inverts: Node first means
building the broker twice and leaving X1 and X2 open for the whole interval between. Precedent is not the
reason — elmdb lowers the marginal cost of a second Rust tree without being an argument for wanting one —
but it does mean the toolchain, the janitor, the container and the pre-push discipline all already exist.

**What Rust supplies that the alternative does not.** Stated precisely, because one of the three arguments
this document first made was wrong and should not be repeated:

- **Native process-tree ownership.** Job Objects are the mechanism, and from Node they need native code
  regardless — so a Node broker does not avoid that work, it defers it. This is what X1 and X2 are made of,
  and it is the half that cannot be bought in JS at all.
- **ABI independence.** A standalone binary does not care about Electron's Node. A *Node* broker would not
  escape this: `ELECTRON_RUN_AS_NODE: '1'`
  (`packages/main/src/modules/api-server/config.ts:108`) means one spawned as the API is runs on Electron's
  Node, so node-pty would still need `electron-rebuild`. Rust is what removes the last Electron-ABI-coupled
  native module.
- **Byte-level bounded buffers with real backpressure.** F3's O(n²) accumulation, F4's unbounded event
  stream and G7's unbounded stderr are the same mistake three times, and byte accounting is where Rust is
  straightforwardly better rather than merely different.
- **Not** off-loop VT parsing, which an earlier revision made the premise. `worker_threads` is already how
  this repo keeps compiler work off a loop, in five modules of the CLI. Off-loop parsing is a benefit of
  moving out of the API process, not a reason to choose a language. Phase G's reading sizes the core; it
  decides nothing.

**It encompasses the other clients, which is most of why this shape is right.** The broker is two layers
(Phase B): a **process layer** that owns spawn, process trees, lifetime, bounded I/O and close-with-deadline
and knows nothing about screens, and a **terminal capability** over it holding pty, VT core and bounded
history. The agent path needs the first and none of the second — `claude-code/runner.ts` spawns with
`stdio: ['pipe','pipe','pipe']` and reads NDJSON — and its defects are the process layer's item for item
(G3, G6, G7, and a `kill` that signals one process rather than a tree). One broker therefore serves the
terminal, the agent flows, and the "stable session APIs usable by apack's CLI and packs" the refactor target
names. Building that layer in Node and the eventual Windows answer in Rust would split one owner across two
runtimes, which is the outcome worth most avoiding.

**Home:** `apack-terminal`, a sibling checkout of this one and of elmdb, symlinked as
`vendor/apack-terminal`, pinned by `vendor/apack-terminal.rev`, maintained by `npm run link:apack-terminal`,
with `packages/api` depending on it for the packaged app. Rust stays out of the monorepo for a reason that
is not reuse: `npm run janitor` exists because the elmdb checkout "and every worktree of it" is where the
disk went, and a worktree is cheap for TypeScript and expensive for a Rust `target/`. Accepted costs, named
so they are chosen rather than discovered: two commits and a `.rev` bump per broker change, where an
unbumped rev is a silent skew; a second pre-push suite at elmdb's bar (`cargo xtask pre-push`, every
mutation survivor killed or justified); `lib/janitor-policy.ts` widened past one checkout; per-platform
native artifacts in the packaged build; and `portable-pty` validated for process containment, cancellation
and ConPTY resize/exit before selection, since the refactor target records that herdr patched its substrate.

**VT core:** an upstream Rust crate — `alacritty_terminal` for grid and state, over `vte`. This is
independent of the language decision and unchanged by it. Not because FFI is objectionable:
`libghostty-vt` exposes a public C ABI. Two narrower reasons. Matching Ghostty's lineage pays only when a
native core and a ghostty-web renderer cannot disagree about a screen, and D10 keeps xterm.js, so that
benefit is not purchasable here. And the refactor target records that the snapshot contract "explicitly
lacks a binary-compatibility guarantee for snapshot format 1", which this broker persists. A different
lineage means broker and renderer could disagree about a rendered screen, answered by **where facts come
from** rather than by matching implementations: explicit OSC markers, with any screen-derived signal bounded
and carrying `inferred` provenance. Reopen at the
[ghostty-web migration](../deferred/xterm-to-ghostty-web.md), where lineage matching starts to pay and the
snapshot-format risk is what to weigh against it.

**No decision is open**, and every phase below names its owning decision. An agent that reaches any other fork this document does
not settle has found a gap in it, and should record the gap rather than choose.

## Phases

Phase T runs concurrently with everything. Phase G must complete before any state moves. The spine is
B → H → P → A, and each link consumes only the guarantee named.

### Phase G — the gate

**Deliverable:** the baseline measurement, and the declared bounds the later phases are checked against.
**Dependencies:** a quiet machine (`npm run check:idle`); no concurrent heavy work.
**Done when:** first-open latency, sustained output responsiveness, large-history replay, memory with several
hidden sessions, resize behaviour and packaged payload size are recorded for the current implementation on
one machine and one output corpus, with their conditions, in `docs/references/evidence/terminal-ownership.md`.
The migration plan's Phase 3 requires exactly this baseline and it can only be taken before state moves.
This phase also prices F3, F4, F5 and G1, which are inferences from reading and have never been measured.

**It also sizes the worker D11 depends on**: the cost of headless VT parsing at our output volumes, taken
with `npm run measure:loop` against the window a blocked loop actually has. This is a reading rather than a
gate — D11 is settled by inspection, since `worker_threads` is already how this repo keeps compiler work off
a loop. What the reading decides is the worker's shape and the history cap, not the language.

It then **declares the bounds the later phases are checked against**, as named constants in the broker and
the presentation seam rather than figures in this document: the presentation channel's byte ceiling and its
overload signal, the coalescing window, the history cap, and the output budget Phase P asserts. Each takes
its value from the reading above by a stated rule — the coalescing window from the measured inter-chunk
interval, the channel ceiling from peak sustained throughput times that window, the output budget from the
measured main-thread cost of the corpus with headroom named. A constant carries the rule that set it and the
reading's date. This document fixes no number: a figure here would be one no record owns, which is what the
repository's own rule on figures refuses.

### Phase T — independent tracks

**Deliverable:** the findings that depend on no ownership decision. Separate files, no shared seam, any order,
concurrent with the spine.
**Dependencies:** none.
**Done when:** each lands with the evidence D6 requires.

| Track | Finding | Owner file |
|---|---|---|
| Bus payload | S2 (D5) | `apack-host/src/bus/client-events.ts` |
| Token at source | S1 (D4), closing G2 and G4 | `api/src/boot/config.ts`, the spawn env |
| Error surfacing | F9, through `reportError` | the pack feature |
| App keyboard | X3, X10 | `packages/main` menu, `apack-sdk/src/fe/hotkeys.ts` |
| Agent writes | G1 | the agent streaming writers — **verify against #372 first**, the file moves there |
| Tab and panel behaviour | T1, T2, T3, T5, T6, T7, T8, T9 | the pack feature |

S1 and S2 each land with the firing case that fails when the list goes stale: a deny-list rotting unnoticed
is the defect in both, and a fix without that case only resets the clock.

### Phase B — the broker owns processes and the VT core

**Deliverable:** one authority owning spawn, PTY/ConPTY, VT state, bounded history and bounded I/O, with
serialized writes, coalesced resize and reserved capacity for terminal responses. Presentation bytes reach
the renderer over a dedicated bounded channel, never one bus event per chunk.

**Factored as two layers, because the second has another client.** The refactor target's reusable core takes
"executable/argv, environment, cwd, dimensions, resource policy and opaque IDs", which conflates them;
`dimensions` is a terminal's.

- A **process layer**: spawn, process-tree ownership, lifetime independent of any client, bounded I/O with
  backpressure, close with a deadline, reattach. Nothing here knows what a screen is.
  **Its protocol is a contract, not an internal detail.** That is forced rather than chosen: the broker
  lives in a pinned sibling repository (D11), so the message set crosses a `.rev` boundary and has to be
  specified, versioned and testable from the app side without the broker's source. The useful consequence is
  that any implementation speaking it is interchangeable — see *Comparing implementations*.
- A **terminal capability** over it: pty, VT core, screen and bounded history.

**The agent path is a first-class client of both layers, not a later migration of one.** Its programmatic
half (`claude-code/runner.ts`) spawns with `stdio: ['pipe','pipe','pipe']` and reads NDJSON, so it needs the
process layer alone. Its **native half**, in flight on `session/claude-code-integration` (#372), runs the
real `claude` TUI inside a pty and parses its screen into structured dialogs — tool permission, plan, bash,
question, MCP form — which the app renders natively. That half needs the terminal capability too, and it is
the *more* demanding client: a display surface needs bytes rendered, while a dialog detector needs a screen
it can match against.

**So design the capability's snapshot and facts API against the TUI adapter, not against the terminal.** A
screen model with cells, regions and cursor state is what makes dialog detection sturdy; matching ANSI from
a byte stream, which is what #372 does today, is the fragile version. The terminal is the easier client and
will be satisfied by whatever serves this one.

Also worth carrying into Phase B as evidence rather than assumption: that branch has **three pty owners**
(`services/terminal.ts`, `claude-code/terminal-owner.ts`, `claude-code/background-attachment.ts`), its own
`claude-code/native-process-ownership.ts` with an `isClaudeNativeDescendant` check, and its own attach
lifecycle with `input`/`resize`/`close`. The process-tree and attachment problems are already felt in two
places and answered in both; Phase B is where they stop being answered twice. The target shape is recorded
as a non-blocking comment on #372 and nothing here blocks on it.

The programmatic half's defects remain the process layer's, item for item: `kill(signal)` is `child.kill(signal)`, which signals the
CLI and not its tree, so a Bash grandchild outlives a deliberate kill (the mirror of F7, where the terminal
over-kills and this under-kills); handles live in an in-memory `Map` and die with the API (G3); `close()` is
awaited with no deadline, so a grandchild holding stdout pins a thread `isRunning` forever (G6); stderr
accumulates unbounded to serve a 500-character tail (G7). Each of those dissolves against the process layer
the same way the terminal's do.

Build the layers so both clients are possible; **do not migrate the agent path here.** Its migration is its
own goal, and the deliverable in this one is the seam, not the second client. **Re-verify G1, G2, G6 and G7
against #372 before acting on them** — `runner.ts`, `handle-store.ts`, `query.ts` and `hooks.ts` all move
substantially on that branch, and G3 is already fixed there (`hooks.ts` calls `killAllHandles()` on
shutdown).
**Dependencies:** D11 for the broker's home and core, D9 for what it parses. Phase G's baseline,
so acceptance has a before.
**Done when:** **the terminal feature no longer imports node-pty** — `services/terminal.ts` spawns nothing,
and the broker owns the pty.

Dropping the **dependency** is a separate, later condition and must not be written into this phase:
#372 adds two more importers (`claude-code/terminal-owner.ts`, `claude-code/background-attachment.ts`), and
migrating them is explicitly out of scope here. So the package entries, the `shared-deps.ts` entry, the
`build/prod/smoke-native.mjs` probe and the three `npx electron-rebuild --only node-pty` invocations in
`build/build.sh` come out when the **last** importer does, which is the agent path's goal. Record the
remaining importers rather than claiming the removal; the prize — an app with no Electron-ABI-coupled native
module, elmdb being N-API — is real but it is not this phase's to claim.

What disqualifies node-pty is **where it runs and what it is coupled to, not its quality**: it is current
(1.1.0), Microsoft-maintained, the binding VS Code ships, and sound on POSIX. An addon in the API process
cannot outlive the API, and it is the only module here needing an Electron ABI rebuild. Its Windows path is
separately weak — `_deferNoArgs` queues `kill`/`resize` until the first data event, the exit event lags by
`FLUSH_DATA_INTERVAL = 1000`, and the child kill walks the console process list asynchronously through a
forked helper — which is what X1 and X2 are made of, and what an owned process tree replaces. Claim those
two only on a Windows run that proves it; `portable-pty` is validated rather than assumed, since the
refactor target records that herdr patched its substrate.

Also closed, each as dissolved with the construction that removes it: F4, F5, F7, F8, L2, L3, X1 and X2. The
pack's `be/services/terminal.ts` no longer spawns or owns a process; no pid is persisted as a handle; a resize writes no application row; and the presentation channel is bounded by Phase G's declared
ceiling, with a firing case proving a producer past it is throttled and the overload observable rather than
dropped silently. Native work runs in the Linux container (`npm run test:linux`), one expensive owner at a
time.

### Phase H — the host service owns sessions

**Deliverable:** sessions in `@apackdev/host`, addressed and authorized by the host, with attach, detach and
explicit termination distinct from one another. A window observes; closing a view detaches.
**Dependencies:** Phase B's session identity and descriptors.
**Done when:** M1, M2, M4 and M5 are closed as dissolved; a second window observes without resizing the pty
or sending input; a renderer reload and an API restart leave a session running; and a crashed shell is a new
generation whose predecessor's transcript is labelled history.

### Phase P — presentation

**Deliverable:** the renderer's session/emulator seam, built once against D10, owning lifecycle, ownership
and subscription, with the emulator reached through a seam internal to the feature. The byte log and the
window-storage copy are deleted, not repaired.
**Dependencies:** D10 for the emulator, D9 for the split. Phase H's observer contract.
**Done when:** F1, F2, F3 and F6 are closed; F10, F11, F12, F15 and F16 land against the chosen emulator;
exactly one host is attached and exactly one `onData`/resize registration exists per session, asserted by a
spec; and the output budget Phase G declared holds, asserted over the same corpus the baseline used so the
before and after are comparable.

### Phase A — agent facts

**Deliverable:** typed facts out of the VT core — process and session identity, prompt and command
boundaries, exit status, bounded screen reads, search and wait-for-state — available without mounting a view.
Launch-time shell integration (D3) supplies the OSC markers.
**Dependencies:** Phase B's VT core. Phase T's shell-integration mechanism.
**Done when:** F13 and F14 are closed; a hidden session answers a bounded screen read and a wait; reported
paths and titles are treated as untrusted metadata; and no status rule is shipped (see Excluded).

**Screen inference is needed for less than the refactor target assumes.** Its observation pipeline is
designed to read agent state off a terminal screen, which it also warns is the error-prone part — herdr's
rules "can mistake an unrecognized screen for idle". But a flow-launched agent already emits structured
NDJSON, so its state is `reported` **by construction** and needs no screen at all. Only a session a *user*
started in a terminal tab — what the session artifact's "open in terminal" button does — has nothing but the
screen. So the provenance split the refactor target prescribes is not two equal paths: the reliable one
covers apack's own flows, and the inference rules are a smaller, bounded case. Build the reported path first
and let the screen rules serve only what it cannot reach.

## Comparing implementations

The protocol makes a side-by-side cheap **at the process layer**: a second broker binary speaking the same
message set, chosen by a developer-only path rather than a user setting. Nothing in the app changes, which is
what specifying a protocol buys that an engine abstraction would not.

Scope any comparison to that layer. A Node arm there is small — spawn, tree kill, lifetime and bounded I/O
over node-pty, close to what the app does today moved out of process — and the measurements are meaningful:
startup latency, memory per idle session, sustained throughput, and whether a tree kill actually reaps
grandchildren. The **terminal capability** is a different matter: a Node arm needs a JS VT core and its own
bounded history, which is most of the work rather than a wrapper, and the answer is largely known since
xterm.js already parses this volume in the renderer. Duplicating it buys little for roughly twice the cost.

**Read the result with its bias stated.** A Node arm cannot implement the Windows half at all — Job Objects
need native code — so the comparison runs on macOS and Linux, which is exactly where the gap is narrowest.
It therefore measures the dimensions on which Node looks best and omits the one that decided D11. That is a
reason to interpret it correctly rather than to skip it: if the POSIX numbers are close the decision still
rests on Windows, and if they are not close that is information D11 did not have.

A second arm is temporary and names its removal date when it is created. Two implementations mean two sets
of bugs and a "which one was this?" question in every report, which is the cost the rule above exists to
avoid.

## Acceptance and evidence

One table, in `docs/references/evidence/terminal-ownership.md`, with a row per finding in the review
document and these columns: finding, disposition (`test` | `dissolved` | `open`), implementation commit,
evidence (spec path, or `driven: <what>`), remaining work. A row closes only as D6 allows. The table is the
goal's completion criterion; the review document stays the findings' authoritative home and is struck as
rows close.

Required final validation: `npm run chain` (full, including `test:native`), and one strict run
(`gh workflow run ci.yml -f strict_chain=true`) on the finished state. A Windows release scheduled before the
refactor reopens the node-pty findings and needs `compiler_windows=true`.

## Constraints

Standing repository rules apply as written; this section records only what is specific here.

- **Throughput is capped by verification, not implementation.** The Linux test container takes one expensive
  owner at a time (`machine-lock.ts`), the Windows VM is one coordinated machine, a strict chain run is five
  macOS jobs, and `npm run measure` refuses below `IDLE_FLOOR`. Plan concurrency around those, not around
  how fast code is written.
- **No shim, no dual engine, no selection flag — in a shipped build.** The broker replaces the pack
  service's ownership in the same change that migrates its callers, and no user-facing switch selects an
  implementation. Both deferred plans refuse an engine abstraction and so does this. The prohibition is
  about what ships, not about what may be measured: a second implementation behind a developer-only broker
  path, with the date it is deleted, is a different thing and is covered under *Comparing implementations*.
- **Checkpoints are evidence boundaries.** A commit lands because something is proven, not because it is a
  safe place to stop.
- **The baseline is unrepeatable.** Once Phase B moves state, the before cannot be taken again.
- **The broker can lose on the metric it is measured by.** A pty spawns in-process today; a broker has to
  start first, and first-open latency is one of Phase G's readings. Treat a regression there as a result to
  investigate, not a cost to absorb silently.
- **IPC becomes a surface this repo owns** — framing, epochs, authorization, backpressure. Bugs do not
  disappear when ownership moves out of process; some of them move here. Budget for it rather than
  discovering it.
- **"Session" gets one meaning.** The host owns sessions; nothing else may name one. #372 has a
  `claude-code/terminal-session.ts` holding Claude session *records*, which is a different thing wearing the
  same word — the class of problem the `surface` / `system` / `plugin` rule exists for. Settle it by rename
  while it is a rename, and keep `check:specifiers`' vocabulary rule in mind if a third meaning appears.
- **Debuggability is JS-shaped today.** `drive/`, `npm run dev:eval`, sourcemaps and the logger all assume
  the failing code is JavaScript. A broker needs its own answer to "what is it doing right now" before it
  owns anything a user can see.
