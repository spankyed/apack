# @apackdev/ui

Vue 3 components, editors (tiptap, Monaco) and UI composables for pack frontends and the app itself. It is published as compiled ESM with vue-tsc declarations. Packs import it by subpath (`@apackdev/ui/design/button`) and, by default, use the host app's copy at runtime. Pack-facing docs: `docs/public-facing/architecture.md` (`@apackdev/ui` section), `docs/public-facing/manifest.md` (`build.bundleUi`). Paths below are relative to `packages/apack-ui`.

## Layout

```
src/design/       general-purpose controls: button, dialog, tag-input, Select, Autocomplete, ColorPicker, EmojiPicker,
                  ConfirmationDialog, ContextMenuPopup, TrackedContextMenuRoot, ToastNotification, CopyButton, ...
src/layout/       panel-resizer
src/components/   app-level pieces: BaseForm, BaseNode + node-styles/node-dimensions/node-handles (flow canvas),
                  DataRenderer, Json* viewers/editors, Simple/UnifiedMonacoEditor + monaco-config/monaco-actions,
                  KeyboardShortcutInput, RunNodeListItem, TipSection
src/components/tiptap/   TiptapEditor, TiptapSearchBar, internal menus (TiptapBubbleMenu, TiptapBlockMenu,
                  TiptapImageBubbleMenu, bubble-menu/*), extensions.ts + extensions/*, composables/*,
                  editor-config.ts, tiptap-theme.css
src/composables/  useClickOutside, useCollapsibleState, useContextMenu, useDebounce, useExternalFileDrag, useInfiniteScroll
src/utils/        json-detection, path-truncation (pure helpers)
scripts/exports.ts         computes the exports map; `--check` mode (the build reads it too)
tsdown.config.ts           compile config
etc/                       API and component contract reports (committed)
```

There is no barrel: every public module is its own export subpath.

## Public modules and the entry-per-component rule

`scripts/exports.ts` derives the public surface from `src/`:

- **Public** = every `.ts` file under `src/` except `*.spec.ts`, `*.test.ts`, `*.d.ts` and anything under an `internal/` directory (`isPublicModule`). Private helpers under `internal/` are bundled through their public importers.
- **An SFC is public only through a `.ts` entry next to it** with exactly this content (see `design/button.ts`):
  ```ts
  export { default } from './button.vue';
  export * from './button.vue';
  ```
  TypeScript can't resolve an exports target that is a `.vue` file, so the entry is what consumers import. An SFC without an entry is internal (`components/JsonViewerDialog.vue`, the tiptap menus, `bubble-menu/*`); other files in this package import it by relative path.
- `computeExports()` gives each public module `{ "@apackdev/source": "./src/<m>.ts", "types": "./dist/<m>.d.ts", "default": "./dist/<m>.js" }`. There are no wildcards, and the map is checked into `package.json`. The published copy keeps only the last two: `stagePublishTree` drops the source branch, since no tarball ships `src/`. This package is the only one of the three published ones whose map is computed rather than written — `@apackdev/ears` and `@apackdev/sdk` list theirs by hand, where the map *is* the definition of public and cannot fall behind `src/`. Deriving it buys a component being public by default, and costs the two copies being able to disagree, which is what `exports:check` exists for and why no sibling package has one.

Workflow after adding, removing or renaming a public module:

```bash
npm run exports:update -w @apackdev/ui   # rewrite package.json exports
npm run exports:check -w @apackdev/ui    # (part of the root's npm run typecheck) fails on a stale map
npm run api:update -w @apackdev/ui       # regenerate etc/ reports, commit them
```

`findComponentsWithoutEntry()` scans every other `packages/*` and `tests/` for `@apackdev/ui/<path>` imports that name a `.vue` without a public entry. `exports:update`, `exports:check` and `build:package` all fail on those and print the entry to add (`missingEntriesMessage`).

## API reports (`etc/`)

