# Manifest Reference

The `apack.json` file at the root of your pack is the single source of truth. It declares features, extensions, content, entities, dependencies, and lifecycle hooks. The CLI reads it to generate code, compile content, and bundle your pack.

## Editor assistance

Set `"$schema": "https://apack.dev/schemas/apack.json"` in `apack.json`, or use the schema shipped
at `@apackdev/sdk/apack.schema.json` for offline editing. JSON editors can complete declaration keys
and policy/loading values, show field descriptions, and diagnose structural errors at their source
ranges. Settings value schemas use JSON Schema draft-07.

Run `apack pack validate` for complete semantic checks: npm version ranges, cross-declaration ownership,
settings defaults, declared modules and exports need more than JSON Schema validation. The CLI reports
invalid and incomplete checks separately; `--json` supplies field paths for tooling. Editor acceptance
does not prove that source exports or dependency builds are available.

## Module references

Source paths are relative to the pack root, including declarations inside a feature. They may name
an explicit file, an extensionless module or a directory barrel. Resolution stays within the pack,
including symlinks. A path and a selected export have different meanings:

| Declaration | Syntax | Meaning |
|---|---|---|
| Systems, settings forms, block/artifact views, DSL type modules, frontend app extensions/popups, content compilers/appliers and feature type barrels | `src/module.ts` | Whole module, with the export convention described by that field; no `#export` selector |
| Services, repositories, step facets, lifecycle hooks, migrations, content writers, Tiptap extension objects/predicates, contracts and entity shapes | `src/module.ts#Export` | The named export; contracts and shapes select TypeScript types, without executing them |
| Surface machines/views and reference icon components | `src/module.ts` or `src/module.ts#Export` | Default export when omitted, or the explicitly named binding |

Schema validation, source checks and codegen use these same distinctions. Whole-module readers check
their conventional runtime exports (`default` or `apply`) without activation; type
barrels remain type-only and Vue component exports are checked by the frontend build. JavaScript
exports are inspected too, including CommonJS default-import semantics. Missing modules or required
exports are errors; dependency problems that prevent complete export checking are reported as incomplete.

Built and installed declarations use the [pack build contract](pack-builds.md); native host
composition supplies declarations directly, without an installed receipt.

The CLI writes root, feature-definition and extension-kind fields in schema order. Feature IDs,
contribution maps, dependency maps, arrays and custom settings/schema data retain their authored
order. `init`, `add` and the release version editor share this writer.

