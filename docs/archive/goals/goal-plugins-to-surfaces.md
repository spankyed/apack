# Goal: rename the frontend plugin to a surface

```text
# Goal: rename the frontend plugin to a surface

Implement docs/archive/goals/goal-plugins-to-surfaces.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Current handoff, What keeps the name, Phases and Constraints before continuing.
The survey was made at 507b3b747 on master (2026-10-21); inspect current code before relying on it.

Never find-and-replace over `plugin`. "What keeps the name" lists what must not move: editor
plugins, bundler plugins and two stored string literals. One is published API; one is user data.

Finished when:
- Every phase's "Done when" holds on current source, and each new guard is mutation-checked.
- The concept is named `surface` throughout: `Surface`, `SurfaceDeclaration`, `useSurface`,
  `surfaceId`, `features[].surface`, `getRegisteredSurfaces`, `sendToSurface`.
- A guard fails when it is named `plugin` again, and passes for what keeps the name.
- The two `AppState` fields and the two window-storage keys are renamed outright, with no migration.
- `npm run chain` passes.
- Record Outcome, archive this document, repair links and commit closure.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
```

## Scope

A feature's frontend half is a **surface**; its backend half stays a **system**. Rename the concept in
code, in the manifest, on the wire, in stored data and in the docs.

Excluded: `pack`; the areas a surface fills (`canvas`, `panel`, `chat`, `settings`); and everything
under "What keeps the name".

Surveyed 2026-10-21 at `507b3b747`.

## Outcome

**Done**, on `session/plugins-to-surfaces`, which was rebased onto master and finished in the main
checkout. Two runs stand behind it, and it takes both, because the branch kept moving after the forced
one:

- `npm run chain -- --all --strict`: **1378.3s, 32 steps executed, none cached, none failing**
  (`…/runs/2026-10-22T05-51-34Z-30468`), critical path 1019s
  (`packages:ensure -> build:default-setup -> test:native`). `--all` runs every step regardless of its
  stamp and `--strict` fails the run if a step's inputs move while it reads them.
- `npm run chain` at the final commit: **18.4s, 26 of 32 cached** (`…/runs/2026-10-22T06-15-10Z-80688`).
  The six it re-executed are exactly the steps the forced run had read before the last edits landed —
  `packages:ensure`, `check:specifiers`, `check:tiers`, `lint:check`, `typecheck:scripts`,
  `test:integration`. `npm run chain -- --dry` then reports 32 of 32 cached.

Between them every one of the 32 steps has a passing execution against the current content of its
declared inputs, which is the claim worth making — and the reason the second run is not a formality.

**A rebase invalidates a chain result, and the first version of this section did not say so.** It cited
a forced run at a commit whose SHA the rebase had rewritten, together with an argument that the chain's
stamps make any later cached run equivalent. The stamps do mean that — but only while the *content* a
step reads is unchanged, and replaying onto a master eight commits ahead changes trees, not just
commit ids. Remapping the SHA would have pointed a real measurement at a tree nobody measured. The pair
above replaces it; the argument it replaces is kept here because the mistake is easy to repeat.

**What a step's reading is not.** Several `apack-cli` integration specs in the forced run read 3-8x
their recorded medians (`build-output-swap` 397.0s against 49.9s over 10 runs, `dependency-graph`
169.3s against 43.0s). That is the run loading the machine it is measuring, and load inflates a
duration without ever deflating it, so nothing gates on it and none of these timings is citable as a
measurement. The `@slow:` marker gate fires only on *measured faster than declared*, which is why a run
like this one cannot fail it.

**The load-sensitive spec that prompted it is fixed rather than reported.**
`tests/packs/external-pack/tests/e2e/app-default-controls.spec.ts` had an `expect.poll` taking
Playwright's 5s default while the test's own budget was 60s; it gave up 28.4s into a pack restore while
the app was working correctly. It subscribes to the packs actor now (`5efaea35d`), so the deadline names
what never arrived instead of being the thing waited on, and `waitForSurface`/`waitForState` were
changed the same way (`cb639cb32`). Both halves pass in the forced run: `test:smoke` 8.1s,
`test:external-pack:app` 119.2s.

