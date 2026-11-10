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

**This goal is self-contained.** The two deferred documents are absorbed: everything from them worth
executing is in the Phases below, and they are kept for their reasoning rather than as references to follow.

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

- **Checkout:** this repository on `master`; the broker in a worktree of `apack-terminal` at
  `vt-core/conformance`, branched from `93b7de9`. The main broker checkout stays detached at that pin so
  the monorepo's `vendor/` link does not drift under local work. `vendor/apack-terminal.rev` has **not**
  been moved: the branch is not mergeable while O4 is open.
- **Phase 0a passes.** Ten conformance cases. The grids agree over all eight streams whole and
  byte-by-byte, the wrapper is self-consistent at every byte boundary, and three differences are decided:
  device attributes (the core is right), the disjoint shell-integration families (take the union), and
  where payload decoding lives.
- **Phase 0b passes.** A pack's WebAssembly module instantiates in the app from the installed revision over
  `pack://`, streaming and buffered. An imported module is the wrong mechanism; a public asset is the
  right one and needed no build change.
- **Phase B is complete.** It passes on POSIX and on Windows. `screen.rs` is the core, `alacritty_terminal` is gone from the
  manifest and the lockfile, and the eight snapshots recorded from the old parser pass unchanged — the
  evidence that nothing observable moved. `search` stays ours. `cargo xtask pre-push` is green end to end,
  mutants included: 61 tested, 58 caught, 3 unviable, **zero survivors**, with one `Drop` mutant excluded
  for a recorded reason. The generated protocol is byte-identical, which is D6 held.
- **O2 is answered.** The library builds for `x86_64-windows-msvc` from the signed source and dependency
  tarballs with Zig 0.17.0 and `--system`, it links against the broker's MSVC build, and all 97 tests pass
  there — with Job Object tree ownership, the named-pipe ACL and the ConPTY `ESC [ 6 n` startup each
  re-proven by name. Two findings came with it: the crate's source build passes `zig build` a flag Zig
  0.17.0 rejects, and D4's prebuilt-directory hatch asserts a file name no Windows build produces.
- **The pin is moved.** `vendor/apack-terminal.rev` names `80ffdb3`, the merged commit the gate actually
  ran on — master had gained the Windows mutants CI fix, which touches three files Phase B also changed, so
  the merge was re-gated rather than assumed (135 tests, 61 mutants, none missed). The vendored checkout is
  fast-forwarded to it and `node/apack-terminal` rebuilt from it.
- **Phase R is delivered.** The window draws with `ghostty-web`, the six `@xterm/*` packages are gone, and
  the app has been driven: the emulator opens into the pool's detached wrapper, draws, and comes back from a
  tab switch with the same pixels, the same session and the same pid. OSC 52 is implemented rather than
  carried. O3 is answered — the renderer takes `ghostty-web` — so
  D2 above is the replacement decision and Phase R's work below is written against it.
