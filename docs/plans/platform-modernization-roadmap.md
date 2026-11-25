# Platform Modernization Roadmap

*Updated 2026-11-23 · Continuous numbering (`#1`–`#26`), ordered by execution phase.*  
**Size:** `S` (hours) · `M` (days) · `L` (1–2+ weeks)

> [!IMPORTANT]
> **Cutover guard:** Until Phase 3 (`@apackdev/state` + `@apackdev/link` cutover) lands, avoid broad mechanical edits (lint autofixes, annotation passes, `afterEach` scrubs) across the ~132 XState specs and ~27,500 lines of machine definitions so every edit doesn't become a merge conflict on the cutover branch.

---

## Phase 1 — Land & Foundation (now, zero conflict with cutover)

| # | Work Item | Size | Scope |
|---|---|---|---|
| 1 | ~~**Merge PR #632 & PR #633**~~ *(Done — merged on `master`)* — Node 24 / `erasableSyntaxOnly` follow-ups (`#632`) and [singleton-free-test-harness.md](singleton-free-test-harness.md) (`#633`). | S | `monorepo` |
| 2 | **Run full gate on `master`** — `npm run chain` / CI (Linux `test:native`, full `test:integration`, `test:e2e`) to baseline post-#628/#632. | S | `monorepo` |
| 3 | ~~**Split `@apackdev/sdk` along the runtime vs. format/compiler seam**~~ *(Done — PR `#641`, `#644`, and stacked workspace extraction PR)*:<br>• **`@apackdev/sdk`**: zero Zod, zero Ajv, zero compilers (`dependencies`: `@elmdb/ears` only; zero `zod`/`ajv` in `package.json` or any `etc/*.api.md` report) — plain TS interfaces + runtime APIs + service-free `BackendHostPort` + tiny zero-dep authoring helpers (`entry`, `on`, `ActionMeta`, `PromptMeta`, `FlowDSL`, pure `_settingsJsonProblems`).<br>• **`@apackdev/pack-format`** *(Workers-safe, pure JS — verified zero `node:*` builtins and zero `ajv` via neutral-platform esbuild test, pure-JS SHA-256 `_declarationRevision`)*: Zod manifest & snapshot schemas (with strengthened compile-time `_Exact`/`_ExactReadonly` lock against `@apackdev/sdk` plain interfaces), `PACK_LAYOUT`, `semver` host compatibility (`isHostCompatible`), `apack.schema.json`.<br>• **`@apackdev/pack-build`** *(Node-only workspace package, inlined into `@apackdev/cli` & `@apackdev/testing`)*: codegen (`generate-entries`), content compilers, settings types, `json-schema-to-typescript`, `mdast-*`, `yaml`, `esbuild`, `typescript`.<br>• **`ajv` settings compilation** relocated to `@apackdev/host` (`features/settings/compile.ts`, inlined into `@apackdev/cli`) and removed from `ManifestSchema.superRefine`; duplicate FE structural grammar removed from [frontend-admission.ts](../../packages/apack-host/src/fe/frontend-admission.ts).<br>• **Measured impact (2026-11-25, cold `tsc`/`vue-tsc --extendedDiagnostics --listFiles --incremental false`):** `packages/preload` dropped `node_modules/zod/` `109 → 0`, `ai` `4 → 0`, Files `595 → 426` (`-28.4%`), Types `53,617 → 37,929` (`-29.3%`), Instantiations `164,200 → 112,366` (`-31.6%`), Total `1.57s → 1.18s`; `packages/apack-ui` dropped `zod` `110 → 0`, `ajv` `44 → 0`, `ai` `6 → 0`, Files `1,185 → 956` (`-19.3%`), Types `158,107 → 103,746` (`-34.4%`), Instantiations `483,556 → 341,291` (`-29.4%`); Electron renderer Vite prod build (`packages/renderer/dist/`, 180 JS chunks) contains **0 B of Zod** (`ajv` remains in renderer solely via `@apackdev/host/fe` `compileSettingsCatalog` for `SettingsJsonEditor.vue` and `settings-snapshot.ts`). | M | `monorepo` |
| 4 | **Extract root `tsconfig.base.json` (+ `node`/`dom` presets) & drop `baseUrl`** in [packages/main/tsconfig.json](../../packages/main/tsconfig.json) and [packages/preload/tsconfig.json](../../packages/preload/tsconfig.json) — eliminates per-package tsconfig drift and preps for TypeScript 7. | S | `monorepo` |
| 5 | *(Optional pre-cutover win)* **Enable Vitest 4 `test.projects` + `isolate: false`** on already-pure, non-XState, non-`bindHost` suites (`apack-cli` unit, `apack-sdk/tests/{utils,build}`, pure `internal-repo-checks` / `apack-host`), verified with `--shuffle`. | S | `monorepo` |

