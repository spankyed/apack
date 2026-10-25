# Features — Systems & Surfaces

A **feature** is the primary unit of pack functionality. It bundles a backend system (XState state machine), a frontend surface (sidebar tab with canvas/panel UI), settings, and services into a single declaration.

## Scaffolding

```bash
apack pack add feature bookmarks --description "Save and organize bookmarks." --label "Bookmarks" --icon "Bookmark"
```

| Flag | Default | Effect |
|---|---|---|
| `--description` | Required | Nonblank feature purpose |
| `--label <Label>` | derived from the name | The surface's display label in the manifest |
| `--icon <LucideIcon>` | `Box` | The Lucide icon declared in the manifest and imported by generated bindings |
| `--designation <role>` | none | Writes `"designation"`: the role the feature plays, which need not be its name |

The feature name is the feature id: it must match `^[a-z][a-zA-Z0-9]*$` (a lowercase letter, then letters and digits: `notes`, `calendarEvents`), because it becomes an identifier in generated code, and part of the feature's ref, `<packId>/<featureId>`.

This creates:

```
src/features/bookmarks/
  be/
    system.ts                    # Backend XState machine
    types.ts                     # Shared types
    repository/
      index.ts                   # bookmarksQueries / bookmarksCommands (declared in apack.json repositories)
  fe/
    surface.ts                    # Frontend surface definition
    state.ts                     # Frontend XState machine
    canvas/
      list.vue                   # Main view component
    settings.vue                 # Settings panel
tests/features/bookmarks/be/
  system.spec.ts                 # System test on @apackdev/testing/harness — a spec's path
                                 # mirrors the source it covers
```

It also adds the feature to `apack.json` and regenerates `__generated__/`. A pack without `tests/setup.ts` also gets the unit test setup the system test runs on: `tests/setup.ts`, `vitest.config.ts` when it has no Vitest config, and the test dev dependencies.

## Backend system

Every system is an XState state machine that communicates via a central event bus.

### Defining a system

```typescript
// src/features/bookmarks/be/contract.ts — the contract, which apack.json names at features.<id>.system.contract
import type { IncomingBookmarksEvents, OutgoingBookmarksEvents } from './types.ts';

export type Contract = {
  incoming: IncomingBookmarksEvents;
  outgoing: OutgoingBookmarksEvents;
};
```

```typescript
// src/features/bookmarks/be/types.ts — the events (SEND_STATE is the app's; no system declares it)
export type IncomingBookmarksEvents =
  | { type: 'CREATE_BOOKMARK'; url: string; title: string };

export type OutgoingBookmarksEvents =
  | { type: 'BOOKMARKS_CONNECTED'; data: BookmarkDTO[] }
  | { type: 'BOOKMARK_CREATED'; bookmark: BookmarkDTO };
```

```typescript
// src/features/bookmarks/be/system.ts
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
// broadcastToSurface is typed with the events each of this pack's surfaces receives
import { broadcastToSurface } from '#generated/events.ts';
import type { Contract } from './contract.ts';

// The spec types the machine from the same contract. Its identity is its feature's, from apack.json
export const bookmarksSpec = defineSystem<Contract>();

// Build the machine
export const bookmarksSystem = setup({
  types: bookmarksSpec.types,
  actions: {
    sendConnectedData: () => {
      broadcastToSurface('bookmarks', {
        type: 'BOOKMARKS_CONNECTED',
        data: [],
      });
    },
  },
}).createMachine({
  id: 'bookmarks',
  initial: 'idle',
  states: {
    idle: {
      on: {
        SEND_STATE: { actions: 'sendConnectedData' },
      },
    },
  },
});

// Default-export the entry — this is what the manifest loads. Nothing to annotate and nothing to
// `satisfies`: the events come from the contract, which apack.json names
const bookmarksEntry = {
  spec: bookmarksSpec,
  machine: bookmarksSystem,
};

export default bookmarksEntry;
```

`defineSystem<Contract>()` returns the spec. It takes no id: the system is its feature's, which the manifest names it under, and runs at the feature's ref, `<packId>/<featureId>`; code names it by the feature id (see below).