## Field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `$schema` | `string` | no | JSON Schema reference for editor validation |
| `id` | `string` | yes | Unique pack identifier: a lowercase letter, then lowercase letters, digits and hyphens (`^[a-z][a-z0-9-]*$`) |
| `name` | `string` | yes | Human-readable display name |
| `version` | `string` | yes | Complete [SemVer 2.0](https://semver.org/) version (e.g. `"0.1.0"`, `"0.2.0-beta.1"`) |
| `description` | `string` | no | Short description |
| `hostVersion` | `string` | no | Nonempty npm semver range of compatible host versions (e.g. `">=0.3.0"`) |
| `license` | `string` | no | SPDX license identifier |
| `features` | `Record<string, PackFeatureEntry>` | no | Feature declarations (system + surface bundles), keyed by feature id |
| `extensions` | `object` | no | What the pack contributes to the app; see [Extensions](#extensions) |
| `migrations` | `{ app?, pack? }` | no | Data migrations, by version line; see [Migrations](#migrations) |
| `data.entities` | `Record<string, { shape?, shortCode?, indexes?, search?, embed? }>` | no | Entities without a feature owner, each declared as a feature's are; see [Entities and relations](#entities-and-relations) |
| `data.relations` | `Record<string, { acyclic?, unique? }>` | no | Pack-level snake_case relation wire names, each mapped to its rules; see [Entities and relations](#entities-and-relations) |
| `data.roles` | `string[]` | no | Pack-level snake_case role names; see [Entities and relations](#entities-and-relations) |
| `dependencies` | `Record<string, string>` | no | Pack IDs mapped to a nonempty npm semver range, `github:owner/repo [range]`, or `file:path` |
| `checks` | `{ allow?: string[] }` | no | Development conventions this pack allows; schema completion lists supported rule names. See [source checks](cli.md#apack-pack-validate---json). |
| `permissions` | `string[]` | no | Required capabilities: `ears`, `llm`, `filesystem`, `network`, `terminal` |
| `lifecycle` | `PackLifecycleConfig` | no | Explicit lifecycle functions; see [Lifecycle configuration](#lifecycle-configuration) |
| `content.formats` | `Record<string, ContentFormatConfig>` | no | Named content formats: how a source becomes records. `content.sources` entries name them, dependents as `<pack id>:<name>`; see [Content](content.md#writing-entities) |
| `content.writers` | `Record<string, string>` | no | Content writers for entity types this pack declares: the declared entity's wire name -> `path#exportName` of a `ContentWriter` object (`find`, `create`, `update`, `remove`, all optional). Every pack writing that type goes through them; see [Content](content.md#content-hooks) |

## Extensions

### `extensions.commands`

Slash commands this pack seeds, keyed by the name typed after the `/`:

```json
"extensions": { "commands": { "list": { "pr2md": { "placeholder": "PR number (optional)" } } } }
```

| field | type | required | notes |
|---|---|---|---|
| `list` | `{ <name>: { placeholder } }` | yes | Keyed by the name typed after the `/`: lowercase letters, digits and hyphens. `placeholder` is the hint the chat shows after the name, and may not be empty. At least one |
| `onUserEdit` | `"offer" \| "theirs"` | no | As for any content entry. Nested beside `list` rather than among the names, so it can never collide with a command |

Desugared at build time into ordinary content under the reserved key `declared-commands`, so it is merged,
removed and offered like every other entry — and what the user gets is a document they own and may delete.
A name a dependency declares is refused while you build; across unrelated packs it is first-wins and silent.
See [Slash commands](content.md#slash-commands).


`extensions` is what the pack gives the host, as against what it is made of (`features`) or what data it
ships (`content`). Every entry is a contribution the app registers and other packs or the shell can reach.

| Field | Type | Description |
|---|---|---|
| `steps` | `Record<string, StepEntry>` | Flow step types, keyed by type. Each names its facets: `build` (or `trigger`), `fe`, `runtime` and `dsl`. The build facets are shipped as `build/steps.build.mjs`, so packs depending on yours validate flows with your step code; see [Steps](extensions.md#steps) |
| `artifacts` | `Record<string, { icon, fe? }>` | Artifact types, keyed by type; see [Artifacts](extensions.md#artifacts) |
| `blocks` | `Record<string, { kind?, fe?, be? }>` | Message blocks, keyed by type; see [Blocks](extensions.md#blocks) |
| `services` | `Record<string, string>` | Pack-level services, belonging to no one feature, in the same form as [a feature's `services`](#packfeatureentry-fields) |
| `settings` | `Record<string, SettingsDefinition>` | Inline pack-owned preference definitions; see [Pack settings declarations](#pack-settings-declarations) |
| `dsl` | `Record<string, DslEntry>` | Monaco editor type definitions for code the app edits; see [DSL definitions](#dsl-definitions) |
| `textEditor` | `Record<string, TextEditorExtensionsDeclaration>` | Named editor extension and popup groups; see [Editor and app extensions](#editor-and-app-extensions) |
| `appExtensions` | `Record<string, string>` | Named app extension components; see [Editor and app extensions](#editor-and-app-extensions) |

**A setting that only changes what `apack pack build` produces is not one of these**: it goes in `build`, which
holds `opaqueDeps` and `bundleUi`. `extensions` is what the pack gives the app, and a packaging choice gives
it nothing.

### Pack settings declarations

Pack groups are keyed by a local ID: a lowercase letter followed by letters or digits. The catalog
keeps each group's owner, so two packs can both declare `assistant` independently.

```json
{
  "extensions": {
    "settings": {
      "assistant": {
        "title": "Assistant",
        "schema": {
          "type": "object",
          "properties": { "name": { "type": "string" } },
          "required": ["name"],
          "additionalProperties": false
        },
        "defaults": { "name": "" }
      }
    }
  }
}
```

Require explicit `schema` and `defaults`. Schemas use draft-07 and document-local references; validation
does not coerce values, populate schema default annotations or remove properties. Optional metadata is
`title`, `description`, `form` (a custom component's source path), and `access` (`shared` or `owner`).

Current implementation: declarations are validated and readable as catalog data without activation.
Pack group value handles, access enforcement and custom-form binding are still being integrated.
The feature settings interface below remains the current feature API until its migration is complete.

## Features

The `features` map is the primary way to add functionality. Each entry is keyed by its feature id and bundles a backend system, frontend surface, settings, and services.

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "designation": "bookmarks",
      "settings": {
        "schema": { "type": "object", "additionalProperties": false },
        "defaults": {}
      },
      "system": {
        "entry": "src/features/bookmarks/be/system.ts"
      },
      "surface": {
        "label": "Bookmarks",
        "icon": "Bookmark",
        "state": "src/features/bookmarks/fe/state.ts",
        "canvas": "src/features/bookmarks/fe/canvas/list.vue"
      },
      "services": {
        "bookmarks": "src/features/bookmarks/be/services/bookmarks.ts#bookmarksService"
      }
    }
  }
}
```

### PackFeatureEntry fields

The entry's **key** is the feature id: a lowercase letter, then letters and digits
(`^[a-z][a-zA-Z0-9]*$`, e.g. `notes`, `calendarEvents`). It becomes an identifier in generated code, so
JavaScript reserved words (`default`, `export`, …) aren't allowed. Being a key is what makes a duplicate id
unrepresentable.

| Field | Type | Required | Description |
|---|---|---|---|
| `entities` | `Record<string, { shape?, shortCode? }>` | no | Entity wire names owned by this feature, each mapped to its declaration. `shape` is the pack-root-relative TypeScript export of its row (`path#Export`), left out for an untyped entity. `shortCode` is the prefix `create` numbers its rows with, `<prefix>-<n>`: three uppercase letters (`THR`), unique across every pack; the shape declares no `shortCode`, which `#generated/ears` types from the prefix (`ShortCodeOf<'Thread'>`); see [Services and data](services-and-data.md). `{}` declares an untyped, unnumbered entity. |
| `designation` | `string` | no | Role played by this feature; it may differ from the feature ID. Duplicate claims are refused locally and across packs. |
| `settings` | `object` | no | Declarative `schema`, explicit `defaults`, optional custom `form`, title, description and access policy; see [Feature settings](#feature-settings) |
| `system` | `{ entry, contract?, events? }` | no | Backend system module. `entry` must **default-export** its `SystemEntry`; how it's declared doesn't matter. `contract` is `"path#Export"` of the system's contract — a declared type holding its `incoming`, `internal`, `outgoing` and `context` (`SystemContract`, `@apackdev/sdk/framework`) — which the build reads without running or resolving the machine, so it lives in a leaf module such as `be/contract.ts`. Omit it for a system that sends and receives nothing. What its surface receives is the contract's outgoing events; a surface that also takes events from another feature or another pack declares those itself, in its own `Contract` (`surface.contract`). `events.incoming` lists event types the bus routes to the system besides those its machine declares. |
| `surface` | `{ label, state, icon?, canvas?, panel?, chat?, contract?, default? }` | no | Declarative frontend surface. State and views name modules; paths use default exports, or `path#exportName` for named exports. Codegen assembles the binding. Icons name Lucide exports or a custom component target. Contract is a leaf `path#exportName` containing published state/inbox types. `default: true` declares the startup default; a pack without a claim has none. See [surface declarations](features.md#defining-a-surface). |
| `services` | `Record<string, string>` | no | Services. Keys are identifiers, the names on `services`; values are `"path#exportName"`: a source file and the name of its export holding the service object (an object literal or class instance, not a factory). See [Services](services-and-data.md#services) |
| `repositories` | `Record<string, string>` | no | Repository objects. Keys are identifiers, the names on `repository`; values are `"path#exportName"`. Carried by the generated pack entry's registration (the app holds them with the pack's other contributions) and typed on `repository` from `#generated/repository`. A name is the app's, not the feature's: declaring one twice in a pack, or one a dependency declares, fails the build, since the app refuses to register two packs that share a repository name |
| `description` | `string` | yes | Nonblank feature purpose, independent of surface display labels |
| `types` | `string` | no | Pack-root-relative TypeScript module re-exported through `#generated/types`; optional `.ts` or directory `index.ts` resolution. No undeclared files are inferred. |
| `references` | `object` | no | Keyed reference identities and presentation metadata, with reactive item-provider exports; entity navigation uses declared surface destinations |

A feature can have just a system (backend-only), just a surface (frontend-only), or both.

A pack may claim at most one default surface. The host selects from enabled declarations before
loading frontends: native claims precede installed claims, then fully qualified feature refs sort
lexically using the English locale. Authoring-source previews do not participate. Frontend delivery
order cannot change the winner; opening waits for its matching accepted binding and actor. A saved
selection, popout target or explicit navigation takes precedence over this startup default.
A designation is a separately owned role, so duplicate roles across packs are errors. One role means something
to the app itself: `brain`, which `sendToSystem({ role: 'brain' }, event)` reaches. The chat's slash commands
need no role — the app derives them from stored documents (see [Slash commands](content.md#slash-commands)).

### Feature settings

A feature declares effective-value validation and explicit defaults as JSON data. Codegen derives its TypeScript value type from the schema:

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "entities": { "Bookmark": { "shape": "src/features/bookmarks/be/types.ts#BookmarkAttributes" } },
      "settings": {
        "schema": {
          "type": "object",
          "properties": {
            "syncInterval": {
              "type": "integer",
              "minimum": 1
            }
          },
          "required": [
            "syncInterval"
          ],
          "additionalProperties": false
        },
        "defaults": {
          "syncInterval": 300
        }
      },
      "surface": {
        "label": "Bookmarks",
        "icon": "Bookmark",
        "state": "src/features/bookmarks/fe/state.ts",
        "canvas": "src/features/bookmarks/fe/canvas/list.vue",
        "defaultVisible": true
      }
    }
  }
}
```

The declaration owns only this feature's settings; it does not repeat the feature ID. The host stores user overrides under `features.<packId>/<featureId>` and validates changed values for every write, including custom forms, actions and the JSON editor. Forms remain custom Vue components; no form is generated from the schema. Use JSON Schema draft-07 for validation; values are never coerced, transformed or populated from schema annotations. References stay within the value schema.

Defaults must pass the schema before the pack builds or registers. Navigation visibility is separate: `surface.defaultVisible: false` needs no settings declaration. Settings may also declare presentation metadata and a custom `form` path. Writes must satisfy the current schema; unchanged invalid values are not exempt. A disabled pack retains its user overrides, but its schema must be loaded before those values can be edited.

Installation, replacement, shipped-pack updates and live reload validate stored overrides against the
candidate settings declarations before replacing accepted state. Incompatible changes are refused with
the settings owner, field and reason; the incumbent remains accepted. This also checks overrides whose
pack was previously unavailable when its declaration becomes available again.

If preferences are already invalid at startup, the host opens a recovery screen before loading
external packs. Recovery can explicitly reset selected affected groups in one transaction, preserving
unselected groups, or reset all preferences. Every preference in a selected group returns to its default. Malformed document structure requires the complete reset.
Nothing is converted or silently discarded. After repair, restart apack to initialize its packs;
reconnecting a window preserves that restart requirement. App data and API keys are not reset.

Declare a custom form at `features.<id>.settings.form`, for example
`"form": "src/features/bookmarks/fe/settings.vue"`. The module default-exports a Vue
component that receives `settings` and emits `update-setting` with `{ path, value, condition? }`.
The host supplies the target address. Forms are independent of surfaces: a feature can provide a
form without a surface or system.

Pack-wide preferences use the same definition under `extensions.settings.<groupId>`, including
`schema`, `defaults`, optional `title` and `description`, and optional `form`. Their values live at
`packs[packId][groupId]`. Use a group for preferences shared across features; app preferences belong
to the host. Pack and feature declarations remain visible in Settings when their executable form
is unavailable; the JSON editor remains available. There is no pack-owned assembly of app settings.

### Entity destination declarations

A surface's TypeScript contract may declare the literal entity types it opens:

```ts
export type Contract = {
  opens: 'Note' | 'Action'
  // state and inbox declarations belong here too
}
```

These are existing entity wire names, including SDK and dependency entities; declaring a destination
creates no entity type or ownership claim. The build reads exported types without executing the module,
rejects unknown entities and competing destination features within a pack, and materializes the map in
`snapshot.json` as `entityDestinations`. Installed inspection reads that data without authored sources.
Omit `opens` for a surface with no entity destination; present declarations must be nonempty literal
unions. This build metadata does not itself make a runtime handler ready.

Call `openEntity(id)` from `@apackdev/sdk/fe` to open an existing entity. The shell checks existence,
selects its enabled declared destination and waits for the accepted frontend. Missing, disabled or
replaced destinations produce a useful refusal; callers do not choose a surface or send its private events.
The destination handles the shared `OpenEntity` event from `@apackdev/sdk/events`. Bind the SDK guard
as `entityIs: entityIs<Contract['opens']>` in the machine's `guards` and handle `OPEN_ENTITY` with
`guard: { type: 'entityIs', params: { entity: 'Memo' } }`. The event carries only `id`.


### Reference declarations

A feature declares reference identities and presentation as data. Item enumeration uses a named
function export, checked at build time without executing the module. Reference clicks pass the canonical
entity ID to `openEntity`; the destination comes from `Contract.opens`, independently of reference types.

```json
"references": {
  "types": {
    "memo": {
      "category": "memos",
      "icon": "NotebookText",
      "svgElements": [["path", { "d": "M2 6h4" }]]
    }
  },
  "categories": {
    "memos": {
      "label": "Memos",
      "icon": "NotebookText",
      "useItems": "src/features/memos/fe/references.ts#useItems"
    }
  }
}
```

Reference type and category names have global identities. Duplicate claims within a pack or
across its dependency tree fail validation/build; a shared ancestor arriving through two dependencies
retains its actual owner. Between independently installed packs, the app checks the same thing: if two
enabled packs claim one name, both are refused and the Packs view names the shared claim, as it does
for two surfaces opening one entity. Disabling either one resolves it. A type may use a category declared by its pack or a dependency. Each category
owns one provider. Icons name Lucide exports or use `{ "entry": "src/icon.vue", "load": "lazy" }` for a
custom component. SVG geometry supports path, rect and circle tuples.

`useItems()` is a Vue composable returning a reactive
reference-item list. Providers must work in an owned effect scope and release subscriptions with
Vue's `onScopeDispose`; they cannot depend on component lifecycle hooks or a particular component instance.
Generated frontend entries register these bindings under their owning feature. The host checks
complete declaration membership and refuses global type or category collisions before
publishing a candidate. Metadata remains discoverable while a pack is disabled or its runtime fails.
The SDK's `@apackdev/sdk/fe/references` exposes `getReferenceDeclarations()`,
`getReferenceCatalogStatus()` and `onReferenceDeclarationsChanged(listener)` over the common catalog.
Reading declarations never invokes navigation, item providers or components. The subscription returns
its cleanup function. A disconnected window can retain its last accepted metadata; status reports
that it is unavailable for current execution. Native/source entries do not invent installed receipts
or source enablement.

`getReferenceTypeDeclaration(name)` reads static type presentation; an ambiguous runtime name
returns absence. `getReferenceCategoryDeclarations()` lists categories with their owning feature refs,
including disabled and source declarations, without silently overwriting duplicate names.
`getReferenceTypeBinding(name)` and `getReferenceCategoryBinding(name)` return stable accepted entries
only with a ready catalog and matching enabled owner. Installed entries require matching declaration
and build identities plus a runtime identity; native entries carry no invented installed receipts.
Source advertisements are metadata, not executable claims. Ambiguous runtime names cannot execute.
Reactive consumers observe both `onReferenceDeclarationsChanged` and `onReferenceBindingsChanged`,
and release both subscriptions. Looking up a binding does not call navigation or start an item provider.

The editor reads these common declarations rather than a pack-local aggregate. Its generic anchor
parser reads `apack-ref://<encoded-type>/<encoded-entity-id>` independently of metadata; HTML/Markdown
preserve this identity while declarations are loading or absent. `formatReferenceHref({ type, id })`
and `parseReferenceHref(href)` are pure SDK helpers; malformed or unrelated URIs are refused. Node views follow declared geometry and resolve eligible navigation when clicked.
The picker starts only the selected category's provider while open, in an owned effect scope. Closing,
changing category, disconnecting, replacing/removing its binding or destroying the view stops that
scope. Unrelated publications retain the existing provider. Generated references contain only the
per-feature bindings registered by the frontend entry. The host shares the reference SDK module with
pack frontends so its readers use the renderer's catalog and accepted registry.

## Steps

Flow step types are declared under `extensions.steps`, keyed by type.

```json
{
  "extensions": {
    "steps": {
      "my-step": {
        "node": {
          "label": "My Step",
          "defaultLabel": "Run my step"
        },
        "build": {
          "compile": "src/extensions/steps/my-step/build.ts#compile",
          "validate": "src/extensions/steps/my-step/build.ts#validate",
          "getLabel": "src/extensions/steps/my-step/build.ts#getLabel"
        },
        "fe": {
          "nodeConfig": {
            "icon": "Box",
            "isImplemented": true,
            "category": "logic",
            "connectionRules": {
              "inputs": -1,
              "outputs": -1
            }
          },
          "colorKey": "indigo",
          "components": {
            "form": {
              "entry": "src/extensions/steps/my-step/form.vue",
              "load": "lazy"
            }
          }
        },
        "runtime": {
          "handler": "src/extensions/steps/my-step/runtime.ts#handler",
          "isAsync": true
        },
        "dsl": {
          "primaryField": "action"
        },
        "types": "src/extensions/steps/my-step/types.ts"
      },
      "my-trigger": {
        "kind": "trigger",
        "node": {
          "label": "My Trigger",
          "defaults": {
            "source": "change me"
          }
        },
        "trigger": {
          "trackField": "myTrigger",
          "compile": "src/extensions/steps/my-trigger/build.ts#compile",
          "decompile": "src/extensions/steps/my-trigger/build.ts#decompile",
          "register": "src/extensions/steps/my-trigger/runtime.ts#register"
        },
        "fe": {
          "nodeConfig": {
            "icon": "Radio",
            "isImplemented": true,
            "category": "trigger",
            "connectionRules": {
              "inputs": 0,
              "outputs": -1
            }
          },
          "colorKey": "blue",
          "components": {
            "form": {
              "entry": "src/extensions/steps/my-trigger/form.vue",
              "load": "lazy"
            }
          }
        },
        "types": "src/extensions/steps/my-trigger/types.ts"
      }
    }
  }
}
```

Codegen sends each facet where it is used, so no barrel keeps them in step with each other: `build` and
`runtime` go to the pack's backend registration, `fe` to its frontend one, and `build` (or `trigger`) alone
to `src/__generated__/steps-build.ts`, which `apack pack build` bundles to `dist/build/steps.build.mjs` — the
module a *dependent* pack's build loads to validate its flows with your step code.

Step `types` and `dsl.helpers` name pack-root-relative modules explicitly. No files are inferred from
facet directories; build, layout, form and type modules may live in different directories.

### StepEntry fields

| Field | Type | Description |
|---|---|---|
| `kind` | `"step" \| "trigger"` | Whether this is a regular step or a trigger. `step` is the default |
| `node` | `{ label, defaultLabel?, defaults? }` | Required inline data: canvas label, optional palette label and initial JSON fields; readable without importing modules |
| `build` | `{ compile, validate, getLabel, decompile?, branches?, relation? }` | Callback references and inline relation metadata. A trigger declares `trigger` instead |
| `trigger` | `{ trackField, compile, decompile, persistent?, queryFields?, validateTrack?, validate?, register? }` | Track metadata and callback references. Only register is loaded lazily at runtime |
| `fe` | `StepFrontendDeclaration` | Inline presentation, component targets and layout function references; see [frontend declaration](extensions.md#frontend-declaration) |
| `types` | `string` | Explicit pack-root-relative module declaring the step’s node and DSL types |
| `runtime` | `{ handler?, sync?, isAsync?, waits?, spawnsSubflow? }` | What the brain runs, and the flags it reads before running it. `handler` is loaded on the step's first run unless `sync`; see [Steps](extensions.md#runtime-facet) |
| `dsl` | `{ primaryField?, defaultLabel?, helpers? }` | Generates a flow helper for the step, named after the type (`keep_alive` → `keepAlive`). Without `dsl`, the step gets no helper |

A step's `dsl` fields:

| Field | Helper |
|---|---|
| `primaryField` | `name(<primaryField>: string, opts?)`, with the other fields of the `export interface DSL…Node` in the declared `types` module (required) as options |
| `defaultLabel` | `name(label = defaultLabel)` |
| `helpers` | Explicit pack-root-relative module whose custom helpers are re-exported |
| `{}` | `name(label?)` |

## Lifecycle configuration

The `lifecycle` object declares each lifecycle function explicitly. Its availability can be read without
executing the pack, and codegen checks that the named export is a function.

```json
{
  "lifecycle": {
    "onInit": "src/hooks.ts#onInit",
    "onShutdown": "src/hooks.ts#onShutdown"
  }
}
```

Only declared functions enter the registration. Other exports from the module are not lifecycle hooks.
Content sources belong in `content.sources`, independently of lifecycle callbacks.

```typescript
// src/hooks.ts
export const onInit = () => ensureDefaults();     // after every pack registers, before migrations and content
export const onShutdown = () => stopProcesses(); // when the pack's backend stops (app exit, pack unload or reload)
```

| Export | Runs |
|---|---|
| `onInit` | Whenever the pack starts (app boot/reset, installation, enablement or reload), after every pack has registered and before migrations and content. Create rows the pack's systems expect to exist here |
| `onShutdown` | When the pack's backend stops. Release what outlives its actors: processes, timers, listeners |

Every system starts when the bus does, after content is applied. There is no way for a feature to ask to start before it.

### ContentSourceConfig

`actions`, `prompts` and `flows` accept a path, or `{ "path": …, "onUserEdit"?: … }`. Any other key is one of:

| Shape | Description |
|---|---|
| `{ "path", "format" }` | `path`: source directory or file, relative to the pack root. `format`: a name in this pack's `content.formats`, or `"<dependency id>:<name>"` for a dependency's; that dependency must be declared in `dependencies` |
| `{ "path", "format", "applier" }` | Compiled with the format, and written by the pack module's `apply(ctx)` instead of the format applier |
| `{ "applier" }` | A pack module exporting `apply(ctx)`, used instead of a format and the format applier |

Every shape also takes `onUserEdit`, which decides what happens about an item the user has edited:

| Field | Type | Description |
|---|---|---|
| `onUserEdit` | `"theirs" \| "offer"` | `theirs` (the default): their edit makes the item theirs for good, and the app never mentions it again. `offer`: the app records that a newer version is waiting and the Packs view lets them take it or keep theirs. Neither overwrites their edit. See [Content](content.md#theirs-or-offer-what-happens-to-an-item-the-user-edited) |

An entry can't carry format settings, and an unknown key given a path string fails validation. A `content.datasets` entry takes no `onUserEdit`: nothing of a dataset is written, so there is no edit of the user's for a policy to be about. See [Content](content.md#writing-entities) for examples.

### ContentFormatConfig

A `content.formats` value, keyed by the format name: a lowercase letter, then lowercase letters, digits and hyphens. It needs exactly one of `format` and `compiler`.

| Field | Type | Description |
|---|---|---|
| `format` | `"markdown-tree" \| "json"` | Compile an entry's source with a built-in format: a directory of markdown, or a JSON array of records |
| `compiler` | `string` | A module in this pack whose default export compiles an entry's source into records. Bundled into `dist/build/content-compilers.mjs` for dependents |
| `entity` | `string \| string[]` | Entity types the records content (the pack's, a dependency's or the SDK's). Omitted, entries are compiled but not written |
| `identity` | `string[]` | Fields matched to find an existing row (`"parent"` = the tree parent). Ignored when the type's owning pack registers a `find` content writer |
| `tree` | `{ branch?, branchEntity?, relKind? }` | Walk subdirectories as parent rows: a directory's own file, its entity type, and the parent → child relation (default `contains`) |
| `fields` | `Record<string, { from, default?, type? }>` | `markdown-tree` only: record field → `body`, `filename`, `path` or `frontmatter.<name>` |
| `media` | `string` | Directory under an entry's `path` copied with the content; `media/<file>` links become `media://<id>/<file>` |

## Migrations

A migration moves data the pack has already written into the shape its new code expects. Each is declared
under the **version line** its target is on, keyed by the version it targets:

```json
{
  "migrations": {
    "pack": { "1.2.0": { "description": "Give every memo a colour", "up": "src/migrations/1.2.0.ts#up" } },
    "app": { "0.4.0": { "description": "Update app-owned data", "up": "src/migrations/0.4.0.ts#up" } }
  }
}
```

| Line | The target is | Runs when |
|---|---|---|
| `pack` | a version of **this pack**, compared against `version` in this manifest | the pack updates past it |
| `app` | a release of **apack** | the app updates past it |

Most migrations belong on `pack`: the pack's data moves when the pack does. Use `app` for data whose shape
follows apack's rather than yours. A target is always three numbers — the app reads a prerelease as its
release, so `0.4.0-beta.2` would match nothing.

`apack pack add migration 1.2.0` writes the entry and the file; `--app` puts it on the app's line.

The declaration owns the version line, target and description. The module exports behavior only:

```ts
// src/migrations/1.2.0.ts
export function up(): void {
  // Apply the change synchronously, checking first whether it is needed.
}
```

Keep migrations idempotent: development boots, prereleases and resets may repeat them. Descriptions are
available in the installed snapshot even when the pack is disabled or cannot activate.

A pack may declare both lines. They run at different moments, so a single change split across them gets an
order you probably did not intend — keep one change on one line.

## Editor and app extensions

Declare these contributions directly under `extensions`, alongside artifacts, help and other kinds:

```json
{
  "extensions": {
    "textEditor": {
      "suggestions": {
        "extensions": { "mention": "src/editor/mention.ts#Mention" },
        "popups": { "mentions": "src/editor/MentionPopup.vue" },
        "isSuggestionActive": "src/editor/suggestions.ts#isSuggestionActive"
      }
    },
    "appExtensions": { "welcome": "src/extensions/app/Welcome.vue" }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `textEditor` | `Record<string, TextEditorExtensionsDeclaration>` | Named groups of editor extensions, popups and optional suggestion predicates |
| `appExtensions` | `Record<string, string>` | Named app extensions: slot name (an identifier) → Vue component path |

Within each Tiptap group, `extensions` maps the actual Tiptap name to its exported extension object
(`path#export`); `popups` maps local popup IDs to Vue modules; `isSuggestionActive` names a function
export. All paths are pack-root-relative. Discovery reads these declarations without importing their
modules. Build checks exports and runtime admission checks exact member identities and executable
shapes. Conflicting active extension names are refused with both owners.
See [Text editor extensions](extensions.md#text-editor-extensions) for the binding contract.

Carrying your own copy of `@apackdev/ui` is `build.bundleUi`, not one of these: it changes what the build
produces rather than giving the app anything.

The frontend entry itself isn't declared here: `apack pack build` bundles `src/pack-entry-fe.ts` (or `.js`) if present, else the generated `src/__generated__/pack-entry-fe.ts`, into the pack's `runtime/fe.js`, with any extracted styles as `runtime/fe.css`. The app loads whichever of those two files the installed pack has.

## Build configuration

```json
{
  "build": {
    "opaqueDeps": ["elkjs"],
    "bundleUi": false
  }
}
```

| Field | Type | Description |
|---|---|---|
| `opaqueDeps` | `string[]` | Dependencies the frontend bundle includes whole instead of tree-shaking, by package name |
| `bundleUi` | `boolean` | Bundle a copy of `@apackdev/ui` into the pack instead of using the app's (default `false`). All of `@apackdev/ui` is bundled, so the pack never mixes the two |

Everything under `build` changes what `apack pack build` produces, or how long it takes, and nothing the app
loads — which is what separates it from the sections above.

**`opaqueDeps` is for a dependency that is already a bundle** — shipped as one already-minified file, or
compiled from another language — where tree-shaking removes almost nothing and walking it is most of what
the frontend build spends its time on. It trades a little output size for build time: on the pack
apack ships, naming its one such dependency took `apack pack build` from 23.3s to 20.6s for 38 KB on an
8.5 MB bundle (median of 3 interleaved runs, 2026-10-08). Every other module is shaken as before, so a
dependency you wrote yourself does not belong here — it would keep its dead code for nothing.

## Dependencies

```json
{
  "dependencies": {
    "other-pack": ">=0.1.0",
    "github-pack": "github:user/repo >=0.2.0",
    "local-pack": "file:../path/to/pack"
  }
}
```

Three dependency formats are supported:

| Format | Example | Description |
|---|---|---|
| Semver range | `">=0.1.0"`, `"*"` | Resolves from this machine (the workspace, the app configured for `apack pack test`, installed apps), then the `.apack/deps/` cache |
| `github:` | `"github:user/repo >=0.2.0"` | Resolves from GitHub releases (optional semver filter) |
| `file:` | `"file:../other-pack"` | Resolves from a local filesystem path (relative to pack root or absolute). Always reads fresh — skips cache. Ideal for local development. |

Resolution order for semver and `github:` deps: the workspace (`../<id>`, `../../packages/<id>`, `../../<id>`) -> the app configured for `apack pack test` -> installed apack apps -> `.apack/deps/` cache -> GitHub releases (`github:` only). Each must satisfy the range. `file:` deps resolve directly from the given path and do not fall through to other resolvers. See [`apack pack fetch-deps`](cli.md#apack-fetch-deps).

Run `apack pack fetch-deps` to pull dependency snapshots for cross-pack type interop.

## Entities and relations

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "entities": {
        "Bookmark": { "shape": "src/features/bookmarks/be/types.ts#BookmarkAttributes" },
        "Tag": {}
      }
    }
  },
  "data": {
    "entities": { "ImportLog": {} },
    "relations": { "tagged_with": {} }
  }
}
```

Declare each entity once, under its owning feature or `data.entities` when it has no feature owner.
The key is its unchanged EARS wire name, PascalCase (`^[A-Z][A-Za-z0-9]*$`), as the database holds a type's. A field
the database is told of is lowerCamelCase (`^[a-z][A-Za-z0-9]*$`): each one an entry `indexes`, and each one its shape
requires, which the build refuses otherwise. A field the shape leaves optional may be named any way.

An entry's `search` declares the type's text index, which `query(type).search(text)` matches:
`{ "fields": { "title": 3, "content": 1 }, "stem": "en" }`. Each field is one the shape declares, holding a string or a
list of strings, and its weight counts each of its words that many times; `stem` names the language whose stems match a
word's other forms. A search ranks by relevance, takes `"a phrase"`, `-word`, `field:word` and `a OR b`, and its
options match the last word as a prefix while it is typed (`prefix`), forgive a typo in a longer word (on unless
`fuzzy: false`) and rank newer first (`recency: { field, halfLife }`). `hits()` answers each match's score and
highlights.

An entry's `embed` declares the type's vector index, which `near`, `like` and `hybrid` rank by:
`{ "from": ["text"], "chunk": "paragraph", "model": "openai:text-embedding-3-small", "dims": 1536 }`. `from` names the
fields whose text is embedded, as `search`'s do; `chunk` splits it (`whole`, the default, `paragraph` or `heading`),
each part embedded on its own; `model` is a `provider:model` that embeds, and `dims` its embeddings' size. A write to
one of its fields leaves the entity's changed chunks pending, and a search doesn't find a pending chunk, until
`embedPending()` (`@apackdev/sdk/services`) embeds them through `services.inference` with the user's key for the
model's provider; whoever writes the text runs it after. `query(type).near(vector, { k })` ranks by cosine similarity,
`like(id)` by an entity's own embedding, and `hybrid(text, vector)` merges a text search with `near`;
`embedSearchText(type, text)` makes a search's vector with the index's model. Placement records ownership, without a
feature prefix.
A string names an exported TypeScript shape; `null` explicitly leaves the entity untyped. Paths are
relative to the pack root, including those declared inside a feature. The build checks modules and
exports without executing them; installed discovery reads built declarations without source files.
Duplicate entity declarations name both owners and fail validation.

Keys become TypeScript constants in generated `ears.ts`. Entity constants equal their keys; a relation
wire is declared once in `data.relations`, shared across the pack's features. Its constant name is
uppercase (`tagged_with` → `TAGGED_WITH`). Each maps to the rules its edges are held to, `{}` for none:
`"acyclic": true` refuses a link that would close a cycle through the kind (`CYCLE`), as a tree or a folder
hierarchy wants, and `"unique": true` keeps at most one edge of the kind from an entity to another, so linking the
pair again replaces the edge's info. The SDK's `parent_of` is acyclic. SDK-owned relation wires are refused. Every kind
the pack links with is declared: the generated `EARS.RelKind` is closed over the pack's, its dependencies' and
the SDK's, and the engine refuses any other at runtime. Roles work the same way: `data.roles` lists every role the
pack grants (`entry_event` → `ENTRY_EVENT`), `EARS.RoleKind` is closed over them, and an undeclared role is refused.
Shapes type attributes without changing stored identities.

No two packs may use the same name: a key or a value another installed pack declares fails `apack pack build` (for a dependency) and the app's registration of the pack.

The SDK defines the entity types `Relation`, `Flow`, `Node`, `Action`, `Prompt`, `Document` and `Collection`, and the relation kinds `CONTAINS` (`contains`), `TRANSITIONS_TO` (`transitions_to`), `INSTANCE_OF` (`instance_of`) and `PARENT_OF` (`parent_of`), and the roles `ROOT_FLOW` (`root_flow`) and `ENTRY_EVENT` (`entry_event`), for every pack. A pack can't declare any of them, as a key or as a value: the error names each entry to remove, and editors using `apack.schema.json` flag them. A dependency built by an older CLI that still lists them fails the build until it's rebuilt.

## DSL definitions

```json
{
  "extensions": {
    "dsl": {
      "action": {
        "entry": "src/defs/action.ts",
        "targets": ["monaco"],
        "prefix": "action:",
        "inline": ["ai"],
        "globals": { "services": "typeof _dsl.services" }
      }
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `entry` | `string` | Module whose types are bundled into the definitions |
| `targets` | `["monaco"]` | Editors that get the definitions |
| `prefix` | `string` | Editor models whose path starts with it get these definitions (e.g. `action:`). Omission or an empty value disables path inference; an editor can select the DSL explicitly |
| `inline` | `string[]` | Packages whose declarations are bundled into the definitions besides your own modules and `@apackdev/*`. The editor loads no `node_modules`, so a type it needs from another package belongs here; everything else stays an import |
| `globals` | `Record<string, string>` | Globals in scope and their types. The catalog carries these declarations with the compiled definition text; Monaco follows updates without activating a frontend |

Path inference uses the unique longest matching nonempty prefix; equal-length matches from different DSLs are ambiguous. DSL files default to TypeScript unless the editor explicitly selects another language.

For each entry with a `monaco` target, `apack pack build` writes `dist/defs/monaco/<name>-defs.d.ts`: the entry's types bundled into one declaration file, wrapped as `declare module "@app/defs/<name>"`.

## Example manifest

```json
{
  "id": "bookmarks",
  "name": "Bookmarks",
  "version": "0.1.0",
  "hostVersion": ">=0.3.0",
  "license": "MIT",
  "dependencies": {
    "default-setup": "*"
  },
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "entities": {
        "Bookmark": { "shape": "src/features/bookmarks/be/types.ts#BookmarkAttributes" }
      },
      "settings": {
        "schema": {
          "type": "object",
          "additionalProperties": false
        },
        "defaults": {}
      },
      "system": {
        "entry": "src/features/bookmarks/be/system.ts"
      },
      "surface": {
        "label": "Bookmarks",
        "icon": "Bookmark",
        "state": "src/features/bookmarks/fe/state.ts",
        "canvas": "src/features/bookmarks/fe/canvas/list.vue"
      },
      "services": {}
    }
  },
  "extensions": {
    "steps": {
      "bookmark-check": {
        "build": {
          "compile": "src/extensions/steps/bookmark-check/build.ts#compile",
          "validate": "src/extensions/steps/bookmark-check/build.ts#validate",
          "getLabel": "src/extensions/steps/bookmark-check/build.ts#getLabel"
        },
        "fe": {
          "nodeConfig": {
            "icon": "Box",
            "isImplemented": true,
            "category": "logic",
            "connectionRules": {
              "inputs": -1,
              "outputs": -1
            }
          },
          "colorKey": "indigo",
          "components": {
            "form": {
              "entry": "src/extensions/steps/bookmark-check/form.vue",
              "load": "lazy"
            }
          }
        },
        "node": {
          "label": "My Step"
        },
        "types": "src/extensions/steps/bookmark-check/types.ts"
      }
    }
  },
  "content": {
    "sources": {
      "actions": "src/content/actions",
      "flows": "src/content/flows"
    }
  }
}
```

## Help articles

Declare a directory of Markdown articles:

```json
"extensions": {
  "help": { "path": "src/extensions/help" }
}
```

The first H1 is the article title; the remaining Markdown is its body. Optional frontmatter:

```markdown
---
id: getting-started
features: [code]
order: 1
---
# Getting started

Your guide goes here.
```

IDs default to the relative filename without `.md` (including subdirectories). An explicit ID keeps links from code stable when a file moves. IDs are unique within a pack; feature associations name features declared by that pack. Relative links to other help Markdown files are checked and resolved during the build. Standard Markdown link titles, reference links and code examples are supported.

Help is bundled into the pack runtime, works offline and is not stored in the database. The host provides a searchable Settings → Help tab and contextual links from feature menus and settings.

```ts
import { openHelp } from '@apackdev/sdk/fe';

openHelp();
openHelp({ packId: 'my-pack', featureId: 'code' });
openHelp({ packId: 'my-pack', articleId: 'getting-started' });
```

Build errors identify missing titles, duplicate IDs, invalid metadata and broken article links. Development watch mode reloads help Markdown edits, additions and removals. An invalid edit reports its source file and keeps the last working runtime.