**What landed after the phases below.** Window storage was namespaced by the surface's ref
(`surfaceStorage`/`useSurfaceStorage`, the `window-storage` pack rule); the two 0.4.0 migrations this
goal had written — one app-line, one window-storage — were **deleted**, the app having been renamed and
re-namespaced without ever shipping, so they migrate nobody and a developer's own instance is moved by
hand; and a review before landing found two gates that did not gate and three claims that had stopped
being true (`c6b59447b`). The archived guides were renamed to the current vocabulary too
(`606930c85`), which is a readability change and not this guard's subject (`fe72a6a00`).

| Phase | Commit | Evidence for its "Done when" |
|---|---|---|
| 1 — the guard | `8addf2299` | Live in `@app/internal-repo-checks`. Each of the five names its condition lists was planted on its own and fails the scan alone: `pluginId`, `usePlugin`, `sendToPlugin`, `getRegisteredPlugins` as a one-line module, `features[].plugin` as an `apack.json`. Also: unparked it reported 2128 violations; adding `TiptapPlugin` to a group failed the kept-spellings case; a stale `ALLOWED` entry was named |
| 2 — the concept | `8fe89f39a` | `typecheck` 17/17, `api:check`, `schema:check`, `test:unit` 5689, `build:default-setup`, and `npm run test:external-pack` run directly, exit 0 — `:contract` 38 tests over 11 files, `:fork`, `:app` 27 + 5 specs |
| 3 — the wire | `17504b901` | `npm test -w @apackdev/host` 1746 passed / 135 files, including `tests/bus/outgoing-events.spec.ts` and `tests/packs/event-validation-map.spec.ts`; `test:smoke` 16.1s in the chain. Mutation, at the site the condition names — a `pluginId` left in the **renderer's** routing (`features/application/fe/connection.ts`, looking the surface up by the field the transport used to stamp): **5 of 110** renderer routing specs fail, in `plugin-reply` and `send-scope`. Smoke still passes, so of the condition's two candidates only the event specs catch it. The bus's own lookup was mutated too and failed **23** specs across `outgoing-events` and `event-validation-map` |
| 4 — stored state | `c7f16a507`, and the migration removed after | Renamed outright. `npm test -w @apackdev/host`; `tests/fe/window-storage.spec.ts` holds the runner's cases around an empty list |
| 5 — docs, guard live | `b37bf3c08` | Scan unparked and green; `welcome.md` re-recorded; `doc-links` passing |
| 6 — the prose read | `2cdfe0056`, `694106871`, `f64a22c9f` | 19 inversions. Mutation: the guard caught a local renamed to `readPluginState`, which collides with the retired SDK reader. Its "no comment or guide sentence" condition rests on a **complete enumeration** — all 241 remaining occurrences classified, not a sampled grep — which found eight concept names that four passes had missed, `setPluginVisible` among them, published. All four memory files now name only things that exist |

`npm run test:e2e -- smoke` (5 passed), `npm test -w @apackdev/host` (1746 over 135 files) and
`npm run test:external-pack` (exit 0, all three halves) are each run directly, as their phases name
them, rather than only as chain steps.

**Phase 2's exit grep contradicts Decision 2 of this same document, and the grep is the one that is
wrong.** As written it searches for `PluginDeclaration` as a substring, and in
`packages/apack-sdk/src/framework/` all **5** occurrences of that string are `TiptapPluginDeclaration` —
5 and 5 — which is published API that Decision 2 forbids moving. So the condition is unsatisfiable
without breaking the constraint beside it; it can only be met word-bounded. Word-bounded it leaves two
sources, both correct: `CHANGELOG.md`, where a 2024 entry reads "rename usePlugin to useState
composable" and is released history, and the guard's own retired list, which has to spell the names it
retires. A future goal writing an exit grep should anchor it, or name the kept compound it will hit.

