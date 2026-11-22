# Goal: no first-party `plugin` left in the app

```text
# Goal: no first-party `plugin` left in the app

Implement docs/goals/goal-editor-extensions.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases and Constraints before continuing.
The survey was made at 672d70800 on master (2026-10-22); inspect current code before relying on it.

Finished when:
- `extensions.tiptapPlugins` and its whole chain are renamed, every in-repo manifest, pack,
  template, fixture, doc and recorded file migrated in the same change.
- The four rules in Decision 3 hold for every file under a `tiptap/extensions/` directory: one file per
  extension, no `-extension`/`-plugin` suffix, the ProseMirror Plugin private to it.
- The guard retires the renamed spellings and keeps the three third-party vocabularies.
- `npm run chain` passes.
- Record Outcome, archive this document, repair links and commit closure.

Never find-and-replace over `plugin`: Decision 1 is the boundary, and one side of it reaches a
subprocess argv where a rename typechecks and calls a subcommand that does not exist.
Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
```

## Outcome (2026-10-22)

**Done.** The editor contribution is `extensions.textEditor`, every `tiptap/extensions/` file holds its
ProseMirror Plugin private, and the guard holds the three vocabularies that are genuinely somebody
else's.

| Phase | Commit | Evidence |
|---|---|---|
| 1 — the guard | `47785e4d0` | `text-editor-concept` with the ten spellings; `KEPT` shrunk to names a third party defines. Mutation: emptying the group fails the park case |
| 2 — the extension files | `194fbc751`, `aaeeafeff` | Three merges, three moves. `api:update` deletes `components.tiptap.extensions.search-{extension,plugin}.api.md` and writes one `…search.api.md` — the collision, gone |
| 3 — the manifest key | `f7ae8e0d4` | 44 files; `npm run typecheck` 17/17 |
| 4 — recorded files | `f7ae8e0d4` | `schema:update`, `api:update`, `facade:update`; `facade:check` reported the facade already current |
| 5 — docs, guard live | `f7ae8e0d4` | `PARKED` empty, scan green over code and guides |

**The park closed itself, which is the mechanism worth keeping.** `npm run test:unit` failed
`parks nothing that has stopped needing it` the moment the last violation went — the guard asked to be
unparked rather than waiting to be remembered.

