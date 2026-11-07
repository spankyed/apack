# Terminal session ownership

Status: in progress. No open decisions. Phase T started; Phase G waits on a quiet machine.

````text
```text
# Goal: one owner per terminal session, with every review finding closed by a test or by construction

Implement docs/goals/goal-terminal-ownership.md. Follow CLAUDE.md and docs/AGENTS.md.
The survey was made at 98bf6a0935 on master; inspect current code before relying on it.
Follow the current checkout arrangement and preserve unrelated work.

Read Current handoff and Constraints always. Then only what your phase needs:
- Phase T (independent tracks): Decisions, your track's row, nothing else.
- Phase G (the gate): Decisions, Phase G, Acceptance and evidence.
- Phase S, B, H, P or A: Decisions, your phase, and the phases it depends on.
Findings live in docs/issues/ISSUE-terminal-integration-review.md -- read the rows you are
closing, not the document. Design lives in docs/deferred/terminal-runtime-refactor-target.md
and docs/deferred/xterm-to-ghostty-web.md. Cite all three; do not restate them.

Three rules are easy to skim past and expensive to miss:
1. A finding closes with evidence. A `dissolved` row needs a named guard or it stays `open`.
2. Line numbers in the findings predate a rename and a storage migration. The mechanisms have
   held every spot-check; the citations have not. Verify a finding before acting on it.
3. Phase B's first commit is the point of no return. Phases S and T revert in one commit each.

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
a terminal session* — and today nobody does: the renderer's pool owns the emulator, the pack's service owns
the pty. This goal delivers the refactor's design and the review's findings together and takes the migration
out of scope; the refactor remains the design authority for the broker, the host service and the agent
contracts, cited here rather than restated. Run in sequence, ownership moves three times and each move rewrites the previous one's work. Counted
against the destination, sixteen findings — five of them High — stop existing rather than needing a fix:
F1, F2, F3, F4, F5, F6, F7, F8, L2, L3, M1, M2, M4, M5, X1 and X2. Fixing those first is paying for code the
destination deletes. X1 and X2 are in that list because D11 puts native process ownership in reach: Job
Objects are what own a Windows process tree, and no JS binding supplies them.

**Surveyed** at `98bf6a0935` on `master`, 2026-11-07. Entry points: `packages/default-setup/src/features/code`
(`be/services/terminal.ts`, `be/features/terminal.ts`, `fe/utils/terminal-pool.ts`,
`fe/utils/terminal-events.ts`, `fe/canvas/TerminalView.vue`, `fe/features/terminal/PanelTerminalSection.vue`),
`packages/apack-host/src/bus/client-events.ts`, `packages/api/src/boot/config.ts`.

**Excluded, with disposition:**

- **Agent status rules** (is a Claude/Codex turn working, waiting or ready). Phase A builds the facts
  pipeline; the rules are product surface with their own iteration, and the refactor target warns that
  herdr's can mistake an unrecognized screen for idle. Owner: a later goal, once facts exist.
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

- **Checkout:** `master` at `25d8a8120b`, the current one — no branch or worktree, clean tree.
  **Phase T is complete**: every track below has landed with a firing spec, or is placed with its reason
  (T6 → Phase H, T7 → Phase P, G1 → the output pipe). **Phase G has 2 of its 6 readings** and G1 priced.
  Nothing of Phases S, B, H, P or A is started.
  **Collision surface against #372**, measured 2026-11-07: one file, `features/code/fe/state.ts` (+24/-2 on
  that branch). Every other file Phase T touches is untouched there — `bus/client-events.ts`,
  `api/src/boot/config.ts`, `be/services/terminal.ts`, `fe/features/terminal/state.ts`, `fe/hotkeys.ts`,
  `app-menu.ts` and `stream-writer.ts` — so T3 and T9 are the only tracks with a rebase to think about.
  Phase G's baseline is unaffected by that branch, since it touches neither `services/terminal.ts` nor
  `terminal-pool.ts`.
- **Done:** Phase T's **S2** — the bus logs an event's type, target and sender and never its payload
  (`apack-host/src/bus/client-events.ts`; `summarizeEventForLog` deleted with it). Guarded by a sentinel
  search over the whole serialized log record, so re-adding a payload under any key fails; mutation-checked
  by restoring `event` to the log, which fails three cases. The two live CLAUDE.md files that documented the
  old array-summarizing behaviour moved with it.
- **Done:** Phase T's **S1** — the API token is captured at boot and the variable deleted
  (`captureApiToken()`, `api/src/boot/config.ts`, called from `server.ts` before the app exists), and the
  shell's environment is derived rather than written: `APP_PROCESS_ENV_VARS` (`@apackdev/sdk/env`) is the one
  declaration, `getEnvironment` in `@app/main` builds its record typed by it, and
  `shellEnvironment` (`features/code/be/services/shell-environment.ts`) strips that same list plus the four
  loader variables. The old hand-written deny-list named two of the ten. Closes G2 and G4. Both halves have a
  firing spec and the record has the typecheck; mutation-checked three ways.
- **Done:** Phase T's **F9** — one `failTerminal` reports through `reportError` and answers the asker, so a
  failure raises the app's toast; `terminal.ERROR` left `TerminalNewsType`, since an error is not news and a
  broadcast one would raise a toast in windows whose user did nothing. The surface's write-only
  `terminalError` field is gone with its three `clearTerminalError` wirings; the settle that was buried in the
  same action is now `settleFailedAsk`.
- **Done:** Phase T's **X3 and X10** — the app's keyboard off macOS. `cmd` in a hotkey config now means the
  platform's accelerator (Meta on a Mac, Control elsewhere), so the eleven shipped `cmd` defaults can match
  off a Mac for the first time, while the two written with `ctrl` do not move. And the application menu is
  built per platform (`main/src/modules/app-menu.ts`, renamed from `MacOSAppMenu.ts`): off macOS no menu bar
  is drawn, so what a menu contributes there is global accelerators, and installing none left Electron's
  default — whose Ctrl+R, Ctrl+W and Ctrl+C fire wherever focus is. Both templates are functions of the
  platform, so both are checked from a Mac.
- **Done:** Phase T's **two tooling tracks**, which were the same bug twice and are now one derivation.
  `scripts/lib/vendored-checkouts.ts` answers what is linked under `vendor/`: `rustCheckoutsIn` gives the
  janitor its subject (a sibling is covered the day it is linked, not the day someone remembers the file),
  and `oneRustToolchain` gives the container its channel from **every** linked Rust checkout, refusing a
  disagreement by naming both pins rather than silently building one under the other's. Both refuse an empty
  set. The module imports nothing outside `node:`, which `janitor.ts` requires — launchd runs it with no npm.
  Checked in place: the janitor still reports the same four targets and the image still keys on `1.99.1`.
  **Phase S's two preconditions are met.**
- **Done:** Phase T's **tab-and-panel track** — T1, T2, T3, T5, T8 and T9, each with a firing spec and each
  mutation-checked. **T6 was excluded** on the same ground as T7: see Phase T. All seven were verified
  against current source first; T3 turned out worse than its row said and the extra half is recorded as
  **T10** in the review rather than folded in here.
- **Phase G's instrument is `tests/performance/`, and the terminal scenario is written.** The suite is the
  manual qualification suite over built output (`@apackdev/testing/performance`, `definePerformanceConfig`,
  `tests/performance/README.md`): a `manifest.json` recording source and dirty state, build and native
  output hashes, machine, runtimes, mode and warmups; a `results.json` of ordered raw trials with byte
  counts and SHA-256s; five warmups then twenty measured trials in a warmed process.

  **The repo's own constraints choose it rather than leaving it open.** A figure a decision cites carries
  its date and conditions, and Phase P must assert the output budget "over the same corpus the baseline
  used so the before and after are comparable" — a reading that is not retained with its corpus and its
  identity cannot answer either demand, which rules out measuring with `drive/` and `app.report`. An
  earlier revision of this handoff recorded the choice as an open fork and stopped on it; that was wrong,
  and reading it as one cost a turn. What made it look like a fork was the cost of extending the suite,
  which turned out to be one gate.

  **What extending it took.** Completion in this suite waits for a view delivery, and a terminal has none —
  its output is broadcast news and the code feature declares no `views` module at all. So
  `PerformanceViewCompletion` now carries `awaitsDelivery`, which a feed-shaped action sets false, and the
  `delivered` gate in `installViewCompletion` honours it; everything else about a trial is unchanged. Plus
  `terminal-open` in `trialSchema`'s scenario enum (a published schema, so `api:update` — every line of
  that diff is the enum), in the config's scenario list, and the code surface's panel fields on the window
  port's context type.

  `tests/performance/_support/terminal-open-scenario.ts` measures **first-open latency**: from
  `terminal.CREATE` to a terminal the user can type into, which is the surface recording it as the panel's
  **and** xterm having laid out a screen with something drawn on it, since a freshly spawned shell writes
  its prompt and an attached-but-blank terminal is not open yet. Each trial closes its terminal outside the
  measured interval, so twenty-five trials do not leave twenty-five shells running.

- **Phase G reading 1 of 6 is taken: terminal attach latency, median 20.7 ms (18–25, 20/20 passed).**
  Conditions, build and native identity in
  [the evidence record](../references/evidence/terminal-ownership.md#terminal-attach-latency-phase-g-reading-1-of-6--2026-11-07).
  **It changes what Phase B has to be measured against.** 20.7 ms says the renderer's half of opening a
  terminal is nearly free, so the wait a user feels is the pty spawning and the shell starting — which this
  reading does not cover, because first-byte latency is not observable from the page (xterm draws to a
  canvas; the buffer is in the pack's module-scoped pool). So *the next thing to build is a byte-level
  completion signal*, which the sustained-output, history-replay and first-byte readings all need, and
  without which "the broker can lose on the metric it is measured by" cannot be checked against this number.
- **Phase G reading 2 of 6 is taken: packaged payload.** The terminal stack is **~0.9 MB of working code**
  on macOS — 502 KiB of xterm bundled into the pack's frontend (attributed from the sourcemaps), 136 KiB of
  native pty, 264 KiB of its JavaScript — which is the figure a broker binary is compared against, not the
  29 MB a `du` of `node-pty` suggests. Beside it, two rows ship by omission: `electron-builder.mjs` excludes
  `*.map` and other platforms' `prebuilds/` but not `*.pdb` or `third_party/`, so a Windows package carries
  **26 MB of node-pty debug symbols** and every package, macOS included, carries **2.3 MB of Windows
  `OpenConsole.exe`**. Recorded, not changed — packaging is release configuration and outside this goal.
- **G1 is priced and stays open, with its fix placed.** Measured with the existing `streaming` scenario,
  which already drives the writer at `intervalMs: 80`: **9,726 → 30,054 → 95,924 app write bytes** for
  **864 → 2,160 → 4,340** characters of reply, so bytes-per-character climbs 11.3 → 13.9 → 22.1. Every flush
  writes the whole accumulated text (a monotonic staircase in chunk-sized steps), and the cost follows
  **flushes × final size / 2** with **flushes ≈ duration / 80 ms**, confirmed to within 10% at all three
  sizes. That makes the review's ~15 MB for a 40 KB/60 s reply a measured result rather than an estimate.
  [The pricing](../references/evidence/terminal-ownership.md#g1-priced-what-the-throttled-writer-writes-to-ears--2026-11-07).
  **The writer cannot fix it alone** — the window renders streamed text from the view over the stored row,
  so the 80 ms write *is* the UI update and lengthening it degrades the stream. The fix is a delta feed
  beside a much less frequent durable write, which is the output pipe's payload discipline the review
  assigns G1 to. `stream-writer.ts` is untouched by #372 (checked 2026-11-07 against
  `origin/session/claude-code-integration`), but `thinking-writer.ts` (+51) and `stream-consumer.ts` (+362)
  move substantially there, so that branch's cleanup is the cheapest place for the feed.
- **Next action: the byte-level output signal**, which two of Phase G's four remaining readings wait on
  (sustained output responsiveness, large-history replay) and which the first-byte latency the attach
  reading could not cover also needs. The other two need nothing new: **memory with several hidden sessions**
  is in the process reports' RSS already, and **resize behaviour** is a write count like G1's —
  `services/terminal.ts:145` writes an EARS row on every `resize()` call with no coalescing, which is F5 and
  is confirmed on current source. Then Phase S.
- **A latency reading needs a quiet machine; a byte count does not.** `npm run check:idle` reported 60%
  against a 70% floor, and 0% when macOS was indexing this session's build output — `fseventsd`,
  `spotlightknowledged` and `mds` together, which is what a build leaves behind. The attach reading waited
  for the floor; G1's pricing did not need to, because a span's `ears.request_bytes` does not move with load.
  Gate the right readings. Phase B's first commit is the last cheap exit — see Constraints.
- **This machine's default Node is v23.11.1 against the declared `^24.11.0`.** `apack pack build` fails on
  v23 inside the CLI's captured compiler (`ERR_INVALID_RETURN_PROPERTY_VALUE` from its `load` hook), which
  is nothing to do with the pack. `v24.16.0` is installed under nvm; every build and measurement recorded
  here ran with it on `PATH`.
- **Proven checks:** the sibling-repo path is clear, probed 2026-11-07 and then removed —
  `mkdir` at `/apack/apack-terminal`, `git init`, `cargo init`, `cargo add portable-pty` (crates.io
  reachable, resolves 0.9.0), `cargo build` with that native dependency (5.8s, cc present), an **absolute**
  symlink at `vendor/apack-terminal` matching `readlink vendor/elmdb`, a commit in the new repo, and
  `vendor/apack-terminal.rev`. `cargo`/`rustc` are on PATH and the global git identity is set, so a fresh
  repo commits unconfigured. **Creating and removing are both unrestricted there**, re-probed after the first
  attempt prompted and the permission was granted: a file, a subdirectory and the directory itself all go
  without asking. The judgement is separate from the permission — ask before removing something that might
  be wanted rather than tidying unilaterally, which is what the first probe got wrong.
  One dependency and one build produced a **48 MB `target/`**, confirming that widening
  `lib/janitor-policy.ts` past one checkout is load-bearing rather than bookkeeping: that path is outside the
  budget entirely today. The review's findings were re-verified against the tree on 2026-11-07 for
  S1, S2, F3, F9, F10 and L2; the rest carry pre-rename citations and are verified as each is touched.
- **The platform sniff is written out four times** — `navigator.platform.toLowerCase().includes('mac')` in
  `renderer`'s `WindowControls.vue`, `PopoutTitlebar.vue` and `Toolbar.vue`, and `@apackdev/ui`'s
  `UnifiedMonacoEditor.vue`. X10 declared it once as `primaryModifierIsMeta` (`apack-sdk/src/fe/hotkeys.ts`,
  deliberately not in the `fe` barrel, so it is not a fifth public name) and left the four alone rather than
  widen the track. Pointing them at one declaration is a small, typecheck-proven change for whoever is next
  in those files.
- **A backend spec in default-setup cannot stub a pack-internal module.** `tests/setup.ts` is a setup file and
  imports `#generated/pack-entry.ts`, so the real module is in the graph before any test file's `vi.mock`
  registers. Found while writing F9's guard, which is therefore mock-free: every case fails over a terminal
  that does not exist, so it spawns no process. **`tests/features/code/be/terminal-answers-the-asker.spec.ts`
  spawns a real pty on every run for this reason** — its `vi.mock` of the terminal service is inert, and its
  assertions pass either way. Not this track's to fix, and worth settling before Phase P writes its specs.
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

