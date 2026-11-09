# One VT core

Status: **planned**. Phase 0 is authorized; nothing past it is, and Phase 0's own exit condition is
what decides whether the rest is worth doing.

```text
# Goal: one terminal implementation, parsed once per side and never twice differently

Implement docs/goals/goal-one-vt-core.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Current handoff, Decisions, Phases and Constraints before continuing.
The initial survey was made at 30eb9ff664 on master; inspect current code before relying on it.
Follow the current checkout arrangement and preserve unrelated work.

Phase 0 is the whole of the current authorization. It proves or disproves that libghostty-vt
agrees with what the broker ships today, and that its WebAssembly build loads through the pack
protocol in a packaged app offline. Neither half changes production code.

Finished when:
- Every required outcome and phase acceptance condition below is met on current source.
- Required integrated/final validation passes, with source commits and evidence recorded.
- Current reference/public docs describe the resulting contract.
- Record Outcome, archive completed work, repair links and commit closure.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
Phase 0 failing is a result, not a setback: record it and stop.
```

## Scope and background

**This repository parses the same bytes twice, with two implementations.** The broker parses them with
`alacritty_terminal` — for `screen`, `search`, the shell-integration markers and the facts a hidden session
answers — and the window parses them again with xterm.js, to draw. [Terminal session
ownership](../archive/goals/goal-terminal-ownership.md) made that arrangement safe rather than correct: the
broker is the authority, the renderer is a replica, and a disagreement is therefore stale rather than wrong.
Safe is as far as two implementations can be taken.

**The condition for taking it further was named, and it is now met.** The
[ghostty-web migration](../deferred/xterm-to-ghostty-web.md) closes with the question it could not answer:

> **Is one engine purchasable?** … only buyable if libghostty's VT core exposes a C API a Rust broker can
> bind. If it does, `alacritty_terminal`, its `vte` and much of `markers.rs` collapse into one
> implementation and the two halves cannot disagree about a screen.

`libghostty-vt` 1.0 shipped on 2026-11-06 with a stable C ABI under semantic versioning, MIT licensed, built
and CI-verified for macOS, Linux, Windows (MSVC and GNU), FreeBSD, Android, iOS and WebAssembly. The answer
is yes. That inverts the shape of the work: this is not a renderer migration with a broker question attached,
it is **one core adopted on both sides of a split that already exists**.

### Required outcomes

1. The broker's terminal state, search and marker scanning run on `libghostty-vt`. `alacritty_terminal` is
   gone from `Cargo.toml`.
2. The window draws with the same core's WebAssembly build. The six `@xterm/*` packages are gone from
   `packages/default-setup/package.json`.
3. Neither side's build requires a Zig toolchain, a network fetch at compile time, or a CDN at run time.
4. A capability this app relies on is asserted to be present, not assumed — `GHOSTTY_UNSUPPORTED` is a
   value the core returns, so a feature that silently answers "no" must fail a check.
5. The broker's existing snapshot corpus passes against the new parser, or every difference is recorded with
   a decision.

### Explicitly out of scope

- **Any change to who owns a session.** The ownership tables, the lifetime hold, `adopt`, the restart budget
  and the protocol's shape are settled and this goal consumes them. See
  [terminal-broker.md](../references/terminal-broker.md).
- **The agent-observation pipeline**, which [terminal-runtime-refactor-target.md](../deferred/terminal-runtime-refactor-target.md)
  owns as design and no goal currently owns as delivery.
- **Persistence, PTY multiplexing and shell-integration redesign**, as the predecessor plan excluded them.
- **Inline images, progress reporting and core-backed selection.** Each becomes *reachable* here and none is
  required; Deferred records them so they are not silently dropped.

### Surveyed base

Made at `30eb9ff664` on `master`, 2026-11-09. Inspect current code before relying on any of it.

| Where | What is there now |
|---|---|
| `apack-terminal/src/screen.rs` (281 lines) | The VT core's wrapper: the grid, the cursor, which screen is showing, bounded scrollback |
| `apack-terminal/src/markers.rs` (221 lines) | OSC 133/7 scanning **and** the facts they mean — `running`, `exitStatus`, the foreground read |
| `apack-terminal/Cargo.toml` | `alacritty_terminal = "0.26.0"` |
| `default-setup/.../fe/utils/terminal-pool.ts` (742 lines) | The only module in the app that imports `@xterm/*` |
| `default-setup/.../fe/canvas/TerminalView.vue`, `.../terminal/PanelTerminalSection.vue` | Hosts. Import `terminalPool` and `TerminalAttachment` and **no xterm type**; their only coupling is ~35 lines of `.xterm` / `.xterm-viewport` CSS, duplicated |
| `default-setup/.../fe/utils/terminal-events.ts` (55 lines) | Fan-out that keeps no copy |