The build materializes each endpoint's event names into `eventContracts` in the snapshot. Systems record
`incoming` and `outgoing`; surface `receives` combines its own system's outgoing events with its declared
inbox. Shared SDK lifecycle events are implicit in both protocols. `apack pack info --json` exposes this
under `build.metadata.eventContracts` without importing pack modules or requiring authored sources.
An installed build missing a declared endpoint's contract is refused; an unbuilt source preview reports
that metadata as unavailable. The catalog retains contracts when an owner is disabled or its runtime
fails. Runtime availability remains separate from this declaration inventory.

The contract is a **declared type**, not a value, and it lives in a leaf module of its own. `apack.json` names it at `features.<id>.system.contract` (`"src/features/bookmarks/be/contract.ts#Contract"`), and the build reads the type from there without running or resolving the machine. Its fields:

| Field | What it is |
|---|---|
| `incoming` | what anything outside the system sends it: another system, a surface, a dependent pack. Required unless the system only broadcasts |
| `internal` | what the system's own children send it (a `fromCallback` child telling its parent). These reach the machine's event union and nothing a dependent pack can see, so they can't be sent from outside. Optional |
| `outgoing` | every event the system sends to surfaces, and the one place they're declared: the build types `broadcastToSurface` from it and lists what each surface receives. Required |
| `context` | the machine's context, `{}` when omitted |

The spec it returns:

| Member | What it is |
|---|---|
| `types` | `{ context; events }`, for `setup({ types })`: the events are `incoming \| internal \| SystemEvents`. `SystemEvents` is `SEND_STATE`, `CLIENT_CONNECTED`, `PACK_CHANGED { packId }`, `DATA_REPLACED` and `FEATURE_SETTINGS_UPDATED { settings, changes }`, so no contract lists them |
| `typeOf` | `safeEvents` over the same events, to narrow an event by type in actions |

### Key rules

- **Keep contracts in their own modules.** A system entry uses its default export. Surface state and component targets use default exports or explicit `path#exportName` references. Events come from the contract; your pack's typecheck reports a machine built from a different contract.
- **Always handle `SEND_STATE`, and usually nothing else** — the app asks every system for its state whenever anything could have changed what it holds: a frontend connected, a pack was installed, updated, enabled, disabled, uninstalled or rebuilt while the app runs, its content were imported from Settings, or the data was reset or restored from a backup. Answer by broadcasting the full state your surface starts from; the surface doesn't need to ask for it. Because the ask is the same whatever caused it, you write it once and stay correct as new causes are added — including ones that didn't exist when your pack was written. An installed pack with frontend code (an FE entry or surfaces) is asked once each window has tried loading that frontend, at startup, on activation and when the window reconnects, whether the load added surfaces or failed; every system of the pack is asked, those without a surface too. Every open window receives what you send, not only the one that asked.
- **Handle a fact only for what publishing cannot fix** — `CLIENT_CONNECTED`, `PACK_CHANGED { packId }` and `DATA_REPLACED` are delivered before the ask that follows them, for work that re-sending data cannot do: tearing down something held over rows that are gone, or tracking whether a client is attached. If your answer to one of them would be "send my data again", delete it and handle `SEND_STATE` instead.
- **Use `broadcastToSurface()` to send to the frontend** — `broadcastToSurface(name, event)`, in a system's actions or anywhere else (services, callbacks), routes the event through the bus to the surface that name stands for, in **every** window showing it (a surface runs once per window). The renderer's own `sendToSurface(name, event)`, from the same module, goes to one window's actor instead. It's dropped while no client is connected, which is also why the app doesn't ask a system to publish until one is. It comes from `#generated/events` and accepts only the events that surface receives. Don't import it from `@apackdev/sdk/events`, whose untyped version accepts any event. Only features that have a `surface` are named there: a feature with a system and no surface has nothing to receive events, so it gets no key. A surface that should also take events from another feature or another pack declares them itself, in the `inbox` half of its `Contract` — the receiver says what it handles, so a pack widens only its own surfaces.
- **An event arrives exactly as you sent it** — where it goes travels beside it (`{ to, event }`), so any field name is yours to use, `surfaceId` included.

### Communication patterns