**Rust, in one step, with no intermediate implementation.** Windows is a target, so native process
ownership is needed; building a non-native broker first would leave X1 and X2 open for its whole lifetime
and then throw its internals away. Precedent is not the reason — elmdb is not an argument for wanting a
second Rust tree — but it does mean the toolchain, the janitor, the container and the pre-push discipline
already exist, so this is the second such tree rather than the first.

**What Rust supplies here**, stated precisely because off-loop VT parsing is *not* one of the reasons and
should not be offered as one:

- **Native process-tree ownership.** Job Objects are the mechanism and no JS binding supplies them, so this
  is the half that cannot be bought in JavaScript at all. It is what X1 and X2 need.
- **ABI independence.** A standalone binary does not care about Electron's Node, which is what removes the
  last Electron-ABI-coupled native module. A process spawned the way the API is would not get this:
  `ELECTRON_RUN_AS_NODE: '1'` (`packages/main/src/modules/api-server/config.ts:108`) runs it on Electron's
  Node.
- **Byte-level bounded buffers with real backpressure.** F3's O(n²) accumulation, F4's unbounded event
  stream and G7's unbounded stderr are the same mistake three times, and byte accounting is where Rust is
  straightforwardly better rather than merely different.
- **Not** off-loop VT parsing — `worker_threads` already keeps compiler work off a loop in five CLI modules,
  so that is a benefit of leaving the API process rather than a reason to choose a language.