- **Phase A is part-done, and what is left is held on a machine rather than on a decision.**
  - **Done:** the driven run above; the packaging defect it exposed and its fix; OSC 52; the reference docs
    (`terminal-broker.md` and the root guide's terminal line) describing what shipped.
  - **Held:** `cargo xtask pre-push` on the broker's packaging fix, `npm run chain`, `test:smoke`, the
    packaged install path and the `npm run measure` figures. Every one of those is timing-sensitive and this
    machine is carrying a sustained load average above 120 from work that is not this goal's, which already
    produced two unrelated broker cases failing on their deadlines — one that passes in 2.08s alone having
    taken 9.97s, and one that took 47s and then timed out at 60. Re-running them until they pass is not a
    fix, and a figure measured here would not be citable.
  - **Not started:** the fuller behaviour pass (both hosts, real shells, alternate-screen programs, the two
    paste paths, several windows), and closure — the Outcome and the archive move, which this repository's
    documentation rule says may not stand in for an unmet requirement.
  - **One open question for the owner**, recorded rather than decided: this goal's closure step says to
    archive *both* deferred documents, but only [xterm-to-ghostty-web](../deferred/xterm-to-ghostty-web.md)
    is absorbed by it. [terminal-runtime-refactor-target](../deferred/terminal-runtime-refactor-target.md) is
    named **out of scope** above and still owns the agent-observation pipeline as design that no goal
    delivers, so archiving it would retire live design rather than completed work.

**Four decisions block the rest, and three of them are the user's.** None is a thing to work around:

| | blocks | what it needs |
|---|---|---|
| **O1** | — | answered in Phase 0a |
| **O2** | — | **answered**: it builds, links and passes on Windows; two findings about the crate |
| **O3** | — | **answered**: `ghostty-web`, and D2 is retired in its favour |
| **O4** | Phase B's exit | a decision: the broker's advertised scrollback contract, which this core cannot keep as written |

**O4 is the one that stops `pre-push` going green**, and there is no configuration that avoids it: the
core's floor is one page's rows, a page is a fixed number of *bytes*, so the rows it holds fall as content
widens. A promise of a fixed line count is therefore unkeepable with this core for arbitrary content, which
is why it is a contract question rather than a tuning one.

## Decisions

**D1 — The core is `libghostty-vt`, pinned to an exact release, on both sides.** One implementation is the
whole point; a second would restore the problem under a new name.

**D2 — The renderer takes `ghostty-web`.** This replaces the original D2, which said upstream's
WebAssembly module and not `ghostty-web`, on the ground that an xterm-compatible API would cost "the thing
this goal exists for". That reasoning had a false premise: `libghostty-vt` is an emulator, not a widget —
`render.h` hands you a frame's state and leaves the drawing to you — so taking the module alone means
writing the painter, the input encoding, the selection UI, IME, accessibility and the scrollbar. None of
that is terminal emulation, and all of it is the largest single piece of work in this goal.

What the goal exists for is **one answer to what a sequence means**, and `ghostty-web` is compiled from
Ghostty's source with one patch that exposes extra entry points, so the window's emulator stops being an
independent implementation. Byte-identical parsing on the renderer side buys less than it appears to,
because the ownership goal already settled that the window's screen is **a replica and never an
authority** — the broker answers for the screen. Phase B delivers one engine on the side that is the
authority.

The cost is two Ghostty-derived builds in the tree until `ghostty-web` consumes the official distribution,
which its README commits to, and a `next` prerelease until it cuts a stable release. Both are recorded with
the condition for leaving them, and the measured API surface is in
[evidence](../references/evidence/one-vt-core.md). **The wasm arrives inlined as a base64 data URL**, so
the renderer needs no `pack://` asset route for it.

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
| `wasm32` (the renderer) | upstream's WebAssembly module |
| `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | a published per-target archive, verified by its pinned SHA-256 |
| `x86_64-pc-windows-msvc` | **nothing is published, by anyone** — we produce it (see below) |

The `-sys` crates document the mechanism this needs: an environment variable naming an already-unpacked
archive, so `build.rs` neither downloads nor compiles — the hatch a Nix build uses to fetch and verify
outside its sandbox. We fetch and verify in one place of our own and point the build at the result.

Three consequences worth stating, because each is a rule rather than a detail:

- **Zig never enters the app's build. It does enter ours, once per release, for Windows.** Measured
  2026-11-09: upstream publishes six files for `1.0.0` and not one is a Windows or Linux library, so the
  earlier rule — *a target with no published binary is not a supported target* — would disqualify Windows,
  which the broker must run on. What saves it is that upstream publishes a signed **dependency tarball**, so
  a source build needs no internet access: a Windows artifact is built hermetically, out of band, and
  published like any other file. Zig's major and minor must match the release exactly (`1.0.0` wants
  0.17.0), and `ZIG_GLOBAL_CACHE_DIR` must be a fresh empty directory. The rule that survives is the one
  that mattered: **no toolchain and no network inside the app's build**, whoever produced the binary.
- **The pin is a pair.** The generated bindings and the binary must come from the same upstream commit; the
  `-sys` crate enforces this by having no prebuilt for any target when the commits differ. This repository
  already knows that shape: it is `vendor/*.rev` beside a checkout, and the lesson that a pin can name
  something nobody published cost two CI runs.
- **Linux is the one target upstream tells packagers to build from source**, so it is the one whose binary
  we may end up producing. If we do, it is produced out-of-band and published as an artifact like any
  other — never inside the app's build.

**D9 — The promised scrollback is kept by asking the core for twice it.** Settled 2026-11-09 in Phase B,
after I had wrongly recorded it as unkeepable. The core's line limit is a page-granular heuristic whose
floor is the ask less about one page, so asking for `HISTORY_LINES` settles *below* it — 441 rows against
a promised 1,000 after 20,000 lines at 80 columns. `SCROLLBACK_ASKED` is therefore twice the promise, and
`snapshot` caps what it answers at the promise: a window must never be answered with less than its
scrollbar was sized for, and never with more. Both halves are asserted, including at volume, because the
floor is the one that broke and a case feeding barely past the bound passes either way.

**D5 — The collapse is of the parser, not the semantics.** `screen.rs` becomes a thin mapping onto the
core's state. `markers.rs` loses its hand-rolled scanning and keeps its state machine and its contract:
every field is a claim some program made, except `foreground`, which is measured. Nobody should size this
work as "500 lines go away".

**Measured in Phase 0a, after two wrong guesses, and the answer is a union rather than a replacement.**
The core answers every fact through the terminal rather than the parser — `OPT_SEMANTIC_PROMPT` for a
command and the status it finished with, `OPT_PWD_CHANGED` for the reported directory,
`OPT_PROGRESS_REPORT` for OSC 9;4, `DATA_CURSOR_AT_PROMPT` beside them — **but it reads OSC 133 and
`markers.rs` reads OSC 633, and neither reads the other's.** So the scanning does not go: it stays for the
633 family that VS Code's integration emits, and 133 arrives from the core, which this broker misses
today. What also stays is the contract — every field is a claim some program made, except `foreground`,
which the broker measures and the core has no business answering — and the OSC 7 decode, since the core
stores that URI raw and documents that it does not parse it.
[Evidence](../references/evidence/one-vt-core.md), including the two readings this corrects.

**D6 — The protocol stays ours.** `ts-rs` generates the app's TypeScript from the broker's Rust types. A
core handle's shape must not reach the wire, or the app's contract starts tracking a third party's struct
layout. The mapping lives at the edge, and `BrokerScreen` keeps its current fields.

**D7 — One feature set, declared once.** The WASM build can compile out input encoding, search, selection
and Kitty graphics, roughly halving the module, and the omitted functions stay exported and return
`GHOSTTY_UNSUPPORTED`. Compiling search out of one side while the other relies on it turns "one engine" into
"one engine, two configurations", which is the disagreement this goal is buying away. The feature set per
side is declared in one place and asserted (required outcome 4).

### Open decisions


**O3 — answered 2026-11-09: the renderer takes `ghostty-web`, and D2 is retired.** The reasoning that
produced the answer is kept below, because it is what a reader needs to judge the decision rather than
take it on trust; the package's measured API surface, its costs and the inlined wasm are in
[evidence](../references/evidence/one-vt-core.md).

D2 says the renderer takes upstream's WebAssembly module rather than `ghostty-web`, and the plan sizes
Phase R as "one file, 742 lines, plus roughly 35 lines of CSS". **Those two cannot both be true.**
`libghostty-vt` is a terminal emulator, not a terminal widget: `render.h` is "render state for creating
high performance renderers" — it hands you a frame's worth of state and leaves the drawing to you. The
release says outright that GUI features are not part of the library. So taking the module alone means
writing the painter, the input wiring, the selection UI, IME, accessibility and the scrollbar — which is
precisely the part of xterm.js that is not a parser.

`ghostty-web` 0.4.0 is the other end: zero dependencies, ships its own `ghostty-vt.wasm`, and advertises
migration as *"changing your import: `@xterm/xterm` → `ghostty-web`"*. It is the widget. What it is not is
the same build — its README says "the patches are very minimal" and that it "will eventually consume a
native Ghostty WASM distribution once available". That distribution now exists; it does not use it yet.

| | one engine | Phase R's real size | what it buys over today |
|---|---|---|---|
| **upstream's module** (D2) | yes, byte-identical with the broker | a terminal widget: rendering, input encoding, selection, IME, accessibility | identical parses, and a renderer we own |
| **`ghostty-web`** | no — two Ghostty-derived builds, same lineage | close to the plan's estimate | graphemes, complex scripts, XTPUSHSGR, and one fewer hand-written emulator |

**My reading: D2 should go, and the renderer should take `ghostty-web`.** The ownership goal already settled
that the window's parse is *a replica and never an authority* — the broker answers for the screen — so
byte-identical renderer parsing buys less than it appears to, while writing a terminal widget is the
largest single piece of work in this goal and none of it is terminal *emulation*. Phase B still delivers
one engine where it matters, on the side that is the authority. The cost is honest: two Ghostty-derived
builds in the tree until `ghostty-web` consumes the official distribution, which its own README commits to.

Blocks Phase R and nothing else. Phase B is unaffected and proceeds.

**O2 — answered 2026-11-09: yes.** It builds from the signed tarballs, links, and passes all 97 tests on
`x86_64-pc-windows-msvc`; the measurements and the two findings are in
[evidence](../references/evidence/one-vt-core.md). The question as it stood:

The release is settled —
`1.0.0`, tag `vt-1.0.0`, commit `0fa3d577a5614150ff8e2c152de5fb9d5c6d2dec` — and O1 is answered in
evidence. What remains is Windows, and it is now two questions rather than one, because nothing is
published for it: we build the library from the signed source and dependency tarballs, then link it. Upstream
builds with the GNU ABI and states MSVC programs link through the import library, with CI covering that, and
one shipping consumer reports a static MSVC link working. Establish both on the
[Windows VM](../references/guides/windows-development-vm.md) rather than inferring either. Blocks Phase B on
Windows and nothing else.

## Phases

Each phase lists the work as well as the exit condition, because **this document is the whole of what you
read to execute it.** The two deferred documents are history: their status blocks say so, and nothing in
them is a live input. Where their content was worth keeping it is below.

### Phase 0a — does the core agree with what we ship?

**Deliverable:** `libghostty-vt` behind a Cargo feature in `apack-terminal`, with the broker's existing
`insta` snapshot corpus driven through both parsers and every difference decided. No production path
changes; the default feature set is unchanged. Serves required outcome 5 and answers O1.

**Dependencies:** none.

**Work:**

- Choose an exact `libghostty-vt` release. Record its version and the upstream commit its headers come from;
  the two are one pin (D4).
- Add a pinned raw `-sys` crate behind a Cargo feature, default off. No safe wrapper yet — that is Phase B.
- Point the build at an unpacked archive through the crate's prebuilt-directory variable, and confirm the
  build neither downloads nor compiles. Prove this before anything else: it is D4's whole mechanism.
- Write a harness that feeds one byte stream to both parsers and dumps each one's grid, cursor position,
  alternate-screen flag and scrollback contents.
- Run every existing snapshot case through it.
- For OSC 133, OSC 7 and OSC 9;4, call the core's API and record what it reports (O1).

**Done when:**

- Every snapshot case has run under both parsers and each difference carries a decision in evidence: the new
  parser is right, the old one was, or the case was testing our wrapper rather than the parse.
- The corpus is stated to be a conformance corpus rather than a regression net, and anything it does not
  cover that `markers.rs` relies on is named.
- O1 is answered by calling the release, not by reading its documentation.
- A capability the broker needs for which the core returns `GHOSTTY_UNSUPPORTED` is a Phase 0a **failure**,
  recorded with the condition for retrying.

**Why first:** it is the question the predecessor plan could not ask, it is the cheapest to answer, and
every other phase is wasted if the answer is no.

### Phase 0b — does the module load where it has to?

**Deliverable:** a disposable integration proving the WebAssembly module initializes through the app's real
asset route, and a recorded capability matrix for the chosen release. Not a production switch.

**Dependencies:** none. Independent of 0a and runnable beside it.

**Work — the load path.** Follow the real route rather than a shortcut: pack compilation → installed pack
runtime assets → `pack://<id>/builds/<revision>/…` → initialization. Then:

- Show asset inclusion, URL resolution and response MIME type each explicitly.
- Run it in a **packaged** app with **no network**, against the existing content security policy.
- No CDN, no dev-server-only URL, no absolute checkout path, and no policy widening.
- If the pack asset pipeline cannot carry a `.wasm`, make the smallest explicit change and cover the
  installed result.

**Work — the capability matrix.** Record an answer per row against the chosen release, by calling it:

| Contract | What has to be shown |
|---|---|
| Construction and options | Theme, font, cursor, initial dimensions, line endings, and scrollback honouring the broker's handshake number rather than a constant of its own |
| Write completion | When a write has actually been parsed, and whether queued live output stays ordered behind an earlier write |
| Input | Keyboard data, control sequences, Shift+Enter, selection copy, clipboard paste and bracketed paste, through the app's own entry points |
| Events | Resize, selection change and parsed-output notification have supported equivalents |
| Viewport | Scroll position can be read and a pinned/unpinned state restored without depending on a library's DOM class names |
| Addon equivalents | Fitting, link activation, Unicode width and clipboard behaviour — the four xterm addons this app loads. Do not assume any of them has a drop-in |
| Rendering lifecycle | Open, detach, hidden output, reattach, resize and dispose, with no leaked renderer or listener |
| Accessibility | Keyboard focus and assistive text access remain usable in Electron |
| Progress reporting | OSC 9;4. The broker's marker scanner already reads the stream it arrives on, so this is a question about the renderer alone |
| Inline images | Sixel or the Kitty graphics protocol. A capability this app lacks on both engines today, not a parity risk — record it and move on |
| Ligatures | xterm needs an addon that reads font files from disk, which the sandboxed renderer cannot. Record whether the replacement needs anything at all |

**Done when:** the module initializes from an installed pack revision in a packaged build with no network,
and every row above has a recorded answer. A row answered "unsupported" that Phase R depends on is a
blocker named here rather than discovered there.

**Done is not "it worked in development":** this is the half that kills the goal, and it fails only in the
packaged case.

### Phase B — the broker on the core

**Deliverable:** the broker's terminal state, search and marker scanning on `libghostty-vt`, with
`alacritty_terminal` gone. Serves outcomes 1, 4 and 5.

**Dependencies:** Phase 0a's agreement result; O1 and O2 answered.

**Work:**

- Write the safe Rust layer over the pinned `-sys` crate and own it here (D3). Roughly 200 lines; it is
  where this app's semantics attach.
- Map `screen.rs` onto the core's state: the grid, the cursor, which screen is showing, bounded scrollback.
- Replace `markers.rs`' hand-rolled scanning with the core's, and **keep its state machine and its
  contract** — every field is a claim some program made, except `foreground`, which is measured (D5).
- Move the `search` request onto the core's search.
- Remove `alacritty_terminal` from `Cargo.toml`.
- Declare the feature set in one place and add the check that asserts it present (D7).
- Bump `vendor/apack-terminal.rev`, and compare the working tree against the pin before trusting a local
  chain run.

**Done when:**

- `cargo xtask pre-push` passes, the mutation gate included, with every survivor killed or excluded with a
  measured reason.
- The conformance corpus passes with the feature flag removed.
- The protocol's generated types are unchanged, or each change is a deliberate contract change (D6).
- Windows is proven on the VM, not inferred: Job Object tree ownership, the named-pipe ACL and the ConPTY
  paths are the broker's least replaceable code, and they are what a core swap most easily disturbs.
- O2's answer is recorded: whether the release's static library links against the broker's MSVC build.

### Phase R — the renderer on the core

**Deliverable:** `terminal-pool.ts` constructs the core's WebAssembly emulator; the six `@xterm/*`
packages, their CSS import, the addon setup and the bundler's optimizer entries are gone. Serves outcomes
2, 3 and 4.

**Done, except in the app.** The code is in and everything that can be checked without running it passes:
the whole typecheck, `apack pack build`, `check:specifiers`' emulator rule in both directions, and the code
surface's sixteen frontend spec files, 104 cases. Three items below came out differently from how they are
written, and each is recorded in [evidence](../references/evidence/one-vt-core.md) rather than quietly
amended here — the viewport element (there is none, the emulator draws its own scrollbar), the addon
replacements (three stop being dependencies at all) and OSC 52, which the emulator does not surface at all
and which the pool now reads out of the output itself. What is left is Phase A's: nothing has been run in the app, and the question
only the app can answer is whether this emulator opens into the pool's detached wrapper and survives being
re-parented, since `open()` needs a 2D canvas context and jsdom has none.

**Dependencies:** Phase 0b's packaged load and its capability matrix. **Phase B is not a dependency** — the
two sides land independently, which is a property of the split being real.

**Work — initialization and lifetime.** This is where the defects live, so it is itemised:

- Share one initialization per renderer realm; expose loading and failure to the terminal UI. An
  initialization failure must produce neither an unhandled rejection nor an indefinitely blank terminal.
- Make pool creation await readiness, and deduplicate concurrent requests for one terminal id.
- A close, actor teardown or host unmount **during** initialization must not attach a stale wrapper,
  resurrect a closed entry, leak a subscription, or send input to a replaced process.
- Keep exactly one output subscription and one input registration per entry.
- Guard every asynchronous completion callback against an entry that has been disposed or replaced.
- Preserve the PID-change notice, the loading banner and its replacement on first byte, background parsing,
  scroll ownership, and close and disposal.

**Work — the seam and the hosts:**

- `TerminalAttachment`'s ten methods keep their current behaviour; the specs that cover them are the proof.
- Replace the four addons with the equivalents Phase 0b proved: fitting, link activation, Unicode width,
  clipboard. Do not assume any loads unchanged.
- Keep external links on the app's `openLink` path and its URL policy. Test OSC clipboard and link
  behaviour rather than widening a permission to reach parity.
- Have the attachment expose its viewport element, and delete the `.xterm` and `.xterm-viewport` CSS from
  both Vue hosts. No component names another library's DOM.
- Fit only after attachment to a visible host with nonzero dimensions; never send a zero-sized pty
  dimension. Verify panel toggles, tab moves, window resize, font loading and display-scale changes.
- Restore history position after a tab switch, and keep the user pinned to the bottom only if they already
  were.

**Work — removal:**

- Delete the six `@xterm/*` dependencies, the CSS import, the addon setup, `vite.config.ts`'s optimizer
  entries and the obsolete types.
- Update the three specs that mock xterm, including the xterm-loading comment in
  `tests/features/code/fe/terminal-opens-for-the-asker.spec.ts`.
- Leave `xterm-256color` as the advertised `TERM` unless capability testing requires otherwise: it is a
  terminfo name, not a dependency.

**Done when** every item above holds and no `@xterm` specifier remains outside this goal's own history.

**Carried into Phase A:** the detached-wrapper question above, and one measurement with a number
already attached — the emulator's JavaScript fell from 502 KiB to 134, while the bundle grew 184 KiB,
because the 414 KiB WebAssembly module is inlined as 552 KiB of base64 by the package's own library build.
The package exports the module as a file too, and Phase 0b proved that route end to end, so moving it there
is the one optimisation here that is already costed.

### Phase A — acceptance and cutover

**Deliverable:** one engine per side in a packaged app, with measured before-and-after and every remaining
limitation recorded.

**Dependencies:** Phases B and R.

**Work — behaviour, both hosts:**

- Ordinary shell output, long scrollback, alternate-screen programs (`vim`, `less`, a representative agent
  TUI), cursor motion, ANSI colour, emoji, combining characters, CJK, IME, selection, links, mouse input.
- Ctrl+C, Ctrl+D, arrows, multiline and bracketed paste, copy shortcuts, focus return.
- Both paste paths: the terminal's own and `apack:paste`.
- Visible and hidden output, repeated tab switches, a backend restart, a terminal restart and kill, and
  several windows — without changing pty ownership semantics.

**Work — measurement.** On one machine, one Electron build and one output corpus: first-open latency
including module initialization, sustained-output responsiveness, large-history behaviour, memory with
several hidden sessions, resize, and packaged payload size. **Agree the acceptance limits from the baseline
before cutover**, not after seeing the numbers.

**Work — gates and closure:**

- `npm run chain`, the `test:smoke` e2e gate, and the packaged install path.
- Update `docs/references/terminal-broker.md` and the root guide's terminal-stack description to the
  contract that shipped.
- Write Outcome, archive this goal and both deferred documents, and repair links.

**Done when:**

- Every behaviour above passes and the measured figures sit inside the agreed limits.
- No dual engine and no permanent fallback. A blocker leaves the current engine in production **on that
  side**, recorded with its failing case, and the other side still ships.

## Acceptance and evidence

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| Broker on `libghostty-vt`, `alacritty_terminal` gone | **done, and the pin is moved** | `pre-push` green on the merged commit, 135 tests and 61 mutants with none missed; 97 tests on Windows MSVC; [evidence](../references/evidence/one-vt-core.md) | — |
| Window on the same core's WASM, `@xterm/*` gone | **done, and drawn in the app** | typecheck, pack build, `check:specifiers`, 113 cases, and a driven run: opens detached, draws, survives a re-parent; [evidence](../references/evidence/one-vt-core.md) | the fuller behaviour pass |
| No Zig, no compile-time network, no run-time CDN | **held, with one finding** | the broker links a library supplied to the build (`vt-prebuilt` fetches and verifies; Windows is built out of band from the signed tarballs); the renderer's module is inlined in the package it comes from | the crate's prebuilt-directory hatch asserts a POSIX file name, so Windows runs it only with a copy under that name — [evidence](../references/evidence/one-vt-core.md) |
| Every relied-on capability asserted present | missing | — | D7's declaration and its check |
| Conformance corpus passes, or each difference decided | **done** — and the snapshots now hold the core to the old parser's output | ten cases; [evidence](../references/evidence/one-vt-core.md#2026-11-09--phase-0a-passes-the-two-parsers-agree-with-three-decided-differences) | — |
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
