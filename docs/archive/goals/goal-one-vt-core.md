# One VT core

Status: **complete**, 2026-11-09. See Outcome below.

The startup prompt is kept as it was written, because what it authorized — Phase 0 alone, with the rest
conditional on Phase 0's answer — is the shape of how this goal ran, and a prompt rewritten after the fact
would hide that the authorization widened as each phase answered.

## Outcome (2026-11-09)

**One VT core, on both sides.** The broker parses with `libghostty-vt` 1.0's static library and
`alacritty_terminal` is gone from its manifest and its lockfile; the window draws with the same release's
WebAssembly build through `ghostty-web` and the six `@xterm/*` packages are gone from this repository.
`vendor/apack-terminal.rev` names the merged broker. `xterm-256color` stays as the advertised `TERM`,
being a terminfo name and not a dependency.

**What that buys is one answer to what a sequence means**, which is the claim the goal was for. It does
not make the window's screen an authority — the broker is still fed first and still answers for a session
nobody is drawing — and the reference docs say so in those terms.

21 commits here and 13 in `apack-terminal`.

### Per phase

| Phase | Status | Evidence |
|---|---|---|
| **0a** — do the two parsers agree? | done | eight grids identical over the broker's own corpus, the single-byte-boundary property holding for the new wrapper alone, and three differences each decided. One of them found a **pre-existing defect**: the broker read OSC 633 and not the standard OSC 133 |
| **0b** — does the module load where it has to? | done | a pack's WebAssembly module instantiates in a packaged app from the installed revision over `pack://`, streaming and buffered. An imported module is the wrong mechanism; a public asset needed no build change |
| **B** — the broker on the core | done | `cargo xtask pre-push` green on the merged commit: 135 tests, 61 mutants, 58 caught, 3 unviable, **none missed**. Windows proven on the VM: built from the signed tarballs with Zig 0.17.0 and `--system`, linked, 97 tests, with Job Object tree ownership, the named-pipe ACL and the ConPTY `ESC [ 6 n` startup each re-proven by name |
| **R** — the window on the core | done | the whole typecheck, `apack pack build`, `check:specifiers`' emulator rule in both directions, and the code surface's sixteen frontend spec files |
| **A** — acceptance | done | `npm run chain` (3421.9s, all 32 steps, building what CI clones), `test:smoke`, the packaged install path and the broker's `pre-push` all green; **both** behaviour scripts driven against the built app on the new broker and the new renderer together; the five scenarios measured on an idle machine; five defects found by running it |

**The figures were taken, and one acceptance clause is unsatisfiable rather than unsatisfied.**

`terminal-open`, three runs on a machine `npm run check:idle` accepted, against the ownership goal's
baseline recorded before any of this on the same machine identity and the same build identities:

| | median | range |
|---|---|---|
| baseline, pre-cutover | **20.7 ms** | 18–25 |
| after | **14.8, 14.7, 15.6 ms** | 13.2–20.3 |

**Opening a terminal is about 28% faster**, and every maximum sits below the baseline's median. The three
medians span 0.9 ms; under load the same configuration had spanned 13.7, which is the difference between a
figure worth quoting and one that is not. Not all of it is parser — the window does less on attach now,
with no WebGL context and no addon stack — and this scenario measures attachment.

The other four scenarios were taken too, and are readings rather than comparisons, the ownership goal
having recorded no pre-cutover figure for any of them: sustained output 1126.1 ms, hidden sessions 17.5,
resize 28.7, large-history replay 4.6, all 20 of 20 passing, conditions in
[evidence](../../references/evidence/one-vt-core.md).

**And the acceptance clause is met, 2026-11-10.** It asked for figures inside limits agreed from the
baseline before cutover; none were agreed, so the owner adopted the **pre-cutover baseline's own recorded
figures** as the limit — median ≤ 20.7 ms and maximum ≤ 25, read unchanged from the ownership goal's
record, taken before this work by a different goal. All three runs are inside both halves of it.

That the number's provenance predates this work is what makes the check real rather than a formality, and
the limit carries the baseline's conditions with it: three of the four runs taken earlier under load had
maxima of 57, 69 and 84 ms and would have failed it. The four scenarios with no pre-cutover figure get no
limit, because deriving one from this goal's own numbers is exactly what the clause existed to prevent.

### What running the app was worth

**Five defects, none of which a spec caught, and three of which the specs *could not* have caught as they
stood.** They are listed because the pattern is the lesson rather than any one of them:

| | what it was |
|---|---|
| link providers registered before `open` | every terminal failed; the emulator refuses almost everything before `open` and says so |
| `write('', cb)` as a wait primitive | `RangeError` twice per attach; this emulator parses *inside* `write` and its callback is only a `requestAnimationFrame` |
| the broker binary overwritten in place | macOS kept a signature cached against the old file and SIGKILLed every later run; a byte-identical copy at another path ran |
| snap-to-bottom on every write | a session scrolled back was dragged to the end by output it was not reading |
| a suppression flag raised too late | the host was told a session had started following at the moment output took it there |