---

## Phase 2 — Cutover Readiness (2–4 days of de-risking before opening cutover branch)

| # | Work Item | Size | Scope |
|---|---|---|---|
| 6 | **Finalize & pin external kernels:** merge `apack-state`'s `ci-kernel-boundaries` fix and bump its `@apackdev/link` pin (`apack-link` `#25`/`#26`/`#27` and `apack-state` `#31` on `@apackdev/orderings` are already merged on `master`); add `apack-state`, `apack-link`, and `apack-orderings` to [external-packages.mjs](../../scripts/lib/external-packages.mjs), and add `@apackdev/state` and `@apackdev/link` to `SHARED_INSTANCE_PACKAGES` (only packages shared between host and packs; keep test-only `@apackdev/orderings` out of the production bridge). | S–M | 4 repos |
| 7 | **Spike `utilityProcess` + `MessageChannelMain` (1 day) & lock `packages/main` ↔ `packages/server` window-owner lifecycle** — if the spike passes, land `utilityProcess` as a standalone pre-cutover PR and hand each window a `MessageChannelMain` at cutover (authority by possession — no HMAC, watermark, `window:gone`, or loopback window port); if it fails, fall back to the reconciled HMAC design (no `apiToken` in windows, preload-owned single link, spawn-env watermark, IPC disconnect invariant). Both paths keep `link.onEnd`-bound subscriptions, `@apackdev/orderings` every-ordering verification, and a dedicated local-tool path covering `apack pack drive --channel beta`. See [Window-Owner Lifecycle & Deferred Transport Architecture](#window-owner-lifecycle--deferred-transport-architecture-7). | S–M | `monorepo` |
| 8 | **Run a throwaway 1-feature spike** against the released tarballs porting the hardest real slice (**commit surface + one live brain flow touching `runHistory`**) to validate the non-EARS transaction boundary and benchmark TS 5.9 compile time extrapolated to 49 machines. | M | `monorepo` |
| 9 | **Write the feature-by-feature cutover order/size table** and lock the **singleton-free `using`-disposable test harness** contract (`@apackdev/testing` + `@apackdev/sdk/testing` driving `@apackdev/state` + `@apackdev/link` on one `@apackdev/orderings` schedule). | S | `monorepo` |

---

## Phase 3 — The XState + tRPC Cutover ([apack-state.md](apack-state.md))

| # | Work Item | Size | Scope |
|---|---|---|---|
| 10 | **Enable `oxlint-tsgolint` (`--type-aware`) on new transport/kernel code** to catch floating promises and async stream bugs as they're written. | S | `monorepo` |
| 11 | **Build the new singleton-free `using` test harness** (verified with two concurrent `using app = createTestApp(...)` instances in one test + `--shuffle`). | M | `monorepo` |
| 12 | **Execute the cutover:** host bus/shell, `@apackdev/link` transport + window-owner wiring, restated SDK pack contract (`defineSystem`, `#generated/events`, `#generated/fe`, `ask`/`fromAsk`, `useState`, `fromView`), all 49 machines (~27.5k lines) & ~132 specs, pack rules, docs/templates, and remove XState / `@xstate/vue` / tRPC. | L | `monorepo` |

---

## Phase 4 — Post-Cutover Platform & Toolchain Payoffs (`monorepo`)

| # | Work Item | Size | Scope |
|---|---|---|---|
| 13 | **Roll Vitest 4 `isolate: false` across the rewritten runtime/feature suites** — cashes in `#11` on the ~841s import/setup CPU tax (`333s` host + `508s` pack, 10-core `npm run test:unit` across 866 files, 2026-11-23, [singleton-free-test-harness.md](singleton-free-test-harness.md)); keep only global-mutating specs in `isolate: true`. | M | `monorepo` |
| 14 | **Enable `oxlint --type-aware` repo-wide + add `oxlint` `jsPlugins` rule enforcing `errorMessage()` at boundaries** (bans raw `instanceof Error ? e.message : ...` that swallows `SuppressedError`s). | S | `monorepo` |
| 15 | **Replace `tsup` with `tsdown` in `packages/server` & unify duplicate `esbuild` (`0.25`/`0.28`) / `vite` (`7`/`8`) trees.** | S–M | `monorepo` |
| 16 | **Make codegen'd pack `ears.ts` (`emitEARS`) erasable** (`export const EARS` + type-only `export namespace EARS`), unlocking `erasableSyntaxOnly: true` for packs and eventual `tsx`-free pack builds. | M | `monorepo` |
| 17 | **Enable selective `isolatedDeclarations: true`** on `@apackdev/sdk` + `@apackdev/host` (unblocked once Zod `z.infer` and tRPC `AppRouter` are gone). | M | `monorepo` |
| 18 | **Evaluate `rolldown-plugin-dts`** to replace `rollup` + `rollup-plugin-dts` in [types-bundler.ts](../../packages/apack-cli/src/build/types-bundler.ts) (verify determinism specs). | M | `monorepo` |
| 19 | **Upgrade to TypeScript 7 (native Go `tsc`)** for upstream-estimated 8–12× faster typechecks once TS 7.1 programmatic API / `vue-tsc` / `@microsoft/api-extractor` support lands. | M | `monorepo` |
| 20 | **Sweep minor leftovers** — bump `@tsconfig/node22` in [packages/renderer/tsconfig.node.json](../../packages/renderer/tsconfig.node.json), optionally silence cosmetic esbuild CJS `[empty-import-meta]` warnings, and revisit direct `@standard-schema/spec` typing only if non-`ai` SDK APIs ever need it (PR `#634` already pins non-Zod Standard Schema support for `services.inference` and `tool()`). | S | `monorepo` |

---

## Phase 5 — Standalone Repo Extractions & Ecosystem Rollout (independent, priority order)

| # | Work Item | Size | Scope |
|---|---|---|---|
| 21 | **Promote `@apackdev/pack-format` to its own repo (`spankyed/apack-pack-format`)** once post-cutover `apack.json` settles, and wire `apack-community` onto it (deletes `scripts/vendor-manifest-schema.ts`). | M | New repo + `monorepo` + `apack-community` |
| 22 | **Finish rolling out Node `>=24.12.0` / `@types/node@^24.12.0` / `using` / `erasableSyntaxOnly` baseline** across sibling repos (`elmdb` and `apack-terminal/node` for `engines.node`, plus `@types/node` / `using` / `erasableSyntaxOnly` alignment across `apack-community`, `elmdb`, `apack-state`, `apack-link`, `apack-orderings`, `apack-terminal`, `apack-git`). | M | Sibling repos |
| 23 | **Extract `apack-vault` (Rust, own repo):** OS keystores (Keychain / DPAPI / Secret Service) + `zeroize` memory wiping + encrypted secret envelope. | M–L | New repo + `monorepo` |
| 24 | **Extract `apack-fs-tx` (`@apackdev/fs-tx`, TS, own repo):** crash-safe `private-file`, `replace-dir`, `exclusive-lock`, `process-liveness` with dedicated fault-injection / Windows-retry / Stryker suite. | M | New repo + `monorepo` |
| 25 | **Extract `apack-agent-runners` (`@apackdev/agent-runners`, TS, own repo):** `claude-code` & `codex` subprocess/JSONL adapters decoupled from `default-setup` so external CLI wire-protocol changes ship independently. | M | New repo + `monorepo` |
| 26 | *(Optional)* **Build `apack-sys` (Rust, own repo):** `goblin` ELF/Mach-O/PE binary inspection (dropping PowerShell helpers), `rayon`/`sha2` parallel tree hashing, native OS process-tree queries (dropping `ps` forks), and optional `notify` watcher. | L | New repo + `monorepo` |

---

## Window-Owner Lifecycle & Deferred Transport Architecture (`#7`)

A link outlives its WebSocket, so socket close no longer tells `packages/server` that a window is gone. Without explicit ownership teardown, the backend retains a session buffer for every window that ever closed. `apack-link` provides the link-side primitive (`accept<Owner>()` with `take(transport, owner)` and `gone(owner)`).

Everything in the TCP/WebSocket HMAC scheme exists to compensate for one choice: serving windows over a localhost TCP port. Before writing that machinery, run a **1-day `utilityProcess` + `MessageChannelMain` spike** to decide whether windows can use brokered Electron message channels directly (authority by possession), with the reconciled HMAC design as the fallback.

### Step 0 — 1-day `utilityProcess` + `MessageChannelMain` spike

Production **already** runs `packages/server` on Electron's built-in Node 24 (`process.execPath` with `ELECTRON_RUN_AS_NODE: '1'` in [config.ts](../../packages/main/src/modules/api-server/config.ts)), so `elmdb` and native modules loading on Electron's Node in packaged builds is already proven. The spike validates the remaining unknowns:

1. **Dev-mode runtime & ABI:** `utilityProcess.fork` boots `packages/server` with `execArgv: ['--conditions=@apackdev/source', '--enable-source-maps']`, preserves `npm run dev:inspect` debugging, and loads `elmdb` / keyring / terminal broker under Electron's Node in dev (where `config.ts` currently spawns system `node`).
2. **Deterministic `MessagePortMain` `'close'` delivery:** verify immediate `'close'` delivery on Electron 44 for **window close**, **soft reload (`Cmd+R`)** (explicitly testing whether preload `pagehide`/`unload` close or `main` navigation teardown is needed so `'close'` does not wait on V8 GC), and **renderer crash** (`forcefullyCrashRenderer`).
3. **Throughput & flow control:** benchmark `MessagePort` on a large `shown` view (transferable `Uint8Array` / string vs. structured-cloned object). `MessagePort` has no `bufferedAmount` / `waiting()`, so confirm `apack-link`'s `bound.kept` carries backpressure cleanly.

### Primary path (if spike passes) — Brokered `MessageChannelMain`

- **Isolate blast radius before Phase 3:** land `spawn` → `utilityProcess.fork` as a **small standalone PR in Phase 2** while tRPC/WebSocket still runs, letting full CI/E2E across macOS, Linux, and Windows prove the process model independently of the 49-machine cutover.
- **Authority by possession at cutover:** `main` creates a private `MessageChannelMain` per document load and hands one port to the window and one to the backend. Holding the port *is* the identity — deleting HMAC minting/verification, the revocation watermark, `window:gone`, restart-sync env, and preload-held secrets. A user-installed production app no longer needs a loopback TCP port at all.
- **One-sided close semantics (document close vs. backend restart):** when the *document* goes away, the backend's port closes and ends that channel's owner (`gone(owner)`). When the *backend* crashes or restarts while the window stays open, `main` mints a fresh `MessageChannelMain` on `api:started` and transfers the new port to every live `BrowserWindow` so `apack-link`'s `dial()` reconnects cleanly.

### Fallback path (if spike fails) — Reconciled TCP/WebSocket HMAC design

If `utilityProcess` hits a blocker, build the hardened localhost-WebSocket ownership contract:

1. **Monotonic IDs & stateless admission:** `main` assigns non-reused `windowId` (`1, 2, 3, …`, preserved across reload) and derives `w.<id>.<hmac>` from `(windowId, runToken)`. On upgrade, `server` verifies the HMAC statelessly into `owner = window:<id>` (or `window:<id>:<channel>` for forward-compatible multi-link windows) — `owner` never crosses the wire.
2. **No `apiToken` in any window (in the same change):** remove `window.electronAPI.apiToken` completely so no window ever holds the master token. Playwright fixtures read the tool token from `main` via `electronApp.evaluate(...)`; `apack drive` and CLI tools use the local-tool path below.
3. **Preload-owned single link (`contextIsolation: true`):** every `BrowserWindow` already runs with `contextIsolation: true` ([WindowManager.ts](../../packages/main/src/modules/window-manager/WindowManager.ts)), and [preload/src/index.ts](../../packages/preload/src/index.ts) already keeps socket credentials out of the page world for `terminal.views()`. Follow that precedent: preload holds `w.<id>.<hmac>` in its isolated world, opens the reconnectable WebSocket transport (tracking `api:started` port updates and `waiting()`/`bufferedAmount`), enforces **one active link per document loudly** (throwing if a second page caller tries to open a competing link), and benchmarks `contextBridge` overhead on large `shown` frames (if felt, record the figure and fall back explicitly to passing the per-window credential).
   - **Never refuse a second connection for a live owner on the server:** on window reload (`owner` stays `window:<id>`, `gone` does not fire, and the old link outlives its socket) and on half-open reconnect (`said.session === had.id`), `accept()` requires the replacement connection to reach the live owner so it can end the old session or swap sockets. Single-link enforcement therefore belongs in preload per document (where Chromium creates a fresh preload context on reload), not as a server-side rejection of live owners.
4. **Zero-gap restart watermark & IPC teardown:** `main` sends `{ type: 'window:gone', id }` over the existing `ApiServer` IPC channel ([ApiServer.ts](../../packages/main/src/modules/api-server/ApiServer.ts)) on `closed`, and passes the initial bounded revocation watermark `{ minLiveId, revokedAboveMin }` in the **spawn environment** (`APACK_WINDOW_WATERMARK`, captured and deleted at boot alongside `captureApiToken()`), with `process.on('message')` attached before `server.listen()`.
5. **Backend exit on IPC disconnect:** promote the existing `process.on('disconnect', ...)` handler in [websocket.ts](../../packages/server/src/transport/websocket.ts) over [ApiServer.ts](../../packages/main/src/modules/api-server/ApiServer.ts)'s `ipc` channel to an explicit, regression-tested invariant so an orphaned backend cannot leak window sessions if `main` dies.

### Local tools path (required on both paths)

Moving windows to `MessageChannelMain` (or removing `apiToken` from windows on the fallback path) still leaves local tools (`apack pack dev`, `apack db`, `apack doctor`, `apack pack drive`, Playwright E2E, `POST /dev/reload`, `POST /dev/install`):

- **Preferred:** a user-private Unix domain socket / Windows named pipe (per [what-a-window-reaches-its-backend-over.md](deferred/what-a-window-reaches-its-backend-over.md)), or a localhost port authenticated by a tool token.
- **Packaged `--channel beta` drive requirement:** `publishApiFiles` in [websocket.ts](../../packages/server/src/transport/websocket.ts) currently skips writing `apiTokenFile` for packaged builds, and `apack drive` attaches over page CDP (no Playwright `electronApp.evaluate`), as noted in [engine/index.ts](../../packages/apack-testing/src/engine/index.ts). Gate `apiTokenFile` (or local tool socket publishing) on an explicit dev/drive-launched condition (such as `--remote-debugging-port` or a launcher env flag — never enabled on user-installed production runs), or let the launcher supply the tool token on spawn. Every tool connection receives a throwaway `owner = tool:<connId>` ended when its socket closes.

### Invariants kept on both paths

- **Per-session state binds to `link.onEnd`, never to `gone(owner)`:** bind all views, subscriptions, and queues (JS today, future engine-held views later) to `link.onEnd`. On reload, `owner` can stay the same while `accept()` synchronously closes the previous session (`had.link.close('ended')`) before starting the next; `gone(owner)` only guarantees `link.onEnd` eventually fires for a window that stopped coming back.
- **Every-ordering verification (`@apackdev/orderings`):** model `open`, `reload`, `close`, channel-close / `window:gone` delivery, late pre- and post-hello `upgrade` (fallback), `backend restart` (new port handoff or spawn-env watermark), and **a test tool connecting while a window is live**, asserting:
  - `activeSessions <= liveWindows` at rest,
  - no closed window is admitted after close/gone or across a backend restart,
  - a reload never leaves two live sessions or leaked subscriptions for one window,
  - a tool connecting never ends a window's session.
- **Compatibility with deferred transport & engine-views plans:** keeping `owner` as a plain local ID independent of transport leaves both [what-a-window-reaches-its-backend-over.md](deferred/what-a-window-reaches-its-backend-over.md) and `apack-link`'s `docs/deferred/views-from-the-engine.md` open. Choosing `MessagePort` today does mean Rust (`elmdb`) cannot write link bytes directly to a `MessagePort` (a Chromium/V8 object), so zero-JS engine views would not run over `MessagePort` — **but** it does not foreclose them permanently: because `apack-link` abstracts `Transport` and `preload` already talks directly to Rust over `node:net` local sockets (`terminal.views()`), a future benchmark justifying engine views can swap windows onto a Rust-owned local socket without touching pack or app code.

---

## Target Package & Repository Boundary Map

> [!NOTE]
> **Extraction principle:** Extract a primitive to its own repo when it has a different toolchain (Rust), a sharp domain-free invariant deserving its own proof/mutation/fault-injection suite, an independent release cadence, or multiple top-level app consumers. Keep lockstep-evolving platform packages as workspace packages in `monorepo`.

| Package | Repo Home | Runtime | Single Invariant Owned |
|---|---|---|---|
| `@apackdev/sdk` | `monorepo` | Node + Browser | Pack runtime APIs, plain TS contracts, zero-dep authoring helpers (`entry`/`on`) |
| `@apackdev/pack-format` | `monorepo` → own repo (Phase 5) | Pure JS (Node + Workers) | Zod manifest & snapshot schemas, `PACK_LAYOUT`, `semver` compat, `apack.schema.json` (no `ajv`, no `node:fs`) |
| `@apackdev/pack-build` | `monorepo` | Node | Deterministic pack compiler kernel (codegen, content compilers, sealed candidates) |
| `@apackdev/cli` | `monorepo` | Node | User-facing CLI shell (`init`, `dev`, `build`, `db`, `doctor`, `drive`, `release`) |
| `@apackdev/ui` | `monorepo` | Browser (Vue) | Pack & app UI components and composables |
| `@apackdev/testing` | `monorepo` | Node (test) | Singleton-free, `using`-disposable test harness |
| `@apackdev/host` *(private)* | `monorepo` | Node + FE host | Thin app composition + `ajv` settings compilation (inlined into `cli`) |
| `@apackdev/state`, `@apackdev/link`, `@apackdev/orderings` | Own repos (TS) | Pure JS | State kernel, ordered stream, deterministic schedule runner |
| `elmdb`, `@apackdev/terminal` (+ `@apackdev/terminal-view`) | Own repos (Rust + TS view) | Native + Browser | EARS/LMDB store, PTY terminal broker, terminal row renderer |
| `@apackdev/git` | Own repo (TS) | Node | Pure-TS git engine bundled by `default-setup` |
| `apack-vault` | Own repo (Rust) | Native | OS keystores + `zeroize` + encrypted secret envelope |
| `apack-fs-tx` | Own repo (TS) | Node | Transactional local fs (`private-file`, `replace-dir`) & PID locks |
| `apack-agent-runners` | Own repo (TS) | Node | External coding-agent CLI adapters (`claude-code`, `codex`) |
| `apack-sys` *(optional)* | Own repo (Rust) | Native | Binary (`goblin`) inspection, parallel hashing, OS process-tree queries |

```mermaid
flowchart TD
  subgraph ExternalPureJS["External Pure-JS Packages"]
    orderings["@apackdev/orderings"]
    link["@apackdev/link"]
    state["@apackdev/state"]
    packFormat["@apackdev/pack-format (Node + Workers)"]
    orderings --> link
    orderings --> state
    link --> state
  end

  subgraph ExternalNodeTS["External Node TS Packages"]
    git["@apackdev/git"]
    fsTx["@apackdev/fs-tx"]
    runners["@apackdev/agent-runners"]
  end

  subgraph ExternalRust["External Rust Crates"]
    elmdb["elmdb / @elmdb/ears"]
    term["@apackdev/terminal"]
    vault["apack-vault"]
    sys["apack-sys (optional)"]
  end

  subgraph Monorepo["monorepo Workspace Packages"]
    sdk["@apackdev/sdk (zero Zod/Ajv)"]
    ui["@apackdev/ui"]
    host["@apackdev/host (wiring + Ajv settings)"]
    packBuild["@apackdev/pack-build"]
    cli["@apackdev/cli"]
    testing["@apackdev/testing"]
    app["server / main / preload / renderer"]
    defPack["default-setup"]

    sdk --> host
    packFormat --> host
    packFormat --> packBuild
    state --> host
    link --> host
    elmdb --> host
    term --> host
    vault --> host
    fsTx --> host
    sys -. optional .-> host
    packBuild --> cli
    host --> cli
    host --> app
    ui --> app
    sdk --> defPack
    ui --> defPack
    git --> defPack
    runners --> defPack
    sdk --> testing
    host --> testing
    state --> testing
    link --> testing
    orderings --> testing
  end

  community["apack-community (Cloudflare Workers)"]
  packFormat --> community
```