**Phase 1 took the first of the two options its condition offered**: the guard landed parked as
`it.fails` in `8addf2299` and was flipped in `b37bf3c08`, rather than being ordered last in the phase's
commits. Nothing further was owed.

**The guard did not read a guide until the end, and that is where the last residue was.** Its population
was code only, so `SELECT_PLUGIN_BY_SHELL` and `OPEN_PLUGIN_FROM_APP` sat in `@apackdev/host`'s guide —
the one place a reader goes for an event's name — through five phases, and `code-plugin-open-tabs` sat in
a terminal issue note. Reading all **48** guide lines that mention the word, rather than classifying by
regex, is what found them. The guard now holds the guides to the same identifier lists, which is safe
precisely because no group is the bare word: a guide says "tiptap plugins" and "a Vite plugin"
legitimately. Mutation: restoring the stale event name fails that case.

**Prose is the one part no guard covers, and it took two complete reads to finish.** The guard's groups
are identifier lists, so a comment that calls a surface a plugin in words is invisible to it by design —
widening it to the bare word would fire on every "tiptap plugins" and "a Vite plugin" a guide writes
legitimately. What settles that condition is reading, and reading all of it. The population is every **standalone
English** occurrence of the word — the word not inside an identifier, a path or a quoted key — which
partitions into **43** in a comment or a guide and **78** on a code line, and both halves were read:
the 43 are the sentences this condition is about, and all 78 are a third-party identifier or config key
(`plugins:` arrays, `Plugin` from `vite`, `esbuild` or `@tiptap/pm/state`), a test title naming a kept
vocabulary, the Claude Code CLI's own parameters and argv, or a migration `description` that correctly
names the attributes it moves. A looser cut over comment syntax found 47 and the guides 48; the
partition is the tighter one and confirms neither missed a sentence. Classifying the 241 occurrences by regex
instead kept lines it never read, and `be-bundler.ts:342` — "Step and plugin definitions reference Vue
components and styles" — survived four passes, the enumeration and a chain inside that blind spot,
because the file had been reverted whole for its bundler vocabulary and the one concept sentence in it
was never revisited.

**The sampled grep is what let residue through.** Four passes, a live guard and a green chain all held
while eight concept names survived — `SettingsPluginEvents`, `ApplicationPluginEvents`,
`DependencyPluginState`, `SendToPlugin`, `setPluginVisible`, `setPluginVisibility`,
`updatePluginVisibility`, `togglePluginVisibility` — plus codegen's `__plugin_` binding prefix, which is
a fragment no `\b` reaches. None was in the guard's list, so nothing could have caught them; they are in
it now, with the prefix as its own pattern. A rename's completeness claim needs an enumeration, not a
search.

**The four things it cost, which the plan had three of.** The fourth vocabulary is a third-party CLI's
own plugins (`claude plugin`), and it is the one no check can reach: its names go into a **subprocess
argv**, so a pass that rewrote `run(['plugin', 'install', …])` to `run(['surface', 'install', …])`
typechecked, passed every spec, and would have called a subcommand that does not exist. It is in the
guard's `KEPT` list now with the argv spelled out. The compiler caught the other three collisions —
ProseMirror's `Plugin` class, Vite's and esbuild's `Plugin` types, and Vite's `pluginContainer`.

**Two miss classes worth carrying forward.** An identifier written after `\n` inside a string literal
has a word character before it, so a `\b`-anchored rename never sees it — two sends were left behind.
And a token mask passes a sentence that names a kept vocabulary generically: "tiptap plugins", "a
ProseMirror plugin", "the plugin injects an import map" all inverted while every masked token held.
Nineteen such sentences needed a read rather than a replace, which is what Phase 6 was for.

**What a docs pass must not touch**, each found by touching it: `CHANGELOG.md`, which is released
history; `etc/*.api.md`, which are generated and go stale against their generator; and the guard's own
`KEPT` list, which a Phase 2 pass damaged — two bundler samples became `surfaces: [vue()]` and
`surfaces.push(x)`, so the case stopped asserting the thing it exists for.

