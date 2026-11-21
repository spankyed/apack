# One kind of pack: retire "built-in"

> **Done** (Phases 1-7, on `AS/one-kind-of-pack`: `9a6022043`, `14c377d26`, `e673a78c0`, `b5c2f0f06`,
> `eec3c74f2`, `a0637b07f`, `1be49673d`). The text below is the plan as written; see **Outcome** at the
> foot for what it came to, including the three places the plan's premises were wrong and the two
> production bugs the change exposed.


> **Written in session** `d364117f-5480-4324-a724-c63f04694b9f` (Claude Code, 2026-10-07). Resume it with `claude -r d364117f-5480-4324-a724-c63f04694b9f`.

```
# Goal: every pack is the same kind of pack, and every one of them hot-reloads

Implement docs/goals/goal-one-kind-of-pack.md on AS/one-kind-of-pack, at or after 02688f256 — the base
its Background was surveyed at. The branch was cut from master at b8c1a34f5, which contains it.
Before Phase 1, confirm the base: `bundledLoaders` in apack-host/src/packs/runtime/loader.ts, the
`if (!external)` early return in apack-cli/src/commands/build.ts, `builtInPacksPlugin` in
renderer/vite.config.ts, `builtInPackLoadersModule` in api/tsup.config.ts, `partitionPolicy` in
apack-sdk/src/build/manifest-schema.ts and `packages/default-setup/dev-build.mjs` all exist at HEAD. If
they don't, stop and say so — the Background was surveyed somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. Standing rules apply as written in Constraints and root CLAUDE.md — no backward compatibility in
code, stored user data excepted.

The requirement that outranks the rest: after Phase 3, `npm run start` alone gives full frontend and
backend hot reload for every pack in the workspace, with no `apack run` process. Phase 3 is not done
until `tests/packs/external-pack` behaves like `packages/default-setup`.

Finished when:
- Phases 1-6 are implemented and each meets its "Done when"; every new guard is mutation-checked.
- `manifest.builtIn` decides nothing: no load, reload, build, frontend or content path reads it, and
  `grep -rn "builtIn" packages/*/src` finds only a pack's own manifest field and its uninstall property.
- `grep -rn goal-one-kind-of-pack packages scripts` returns one hit, the dev-server spec's — see
  Background's "The comments that name this goal" for the other four and which phase takes each.
- `bundledLoaders`, `builtInPackLoadersModule`, `dev-build.mjs`'s esbuild, `partitionPolicy`,
  `earlySystem`, `publishHostPackOutput`, `pruneHostPackOutputs` and `hostPacksDir` are gone.
- default-setup is installed at first boot from the directory the app ships, and re-installed when the
  shipped integrity differs from the installed one.
- npm run chain passes; npm run build-prod produces an app that boots with its default pack, verified
  with DEBUG_E2E=1 npm test -- smoke.
- **A thorough review of the whole change for bugs and completeness is the last step**, after Phase 6 and
  before the archive: read the diff against master as a reviewer who did not write it, report the findings,
  then fix all of them. A finding is a defect — not intended behaviour, not a decision already taken, and
  not doc or process bookkeeping.
- A final summary: phase -> done/deferred, evidence, and the conventional choices made.
- The doc is in docs/archive/goals/, with its status blockquote and an Outcome section, committed.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green, not once at the end.
  Conventional message, no Co-Authored-By or session lines, `git commit -- <paths>` naming only that
  phase's files.
- Check `git diff --cached` first: something outside the session stages files, and a pathspec commit
  leaves the rest of the index alone.
- Don't push, tag or open a PR unless the user asks.

Never:
- The standing list in Constraints: git remotes, publishing, real data dirs, broad process kills, bare
  tsc in preload, the example pack, release metadata, typed EARS, compat shims, loosened assertions.
- Add a read-only fallback that loads a shipped pack straight from resources/ when its install fails
  (Decision 7) — that is the built-in load path returning in disguise.
- Put file times back into a content hash, or add a second record beside a content hash (Decision 6).
- Generalise `earlySystem` to any pack (Decision 4) — it is deleted, not widened.
```

## Background (2026-10-07, at 02688f256 on master)

Every citation below was checked against the tree on that date, and Phases 1-6 are all undone. A count or
a line number here is as good as that date; what is held to the code is named in the phase that needs it.

### The comments that name this goal

Five places in the code point at this document, so the work is findable from the code and not only from
here. They are also the checklist: **after the work, `grep -rn goal-one-kind-of-pack packages scripts`
should return the last row and nothing else.** Four of them name something this goal deletes, and the
difference matters — a reader who finds a surviving comment has either found unfinished work or the one
that was always meant to stay.

| site | what it says | becomes |
|---|---|---|
| `scripts/lib/build-reads.ts:134` | `isBuiltIn` is "the one thing here whose subject this goal deletes" | **gone**, Phase 1 |
| `apack-cli/src/build/build-reads.ts:28` | the first of two reasons the read record is keyed by phase | **the sentence goes**, Phase 1; the keying stays on the second reason |
| `internal-repo-checks/tests/dep-files.integration.spec.ts:400` | the two-kind evidence loop, needing a built-in pack *and* an external one | **gone**, Phase 1 — one record then carries all nine phases and the loop collapses into the case above it |
| `scripts/lib/chain-steps.ts:1083` | `build:app` declares `PACK_SOURCES` because the renderer compiles the pack's frontend | **gone**, Phase 3 — the comment says so itself: *"this comes back out with it"* |
| `apack-cli/tests/build/fe-bundler-dev-server.integration.spec.ts:19` | why the `pack://` page-reload ceiling is the reason a dev-only source import exists | **stays** — it explains Phase 3's design, and is still true afterwards |

The three `build-reads` and `dep-files` rows are the same fact in three places: `apack build` records what
each bundling phase read, and that record is built-in-aware because a built-in pack never runs the runtime
and frontend phases. Phase 1 is what makes it run them.

### Three axes, not one question

"Built-in" conflates three things, and only the first is a real distinction:

| axis | real? | what it decides |
|---|---|---|
| **where the files live** — read-only in `resources/` vs the user's data dir | **yes**, irreducibly | whether a pack is installed or loaded in place |
| **how the code is loaded** — bundled into the app vs required from the pack's own directory | no | one load path or two |
| **what the pack may do** — `earlySystem`, declarative content, partition policy | no | whether the privileged pack is the one that proves the author-facing path works |

Axes 2 and 3 are accidental and come out cheaply, in steps 1-3. Axis 1 is legitimate and comes out in steps
4-6, which is where install-on-first-boot and the two migrations are. Nothing about that order is a hedge:
steps 1-3 are what the requirement needs, and doing them first is what makes step 6 a packaging change
rather than a devex regression.

---

### What the distinction buys

Exactly three privileges. `loadSingleExternalPack` strips each one from an external pack
(`apack-host/src/packs/runtime/loader.ts:235-257`), with a warning:

| privilege | declared | who uses it |
|---|---|---|
| `earlySystem` — the system starts before EARS hydration, outside the bus | `manifest-schema.ts:173`, refused for external packs at `:259` | **one feature in the repo**: default-setup's `logs` (`packages/default-setup/apack.json:238`) |
| `boot.contentManifest` — the declarative content path, with `contentPolicy` | `pack-registration.ts:20`, `manifest-schema.ts:122` | default-setup's seven content sources |
| `ears.partitionPolicy.excludedEntityTypes` | `loader.ts:250-257`, consumed at `database/schema.ts:174` | **nobody** — default-setup's is `{"excludedEntityTypes": []}` |

So one privilege is vacuous today, one is used by a single feature, and one is real.

### What it costs

Five mechanisms that exist twice, once per pack kind.

**Four build paths for one pack's code.** The largest of them, and an earlier version of this doc
undercounted it:

1. the renderer's `builtInPacksPlugin` (`renderer/vite.config.ts`) — the frontend, dev and production;
2. the api's tsup generating a loaders module and bundling the backend into the api bundle
   (`api/tsup.config.ts:5,11`);
3. `apack build`, which **returns early for a built-in pack** (`apack-cli/src/commands/build.ts:305-310`,
   *"Built-in packs' FE is compiled into the renderer … and their backend into the API bundle, never loaded
   from dist/"*) — so it produces content, types, defs and a snapshot and then stops, skipping
   `bundlePackRuntime` and `bundlePackFE`;
4. **`packages/default-setup/dev-build.mjs`, 164 lines of bespoke esbuild** reimplementing
   `bundlePackRuntime` for one pack, because of (3). `dev-mode.js:27` forks it with `--watch` and waits for
   its first compile before booting the API (`:52`), so it is also the backend watch loop.

The code that replaces (4) already exists, switched off by the four lines of (3).

**Two load paths.** `loadBuiltInPacks` with its `runtimeEntry: 'prefer' | 'only' | 'never'` and
`bundledLoaders` options (~105 lines of `loader.ts`, plus `loadBuiltInRuntime`, `packRegistration`,
`refreshBuiltInPackInfo`) beside `loadSingleExternalPack`.

**Two reload paths.** `reloadBuiltInPack` (`reload.ts:133-177`) and `reloadExternalPack`, near-identical
wrappers over one `reloadPack`.

**Two content-change mechanisms, both recorded in `AppState`.** `builtInContentRevisions`
(`orchestrateDeclarativeContent`, `apply.ts:170`) against `externalContentRevisions` + `externalContentDeps` — a per-pack
hash and the dependency state a failed content faced (`importPackContent`, `apply.ts:88`). The external one is the
more capable; the built-in one carries `contentPolicy` (`evaluateContentPolicy`, `apply.ts:146`), which the external
path never evaluates.

**Narrowed on 2026-10-07** (`0a25ff990`): both hashes are content now, where the external one also hashed file
times and the built-in one kept a `builtInContentFingerprints` record of them as a fast path. What is left is two
*records* over one question, not two answers to it — which is the half a merge can just rename.

**Two discovery sources in the schema reader.** `database/schema.ts` reads published built-in snapshots from
`hostPacksDir` (`:67-72`, `:147`) *and* installed external manifests, with a `degraded` fallback at `:156`
for when the first is empty — a branch that exists only because a built-in pack's snapshot can be missing
from the data dir while the pack itself is fine.

Beside those: `publishHostPackOutput` and `pruneHostPackOutputs`; `builtIn: boolean` on every origin with
`builtInPacks()`/`externalPacks()` (`registry.ts:99,135,565-566`); `shippedWithApp` and
`toBuiltInPackInfoList` (`features/packs/be/system.ts:109-116`); and the manifest schema's `builtIn` field
plus its refinement.

**Roughly 500 lines of source** plus `dev-build.mjs`'s 164. **Nineteen files read the flag**, and about
eleven are named by no step below, because most are axis 1 and stay: `BUILT_IN_PACKS_DIR` in
`main/src/modules/api-server/config.ts`, `pack.ts` refusing to pack a built-in, `installer.ts` skipping
built-in ids while resolving dependencies, `discovery.ts` filtering manifests. One must not be touched at all —
`apack-host/src/migrations/app/0.4.0.ts`, which is history and describes the tree as it was. On the test side `apack-cli/tests/packs/host-output.spec.ts` (357 lines) is mostly about the
built-in-only publish, `loader.spec.ts` (858) and `reload.spec.ts` (382) each carry a near-duplicate half,
`discovery.spec.ts` (128) shrinks, and `api/tests/runtime/packaged-boot.spec.ts` (103) changes shape.

---

### Developer experience

**`npm start` keeps working, default-setup's frontend HMR does not change, and every other workspace pack
gains it.** Those are the three sentences that matter; the rest is why.

**Two dev loops exist and only one of them is good**, which is the whole of the problem:

| | frontend | backend |
|---|---|---|
| a pack that ships with the app, under `npm start` | **component-level HMR** — the renderer's Vite imports its entry from source, so the pack's modules are in the renderer's own graph | watch → esbuild → `POST /dev/reload` (`default-setup/dev-build.mjs`, forked by `dev-mode.js`) |
| any other pack, under `apack run` | **a window reload** — measured 2026-10-07, and nothing at all before `0a25ff990` fixed `compiledSource` | watch → `apack build` → install → `POST /dev/reload` |

Neither row is about shipping with the app. The frontend row is about whose Vite owns the modules; the
backend row is about a watcher that lives *inside* one pack because `apack build` refuses to build its
runtime. Steps 1 and 3 remove both reasons, and the second column is then one watcher for every pack —
which is what retires `apack run` for a pack in this workspace.

**Frontend HMR has nothing to do with being built-in.** `builtInPacksPlugin` generates a module of **static**
imports:

```js
import _pack0 from '@default-setup/__generated__/pack-entry-fe';
export default { 'default-setup': () => Promise.resolve({ default: _pack0 }) };
```

Statically analysable, so Vite compiles the pack's `.vue` and `.ts` into the renderer's own module graph and
HMR is simply the renderer's. The external path cannot get that, because the loader does
`import(/* @vite-ignore */ url)` on a `pack://` URL (`renderer/src/adapters/pack-frontends.ts:7`), and
`@vite-ignore` is exactly *"Vite, do not own this"*.

