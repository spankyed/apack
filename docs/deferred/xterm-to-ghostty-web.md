# Migrate the embedded terminal from xterm.js to ghostty-web

Status: **superseded by [goal-one-vt-core](../goals/goal-one-vt-core.md)**, which owns this work and
authorizes its first phase. This document authorizes no implementation.

Two of its premises have since changed, which is why the goal restates the work rather than activating this
plan. **Its central open question is answered**: `libghostty-vt` 1.0 shipped on 2026-11-06 with a stable C
ABI, so the one engine the last section calls unpurchasable is purchasable, and the broker is in scope after
all. **And its target package is the wrong artifact**: `ghostty-web` carries its own Ghostty-derived parser
and its README says it will consume a native WebAssembly distribution once one exists — which now exists,
published per release by upstream. Taking the package would leave this repository with three parsers.

What remains sound here is the capability matrix, the packaged-WebAssembly proof and the phase-3 corpus,
which the goal consumes by reference. What is stale is the inventory: the host-facing seam the plan says
needs building was built by the ownership goal, and the historical replay its Phase 1 guards against was
deleted (F3, F6, F11).

**This is now the follow-on, not the predecessor.**
[goal-terminal-ownership](../archive/goals/goal-terminal-ownership.md) decided to keep xterm.js and put emulator
replacement out of its scope, so the order this document originally named is inverted: ownership moves
first, and that goal's presentation phase builds the seam this migration becomes an implementation swap
behind. Two consequences worth knowing before activation. The pool this document calls its primary
replacement point will no longer exist in the shape described here — a session owns the emulator through a
narrow seam, which is less to replace, not more. And the renderer's parse is a **replica**, never an
authority: the broker owns terminal facts, so this migration no longer has to prove that a browser engine
can be the source of truth for them.

One pairing becomes available only here: a native Ghostty core and a ghostty-web renderer share a lineage
and so cannot disagree about a screen. The goal's D11 chose a Rust VT crate precisely because that benefit
was not purchasable while the renderer is xterm.js, and named the snapshot contract's missing
binary-compatibility guarantee as what to weigh against it. That is the trade to reopen at activation.

Written 2026-10-21 against the current checkout. Re-audit source paths and the selected upstream release
before starting.

## Objective and scope

Replace the embedded terminal emulator with `ghostty-web` in both the Code canvas and terminal panel.
Preserve terminal interaction, session lifecycle and shell I/O while removing the xterm runtime and its
addons. Potential gains in emulation correctness and rendering must be demonstrated locally; this plan
does not assume a speedup or that the browser implementation inherits every native Ghostty feature.

Keep the `apack-terminal` broker, terminal actors/events, backend process ownership and current terminal
records unless a specific migration blocker requires an explicitly scoped change. The pty is the broker's
and the emulator is the renderer's, so this migration replaces one side of that split and neither crosses it. Agent CLI execution is a separate path.
Do not combine this migration with a persistence rewrite, PTY multiplexing, shell integration redesign or
the broader fixes proposed in the [terminal integration review](../issues/ISSUE-terminal-integration-review.md).
That review is dated investigation material; recheck its findings against current code before using them.

## Current integration

Paths below are relative to the repository root.

| Area | Current responsibility | Migration implication |
|---|---|---|
| `packages/default-setup/src/features/code/fe/utils/terminal-pool.ts` | One long-lived emulator and wrapper per terminal ID per renderer; output subscription, initial replay, input, addons, process restart notice, attach/detach, scroll restoration and disposal | Primary replacement point; preserve ownership and lifecycle behavior |
| `packages/default-setup/src/features/code/fe/canvas/TerminalView.vue` | Canvas host, selection/menu actions, fitting, resize forwarding, scroll tracking | Replace xterm types and viewport assumptions |
| `packages/default-setup/src/features/code/fe/features/terminal/PanelTerminalSection.vue` | Panel host with its own fitting, event listeners and terminal actions | Migrate together with the canvas |
| `packages/default-setup/src/features/code/fe/utils/terminal-events.ts` | Output delivery, in-memory history and debounced localStorage persistence | Retain stream/history contract; verify replay ordering |
| `packages/default-setup/src/features/code/be/services/terminal.ts` | PTY creation, input, output, resizing and restore | Retain backend; test emulator responses and dimension propagation |
| `packages/default-setup/package.json`, `package-lock.json` | xterm plus fit, web-links, unicode11, clipboard and WebGL addons | Replace dependencies after parity is established |
| `packages/renderer/vite.config.ts` | Explicit xterm/addon dependency optimization entries | Remove obsolete entries; establish dev loading for the replacement |
| `packages/main/src/modules/pack-protocol/PackProtocol.ts` and pack build tooling | Installed frontend asset delivery through `pack://` | Prove WASM ships and loads from the accepted pack revision |