**`PACK_SNAPSHOT_FORMAT` was not bumped**, though `PROVENANCE_KINDS.plugins` became `surfaces`. There is
one CLI and every pack in this tree rebuilds with it, so the mismatch the format exists to catch cannot
arise here. Revisit with the backward-compatibility rule, when a third-party pack can be installed from
a registry.

**Left open, both named in the code that raises them:**

- ~~`'code-surface-open-tabs'` is a pack's window-storage key moved by the host.~~ **Closed.** Keys are
  no longer typed: `surfaceStorage`/`useSurfaceStorage` (`@apackdev/sdk/fe`) derive the prefix from the
  surface's ref, the `window-storage` pack rule refuses raw `localStorage` in pack source, and the host
  carries no pack key. What a pack still cannot do is move its own *names*, which is
  [its own deferred plan](../../plans/deferred/pack-window-storage-migrations.md) and wanted by nothing
  today.
- `pickOne` answers `null`, not `undefined`, for an absent attribute — found by the migration this phase
  wrote and then dropped. It is a sharp edge for every future migration, and nothing records it now.

**One thing to settle in Phase 2, not during it.** `PROVENANCE_KINDS.plugins` (`build/manifest.ts:162`)
is a snapshot key a dependent pack reads, and `packages/apack-sdk/CLAUDE.md` says to bump
`PACK_SNAPSHOT_FORMAT` for any change to what a dependent reads from a snapshot that another CLI would
misread. There is one CLI and every pack is in this tree, rebuilt together, so a bump guards against
nothing here — but the rule says otherwise, so do not bump it quietly either way.

## What this touches

**6503 occurrences of 454 distinct identifiers** containing `plugin`, over `packages/`, `scripts/`,
`tests/` and `drive/`, excluding Markdown and JSON. 300 occurrences of 72 identifiers keep the name;
the other 6203 move. Including Markdown, the word is on 5712 tracked lines in 654 files.

**The manifest and codegen.** A surface is declared as data under `features.<id>.plugin`
(`PluginDeclaration`, `packages/apack-sdk/src/framework/plugin-declaration.ts`), which codegen binds to
a machine and components (`Plugin`, `packages/apack-sdk/src/fe/plugin.ts:53`). There is no
`definePlugin`. `apack.schema.json` names `plugin` 19 times and is generated from
`framework/declaration-schema.ts`.

**28 published `@apackdev/sdk` entries**: `Plugin`, `PluginDeclaration`, `PluginDefinition`,
`PluginEvent`, `PluginEvents`, `PluginInbox`, `PluginInboxAudiences`, `PluginInboxOf`,
`PublicPluginInboxOf`, `PluginStateOf`, `PluginHotkeyDefinition`, `PluginScope`, `PackPluginEntry`,
`PackPluginEvents`, `PackPluginState`, `PackFeaturePlugin`, `HostPluginEvents`, `OwnPluginEvents`,
`QualifiedPluginEvents`, `TypedSendToPlugin`, `usePlugin`, `pluginIsRunning`, `useUntypedPluginState`,
`readUntypedPluginState`, `untypedOpenPlugin`, `untypedBroadcastToPlugin`, `_sendToLocalPlugin`,
`_pluginTargets`. `@apackdev/ui`'s plugin-named exports are all tiptap's; `@apackdev/ears` has none.
`usePlugin` is pack-facing, so this breaks default-setup, `tests/packs/*` and the CLI's `add feature`
scaffold and `init` templates.

**`@apackdev/testing` is pack-facing too**, and has no `etc/` report to catch it: `app.navigate(pluginId)`
and `app.waitForPlugin(pluginId)` are what every pack's E2E suite calls, documented in
`packages/apack-testing/CLAUDE.md`, `tests/e2e/CLAUDE.md` and `docs/public-facing/testing.md`, and
`__PLUGIN_ID__` is the placeholder `apack pack init-tests` scaffolds into a pack's smoke spec.