`npm run api:check` / `api:update` run `api:build` (vue-tsc with `tsconfig.package.json` into `.temp/api-types`, gitignored) and then `scripts/api-reports.ts`:

- `etc/<entry>.api.md` for each export (API Extractor), with `/` in the subpath written as `.` (`design.button.api.md`).
- `etc/<entry>.component.md` for each component entry (a `.ts` whose source matches `export { default } from '*.vue'`). It records props, emits, slots and `exposed` members as the TypeScript checker resolves them through `vue-component-type-helpers`. Changing a component's props, emits, slots or `defineExpose` changes this report, so run `api:update`.
- Stale reports are deleted on update. CI runs `api:check` for `@apackdev/ears`, the SDK and UI, after `packages:build`: `tsconfig.api-extractor.json` resolves `@apackdev/*` dependencies to their built declarations, since API Extractor analyses `.d.ts` and follows a dependency read as source into it instead of reporting it as an import.
- The reports carry API Extractor's messages (`scripts/api-reports.ts` sets them explicitly, because `ExtractorConfig.prepare()` applies none of its defaults and reports nothing without them). `ae-forgotten-export` — a type a public export names without exporting it — is recorded in the report, so a new one shows up as a report diff. On a component entry one of those names `__VLS_export`: that is vue-tsc's own symbol for the SFC's default export, not something to export.

The published surface supports TypeScript 5.7+ (`typescript` peer `>=5.7`). `@app/publish-checks`'s `published-ui-types` compiles consumers against the packed package with both compilers (`packages/typescript-floor`).

## Build (`npm run build:package`, part of root `packages:build`)

The repo's `scripts/build-ui-package.ts` (it lives there, not here, so this package's own `scripts/` imports nothing above its layer):

1. Fails on missing entries or a stale exports map.
2. tsdown (`tsdown.config.ts`) compiles `computeEntries()` to `dist/` as ESM, `platform: 'neutral'`, with source maps. Shared modules become chunks. `unplugin-vue` compiles the SFCs. `dependencies` and `peerDependencies` are never bundled (`deps.neverBundle`, `onlyBundle: []`), so importing an undeclared package fails the build.
3. CSS: `css.inject` makes each compiled component import its own CSS. The postcss transformer inlines relative `@import`s (the tiptap theme). **Tailwind does not run here**: utility classes in templates stay class names, and the consumer's Tailwind generates them (see Styling).
4. `vue-tsc -p tsconfig.package.json` type-checks and emits declarations. `X.vue.d.ts` files are renamed to `X.d.vue.ts`, the name TypeScript looks for under node16/nodenext.
5. `BareImports.assertDeclared` (`scripts/lib/published-imports.ts`) checks that every bare import in `dist/**/*.js` is declared in `package.json`, and `assertExportTargetsBuilt` that every export target exists.

`dist/` checks live in `@app/publish-checks`: `published-ui-dist` (no SFC source shipped, no relative CSS `@import` left, shared modules emitted once), `published-exports`, `published-specifiers`. They skip without `dist/` locally and fail when `dist` is older than `src`. This package's own suite holds `exports` (the map) and `import-side-effects` (its source).