**Three things the predecessor plan assumed that are no longer true**, which is why its phase list is not
this one's:

- *"The pool exposes raw emulator/addon types to both hosts."* It does not. `TerminalAttachment` is a
  ten-method interface and the hosts hold nothing else, so that plan's Phase 2 is already most of the way done.
- *"Retain the stream/history contract; verify replay ordering."* There is no replay. The byte log and its
  window storage were deleted as F3, F6 and F11 ([evidence](../references/evidence/terminal-ownership.md)),
  and the guards are mutation-checked. Phase 1's requirement to suppress emulator-generated DA/DSR replies
  *during historical replay* has no subject.
- *The migration target is `coder/ghostty-web`.* That package is 0.4.0 and its own README says it will
  "eventually consume a native Ghostty WASM distribution once available". It carries its own
  Ghostty-derived parser, so adopting it would give this repository **three** parsers. See Decisions.

## Current handoff

- **Checkout:** `master` at `30eb9ff664`. No branch for this goal yet; no source committed.
- **Next deliverable:** Phase 0a — `libghostty-vt` behind a Cargo feature in the broker's own repository,
  with the existing `insta` corpus driven through both parsers and diffed. It depends on nothing in this
  repository and touches no production path.
- **Proven:** nothing yet. The facts in Scope are documentary, from upstream's release notes and packaging
  guide; every one of them is to be re-checked against the release actually selected.
- **Known unresolved:** the three open decisions below. None blocks Phase 0a.

## Decisions

**D1 — The core is `libghostty-vt`, pinned to an exact release, on both sides.** One implementation is the
whole point; a second would restore the problem under a new name.

**D2 — The renderer takes upstream's WebAssembly module, not `ghostty-web`.** Upstream publishes WASM
modules per release at `release.files.ghostty.org/libghostty-vt/<version>/`, which is "the only place
releases are published". `coder/ghostty-web` predates that build and carries its own parser; taking it buys
an xterm-compatible API at the cost of the thing this goal exists for. If an xterm-shaped surface turns out
to be worth having, it is a shim we write over the same module, in the one file that already owns the
emulator.

**D3 — We own the safe Rust layer over the raw FFI.** The C ABI is 1.0 with strict compatibility promises;
the community safe wrappers are 0.2.x and say their API is not yet stable. Depending on a pre-1.0 wrapper
around a stable ABI inverts the risk for no gain. We take a raw `-sys` crate pinned exactly and write the
safe layer ourselves — perhaps 200 lines — because that layer is where this app's marker semantics live
anyway (D5) and because binding churn then arrives on our schedule.

**D4 — No toolchain and no network in the build. Every target is a verified, pinned binary.** This is the
answer to "Zig or prebuilts", and it is neither of the two options as they were posed:

| Target | Where its binary comes from |
|---|---|
| `aarch64-apple-darwin` | upstream's Apple XCFramework |
| `x86_64-pc-windows-msvc` | upstream's Windows zip — `lib/ghostty-vt-static.lib` |
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | a published per-target archive, verified by its pinned SHA-256 |
| `wasm32` (the renderer) | upstream's WebAssembly module |

The `-sys` crates document the mechanism this needs: an environment variable naming an already-unpacked
archive, so `build.rs` neither downloads nor compiles — the hatch a Nix build uses to fetch and verify
outside its sandbox. We fetch and verify in one place of our own and point the build at the result.

Three consequences worth stating, because each is a rule rather than a detail:

- **Zig enters the build only if we ever build from source, so we never do.** Upstream requires an exact
  Zig major.minor per release and warns that a populated `ZIG_GLOBAL_CACHE_DIR` can crash the build. A
  target with no published binary is therefore **not a supported target** until one exists, rather than a
  target we compile ourselves. Upstream also publishes signed source and dependency tarballs that build
  with no internet access, which is the escape hatch if that rule ever has to be broken — not the plan.
- **The pin is a pair.** The generated bindings and the binary must come from the same upstream commit; the
  `-sys` crate enforces this by having no prebuilt for any target when the commits differ. This repository
  already knows that shape: it is `vendor/*.rev` beside a checkout, and the lesson that a pin can name
  something nobody published cost two CI runs.