So the capability depends on **the pack's source being on disk and resolvable**, not on the pack shipping
with the app. Those are two facts `manifest.builtIn` currently conflates, and re-keying the surface to the
first keeps the capability while dropping the concept — see step 3.

Of the surface's 46 lines, the `@<pack-id>/` alias half has **no remaining user**: nothing imports
`@default-setup/…` except the virtual module's own generated import, because packs name their own modules
with `#` subpath imports now.

**The external path is already wired for HMR**, which matters as the fallback and as the path every author
uses (`apack-cli/src/commands/run.ts:325-360`):

- `@vitejs/plugin-vue` — genuine SFC HMR rather than a reload.
- `packExternalsPlugin(root)` with `optimizeDeps.exclude: getSharedFeDeps(root)` — Vue, `@apackdev/sdk` and
  `@apackdev/ui` resolve to the host's copies, so **one Vue instance**.
- `hmr: { protocol: 'ws', host: 'localhost' }`, `cors: true`.
- The backend watcher **skips `.vue` and `.css`** (`run.ts:394`), which is the author saying Vite owns them.
- The proxy is a full mirror, not a whitelist: `devServerUrl` returns `http://localhost:${port}${filePath}`
  for any path (`dev-server.ts:77`), so `pack://<id>/@vite/client` resolves and Vite's root-relative update
  imports resolve back through the same origin.