**16 of default-setup's content sources send to a plugin** (`src/content/actions/**`,
`services.emitter.broadcastToPlugin('default-setup/threads', …)`). Their text is compiled by
`apack pack build`, so renaming the send moves each one's `contentHash` and the run needs
`npm run content-parity:update -w @app/default-setup`.

**The wire.** `pluginId` (220 occurrences, plus `pluginIds`, `pendingPluginId`, `activePluginId`) is
stamped on every backend→frontend event, routed on by the renderer, and validated against
`getPluginEventValidationMap()`. **22 event names travel**: `OPEN_PLUGIN`, `SEND_TO_PLUGIN`,
`SELECT_PLUGIN`, `SELECT_PLUGIN_BY_SHELL`, `SET_PLUGIN_VISIBILITY`, `PLUGIN_VISIBILITY_UPDATED`,
`PLUGIN_ACTIVATED`, `PLUGIN_DEACTIVATED`, `PLUGIN_PICKED`, `PLUGIN_DECLARATIONS_CHANGED`,
`PACK_PLUGINS_UNLOADED`, `REQUEST_PLUGIN_DATA`, `RECEIVE_PLUGIN_DATA`, `DELIVER_PLUGIN_EVENTS`,
`SET_LAST_ACTIVE_PLUGIN`, `TRAIL_NEW_PLUGIN`, `SWITCH_PLUGIN_UP`, `SWITCH_PLUGIN_DOWN`,
`OPEN_PLUGIN_FROM_APP`, `APP_OPEN_PLUGIN_HELP`, `APP_POPOUT_PLUGIN`, and the scaffold placeholder
`__PLUGIN_ID__`. Five `eventTypes<T>()` constants pin them to their contracts: `PLUGIN_EVENT_TYPES`
(`@apackdev/sdk/events`), `HOST_PLUGIN_EVENT_TYPES`, `APPLICATION_PLUGIN_EVENT_TYPES`,
`PACKS_PLUGIN_EVENT_TYPES` and `SETTINGS_PLUGIN_EVENT_TYPES`.

No pack rule changes: `reserved-event-keys` guards `_call` alone, and no rule key names `plugin`.

**Stored data**, renamed outright with the rest (Phase 4):

- `AppState.pluginVisibility` and `AppState.lastActivePlugin`
  (`packages/apack-host/src/app-state/index.ts:51,53`, both named in its attribute list).
- The window-storage keys `'code-plugin-open-tabs'`
  (`packages/default-setup/src/features/code/fe/utils/persisted-tabs.ts:18`) and
  `'apack-last-active-plugin'`.

Per-feature settings are keyed by feature (`forFeature`), so there is nothing else stored.

## What keeps the name

Allowed per pattern, not per file, the way `identity-guard`'s exemptions work.

**Editor plugins (tiptap/ProseMirror).** The manifest key `frontend.tiptapPlugins`, which sits in the
same schema as `features.<id>.plugin`. Published: `TiptapPlugin`, `TiptapPluginBinding`,
`TiptapPluginDeclaration`, `TiptapPluginSchema`, `tiptapPluginRegistry` (`@apackdev/sdk`), and
`searchPlugin`, `searchPluginKey`, `SearchPluginState` plus the exports-map entry
`./components/tiptap/extensions/search-plugin` (`@apackdev/ui`) — an entry point, not only a symbol. In
sources: `PluginKey`, `addProseMirrorPlugins`, `editor.registerPlugin()`,
`commandSuggestionPlugin(Key)`, `referenceSuggestionPlugin(Key)`, `imagePastePlugin`,
`inputRulesPlugin`, `editorPlugins` (`generate-entries.ts`), everything under
`apack-ui/src/components/tiptap/` and `default-setup/src/extensions/tiptap/`, and the filenames
`command-suggestion-plugin.ts`, `reference-suggestion-plugin.ts`, `reference-plugin-key.ts`,
`search-plugin.ts`, `tiptap-plugins.ts` — the last beside `plugin-state.ts`, which does rename.