**It encompasses the other clients, which is most of why this shape is right.** One broker serves the
terminal, the agent flows and the "stable session APIs usable by apack's CLI and packs" the refactor target
names. Phase B has the two layers and why the agent path shapes them.

**Non-goals, stated because a new repository invites creep.** The broker owns processes, ptys, VT state and
bounded I/O and nothing else: no agent status rules, no UI, no EARS or app schema, no app policy, no
multiplexing beyond one session per pty, and none of the cloud, SSH, updater or workspace management the
refactor target also lists as out. Application policy, agent workflows, persistence relationships and the
Vue/XState presentation stay in apack. A capability that does not need a process handle does not belong
here.

**Home:** `apack-terminal`, a sibling checkout of this one and of elmdb, symlinked as
`vendor/apack-terminal`, pinned by `vendor/apack-terminal.rev`, maintained by `npm run link:apack-terminal`,
with `packages/api` depending on it for the packaged app. Rust stays out of the monorepo for a reason that
is not reuse: `npm run janitor` exists because the elmdb checkout "and every worktree of it" is where the
disk went, and a worktree is cheap for TypeScript and expensive for a Rust `target/`. Accepted costs, named
so they are chosen rather than discovered: two commits and a `.rev` bump per broker change, where an
unbumped rev is a silent skew; a second pre-push suite at elmdb's bar (`cargo xtask pre-push`, every
mutation survivor killed or justified); `lib/janitor-policy.ts` widened past one checkout; per-platform
native artifacts in the packaged build.

