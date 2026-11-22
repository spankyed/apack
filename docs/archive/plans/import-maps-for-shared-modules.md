> **Done and closed.** Packs share the host's frontend modules by resolution: each is an entry of the
> renderer's build, the document carries an import map naming all 122 specifiers, and a pack's bundle leaves
> them external. `window.__apack`, `generateGlobalProxy` and the whole export-name discovery around it are
> gone — 134 lines from `fe-bundler.ts` and 69 spec cases whose subject was one mechanism policing the other.
>
> **Four corrections the work found**, each one the plan had wrong:
>
> - **The dev map cannot be computed, only read back.** The plan's `/@host/<specifier>` alias route would
>   have produced *two* instances of every module: a module's identity in the browser is its URL, so serving
>   the same file at a second URL is a second copy. Deriving the real URLs fails too — measured 2026-10-08,
>   this app's deps carried four different `?v=` hashes at once while `depsOptimizer.metadata.optimized` was
>   empty and every URL was live. What works is transforming `virtual:host-shared-modules` through the dev
>   server and reading the specifiers Vite wrote, which answers for a pre-bundled dep and a workspace
>   package's `/@fs/…` source alike. With no route, the plan's security section has no subject: there is no
>   allow-list to get wrong because there is nothing to serve.
> - **`apack run` needed a fix the plan did not foresee.** Vite appends `importAnalysisPlugin` *after* the
>   user's `post` surfaces and rewrites an external to `/@id/<specifier>`, which the browser resolves against
>   the module's own `pack://` URL and asks the pack's dev server for — and that server left the specifier
>   external and has nothing to answer with. `keepExternalsBarePlugin` undoes it in the response, the only
>   hook that runs after, and the only path that matters since `pack://` proxies HTTP.
> - **Finding 4 was already handled.** `resolveId`'s external branch runs before the `sharedInstancePackage`
>   branch, so no `rollupOptions.external` and no reordering was needed.
> - **The pack:// scheme change (step 0) bought nothing this needed.** Its claimed benefit — relative
>   resolution inside a `pack://` module — was false, and the spike written to depend on it passed without
>   the privilege. It stays for the one thing it does buy, a real origin per pack, which is latent until a
>   pack's UI runs in its own document (`pack-fault-isolation.md`). `f85c279a1` records that.
>
> Verified: 122/122 map targets resolvable in both halves, the dev map's `vue` byte-identical to the URL the
> renderer's own entry imports, smoke 4/4 and app-integration 11/11 against a built app, and both fixture
> packs' suites — including the host's `@apackdev/ui` editor rendering inside a pack, a pack writing through
> `@apackdev/ears` onto the app's engine, and `fe.bundleUi` still carrying its own UI kit.
>
> The text below is the plan as written.

# Share the host's modules through resolution, not through a side channel