Your code names features: your own by id (`'bookmarks'`), and every other as `<packId>/<featureId>` (`'default-setup/logs'`; the app is the pack `host`, so its surface is `'host/application'`). Every API that reaches a system or surface takes that name. A feature's system and surface both run under its ref, `<packId>/<featureId>`, the same spelling you write for another pack's features: a bare name is only short for your own pack's. Actions name systems and surfaces `<packId>/<featureId>`, their own pack's included (see [`services.emitter`](services-and-data.md#host-services)).

| To | Use |
|---|---|
| send to a surface from a system | `broadcastToSurface(name, event)` (`#generated/events`) — every window |
| send to a surface from the frontend | `sendToSurface(name, event)` (`#generated/events`) — this window |
| send to a system, from a surface or from another system | `sendToSystem(name, event)` (`#generated/events`), typed with the events that system declares |
| send to whichever system plays a role | `sendToSystem({ role }, event)`: `sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType })` fires a flow event |
| reach your surface's actor from its components | `useSurface<MyActor>()` (`@apackdev/sdk/fe`): the app renders a surface's canvas, panel, chat and settings as part of it. Name your machine's actor type — which surface a component belongs to is where it is rendered, so nothing at the call site can infer it, and an unnamed one would read a context field your machine dropped and still compile |
| read another surface's state | `useSurfaceState(name, selector)` from `#generated/fe` in a component's setup or an effect scope, and `readSurfaceState(name, selector)` once, outside one (a machine's action). The selector takes that surface's published state, not an XState snapshot. Your own pack's surfaces are always running, so the value is never `undefined`; a dependency's frontend may still be loading, so reading one of its surfaces gives `undefined` until it arrives, and fills in when it does. For a ref that arrives as data, `useUntypedSurfaceState`/`readUntypedSurfaceState` (`@apackdev/sdk/fe`) are the untyped escape hatch |
| declare what other surfaces may send yours | the `inbox` half of your surface's `Contract`, a declared type in a leaf module `apack.json` names at `features.<id>.surface.contract`: `export type Contract = { state: MyContext; inbox: SurfaceInbox<{ public: MyInbox }> }`. Your own feature's system needs no declaration — its outgoing events are already your surface's. The `public` half is what a pack that depends on yours may send, and what types `sendToSurface` and `openSurface`. The leaf imports no machine, so codegen can read the contract without resolving one |
| offer another of your features your surface's state or events | put them in your surface's `Contract` — `state` is read through the generated readers, `inbox` types the sends. A feature imports nothing of another feature's frontend (`check:specifiers`), so the contract is the whole of what crosses |
| open a surface, optionally handing it events | `openSurface(name, event?)` (`#generated/fe`), which takes only the names your pack can write: its own features' and its dependencies'. The events are that surface's inbox, the same `sendToSurface` takes — this hands them to its actor too |
| open a surface a piece of data names (a link's target) | `untypedOpenSurface(ref, event?)` (`@apackdev/sdk/fe`). It throws for a string that isn't a `<packId>/<featureId>`; otherwise the app opens the surface, waiting while the pack that provides it is still loading, and tells the user if no installed pack provides it |

```typescript
import { broadcastToSurface, sendToSystem } from '#generated/events.ts';

// System -> Surface (via bus)
broadcastToSurface('bookmarks', { type: 'BOOKMARK_CREATED', bookmark });

// System -> System (via bus), checked against what the tags system declares it receives
sendToSystem('tags', { type: 'SOME_EVENT' });
```

Frontend code (and backend code) sends events to systems with `sendToSystem` from `#generated/events`:

```typescript
import { sendToSystem } from '#generated/events.ts';

// Surface -> System: this pack's systems by feature id, a dependency's as <dependency>/<feature>
sendToSystem('bookmarks', { type: 'CREATE_BOOKMARK', url, title });
sendToSystem('default-setup/notes', { type: 'EMPTY_TRASH' });
```

`sendToSystem` accepts only systems of your pack and its dependencies, and only the events each one declares (its contract's `incoming`); a missing field is reported against the event its `type` names. Each send names one system and one event type: a `systemId` or `type` typed as a union is rejected. A bare name is your own feature (`'bookmarks'` is `my-pack/bookmarks`). A dependency's system is always named with the dependency's id, so a feature of yours may share its name: `'notes'` is your own, `'default-setup/notes'` default-setup's. The app checks target and event-name membership against the accepted endpoint contract. The generated system inbox contains the contract's `incoming`, explicit `system.events.incoming` additions, and shared SDK lifecycle events. Private machine handlers do not define a public inbox; backend event diagnostics do not validate payloads or authorize senders.

Backend code that needs the connection or every incoming event subscribes with `onConnected(callback)` and `onIncoming(callback)` from `@apackdev/sdk/events`; each returns an unsubscribe function. Log entries arrive through `onLog(callback)` from `@apackdev/sdk/logger`.

### Logging and errors

- `createLogger(source)` from `@apackdev/sdk/logger` logs with your source; its entries reach the app's log. `createLogger(source, { debug: true })` logs `debug` messages only while `setDebugEnabled(source, true)` is in effect (on by default outside production). Backend pack code doesn't call `console.*`.
- `reportError({ error, source, title?, operation?, entityId?, severity?, userMessage? })` logs an error and shows it to the user. A flow step passes `step: { phase, runNodeId, nodeId, … }` instead: the error is recorded on the step's run node and shown in the flow, and `reportError` returns it for `actor.send({ type: 'ERROR', error })`.

## Frontend surface

### Defining a surface

Declare the surface under its feature in `apack.json`. Codegen combines this data with the referenced
machine and views; the host addresses it at `<packId>/bookmarks`.

```json
"surface": {
  "label": "Bookmarks",
  "icon": "Bookmark",
  "state": "src/features/bookmarks/fe/state.ts",
  "canvas": "src/features/bookmarks/fe/canvas/list.vue"
}
```

A module path uses its default export. Use `path#exportName` for a named machine or component export.
A component target can instead be `{ "entry": "path", "load": "lazy" }` to preserve lazy view loading.
A custom icon uses `{ "entry": "src/icon.vue" }`; a string icon names a Lucide export.
A routed canvas uses `{ "routes": { "list": "src/list.vue", "view": "src/view.vue" } }`.
Discovery reads these declarations without loading the machine or component modules.

### Surface declaration

| Field | Required | Meaning |
|---|---|---|
| label | yes | Sidebar label |
| state | yes | Machine module/default or named-export target |
| icon | no | Lucide name or custom component target |
| canvas | no | Component target or routes map |
| panel, chat | no | Component targets |
| isPinned | no | Initial pinned placement |
| hotkeys | no | `{ action, global? }` per shortcut action |
| options | no | `{ headerClass?: string }` |
| fallbackPanel | no | `{ label, toggle: { type }, isShown: "path#exportName" }`; the predicate executes only at runtime |
| contract | no | Leaf module/type export for published state and inbox |
| default | no | Startup default claim |
| defaultVisible | no | Initial navigation visibility before the user's override |

Custom settings forms are declared independently at `features.<id>.settings.form`.

### Frontend state machine

```typescript
// src/features/bookmarks/fe/state.ts
import { setup, type ActorRefFrom } from 'xstate';

// The feature's name: the machine's id, and how the pack's code sends to and looks up this surface
export const id = 'bookmarks';
export type BookmarksState = ActorRefFrom<typeof bookmarksState>;

const bookmarksState = setup({
  types: {
    context: {} as { items: unknown[] },
    events: {} as
      | { type: 'BOOKMARKS_CONNECTED'; data: unknown[] }
      | { type: 'BOOKMARK_CREATED'; bookmark: unknown },
  },
}).createMachine({
  id,
  initial: 'idle',
  context: { items: [] },
  states: {
    idle: {},
  },
});

export default bookmarksState;
```

### Useful SDK utilities

```typescript
import { safeEvents } from '@apackdev/sdk/fe';       // Typed event handling
import breadcrumb from '@apackdev/sdk/fe';             // Navigation breadcrumbs
import { breadcrumbWithParams } from '@apackdev/sdk/fe'; // Parameterized navigation
```

## Settings

Each feature declares a JSON Schema and explicit defaults in `apack.json`; forms remain custom:

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
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

- `surface.default: true` claims the initial default. At most one feature per pack may claim it. Across packs, enabled native claims precede installed claims, then fully qualified feature refs sort in English lexical order. Selection uses declarations, so a faster frontend import cannot take another pack's default. A saved destination, popout target or explicit navigation takes precedence; the host remains usable while the selected frontend loads.
- `surface.defaultVisible` controls whether the sidebar tab shows by default (it shows when omitted). What the user shows or hides is the app's own state, kept by the host (`host/application`), and wins over it.
- The host stores overrides under `features.<packId>/<featureId>`; the declaration does not repeat that ID.
- Settings use JSON Schema draft-07 and required explicit `defaults`. Invalid declarations fail the build and registration; invalid changed values are refused at the shared store. Validation does not coerce, populate defaults or transform values. See [Feature settings](manifest.md#feature-settings).
- The settings are defaults: when your pack is enabled they join the app's defaults, and what the user changes is stored over them. Disabling the pack leaves its discovered definitions and defaults available; a new version's defaults apply to every key the user didn't change.
- Codegen derives the read and write types from the schema. Backend code uses `featureSettings.forFeature('bookmarks')` from `#generated/settings.ts`; components use `useSettings('bookmarks')` from `#generated/settings-fe.ts`. Own features use bare IDs; dependencies use `<packId>/<featureId>`. Only features declaring a settings schema are accepted. The frontend module loads no schemas or backend services.

```typescript
import { featureSettings } from '#generated/settings.ts';
const bookmarks = featureSettings.forFeature('bookmarks');
const interval = bookmarks.get().syncInterval; // number
bookmarks.set({ path: ['syncInterval'], value: 600 });
bookmarks.reset(); // removes overrides; applies the current defaults
const stop = bookmarks.onChange(value => console.log(value.syncInterval));
// Call stop() when this backend consumer is disposed.
```

Pack-wide groups are declared under `extensions.settings`, using the same `schema`, `defaults`, and
optional `form` contract. Backend code uses `packSettings.forGroup('assistant')` from
`#generated/settings`; frontend code uses `usePackSettings('assistant')` from `#generated/settings-fe`.
Their values live at `packs[packId][groupId]`, so two packs can declare `assistant` independently.
Bare selectors address the importing pack; qualified selectors name a declared dependency or the
importing pack explicitly. `access: "owner"` makes dependency handles read-only in generated types;
shared read/write/reset is the default. App preferences remain host-owned at `app`.

Setting a value equal to its current default records a choice. Reset removes that choice and follows
future defaults. Settings consumers and subscriptions work independently of opening the Settings view.

The host's advanced JSON editor shows the complete effective document (`app`, `packs`, `features`).
Installed declarations supply completion, descriptions and validation, including disabled packs.
Saving records the entire document as explicit choices; omitted required fields are errors rather than
requests to inherit defaults. Use the settings reset controls to resume following defaults. Unavailable
owners remain visible and may be retained or removed, but their values cannot be edited until their
declarations are available again. Backup files contain sparse overrides and use the import contract.

In a component, `useSettings('bookmarks')` returns a reactive `value` (undefined until loaded), typed `set`, and `reset`. It must run in a component or effect scope; disposal stops its subscription. `useAppSettings()` from `#generated/settings-fe.ts` returns the same handle for host app preferences, using the pack's accepted caller access. Generated handles refuse writes after unload. Ambient SDK reads do not grant a write connection.

Custom forms type their props with `SettingsOf<'bookmarks'>` and their `update-setting` payload with `SettingUpdate<'bookmarks'>`, both from `#generated/settings-fe.ts`. Paths address object fields, including record keys, up to six levels; replace arrays as a whole. Each path is paired with its field's value type. Runtime validation remains authoritative. Forms emit updates to their host owner, which supplies validation results and reset behavior. `useSettingsSave(writer)` from `@apackdev/sdk/fe` tracks requests through an explicitly supplied writer; one form cannot mark another saved or implicitly borrow window administration.

Custom forms can use `useSettingsDraft` from `@apackdev/sdk/fe` for an editable copy of a JSON settings field:

```typescript
import { useSettingsDraft } from '@apackdev/sdk/fe';
const tags = useSettingsDraft(() => props.settings.tags);
// Save explicitly: emit('update-setting', { path: ['tags'], value: tags.value });
```

Draft edits never mutate the settings snapshot. A persisted change to the selected field replaces its draft,
including after a reset; unrelated or equivalent snapshots preserve pending edits, regardless of object key order.
Array order is significant. Values must be JSON-compatible (or `undefined`). The composable requires a component
or effect scope; disposal stops its watcher. It does not save automatically.

The host's raw `services.settings` and frontend settings port support migrations, app-wide sections, and transport. Ordinary feature code uses the generated accessors.
- When a feature's settings change, however they changed (a setting, the settings replaced or reset, a pack's defaults coming or going), its system gets `FEATURE_SETTINGS_UPDATED { settings, changes }` (`changes`: what changed in each list, by its key) and its surface `FEATURE_SETTINGS_UPDATED { settings }`. Every system and surface receives it, like `SEND_STATE`: nothing declares it, and a feature without a system or a surface just doesn't get that half.

## Manifest entry

`apack.json` is a feature's only configuration. The entry `apack pack add feature` writes:

```json
{
  "description": "Save and organize bookmarks.",
  "settings": {
    "schema": { "type": "object", "additionalProperties": false },
    "defaults": {},
    "form": "src/features/bookmarks/fe/settings.vue"
  },
  "system": {
    "entry": "src/features/bookmarks/be/system.ts",
    "contract": "src/features/bookmarks/be/contract.ts#Contract"
  },
  "surface": {
    "label": "Bookmarks",
    "icon": "Bookmark",
    "state": "src/features/bookmarks/fe/state.ts",
    "canvas": "src/features/bookmarks/fe/canvas/list.vue",
    "defaultVisible": true,
    "contract": "src/features/bookmarks/fe/contract.ts#Contract"
  },
  "types": "src/features/bookmarks/be/types.ts",
  "services": {},
  "repositories": {
    "bookmarksQueries": "src/features/bookmarks/be/repository/index.ts#bookmarksQueries",
    "bookmarksCommands": "src/features/bookmarks/be/repository/index.ts#bookmarksCommands"
  }
}
```

A feature can omit `system` (frontend-only) or `surface` (backend-only). `services` and `repositories` are optional. Surface presentation, pane references and shortcut descriptors live in the manifest; codegen supplies the bound `SurfaceDefinition`. Each service entry names the service object a module exports, `"bookmarks": "src/features/bookmarks/be/services/bookmarks.ts#bookmarksService"` (see [Services](services-and-data.md#services)); repositories work the same way (see [Repository pattern](services-and-data.md#repository-pattern)).

Other feature fields:

| Field | Effect |
|---|---|
| `system.events.incoming` | Explicit routing additions besides the contract's typed `incoming` and shared SDK lifecycle events |
| `description` | Required nonblank purpose, displayed from declarations without activation |
| `types` | Types module re-exported from `#generated/types`; explicit pack-root-relative module path; no inferred default |
| `references` | Inline type/category declarations and explicit function exports; see [reference declarations](manifest.md#reference-declarations) |

A feature that fills a role other packs look up (`getDesignated('<role>')`, or `sendToSystem({ role }, event)`) sets `"designation"` to that role. A role is not a name: a feature `inbox` can play `notes`. `apack pack add feature bookmarks --description "Save and organize bookmarks." --designation bookmarks` writes it. One feature plays a role: `apack pack validate` reports two features of a pack claiming the same one, and the app refuses a pack claiming a role another pack plays. `apack pack validate` also reports a `settings.form`, `system.entry` or `surface.state` and component-target file that doesn't exist.

## Types dependents see

`apack pack build` bundles the types of what a pack exposes (entity shapes, events, services, repositories) into `dist/types/pack-types.d.ts`. Packs depending on it compile against that file, so the build fails when the bundle:

- doesn't type-check on its own, or
- imports a package other than `@apackdev/*`, `@apackdev/sdk`'s peer dependencies (`vue`, `xstate`, `zod`, `ai`, ...) or a Node built-in. For example, a service whose methods return a `Page` from `playwright`: a dependent doesn't have your pack's other dependencies installed, and would read those types as `any`, or
- imports an `@apackdev/*` module the published package doesn't export (`@apackdev/sdk/utils/internals`, which resolves only in a linked apack checkout), or a private package (`@apackdev/host`), or
- imports a relative or absolute path: a facade bundle imports only packages, or
- imports a module that resolves to something without type declarations (a `.js` file), which dependents would read as `any`.

The error names the offending line of the bundle and the facade type that reaches it. Give the service or repository an explicit type written with your own types or allowed packages' types instead of one inferred from a library's.