- **No CSP is set anywhere** in main or the renderer, so the client's `ws://localhost:<port>` socket is not
  blocked.

Complete on paper; whether component-level HMR lands through it is the measurement in *Verification*, and it
was taken on 2026-10-07, against the `external-pack` fixture with `DEBUG=vite:hmr`: an edit to a `.vue`
produces `page reload`, not a component update, because the app imports the pack's entry through `pack://` —
outside Vite's graph — so no importer is there to accept one. **That is this path's ceiling**, and the reason
step 3's dev source import is load-bearing rather than a convenience. Getting that far also took a fix:
`compiledSource` read `ctx.load().code`, which throws in a dev server, so the loop did nothing at all while
`apack run` printed that it was hot-reloading.

**Type resolution improves.** `packages/default-setup/tsconfig.json` declares no `@apackdev/source` condition,
so the editor already type-checks it against `dist` — the pack-author layout. The fork today is that the
renderer's Vite compiles its frontend from source with the condition, so the editor and the running dev app
resolve differently.

**The hazard to keep in mind:** with a dev source import the frontend comes from source while the backend
comes from the built runtime, so a feature added to `apack.json` without a rebuild shows a surface whose
system is not registered. That is true today for the same reason, and `apack run`'s `apack.json` watcher
regenerating entries (`run.ts:377`) is the mitigation to keep.

### "Runs first" is already derived

`packContentOrder` (`apack-host/src/packs/discovery.ts:147`) is a cycle-tolerant topological sort over
declared `dependencies`, already covered by `tests/packs/dependencies.spec.ts`. Its own doc names the
special case it is bypassed by:

> *"A dependency on a built-in pack is already satisfied — the built-in packs' boot apply run before any
> external pack's"*

A hard-coded phase standing in for an edge the sort would compute. It matters only from step 6, when a
shipped pack becomes an installed one and the phase has nothing left to stand for: steps 1-5 keep it, so
nothing about ordering changes under them.

---

### How default-setup ships today

The entry point, in five steps:

1. **`electron-builder.mjs:119-171`** — `files` takes `packages/**/*`, minus `!packages/*/src/**`, plus
   `packages/*/dist/**`, with `asar: false` (`:176`). Since 2026-10-02 it also drops
   `!packages/*/.apack/**`: a pack's working directory, which that recursive include had been carrying into
   the installer. Worth knowing here because this goal makes a shipped directory authoritative — it holds the
   pack, not the build's leftovers, and nothing in the steps below has to arrange that. default-setup lands
   as a real directory at
   `<resourcesPath>/app/packages/default-setup/`: `apack.json` and `dist/` (the seven `*.content.json`,
   `snapshot.json`, `types/`, `defs/`, `build/`, `runtime/index.cjs`).
2. **`main/src/modules/api-server/config.ts:103`** — Electron main passes
   `BUILT_IN_PACKS_DIR = <resourcesPath>/app/packages` when packaged, `<appPath>/packages` otherwise, and
   `NODE_ENV: app.isPackaged ? 'production' : 'development'` in the same object.
3. **`api/src/runtime/index.ts:151`** — the API process reads it and calls `loadAppPacks(packs, {
   builtInDir, bundledLoaders: () => import('virtual:built-in-pack-loaders') })`.
4. **The renderer** gets the frontend separately, statically imported from source by `builtInPacksPlugin`.
5. **`publishHostPackOutput`** (`api/src/runtime/index.ts:156-170`) copies the pack's types and build output
   to `<userData>/host-packs/<id>` for dependents, and prunes outputs this release no longer ships.

**The backend ships twice.** `runtimeEntry` defaults to `'never'` when `NODE_ENV !== 'development'`
(`loader.ts:106`), so a packaged app loads the registration from the loader bundled into the api bundle, and
the `dist/runtime/index.cjs` in resources is shipped and never read. The frontend ships once, inside the
renderer bundle; `dist/runtime/fe.js` is not built for a built-in pack at all.

---

### What an earlier version got wrong

Recorded so the same shape is recognisable next time, and because the corrections are why the structure
changed.

| the claim | what was wrong |
|---|---|
| "four pieces of work that remove it", sequenced 1-4 | `boot.contentManifest` is stripped from external packs, so installing default-setup before merging the content paths ships a pack that writes nothing. The order was wrong, and the migration was a prerequisite rather than the revertible tail |
| "three build paths" | Four. `apack build` returns early for a built-in pack, so `dev-build.mjs` exists — 164 lines no other pack has |
| "item 1 is free" | Deleting `dev-build.mjs` removes the backend watcher `npm start` depends on |
| "worth doing" | A measurement with a verdict attached. No criterion was stated, so nothing could have failed it |
| "the one real loss is frontend HMR" | HMR is keyed on a static import, not on being built-in. Re-keying keeps it, and extends it to any pack author in a checkout |
| **the criterion itself**: "collapse a duplication where it needs no stored-data migration" | It split the work in two and deferred half on the premise that a migration is a one-way door. There is one user and he wrote the app, so both migrations are conveniences — `CLAUDE.md`'s carve-out for stored data is written for users this repo does not have. The order the steps actually have is the code's: one gate, one strip |
| three reasons step 6 was "a question" | A migration that costs nothing is not a reason; "it renames back to what 0.4.0 renamed away from" was an observation, not an objection; and the apply record's uninstall lifetime is answered by letting shipped packs be uninstallable, with a property deciding whether the button shows — which is on the roadmap anyway |

## Decisions

Final.

**1. The requirement is the developer experience, and it is the one thing that cannot be traded.** After
Phase 3, `npm run start` alone gives full frontend and backend hot reload for **every** pack in the
workspace, with no `apack run` process. This is not a tightening: it is what one pack has today, and the
work is to stop that depending on which pack it is. Phase 3 carries it as a test rather than an argument.

**2. What orders the phases is the code, not risk.** `apack build`'s `if (!external)` gate blocks the
generic backend watcher, so Phase 1 precedes Phase 3; `loadSingleExternalPack` strips `boot.contentManifest`
and `evaluateContentPolicy` runs only on the declarative path, so Phase 5 precedes Phase 6.