- **Linux is the one target upstream tells packagers to build from source**, so it is the one whose binary
  we may end up producing. If we do, it is produced out-of-band and published as an artifact like any
  other — never inside the app's build.

**D5 — The collapse is of the parser, not the semantics.** `screen.rs` becomes a thin mapping onto the
core's state. `markers.rs` loses its hand-rolled scanning and keeps its state machine and its contract:
every field is a claim some program made, except `foreground`, which is measured. Nobody should size this
work as "500 lines go away".

**D6 — The protocol stays ours.** `ts-rs` generates the app's TypeScript from the broker's Rust types. A
core handle's shape must not reach the wire, or the app's contract starts tracking a third party's struct
layout. The mapping lives at the edge, and `BrokerScreen` keeps its current fields.

**D7 — One feature set, declared once.** The WASM build can compile out input encoding, search, selection
and Kitty graphics, roughly halving the module, and the omitted functions stay exported and return
`GHOSTTY_UNSUPPORTED`. Compiling search out of one side while the other relies on it turns "one engine" into
"one engine, two configurations", which is the disagreement this goal is buying away. The feature set per
side is declared in one place and asserted (required outcome 4).

### Open decisions

**O1 — Does the core answer every fact `markers.rs` currently derives?** Specifically OSC 133's command
boundaries, OSC 7's working directory and OSC 9;4's progress. Phase 0a answers it; it decides how much of
`markers.rs` survives and nothing before Phase B depends on the answer.

**O2 — Which release, and does its Windows static library link against the broker's MSVC build?** Upstream
builds the library with the GNU ABI and states that MSVC programs link it through the import library, with
CI covering that; a static MSVC link is reported working by at least one shipping consumer. This is a fact
to establish on the [Windows VM](../references/guides/windows-development-vm.md), not to infer. It blocks
Phase B on Windows and nothing else.

## Phases

### Phase 0a — does the core agree with what we ship?

**Deliverable:** `libghostty-vt` behind a Cargo feature in `apack-terminal`, with the existing `insta`
snapshot corpus driven through both parsers and the differences recorded. No production path changes and
the default feature set is unchanged. Serves required outcome 5 and answers O1.

**Dependencies:** none in this repository.

**Done when:**

- Every existing snapshot case runs under both parsers and the diff is recorded in evidence — case by case,
  with a decision per difference: the new parser is right, the old one was, or the case was testing our
  wrapper rather than the parse.
- The corpus is stated to be a conformance corpus rather than a regression net, and anything it does not
  cover that `markers.rs` relies on is named.
- O1 is answered against the selected release's headers, by calling it rather than by reading its docs.
- A capability the broker needs and the core reports `GHOSTTY_UNSUPPORTED` for is a Phase 0a **failure**,
  recorded with the condition for retrying.

**Why this is first:** it is the question the predecessor plan could not ask, it is the cheapest to answer,
and every other phase is wasted if the answer is no.

### Phase 0b — does the module load where it has to?

**Deliverable:** the packaged-WASM proof, unchanged in substance from the predecessor plan: pack
compilation → installed pack runtime assets → `pack://` revision URL → initialization, **offline, in a
packaged app**, against the existing content security policy. A disposable integration, not a production
switch.

**Dependencies:** none. Independent of 0a and runnable beside it.

**Done when:**

- The module initializes from an installed pack revision in a packaged build with no network.
- Asset inclusion, URL resolution and response MIME type are each shown, not assumed.
- No CDN, no dev-server-only URL, no absolute checkout path, and no policy widening.
- If the pack asset pipeline needs a change to carry a `.wasm`, that change is named and its installed
  result covered.

**Done is not "it worked in development":** this is the half that kills the goal if it fails, and it fails
only in the packaged case.

### Phase B — the broker on the core

**Deliverable:** `screen.rs` mapped onto `libghostty-vt`, `markers.rs`' scanning replaced by the core's,
`alacritty_terminal` removed, the safe layer of D3 written and owned here. Serves outcomes 1, 4 and 5.

**Dependencies:** Phase 0a's agreement result; O1 and O2 answered.

**Done when:**

- `cargo xtask pre-push` passes, the mutation gate included, with every survivor killed or excluded with a
  measured reason.
- The conformance corpus passes with the feature flag removed.
- The protocol's generated types are unchanged, or each change is a deliberate contract change (D6).
- Windows is proven on the VM, not inferred: the Job Object ownership, the pipe ACL and the ConPTY paths
  are the broker's least replaceable code and they are what a core swap most easily disturbs.