**`textEditor`, not `editor`, and the reason is the rename itself.** The first pass used `editor` and
was discarded before it was committed: `editor` is a word this tree uses hundreds of times
(`props.editor`, `editor.registerPlugin`, tiptap's own `Editor`), so renaming *to* it cannot be checked
by matching, and renaming *away* from it later would be unmatchable. The discarded pass kept one fix —
`cross-feature-imports` caught `image-paste.ts` reaching into a feature, which `aaeeafeff` resolves by
moving the clipboard parsing to the extension that pastes.

**What a vocabulary rename cannot see, and the four commits that caught it.** The identifier pass left
prose alone, which is where a reader learns the vocabulary: `e7a65735b` brought the archive to the new
name, `e7e050a7b` the prose in eleven files plus two archived goals whose *filenames* called a surface
a plugin, `13b1a5c61` five comments that justified code by narrating the change that produced it, and
`ca9660ecc` a doc comment the reference merge had dropped — found by comparing every line of each
merged file against its sources, which is the check worth repeating after a merge of this shape.

**Carried forward.** [the commands goal](goal-commands-are-host-level.md) has since landed, read in this
vocabulary. Its Decision 5 — the generated `readSurfaceState`/`useSurfaceState` signatures dropping
`| undefined` — is still open and belongs to nothing yet.

## Scope

`packages/internal-repo-checks/tests/surface-vocabulary.spec.ts` currently allows `plugin` for three
vocabularies. Two are genuinely somebody else's. The third — the editor one — is **our own
abstraction wearing a borrowed word**, and this goal removes it.

**252 occurrences across 52 files**, measured at `672d70800`:

| Spelling | Count | What it is |
|---|---|---|
| `tiptapPlugins` | 145 | the manifest key `extensions.tiptapPlugins`, and every reader of it |
| `tiptapPluginRegistry` | 29 | the SDK's registry of what packs registered |
| `editorPlugin` | 25 | the local in codegen, `pack-store`, `declaration-binding` |
| `TiptapPlugin` | 19 | the registered shape (`@apackdev/sdk/fe`, published) |
| `TiptapPluginBinding` | 12 | published |
| `TiptapPluginDeclaration` | 8 | published; the manifest entry's type |
| `tiptap-plugins` | 7 | `apack-sdk/src/fe/tiptap-plugins.ts`, which is internal: no exports-map entry, re-exported from `fe/index.ts` |
| `editorPlugins` | 3 | codegen's local |
| `TiptapPluginSchema` | 2 | the zod schema |
| `pluginPopups` | 2 | `TiptapEditor.vue` |

**Why this one is ours.** tiptap has no grouping concept at all. An `extensions.tiptapPlugins` entry is
a name we invented for a bundle of three unrelated things:

```json
"extensions": { "tiptapPlugins": { "suggestions": {
  "extensions": { "referenceSuggestion": "…#ReferenceSuggestion", "commandSuggestion": "…#CommandSuggestion" },
  "popups":     { "references": "…/ReferenceSuggestionPopup.vue" },
  "isSuggestionActive": "…/active-suggestions.ts#isSuggestionActive"
} } }
```

tiptap Extensions, Vue components, and a predicate. Nothing in that is a plugin of anything.

### Out of scope, and why each stays

**ProseMirror's API, which we construct — 150 occurrences across 19 files.** See Decision 1.

**Our bundler plugins — ~79 occurrences.** `packExternalsPlugin`, `hostSharedModulesPlugin`,
`tailwindInjectPlugin`, `opaqueVendorPlugin`, `globWatchPlugin`, `rejectHostImportsPlugin`,
`stubFrontendAssetsPlugin`, `capturedSourcesPlugin`, `keepExternalsBarePlugin`, `importAnalysisPlugin`,
`inputReportPlugin`, `createValidatorPlugin`, `vueSfcPlugin`, `stubSfcPlugin`,
`devPackFrontendsPlugin`, `pluginVue`/`pluginOxlint`/`pluginVitest`, `postcssPlugins`, `inputPlugins`,
`esbuildPlugins`, `VitePlugin`, `pluginContainer`. Each **returns a `vite.Plugin` or an
`esbuild.Plugin`** — the identifier names the interface it implements, which is the one thing a reader
needs from it.

**The Claude Code CLI — ~10 occurrences.** `--plugin-dir`, `pluginDir`, `PluginInfo`, and the argv
`run(['plugin', 'install', …])` (`features/code/be/services/claude-code/`). Another program's
subcommand. A rename here typechecks and then calls a subcommand that does not exist; it has already
happened once on `session/plugins-to-surfaces`.

**Dependency names.** `package.json`, `package-lock.json`: `@vitejs/plugin-vue`, `eslint-plugin-vue`,
`rollup-plugin-dts`, `vite-plugin-static-copy`, `unplugin-vue`, the `@babel/plugin-*` tree.

**`docs/archive` and `CHANGELOG.md`**, as before.

## Decisions

### 1. The boundary is `new Plugin()`: a ProseMirror Plugin keeps the word

**An identifier keeps `plugin` when its referent is an object a third party defines.** That is the rule,
and it is checkable by reading the constructor.

`packages/apack-ui/src/components/tiptap/extensions/` holds both levels side by side:

```ts
// search-extension.ts — the tiptap Extension (ours, outer)
export const SearchAndFind = Extension.create({
  addProseMirrorPlugins() { return [searchPlugin()] },
})

// search-plugin.ts — the ProseMirror Plugin (theirs, inner)
export const searchPluginKey = new PluginKey<SearchPluginState>('search')
export function searchPlugin(): Plugin<SearchPluginState> { return new Plugin<SearchPluginState>({ … }) }
```

So `searchPlugin`, `searchPluginKey`, `SearchPluginState`, `pluginState` (what `PluginKey.getState()`
returns), `commandSuggestionPlugin(Key)`, `referenceSuggestionPlugin(Key)`, `imagePastePlugin`,
`inputRulesPlugin`, `addProseMirrorPlugins`, `registerPlugin` and the four `*-plugin*.ts` filenames all
stay. Renaming `searchPlugin` to `searchExtension` would give one name to two different objects, and
the name is already taken by the Extension in the file beside it.

**This is the one place the goal does not reach "no first-party identifier contains `plugin`".** What it
reaches instead, and what the guard will encode: *every remaining first-party identifier containing
`plugin` names a third-party object it constructs, or a third-party flag it passes.* If that is not
acceptable, the alternative is a wrapper layer renaming ProseMirror's vocabulary at our boundary — new
indirection over 150 call sites, for a word. Say so before Phase 1 rather than after.

### 2. `extensions.textEditor`, and the inner field keeps `extensions`

| Now | Then |
|---|---|
| `extensions.tiptapPlugins` | `extensions.textEditor` |
| `TiptapPluginDeclaration` | `TextEditorExtensionsDeclaration` |
| `TiptapPlugin` | `TextEditorExtensions` |
| `TiptapPluginBinding` | `TextEditorExtensionsBinding` |
| `TiptapPluginSchema` | `TextEditorExtensionsSchema` |
| `tiptapPluginRegistry` | `textEditorExtensionsRegistry` |
| `editorPlugin` / `editorPlugins` (locals) | `contribution` / `contributions` |
| `fe/tiptap-plugins.ts` | `fe/text-editor-extensions.ts` |
| `pluginPopups` | `textEditorPopups` |

**`textEditor`, not `editor`.** This app has several editors — Monaco for code, Vue Flow's canvas, the
DSL editors — so `editor` alone names the wrong set and will collide. It is also the practical
argument: `editor` is a word this tree already uses hundreds of times (`props.editor`,
`editor.registerPlugin`, tiptap's own `Editor`), so a rename *to* it cannot be checked by matching, and
a rename *away* from it later would be unmatchable. `textEditor` is unique in the tree today, which is
what makes both this rename and any future one tractable.

The entry's inner `extensions` field is **not** renamed: it holds tiptap Extensions, which is what
tiptap calls them. `extensions.textEditor.suggestions.extensions` reads as the pack-contribution namespace,
the kind, the group, then tiptap's own word — two different scopes that happen to share a noun.

The alternative is renaming the inner field to `tiptap`, which removes the repetition and names a
library in a manifest key. I would keep `extensions` and take the repetition; it is the accurate one.

`appExtensions` (the sibling key) is untouched.

### 3. The editor-extension naming convention

Four rules. Everything below follows from them, and together they remove the suffix that is currently
doing disambiguation work instead of classification work.

1. **One file, one extension, named for the behaviour.** `tiptap/extensions/<behaviour>.ts`, kebab-case,
   **no `-extension` or `-plugin` suffix**. 9 of the 11 files already do this; `search-extension.ts`
   carries a suffix only to avoid colliding with `search-plugin.ts`, which rule 3 deletes.
2. **The export is PascalCase, named for the behaviour, no suffix** — `BlockquotePipe`, `SearchAndFind`,
   `CommandSuggestion`. All eight already do this.
3. **A ProseMirror Plugin is private to its extension.** It lives in the extension's own file and is not
   exported. Where outside code must dispatch to its state, the file exports `<behaviour>Key`.
4. **ProseMirror's names are never aliased.** `Plugin`, `PluginKey`, `addProseMirrorPlugins` are imported
   as written; a local holding `key.getState()` is `state`, never `pluginState`.

**The whole convention on one real file.** `search` is the pair that collides today, so it is the
example worth reading before any of the rest.

```ts
// Now — two files, and searchPlugin has exactly one caller
// search-extension.ts
import { searchPlugin } from './search-plugin.ts'
export { searchPluginKey } from './search-plugin.ts'
export const SearchAndFind = Extension.create({
  addProseMirrorPlugins() { return [searchPlugin()] },
})

// search-plugin.ts
import { Plugin, PluginKey } from '@tiptap/pm/state'
export interface SearchPluginState { … }
export const searchPluginKey = new PluginKey<SearchPluginState>('search')
export function searchPlugin(): Plugin<SearchPluginState> { return new Plugin({ … }) }
```

```ts
// Then — one file, search.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'   // theirs, imported as written

export interface SearchState { … }                      // was SearchPluginState
export const searchKey = new PluginKey<SearchState>('search')   // was searchPluginKey

function plugin(): Plugin<SearchState> {                // was exported searchPlugin; now private
  return new Plugin<SearchState>({ key: searchKey, … })
}

export const SearchAndFind = Extension.create({
  name: 'searchAndFind',
  addProseMirrorPlugins() { return [plugin()] },
})
```

`Plugin` still appears four times after the change, and every one is ProseMirror's. **Nothing here
abstracts ProseMirror away and nothing aliases its imports** — the only names that moved are the ones
we chose.

**The principle under rules 3 and 4: an identifier says what it holds, the type says whose class it
is.** `const searchKey: PluginKey<SearchState>` already states that it is ProseMirror's, so repeating
`Plugin` in the name buys nothing; the behaviour prefix earns its place because a file may hold more
than one key. The same reading makes a local holding `searchKey.getState(state)` a `state`, and makes
the private factory `plugin()` rather than `searchPlugin()` — it returns a `Plugin`, and it sits in the
file that *is* search, so the prefix would stutter. A short one inlines into `addProseMirrorPlugins()`
instead.

**Rule 3 is the one with evidence behind it.** Every ProseMirror Plugin in the tree is imported by
exactly one file — its own extension: `searchPlugin` only by `search-extension.ts`,
`commandSuggestionPlugin` only by `command-extension.ts`, `referenceSuggestionPlugin` only by
`reference-extension.ts`. The split into two files buys no reuse and costs the collision. The three
files that already co-locate both levels — `image-selection-decoration.ts`,
`image-upload-placeholder.ts`, `command-viewer-decoration.ts` — are the shape, and
`image-upload-placeholder.ts` is the worked example: one file, the Extension exported, the Plugin not,
`uploadPlaceholderKey` exported because other code dispatches to it.

No `PluginKey` instance is read outside its own package, so none of this is consumer-facing surface.

What it changes:

| Now | Then |
|---|---|
| `search-extension.ts` + `search-plugin.ts` | `search.ts` |
| `command-extension.ts` + `command-suggestion-plugin.ts` | `command-suggestion.ts` |
| `reference-extension.ts` + `reference-plugin-key.ts` + `reference-suggestion-plugin.ts` | `reference-suggestion.ts` |
| `tiptap/{reference-node,resizable-image,sub-document-link}.ts` | the same files under `tiptap/extensions/` |
| `searchPluginKey`, `commandSuggestionPluginKey`, `referenceSuggestionPluginKey` | `searchKey`, `commandSuggestionKey`, `referenceSuggestionKey` |
| `SearchPluginState` | `SearchState` |
| `searchPlugin`, `commandSuggestionPlugin`, `referenceSuggestionPlugin` (exported) | unexported `plugin()` in their extension's file |
| `pluginState` (40 locals) | `state` |
| `imagePastePlugin`, inline in `chat/input.vue` | an extension file of its own |

`uploadPlaceholderKey` already follows rule 3 and does not move.

## Phases

### Phase 1 — the guard moves first

**Deliverable.** A new `editor-concept` group in `surface-vocabulary.spec.ts` holding the ten spellings
in Scope, and the tiptap entries removed from `KEPT` — they stop being a kept vocabulary the moment
Phase 3 lands. Park the scan (an `ALLOWED` entry for the tree) so the group's firing and kept-spelling
cases are live while the rename runs.

**`KEPT` shrinks to what is actually somebody else's**, which is narrower than it looks today.
`tiptapPlugins`, `TiptapPlugin`, `TiptapPluginBinding`, `TiptapPluginDeclaration` and
`tiptapPluginRegistry` move out as the concept. So do `searchPlugin`, `searchPluginKey` and
`SearchPluginState` — not because they are ours, but because **Decision 3 renames them anyway**: a
sample asserting a spelling no file contains is the inert kind of case this repo has already paid for.
What stays is ProseMirror's own API (`Plugin`, `PluginKey`, `addProseMirrorPlugins`, `registerPlugin`,
`new Plugin`), the bundler names, and the Claude Code argv — and those are the case with teeth, being
what Decision 1 rests on.

**Done when:** each of the ten fails the scan when planted alone; every `KEPT` sample passes; the
`FIRES_ON`-style case covers the new group.

### Phase 2 — the extension files

**Deliverable.** Decision 3 applied: three merges, three moves into `extensions/`, the Key and State
renames, the Plugins unexported, `pluginState` locals renamed, and `imagePastePlugin` given a file.
`extensions.ts` (the barrel) follows the moves.

**Dependencies.** None — this is `@apackdev/ui` and `default-setup` internals plus a derived exports map.

**Done when:** `npm run typecheck`, `npm run exports:update -w @apackdev/ui` with every line of the diff
a path this phase moved, and the editor suites pass — `apack-cli/tests/build/editor-declarations`,
`apack-host/tests/fe/declaration-binding`, `renderer/tests/runtime/native-editor`,
`default-setup/tests/extensions/tiptap/`. Mutation: an extension dropped from the barrel fails
`native-editor`.

### Phase 3 — the manifest key and its chain

**Deliverable.** `extensions.textEditor` through the schema (`declaration-schema.ts`,
`frontend-declaration.ts`), codegen (`generate-entries.ts`, `module-targets.ts`), the host
(`fe/pack-store.ts`, `fe/declaration-binding.ts`), the SDK (`fe/tiptap-plugins.ts` → `fe/text-editor-extensions.ts`
and `fe/index.ts`; the module is internal, so no exports map moves), `TiptapEditor.vue`, and the one
in-repo manifest that declares the key: `packages/default-setup/apack.json`. No `tests/packs/*` fixture
declares one, so the fixture suites exercise the rename only through the SDK and host.

No compatibility read of the old key — `CLAUDE.md`'s backward-compatibility rule, and the typecheck
proves the rename finished.

**Done when:** `npm run typecheck`, `npm run build:default-setup`, `npm run test:unit`, and
`npm run test:external-pack` pass. Mutation: a reader left on the old key fails
`fe-registered-lookups.spec.ts` or `declaration-binding`'s validation rather than passing silently.

### Phase 4 — recorded files

**Deliverable.** Four derivations re-taken, each read before committing:

- `npm run schema:update -w @apackdev/sdk` — `apack.schema.json` carries the manifest key.
- `npm run api:update` — `TiptapPlugin*` are published `@apackdev/sdk/fe` entries.
- `npm run facade:update -w @app/default-setup` — `etc/pack-types.api.md`.
- `npm run exports:update -w @apackdev/ui` **is** needed once Decision 3 lands: its map is derived from
  `src/`, and the merges and moves change the paths — `search-extension` and `search-plugin` become
  `search`, and three extensions move into `extensions/`. Decision 1 keeps ProseMirror's *names*; it does
  not keep a file split that nothing uses.

**Done when:** `npm run typecheck` passes with no stale recorded file, and every line of each
regenerated diff is this rename.

### Phase 5 — docs, and the guard goes live

**Deliverable.** `docs/public-facing/{extensions,manifest,architecture}.md` (where a pack author reads
the key), `packages/{apack-sdk,apack-ui,apack-host,renderer,internal-repo-checks}/CLAUDE.md`,
`packages/default-setup/CLAUDE.md`, and root `CLAUDE.md`'s Naming section — which currently names three
vocabularies and must name the two that remain plus Decision 1's rule. Unpark the scan.

**Done when:** the scan is green unparked, `doc-links` passes, and `internal-repo-checks`' guard row describes
what the guard now holds.

## Constraints

- Nothing in `packages/apack-ui/src/components/tiptap/extensions/*-plugin.ts` changes. If a phase wants
  to, re-read Decision 1.
- The pack contract moves: `extensions.textEditor` is a manifest key, so a pack's `apack.json` changes and
  the facade types change with it. There is no deprecation window.
- `PACK_SNAPSHOT_FORMAT` and `PACK_LAYOUT_VERSION` are not touched. A stale snapshot is refused with an
  enum error at the renamed key, which is the behaviour already.
- Release metadata stays untouched; this is not a version bump.