**VT core: an upstream Rust crate rather than an FFI to Zig's `libghostty-vt`.** That much is settled and is
independent of the language decision. **Which** Rust crate is not: `alacritty_terminal` over `vte` is the
provisional pick, and Phase S weighs `termwiz` against it on a ground this decision never considered — that
it ships from the same project as `portable-pty` and is built to pair with it. Two questions, and only the
first is answered here.

On the lineage half: not because FFI is objectionable — `libghostty-vt` exposes a public C ABI — but for two
narrower reasons. Matching Ghostty's lineage pays only when a
native core and a ghostty-web renderer cannot disagree about a screen, and D10 keeps xterm.js, so that
benefit is not purchasable here. And the refactor target records that the snapshot contract "explicitly
lacks a binary-compatibility guarantee for snapshot format 1", which this broker persists. A different
lineage means broker and renderer could disagree about a rendered screen, answered by **where facts come
from** rather than by matching implementations: explicit OSC markers, with any screen-derived signal bounded
and carrying `inferred` provenance. Reopen at the
[ghostty-web migration](../deferred/xterm-to-ghostty-web.md), where lineage matching starts to pay and the
snapshot-format risk is what to weigh against it.

**No architectural decision is open**, and every phase below names its owning decision. A phase may still
settle a narrower choice by trying it — Phase S picks between two VT crates that way, which is a deliverable
rather than an open question. An agent that reaches any other fork this document does
not settle has found a gap in it, and should record the gap rather than choose.

## Phases

Phase G comes first: its baseline cannot be taken once state moves. Phase S then proves the whole path with
one session before either layer is built out, so the protocol is derived from its clients rather than
proposed to them. Phase T runs concurrently with all of it. The spine is **G → S → B → H → P → A**, and each
link consumes only the guarantee named — not a barrier by phase number.

### Phase G — the gate

**Deliverable:** the baseline measurement, and the declared bounds the later phases are checked against.
**Dependencies:** a quiet machine (`npm run check:idle`); no concurrent heavy work.
**Done when:** first-open latency, sustained output responsiveness, large-history replay, memory with several
hidden sessions, resize behaviour and packaged payload size are recorded for the current implementation on
one machine and one output corpus, with their conditions, in `docs/references/evidence/terminal-ownership.md`.
The migration plan's Phase 3 requires exactly this baseline and it can only be taken before state moves.
This phase also prices F3, F4, F5 and G1, which are inferences from reading and have never been measured.

**The instrument is `tests/performance/`**, the manual qualification suite over built output, because a
reading this goal cites has to carry its conditions and Phase P has to re-run it over the same corpus.
A terminal's measured action ends in no view delivery, so a feed-shaped completion sets `awaitsDelivery`
false; see Current handoff for what that took.

**It also records what parsing costs today**, in the current implementation: the renderer parses with
xterm.js and the API carries the stream, both Node, so `npm run measure:loop` is the right instrument for
that reading. It is baseline data, not a decision input — the broker is Rust (D11) and has neither a Node
worker nor an event loop for that tool to measure. What the reading informs is the history cap and the
coalescing window below.

It then **declares the bounds the later phases are checked against**, as named constants in the broker and
the presentation seam rather than figures in this document: the presentation channel's byte ceiling and its
overload signal, the coalescing window, the history cap, and the output budget Phase P asserts. Each takes
its value from the reading above by a stated rule — the coalescing window from the measured inter-chunk
interval, the channel ceiling from peak sustained throughput times that window, the output budget from the
measured main-thread cost of the corpus with headroom named. A constant carries the rule that set it and the
reading's date. This document fixes no number: a figure here would be one no record owns, which is what the
repository's own rule on figures refuses.