Compiled 2026-10-07 on `AS/one-action-cache`, after fixing `apack run`'s frontend loop
(`fe-bundler.ts`'s `compiledSource`) and finding that every sharp edge in that area has one parent. Rewritten
2026-10-08, after `goal-one-kind-of-pack` hit the same defect on the backend **and fixed it** — see **The
backend already did this**, which is now the precedent this plan argues from rather than a second half it
has to carry. Every location, count and measurement was checked against the tree on the date beside it.

## Context

A pack's frontend must use **the host's instance** of Vue, `@apackdev/sdk`, `@apackdev/ears` and `@apackdev/ui` —
two Vue instances fail at runtime, and an unbound second SDK copy throws "No host is bound". Today that is
done with a global and a generated proxy:

- the renderer's `host-deps` virtual module (`renderer/vite.config.ts:70-86`) does
  `import * as X from '<specifier>'` for every shared specifier and assigns them onto `window.__apack`;
- the pack's bundler claims each shared specifier in `resolveId` and `load`s a **generated proxy module**
  (`generateGlobalProxy`, `fe-bundler.ts`) that reads the global and re-exports its names.

**The proxy re-exports from a runtime object, not a module, so it must name every export statically.** That
one requirement is the parent of all of the following:

| what exists | why |
|---|---|
| `discoverModuleExports`, `discoverSharedExports`, `discoverRuntimeExports` | the names have to be found |
| `compiledSource` and its two context branches | finding them needs compiled code, and a dev server will not give it the way a build does |
| `fe-bundler-dev-server.integration.spec.ts` | that dev branch had no coverage, and shipped broken |
| 69 name-equality cases plus a dev/build equivalence case in `fe-bundler-proxy-exports` | two mechanisms deriving one answer have to be held together |

It also has two defects nobody has hit:

- **`export const x = __m.x` is a snapshot, not a live binding.** Real ESM named imports track reassignment;
  these copy at evaluation time.
- A shared module exporting a name that is not a valid identifier generates a syntax error.

And its failure mode is a `console.warn` plus an `undefined` (`warnMissing`), where ESM would refuse at link
time naming the export.

**The alternative is a web standard.** An import map lets the pack keep `import { useSurface } from
'@apackdev/sdk/fe'` **as written and external**, and the browser resolves it to the host's module. Nothing
needs to know the names, because `export * from` does not.

## Why this app can use it unconditionally

The usual objection to import maps is browser support. It does not apply here:

- Import maps shipped in Chromium 89; this app pins **Electron 37.2.4 (Chromium ~138)**. The support matrix
  is one row and the app controls it.
- The renderer is already an ESM context (`<script type="module">`, `renderer/index.html:161`).
- Dynamic `import()` honours the document's import map, which is how `packFrontendIO.importModule` loads a
  pack's entry from `pack://`.

## What it deletes

- `generateGlobalProxy`, `discoverModuleExports`, `discoverSharedExports`, `discoverRuntimeExports`,
  `compiledSource` and `DevEnvironmentLike` — and with them `packExternalsPlugin`'s `load` hook, which
  becomes externalisation only.
- `window.__apack` and its `env.d.ts` declaration.
- The dev/build divergence class, and so the equivalence case added on 2026-10-07 — its subject stops
  existing. `fe-bundler-dev-server`'s subject goes the same way.
- The 69 name-equality cases, replaced by one that asks whether the map names every shared specifier and
  whether each target resolves.

And it gains correct ESM semantics: live bindings, and a link-time error naming a missing export.

**It is also worth 1.59s of every frontend rebuild.** Measured 2026-10-08 by instrumenting
`discoverSharedExports` over `apack build` for default-setup: **48 specifiers, 1586ms** — modules compiled
for no output but a list of names, 14% of that build's 11.3s frontend bundle.

**Per rebuild, not per build**, since `phase-cache.ts` landed the same day: a pack whose scope has not moved
now reuses the previous frontend bundle, and their paired A/B puts an unchanged build at **21.0s → 6.3s**.
So this saving is paid when the bundle is actually made. Not the reason to do this, and not the `compile`
step's 13s → 31s growth either, which is the frontend bundle existing at all now.

**The larger prize is next to it, and the phase cache is what exposed it.** `feInputsHash`
(`apack-cli/src/build/phase-cache.ts:164`) hashes the `@apackdev` packages' `dist` into the frontend phase's
scope, and its doc says why: *"the frontend phase read 329 files under the pack's `src/` and 84 in the
`@apackdev` packages' `dist`, and no others."* **Those 84 files are the discovery pass.** Stop reading them and
the frontend phase's scope narrows to the pack's own sources — so rebuilding the SDK stops invalidating every
pack's frontend bundle. That is a cache hit across a whole class of change, which is worth more than the
1.59s, and it is why narrowing that scope is part of step 2 rather than a follow-up.

## The design

**One route shape, generated from the lists that already exist** (`getSharedFeDeps`, `getSdkFeModules`,
`getUiFeModules` in `@apackdev/host/build/shared-deps` — 8 SDK frontend modules, 68 `@apackdev/ui` modules, plus
the third-party shared deps).

**1. The host serves each shared specifier as a module.** A generated shim per specifier, `export * from
'<specifier>'`, at a stable path (`/@host/<specifier>`):

- **in dev**, a Vite middleware serves the shim and Vite resolves and transforms it normally;
- **in production**, the same shims are extra Rollup entries (`rollupOptions.input`, with
  `preserveEntrySignatures: 'exports-only'` so the entry keeps its exports), emitted as real chunks.

**2. The host declares the map.** A `<script type="importmap">` injected ahead of the module script by
`transformIndexHtml`, mapping each specifier to its shim URL — the dev route in dev, the emitted chunk in
production, which `transformIndexHtml` can read from `ctx.bundle` at build time.

**3. The pack bundler just externalises.** `packExternalsPlugin`'s `resolveId` returns
`{ id: specifier, external: true }` for a shared specifier and nothing else. Its `load` hook goes.

### The one piece of discovery that survives

`export *` does **not** re-export `default`, and most `@apackdev/ui` entries are a component's default export.
So a shim needs `export { default } from '<specifier>'` as well — and that is a build error for a module
without one. So the generator needs one bit per specifier, *does it have a default*, which is far less than
a name list and is available where it is needed: the host's build is always a build, where Rollup's
`ModuleInfo.exports` answers it.

There is precedent for the shape: `@apackdev/ui`'s own public entries are already generated shims that read
`export { default } from './x.vue'; export * from './x.vue';` (`exports:update`).

## The backend already did this

`goal-one-kind-of-pack` hit the same mistake in Node and corrected it, which makes the backend the worked
example rather than a second problem. Its bug:

> A lazy require outlived its resolution. esbuild defers a module body into an `__init`, so the action step
> required `@apackdev/sdk/logger` when a step first ran — long after the scoped patch was gone, and the require
> cache cannot help because Node resolves first.

**The fix was to stop scoping the resolution.** `keepHostModulesResolvable` (`packs/module-bridge.ts:104`)
patches `Module._resolveFilename` once for the process, behind a `hostModulesKept` guard, and
`withHostResolution` (`packs/runtime/bridge.ts:69`) now says so: *"The resolution outlives the call, because
a pack's require does too … What is scoped to `fn` is the refusals, which are diagnostics about the pack
being loaded."* Its companion bug — `vue` and `@vscode/ripgrep` as externals nothing provided — was closed
the same way, by `HOST_PROVIDED_PACKAGES` and a build-time subset check holding the loader's list against
the externals a pack is built with (`apack-cli/tests/build/pack-externals.spec.ts`).

So the two sides are no longer symmetric, and that is the argument:

| | how the host's instance is shared | lifetime |
|---|---|---|
| backend | a resolver, installed once for the process | as long as the process |
| frontend | a global object, read at module-evaluation time | the moment the proxy evaluates |

The backend went from a side channel with a lifetime to resolution that persists. **The frontend is the side
that still has one**, and its lifetime problem shows up as the thing this plan opens with: names must be
enumerated because they are copied off an object, and `export const x = __m.x` snapshots where ESM binds.

The analogy is close enough to be useful and worth stating where it stops. Both answers are "let resolution
do it" — but Node's is a monkey-patch of `Module._resolveFilename`, where the browser's is a standard the
platform implements. The frontend gets the better of the two mechanisms for free.

**One asymmetry still worth closing, and it is small:** the backend now checks at build time that every
external its bundle emits is provided (`pack-externals.spec.ts`). The frontend has no equivalent — it warns
at *runtime* instead (`generateGlobalProxy`'s `warnMissing`), which is why `DEBUG_E2E=1 npm test -- smoke`
could pass its four cases while the app logged `Cannot find module '@apackdev/sdk/logger'` for every action
step. Under an import map the same question becomes "does the map name every specifier the pack imports",
answerable at build time from two declarations — which is the case listed under *Verification*.

## Security

**There is no runtime boundary today, and this does not remove one.** `window.__apack`
(`renderer/vite.config.ts:85`) is a plain enumerable global: any code in the renderer, a pack's frontend
included, can read it and ignore the proxies. The proxies are module resolution, not containment. What
actually holds the line is **build time** — `check:specifiers` for this repo's packs and `apack build` for
external ones, refusing `@apackdev/host`, `_`-prefixed internals and `APP_ONLY_EXPORTS`
(`@apackdev/ears/lmdb`, *"the app's LMDB store"*).

An import map leaves that boundary where it was: the pack's source still names the specifier, so the same
build-time checks see the same thing. In one respect it is tighter — a bare specifier absent from the map
does not resolve at all, where today the global is open to whatever the host put on it.

### The shim route is an allow-list, and that is a requirement

**`/@host/<specifier>` must serve only the specifiers the map contains, and 404 everything else.** A route
that builds a shim from whatever specifier was requested is an arbitrary-module re-export endpoint: a pack
could ask for `/@host/@apackdev/host/secrets` or `/@host/@apackdev/ears/lmdb` at runtime and be handed a module
the build-time rules exist to forbid. Those rules never run at runtime, so nothing else would stop it.

Two things bound the exposure, and they are the reason this is a requirement rather than a reason not to
proceed:

- **Production has no such route.** The shims are emitted at build time from a fixed list, so the on-demand
  case is dev-only — which means `apack run` and `npm start`.
- **The modules worth protecting are not in the renderer.** `secretsStore`, the LMDB store and the
  migrations run in the API process; a shim re-exporting them into a browser context would mostly fail to
  resolve. The renderer's sensitive surface is the preload bridge and the API token, and any renderer code
  reaches those today either way.

**It needs a firing case**, because its subject is input: ask the route for a host-only specifier — one from
`APP_ONLY_EXPORTS` and one under `@apackdev/host` — and assert it is refused rather than served. A gate with
no case is a gate nothing has watched fail, and this one is the only runtime check in the design.

### Three smaller points

- **Do not serve the shims from a CORS-open server.** `apack run`'s pack dev server sets `cors: true`
  (`run.ts`). The host's shims belong to the renderer's dev server, not that one, and should not inherit it
   — otherwise any page in a browser can fetch the host's modules. Not an escalation, since it is shipped
  code, but no reason to widen the surface.
- **A future CSP gets slightly harder.** There is no CSP in the renderer today; an inline
  `<script type="importmap">` would need a nonce or a hash once there is one. Worth knowing before someone
  adds a CSP and finds the map blocked.
- **One door opens:** an import map can carry `integrity` for its targets, so shared modules could be
  subresource-integrity checked. A global has no equivalent. Not a reason to migrate, but it is a capability
  this design has and the current one cannot.

### What this is still not

Containment. If packs should be *restricted at runtime* rather than *checked at build time*, neither design
does that, and the renderer is the wrong place to attempt it — that is process isolation or a sandboxed
frame, and a far larger piece of work than this plan.

## Steps

### 0. The spike, before anything else

One specifier end to end: pick `@apackdev/sdk/fe`, emit it as an extra renderer entry, inject a one-entry
import map, and externalise that specifier in `packExternalsPlugin` instead of proxying it. Then load the
`external-pack` fixture's frontend and check three things:

1. the pack's import resolves to the host's module;
2. the binding is **live** — reassign a host export and the pack sees it;
3. it works under `file://`, which is how production loads the renderer
   (`WindowManager.ts:481`, `loadFile`);
4. the route refuses a specifier outside the map — try one from `APP_ONLY_EXPORTS`. Worth doing in the spike
   rather than after it: if the allow-list is awkward to place, that shapes where the route lives.

**If any of those fails, stop and record why.** Point 3 is the one that cannot be assumed: a packaged app
has no server, so the map's targets are relative `file://` URLs.

### 1. The host's side

Generate the shims and the map from the three shared lists, in the renderer's config beside the
`host-deps` surface that is being replaced. Keep `window.__apack` in place for this step, so nothing breaks
while both exist.

### 2. The pack's side

`packExternalsPlugin` stops generating proxies. This is where the deletions land, and where
`fe-bundler-proxy-exports`' 69 cases and `fe-bundler-dev-server` lose their subject — each deleted case
says in its commit message which it was: subject gone, or awkward.

**`resolveId` has to say `external`, and that is not the same as declining to claim.** `bundlePackFE` sets no
`rollupOptions.external`, and `resolveId`'s `sharedInstancePackage` branch *resolves* `@apackdev/sdk` and
`@apackdev/ears` against the pack's own copy, so an unclaimed specifier is **inlined** rather than left bare.
Both have to change. The `generateBundle` guard that fails a build when an inlined SDK module reaches a host
binding stays exactly as it is — it is the check that catches this step going wrong.

**Narrow `feInputsHash`'s scope in the same change.** Once the phase stops reading the `@apackdev` packages'
`dist`, a scope that still hashes it is a declaration claiming reads nobody makes — and it costs a frontend
rebuild on every SDK change. The reads record (`build-reads.ts`) is how that scope was checked against
reality in the first place, so re-read it after the change rather than reasoning about it: the phase's
recorded reads are the evidence that the narrower scope is right.

### 3. Remove the global

Delete `window.__apack`, the `host-deps` virtual module's object assembly and the `env.d.ts` declaration.
Keep the global for one release only if a packaged pack in the wild could still reference it — which today
nothing can, since no pack is distributed outside this repo (`resolveFromRemoteRegistry` throws for every
name), so delete it in the same change.

## Verification

- **The spike's four checks** above, which decide whether the rest happens.
- `npm run spec -- fe-bundler` for the surface's suites, and `npm run chain` for the rest.
- **The fixture pack's frontend actually loading**, in both modes. `npm run start` covers the dev half:
  since `goal-one-kind-of-pack`'s phase 3 the renderer's dev server serves every pack in the tree from
  source, `tests/packs/external-pack` included, and `internal-repo-checks`' `dev-pack-hmr.integration.spec.ts` holds
  it to patching a component rather than reloading. A packaged build (`npm run build-prod`) with the same
  pack installed covers the other, and is the one that exercises `file://` and emitted chunk names.
  `apack run` remains the path for a pack outside the tree, where the proxy is replaced by the map.
- **The map names every specifier a pack imports, checked at build time** — the guard the backend already
  has as `pack-externals.spec.ts` and the frontend has only as a runtime warning. Two declarations, so it is
  derivable: the specifiers a pack's bundle leaves external against the specifiers the map carries.
- **One Vue instance, asserted rather than assumed**: the fixture pack renders a component that reads the
  host's Vue — if the map ever resolves to a second copy, that breaks loudly. `tests/packs/bundled-ui-pack`
  is the existing subject for the opposite case (a pack that deliberately carries its own `@apackdev/ui`), and
  it must keep working: `fe.bundleUi` means *do not* map those specifiers.
- **A missing export fails at link time**, which is the new failure mode: build a pack against a name the
  host does not have and confirm the error names the export, rather than warning and handing back
  `undefined`.

## Risks

**`file://` in production is the gating unknown.** Import maps are a document feature and the targets are
URLs; a packaged renderer is loaded with `loadFile`. Relative targets should resolve against the document,
but this is the spike's third check and the plan stops if it fails.

**Dev URL stability.** Vite's own module URLs carry hashes (`/node_modules/.vite/deps/vue.js?v=…`), which is
why the design serves shims at a stable `/@host/<specifier>` route rather than mapping to Vite's internals.

**The failure mode changes from degrade to refuse.** Today a pack importing a name the host lacks warns and
gets `undefined`; afterwards its frontend fails to load. That is better — it is loud, early and specific —
but it is a behaviour change, and `hostVersion` ranges are what should be catching the case first.

**`fe.bundleUi` must keep opting out.** A pack that bundles its own `@apackdev/ui` must not have those
specifiers mapped, or it gets the host's copy anyway. `bundlesUi(packDir)` already gates the proxy list and
must gate the map the same way — with a case, since this is the one path where mapping *more* is wrong.

## What this is not

- **Not Module Federation.** That is the ecosystem's standard answer to this problem (`shared: { vue: {
  singleton: true } }`) and it is the right one the day packs ship independently against several host
  versions. It brings a runtime and version negotiation that this repo has no subject for yet: one host
  version, and no third-party distribution — `resolveFromRemoteRegistry` throws for every name. Revisit when
  that stops being true.
- **Not an import map on the backend.** Node's CJS resolution is not the browser's, so the mechanism below
  is different even though the mistake is the same.
- **Not a performance change.** The win is correct module semantics and the deletion of a name-discovery
  pipeline, not speed.
