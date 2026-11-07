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
a terminal session*. Today nobody does: the renderer's pool owns the emulator, the pack's service owns the
pty. Run in sequence, ownership moves three times and each move rewrites the previous one's work. Counted
against the destination, roughly a third of the findings — including five of the fourteen High ones — stop
existing rather than needing a fix: F1, F2, F3, F4, F5, F6, F7, F8, L2, L3, M1, M2, M4, M5, X1, X2. Fixing
those first is paying for code the destination deletes.

**Surveyed** at `c2bb387a1a` on `master`, 2026-11-07. Entry points: `packages/default-setup/src/features/code`
(`be/services/terminal.ts`, `be/features/terminal.ts`, `fe/utils/terminal-pool.ts`,
`fe/utils/terminal-events.ts`, `fe/canvas/TerminalView.vue`, `fe/features/terminal/PanelTerminalSection.vue`),
`packages/apack-host/src/bus/client-events.ts`, `packages/api/src/boot/config.ts`.

**Excluded, with disposition:**

- **Agent status rules** (is a Claude/Codex turn working, waiting or ready). Phase A builds the facts
  pipeline; the rules are product surface with their own iteration, and the refactor target warns herdr's
  can mistake an unrecognized screen for idle. Owner: a later goal, once facts exist.
- **G2–G7** (the agent path beyond G1). A different feature; their own issue. G1 is in scope because it is
  the same payload discipline as Phase S and is independent of everything here.
- **node-pty-shaped Windows findings** (X1, X2 and their neighbours). Dissolved by the spine, so not fixed
  separately. X3 and X10 are the app's menu and hotkeys, belong to no terminal plan, and are in Phase T.
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

**D11 — a sibling repo, and VT state from an upstream Rust crate.** Settled, both halves.

- **Home:** `apack-terminal`, a sibling checkout of this one and of elmdb, symlinked as
  `vendor/apack-terminal`, pinned by `vendor/apack-terminal.rev`, maintained by `npm run link:apack-terminal`,
  with `packages/api` depending on it for the packaged app. The reason is not reuse — it would have one
  consumer, as elmdb does. It is that `npm run janitor` exists because the elmdb checkout "and every worktree
  of it" is where the disk went: a worktree is cheap for TypeScript and expensive for a Rust `target/`, and
  this repo creates them freely. Keeping Rust out of the monorepo is what keeps `session:new` cheap.
  Accepted costs: two commits and a `.rev` bump per broker change, where an unbumped rev is a silent skew;
  a second pre-push suite at elmdb's bar (`cargo xtask pre-push`, every mutation survivor killed or
  justified); `lib/janitor-policy.ts` widened past one checkout; per-platform native artifacts in the
  packaged build.
- **VT core:** an upstream Rust crate — `alacritty_terminal` for grid and state, over `vte`. Not because
  FFI is objectionable: `libghostty-vt` exposes a public C ABI, and calling it from Rust is routine. Two
  narrower reasons. First, the benefit of matching Ghostty's lineage is that a native core and a
  ghostty-web renderer cannot disagree about a screen — and D10 keeps xterm.js, so that benefit is not
  available to buy here. Second, the refactor target records that the snapshot contract "explicitly lacks a
  binary-compatibility guarantee for snapshot format 1", and this broker persists bounded history; a
  persisted format with no compatibility guarantee is a cost paid later, by us.
  The consequence of a different lineage is that broker and renderer could disagree about a rendered
  screen, which is answered by **where facts come from** rather than by matching implementations: facts
  derive from explicit OSC markers (prompt, command start/end, exit status, cwd), unambiguous across
  implementations, and any screen-derived signal is bounded and carries `inferred` provenance — the refactor
  target's own rule, and its own warning about herdr mistaking an unrecognized screen for idle.
  Revisit when the ghostty-web migration lands: from that point lineage matching starts to pay, and the
  snapshot-format risk is the thing to weigh against it.

**No decision is open.** Every phase below names its owning decision; an agent that reaches a fork this
document does not settle has found a gap in it, and should record the gap rather than choose.

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
| Agent writes | G1 | the agent streaming writers |
| Tab and panel behaviour | T1, T2, T3, T5, T6, T7, T8, T9 | the pack feature |

S1 and S2 each land with the firing case that fails when the list goes stale: a deny-list rotting unnoticed
is the defect in both, and a fix without that case only resets the clock.

### Phase B — the broker owns processes and the VT core

**Deliverable:** one authority owning spawn, PTY/ConPTY, VT state, bounded history and bounded I/O, with
serialized writes, coalesced resize and reserved capacity for terminal responses. Presentation bytes reach
the renderer over a dedicated bounded channel, never one bus event per chunk.
**Dependencies:** D11 for the broker's home and core, D9 for what it parses. Phase G's baseline,
so acceptance has a before.
**Done when:** **node-pty is gone from the repository** — the dependency dropped from
`packages/default-setup/package.json` and `packages/api/package.json`, its entry removed from
`apack-host/src/build/shared-deps.ts`, its probe removed from `build/prod/smoke-native.mjs`, and the three
`npx electron-rebuild --only node-pty` invocations deleted from `build/build.sh`, which leaves the app with
no Electron-ABI-coupled native module at all (elmdb is N-API and needs no rebuild). The substrate is
upstream `portable-pty`, validated for process containment, cancellation and ConPTY resize/exit behaviour
before selection. F4, F5, F7, F8, L2, L3, X1 and X2 are closed as dissolved with the construction that
removes each; the pack's `be/services/terminal.ts` no longer spawns or owns a process; no pid is persisted as a
handle; a resize writes no application row; and the presentation channel is bounded by Phase G's declared
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
- **No shim, no dual engine, no selection flag.** The broker replaces the pack service's ownership in the
  same change that migrates its callers; both deferred plans refuse an engine abstraction and so does this.
- **Checkpoints are evidence boundaries.** A commit lands because something is proven, not because it is a
  safe place to stop.
- **The baseline is unrepeatable.** Once Phase B moves state, the before cannot be taken again.