### Phase S — one session end to end, before either layer is built out

**Deliverable:** a walking skeleton. One terminal, spawned by the broker, written to, output rendered,
resized and killed — through the process layer, the protocol, the host session service and the renderer's
session — with nothing else built. Hard-coded where it must be; no second client, no bounded history, no
agent facts, no reattach.

**Dependencies:** D9, D10, D11. Phase G's baseline. The janitor and toolchain tracks in Phase T, both of
which must land before anything is built at the sibling path.

**Before the symlink exists:** add `vendor/apack-terminal` to `.gitignore` and commit
`vendor/apack-terminal.rev`, which is how elmdb is arranged — the symlink is machine-specific and ignored,
the revision is the committed pin. Skip it and the first `git add -A` commits an absolute path to one
developer's home directory.

**Done when:** a keystroke reaches a pty and its output reaches a screen through all four seams, and
`tests/e2e/smoke/` still passes.

**The first act after `cargo init` is to add the whole candidate set and record what resolves.** One probe
already showed `portable-pty` resolving at 0.9.0 and compiling here in 5.8s — which retires only "the crate
exists and builds on this machine", not "it is fit for purpose"; containment, cancellation and ConPTY
resize/exit are still Phase B's acceptance. The rest are unverified: `termwiz`, `command-group`,
`interprocess`, `insta`, `proptest`. Adding them together costs one command and either retires or raises
every remaining caveat at once, before any of them is designed around. Commit `Cargo.lock`: this is a
binary, not a library.

**Three library choices this phase settles by trying them, not by argument:**

- **`termwiz` against `alacritty_terminal`.** D11 chose the latter on lineage grounds, which was the right
  axis for that question but never weighed the pairing: `termwiz` is wezterm's terminal crate, from the same
  project as `portable-pty`, and designed to sit with it. Check whether it is usable standalone or drags GUI
  assumptions; a matched pair beats two ecosystems if it is.
- **`command-group` for process-tree ownership**, which gives a process group on POSIX and a Job Object on
  Windows under one API. The primitive that matters is
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: with it, the OS kills the tree when the handle closes, so **X1 is
  answered by the kernel rather than by cleanup code** — which is the opposite of today, where cleanup
  depends on `runShutdownHooks()` running inside `process.on('exit')` and cannot on Windows.
- **`ts-rs` for the protocol**, reusing `elmdb-node/protocol/`'s arrangement rather than choosing again, and
  **elmdb's `ErrorCode`** as the error model: a generated closed string union, which is what a typed error
  across this boundary should be and what #372's name-matching should become.

**Why this phase exists.** Phase B otherwise designs a protocol **before either consumer exists**, which is
designing against imagined requirements — and a cross-repo protocol is the most expensive thing here to get
wrong, since fixing it later costs two commits, a `.rev` bump and a migration. The thinnest path through all
four layers first means the protocol is *derived from its clients* rather than proposed to them, which is
the rule this repo applies to everything else it derives. It is also the cheapest moment to meet the
sync-to-async consequence in real call sites rather than in a plan.

### Phase T — independent tracks

**Deliverable:** the findings that depend on no ownership decision. Separate files, no shared seam,
concurrent with the spine — in any order except the two tooling tracks, which Phase S depends on.
**Dependencies:** none.
**Done when:** each lands with the evidence D6 requires.

| Track | Finding | Owner file |
|---|---|---|
| Bus payload | S2 (D5) | `apack-host/src/bus/client-events.ts` |
| Token at source | S1 (D4), closing G2 and G4 | `api/src/boot/config.ts`, the spawn env |
| Error surfacing | F9, through `reportError` | the pack feature |
| App keyboard | X3, X10 | `packages/main` menu, `apack-sdk/src/fe/hotkeys.ts` |
| Agent writes | G1 | the agent streaming writers — **verify against #372 first**, the file moves there |
| The janitor's reach | — | `scripts/janitor.ts`, **before Phase S builds anything** |
| The container's Rust toolchain | — | `scripts/linux-runner.ts`, **before the broker runs in the container** |
| Tab and panel behaviour | T1, T2, T3, T5, T6, T8, T9 | the pack feature |

**The janitor track is not a finding — it is a precondition.** `janitor.ts:45` resolves exactly
`vendor/elmdb` and `catch { return [] }`, so a second Rust checkout is outside the budget entirely: one
dependency and one `cargo build` at the probed sibling path produced **48 MB**, unmanaged. Derive the
subject instead — the `vendor/*` symlinks that point at a directory with a `Cargo.toml` — so a third sibling
is covered the day it is linked rather than the day someone remembers. Two guards, both the repo's own
rules: **mutate the vendor listing in the test** and assert the answer changes, and **refuse an empty set**
rather than returning `[]`, since a janitor that resolves nothing currently runs hourly and reports nothing,
which is the "a check that reports nothing may have looked at nothing" case inside the tooling that enforces
it. This must land before Phase S, or the first build is unbudgeted and the disk is what notices.

**The toolchain track is the same bug as the janitor's, in a second place.** `linux-runner.ts:32` reads the
Rust channel from **elmdb's** `rust-toolchain.toml` alone and keys the image on it, so a second Rust checkout
pinning a different channel is built with elmdb's — silently, not as a failure — and any Linux run at all
fails if elmdb's file is missing. Both pin 1.99.1 today, which is why edition 2024 works, but nothing holds
them together. Derive the channel from every linked Rust checkout and **refuse a disagreement**, naming both
paths, rather than picking one. Same rule, same shape, same guard as the janitor: derive the subject, and
make the ambiguous case loud.