**Bundler plugins.** `VitePlugin`, `esbuild.Plugin`, `pluginContainer` (Vite's own API), every
`plugins: [...]` and `plugins.push(...)`, and the repo's own: `packExternalsPlugin`,
`hostSharedModulesPlugin`, `tailwindInjectPlugin`, `opaqueVendorPlugin`, `inputReportPlugin`,
`keepExternalsBarePlugin`, `importAnalysisPlugin`, `globWatchPlugin` (`apack-cli/src/build/fe-bundler.ts`,
`glob-watch.ts`); `rejectHostImportsPlugin`, `stubFrontendAssetsPlugin`, `capturedSourcesPlugin`
(`be-bundler.ts`); `createValidatorPlugin` (`apack-sdk/src/build/compile-utils.ts`); `vueSfcPlugin`,
`stubSfcPlugin` (`apack-testing/src/vitest.ts`); `devPackFrontendsPlugin`, `postcssPlugin(s)`,
`tailwindPostcssPlugins` (renderer configs); `pluginVitest`, `pluginOxlint`
(`renderer/eslint.config.ts`); `collect-bare-imports` (`scripts/lib/published-imports.ts`). Plus the
dependency names `@vitejs/plugin-vue`, `vite-plugin-vue-devtools`, `vite-plugin-static-copy`,
`rollup-plugin-dts`, `eslint-plugin-vue`, `eslint-plugin-oxlint`, `@vitest/eslint-plugin`.

**Two stored string literals.** `'code-plugin-open-tabs'` and `'apack-last-active-plugin'` are keys in
the user's window storage, not identifiers, so a rename orphans whatever a window holds under them.
Phase 4 renames both anyway — see there for why that costs nothing.

## What the user sees

The word is in the product, not only the code, and it goes too — nothing is left saying `plugin`.

- `WebApp.vue:146` — the context-menu item `'Pop Out Plugin'`.
- `CanvasArea.vue:27` and `PopoutTitlebar.vue:22` — `title="Plugin menu"`.
- `Hotkeys.vue:19,28` — the settings labels `"Previous Plugin"` / `"Next Plugin"`, and the ids
  `switch-plugin-up` / `switch-plugin-down`.
- `PackDetail.vue:239` — a feature's `plugin` badge, sitting beside its `system` one.
- `Toolbar.vue:15,36` — `data-onboarding-id="plugin-<id>"`, the selector
  `packages/renderer/tests/views/layout/toolbar.spec.ts:26` queries buttons by.
- `packages/default-setup/src/content/notes/welcome.md:29,30,32,62` — the first thing a new user
  reads: "switch between plugins", "the active plugin" twice, "the Brain plugin". **Content**, so the
  edit moves its `contentHash` and the run needs `content-parity:update`.

## Phases

### Phase 1 — write the vocabulary down, and guard it

**Deliverable.** The vocabulary in `CLAUDE.md` and `packages/renderer/CLAUDE.md` — a backend actor is a
system, a frontend actor is a surface, `plugin` belongs to the groups above — and a guard that holds it.

The guard lives in `@app/internal-repo-checks`, modelled on `packages/internal-repo-checks/tests/identity-guard.spec.ts`:
patterns with per-pattern allowances carrying a reason, and a staleness case that fails an entry which
no longer fires. It cannot live in `@apackdev/host` — a guard over the whole repo has to sit in a suite
that declares the whole repo (`SUITE_READS`' `repo`), which `internal-repo-checks`' `fingerprint-scope` and
`chain-inputs` enforce.

**Dependencies.** None.

**Done when:** the guard fails for each of `pluginId`, `usePlugin`, `features[].plugin`,
`sendToPlugin`, `getRegisteredPlugins` outside its allowances, and passes for the three groups above.
Mutation: renaming `TiptapPlugin` fails the allowlist's staleness assertion rather than passing
silently. The guard cannot pass mid-rename, so park it as `it.fails` and flip it in Phase 5, or order
it last in this phase's commits.

### Phase 2 — the concept: types, manifest key, codegen, host, renderer, packs

**Deliverable.** The 28 published entries above, their unpublished neighbours
(`PluginFrontendBinding`, `PluginCatalogEntry`, `ShellPluginCatalog`, `SendablePluginEvents`,
`PluginName`, `OwnPluginName`, `DependencyPluginName`, `PluginPane.vue`, `PluginRouter.vue`,
`ToolbarPluginContextMenu.vue` and the rest), the manifest key, codegen, and every caller.

- Manifest: `features[].plugin` → `features[].surface` in `framework/declaration-schema.ts` and
  `plugin-declaration.ts`; regenerate `apack.schema.json` (`npm run schema:update -w @apackdev/sdk`);
  update the CLI's `add feature` scaffold and `init` templates.
- Codegen: `generate-entries` emits `pack-entry-fe.ts` from the new key; `getRegisteredPlugins` →
  `getRegisteredSurfaces`, `registerPackFE`'s registration field, `FePackRegistryView`.
- Renderer: the application actor's surface list, `packPluginIds`, `loadPackFrontend`, and the
  `views/layout` components. Phase 3 owns the popout query and `plugin:popout` IPC.
- Every in-repo pack: default-setup and `tests/packs/*`; `@apackdev/testing`'s driver and the
  `init-tests` scaffold.
- `npm run api:update`, `npm run facade:update -w @app/default-setup` (its `etc/pack-types.api.md`
  names the concept throughout), and `npm run content-parity:update -w @app/default-setup` for the 16
  action sources.

**Dependencies.** Phase 1's vocabulary; not its guard.

**Done when:** `npm run typecheck`, `npm run api:check`, `npm run schema:check -w @apackdev/sdk`,
`npm run test:unit`, `npm run build:default-setup` and `npm run test:external-pack` pass.
`git grep -E '\busePlugin\b|\bPluginDeclaration\b|\bdefinePlugin\b'` finds nothing outside
`docs/archive`, `CHANGELOG.md` and the guard's own retired list.

**Anchored, on the author's decision, because the unanchored form could not hold beside Decision 2.**
Written without `\b` it matched `PluginDeclaration` as a substring, and all five occurrences of that
string in `packages/apack-sdk/src/framework/` are `TiptapPluginDeclaration` — published API Decision 2
forbids moving, so the phase could only have been closed by breaking the constraint beside it. The two
exceptions the condition now names are a 2024 changelog entry, which is released history, and the
guard, which has to spell the names it retires. A later exit grep should be anchored from the start, or
name the kept compound it will hit.

### Phase 3 — the wire: `surfaceId` and the event names

**Deliverable.** `pluginId` → `surfaceId` across the transport, the bus, the renderer's routing, the
registry's validation map (`getPluginEventValidationMap` → `getSurfaceEventValidationMap`) and
generated events. `SURFACE_ACTIVATED`, `SURFACE_DEACTIVATED`, `SURFACE_VISIBILITY_UPDATED`,
`SET_LAST_ACTIVE_SURFACE`, `OPEN_SURFACE` and the five `*_PLUGIN_EVENT_TYPES` constants, with their
`eventTypes<T>()` pins updated.

Three internal strings go here too, each with its consumer in the same commit: `'plugin:popout'` and
`?popout=plugin&pluginId=` (`main/WindowManager.ts:144`, `preload/src/index.ts:35`),
`data-active-plugin` (`renderer/src/views/WebApp.vue`, read by `apack-testing/src/index.ts:342`), and
`'plugin-send'` (`api/src/transport/emitter.ts:64`).

Keep the standing warning in `CLAUDE.md` under its new name: never use `surfaceId` as a field inside an
event payload, since the transport stamps it.

**Dependencies.** Phase 2's type names. Separate from Phase 2 because it is the one change that can
typecheck and still fail at runtime.

**Done when:** `npm test -w @apackdev/host` passes, including `tests/bus/outgoing-events.spec.ts` and
`tests/packs/event-validation-map.spec.ts`; `npm run test:unit` and `npm run test:e2e -- smoke` pass.
Mutation: one `pluginId` left in the renderer's routing fails an event-validation or smoke spec rather
than passing silently — if it does not, add the spec that catches it.

### Phase 4 — stored identities

**Deliverable.** `AppState.pluginVisibility` → `surfaceVisibility` and `lastActivePlugin` →
`lastActiveSurface`, and the window-storage keys `'code-plugin-open-tabs'` → `'code-feature-open-tabs'`
and `'apack-last-active-plugin'` → `'apack-last-active-surface'`, with their consumers, fixtures and
tests. **Renamed outright, with no migration on either line.** The app has been renamed and
re-namespaced and has never shipped: there is no installed instance but a developer's own, which is
migrated by hand, so a migration is work for nobody. A window's storage keeps its runner
(`runWindowStorageMigrations`, `packages/apack-host/src/fe/window-storage/`) with an empty list, because
the version it records is what a first real migration will compare against.

No backward compatibility: no dual-read, no old-format fallback, no grandfathering.

**Dependencies.** Phase 2's `AppState` consumers.

**Done when:** current-format backup, import and reset keep their behaviour; `npm test -w @apackdev/host`
and `npm run test:unit` pass; `packages/apack-host/src/migrations/` declares none, as before.

### Phase 5 — docs, and turn the guard on

**Deliverable.** Every tracked Markdown outside `docs/archive` that names the concept, which is what
the guard reports rather than a list to keep in step: **14 `CLAUDE.md` files** (186 lines, the biggest
being `packages/default-setup/`, the root, `tests/e2e/`, `packages/apack-host/` and
`packages/renderer/`) and **24 files under `docs/` (269 lines)** — all nine of `docs/public-facing/`,
four under `docs/references/`, four plans, two issues and the sibling goals. Everything under "What the
user sees". Flip Phase 1's guard live.

**Dependencies.** Phases 2–4.

**Done when:** `npm run chain` passes — which includes `content-parity:check` over the re-recorded
`welcome.md` — and the guard reports only the groups above and `docs/archive`.

### Phase 6 — the prose pass

**Deliverable.** A read, not a replace. The guard can only find the word; what it cannot find is a
sentence that has gone wrong because the noun moved. **4774 lines of source name the concept**, most of
them comments, and this repo comments heavily: a comment explaining why a plugin cannot answer a
by-ref send, or what a pane belongs to, often needs rewriting rather than substituting. Read every file
the rename touched and fix what now reads wrong, including each guide's prose.

Also the agent memory at
`~/.claude/projects/-Users-spankyed-Develop-Projects-AgentBuddy/memory/`, which no guard can see
because it is outside the repo. Three files name something this goal retires:
`feedback_no_mirror_or_text_tests.md` and `feedback_no_silent_design_calls.md` use `sendToPlugin` and
`usePlugin` as their worked examples, and `feedback_prefer_flows_over_systems.md` says "its own
frontend plugin". Update `MEMORY.md`'s pointers with them. `launch-film-edit-system.md` is a separate
project's vocabulary; leave it.

**Dependencies.** Phase 5.

**Done when:** `npm run chain` passes, no comment or guide sentence describes a surface as a plugin,
and the four memory files name current symbols and paths.

## Deferred

- Renaming `pack`, the extension unit: this goal is the level below it.
- Renaming `canvas`, `panel`, `chat`, `settings`: the areas a surface fills.
- `docs/archive`, which records the vocabulary of its time and is not checked against the code.

## Constraints

Standing repository rules apply as written (`CLAUDE.md`, `docs/AGENTS.md`): no backward-compat shims,
commits only on request, the chain as the gate. Goal-specific:

- **Never find-and-replace over `plugin`.** See "What keeps the name".
- Published packages: no `any`, the TypeScript floor, `npm run api:update` after export changes — Phase
  2 renames 28 public entries and must update `etc/*.api.md`.
- Typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`) and this goal must not
  touch them; `AppState` is the host's entity, and Phase 4 touches its fields, not that contract.
- Phase 4 declares no migration and is not a version bump; release metadata stays untouched.