The pool currently exposes raw emulator/addon types to both hosts. It also reads `.xterm-viewport` and
uses parsed-write callbacks plus DOM scroll positioning to survive reparenting. These are concrete
dependencies to replace, even if many public methods have matching names upstream.

## Upstream assumptions to verify

The [upstream README](https://github.com/coder/ghostty-web/blob/main/README.md) describes an
xterm-compatible browser API over a Ghostty-derived WASM parser and shows awaiting `init()` before
constructing a terminal. Its [manifest](https://github.com/coder/ghostty-web/blob/main/package.json)
is the starting point for inspecting the published entry points and WASM asset.

At activation, select and record an exact published release and corresponding source revision. Inspect
its declarations and implementation rather than treating compatibility claims as proof. Confirm license
and redistribution requirements for the shipped JavaScript/WASM. Do not build a native Ghostty embedding
or require end users to install Ghostty.

## Phase 0 — compatibility and packaging spike

Deliverable: a small disposable integration exercising the real pool/host path, plus a recorded
capability matrix for the selected release. No production switch until this phase passes.

Check these behaviors against actual upstream APIs:

| Contract | Required proof |
|---|---|
| Construction and options | Theme, font, cursor, initial dimensions, line endings and 10,000-line scrollback behave as intended |
| Output completion | Identify when writes have actually been parsed, when generated replies fire, and whether queued live output remains ordered after replay |
| Input | Keyboard data, control sequences, Shift+Enter, selection copying, clipboard paste and bracketed paste work through app entry points |
| Events | Resize, selection and parsed-output notifications have supported equivalents |
| Viewport | Observe scroll position and restore pinned/unpinned state without depending on xterm DOM classes |
| Addon replacements | Identify supported fitting, link activation, Unicode width and clipboard behavior; do not assume xterm addons load unchanged |
| Inline images | Does the release draw sixel or the Kitty graphics protocol? xterm answers only with `@xterm/addon-image`, which this repo does not ship, so neither engine has it today and a WASM parser port may answer for neither. A capability we lack, not a parity risk |
| Progress reporting | OSC 9;4. The broker's marker scanner already reads the stream a shell emits it on, so this is a question about the renderer alone |
| Ligatures | xterm needs `@xterm/addon-ligatures`, which reads font files from disk and so needs a Node path rather than the sandboxed renderer. Record whether the replacement needs anything at all |
| Rendering lifecycle | Open, detach, hidden output, reattach, resize and dispose work without leaked renderers or listeners |
| Accessibility | Keyboard focus and assistive text access remain usable in Electron |

Prove the WASM load path in development and an installed packaged app, offline. Follow the real route:
pack compilation → installed pack runtime/assets → `pack://` revision URL → WASM initialization. Check
asset inclusion, URL resolution, response MIME type and the existing content security policy. Use the
selected release's supported initializer/asset configuration; determine that API before designing it.
Do not rely on a CDN, a dev-server-only URL, an absolute checkout path or a permissive policy change.

Stop and retain the deferred plan if replay completion, required interaction, accessibility or packaged
WASM loading has no acceptable solution. Record missing upstream capabilities and the condition for
retrying rather than silently dropping them or keeping two production engines.

## Phase 1 — initialize the replacement and migrate the pool

Deliverable: one ghostty-web implementation owned by the existing terminal pool, with packaged assets.
Depends on Phase 0 proving initialization, lifecycle and output ordering.

1. Add the selected dependency and ship WASM through the pack's existing asset/build ownership. If that
   path needs support for WASM assets, make the smallest explicit change and cover the installed result.
2. Share initialization within a renderer realm. Expose loading/failure to the terminal UI; handle
   initialization failure without an unhandled rejection or indefinitely blank terminal.
3. Make pool creation await readiness. Deduplicate concurrent requests for one terminal ID. A close,
   actor teardown or host unmount during initialization must not attach a stale wrapper, resurrect a
   closed entry, leak subscriptions or send input to a replaced process.
4. Preserve exactly one output subscription and input forwarding registration per entry. Define a
   history/live-output boundary while initialization is pending so bytes are neither lost nor replayed
   twice. Suppress emulator-generated DA/DSR/OSC responses during historical replay, then enable live
   responses at the proven parse boundary. Do not substitute an arbitrary timeout.
5. Preserve PID-change notices, loading-content replacement, background parsing, scroll ownership and
   close/disposal. Guard asynchronous completion callbacks against disposed or replaced entries.
6. Replace xterm addon setup with the proven equivalents. Keep external links on the app's `openLink`
   path and existing URL policy. Test OSC clipboard/link behavior rather than widening permissions to
   achieve parity. Remove WebGL-specific lifecycle fields if the replacement does not need them.

Keep any host-facing interface small and local to this feature, covering operations its callers use.
Avoid a general terminal framework, compatibility shims or a runtime engine-selection flag.

## Phase 2 — migrate both hosts and remove xterm

Deliverable: canvas and panel use the new pool successfully; no runtime xterm dependency remains.
Depends on Phase 1 establishing the pool's readiness and disposal contract.

- Update both Vue hosts for asynchronous creation and cancellation. Preserve focus, context-menu
  selection/copy/paste/select-all/clear actions, resize forwarding and scroll-to-bottom controls.
- Replace `.xterm` styling and direct `.xterm-viewport` access with supported replacement APIs or a
  narrowly owned viewport implementation validated in Phase 0. Restore history position after tab
  switches; keep users pinned only when they were already at the bottom.
- Fit only after attachment to a visible host with nonzero dimensions. Verify panel toggles, tab moves,
  window resizing, font loading and display scale changes; never send zero-sized PTY dimensions.
- Recheck both paste paths: normal terminal paste and `apack:paste`, as well as custom keyboard shortcuts.
  Preserve current behavior where intentional; document any deliberate correction separately.
- Remove all six xterm packages, their CSS import, addon setup, optimizer entries and obsolete types.
  Update affected mocks and the xterm-loading comment in
  `packages/default-setup/tests/features/code/fe/terminal-opens-for-the-asker.spec.ts`.
  Update the root architecture guide's terminal stack description once implementation lands.
- Retain `xterm-256color` as the PTY terminal name unless capability testing requires a different
  advertised contract. It is a terminal capability identifier, not an npm dependency to rename.

## Phase 3 — acceptance and cutover

Deliverable: one replacement engine passes integration and packaged-app acceptance, with evidence of
remaining limitations. Depends on both hosts and installed assets being migrated.

Add focused behavioral coverage for replay suppression/order, delayed initialization plus live output,
close-before-ready, concurrent creation, detach/reattach, restart notices and final disposal. Mocks can
verify ownership and cancellation; use the real emulator in a browser/Electron for parsing, rendering,
keyboard, viewport and WASM assertions. Extend the existing requester-routing specs only if their
contracts are affected; a renderer change must not redirect terminal creation to a different requester.

Exercise both hosts with normal shell output, long scrollback, alternate-screen programs (for example
`vim`, `less` and a representative agent TUI), cursor motion, ANSI colors, emoji, combining characters,
CJK, IME, selection, links and mouse input. Include Ctrl+C, Ctrl+D, arrows, multiline/bracketed paste,
copy shortcuts and focus return. Check visible and hidden output, repeated tab switches, backend
restart, terminal restart/kill and multiple windows without changing existing PTY ownership semantics.

Capture before/after results using the same machine, Electron build and output corpus: first-open
latency including WASM, sustained output responsiveness, large-history replay, memory with several
hidden sessions, resize behavior and packaged payload size. Agree concrete acceptance limits from the
baseline before cutover; investigate material regressions rather than claiming native-Ghostty speed.

During implementation use `npm run spec` for affected behavioral tests, then `npm run chain` for the
repository's declared checks. Use `npm run test:e2e -- <relevant-spec>` for Electron coverage and the
repository's documented packaging path for offline installed-app verification. Validate supported
platforms, using the [Windows VM workflow](../references/guides/windows-development-vm.md) where needed.
Passing unit tests alone does not establish packaged WASM loading or terminal interaction parity.

Cut over once all required cases pass, with no dual engine or permanent fallback. If a blocker remains,
leave xterm as the production engine and record the failing case. After delivery, update current
terminal reference documentation, record verification evidence and archive this completed plan.

## Open decisions for activation

- Which exact release satisfies the capability matrix, and what gaps need upstream changes?
- How does that release expose write completion, viewport state, fitting and accessibility?
- Can the existing pack asset pipeline deliver its WASM unchanged, or is a targeted build change needed?
- What measured regression limits determine whether the migration is acceptable?
- **Is one engine purchasable?** This repo parses the same bytes twice — `alacritty_terminal` in the broker,
  for search, snapshots and the markers, and the window's emulator again for drawing. The paragraph above on
  shared lineage is only buyable if libghostty's VT core exposes a C API a Rust broker can bind. If it does,
  `alacritty_terminal`, its `vte` and much of `markers.rs` collapse into one implementation and the two
  halves cannot disagree about a screen. If it does not, two engines is the permanent state and D11's choice
  of a Rust VT crate stands as decided. Answer this in Phase 0, because it decides whether the broker is in
  this migration's scope at all — and until it is answered, do not refactor the broker's parser onto `vte`,
  which would couple the marker scanner to the crate most likely to leave.

The next checkpoint is Phase 0's capability matrix and offline packaged-WASM proof. No implementation,
dependency change or commit is part of writing this deferred plan.