**3. A migration is a convenience here, not a gate.** There is one user of this app and he wrote it, so
the two records Phases 4 and 5 move can be migrated or not: skipping them costs one re-apply of every pack
(content are upsert) and the `logs` surface's settings and tab-visibility choice. `CLAUDE.md`'s carve-out for
stored data is written for users this repo does not have. An earlier version of this doc sorted its work
by "needs no stored-data migration" and deferred half of it on that premise; see *What an earlier version
got wrong*.

**4. `earlySystem` is deleted, and `logs` stays in default-setup.** Generalising it is circular — the
refinement's own reason is *"before external packs load"*, which cannot hold for a pack that is external —
and it would let an arbitrary pack's system run before the data layer exists. Moving `logs` to the host
would also have removed the privilege, and is deferred rather than rejected
([`plans/logs-to-host.md`](../plans/logs-to-host.md)): whether the Logs surface should become a core app
feature, updated only by a full app release, is a product question this goal does not need answered. Deleting the field removes more than the move would and touches nothing else.
**The cost, which is the reason this is a decision and not a tidy-up:** `logs` stops starting before
hydration, so hydration, `onInit`, migrations and applying stop reaching the in-app viewer. They still reach
stdout and the log file. Pack loading was already outside that window.

**5. `partitionPolicy` is deleted, not generalised.** Nothing uses it: the only pack allowed one declares
`{"excludedEntityTypes": []}`.

**6. A content hash is content, and there is one record per pack.** Settled already by `0a25ff990`: both
hashes are over bytes and file names, `builtInContentFingerprints` is gone, and asking for a pack's data back
is `IMPORT_PACK_CONTENT`. Phase 5 is therefore a field rename plus porting `contentPolicy`, with no semantics
left to decide.

**7. First boot may fail, loudly.** Phase 6 makes the app able to start with no packs if the install
fails, which it cannot today. The install is idempotent and verified at every boot and a failure is fatal
with a message naming the pack and the path. A read-only fallback that loads straight from `resources/` is
the built-in load path in disguise and is rejected.

**8. `shippedWithApp` splits into two questions, and shipped packs become uninstallable.** `system.ts:116`
feeds three refusals: two that an installed pack may not take a shipped pack's id, one that a shipped pack
cannot be uninstalled. *May this be uninstalled* becomes a pack property, `false` by default for a shipped
pack, which the Packs view reads to hide the button — uninstallable and replaceable built-ins are on the
roadmap, so this moves toward it. *May an install take this id* is not about shipping at all and mostly
deletes: `installedPacks()` answers it once a shipped pack is installed.

## Phases

### Phase 1 — Delete the `if (!external)` gate in `apack build`

`build.ts:305-310` returns early for a built-in pack. Remove it and `apack build` produces
`dist/runtime/index.cjs` and `dist/runtime/fe.js` for default-setup with the same bundlers every other pack
uses. Unify the snapshot filename while here: `build.ts:147` writes `BUILT_IN_SNAPSHOT` where every other
pack writes `PACK_LAYOUT.snapshot`.

Then **delete `dev-build.mjs`** — 164 lines, of which the esbuild config is a *second* backend bundle
rather than a copy of `bundlePackRuntime`: it leaves every package external where the CLI inlines them, and
carries an alias surface for `@/` specifiers that no default-setup source has used since
[`goal-one-way-to-name-your-own-modules`](goal-one-way-to-name-your-own-modules.md) and a
`.vue` stub the CLI's `stubFrontendAssetsPlugin` already does.

**This is not free for the dev loop, which an earlier version of this doc got wrong.** `dev-build.mjs` is
also the backend watcher: `dev-mode.js:27` forks it with `--watch` and `:52` waits for its first compile
before the API boots. The watch belongs in the CLI, as `apack build --watch`, so there is one home for it
and a pack author gets the same loop — the shim this doc first proposed would have been a third place that
knows how to bundle a pack's backend.

**What `--watch` rebuilds is the runtime alone, and the numbers are why.** Measured 2026-10-07 on
default-setup: a full `apack build` is **23.7s**, of which the Vite frontend bundle is 11.1s; the backend
runtime bundle on its own is **40ms** (956KB, three runs, 30-50ms). A loop that re-ran the whole build per
edit would cost 24s against today's ~1s, so `--watch` rebuilds the one output whose staleness the app can
see and says so in its own help text. That is also exactly today's semantics: `npm start` never recompiled
content or facade types on an edit either. It is what `apack run`'s BE watcher should adopt — it calls
`build([])` per edit, which is that 23.7s for a pack this size.

**And it retires three built-in-aware pieces of the build record**, since removing that gate is exactly what
makes default-setup record the `runtime` and `fe` phases like any other pack. Each site names this document:

- `isBuiltIn`, and one branch of `rebuildCommand`, in `scripts/lib/build-reads.ts` — they exist only to name
  the command that rebuilds a pack's record, and with one kind of pack the path answers that, as it already
  does for a fixture pack. These two outlive Phase 1: the branch still picks `npm run compile` over `apack
  build` for default-setup, and `manifest.builtIn` is not gone until Phase 6.
- the two-kind evidence guard in `internal-repo-checks/tests/dep-files.integration.spec.ts` — the nine bundling phases
  take a built-in pack *and* an external one to observe between them, precisely because a built-in pack
  records neither of those two. Afterwards one record carries all nine and the guard collapses into the case
  above it, which asks only whether a record exists.
- the first of the two reasons that record is keyed by phase (`apack-cli/src/build/build-reads.ts`): that a
  built-in pack stops before those bundles. The keying stays — `--skip-fe` and `--skip-generate` still skip
  phases — and only that sentence goes.

**The chain's gate gets stronger by the same move**, which is the part worth knowing before starting:
`compile` is observed across seven of nine phases today, because `runtime` and `fe` are reachable only
through the fixture packs, whose step shares no edge with the pool that reads their records. Build
default-setup like any pack and the step on the chain's critical path is observed across all nine.

**Two more pieces come out with `dev-build.mjs`, and one bites before the other.** It writes *two* files:
`dist/runtime/index.cjs` and `dist/runtime/content-index.sha256`, the sha256 of the compiled content index its
runtime was built beside. `publishHostPackOutput` (`apack-host/src/packs/layout.ts:307-310`) **throws** when
those two disagree, so a `--watch` wrapper that drops the hash leaves a packaged app unable to publish its own
build output. Then the guard itself goes: it exists only because content and runtime are built by *different
commands* — its own comment says so, and the throw reads *"content compiled again without rebuilding the
runtime"* — and one command doing both removes the cause. `BUILT_IN_RUNTIME_CONTENT_HASH`, the file and the throw
are then a check that cannot fail, so they are deleted, or the throw stays as an assertion with a comment
naming the edit that would fire it, which is this repo's rule for one.