`package.json` is what the published manifest is derived from (`files: ["dist"]`); the build stages the derived one in `publish/`. Monorepo tooling resolves `src/` through the `@apackdev/source` condition (`tsconfig.json` `customConditions`, the renderer's Vite `resolve.conditions`), which only a checkout can satisfy.

## How packs get it at runtime

- **Host copy (default).** `getUiFeModules()` (`@apackdev/host/build/shared-deps`) lists every key of this package's exports map, and `sharedFeModules()` folds them in beside the deps and the SDK's frontend modules. The renderer's `hostSharedModulesPlugin` (`packages/renderer/vite.config.ts`) serves each as a build entry and names it in the document's import map under its full specifier. The pack FE bundler (`apack-cli/src/build/fe-bundler.ts`, `packExternalsPlugin`) leaves a pack's `@apackdev/ui/*` imports external, so the browser resolves them through that map. Stateful modules therefore have one instance app-wide: `monaco-config.ts` (registered DSL libs, initialized languages). An import of a module or a name this apack does not have fails when the pack's frontend links, naming it. Specs: `fe-bundler-externals`, `fe-bundler-host-registry`.
- **`build.bundleUi: true`** in `apack.json` bundles all of `@apackdev/ui` into the pack's `fe.js`, so a pack never mixes its own copy with the host's. The pack's Tailwind build then also scans `@apackdev/ui` (its `src/` when linked to a checkout, else `dist/**/*.js`). Fixture: `tests/packs/bundled-ui-pack`.
- **Consequences for this package:**
  - The app imports every public module at startup, so a module must do nothing when imported: no top-level listeners or registrations (`tests/import-side-effects.spec.ts`). Declarations are fine, including objects built from calls.
  - Removing or renaming an export breaks packs built against it on newer hosts. The `etc/` reports make such changes visible in review.

## What stays in `@apackdev/sdk/fe`

Contracts and host-shared state that packs need even without `@apackdev/ui` live in the SDK (`packages/apack-sdk/src/fe/`) and are shared through `SDK_FE_MODULES`. UI code imports them from `@apackdev/sdk/fe` and does not define its own copies:

- `useShell` (`KeyboardShortcutInput.vue`)
- menu state: `onMenuOpenChange` (`TrackedContextMenuRoot.vue`), `useTrackedMenuOpen` (`ContextMenuPopup.vue`, `composables/useContextMenu.ts`)
- registries of what pack frontends registered, which read the renderer's bound registry (`bindFeHost({ packs })`): `textEditorExtensionsRegistry` (`TiptapEditor.vue`); and `EXTRA_BLOCK_ITEMS_KEY` (`TiptapBlockMenu.vue`). DSL readers use static catalog data; `internal/dsl-libraries.ts` shares owned Monaco libraries and follows declaration updates
- `openLink` (`tiptap/composables/createEditorClickHandler.ts`)

UI modules also read `stepRegistry` from `@apackdev/sdk/steps` (`node-styles.ts`, `node-dimensions.ts`) and types from `@apackdev/sdk/steps` (`RunNodeListItem.vue`) and `@apackdev/sdk/types` (`KeyboardShortcutInput.vue`). The dependency goes one way only: `@apackdev/sdk` must not import `@apackdev/ui`, and the SDK's `package.json` doesn't declare it. `@apackdev/sdk` is a peer (`>=0.1.0 <1.0.0`; the range has to span the 0.x line — Changesets majors a peer dependent whose range excludes the version its peer moves to, and the fixed release group carries that major to all five packages, so `~0.1.0` or `^0.1.0` would turn the next minor into a 1.0.0 release: `apack-cli/tests/build/release-plan.spec.ts`), as are `vue`, `xstate`, `@xstate/vue`, `reka-ui`, `lucide-vue-next`, `@vue-flow/core`, the tiptap core packages, `monaco-editor` and `elkjs`. Tiptap extensions, `highlight.js`, `lowlight`, `tiptap-markdown` and `@guolao/vue-monaco-editor` are regular dependencies.

## Component conventions (as used in `src/`)

- **SFC shape**: `<script setup lang="ts">` with type-only `defineProps<{...}>()` (`withDefaults` where defaults are needed) and typed `defineEmits<{...}>()`, in call-signature form (`(e: 'click', event: Event): void`) or tuple form (`save: [...]`). A component that needs module-level exports adds a plain `<script lang="ts">` block: `ColorPicker.vue` exports `DEFAULT_COLORS`, `BaseNode.vue` sets `name` and re-exports `HandleConfig`. Those exports reach consumers through the entry's `export *`.
- **v-model** uses a `modelValue` prop plus an `update:modelValue` emit. `defineModel` isn't used.
- **Class passthrough**: some components take a `class?: string` prop and merge it (`button.vue`: `[baseClasses, variantClasses, props.class]`). `dialog.vue` has `contentClass`.
- **Variants** are a string-union prop mapped to class strings in a `computed` (`button.vue` `variant`: `primary | secondary | transparent | ghost | danger`, plus disabled styles).
- **Primitives**: dialogs, menus and popovers wrap `reka-ui` (`dialog.vue`, `ConfirmationDialog.vue`, `TrackedContextMenuRoot.vue`, `tag-input.vue`, `ImageLightbox.vue`, `JsonHoverPopup.vue`). Icons come from `lucide-vue-next`.
- **Relative imports** name the file with its extension (`./editor-config.ts`, `./node-handles.ts`, `./button.vue`). `tsconfig.json` sets `allowImportingTsExtensions`, and `npm run check:specifiers` rejects relative `.js` specifiers.
- **Naming** (observed, not enforced):
  - Most SFCs are PascalCase (`CopyButton.vue`, `TiptapEditor.vue`). A few older primitives are kebab/lowercase (`button.vue`, `dialog.vue`, `tag-input.vue`, `panel-resizer.vue`); keep existing names, since they are export paths.
  - Non-component modules are kebab-case (`node-styles.ts`, `monaco-config.ts`). Composables are `useX.ts` (`createX.ts` for factories in `tiptap/composables`).
  - Emit names mix kebab-case (`toggle-link`, `clear-filters`) and camelCase (`imageClick`, `focusTitle`).

## Styling

- Tailwind utility classes in templates, on the app's dark theme with no `dark:` variants: mostly `neutral-*` (a few `gray-*`) for surfaces, text and borders, and the app's `primary-400…700` scale for accents.
- The app's Tailwind config (`packages/renderer/tailwind.config.ts`) scans `apack-ui/src/**` and defines `primary`. A class used only here is generated by the host build, and a pack with `build.bundleUi` generates it itself. `primary-*` exists only where the Tailwind config defines it.
- Component-specific CSS goes in `<style scoped>` as plain CSS (no `@apply`), as in `dialog.vue` (`.dialog-overlay`, `.dialog-content`). Unscoped `<style>` is kept for styles that must reach rendered or third-party DOM (`TiptapEditor.vue` `@import "./tiptap-theme.css"`, `UnifiedMonacoEditor.vue`, `ColorPicker.vue`, `JsonViewerDialog.vue`); those rules are namespaced by a class the component owns (`.tiptap-wrapper .ProseMirror`), so a second copy of this package inside a `build.bundleUi` pack restyles nothing outside it. **No module here imports a stylesheet from another package**: those are global, and this package ships inside every such pack, so the app imports them itself (`highlight.js/styles/github-dark.css`, in `packages/renderer/src/main.ts`). `tests/import-side-effects.spec.ts` fails one that comes back.
- These styles ship as CSS files that the compiled component imports. Consumers' bundlers collect them.

## Checks

```bash
npm run typecheck:ui                  # vue-tsc --noEmit (src, scripts, tsdown config)
npm run exports:check -w @apackdev/ui   # exports map + component entries
npm run api:check -w @apackdev/ui       # etc/ reports current
npm run packages:build && npm run packages:check   # dist, publint, attw (esm-only)
npm test -w @app/publish-checks       # the published-* dist checks
npm test -w @apackdev/cli               # the fe-bundler-*ui specs
```

## Monaco runtime ownership

The host calls `provideMonacoRuntime(app, load)` from `components/monaco-config` before
mounting Vue. Its asynchronous factory supplies the locally configured Monaco instance; loading
is memoized per application and starts with the first `useMonacoRuntime()` consumer. The
namespaced Vue injection key also works for a bundled UI copy. Components gate editor mounting
on resolution and ignore late results after disposal. `initializeMonaco` takes the instance
explicitly; configuration never reads a window global.