**T7 is deliberately absent**: the panel's attach watcher never tearing down is a pool-lifecycle defect that
Phase P's session model dissolves, so fixing it here is work Phase P deletes. It closes as dissolved there,
with the one-attached-host invariant as its guard. Check each T track for the same shape before starting it —
a fix the spine removes is the cheapest thing not to write.

**T6 turned out to be the same shape, and was excluded on the same ground.** "Restart Terminal" is a kill
followed by a create, so the new tab is a new tab and the old one's pin, group and position go with it. Its
honest fix is a restart that replaces the terminal *in the same tab*, which is the session generation
**Phase H** delivers — "a crashed shell is a new generation whose predecessor's transcript is labelled
history" is the same mechanism. Carrying a tab's metadata across a kill-then-create would be a hack Phase H
deletes. T1 was checked against the same test and kept: the review names it as fixed by the one-owner
refactor too, but a *selection policy* — which terminal the panel shows when its own closes — still has to
exist after the refactor, so the bug survives with it unless fixed.

**T10 was found while verifying T3 and is not in this track.** `persistCodeTabs` prunes against `openFiles`
alone, so **any** `saveTabsAction` during the restore window writes a list without the tabs still arriving —
not only the settle, which is all T3's row names. T3's fix makes the settle non-destructive; the intervening
saves are a separate finding, recorded in the review.

S1 and S2 each land with the firing case that fails when the list goes stale: a deny-list rotting unnoticed
is the defect in both, and a fix without that case only resets the clock.

### Phase B — the broker owns processes and the VT core

**Deliverable:** one authority owning spawn, PTY/ConPTY, VT state, bounded history and bounded I/O, with
serialized writes, coalesced resize and reserved capacity for terminal responses. Presentation bytes reach
the renderer over a dedicated bounded channel, never one bus event per chunk. Two layers, because the second
has another client:

- A **process layer** — spawn, process-tree ownership, lifetime independent of any client, bounded I/O with
  backpressure, close with a deadline, reattach. Nothing here knows what a screen is. **Its protocol is a
  contract, not an internal detail**: the broker lives in a pinned sibling repository, so the message set
  crosses a `.rev` boundary and must be specified, versioned and testable from the app side without the
  broker's source.
- A **terminal capability** over it — pty, VT core, screen and bounded history.

The refactor target's reusable core takes "executable/argv, environment, cwd, dimensions, resource policy
and opaque IDs", which conflates the two: `dimensions` belongs only to the second.

**Dependencies:** Phase S's proven path and the protocol it derived. D11 for the broker's home and core, D9
for what it parses, Phase G's baseline so acceptance has a before.

**Done when:**

1. **The terminal feature no longer imports node-pty.** `services/terminal.ts` spawns nothing; the broker
   owns the pty.
2. **F4, F5, F7, F8, L2, L3, X1 and X2 are closed as dissolved**, each naming the construction that removes
   it. No pid is persisted as a handle, and a resize writes no application row.
3. **X1 and X2 are claimed only on a Windows run** — the [development VM](../references/guides/windows-development-vm.md)
   or a `compiler_windows=true` dispatch, never a Mac.
4. **The presentation channel is bounded** by Phase G's declared ceiling, with a firing case proving a
   producer past it is throttled and the overload observable rather than dropped silently. **Terminal
   responses hold reserved capacity**, by credit-based flow control rather than one shared queue: a reply to
   a DA/DSR query that cannot leave because output filled the channel is a deadlock — the app waits for an
   answer the terminal already produced — and priority inversion on a shared channel is the standard way to
   arrive at one. The firing case is a saturating producer *and* a pending query, together.
5. **Resize is correct under an alternate-screen app**, not only a shell prompt — a pty resized under `vim`
   or `htop` is where coalescing and ordering mistakes surface. Phase P repeats the check from the
   renderer's side.
6. **`portable-pty` is validated, not assumed**, for process containment, cancellation and ConPTY
   resize/exit — Phase S picks it, this phase proves it before anything relies on it. The refactor target
   records that herdr patched its substrate, so a passing build is not the evidence.
7. Native work runs in the Linux container (`npm run test:linux`), one expensive owner at a time.

**Not in this phase, deliberately:**

- **Dropping the node-pty dependency.** #372 adds two more importers (`claude-code/terminal-owner.ts`,
  `claude-code/background-attachment.ts`) and migrating them is out of scope here, so the package entries,
  the `shared-deps.ts` entry, the `build/prod/smoke-native.mjs` probe and the three
  `npx electron-rebuild --only node-pty` invocations come out when the **last** importer does. Record the
  remaining importers rather than claiming a removal this phase cannot perform.
- **Migrating the agent path.** Build the layers so both clients are possible; the deliverable here is the
  seam, not the second client. **Re-verify G1, G2, G6 and G7 against #372 first** — `runner.ts`,
  `handle-store.ts`, `query.ts` and `hooks.ts` all move substantially there, and **G3 is already fixed** on
  that branch (`hooks.ts` calls `killAllHandles()`).

#### The app's side of the protocol

**It is a protocol client, and it is asynchronous.** Follow `elmdb-node`'s shape — Rust types as
the source of truth, TS generated into a `protocol/` directory and shipped with the package — but without
the addon: the broker is a process, not a `cdylib`, so there is no `.node`, no napi and **no
`electron-rebuild`**, which is where D11's ABI independence actually lands.