**A pack's backend bundle inlines its npm dependencies, and three of default-setup's cannot be inlined.**
`node-pty` and `fsevents` (chokidar's optional macOS watcher) load a `.node`, which is compiled machine code
esbuild has no loader for; `@vscode/ripgrep` computes its binary's path from its own `__dirname`, which in a
bundle is the bundle's directory. They are named in `RESOLVED_AT_RUNTIME` (`apack-cli/src/build/be-bundler.ts`)
and resolve from `node_modules` at run time. `dev-build.mjs` never met this, having left every package
external. The failure names the file it could not find, so a fourth is diagnosed the same way.

**The chain declaration moves too.** `compile` gains the Vite frontend bundle, so its declared `seconds` needs
a deliberate `chain --all --record --forget --step compile`, on the machine the cost table was measured on.
`PACK_OUTPUTS` needs nothing: it declares `packages/default-setup/dist` whole.

**Files:** `apack-cli/src/commands/build.ts`, `packages/default-setup/dev-build.mjs`,
`packages/dev-mode.js`, `packages/default-setup/package.json`, `scripts/lib/build-reads.ts`,
`apack-cli/src/build/build-reads.ts`, `apack-host/src/packs/layout.ts`, `scripts/lib/chain-steps.ts`,
`internal-repo-checks/tests/dep-files.integration.spec.ts`.

**Why first:** it is what makes a shipped pack a *complete* pack on disk, which every later step assumes, and
it is the only step that deletes a mechanism no other pack has.

**Done when:** `npm run compile` leaves `packages/default-setup/dist/runtime/index.cjs` **and**
`runtime/fe.js`; `dev-build.mjs` holds no esbuild call; `npm start` still hot-reloads a backend edit, with
the first compile still gating the API boot; `apack-cli/tests/build/*` and
`internal-repo-checks/tests/dep-files.integration.spec.ts` pass with the two-kind evidence guard collapsed into the
case above it. Mutation: put the gate back and the `compile` observation count drops from nine phases to
seven.

### Phase 2 — Delete `partitionPolicy`

Nothing uses it — the only pack allowed one declares `{"excludedEntityTypes": []}`, so deleting the field
changes no partition behaviour. Remove it from the manifest schema, `PackRegistration`,
`registry.ts:228-232`, the strip at `loader.ts:250-257` and its warning. `database/schema.ts:174`'s
`excluded` then comes from `SDK_EXCLUDED_ENTITY_TYPES` alone.

A field with no user, no fixture and a restriction that has never bound anything is not a capability.

**Files:** `manifest-schema.ts`, `pack-registration.ts`, `loader.ts`, `registry.ts`,
`database/schema.ts`; `npm run schema:update` and `npm run api:update` after.

**Done when:** `grep -rn partitionPolicy packages/*/src` finds nothing; `npm run schema:update` and
`npm run api:update` leave no diff beyond the field's removal; `database/schema.ts`'s `excluded` reads
`SDK_EXCLUDED_ENTITY_TYPES` alone. Mutation: none available and none needed — this is a deletion whose
subject has no user, which is why it is a phase of its own and two lines long.

### Phase 3 — Collapse loading

Production loads `dist/runtime/index.cjs` from the pack's own directory, exactly as development already
does, and the frontend loads over `pack://` for every pack.

- Default `runtimeEntry` to loading from disk regardless of `NODE_ENV`; delete `bundledLoaders`,
  `BundledPackLoaders`, the `runtimeEntry` option itself, and `builtInPackLoadersModule` from
  `api/tsup.config.ts`. The api bundle stops carrying a pack's backend.
- Teach the `pack://` handler to resolve against the shipped root as well as `packsDir`
  (`PackProtocol.ts:71-75` is the single `path.resolve` and its prefix check).
- **Re-key `builtInPacksPlugin` rather than deleting it**: dev-only `virtual:dev-pack-frontends`, generated
  from local pack directories (this repo's workspace packs with an FE entry, plus anything named by
  `APACK_DEV_PACK_DIRS`), absent from the production config. The loader prefers the dev map when a pack id
  is in it, else `pack://`. Its alias half goes, having no user.
- `reloadBuiltInPack` and `reloadExternalPack` become one function, both now being "re-require the built
  runtime from the pack's directory".

**What this step does not touch, and the two config files are why it is worth saying:** the generated entries
those virtual modules import. `pack-entry.ts` and `pack-entry-fe.ts` stay on disk, written by `apack
generate-entries` on the triggers and under the stamp
[`codegen-staleness.md`](../plans/codegen-staleness.md) records — a pack's own typecheck reads them through
`#generated/*`, so they could not be synthesised by a surface even if this step wanted them to be. What changes
is only who imports them: after this, each pack's own `apack build` rather than the renderer's and the api's.

After this, `manifest.builtIn` decides **nothing about behaviour**: one load path, one reload path, one build
path, one frontend path, no privileges. What survives is axis 1 — the directory a pack lives in.

**Four more things go with those two virtual modules.**

- **Their type declarations.** `api/src/env.d.ts` declares `virtual:built-in-pack-loaders` and
  `renderer/env.d.ts` declares `virtual:built-in-packs`. Delete the surfaces without them and the typecheck
  fails on a module nothing provides.
- **The dev-reload wire.** `api/src/transport/websocket.ts:59,72` takes `{ packId, builtIn }` out of the
  `POST /dev/reload` body and branches to the two reload functions this step merges, so the body shape changes
  and `apack run`, which posts it, changes with it. Narrowing it is available on its own: the server can
  derive the kind from its registry rather than trust the caller, which is the better shape either way and
  shrinks this step.
- **`build:app` stops reading the pack's sources, which closes a defect that exists today.** The renderer
  bundle carries default-setup's frontend compiled from `src/` — a notes field, `hideCompletedChildren`, is in
  `packages/renderer/dist/assets/index-*.js` — and `build:app` declares neither that tree nor anything that
  moves with it: `PACK_OUTPUTS` is the pack's `dist`, which holds no frontend bundle for a built-in pack, plus
  `src/__generated__`, whose only file that moves on a `.vue` edit is the dot-prefixed `.inputs-hash`, which
  `inputFiles` skips (`apack-host/src/build/packages-built.ts:286`). Measured 2026-10-07: edit a `.vue`, run
  `compile`, and `chain --dry` reports `build:app` **cached**, and `test:smoke` with it — a green chain over an
  app that never held the change. **It is fixable today** by declaring `packages/default-setup/src` on that
  step, and waits on nothing here; after this step the edge is gone and that declaration comes back out.
- **What stays, and has to be said because this step claims `manifest.builtIn` decides nothing about
  behaviour:** the Packs surface reports it (`apack-host/src/features/packs/be/system.ts:70,88,97`). That is
  axis 1 — which directory a pack lives in — and it is the one behaviour the claim excepts.

**Files:** `apack-host/src/packs/runtime/{loader,reload}.ts`, `api/tsup.config.ts`,
`api/src/runtime/index.ts`, `api/src/env.d.ts`, `api/src/transport/websocket.ts`, `renderer/vite.config.ts`,
`renderer/env.d.ts`, `main/src/modules/pack-protocol/PackProtocol.ts`,
`apack-host/src/fe/pack-frontends.ts`, `apack-cli/src/commands/run.ts`, `scripts/lib/chain-steps.ts`.

**The pre-flight is done.** A packaged API process can `esmRequire` the pack's `dist/runtime/index.cjs` out
of `resources/` — measured 2026-10-07 by building the api bundle with `runtimeEntry` defaulted to `'only'`,
so no bundled loader existed to fall back to, and booting it: *"Loaded built-in pack (dev): default-setup"*,
then the server up. The other half cannot be tested in a checkout at all — `source-resolution.ts:73` refuses
any process that resolves `@apackdev/*` to `dist` while a `src/` sits beside it, which is every checkout and no
packaged build — and needs no test, being what every installed external pack already does in production
through the same `withHostResolution`.

**The acceptance test, which is the requirement and not a nicety.** After this step, from `npm run start`
alone, with no `apack run` process:

- editing a `.vue` in **any** workspace pack patches the component and keeps the app's state;
- editing that pack's backend rebuilds it and hot-reloads it in place;
- `tests/packs/external-pack` behaves the same as `packages/default-setup`, because nothing in the path reads
  which pack it is.

If the first bullet fails for a pack that is not default-setup, this step is not done, whatever else passes.

---

Steps 1-3 leave one difference: default-setup's directory ships read-only in `resources/` and is loaded in
place, where every other pack is installed into the user's data dir. These three remove it.

**The ordering is forced by one line.** `loadSingleExternalPack` deletes `registration.boot.contentManifest` for
external packs (`loader.ts:244-249`), and `evaluateContentPolicy` is called only from the declarative path
(`apply.ts:184`). So installing default-setup before step 5 gives it `importPackContent`, which evaluates no
`contentPolicy` — and default-setup declares `skipAtBoot: ['settings']` and `skipAfterOnboarding: ['notes']`, so
its settings would be reset at every boot and its notes would come back after onboarding. Step 5 before step
6 is not a preference.

**Done when — and this is Decision 1's test, not a checklist item.** From `npm run start` alone, with no
`apack run` process:

- editing a `.vue` in `tests/packs/external-pack` patches the component and keeps the app's state;
- editing a `.vue` in `packages/default-setup` does the same, as it does today;
- editing either one's backend rebuilds that pack and hot-reloads it in place;
- `grep -rn "builtIn" packages/renderer/src packages/api/src` finds nothing.

If the first bullet fails, this phase is not done whatever else passes. Then: `npm run chain` green, and
`npm run build-prod` boots with the api bundle no longer carrying a pack's backend, checked with
`DEBUG_E2E=1 npm test -- smoke`. Mutation: drop the dev source map and the first two bullets fail together,
which is what says the path is shared.

### Phase 4 — Delete `earlySystem`

`earlySystem` has one user — default-setup's `logs` (`apack.json:238`) — and forces
`loadSingleExternalPack` to strip it from every external pack (`loader.ts:235-243`). The pack-facing half
goes for good: the manifest field, its refinement, the codegen branch and the strip. No pack should ever
get it back, and the host needs no manifest to express anything.

`logs` stays in default-setup. Moving it would also have removed the privilege, but whether the Logs surface
should become a core app feature — updated only by a full app release — is a product question this goal
does not need answered, and deleting the field removes more while moving nothing.

**Cost:** `logs` stops starting before hydration, so hydration, `onInit`, migrations and applying stop
reaching the in-app viewer. Every line still reaches stdout and the log file, and pack loading was already
outside the captured window — `startEarlySystems` is step 6 of the boot order, pack loading step 4.

**What goes.** The pack-facing half, whose every piece exists only to express or to police the field:
the manifest field (`manifest-schema.ts:173`) and the whole `if (!manifest.builtIn)` refinement block
(`:258-263`), which holds nothing else, so `.strict()` refuses the key afterwards rather than a bespoke
message; the codegen branch that turns it into `packSystem(…, { early: true })`
(`generate-entries.ts:578`); the strip in `loadSingleExternalPack` (`loader.ts:235-243`) and its case
(`loader.spec.ts:92-95`); the declaration in `packages/default-setup/apack.json:238`. Then
`npm run schema:update -w @apackdev/sdk` for `apack.schema.json:179-182` and `npm run api:update`.
Three specs assert the field and move with it: `manifest-schema.spec.ts:148-150` (the refusal — delete),
`entries.spec.ts:116-126` (drop it from the fixture and drop the `early: true` expectation), and
`modules.spec.ts:339,401`, whose exhaustive field lists fail by design when a field goes.

**What is lost, by boot step** (`packages/apack-host/src/packs/runtime/CLAUDE.md`):

| step | logged | reaches the viewer after this |
|---|---|---|
| 1-4 — dirs, discovery, pack load, registration | pack loading, every load problem | no change — already outside the window, since `startEarlySystems` is step 6 |
| 5-6 — store open, early systems start | — | — |
| 7+ — hydration, `onInit`, migrations, applying | the data layer coming up | **no**, this is the loss |
| the bus on | everything else | yes |

Everything in the lost row still reaches stdout and the log file, which is where this repo reads boot
problems anyway.

**Left open:** whether the host-side mechanism (`PackFeatureSystem.early`, `packSystem`'s option,
`startEarlySystems`, `getEarlySystems`, ~40 lines and a 122-line spec) goes too. For deleting it: nothing
sets `early` afterwards, which is exactly what Decision 5 deletes `partitionPolicy` for, and a mechanism
with no caller is a mechanism nobody is testing against reality. Against: `hostRegistration` writes its
`PackFeatureSystem` literally, so re-expressing `early` for a host feature is one property rather than a
manifest field — and [`plans/logs-to-host.md`](../plans/logs-to-host.md) is the deferred move that would
want it back the same day. Decide it when Phase 4 is implemented; either answer keeps the capability out
of the pack contract, which is the part that is settled.

**Done when:** `earlySystem` is absent from `manifest-schema.ts`, `apack.schema.json` and
`packages/default-setup/apack.json`; a manifest declaring it is refused by `.strict()` rather than by a
bespoke refinement; and the Logs surface still shows everything logged from the bus actor on.
Mutation: put `earlySystem: true` in a fixture manifest and watch the schema refuse it.

### Phase 5 — Merge the two content paths

Keep the external path's per-pack hashing and dependency tracking, port
`contentPolicy` onto it, and fold `builtInContentRevisions` into `externalContentRevisions` — renamed, since "external" stops
meaning anything. `0.4.0.ts` renamed *away from* `packContentRevisions` and `packContentDeps`, so that migration is the
map for renaming back.

**Cheaper than it was, because the semantics are settled.** This used to carry a decision as well as a rename:
the two hashes disagreed about what "changed" means — the external one counted file times, so a `touch`
re-applied and a reinstall of identical bytes did too, while the built-in one counted bytes alone behind a
`builtInContentFingerprints` stat cache. `0a25ff990` made both content-only and deleted that field, measuring the
cache at 0.38ms over default-setup's 490KB (0.07ms to stat the same files) — so there is no shortcut left to
decide about, and the fields differ only in name. Asking for a pack's data back is `IMPORT_PACK_CONTENT`.

**Done when:** one pair of fields (`packContentRevisions`, `packContentDeps`) carries every pack;
`orchestrateDeclarativeContent` and `importPackContent` are one function or share their freshness check;
`evaluateContentPolicy` runs for any pack with a `contentPolicy`. Mutation: give a fixture pack
`skipAtBoot: ['settings']`, boot twice, and assert its settings keys are absent both times — then remove
the `contentPolicy` call and watch it fail. The dependency-state retry keeps its cases in
`loader.spec.ts` (`externalContentDeps`' four).

### Phase 6 — Install on first boot

`installPackFromLocal(source, targetPacksDir, options)` →
`installFromDirectory` (`installer.ts:216,252`) already verifies, stages and writes `integrity.json` from a
directory on disk, so the new code is a call site. `BUILT_IN_PACKS_DIR` becomes `SHIPPED_PACKS_DIR` — rename
it, so every reader is revisited. `publishHostPackOutput`/`pruneHostPackOutputs` and `hostPacksDir` go, and
`database/schema.ts`'s two discovery sources and `degraded` branch go with them. On a version bump the
shipped copy is newer than the installed one, so boot compares integrity hashes and re-installs when they
differ — which also covers a user-modified install, a state that cannot exist today.

**`shippedWithApp` is what this step replaces, and it is two questions wearing one predicate.**
`system.ts:116` feeds three refusals: two that an installed pack may not take a shipped pack's id (`:184`,
`:315`) and one that a shipped pack cannot be uninstalled (`:240`). Split them, because only the second is
about shipping:

- **may this be uninstalled?** — a pack property, `false` for whatever the app cannot run without, which the
  Packs view reads to hide the button. Defaulting a shipped pack to `false` keeps today's behaviour exactly,
  and flipping it later is a product decision rather than a refactor. Uninstallable and replaceable built-ins
  are on the roadmap, so this step moves toward that rather than against it.
- **may an install take this id?** — not about shipping at all, but about an id already being in use, which
  `installedPacks()` answers. A shipped pack is in that list once it is installed, so this half mostly
  **deletes**: it existed because nothing else knew about packs that were not installed.

**What this buys, which is the whole reason for steps 4-6:** `publishHostPackOutput` and
`pruneHostPackOutputs` go, `hostPacksDir` with them, `fetch-deps.ts:157`'s special case becomes an ordinary
`packsDir` lookup, and `database/schema.ts` loses its second discovery source and its `degraded` branch.

---

**Done when:** a fresh data dir boots with default-setup installed under `<userData>/apack/packs/`;
a second boot installs nothing; a shipped copy whose integrity differs re-installs; `SHIPPED_PACKS_DIR`
has replaced `BUILT_IN_PACKS_DIR` at every reader; `publishHostPackOutput`, `pruneHostPackOutputs`,
`hostPacksDir` and `database/schema.ts`'s `degraded` branch are gone; `fetch-deps.ts:157` reads `packsDir`.
Mutations, each firing one case: ship a pack directory with no `integrity.json` (the install refuses,
naming it); leave the installed copy's integrity older than the shipped one (boot re-installs); set a
shipped pack's uninstall property true (the Packs view offers the button).

### Phase 7 — Review the whole change, then fix what it finds

**Not a phase of work; a phase of reading.** Six phases of mechanical deletion across the loader, the two
bundler configs, the shell, the content paths and the installer leave the kind of defect no single phase's
"Done when" is pointed at: a case that still passes because its fixture moved with the code, a branch whose
last caller went, an error message naming a thing that no longer exists, a claim in a guide that the diff
quietly falsified.

So: read `git diff master...` as a reviewer who did not write it — the source first, then the specs, then
the prose — and report the findings. **A finding is a defect.** Behaviour a Decision chose, a difference a
later phase was always going to remove, and doc or process bookkeeping are not findings, and listing them
buries the ones that are. Then fix all of them, with a case for any that a check would have caught.

Two questions worth asking deliberately, because nothing else here asks them:

- **Does any check still look at nothing?** Six phases deleted subjects. A spec whose premise went but whose
  assertions still pass is the failure mode, and `population(...)` / the empty-subject rules are what the
  repo has for it.
- **Is every message still true?** A refusal, a warning or a log line naming `bundledLoaders`, a `builtIn`
  distinction or a path that moved is a lie told at the worst moment.

**Done when:** the findings are reported, each one is fixed or explicitly declined with a reason, and
`npm run chain` is green afterwards.

## Risks

**The `pack://` proxy masks a dev-server miss.** `PackProtocol.ts:60-69` does `if (res.ok)` and otherwise
falls through to reading the installed pack directory, so a 404 from a running dev server silently serves the
**stale built** `fe.js`. You edit, nothing changes, and nothing says why. Once a marker says a dev server is
running for a pack, a miss belongs as an error naming the path. Worth fixing regardless; it was not the cause
of the dead loop (`ctx.load().code` was), which is why it is still here to find.

**A pack's `feStyles` arrives as a separate `<link>`** (`packFrontendIO.styles.add`), where in dev Vite
serves CSS through the JS graph. Stale or absent for a pack being developed. Harmless today because the packs
using that path are not the ones with HMR; it stops being harmless under step 3.

**Step 1 touches the dev loop.** `dev-build.mjs` is the backend watcher, not just a build. Replacing it badly
makes `npm start` slower or stops the API hot-reloading, which is the most-used path in the repo.

**Step 3 changes what a release loads.** The api bundle stops carrying a pack's backend, so a packaging
mistake becomes "the app boots with no default pack" rather than a build error. The pre-flight above was
taken and passed, so what stands between this and that outcome is a `build-prod` smoke run per release
rather than an argument.

**Step 6 makes first boot able to fail, which is the one real behaviour change here.** Today the app cannot
fail to find its default pack; afterwards a disk-full or permissions error at first launch means no packs.
Decided rather than mitigated away: the install is idempotent and verified at every boot, and a failure is
loud — fatal with a message naming the pack and the path — rather than a silently packless app. The
alternative, a read-only fallback that loads straight from `resources/`, is the built-in load path returning
in disguise and should be rejected unless the install proves unreliable in practice.

**What the install costs the backend edit loop: ~10ms**, which is the objection that did not survive
measurement. default-setup's `dist` is 4.2MB over 20 files; `placePack`'s copy is 7ms (median of 5, 6-9ms)
and the sha256 of every file that `stagePack` does for `integrity.json` is 3ms — both 2026-10-07, against an
esbuild rebuild of hundreds of milliseconds. Installing a pack per backend edit is not a devex cost.

**`dist/runtime/fe.js` becomes load-bearing for the app's own frontend** under step 3. A pack FE bundle that
fails to build currently costs an external pack its UI; afterwards it costs the app its UI in production.
`compile` runs in the chain, so it is caught before a release, but it is a new way for a green typecheck to
ship a broken app.

## Deferred

- Not making packs installable from a registry: `resolveFromRemoteRegistry` still throws for every name.
- Not a performance change. The win is four build paths becoming one and two load paths becoming one.
- Not a change to `@apackdev/sdk`'s published surface, except that `partitionPolicy` leaves the manifest schema
  in step 2 (and `earlySystem` would in open-question step A), which needs `schema:update` and `api:update`.

## Constraints

The standing rules, plus this goal's own:

- commit each phase as it finishes, no attribution lines, `git commit -- <paths>`, and `git diff --cached`
  first — something outside the session stages files in this repo;
- pushing, tagging and PRs are on request; no publishing, releases or triggered workflows;
- no real data dirs (`~/Library/Application Support/apack*`), no broad `pkill`; an app launched outside
  the test environment gets an isolated `APACK_USER_DATA_DIR`, and `apack run --ephemeral` is the
  cheapest way to get one;
- no bare `tsc` in `packages/preload`, no `npm install` in the example pack, no version or release metadata;
- typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`);
- published packages expose no `any`, keep the TypeScript floor, and need `api:update` after an export
  change;
- `packages:ensure` once before any fan-out; a stale build looks like a bug, so check what a failing run
  loads before reading the code;
- migrations follow `packages/apack-host/src/migrations/CLAUDE.md`, and go in the latest unreleased target
  rather than a new version file;
- investigate a failing test rather than loosening it; mutation-check every new guard;
- external packs are first-class: `tests/packs/*`, the example pack and `test:packaged-authoring` keep
  passing, and Phase 3's test is a fixture pack rather than default-setup for exactly that reason.

**The loop to keep fast.** The narrow checks cost seconds and the chain costs about three minutes, so each
phase's "Done when" names the narrow commands and the chain runs once at the end of a phase, in the
background while the diff is read. Phases 1 and 3 are the two that genuinely need a slow check every time —
`npm run compile` for the first, a packaged build for the second — and that is a decision rather than a
habit.

---

## Outcome

**Every pack is installed, and loaded from where it is installed.** `installShippedPacks` copies each
directory under `SHIPPED_PACKS_DIR` that holds an `apack.json` into `<userData>/apack/packs/<id>`, and
`loadAppPacks` then loads every pack by one path. `manifest.builtIn` decides nothing: it survives as a
field a pack declares and as `pack.ts`'s refusal to pack a pack that ships inside the app, which Phase 6's
own text keeps as axis 1.

**Phase by phase**

| Phase | | |
|---|---|---|
| 1 | done | `apack build --watch` replaces `dev-build.mjs`; `RESOLVED_AT_RUNTIME` named. The watch rebuilds the runtime alone — 40ms against the full build's 23.7s |
| 2 | done | `partitionPolicy` gone; `appPartitionPolicy()` is a constant in `database/open.ts` |
| 3 | done | `npm run start` alone gives frontend and backend hot reload for every workspace pack, `tests/packs/external-pack` included, with no `apack run`. Held by `internal-repo-checks`' `dev-pack-hmr` |
| 4 | done | `earlySystem` deleted, not widened |
| 5 | done | one `applyPacks`, one `packContentRevisions`/`packContentDeps`, one policy for every pack |
| 6 | done | install replaces publish; `publishHostPackOutput`, `pruneHostPackOutputs`, `hostPacksDir`, `loadBuiltInPacks`, `discoverBuiltInPacks`, the `publishing` staging kind and `schema.ts`'s `degraded` branch are gone |
| 7 | done | 15 findings, all fixed; `npm run chain` green |

**Two production bugs the change exposed, both invisible before it.** A pack loaded from a checkout has the
workspace `node_modules` above it, which answered every bare specifier its bundle left external; an
installed pack has none. So:

- **`vue` and `@vscode/ripgrep` were externals nothing provided.** A pack's backend bundle carries its
  steps' frontend facets, so `extensions/steps/<type>/fe.ts` puts a top-level `require("vue")` in it. The
  loader provided only `getSharedBeDeps()` (`xstate`, `zod`). `HOST_RESOLVED_BINARIES` moved to
  `shared-deps.ts`, where the bundler's externals and the loader's `hostPackages` both read it, and
  `hostPackages` now covers every external. `pack-externals.spec.ts` holds the two halves together.
- **A lazy `require` outlived the resolution that served it.** esbuild defers a module body into an
  `__init` the bundle calls on first use, so default-setup's action step required `@apackdev/sdk/logger`
  when a step first ran, long after `withHostResolution` had restored the resolver. Applying the require
  cache cannot cover it, Node resolving before it reads the cache. `keepHostModulesResolvable` installs
  resolution for the process and never throws; `withModuleBridge`'s refusals stay scoped to the load they
  diagnose, which is where a *rebuild this pack* message belongs.

Both would have shipped: `DEBUG_E2E=1 npm test -- smoke` passed its four cases while the app logged
`Cannot find module '@apackdev/sdk/logger'` for every action step. **A green suite beside a failing app is
what that flag is for.**

**Three premises in this plan were wrong**, corrected in place where they are stated: `dev-build.mjs`'s
esbuild was not what rebuilt the pack's frontend, the published `host-packs/` layout's `.fingerprint`
answered freshness rather than integrity, and `be-bundler.ts`'s comment claimed an installed pack resolves
`RESOLVED_AT_RUNTIME` from its own `node_modules`, which it has none of.

**Conventional choices, where the plan left a detail open**

- `canUninstall` is derived (`packId !== HOST_PACK_ID && origin?.shipped !== true`) rather than a stored
  property. `PackInfo.canUninstall` is the half the Packs view reads, which is what Decision 8 asked for;
  flipping it later is one line.
- `beforePlace`'s `HOST_PACK_ID` refusal was **deleted** rather than kept: `manifest-schema.ts` refuses the
  id before any caller sees the manifest, so the second check could not fire. One gate, with its own case.
- `rebuildCommand` names the one pack the repo builds through a script of its own
  (`SCRIPTED_PACK_BUILDS`) rather than asking a manifest what kind a pack is.
- A leftover `host-packs/` in an existing dev data dir is **left alone**. It is derived build output that
  nothing reads any more, and deleting from a user's data dir was not asked for.
- `installShippedPacks` filters on an `apack.json` being present, not on `builtIn`. In this checkout only
  `packages/default-setup` matches; a second shipped pack would be installed, which is the point.

**What was not done, and why**

- **`grep -rn goal-one-kind-of-pack packages scripts` returns 3, not 1.** The dev-server spec's, plus
  Phase 3's acceptance spec (`dev-pack-hmr`) and the `internal-repo-checks` table row describing it — neither
  existed when that line was written, and a spec whose whole subject is this goal's devex requirement is
  the right place to cite it.
- **`chain --record` was not run.** `compile` grew 13s → 31s and `test:smoke` 9s → 25s, both real: the
  pack's build now produces its frontend bundle, and a fresh data dir now installs a pack. Recording needs
  a quiet machine and is the user's call —
  `npm run check:idle && npm run chain -- --all --record --forget --step compile` (and `--step test:smoke`).