- The declared feature set is asserted present (D7).

### Phase R — the renderer on the core

**Deliverable:** `terminal-pool.ts` constructs the core's WASM emulator instead of xterm; the six
`@xterm/*` packages, their CSS import, the addon setup and `vite.config.ts`'s optimizer entries are gone.
Serves outcomes 2, 3 and 4.

**Dependencies:** Phase 0b's packaged load; Phase B is **not** a dependency — the two sides can land
independently, which is a property of the split being real.

**Done when:**

- `TerminalAttachment`'s ten methods behave as they do today, proven by the specs that already cover them.
- Initialization is awaited, deduplicated per terminal id, and a close, teardown or unmount during it
  attaches no stale wrapper and sends no input to a replaced process.
- Exactly one output subscription and one input registration per entry, as now.
- The hosts style their own viewport: the `.xterm` and `.xterm-viewport` CSS in both components is replaced
  by the attachment exposing its viewport element. No component names another library's DOM.
- Links still go through the app's `openLink` and its URL policy, with no widened permissions.
- `xterm-256color` remains the advertised `TERM` unless capability testing requires otherwise. It is a
  terminal capability identifier, not a dependency name.

### Phase A — acceptance

**Deliverable:** one engine per side in a packaged app, with measured before-and-after and every remaining
limitation recorded.

**Dependencies:** Phases B and R.

**Done when:**

- Both hosts are exercised with ordinary output, long scrollback, alternate-screen programs (`vim`, `less`,
  a representative agent TUI), cursor motion, colour, emoji, combining characters, CJK, IME, selection,
  links and mouse input; Ctrl+C, Ctrl+D, arrows, multiline and bracketed paste, copy shortcuts and focus
  return; visible and hidden output, repeated tab switches, a backend restart, a terminal restart and kill,
  and several windows.
- Both paste paths are rechecked — the terminal's own and `apack:paste`.
- Measured on one machine and build: first-open latency including module initialization, sustained-output
  responsiveness, large-history behaviour, memory with several hidden sessions, resize, and packaged payload
  size. Limits are agreed from the baseline **before** cutover.
- No dual engine and no permanent fallback. A blocker leaves the current engine in production on that side
  and is recorded with its failing case.

## Acceptance and evidence

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| Broker on `libghostty-vt`, `alacritty_terminal` gone | missing | — | Phases 0a, B |
| Window on the same core's WASM, `@xterm/*` gone | missing | — | Phases 0b, R |
| No Zig, no compile-time network, no run-time CDN | missing | D4 names the mechanism | Prove per target in Phase B/R |
| Every relied-on capability asserted present | missing | — | D7's declaration and its check |
| Conformance corpus passes, or each difference decided | missing | — | Phase 0a |
| Windows unaffected: job objects, pipe ACL, ConPTY | holds today | [terminal-ownership.md](../references/evidence/terminal-ownership.md) | Re-prove on the VM in Phase B |

Checkpoint logs belong in `docs/references/evidence/one-vt-core.md`, dated, with source commits and exact
commands.

## Deferred

Each of these becomes *reachable* by adopting the core and none is required. Recorded so that reaching
them later is a decision rather than a rediscovery.

- **Inline images.** Kitty graphics is in the core. xterm answers only with `@xterm/addon-image`, which this
  repo does not ship, so this is a capability we lack on both sides today — and one that arrives free unless
  D7's feature set compiles it out.
- **Core-backed selection.** Selection lives in the core, so it could be a fact the broker holds rather than
  state that dies when a host reparents a DOM node. Today it is per-emulator and vanishes on a tab move.
- **One search implementation.** The core does search; the broker's `search` request currently has its own.
- **An xterm-compatible shim**, if an xterm-shaped surface proves worth having after Phase R (D2).

## Constraints

- Standing repository rules apply as written: no backward-compatibility shims, `npm run chain` as the gate,
  and every deadline a declared class rather than a multiple of a measurement.
- The broker is a pinned sibling checkout. A change to it moves `vendor/apack-terminal.rev`, and the local
  chain tests the working tree while CI clones the pin — compare them before trusting a run.
- Native execution belongs in the Linux test container, and Windows verification on the approved VM. Neither
  is a CI dispatch per experiment.
- The [terminal integration review](../issues/ISSUE-terminal-integration-review.md) is dated investigation
  material. Its findings were closed by the ownership goal; recheck anything cited from it against current
  code.