The consequence to plan for rather than discover: **EARS is synchronous by design** and that only works
because elmdb is in-process — `query`/`create`/`write` are documented as "do NOT await". A socket client is
not, so every pty write, resize and kill becomes a promise, reaching the terminal system's machine code and
every call site that assumed sync. Budget for it; it is pervasive and cheap now, expensive late.

Four more that follow from shipping a binary instead of an addon: per-platform broker builds included by
electron-builder with the executable bit and macOS signing intact, and resolved differently in dev and
packaged; composition owning spawn, socket discovery, crash-restart and one-broker-per-data-dir
(`api/src/runtime/index.ts`, as `openAppStore()` does); the generated protocol treated as a recorded artifact
with `check`/`update` halves so staleness fails a typecheck; and a protocol-version handshake, since the
monorepo pins a `.rev` and a stale pin should be a clear refusal rather than a strange bug. Host-only, like
`APP_ONLY_EXPORTS` keeps `@apackdev/ears/lmdb` from packs, and with a fake so a terminal test needs no built
binary.

#### Why the agent path shapes this phase

It is a client of **both** layers. Its programmatic half (`claude-code/runner.ts`) spawns with
`stdio: ['pipe','pipe','pipe']` and reads NDJSON, so it needs the process layer alone, and its defects are
that layer's item for item: a `kill` that signals the CLI and not its tree (the mirror of F7, where the
terminal over-kills and this under-kills), handles in an in-memory `Map` that die with the API (G3), a
`close()` with no deadline (G6), and unbounded stderr (G7).

