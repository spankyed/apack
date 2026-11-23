# Finish the app settings extraction

Status: completed 2026-10-19. Host, pack and feature settings now share declarative schemas, owner-bound handles and current-document validation; forms remain custom.
See the [completed goal](../goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19) and
[final requirement/source audit](../references/evidence/settings-and-pack-contracts.md#final-requirement-and-source-audit--2026-10-19).
Dated checkpoint notes below are historical; deferred work keeps its separate owner.

Sequencing: the [naming contracts goal](../goals/goal-naming-conventions.md) is complete.
Re-audit names against its result; settings-specific names remain owned here.
The [manifest maturity roadmap](manifest-maturity.md) orders this work with the common discovery
foundation. This plan must not introduce a separate settings-only catalog.

Historical checkpoint status: in progress on `session/settings-pack-contracts`. The integrated extraction passes checkpoint
validation. Whole-data administration, onboarding separation and supported service selection are
implemented through the [consumed-API checkpoints](declared-capabilities.md); preserve their runtime
lifetime and external-consumer evidence for final strict acceptance. This is an API contract, not isolation.

This replaces the earlier plan to make globally named settings sections exclusive. The work is an
ownership and service redesign, not merely removal of the `settingsSections` thunk.

The projects audit and external research are folded into the decisions below. Keep `app.projects` as
ordered directory configuration; use `extensions.settings` for pack-local preference groups; compose
explicit defaults before pure validation; and reuse the existing accessors and request correlation.
JSON Schema is the common target definition for app, pack and feature preferences. The remaining
implementation review covers feature constraints, generated type facades, custom forms, and actual
onboarding and restore behavior. They do not reopen the three-owner document design.

## Product goal

Application preferences work without default-setup. Packs can declare preferences shared by their
features without editing the host. Features retain their own preferences. Every consumer reads the
same authoritative settings, whether or not the Settings page has opened. Resetting preferences does
not reset assistant identity lifecycle or restart onboarding.

## Original extraction defects

Before this extraction, the host owned persistence, writes and notifications, but default-setup defined `general`,
application shortcut defaults and assistant settings. The renderer has built-in Personal, Projects
and Application forms while treating their data as opaque pack contributions and duplicating types.
The host reads `general.application.hotkeys`, so that supposedly opaque shape is already an app contract.

`settingsSections` was a function called synchronously during registration despite documentation claiming
lazy evaluation. Sections merge globally with silent last-wins collisions. More importantly, the renderer's
settings port reads the Settings view actor's context and sends writes through that view. Presentation
still acts as the source of settings for other features.

Threads wrote `assistant.birthdate` and used it to gate onboarding. That combined an editable preference
with lifecycle state and makes the chat feature responsible for an assistant shared by the pack.

## Ownership and document shape

| Owner | Responsibility | Examples |
|---|---|---|
| App | Preferences guaranteed independently of installed packs | Shell hotkeys, personal details, shared project configuration |
| Pack | Preferences shared by its features | Default-setup assistant display name |
| Feature | Preferences belonging to that feature | Code terminal preferences, Threads chat preferences |

One host settings engine composes defaults and stored overrides for all three. The target effective
shape is:

```json
{
  "app": {
    "hotkeys": {},
    "personal": {},
    "projects": []
  },
  "packs": {
    "default-setup": {
      "assistant": { "name": "" }
    }
  },
  "features": {
    "default-setup/code": {}
  }
}
```

`General`, `Application` and `Assistant` are navigation labels, not document roots. There is no arbitrary
root section or miscellaneous `extras` bucket. A pack owns `packs[packId]`; a feature owns its resolved
ref. Two packs may both declare `assistant` without conflict. They cannot contribute app defaults or
replace another owner's preferences through their declarations.

Host implementation owns app defaults and validation. Shared browser-safe types and access contracts
live in the SDK so packs and the renderer do not import private host implementation or duplicate types.
Feature ownership stays under `features.<id>.settings`; its definition changes from an executable
Zod module to the same data contract used for app and pack preferences.

### Remove the pack's app-settings abstraction

Host ownership is incomplete while default-setup still assembles a document through
`src/app-settings` and `settingsSections`. Moving some values to the host did not extract the contract:
the remaining pack assembly, arbitrary section APIs and section-addressed forms preserve that coupling.
Do not rename or relocate this directory into another settings assembly layer.

The current source audit found these responsibilities:

| Current component | Final disposition |
|---|---|
| `default-setup/src/app-settings/index.ts` | Delete `getBaseSettings`, `assertNoFeatureSlice` and the `settingsSections` thunk. Manifest ownership and schema validation make the assembly and its guard unnecessary. |
| `default-setup/src/app-settings/types.ts` | Delete the pack's whole-document `SettingsData` and hand-written assistant value type. The host/SDK owns the document; assistant values derive from the declared group schema. |
| `default-setup/src/app-settings/schema.ts` | Delete the unused `hotkeysSchema`; it has no callers. Host app and feature definitions already declare their respective values. |
| `default-setup/src/content/default-settings.ts` | Delete. Declare the assistant group inline in `extensions.settings`; settings defaults are neither content nor an executable export. |
| `default-setup/src/defs/action.ts` `SettingsData` re-export | Delete; actions use owner-bound settings access rather than a pack-authored app document. |
| `#app-settings/*` package/TypeScript aliases and assembly tests | Delete. Replace tests with ownership, schema, effective-value and real lifecycle checks. |
| `getSection`, `setInSection`, `useSettingsSection` and section/label transport targets | Replace with explicit app, pack/group and feature targets through the common writer and frontend runtime. No section API remains as an adapter. |

The only remaining pack preference in that assembly is assistant `name`. Its declaration belongs in
`extensions.settings.assistant`, stored at `packs['default-setup'].assistant`. App hotkeys, personal
details and projects belong to host app definitions, stored at `app`. Onboarding completion and progress
remain existing lifecycle state; they imply no assistant feature, actor or settings assembly module.
Custom forms are presentation bindings to those owners, not owners of their definitions or data source.

Frontend writes cross a Vue-to-data boundary in the SDK frontend adapter. Existing custom forms emit
reactive arrays and nested shortcut objects; generated handles can receive the same drafts. Unwrap
nested reactive wrappers for both values and write conditions before the framework-independent host
transport. Preserve invalid data for refusal: JSON stringification must not drop undefined fields,
turn non-finite numbers into null, or accept dates as strings. The host remains the validation authority.
Host hotkey drafts additionally preserve `global`, follow incoming snapshots, and forward their compare
condition through the parent form. This is ordinary frontend data adaptation, not legacy support.

**One integrated removal checkpoint:** establish the shared document/target/handle contract and trusted
caller binding; publish installed declarations through the common catalog; migrate the assistant group,
app and feature callers, writer, events, renderer consumers and custom-form targets; then remove all
components above in that same working change. Generated entries/types, manifest/schema, public API reports,
fixtures and docs must agree. Do not commit a new catalog reader as a substitute while retaining this
pack-owned app assembly. Before committing, prove the app/pack/feature route described in the goal,
including disabled definitions, restrictions, reset and restore; assert the obsolete directory, aliases,
exports and manifest key are absent. No compatibility bridge or historical conversion accompanies removal.

### Ownership review of the working implementation

The source review after the user's extraction correction distinguishes deletion from completion.
The working change deletes `default-setup/src/app-settings`, its content defaults, aliases and tests.
The following responsibilities must also stay separated throughout the remaining review:

| Responsibility | Current implementation | Review requirement |
|---|---|---|
| App value definition | Host `features/settings/be/app-definition.ts`; SDK types generated from it | App values must work with no default-setup. A pack may consume the contract, never supply its defaults. |
| Shared pack preferences | Inline `extensions.settings.assistant`; a custom Vue form | Keep only the display-name preference here. The form is not an assembly layer or lifecycle owner. |
| Feature preferences | Inline `features.<id>.settings`; generated handles | The qualified feature identity selects the values. UI labels must not become addresses. |
| Effective values and persistence | Host settings store, installed declarations and sparse overrides | One writer validates every change; disabling a runtime removes neither its definition nor saved choices. |
| Frontend access | Window resource established before shell/pack loading | Opening Settings must not initialize another consumer's data. Navigation chooses presentation only. |
| Onboarding | Existing AppState completion and authored workflow progress | Resetting preferences must not reset onboarding; whole-data replacement must restart the real consumers correctly. |
| Whole-data administration | Explicit `host/appData` consumption, separate `host/onboarding`, accepted caller/provider-bound service facades | Preserve declaration/type/runtime agreement and real Database/onboarding/action acceptance; final strict validation remains required. |

The original whole-data authority gap is resolved by the [consumed-API contract](declared-capabilities.md):
`host/appData` is an explicit consumption, onboarding uses its separate API, generated types match
host-selected facades, and accepted caller/provider lifetimes govern retained services. Keep targeted
settings policy separate from whole-data administration; do not claim these facades isolate arbitrary
in-process JavaScript, EARS or Node access. The current-source review additionally repairs callable
services bypassing retirement through the same binding owner; object services, bound calls and
construction must preserve their accepted lifetimes. Final committed-source acceptance remains required.

For final acceptance, review the app/pack/feature consumers and presentation
routes against this table, preserve real export/import and onboarding checks, and search active contracts
and guides for removed section APIs. No old-format accommodation or replacement assembly is required.

Real two-window import acceptance exposed a publication-order defect: hydration changed the values while
the store still advertised its pre-settlement revision, and `onReplaced` caused snapshots to be broadcast
before the replacement bracket closed. Both windows correctly refused those inconsistent snapshots.
The replacement boundary must retain the previously published values and declarations for transported
snapshots until settlement; internal migration reads may see the hydrated candidate. Settlement advances
the revision and publishes the result before general data-replaced notifications. Reset and import share
this boundary. Invalid import preflight still occurs before entering replacement, and failed replacement
publishes the rolled-back result through the same settlement path. Do not relax window identity checks
to admit intermediate database state.

The subsequent navigation failure has an identified cause: the Database backup view schedules a
renderer `location.reload()` 1.5 seconds after import, despite Electron blocking that navigation.
Native `will-navigate` and Chromium requested-navigation diagnostics confirm the blocked reload.
Remove this obsolete workaround; show the backend's import result, including the explicit Brain restart
instruction, while the common replacement publication refreshes live consumers. The Database reset
success action uses the same blocked reload and must also stop relying on it. Its local row results,
trace caches and outstanding request identities are invalid after reset/import; clear those on success
while retaining the editor and current settings/schema. Initialize mutable trace state per actor so two
windows cannot share Sets or Maps. Failed import retains the prior results. Verify late replies cannot
repopulate replaced data, and rerun the complete real-app sequence without tracing or longer deadlines.

The broad composition check found another ownership leak: app-data borrowed the globally bound settings
administrator, and the settings store borrowed the globally installed EARS engine. The composition root
must supply the store's owning engine and inject the same settings service into app-data. A required
engine provider lets the test harness follow engine replacement without making production stores change
owners when another engine is installed. Do not bind an unrelated SDK host merely to make the composition
test pass. Verify two independently constructed settings services keep their data on their own engines.

## Naming contract

Use **settings** consistently in APIs, types and manifest keys. Preferences describes their product
purpose; it is not a second API vocabulary. Separate definitions, effective values, stored choices and
presentation rather than naming all of them settings sections.

| Concept | Name | Meaning |
|---|---|---|
| Pack contribution | `extensions.settings` | Pack-owned settings definitions keyed by local group ID |
| Feature declaration | `features.<id>.settings` | One feature-owned settings definition |
| Declaration | `SettingsDefinition` | Schema, explicit defaults and optional presentation/form metadata |
| Discoverable definitions | `SettingsCatalog` | Definitions indexed by owner; part of the host contribution catalog |
| Pack-local collection | Settings group | Addressable values such as `packs[packId].assistant` |
| UI grouping | Settings category | Navigation/presentation independent of ownership and storage |
| Composed values | Effective settings | Defaults overlaid with stored overrides |
| Persisted choices | Settings overrides | Explicit user choices, including values equal to defaults |
| Owner-bound access | `SettingsHandle<T>` | Reads, writes and resets one target |
| Write/reset address | `SettingsTarget` | App, pack/group or feature identity |

Keep `SettingsDocument` for the effective whole-document shape and `SettingsService` for the host writer.
Use `SettingsSnapshot` for transported effective values plus revision/run identity; do not call the
catalog or defaults a snapshot of user settings. Use `SettingsOverrides` for the sparse persisted shape,
including retained orphan values. Reserve **scope** for storage precedence such as user/workspace/profile,
**owner** for app/pack/feature, and **state** for lifecycle facts. This work adds no storage scopes.

Retire section terminology from authoring and addressing APIs. Existing section names remain in historical
explanations and migration sources only. A group ID is stable storage identity; its `title` is a display
heading and `description` is explanatory text. Categories organize the UI without changing group IDs or
value paths. `label` must not carry an identifier. Keep `schema`, `defaults` and `form` as declaration names.

| Current surface | Target |
|---|---|
| `settingsSections` | Remove; declare pack groups in `extensions.settings` |
| `FeatureSettings` declaration / `defineFeatureSettings` | Common `SettingsDefinition`; remove executable declaration helper after data conversion |
| `PackSettingsDefaults` containing values, schemas and visibility | Catalog definitions plus derived defaults; navigation visibility belongs to its separate policy |
| `getPackSettingsDefaults` / `onPackSettingsDefaultsChanged` | Catalog reads/subscriptions for definitions; effective-value subscriptions for values |
| `FeatureSettingsAccess<T>` | `SettingsHandle<T>` |
| `FeatureSettingUpdate<T>` | `SettingUpdate<T>` for every owner's typed path/value pair |
| `getStored()` | `getOverrides()` |
| `getSection()` / `setInSection()` / `useSettingsSection()` | Owner-bound handles and explicit targets |
| `{ entityType, label }` targets | Discriminated `SettingsTarget` with actual owner identifiers |

There is already a frontend `SettingUpdate` with an untyped value. Unify it with the typed update contract
rather than create two unrelated public types with the same name. Use `unknown` at the transport/form
boundary and preserve path/value pairing in generated author access. Audit declaration-inference names
such as `FeatureSettingsValue` and generated `PackFeatureSettings`: name definition-derived value types
for values, while keeping feature qualification where it actually describes the map's keys.

Low-level targets are explicit:

```ts
type SettingsTarget =
  | { kind: 'app' }
  | { kind: 'pack'; packId: PackId; groupId: string }
  | { kind: 'feature'; featureRef: FeatureRef };
```

Paths are relative to that target. The host's trusted whole-document operations remain separate; absence
of a target must not accidentally turn a scoped reset into a whole-app reset. Backend and frontend use
the same target vocabulary, with their existing synchronous/asynchronous execution differences.

## Declaration and authoring interface

Pack settings are inline manifest declarations under `extensions.settings`, keyed by a local group
name. Replace the old `settingsSections` name as well as its contract: these are pack preferences,
not contributions to arbitrary app document sections. Keep `features.<id>.settings` for feature-owned
preferences; `extensions.settings` is for pack-owned preferences shared across features.

```json
{
  "extensions": {
    "settings": {
      "assistant": {
        "title": "Assistant",
        "defaults": { "name": "" },
        "schema": {
          "type": "object",
          "properties": { "name": { "type": "string" } },
          "required": ["name"],
          "additionalProperties": false
        }
      }
    }
  }
}
```

Defaults are JSON data, not an export target, function or compiled content entry. Require explicit
`defaults` and `schema` for writable app, pack and feature preferences. Defaults are the complete baseline object; optional
fields may be absent. The schema describes valid effective values, not the sparse stored overrides.

Use JSON Schema draft-07 as the common settings schema format. Start with ordinary objects, arrays, primitives,
nullable values, enums, required fields, constraints and document-local references. Avoid remote schema
resolution and custom keywords. Use a maintained validator and declaration generator instead of writing
a schema-to-Zod or schema-to-TypeScript translator. The first implementation checkpoint must prove the
chosen tools on optional fields, nullable values, records, enums and arrays; reject unsupported authoring
shapes explicitly rather than silently generating an incorrect facade.

Ajv 8.20.0 and json-schema-to-typescript 15.0.4 are now declared SDK dependencies. The host/build-only
`_compileSettingsDefinition` validates explicit defaults and returns a pure value validator; build tooling
`generateSettingsTypes` emits schema-derived declarations. Compile/check validators once per declaration
change, not on every read. Keep validator compilation out of renderer form rendering.

The repository uses Zod 3.25 today. Audit every existing feature settings schema before conversion:
list refinements, transforms, defaults, shared schemas and constraints, then map each to JSON Schema
or an explicit domain responsibility. Preserve valid values, default behavior and meaningful refusals;
do not silently widen a schema to make conversion easy. If an essential constraint cannot be expressed,
resolve that concrete case before converting its declaration. Avoid a general custom-keyword system.

Migrate app and feature settings definitions to the same `schema` plus `defaults` contract as pack groups.
Host app definitions live in host-owned source data. Pack and feature definitions are manifest data,
inline or in local JSON files resolved and embedded at build time. Built snapshots must carry complete
schemas and defaults so installed settings discovery requires no executable settings module. Keep existing
feature form paths and visibility semantics; presentation metadata is independent of value validation.

Reuse the current writer and normalize JSON Schema issues into its refusal contract. Change all owned
declarations and consumers together: one settings schema format, without a temporary adapter, retained
Zod settings authoring API or compatibility alias. Zod used by unrelated APIs,
manifests and domain code is unaffected; no repository-wide Zod upgrade is required.

The common definition supports runtime validation, JSON editor completion/descriptions/errors, generated
TypeScript accessors and discovery of installed settings without pack activation. Wire the composed schema
into the existing advanced editor as part of delivery; these benefits require integration rather than
appearing automatically when the schema is declared. Schema metadata remains available to custom forms,
help and tooling. This does not introduce generated forms.

JSON Schema `default` is an annotation and does not populate missing values. Keep actual defaults in
`defaults`; do not maintain a second baseline through nested schema defaults. Disable coercion, default
insertion and removal of additional properties. Check the declared baseline against its schema, then
validate each candidate effective value without modifying it. Apply the current schema consistently to
all supported writes and imports. Do not grandfather invalid values or accept an obsolete document shape.

Generated types describe structure, optionality and representable alternatives. Numeric ranges, patterns
and other constraints remain runtime checks; do not promise that every invalid value is a compile error.

An optional `form` source path belongs beside `title`, `description`, `defaults` and `schema`. Use the existing feature
form convention (a component's default export) rather than another export-target syntax. Load it through
the pack frontend contribution registry, never the backend registration's imports. The form receives
readonly effective values and emits the same typed setting updates as feature forms. The host supplies
save results, resets and navigation. Without a form, expose the group through typed access and the advanced
editor; do not show a blank editable page. Keep all forms custom.

Normal author code uses generated owner-bound handles. Retain the existing handle operations and make
owner selection explicit, rather than offer both property shortcuts and selectors. Backend example:

```ts
appSettings.get();
const assistant = packSettings.forGroup('assistant');
const code = featureSettings.forFeature('code');
assistant.get();
assistant.set({ path: ['name'], value: 'Ava' });
assistant.reset(['name']); // Remove this field's override; reset() resets the whole group.
```

`packSettings` is bound to the author pack; `forGroup` takes a local group ID or a qualified dependency
group selector, never a pack ID alone.
`featureSettings.forFeature` resolves local feature IDs and declared dependency refs using generated
types. Both selectors return a `SettingsHandle<T>`; `appSettings` is the SDK-defined app handle. Today
the generated backend export is `settings.forFeature`, while `services.settings.forFeature` returns
values instead of a handle. Migrate these callers together: a selector must not sometimes return values
and sometimes a handle. Values come from `get()`; do not retain a second selector alias. Internally,
use the explicit targets above rather than a generic section string. Backend
writes remain synchronous and throw a structured refusal. Frontend handles expose readonly reactive
values, scoped subscriptions and asynchronous save/reset results. Generate pack types from the schema,
not literal defaults. Extend the existing typed path/update model across owners; arrays remain whole values.

Make absence and reset distinct: an omitted field inherits its default, `null` is a value only where the
schema permits it, and `undefined` is not a persisted update value. Use reset to remove an override. Setting
a field to today's default records an explicit choice; reset opts into following future defaults. Update
docs that claim every write stores only differences: targeted writes and whole-document replacement
record supplied values as explicit choices. Do not infer user intent by pruning default-equal values
during normal writes or import.

Whole-document access remains for backup, import, migrations and the advanced editor. It is not the
normal authoring API. Whole-document replacement accepts a complete effective `SettingsDocument`,
validates it without filling omitted fields, and records every supplied value as an explicit choice.
Targeted writes and backup import use sparse `SettingsOverrides`, validated after applying defaults;
reset removes overrides explicitly. The advanced editor shows the effective document, so its JSON Schema
must validate that same complete shape rather than a weakened schema for sparse overrides. Import
preflight retains its separate sparse contract. Owner-bound handles prevent accidental misaddressing; they are not a sandbox for
trusted pack code. Explicit cross-owner access must name the owner and use the same writer.

### Pack namespacing and cross-pack access

Shared access is the default for pack groups and feature settings: the owning pack and packs declaring
it as a dependency can read, write and reset them. A dependency's qualified identity makes the target
explicit; no separate write grant is required. Generation makes dependency contracts available, rather
than searching all installed packs for a matching bare name.

```ts
// Generated for the importing pack. In default-setup, 'code' resolves to 'default-setup/code'.
const local = featureSettings.forFeature('code');
// In a dependent pack, explicitly selects default-setup's feature.
const dependency = featureSettings.forFeature('default-setup/code');
// Pack groups follow the same local/qualified selector convention.
const assistant = packSettings.forGroup('default-setup/assistant');
```

Both local and qualified shared targets return writable handles. A bare name always belongs to the
importing pack; it does not fall back to a dependency or a globally installed feature. Qualified feature
refs and qualified group selectors are different typed domains even though both use `<packId>/<localId>`;
the latter becomes a pack/group target, not a feature target. Generated code captures the importing pack
ID and derives available names/value types from its definitions and declared dependency contracts.
Namespacing itself needs only the pack ID; generation supplies the checked names and typed handles.

A pack group or feature definition can opt into owner-only mutation:

```json
{
  "access": "owner",
  "schema": { "type": "object", "additionalProperties": false },
  "defaults": {}
}
```

`access` is definition metadata, outside the value schema. Allowed values are `shared` and `owner`;
omission means `shared`. Reads remain available to declared dependents in both cases. `owner` restricts
write/reset to the owning pack and trusted host settings operations, including the Settings UI. Restrict
whole definitions only; do not add field permissions, explicit grants or another permission subsystem.
This policy covers pack/feature contributions; it does not let packs declare ownership or access policy
for host app settings. Keep app access governed by the host's SDK contract.

Generated dependency handles for owner-only definitions expose reads/subscriptions, without write/reset;
owner handles remain writable. Represent this through the common handle contract's access capability,
not a second implementation of the settings store. The host writer also checks the current declaration
on every mutation, so stale generated code or an untyped request cannot bypass a restriction. A changed
access policy is a changed dependency contract and must be reflected in generated types and diagnostics.

Enforcement requires a trustworthy caller context, separate from `SettingsTarget`. Audit backend service
binding and frontend transport before implementation; bind the caller at the host execution boundary,
and never trust a payload's claimed pack ID. If the current shared service cannot identify its caller,
refactor that binding before claiming owner-only restrictions work. Generated readonly access alone is
an authoring guard. In-process packs remain trusted JavaScript, so this is API enforcement, not isolation
from malicious code; the declaration grants no secrecy to readable settings.

Backend implementation uses a runtime-local generated service binding, with no claimed caller ID.
The generated registration carries `bindSettings`; the registry obtains a scoped service from its host
composition's `settingsForPack(acceptedPackId)` callback and records the returned revocation alongside
other contribution cleanup. Before binding and after revocation, retained generated handles refuse
settings operations. Revocation removes their subscriptions. Admission or catalog-publication failure
must not leave settings authority behind. Native/content-only registrations without a generated service
binding receive no injected capability; they cannot acquire one by omitting the hook.

Handle construction is permitted during module initialization. Generated settings and services import
one independent binding module, which imports no feature services and therefore avoids their import
cycle. A predeclared handle belongs to that pending binding; first acceptance enables operations, and
revocation permanently ends them. Rebinding supplies a fresh lifetime for newly constructed handles,
never authority for retained handles. Runtime owners release registrations before closing a reusable
test/app instance; closing its database or unbinding the ambient SDK alone is not pack teardown.

This backend mechanism does not establish frontend caller identity. Frontend transport and generated
frontend access must receive their own host-bound caller port before owner-only enforcement is complete.

Generated frontend modules now create a runtime-local `_createFeSettings()` binding and expose its
`bindSettings` hook on the generated frontend entry. App, feature and group composables read and mutate the
injected port; they do not reach the ambient window administrator. A handle captures the binding that
created it, so reaccepting a browser-cached module cannot reactivate a handle retained from its prior
registration. Revocation stops every subscription, remains idempotent and refuses retained mutations.

After declaration acceptance, the frontend loader asks its host I/O for a `FrontendSettingsBinding`
(port plus disposal). The registry owns that resource and records both generated revocation and transport
cleanup in its existing contribution undo log. Refused registrations release provisional resources;
missing providers refuse generated frontends rather than fall back to administrative access. The renderer
now supplies this resource using API-issued pack credentials; the hook and loader protocol alone remain
insufficient evidence for frontend authorization or app acceptance.
Neither a transport payload nor a display `from`/`sender` label is an authority source.

Frontend transport audit: `bus.send` verifies that a sender is addressable and stamps its connection,
but accepts `from` and `sender` as routing labels. `packClientReady` is a readiness notification and does
not establish caller identity. Do not authorize a settings mutation from any of those labels.

Use a host-issued settings credential attached outside the event payload at API ingress, scoped to its
connection and accepted runtime instance. Pack issuance verifies pack ID, declaration revision and
build revision against the accepted backend origin; missing stamps, replacement, unload and connection
closure invalidate access. Host window/tool setup receives a separate administrative credential. The
host resolves credentials to its existing scoped settings service or administration, retaining the bus's
`call`/`answering` mechanism. Raw `bus.send` settings mutations without valid access must be refused;
pack credentials must not reach whole-document administration. Keep credentials out of event logs,
snapshots and public SDK state. Host bootstrap remains trusted; this does not claim to isolate arbitrary
JavaScript executing in the same renderer.

The `createSettingsAccess` host component implements issuance/resolution/revocation, including separate
administrative and pack service types. API ingress now resolves the credential, removes it from the bus
envelope and binds a host-side resolver to the event. The bus preserves that resolver when attaching
correlation; the settings actor resolves it again at delivery. A request queued before unload cannot
retain authority from the earlier ingress check. Connection cleanup is registered once per socket's
abort signal, including when procedures receive separate context objects.

The window resource can bind a pack mutation transport while sharing its validated read snapshot.
Each accepted binding owns its pending requests and subscriptions. Unload or disconnect disposes it;
reconnection never revives old handles. Host writes remain independent. The injected transport, rather
than shared routing labels, selects the credential. A test through the actual router, bus, actor and store
proves this separation; replacing the pack transport with the administrative one makes that test fail.
Its native test declarations and synthetic accepted origins do not prove installed-loader admission.

Renderer bootstrap now waits for both host access and a validated correlated snapshot before announcing
the connection to the shell. The loader provider obtains a separate pack credential using the backend's
accepted declaration and build identities, and releases it when registration is refused or unloaded.
Native app reset uses an explicit window administration operation rather than raw bus labels. Generic
frontend sends do not borrow that authority.

Ambient `updateSettings` and `resetSettings` exports have been removed. Shipped pack components mutate
through generated handles; host forms explicitly inject the administrative writer into
`useSettingsSave(writer)`. That tracker never obtains authority from the ambient window binding.
Log controls wait for accepted host notifications instead of optimistically modifying actor settings.

Completion still requires catalog-driven custom forms and real app/packaged acceptance. A controller or
transport test alone is insufficient evidence.

Reconnect includes frontend reacceptance. The shell unloads the connection's frontends and stops their
surface actors using its existing unload lifecycle. A load interrupted by disconnect remains the only
running loader; its late registrations are undone and not announced, then a queued fresh run starts after
it settles. No run starts while disconnected. The selected feature is restored after acceptance if it
still exists. Revoked handles remain revoked. Backend origin replacement must likewise require
acceptance of the current declaration/build rather than renewing a credential from stale metadata.
Validate these contracts in the real app too; mocked transport and shell tests alone do not prove it.

Confining arbitrary pack code and enforcing resource grants belongs to the separate
[pack security isolation goal](../../goals/goal-pack-security-isolation.md), not this settings extraction.
That goal preserves this plan's shared-by-default collaboration policy while closing ambient bypasses.

Route targeted writes/resets and whole-document replacement through the same policy. A bulk replacement
must check every changed owner before committing; unchanged restricted values must not reject unrelated
edits. Keep raw override removal, migrations, backup import and whole-document reset in explicit trusted
host operations so a low-level method or target omission cannot bypass owner-only policy. Refused writes
leave values and notifications unchanged; allowed cross-pack writes use normal validation, correlation
and live change delivery to the affected owner.

Shared access permits editing preferences. Use the owner's public commands/services for operations with
domain behavior or lifecycle effects rather than exposing those effects as writable settings fields.

## Service and frontend boundary

```text
Host app definitions + discovered pack/feature definitions + stored overrides
                                      |
                         Host settings service
                             /                \
                 Backend consumers       Window settings runtime
                                              /              \
                                    Frontend consumers     Settings forms
```

Keep the existing backend store as the authority. A window-level settings runtime starts with the
application, independently of Settings surface activation. It receives snapshots/changes, handles
reconnect and replacement, and serves the SDK frontend port. The Settings view subscribes like any
other consumer; it owns navigation and local editing state, not the shared data source.

Expose readiness explicitly so initial loading is distinguishable from a missing declaration. Preserve
subscription cleanup and immutable reads. Saves and resets return a result tied to the request; one
form's refusal or acknowledgement must not mark an unrelated form saved. Reuse the bus envelope's existing
`call`/`answering` correlation instead of inventing settings-specific request IDs. Handle disconnection and
disposal without leaving callers waiting forever. An acknowledgement is not a substitute for the snapshot
of effective values: request outcomes and data updates have separate purposes.

The snapshot needs a monotonic data revision within a backend run, distinct from the current defaults
revision. Reconnection requests a fresh snapshot and establishes a new run before accepting updates;
import/replacement publishes a complete snapshot. Reuse transport/events rather than introduce a second
store or poll through the Settings view. Snapshot admission validates JSON shape, nonnegative safe
revisions, declaration ownership and all effective values through the shared settings schemas. It must
not fill a missing effective value from defaults. A malformed initial read ends disconnected; a malformed
broadcast retains the accepted snapshot. Changed declarations require a catalog revision; changed values
or replacement status require a value or catalog revision. Failed subscribers cannot interrupt other
forms or leave requests pending. Malformed refusals and unserializable writes terminate explicitly.

Pure document and catalog validation live beside the settings feature's backend/frontend halves. The
frontend entry exports those pure operations directly, never through the backend persistence barrel;
verify the browser build and guard its runtime closure against Node-only imports.

Whole-array editors such as Projects must detect that the value
changed since their draft began and refuse an accidental overwrite while retaining the draft. Correlated
replies alone do not solve stale writes. Implement that check at the writer for the replaced value; do not
reject an edit merely because an unrelated preference changed.

Defaults remain underneath stored overrides. Reset removes overrides and uses current defaults; it
never persists a copy of defaults. Descriptor validation checks the complete candidate before catalog publication; a rejected candidate
leaves the previous definitions and stored overrides unchanged. Activation cannot redefine those
defaults. Objects merge recursively; arrays and scalar values
replace, including empty arrays and permitted null. An empty object overlays defaults; it does not
clear a default object. A declaration that needs a disabled/cleared value must represent one explicitly
(for example permitted null), not rely on deletion of a default. The same composition applies to every owner.

Installed inline pack declarations can supply defaults and validation while a pack is disabled without
executing it. Build the pack preference catalog from those declarations; runtime registration must agree
with them. Source development produces the same validated descriptor through the build pipeline. A missing or
stale descriptor is an explicit incomplete/stale result, never a reason to discover defaults from runtime registration.
Disabling a pack removes its running behavior/form availability, not its data-only preference contract.
Uninstalling removes its declarations but preserves stored overrides for reinstall.

Apply that installed declaration behavior to feature preferences too once their schemas are data.
Disabled packs' feature and pack preferences remain readable and validated without executing their runtime.
Custom forms may be unavailable while the pack frontend is disabled; the advanced editor still uses the
installed schema. Missing or incompatible declarations do not authorize unvalidated writes: preserve
orphaned overrides and expose their unavailable status. No permanent app/pack/feature validation asymmetry
remains after conversion.

## Preferences, state and projects

Move assistant `name` to default-setup's pack settings. Onboarding is an existing workflow, not a new
assistant feature. Its completion is the host's `AppState.hasOnboarded`; its progress is already persisted
in the onboarding thread's context. A preferences reset must leave both intact. A deliberate whole-app
data reset remains separate.

### Onboarding design correction (2026-10-12)

The uncommitted assistant feature/actor/entity draft was rejected and removed from the working tree.
Its manifest entries, source, tests and facade changes were removed and bindings regenerated. Registering a backend actor through a feature is a
framework mechanism, not a reason to introduce a product capability. A settings group does not imply a
feature, system, event address or entity. Moving the same onboarding-specific branches into Brain would
relocate the coupling rather than resolve it.

The audited old `assistant.birthdate` is written before sending an initialization request; it does not
prove a flow started, and no audited product view displays it as assistant identity. Remove it from
preferences without inventing a replacement field or entity to preserve obsolete semantics. Current
onboarding needs only the existing host completion fact and the existing thread's workflow progress.
A new lifecycle fact requires a current behavioral consumer, not a historical field to accommodate.

Responsibility is explicit:

| Concern | Owner | Required behavior |
|---|---|---|
| Assistant display name | Default-setup pack settings group | Ordinary editable/resettable preference |
| App onboarding completion | Host AppState | Survive preference resets; no settings writer can change them |
| Onboarding steps, eligibility and conversation | Default-setup's authored workflow/actions | Reuse the existing thread and progress; no duplicate progress store |
| Root flow availability, pause/stop/restart and delivery | Existing flow runtime | Generic lifecycle facts; no hardcoded onboarding/provider policy in Brain |

The current onboarding actions use CLI discovery/import and do not require inference-provider keys.
The old OpenAI/Anthropic secret-change gate is not a requirement to preserve. Do not create a replacement
actor or carry that gate forward unless a concrete current consumer needs it.

Before modifying startup behavior, specify and exercise the real event sequence for: connection before
and after root startup, two windows, reconnect, paused/stopped Brain, restart, pack reload, preferences
reset, and backup restore. A root run must receive sufficient generic client-readiness information for
its authored workflow to start once or resume. Whether the existing lifecycle machinery can express this
without extension is still unproven; inspect it before adding an event or flag. A request sent to a stopped
Brain is not successful delivery and must not consume a deduplication guard. Restore deliberately stops
Brain today; preserve that explicit restart policy until a separate product decision changes it.

The behavioral contract to prove is:

| Sequence | Required outcome |
|---|---|
| Client attaches before a root can run | Wait for real readiness; no successful-delivery flag or new initialization fact |
| Root is ready before a client attaches | The authored workflow can initialize after the client becomes available |
| Second window or reconnect in the same root run | Reuse the current workflow/progress; no second onboarding run |
| Root is paused | Respect runtime queue/pause semantics; do not mistake a queued event for executed onboarding |
| Root is stopped or replaced | No onboarding execution in the stopped run; discard stale delivery work |
| Root restarts with a client already attached | Supply current client availability to the new run; reuse unfinished progress |
| Preferences reset | Defaults change; onboarding facts, progress and current run stay intact |
| Backup restore | Restore facts/progress, stop the old run, and await the existing explicit restart policy |
| Whole-app reset | Clear user data; a fresh root/client sequence can begin onboarding again |

This table fixes behavior before mechanism. A small real-runtime probe must show whether existing lifecycle
facts suffice and exactly where replay/deduplication belongs. Do not add generic hooks or singleton-flow
machinery merely because they look reusable; add only what these sequences demonstrate is missing.

The draft's mocked restore test concealed this failure. Acceptance must use the real root and onboarding
flow, inspect actual execution/progress, and prove another connection cannot spawn a second onboarding
run. A passing broad chain is regression evidence, not proof of this design. Pack app-line migration
catch-up when a pack was absent during an upgrade remains required by the replacement work.

### Projects audit: keep `app.projects` as configured directory bookmarks

The current shape is `{ name, directories, color }[]`. Array order controls display and the fallback
working directory; directory order makes the first entry primary. There is no Project entity, stored
project ID, project relation or independent lifecycle in the audited declarations and consumers.

- [Projects.vue](../../../packages/renderer/src/views/settings/canvas/components/GeneralSettings/Projects.vue)
  and Code's [useProjectActions.ts](https://github.com/spankyed/apack/blob/18d8a47b19495498f5a4bf52b41dae684c6efc12/packages/default-setup/src/features/code/fe/features/explorer/composables/useProjectActions.ts)
  create, rename, reorder and remove entries and write
  the complete array. Code sometimes removes an entry when its final directory is removed.
- [Code startup](https://github.com/spankyed/apack/blob/18d8a47b19495498f5a4bf52b41dae684c6efc12/packages/default-setup/src/features/code/be/system.ts) picks the first configured
  directory when no explicit/current directory wins.
- Threads menus, project-select blocks and Claude Code/Codex actions select directory paths. The
  [project-select block](https://github.com/spankyed/apack/blob/18d8a47b19495498f5a4bf52b41dae684c6efc12/packages/default-setup/src/extensions/blocks/input/ProjectSelectInput.vue)
  submits a path, not a project reference.
- Onboarding writes the configured list and sets Code's default directory separately. Its import actions
  use the directories to find sessions; project artifacts display the same configuration.

Decision: migrate `general.projects` to `app.projects`, default `[]`, with one SDK type and host validator.
Keep the current ordered array and path-based consumers; a project repository or stable IDs would add
an identity contract no caller currently needs. Revisit when persistent resources reference a project
independently of its directories, not because the UI calls the bookmark a project.

Validate structural types and new edits consistently, including nonempty directory strings and duplicate
directory policy. Establish that policy from current intended behavior: the form rejects duplicates,
while Code's direct add does not. Imports must satisfy the same current schema as ordinary writes.
Do not require paths to exist during import or normalize symlinks/case by guessing filesystem identity.
Resetting this configuration clears the bookmarks; it does not delete directories, threads or repositories.

Two existing editing problems belong in the extraction: `Projects.vue` holds the incoming array directly,
so nested edits mutate its authoritative snapshot before save, and its debounce timer has no disposal
cleanup. Use the SDK draft helper, clean up the timer, and keep refused drafts visible. Whole-array writes
also need the stale-value check described above. Secrets remain in the secrets service.

## Schema prototype evidence (2026-10-12)

The implementation accounts below describe individual historical checkpoints, not the current tree.
Their unfinished-work lists and transitional APIs are superseded by later integration evidence and
the no-compatibility decision. The removal/ownership contract above remains authoritative.

A disposable probe at `/private/tmp/apack-settings-schema-prototype` used Ajv 8.20.0 and
json-schema-to-typescript 15.0.4. It passed optional fields, nullable values, enums, integer ranges,
records, arrays and document-local references, including strict TypeScript checks of generated types.
Validation left both valid and invalid input unchanged, did not populate schema `default` annotations,
and refused missing remote references. The generator disabled file and HTTP reference resolution.

This establishes tool suitability, not delivery: declare production dependencies, add focused contract
specs and wire validation and generation into the pack build before migrating settings readers. Trusted
caller binding, catalog publication and custom-form loading still require implementation.

### Implemented contract kernel

The SDK now carries `SettingsDefinition` / `SettingsSchema` data types, a host/build-only validator and
a build-only declaration generator. Settings schemas explicitly declare `type: "object"` at the root;
nested shapes support ordinary draft-07 validation. References use `#` or document-local JSON Pointers.
Remote/file references, named anchors, nested `$id` bases, custom keywords and `$async` are refused.
The validator also refuses non-JSON values, including explicit `undefined`, without changing input.
Repeated objects are valid; actual cycles and sparse array holes are refused. This validates data,
rather than substituting strings or dropping fields as the logging/transport serializers do.

Generation keeps optionality, nullable values, enums, records, arrays and local definitions. Schema
`title` remains presentation metadata; a cloned schema uses the requested generated export name, so a
heading cannot rename the author-facing type. Numeric and other constraints remain runtime checks.
Focused specs typecheck generated declarations and invalid-use examples; defaults and external-reference
guard mutations are caught. At this checkpoint, full catalog/build integration, trusted caller binding
and feature declaration replacement remained unfinished; the kernel did not switch production readers.

Bundled CLI/testing packages also declare Ajv 8 directly: their bundles inline SDK code but externalize
Ajv, so checkout execution must resolve the same major as the published dependency metadata, rather
than the unrelated tooling's root Ajv 6. The strict checkpoint chain passed serially; concurrent native
app scenarios had Electron teardown timeouts after passing their assertions, and isolated retries passed.

### Implemented pack declarations and catalog prototype

`extensions.settings` now accepts inline `SettingsDefinition` data and runs the common compiler during
manifest/snapshot validation. Invalid defaults retain their exact owner/value paths through structured
errors; diagnostics do not infer fields from error prose. The generated editor schema references the
draft-07 meta-schema for the inline value schema. Explicit defaults remain authoritative.

The host's `createContributionCatalog` owns immutable validated snapshots, host-supplied app definitions
and enablement independent of activation. Its pack-settings projection reads the snapshot directly;
there is no second defaults inventory. Same-named groups remain pack-local. Publication validates the
whole candidate before replacing the revision/map; failure retains the previous catalog and sends no
notification. Readers receive readonly views, and a throwing subscriber cannot undo publication or
prevent later subscribers from observing it. A poisoned installed runtime still yields its settings data.

Pack code generation now awaits the maintained schema compiler and exports `PackGroupSettings` from
the pack facade. Each group's generated value type uses its schema, preserving optional fields and
local references; referenced type names are isolated between groups. `generatePackFiles` returns one
Promise contract, and CLI generation retains its lock through settlement. Validation awaits generation
without writing files. Pack group access handles, policy enforcement and feature conversion remain
separate requirements; exporting group types alone does not implement access.

This is the foundation prototype, not the completed runtime integration. Production boot does not yet
populate the catalog; host preference extraction, feature declaration conversion, typed group handles,
trusted caller binding, access enforcement, form bindings and stored-data migration remain required.
Do not switch the writer until those contracts and staging/source freshness checks are in place.

### Implemented feature declarations

All 11 shipped feature schemas now declare JSON Schema and explicit defaults directly in `apack.json`.
The conversion audit compared 844 probes against the previous effective-value schemas, covering defaults,
required and optional fields, nested strict objects, records, arrays, enums, nullability and numeric bounds.
No transforms or refinements needed a domain replacement. Default wrappers were removed from the audit's
output schemas; merging the explicit baseline remains the settings store's responsibility. No conversion
adapter or executable feature-settings authoring API remains.

Feature navigation defaults now live in `surface.defaultVisible`; a surface with no configurable values
needs no settings declaration. This is distinct from `surface.default`, which claims startup selection.
Generated feature values use the maintained schema compiler, isolated per feature, and backend registrations
embed declaration data. The registry compiles validators once on registration; the shared writer preserves
unchanged invalid values after a declaration change but refuses new invalid values, including explicit
undefined writes to optional fields. Generated setter value types exclude undefined.
Validators own a copy of the schema, including large enum arrays retained by Ajv. Generated registrations
decode JSON data rather than emitting object literals, preserving own `__proto__` fields. Mutation checks
cover both protections and the refusal of non-JSON writes.

The common catalog now projects feature definitions by qualified ref, including disabled packs, without
loading their runtime. Its production wiring, pack group handles, trusted caller
policies, forms and stored-document migration remain unfinished. Current registration-driven defaults are
still transitional; discovery metadata does not imply an activated actor or a bound custom form.

## Implemented host app ownership

The host now declares `app.hotkeys`, `app.personal` and ordered `app.projects` in
`packages/apack-host/src/features/settings/be/app-definition.ts`. The common schema compiler validates
its baseline and writes; `scripts/app-settings-types.ts` generates the public SDK value types, with a
parity spec preventing drift. Default-setup no longer supplies app values. Active app consumers and
custom forms read the new location; the host supplies defaults even with no pack registered. Pack root
sections cannot claim `app`. Section access is still transitional until owner-bound handles are wired.

**Historical implementation evidence, superseded by the no-compatibility decision below.** The
following migration and invalid-value exemptions describe committed code to remove, not the target
contract. Host ownership and current-format editing/lifecycle behavior remain required.

The host's stored 0.4.0 migration moves raw known overrides, unwraps the legacy projects wrapper,
preserves order and destination overrides, and leaves unknown/orphan data intact. Copied 0.3.14 app
defaults are pruned against a historical baseline, not current defaults. Real boot and backup-import
checks exercise migration before subsequent validated edits. The existing legacy `internal` cleanup is
still default-setup's responsibility; its lifecycle extraction remains required.

Validation now exempts an unchanged invalid field only when the same problem already existed in the
previous effective values. Comparing two absent field reads alone accidentally admitted new objects
missing required fields; regression checks cover app projects and feature arrays. Reset can remove an
existing orphan section field without permitting new writes to an undeclared section. Projects forms
copy incoming arrays and directory arrays before editing, tolerate a restored missing directories field,
and cancel pending debounce timers when disposed. Window-owned requests/subscriptions, the other forms
and CAS/stale array protection remain required.

Assistant pack-group declarations, typed handles, trusted policies, catalog-fed defaults and window
runtime/product composition are unfinished. This checkpoint does not establish the complete three-owner
document or claim discovery without activation for all settings consumers.

## Architectural review findings (2026-10-12)

These are current-code findings, not a completed review of the whole PR:

| Finding | Evidence | Required correction |
|---|---|---|
| Old-format migration complexity | Host `migrations/app/0.4.0.ts` addresses old `surfaces` keys; the draft proposed additional unresolved-key storage | No users require this compatibility contract. Remove old-format accommodation from the settings redesign rather than adding a migration-data store. Current-format overrides for temporarily unavailable packs remain a separate, supported lifecycle requirement. |
| Disabled declarations do not supply the live validators | `features/settings/be/store.ts` obtains validators from `getPackSettingsDefaults`; registry populates that store during runtime registration | Compile definitions from the accepted installed catalog. Enablement/activation may remove behavior and custom forms, not defaults, validation or override access. |
| Pack section defaults still have silent global collisions | `packs/backend-extensions.ts` merges thunk results through `sections[name] = value` | Remove the thunk/global root-section contract when pack groups and consumers switch together. Qualified pack/group identity prevents two packs' `assistant` groups from overwriting one another. |
| Catalog has no production reader | `createContributionCatalog` is exported and called by catalog specs only | Prove production boot/install/disable/refresh wiring and the same accepted revision in writer/readers before claiming discovery. |
| Targeted and whole-document writes have different explicit-choice semantics | Targeted updates store a value; whole-document replacement computes `changesFrom(defaults, values)` | Settle import/advanced editor behavior explicitly. A user choice equal to today's default must not be erased accidentally; reset alone opts into future defaults. Do not infer an explicit choice from historical copied defaults in the normal writer. |

The next settings checkpoint must use one source of definitions for host, pack and feature values,
including disabled packs. It must demonstrate reads, trusted writes, restricted refusals, resets,
notifications and restored overrides in that running system. Tests of the prototype alone do not satisfy
this boundary. Retain the full discovery inventory and subsequent goal phases; this checkpoint establishes
the shared route that those consumers will use rather than replacing their requirements.

## Delivery sequence

These steps implement the shared-foundation and settings checkpoints in
[manifest maturity](manifest-maturity.md). Start with discovery’s full inventory, then deliver a settings
projection of the common catalog. Before any reader switches, that kind’s descriptor, generated bindings
and refresh path must agree. This does not require finishing other contribution kinds first.

1. **Prove the declaration and access contract.** The projects audit is complete above. Check the
   remaining app fields and assistant lifecycle gates, and audit every existing feature schema's
   constraints/defaults before conversion. Exercise the proposed draft-07 validator/type
   generator on small real declarations, finalize form loading and typed handles, and record the results
   here before changing runtime contracts. Inventory current SDK/service/transport/generated names against
   the naming contract, including value/handle selectors and the two update types. Keep generated types
   structural and validation authoritative. Audit trusted caller context for shared/owner access and
   settle the host caller binding before exposing restricted definitions. Establish the shared descriptor
   reader/validator and catalog projection, with checked settings/form binding and coherent source-build
   publication; extend these mechanisms as pack and feature declarations migrate.
2. **Establish app ownership and the target document.** Define SDK types and host defaults/validation;
   teach the existing engine the three owners. Remove default-setup's responsibility for built-in
   preferences. Update all owned consumers and fixtures to the current document in the same working change;
   do not add automatic old-format conversion to boot or import.
3. **Declare pack preferences and typed handles.** Replace the root `settingsSections` thunk with
   inline `extensions.settings` declarations;
   derive registration, types and qualified discovery from the manifest. Migrate default-setup assistant
   preferences and all in-tree consumers. Generate local/qualified selectors with shared mutation by
   default and owner-only readonly dependency handles; enforce policy at the host writer. Reuse custom
   feature forms and add pack form loading.
4. **Unify feature settings definitions.** Convert audited feature schemas/defaults to the common
   JSON Schema data declaration, update generated accessors and snapshots, and migrate all feature
   callers/tests. Retain custom forms and navigation metadata. Compare representative valid and invalid
   values against the old definitions, then remove the temporary Zod settings path.
5. **Separate preferences from existing onboarding state.** Remove the obsolete editable timestamp
   without adding a replacement historical field. Keep completion in AppState and progress in the existing
   onboarding record. Settle generic root/client readiness and authored workflow eligibility through the
   real event-sequence checks above; introduce no assistant feature and no onboarding policy in Brain.
   Remove the obsolete provider-key gate and Threads startup assumptions only with replacement behavior
   proved against actual flow execution.
6. **Make frontend access independent of the view.** Bind the frontend port to the window settings
   runtime; move reads, subscriptions and correlated writes there. Update the Settings view and SDK
   composables to consume that interface. Retain the draft helper for explicit custom-form editing.
7. **Finish the product surface and contracts.** Align navigation with app, pack and feature forms;
   compose the advanced editor schema for completion, descriptions and diagnostics, and update reset
   targets, templates, fixtures, schema/API reports and public docs.
   Apply the naming contract across SDK/service/transport APIs, generated files, forms, fixtures and docs.
   Remove old section accessors, overloaded selectors, duplicated types and inaccurate lazy/opaque-section
   prose. Delete default-setup's `app-settings` assembly and `content/default-settings.ts` as specified
   above; do not relocate them. Steps 2, 3, 6 and this contract cleanup form the integrated removal
   checkpoint while the old assembly is present. The existing host ownership and catalog prototypes are
   foundation evidence, not completion of that checkpoint.

Each step ends with a usable, validated implementation. Update consumers, tests, fixtures, templates
and docs together. No aliases, fallback reads, compatibility readers, invalid-value grandfathering or
old-format acceptance remain in the completed settings path.

## Existing developer data

There are no external users or packs to support. The lead developer's tested backup is an operational
input, not an architecture constraint. Normal boot, settings writes and imports accept the current
contract only. Do not add automatic conversion, guessed ownership, unresolved legacy storage or a new
lifecycle entity to accommodate the backup.

If retaining particular personal data requires conversion, first compare the actual backup with the
finished contract. A separately invoked, one-time operation on a copy may be warranted; it is not a
required runtime feature or a reason to preserve obsolete fields. Do not touch production data or
silently discard the backup. Existing migration infrastructure for future versioned changes remains a
separate concern; this redesign does not require supporting previous settings formats.

Current-format overrides survive pack disable/uninstall and export/import. That is supported lifecycle
behavior, not backwards compatibility: absence of a declaration does not rename or invalidate an
otherwise well-formed owner-qualified override.

## Evidence required to finish

- With default-setup disabled, built-in preferences, forms and shortcuts still work.
- Two external packs declare `assistant` and receive separate defaults, forms and overrides. Disabling
  either keeps both pack and feature preferences available and validated without executing its runtime.
- App, pack and feature settings share one schema contract. The feature conversion audit accounts for
  every previous constraint and default; representative acceptance/refusal behavior is preserved.
- The advanced JSON editor completes keys, shows descriptions and flags invalid values from the composed
  settings schema. Backend validation remains authoritative regardless of the editor or custom form used.
- Declarations reveal names/defaults without executing a runtime; invalid declarations fail before
  publication; rejected descriptors leave existing values and notifications unchanged. A runtime binding
  failure changes activation availability, not the committed settings definition.
- Generated handles infer optional fields and representable alternatives, reject structurally incorrect
  updates, and resolve owners without arbitrary root paths. Runtime validation rejects invalid ranges,
  patterns and unsupported fields. Defaults/nullable values/reset follow the documented composition.
- A field explicitly set to today's default keeps that choice when the default changes; resetting the
  field follows the new default. Empty arrays replace arrays; empty objects inherit default fields;
  permitted null remains a value. All three owners behave consistently.
- A frontend consumer reads and observes settings before opening Settings, after closing it, and across
  reconnection. Concurrent saves/refusals reach the correct caller.
- Custom forms keep detached drafts, save explicitly, and reflect resets and imported data. Projects
  edits cannot mutate the source snapshot; disposal clears pending debounce work. A stale array save
  cannot erase another writer's edit and does not lose the refused draft.
- Reset restores current defaults without clearing app onboarding facts or workflow progress, or restarting onboarding.
- Current-format export/import preserves personal details, shortcuts, projects, pack and feature
  overrides, host completion and workflow progress. Obsolete shapes are refused explicitly; no runtime
  compatibility branch, historical timestamp destination or invalid-value exemption remains.
- Removing/reinstalling a pack preserves its overrides; unrelated owners remain unchanged.
- Definitions, defaults, overrides, effective values and snapshots have distinct contracts. Backend and
  frontend selectors return handles consistently, all write/reset targets use explicit owner IDs, and
  changing a category title does not change storage identity. No old section APIs or naming aliases remain.
- Two packs with the same local feature/group ID resolve bare selectors to their own definitions.
  Qualified declared-dependency selectors infer the dependency's values and allow read/write/reset by
  default; unknown or undeclared dependency targets are refused through the pack-facing boundary.
- Owner-only definitions remain readable to dependents, but generated dependent handles reject mutation
  at compile time and the host refuses untyped/stale write/reset requests. The owner and trusted host
  Settings UI can mutate them. Payloads cannot acquire authority by naming another caller pack.
- Cross-pack mutations notify the affected owner's consumers through the existing settings path.
  Restricted bulk/reset operations are checked before commitment, unchanged restricted values survive
  unrelated edits, and refused operations publish no partial changes. Trusted migration/import operations
  preserve overrides without exposing a pack-facing policy bypass.

Run focused meaningful specs at each boundary, then regenerate `apack.schema.json` and SDK API reports,
inspect the diffs, run `npm run chain`, and exercise the affected settings/onboarding flows through targeted
app tests. Check the snapshot-format contract under the existing repository rule before deciding whether
its current unreleased format needs a bump. Do not bump release versions.

## Research and reasons for the shape

These sources validate mechanisms, not a requirement to reproduce another product's architecture.

- [VS Code configuration contributions](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)
  separate declared properties from category titles and runtime access. That supports separating owner,
  display group and implementation; it does not require apack to use global dotted names or add scopes.
- [JSON Schema annotations](https://json-schema.org/understanding-json-schema/reference/annotations)
  treat defaults as metadata. This is why the explicit baseline is composed before validation.
- [Ajv schema versions](https://ajv.js.org/json-schema.html) and
  [data modification options](https://ajv.js.org/guide/modifying-data.html) support draft-07 and expose
  coercion/default insertion as modifying behavior. Use pure validation for settings writes.
- [Zod JSON Schema support](https://zod.dev/json-schema) describes conversion in Zod 4 and marks
  conversion from JSON Schema experimental. This favors direct JSON Schema settings declarations over
  upgrading Zod or relying on an automatic conversion pipeline. Existing feature constraints need an audit.
- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript) documents structural
  generation and constraints TypeScript cannot express. A generated facade improves authoring; it
  cannot replace validation.

A read-only design experiment used the already installed tooling copy of Ajv 8 with data modification
disabled. It accepted a baseline with an absent optional field and an explicit nullable field, rejected
an invalid enum, a non-object project and an undeclared field, and left all five inputs unchanged. This
checks the proposed validation behavior, not the dependency packaging or generated type facade. The
type-generation and custom-form loading checkpoints remain required before implementation commits.

Ownership (`app`, pack, feature) is distinct from storage scope (user, workspace, profile). Keep the
existing single app-data context and do not introduce scope precedence to mirror VS Code. Nested
`packs[packId][group]` and ref-keyed `features[ref]` intentionally reflect the identities already used
by apack; changing feature storage solely for visual symmetry offers no corresponding behavior benefit.

## Scope

Finish ownership, declarations, typed access, frontend service extraction, custom-form integration and
the current stored-document contract and common JSON Schema definitions together. Retain the persistence engine,
feature ownership and custom forms. Do not
add generated forms, preference scopes/profiles, general lazy activation, a generic registry framework,
or project-domain functionality unsupported by the audit.

### Current-contract writer and historical conversion cleanup (2026-10-12)

Removed the prior-problem comparison and unchanged-section bypass from the working writer. Available
app/feature schemas validate the complete candidate; unchanged invalid values are no longer exempt.
Refused writes publish neither stored changes nor notifications. An invalid slice can be replaced or
reset to produce a valid candidate. Owner-qualified unchanged overrides whose declaration is unavailable
remain supported lifecycle data, distinct from obsolete root sections.

Focused settings checks passed: 72 tests across seven files. The strict chain stopped at host unit checks
with two failures (3,892 tests passed): `upgrade-from-0.3.14.spec.ts` and the old-backup conversion case
in `host-data-services.spec.ts`. Both depend on automatic historical conversion and demonstrate that
writer cleanup and old conversion removal must land coherently. Do not restore exemptions to pass them.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-12T18-55-47Z-4254`.

Removed obsolete host/pack conversions, their historical helpers/default snapshots and conversion-only
tests. Default-setup declares no migrations; host app startup has no historical conversion branch or
empty migration scaffold. Existing pack app/pack-line runners and their failure/version tests remain.
The replacement real backup test restores current app preferences, onboarding completion and unavailable
feature overrides, permits a later valid edit and restores the same backup again. Updated runtime guides,
public settings prose and affected deferred plans to remove instructions for deleted migration helpers.

Focused host settings/runner/lifecycle checks passed (81); real API backup checks passed (7). The first
API attempt lost its sandboxed worker IPC channel; the elevated run and strict chain passed. Strict
validation passed in 351.5s (six cached steps), including full host/pack unit suites, integration,
external-pack contract/app, smoke and packaged authoring/app checks. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-12T19-03-47Z-16723`.

This checkpoint does not establish full import preflight validation: the raw database importer still
restores rows before consumers use the settings writer. Integrate current-contract preflight with the
common installed catalog and preserve atomic refusal rather than adding format conversion or validating
after replacing the live database. Catalog-fed validators, pack handles, onboarding readiness and the
complete three-owner route remain unfinished.

### Real onboarding runtime audit (2026-10-12)

Six isolated characterization probes compiled the shipped actions and executed the real Onboarding
Flow against a small root flow. They used actual Brain/Threads actors, repositories, persisted thread
progress and workflow traces; no receiver or initialization action was mocked. The first run used an
incorrect `undefined` assertion for a repository returning `null`; corrected probes all passed.
The temporary tests are not retained as regressions asserting broken behavior. Raw execution evidence
is `/private/tmp/apack-onboarding-probes.log`; sources were retained outside the checkout for diagnosis.

| Probe | Observed behavior | Design consequence |
|---|---|---|
| Root ready, first connection, reconnect | One initialized onboarding thread and one child workflow; later connections do not create another | Preserve behavior, replace the module flag with root-run readiness delivery |
| Client before root | Timestamp written with no workflow execution; creating/starting a root and reconnecting still creates no thread | Do not consume a guard or write a lifecycle fact before execution; starting a later root must observe existing readiness |
| Paused root, then connection/resume | No thread before resume; timestamp already written; queued event executes on resume | Retain existing runtime pause/queue behavior, remove timestamp authority |
| `DATA_REPLACED`, explicit restart, reconnect | Old actors stop; existing welcome progress remains; new root has no onboarding child | Replay readiness into the new run and resume from existing thread progress |
| Completed host onboarding | No thread created | Workflow eligibility reads host completion, not settings or provider keys |
| Explicit second initialization request | Same thread/progress, but two live onboarding workflow actors | Idempotent thread creation is not workflow deduplication; remove repeated startup requests |
| Authored root entry before any client | Thread/progress initialized without keys; no Threads frontend sends delivered; after connection only startup state arrives, without `LOAD_CHAT_THREAD` | Root-entry initialization alone loses presentation effects; the bus drops pre-client output rather than buffering it |

The replacement probe delivers the real data-replacement fact without importing a different database.
Repeated `connect()` exercises event sequencing, not two actual renderer windows. These probes establish
runtime behavior and the missing delivery contract; real restore, reload and multi-window acceptance
still belong to the implementation checks.

**Selected boundary:** expose first frontend readiness to the authored root as a generic flow event,
`client.ready`, once per root run. This means the pack's frontend has become available to that backend
runtime, not that a particular connection remains live. The existing bus/Brain only remember that a
client has been seen; do not claim current connection presence or invent disconnect tracking.

A first client arriving at a running root delivers this event. A client arriving while there is no
usable root updates readiness without consuming a delivery; a later start/restart delivers the same
readiness to that new root. A root stopped by replacement stays stopped until explicitly restarted.
Repeated connection in one run emits no second readiness event. Pause respects the existing event queue;
stopped/replaced runs do not receive delayed work from the prior run. Use the existing readiness fact
and root lifecycle, with real ordering tests; do not add a durable delivery flag, another actor, a
singleton-flow registry or a second progress record.

The default root's authored listener checks host onboarding completion, then starts/resumes the existing
Onboarding Flow. Its initialization action retains thread/progress reuse. A custom root that does not
listen must not start onboarding. Remove Threads' startup/provider branches, `BIRTH_FLOW_START`, the
module guard, `assistant.birthdate` and the obsolete provider list together. The generic Brain path must
never inspect onboarding state, assistant settings or provider keys. No automatic compatibility behavior
or historical timestamp destination accompanies the removal.

Acceptance must assert actual workflow counts, creation/resumption, preserved progress, frontend thread
opening and lifecycle sequencing. A spy counting sent requests cannot establish delivery. Record the
flow event in public authoring docs; it does not change the manifest settings owner model or replace the
required catalog/handle/frontend-runtime work.

### Onboarding readiness implementation (2026-10-12)

Brain sends `client.ready` directly to the current root actor instance after its existing first-client
fact, and sends it to a new root when starting/restarting after readiness. No new actor, durable flag,
progress entity or timer cancellation registry is introduced. Delayed and paused work belongs to that
actor instance, so replacing it cannot deliver old readiness into the replacement. The authored root
runs `Check Onboarding` against host completion before spawning the existing onboarding workflow.
Threads no longer starts onboarding or handles provider changes; the module guard, birth-start event,
provider list and editable timestamp are removed. No historical field conversion accompanies removal.

Real workflow tests cover startup without keys, reconnect and actor counts, preferences reset, late root,
pause/resume, replacement followed by explicit restart, completion, custom-root opt-out and consecutive
restarts. A real LMDB export/import test runs installed pack code on the API bus: restore stops the old
root, preserves the same thread/progress and completion fact, and explicit restart opens the existing
thread once. Public flow docs, event facade and content snapshots were updated for the deliberate changes.
These backend checks do not substitute for actual multi-window rendering or pack-reload acceptance.

Focused settings/event/lifecycle checks passed (38), as did real API reset/restore checks (3) and content
checks (145). Removing the first-client guard produced three workflows; removing readiness replay lost
initialization when the root started late. Both temporary mutations failed their targeted assertions and
were restored. Strict validation initially caught an unused event payload rejected by XState's event
type; removing it fixed the contract. The final strict chain passed in 225.5s (16 cached), including the
external-pack app check, with unchanged smoke and packaged checks reused. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-12T19-35-10Z-62769`.

### Staged backup admission and trusted drive writes

Backup preflight must operate on the bytes that will be installed. `importDatabase` now stages a private
copy before reading the current settings contract and before entering the app's replacement scope. The
scope wraps file replacement, hydration and consumer notifications; rejected staging/validation leaves
live settings snapshots and lifecycle unchanged. The previous data is copied through LMDB snapshots for
rollback, with recovery files retained if restoration itself fails. No conversion or obsolete-format read
was introduced. Actual LMDB failure-path checks and real API repeated-restore/lifecycle checks pass; see the
execution goal's staged-backup evidence for commands and limits.

Trusted drive settings writes use an explicit credential-bearing transport. General bus sends cannot borrow
that authority. This closes a caller migration gap without changing the trust model: token-holding tools
already bootstrap host access, while pack-facing services remain bound to accepted pack identity.

### Source authoring admission

A source pack's unit harness runs generated modules before a bundle exists. It therefore admits a validated
source manifest explicitly into the same catalog, alongside checked dependency snapshots and native host
contributions. Source entries retain the full manifest and declaration revision and survive runtime registration
changes; they are not reconstructed from activated features or admitted by a missing-build fallback.
Generated content runtimes now carry a required declaration revision, like registrations. Source setup refuses
stale identities before starting its runtime, and source registration acceptance checks the catalog identity.
Data-only harness registrations carry the manifest's declared settings metadata without inventing actors.
Installed packs continue through verified build admission.

Declaration identity hashes canonical object keys recursively while preserving array order. Schema parsing
must not invalidate a generated identity merely by reordering keys. Rebuild outputs from the changed producer;
there is no alternate old hash or compatibility reader. Key-order invariance and genuine declaration changes
have focused regression coverage. Remaining all-kind discovery/binding admission still follows the discovery
plan; this source checkpoint does not claim that work complete.


### Repeated directory intents and native shutdown evidence (2026-10-13)

Concurrent restore acceptance captured the Code backend repeatedly receiving the same
`SET_BASE_DIRECTORY` after thread restoration. Each request recreates its repository/watcher and
refreshes child systems. The backup failure snapshot shows `exporting: true`, no response and an empty
metadata file; its API sample shows nearly all main-thread samples in `posix_spawn`, with all four
filesystem workers idle. This is concrete event-loop contention, not evidence of an LMDB copy failure.
Make directory selection idempotent while preserving an explicit navigation choice: remember a user's
selected directory even if already displayed, but rebuild repository/watcher and notify child systems
only when the effective directory changes. Verify both behaviors with the real Code system before
attributing the backup deadline failure to that correction.

Shutdown is a separate native issue. Electron emits `quit` and closes all windows while its main thread
continues a native `usleep` loop. A minimal app using this checkout's Electron and disposable profiles,
with no apack code, exits in all three no-window controls; two of three hidden-window runs retain the
same sampled shutdown loop. Our versions are Electron 37.2.4 and macOS 26.3.1. A similar
[upstream report](https://github.com/electron/electron/issues/52582) covers different Electron/macOS
versions and reports resolution after an OS update; that is supporting context, not proof of the exact
cause or a verified upgrade for this machine. Do not add self-kill logic or weaken teardown assertions
as a settings fix. Preserve samples, keep final lifecycle acceptance open and continue the architectural
work rather than rewriting settings to accommodate a native shutdown defect.


The Code correction is implemented: directory commands remember explicit navigation separately from
changing runtime directory state. An unchanged path retains its repository and watcher and sends no
child-system refresh. The real-system test verifies both resource identity and the first explicit choice
at the already displayed default directory. Removing the identity guard fails that regression; the
restored source passes all three directory checks.

Concurrent external app acceptance now passes all 21 main-fixture cases and the bundled fixture,
including backup restoration; captured smart-base requests fall from 96 to two in the compared runs.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T05-46-47Z-3566`. That concurrent run still
fails smoke/packaged worker teardown in the separately reproduced native quit loop. The unchanged
strict sequential chain passes (76.6s, 25 cached), evidence `2026-10-13T05-50-21Z-25389` in the same
runs directory. This does not establish deterministic native shutdown or close final lifecycle acceptance.

A further source audit found Code starts Git watchers through async actions and has no actor-stop
cleanup. Its service can finish async startup after the owner stops. Replace this with an actor-owned
watcher resource and prove directory handoff, stop-during-start and teardown against real watcher
lifetime. Do not use that cleanup as a claimed fix for the native hidden-window reproduction.


Watcher ownership implementation: one callback actor owns the Code instance's current watcher.
Directory changes send it the newly selected watcher/repository. It serializes close/start, skips
superseded pending selections and suppresses callbacks immediately on replacement or owner stop.
Cleanup waits for in-flight startup before closing the created handles; no late callback may refresh
stopped children. Remove the two async watcher actions and the unawaited close from directory assignment.
Verify deferred startup/close with controlled resources and verify actual Code stop closes real Git
watchers. This introduces no new feature or settings definition and makes no native quit claim.


The owned watcher resource is implemented. Directory handoff retires callbacks synchronously, aborts
in-flight filesystem preflight, waits for close/start settlement and skips superseded selections.
Actor stop uses the same cleanup. GitWatcherService requires a startup cancellation signal and creates
no handles after cancelled preflight. Closing retires both callbacks, clears timers and ignores deferred
repository-write completion; late ready events cannot mark a detached watcher active. Code's commit
child also owns its status/history debounce through an invoked callback actor, removing a timer that
previously sent events to a stopped actor. No feature, stored lifecycle field or compatibility layer is added.

Focused checks pass (12): controlled pending startup/close and failed-start recovery, actual cancellation
before handle creation, deferred write notification retirement, real Code stop and debounce cancellation.
Removing the startup or deferred-notification guard fails its regression; restored source passes.
The initial broad run caught the intended facade signature change and a test helper using an unsupported
Promise lib declaration. The facade is updated and the helper uses the repository's configured lib.
The first watcher spy observed a separate module namespace; the corrected probe instruments the shared
FSWatcher prototype and both guard mutations prove it observes the actual producer.

Strict sequential validation passes (232.3s, 16 cached), including integration and external app checks:
`node_modules/.cache/apack-chain/runs/2026-10-13T06-25-13Z-75617`.
The preceding concurrent run passes all 21 main external-app tests, including restore, and its bundled
UI assertion; only the bundled worker's native teardown times out. Evidence:
`2026-10-13T06-20-27Z-47998` in the same runs directory. Its unchanged standalone rerun passes. Neither
that pass nor resource cleanup resolves the independently reproduced native hidden-window quit loop.
All other discovery, navigation/boundary and supported-API work remains required.

### Explorer restoration intent correction (2026-10-14)

`82bca6529` closes the settings revision +1 observed during refused-write acceptance. Real app logs
showed Code's connected-directory notification echoed as SET_BASE_DIRECTORY during the refusal
window. Frontend restoration now hydrates the directory and lists files instead of issuing a user
selection. Explicit selection remains a command; the writer's default-equal override and revision
semantics are unchanged. Empty-directory reconnection clears stale explorer state. Three focused
cases, a restore-write mutation and the unchanged real-app revision assertion pass. The owning goal
records accepted full and committed-source strict evidence with watcher checkpoint `01eec3309`.
This corrects preference intent; native hidden-window shutdown observations remain a separate audit.