Three of those were cases where **the stand-in was the thing that was wrong**: it accepted an empty write,
an ordering and a silent scroll that the real emulator does not. Each stub was taught the real behaviour,
and each fix fails exactly the case it should when reverted.

### The findings, which are not defects

- **`ghostty-vt-rs-sys` 0.3.0's source build cannot run offline.** It passes `zig build` a
  `--global-cache-dir` that Zig 0.17.0 rejects, and only on the branch that supplies packages from the
  dependency tarball — so the one hermetic route is the one that fails. Not in our way; we do not build the
  library during `cargo build`.
- **D4's mechanism is POSIX-shaped.** `GHOSTTY_VT_RS_SYS_PREBUILT_DIR` asserts a `lib/libghostty-vt.a` that
  no Windows build produces, Zig installing `ghostty-vt-static.lib` — which is also the name the crate's own
  link directive uses there. The decision holds; the claim that one environment variable delivers it
  everywhere does not.
- **`ghostty-web` is less capable than what it replaced in two places.** It surfaces no OSC 52, and it snaps
  the view to the bottom on every write. Both are compensated for in this repository, and both should be
  re-measured rather than assumed still needed if the package takes the official distribution.
- **The emulator's JavaScript shrank and the bundle grew.** 502 KiB of `@xterm/*` became 134 KiB of
  `ghostty-web`, and the bundle gained 184 KiB because a 414 KiB WebAssembly module is carried as 552 KiB
  of base64 by the package's own library build. The package exports it as a file too and Phase 0b proved
  that route, so the one optimisation here already has its number.

### What this change made measurable

The previous engine drew through WebGL and left no text in the DOM, and the terminal-ownership evidence
recorded more than once that whether the screen was intact could only be judged by eye. This one draws to a
**2D** canvas, so a page can read its pixels — which is how the snap-to-bottom was established and then
shown fixed, by fingerprinting the canvas rather than looking at a screenshot. "The terminal is blank" and
"the view moved" stop being things only a human can notice.


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
ownership](goal-terminal-ownership.md) made that arrangement safe rather than correct: the
broker is the authority, the renderer is a replica, and a disagreement is therefore stale rather than wrong.
Safe is as far as two implementations can be taken.

**The condition for taking it further was named, and it is now met.** The
[ghostty-web migration](../plans/xterm-to-ghostty-web.md) closes with the question it could not answer:

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
  [terminal-broker.md](../../references/terminal-broker.md).
- **The agent-observation pipeline**, which [terminal-runtime-refactor-target.md](../../deferred/terminal-runtime-refactor-target.md)
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
  window storage were deleted as F3, F6 and F11 ([evidence](../../references/evidence/terminal-ownership.md)),
  and the guards are mutation-checked. Phase 1's requirement to suppress emulator-generated DA/DSR replies
  *during historical replay* has no subject.
- *The migration target is `coder/ghostty-web`.* That package is 0.4.0 and its own README says it will
  "eventually consume a native Ghostty WASM distribution once available". It carries its own
  Ghostty-derived parser, so adopting it would give this repository **three** parsers. See Decisions.

## Current handoff

**Closed.** The Outcome above is the account; this section records only the end state of the checkouts,
because that is the part a reader cannot derive from the Outcome.

- **This repository** on `master`. The window draws with `ghostty-web`, the six `@xterm/*` packages are
  gone, and `vendor/apack-terminal.rev` names `26e6583`.
- **The broker**: `vt-core/conformance` merged to `master` in `apack-terminal`, which is what the pin names.
  The worktree `apack-terminal-worktrees.noindex/vt-core` can go; the main checkout is on `master` and holds
  the pin.
- **Both repositories are pushed and the pin reaches the packaging fix.** For most of this goal it could
  not: a pin cannot name a commit nobody can fetch, so a local chain built the sibling's working tree while
  CI would have cloned a pin without the fix. The chain said so on its own result line every run, which is
  the line to read rather than this one.
- **The driving scripts are not in the tree.** `drive/.gitignore` keeps everything but the README and the
  Playwright config, so `terminal-core-swap.ts` — which opens a terminal, reads the canvas, and fingerprints
  it either side of a write — exists only where it was written. What it asked and what it answered is in
  [evidence](../../references/evidence/one-vt-core.md); rebuilding it from that is a few minutes and is how
  the two compensations should be re-measured.

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
[evidence](../../references/evidence/one-vt-core.md). **The wasm arrives inlined as a base64 data URL**, so
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
[Evidence](../../references/evidence/one-vt-core.md), including the two readings this corrects.

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
[evidence](../../references/evidence/one-vt-core.md).

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
[evidence](../../references/evidence/one-vt-core.md). The question as it stood:

The release is settled —
`1.0.0`, tag `vt-1.0.0`, commit `0fa3d577a5614150ff8e2c152de5fb9d5c6d2dec` — and O1 is answered in
evidence. What remains is Windows, and it is now two questions rather than one, because nothing is
published for it: we build the library from the signed source and dependency tarballs, then link it. Upstream
builds with the GNU ABI and states MSVC programs link through the import library, with CI covering that, and
one shipping consumer reports a static MSVC link working. Establish both on the
[Windows VM](../../references/guides/windows-development-vm.md) rather than inferring either. Blocks Phase B on
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
written, and each is recorded in [evidence](../../references/evidence/one-vt-core.md) rather than quietly
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

**The limits, adopted 2026-11-10.** No limits were agreed before cutover, so the goal's owner adopted the
**pre-cutover baseline's own recorded figures** as the limit for the one scenario that has a baseline:

> `terminal-open`: **median ≤ 20.7 ms and maximum ≤ 25 ms**, measured as the baseline was — 20 trials,
> five warmups, `lightweight`, on a machine `npm run check:idle` accepts at the 70% floor.

**Where the number comes from matters more than the number.** It is
[the ownership goal's recorded measurement](../../references/evidence/terminal-ownership.md), taken before
any of this work by a different goal, and it is adopted unchanged — not a threshold picked after seeing
these results. The four scenarios with no pre-cutover figure get no limit, because inventing one from
this goal's own numbers is the thing the clause existed to prevent.

**Done when:**

- Every behaviour above passes and the measured figures sit inside those limits.
- No dual engine and no permanent fallback. A blocker leaves the current engine in production **on that
  side**, recorded with its failing case, and the other side still ships.

## Acceptance and evidence

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| Broker on `libghostty-vt`, `alacritty_terminal` gone | **done, and the pin is moved** | `pre-push` green on the merged commit, 135 tests and 61 mutants with none missed; 97 tests on Windows MSVC; [evidence](../../references/evidence/one-vt-core.md) | — |
| Window on the same core's WASM, `@xterm/*` gone | **done, and drawn in the app** | typecheck, pack build, `check:specifiers`, 113 cases, and a driven run: opens detached, draws, survives a re-parent; [evidence](../../references/evidence/one-vt-core.md) | the fuller behaviour pass |
| No Zig, no compile-time network, no run-time CDN | **held, with one finding** | the broker links a library supplied to the build (`vt-prebuilt` fetches and verifies; Windows is built out of band from the signed tarballs); the renderer's module is inlined in the package it comes from | the crate's prebuilt-directory hatch asserts a POSIX file name, so Windows runs it only with a copy under that name — [evidence](../../references/evidence/one-vt-core.md) |
| Every relied-on capability asserted present | missing | — | D7's declaration and its check |
| Conformance corpus passes, or each difference decided | **done** — and the snapshots now hold the core to the old parser's output | ten cases; [evidence](../../references/evidence/one-vt-core.md#2026-11-09--phase-0a-passes-the-two-parsers-agree-with-three-decided-differences) | — |
| Windows unaffected: job objects, pipe ACL, ConPTY | holds today | [terminal-ownership.md](../../references/evidence/terminal-ownership.md) | Re-prove on the VM in Phase B |

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
- **An xterm-compatible shim**, if an xterm-shaped surface proves worth having after Phase R (D2). Moot as
  delivered: `ghostty-web`'s API *is* xterm's, so the shim would have nothing to adapt.

### Two compensations to re-measure, not to keep forever

These are not deferred features and **none is outstanding work**: each is in place, covered by cases and
proven in the running app. What is recorded is the *condition under which to revisit* them, which is the
same for all three — `ghostty-web` taking the official distribution, which its README commits to, or
fixing the behaviour itself. Until one of those happens there is nothing here to do.

- **OSC 52.** The package surfaces none, so `terminal-pool.ts` reads clipboard requests out of the output
  itself. If the package gains it, this should go rather than run beside it, or a program's copy lands on
  the clipboard twice.
- **The snap to the bottom.** The package scrolls the view to the end on every write once the user has
  scrolled back, and the pool puts it back. **Re-measure with the canvas fingerprint** rather than reading
  the source: that is how it was established and how it was shown fixed.
- **The inlined WebAssembly module.** 552 KiB of base64 in the pack's frontend bundle, against 414 KiB as a
  file over `pack://` — a route Phase 0b proved end to end, down to the `application/wasm` MIME entry it
  added. The package exports the module as a file, and `init`'s own documentation describes handing a
  `Ghostty` to a `Terminal`, which is the seam for it.

## Constraints

- Standing repository rules apply as written: no backward-compatibility shims, `npm run chain` as the gate,
  and every deadline a declared class rather than a multiple of a measurement.
- The broker is a pinned sibling checkout. A change to it moves `vendor/apack-terminal.rev`, and the local
  chain tests the working tree while CI clones the pin — compare them before trusting a run.
- Native execution belongs in the Linux test container, and Windows verification on the approved VM. Neither
  is a CI dispatch per experiment.
- The [terminal integration review](../../issues/ISSUE-terminal-integration-review.md) is dated investigation
  material. Its findings were closed by the ownership goal; recheck anything cited from it against current
  code.