Its **native** half (#372) runs the real `claude` TUI in a pty and renders that CLI's dialogs natively, so it
needs the terminal capability too — and it is the **more demanding client**, because a display surface needs
bytes rendered while a dialog detector needs a screen it can match against. **So design the snapshot and
facts API against that adapter**: a screen model with cells, regions and cursor state is what makes dialog
detection sturdy, and the terminal is satisfied by whatever serves it.

That branch also shows the problem is already felt twice rather than predicted once: **three pty owners**
(`services/terminal.ts`, `claude-code/terminal-owner.ts`, `claude-code/background-attachment.ts`), a local
`native-process-ownership.ts` with an `isClaudeNativeDescendant` check, and an attach lifecycle of its own.
Phase B is where those stop being answered twice. The target shape is a non-blocking comment on #372.

#### What disqualifies node-pty

**Where it runs and what it is coupled to, not its quality.** It is current (1.1.0), Microsoft-maintained,
the binding VS Code ships, and sound on POSIX. An addon in the API process cannot outlive the API, and it is
the only module here needing an Electron ABI rebuild. Its Windows weaknesses are the X findings' subject in
[the review](../issues/ISSUE-terminal-integration-review.md); what replaces them is an owned process tree.

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

**The VT layer is tested as a parser, not only as a feature.** Snapshot the resulting grid for a byte stream
(`insta`), and split representative streams at every byte boundary — UTF-8, CSI, OSC, DCS, APC — with a
property test (`proptest`), which is what the refactor target asks for and where VT parsers actually break.

**And an alternate-screen app survives a resize and a reattach.** This was named an unexplored axis in the
review's second round and reviewed by nobody, so it is a requirement here rather than a finding: drive
`vim`, `less`, `htop` and a representative agent TUI through a panel drag, a tab switch, a window resize and
a detach/reattach, and assert the screen is intact afterwards. It is the case where a presentation rewrite
and a moved pty both fail most visibly — garbled reflow and a stale region are what a user reports — and no
existing spec covers it.

### Phase A — agent facts

**Deliverable:** typed facts out of the VT core — process and session identity, prompt and command
boundaries, exit status, bounded screen reads, search and wait-for-state — available without mounting a view.
Launch-time shell integration (D3) supplies the OSC markers.
**Dependencies:** Phase B's VT core, for the markers to be parsed somewhere. D3 for the mechanism, which
this phase builds — no Phase T track supplies it.
**Done when:** F13 and F14 are closed; a hidden session answers a bounded screen read and a wait; reported
paths and titles are treated as untrusted metadata; and no status rule is shipped (see Excluded).

**Driving a third-party CLI is one pattern, and this repo now has two instances of it.** Shell integration
(F13, F14) injects into a shell to get OSC markers back; #372's native plugin registers hooks with the
Claude CLI and answers over a Unix socket. Both exist to extract structured state from a program we do not
own, and both were built bespoke. The convention they converge on, stated here because Phase A delivers the
second instance and neither owns it alone:

- **Author the injected code as source and bundle it**, interpolating only data at the boundary. Playwright's
  injected script is the precedent, and this repo already does author-then-bundle in
  `apack-cli/src/build/be-bundler.ts` and the renderer's `virtual:*` modules. Code in a template string is
  code no typechecker, linter or unit test can reach; #372's is 8,666 bytes of concurrent logic in one.
- **Declare the host's API as types, pinned to a version.** An upgrade should be a typecheck failure, not a
  runtime surprise.
- **Transport is a socket with a token, and payloads are validated on arrival.** #372 does this already and
  it is the part to copy.
- **No silent failure on the channel.** Not `.catch(() => {})`; the same rule as F9.
- **Prefer hooks to polling**, and where a fact has no change notification, say so once rather than letting a
  timer become the default. The same standing rule the repo applies elsewhere.
- **Design the inbound channel, not the poll interval.** A host that permits only outbound requests gives
  the injected code no way to *receive* work, so commands from the app end up riding a tick — which is why
  #372's plugin polls four times a second per session: its `/poll` response is how a queued prompt reaches
  `$.prompt.fill`. Hooking every outbound event leaves that timer exactly where it was. The answer is a
  long-poll, or a streamed response where the host allows one; a tick is the symptom.
- **Ask upstream before working around.** The convention already exists in the ghostty plan: prefer an
  upstream integration change, keep a fork only if the needed public interface is small.
- **Adopt the host ecosystem's wire format rather than inventing one.** For shell integration that means
  **OSC 633**, VS Code's marker set, whose rc scripts are MIT and readable and which other tools already
  emit. Inventing sequences for F14 buys nothing and loses interop.
- **One renderer per element, and one side admits a decision.** Where the app draws a host CLI's UI natively
  while that CLI is also drawing it, the host's output for that element is suppressed and the decision is
  accepted from exactly one side. This is the rule with no industry pattern to copy — iTerm2's tmux control
  mode avoids it because tmux's panes *are* the content — and it is the one whose failure looks like an
  approval the user did not give, so it needs a case rather than care. #372 is the instance that implements
  it (its dialog arrays are `.max(1)` and `terminal-ui.ts` has the suppression); the rule is recorded here
  because it belongs to the pattern rather than to one PR.

Promote this to a `CLAUDE.md` rule once the second instance lands; until then one of the two is still
hypothetical and a rule with one instance is a description.

**Screen inference is needed for less than the refactor target assumes.** Its observation pipeline is
designed to read agent state off a terminal screen, which it also warns is the error-prone part — herdr's
rules "can mistake an unrecognized screen for idle". But a flow-launched agent already emits structured
NDJSON, so its state is `reported` **by construction** and needs no screen at all. Only a session a *user*
started in a terminal tab — what the session artifact's "open in terminal" button does — has nothing but the
screen. #372's native path is in the reported category too, and for a stronger reason than NDJSON: it reads
`$.session.usage()`, `$.agent.list()` and `turn.start`/`turn.complete` hooks, so its state is the CLI's own
answer rather than anything derived from what was drawn. So the provenance split the refactor target prescribes is not two equal paths: the reliable one
covers apack's own flows, and the inference rules are a smaller, bounded case. Build the reported path first
and let the screen rules serve only what it cannot reach.

## Comparing implementations

**This section is an option, not a step.** The plan is one Rust broker (D11); nothing here schedules a second
implementation, and no phase depends on one existing. It records what a comparison would cost and how to
read it, should a question ever arise that measurement rather than reasoning should settle.

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

### A dissolved finding needs a guard, not only a construction

Sixteen findings close as *dissolved*, which is a claim about structure rather than a passing test. Nothing
in the claim stops a later change rebuilding what the structure removed, and "it cannot happen now" is the
shape this repo already distrusts: a check that cannot fail today is a gate or an assertion, and each wants
something different.

So every dissolved row names, beside its construction, **the check that fails if the construction is
undone**:

| Dissolved | The guard |
|---|---|
| F7, L2, L3 — a stored row as a handle | a spec asserting the Terminal entity declares no pid field, and that no row outlives its session |
| F4 — one event per chunk | the perf budget: N MB of output produces at most M channel messages |
| F5 — an EARS write per resize | a spec asserting a resize writes no application row |
| F1, F2 — two hosts, two scroll policies | the invariant spec: one attached host, one `onData`/resize registration per session |
| F3, F6 — a second and third scrollback copy | a `check:specifiers` rule: the pack reaches neither window storage nor its own output buffer |
| F8 — output lost before a listener exists | a spec asserting the first byte a pty writes reaches the session, with the listener registered by the spawn rather than after it |
| M1, M5 — two windows writing one key | a spec asserting a second window observes without writing session-owned state |
| M2 — the pty sized by whichever window fitted last | a spec asserting one resize authority per session, with a second observer's fit ignored |
| M4 — a seam missed on first attach | a spec asserting a window attaching after a process was replaced sees the seam |
| X1, X2 — an unowned process tree | the Windows dispatch, required on each release rather than passed once |
| node-pty returning to the pack | a `check:specifiers` rule, as `APP_ONLY_EXPORTS` does for the lmdb entry |

That is all sixteen, deliberately: a table covering eleven of them would let the five without a guard read as
closed on the strength of the others. **A row whose guard cannot be named is not dissolved — it is
unverified, and stays `open`.**

### The complaint, not only the findings

The findings came from reading code; the original report was experiential — "super buggy in general,
especially in the FE UX". Those can both be satisfied and still disagree, so this goal is not finished on a
full table alone. Name the user-observable journeys **now**, before any of them is reshaped, as `drive/`
scripts checked by eye at the end: open a terminal and run a build; scroll back during output; drag the
divider mid-command; switch tabs and come back; run `vim`, quit it, and keep working; kill a terminal with a
child process running; restart the app and find the terminal where it was. A journey that was broken and
still is means the findings were the wrong list, which is worth learning at the end rather than never.

### The table

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
- **Name the point of no return before passing it.** Phase S and Phase T are revertable in one commit each.
  Phase B is not: once the pack stops owning a pty, going back means restoring an owner that was deleted, and
  the broker lives in a repository with its own history. So Phase B's first commit is the last cheap exit,
  and the thing that makes it safe is Phase S having already proven the path end to end. If the broker
  regresses first-open latency past Phase G's reading, that is a result to investigate inside Phase B, not a
  reason to unwind four layers.
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
