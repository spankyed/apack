# Services, EARS & Migrations

## Services

Services are stateless modules that systems and actions can call. They come in two flavors:

- **Feature services** — scoped to a feature, declared in `features.<id>.services`
- **Pack-level services** — shared across the pack, declared in `extensions.services`

### Scaffolding

```bash
apack pack add service cache                         # pack-level
apack pack add service bookmarks --feature bookmarks # feature-level
```

### Writing a service

A service is an object exported by name. `services.<key>` is that object, so its members are what systems, actions and dependent packs call:

```typescript
// src/extensions/services/cache.ts
const store = new Map<string, unknown>();

export const cacheService = {
  get: (key: string) => store.get(key),
  set: (key: string, value: unknown) => store.set(key, value),
  clear: () => store.clear(),
};
```

There is no fixed interface: the shape is pack-specific. The export is the service object itself (an object literal or a class instance, `export const cacheService = new Cache()`), never a factory function or a class: `generate-entries` fails on one. Other exports of the module stay out of the service, so helpers the pack uses internally are imported directly. The service's type is the type of the export, and dependent packs build against it: give the export an explicit type when its inferred type would name a third-party package.

### Manifest

Each entry names the file and its export, as `"path#exportName"`. The export can come from the file itself or be re-exported (`export { cacheService } from './cache-impl'`, a barrel's `export *`); `generate-entries` resolves it with the TypeScript compiler and fails when the file or export doesn't exist, or the export is a type or function.

**Pack-level:**
```json
{
  "extensions": {
    "services": {
      "cache": "src/extensions/services/cache.ts#cacheService"
    }
  }
}
```

**Feature-level:**
```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "services": {
        "bookmarks": "src/features/bookmarks/be/services/bookmarks.ts#bookmarksService"
      }
    }
  }
}
```

Service names (the keys) are identifiers. `apack pack add service <name>` writes both: a module exporting `<name>Service` (camelCase) and its entry.

### Required services

Declare APIs required beyond logger, emitter, repository, caller-bound settings and your own services:

```json
{
  "dependencies": { "search-pack": "^1.0.0" },
  "consumes": { "services": ["host/onboarding", "search-pack/search"] }
}
```

The provider must be a direct dependency and directly declare the service. The host checks its
version and availability from declaration data before importing the consumer. An installed app cannot
use an authoring-only preview as a provider. `apack pack validate` checks local declarations without
activating providers; missing local dependency data makes validation incomplete. `apack pack info`
lists the requests. These declarations describe API dependencies, not a JavaScript security sandbox.
Generated types and runtime access expose that selection. A declared provider must also have an
accepted runtime before its service can be used; calls do not activate it. Retained service objects
and methods refuse after provider retirement instead of redirecting to a replacement. Caller authority
retires after its actors finish stopping. Calls and streams already started may finish on their original
implementation; inference agents cannot start new calls after retirement. Import access from
`#generated/services`; the SDK services module exports contracts and helpers, not an ambient service
object.

### Generated aggregation

`generate-entries` creates `__generated__/services.ts` (import it as `#generated/services`), which:

1. Imports each feature and pack-level service export
2. Exports a `featureServices` object aggregating them (`Services` is typed from it)
3. Exports `Services`: own services, the baseline and explicitly consumed host/dependency services; `repository` and `emitter` retain the pack's generated types
4. Exports the current host-bound `services` facade. A rebind publishes a fresh root; retained roots stay retired.

```typescript
import { services } from '#generated/services.ts';

services.cache.get('key');              // this pack's service
services.search.find('term');          // a declared dependency service
services.repository.bookmarkQueries;    // repositories (see below)
```

Code runners obtain `servicesForAction(label)` from `#generated/services` and pass its result to
user-authored code. It preserves the accepted API selection and lifetime while naming logs and sends
`action:<label>`; the host supplies the executing pack's identity. Flow execution retains this factory
in `executionContext.runtime.servicesForAction`. Retained factories, loggers and emitters cannot regain
authority after rebind. Actions access the resulting view via their `services` parameter. Service names are global across installed packs: the host refuses to register a pack whose service name another pack or the host already uses.

### Host services

Every pack receives `logger`, `emitter`, `repository` and caller-bound `settings`, plus its own services. The six additional host APIs—`onboarding`, `appData`, `runHistory`, `inference`, `secrets` and `filesystem`—require explicit `host/<service>` entries in `consumes.services`. Settings access remains subject to the target's access policy; packs never receive the host's administrative settings operations. Contracts live in `@apackdev/sdk/services`. The table describes these APIs; availability follows the pack's declared selection. Inference and repositories are covered further below:

| Service | Methods |
|---|---|
| `services.appData` | `reset()` resets the whole app as a fresh boot leaves it: deletes all stored data and API keys, then runs `onInit`, app-line migrations, pack-line migrations and content application in dependency order. `exportBackup(targetPath, name?, databases?)` copies databases (and media) into a new backup directory. `importBackup(path)` replaces stored data with a backup and reloads memory from it, restoring the previous data on failure. `readBackupSummary(path)` reads a backup's metadata, or `null`. |
| `services.onboarding` | `isComplete()` reads completion and `complete()` records it. Preferences reset leaves this lifecycle state intact; resetting the app starts onboarding again. This service exposes no reset, import or export operations. |
| `services.runHistory` | Flow runs, recorded while they run and kept 30 days after their session ends. A run is a tree of nodes (`RunNode`, by `kind`: a flow or a step, recording the `input` it was given, or an event, recording its `payload`), linked by `parentId` under the session's root: `get(id)`, `findChildren(id, { limit?, cursor?, reverse? })` (in the order they began), `tree(id)` (a node and everything under it), `findRuns({ flowId?, limit?, cursor? })` (flow nodes, newest first) and, for whoever runs flows, `start(node)` (a new id, `active`, now, its root its parent's), `update(id, { label?, input?, payload?, result? })`, `finish(id, 'completed' | 'failed')` and `stopActive()`. A run is not an entity: queries never see one, and a `transact` that throws never undoes one. |
| `services.secrets` | The user's API keys, without their values: `list()` (each key's `id`, `provider`, `label`, whether it's `selected`, timestamps), `select(id)`, `rename(id, label)`, `delete(id)` and `status()` (how keys are protected). Keys are added, and their values replaced, only in Settings → Secrets. A key's `provider` (`SecretProvider`) is a model provider or `'custom'`, for keys the app's own integrations name. |
| `services.filesystem` | Files and folders on the user's disk, as UTF-8 text: `readFile(path)`, `writeFile(path, content)` (creating missing parent folders), `exists(path)`, `mkdir(path)` (with its parents), `readDir(path)` (`{ name, isDirectory }` entries), `stat(path)` (`size`, `mtime`, `isFile`, `isDirectory`), `rename(from, to)` and `remove(path)` (a folder with its contents; a missing path isn't an error). In unit tests it fails until the test mocks it with `mockService('filesystem', …)`. |
| `services.logger` | `debug`, `info`, `warn`, `error` (any arguments), sent to the app as redacted log events. In an action it's named `action:<label>`. `createLogger(source)` from `@apackdev/sdk/logger` gives a logger tagged with your own source. |
| `services.emitter` | `broadcastToSurface(surface, event)` (to the frontend) and `sendToSystem(system, event)` (onto the bus); `sendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType, payload?, targetFlowId? })` fires a flow event. `Services` types both with your pack's events. An action is content — a row a user can edit, export and copy into another pack — so both name every feature `<packId>/<featureId>`, your own too (`'my-pack/bookmarks'`, `'default-setup/threads'`); the app's own are the pack `host`'s (`'host/application'`). The host sends to the surface or system the name is, and throws for a name nothing is registered under, suggesting the `<packId>/<featureId>` form when a bare name matches one pack's feature. What an action sends says where it came from: the executing pack in `Message.from`, and the action as `action:<label>` in `Message.via`, which is also what names its logger — so a message the app couldn't deliver names the action in the same string you grep the logs for. |

Backups never include API keys; `exportBackup` copies the database (`lmdb`, with media) and the run history (`runHistory`) you name. `importBackup` restores only the stores the app has, and leaves out any other a backup lists; a restored run history's running nodes come back `stopped`.

### API keys

The user adds keys in Settings → Secrets: several per provider (one per account, each with a label), with one selected per provider. `services.inference` uses the selected key.

- **Where they're kept:** the host stores each key's metadata in plain text and its value encrypted (AES-256-GCM) in one file in the app's data directory, readable only by the user (mode `0600`; on Windows the mode has no effect, and the file relies on the user profile's access control). The data key that encrypts values is held by the OS credential store (macOS Keychain, Windows Credential Manager, or Secret Service on Linux) and is read the first time a value is used. Where the OS has none, Settings says so when it opens (the app checks the credential store once, reading an entry that doesn't exist, so there's no item to ask access to); where the store refuses later (a locked keyring, a denied prompt), adding a key fails and Settings says so then. Either way it offers to keep the data key in a file next to the keys instead, after which it says they're unprotected. Reset deletes the keys and keeps their data key, which encrypts the keys added next: a copy of the data directory used by the same user on the same machine shares it, so resetting the copy leaves the original's keys readable. A keys file that can't be read is deleted on reset.
- **What never sees a value:** packs, the frontend, events, error reports, backups and the database. `services.secrets` has no value-reading method. Logs, including what's written with `console` (as the text the console prints), pass through redaction that replaces the values of credential fields (`apiKey`, `token`, `authorization`, …) and strings shaped like OpenAI, Anthropic, Groq and Google keys. Mistral and Cohere keys have no recognizable shape, so they're matched by hash instead: whenever the app stores or reads a key value, it records that value's SHA-256 digest (never the value), and redaction masks any long token in text whose digest it recognizes. So a prefix-less key is redacted once the app has used it since it started — which it has before any call that could log it. What that leaves: a key stored in an earlier run and not used again in this one, and a value printed run together with other characters (`MISTRAL_KEY_<value>`) rather than as a token of its own.
- **What this doesn't protect against:** code running inside the app. Packs run in the app's process with full Node.js access, so a pack could read the credential store or the file itself: installing a pack means trusting it with your keys. Other programs running as you can reach the OS credential store too, except where the OS ties an item to the app (macOS Keychain).

### Inference

`services.inference` calls models with the key the user selected for each provider in Settings → Secrets (see [API keys](#api-keys)); a call to a provider with no key, or none selected, fails naming what to do. Nothing about a call comes from the environment: each provider gets the selected key and the provider's own URL (`PROVIDER_BASE_URLS` in `@apackdev/sdk/models`), so variables like `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` can't send a call, with the user's key, somewhere else. Its calls are the AI SDK's own (`ai` 7), with `model` named by a `provider:model` id:

| Call | Returns |
|---|---|
| `generateText(options)` | the AI SDK's `generateText` result: `text`, `output`, `toolCalls`, `steps`, `usage`, … |
| `streamText(options)` | a promise of the AI SDK's `streamText` result: `stream` (parts), `textStream`, `text`, … |
| `createAgent(settings)` | a promise of the AI SDK's `ToolLoopAgent`: `generate({ prompt })` and `stream({ prompt })` loop over `instructions`, `tools` and `output` until `stopWhen` (20 steps by default); its model and key resolve on each call |
| `embed(options)` / `embedMany(options)` | the AI SDK's `embed` / `embedMany` results: `embedding` / `embeddings` |
| `generateImage(options)` | the AI SDK's `generateImage` result: `image` (`uint8Array`, `base64`, `mediaType`) and `images` |
| `generateSpeech(options)` | the AI SDK's `generateSpeech` result: `audio` |
| `transcribe(options)` | the AI SDK's `transcribe` result: `text`, `segments`, `language` |
| `rerank(options)` | the AI SDK's `rerank` result: `ranking` and `rerankedDocuments` |

Each call takes models from the providers that give that kind (`providerCapabilities` in `@apackdev/sdk/models`); a model id from another provider doesn't compile (`EmbeddingModelId`, `ImageModelId`, `SpeechModelId`, `TranscriptionModelId`, `RerankingModelId`) and fails naming the provider at runtime:

| Provider | Language | Embedding | Image | Speech | Transcription | Reranking |
|---|---|---|---|---|---|---|
| `anthropic` | ✓ | | | | | |
| `openai` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `google` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `groq` | ✓ | | | | ✓ | |
| `mistral` | ✓ | ✓ | | ✓ | ✓ | |
| `cohere` | ✓ | ✓ | | | | ✓ |

`@apackdev/sdk/models` exports:

| Export | What it is |
|---|---|
| `ProviderName`, `ModelId`, `ModelKind`, `ModelIdOf<K>` (and the per-kind ids above) | `provider:model` id types |
| `providerCapabilities` | The table above: provider → the model kinds it serves |
| `providerLabels` | Display names (`openai` → `OpenAI`) |
| `PROVIDER_BASE_URLS` | The URL each provider is called at |
| `availableModels` | The language model catalog, `ModelCatalogEntry[]`: `id`, `name`, optional `description`, `contextWindow`, `costPer1kInput`, `costPer1kOutput`, `capabilities` |
| `parseModelId(id)` | `{ provider, model }`, or `undefined` when the id doesn't name a known provider and a model |
| `isModelId(id)` | Type guard for the same check |

```typescript
import { isStepCount, tool } from 'ai';
import { z } from 'zod';
import { services } from '#generated/services.ts';

// Text
const { text } = await services.inference.generateText({
  model: 'anthropic:claude-sonnet-4-5',
  instructions: 'Be brief.',
  prompt: 'Summarize this note: …',
});

// Structured output, as data or as an Output from ai
const { output } = await services.inference.generateText({
  model: 'openai:gpt-5-mini',
  prompt: 'Tag this note: …',
  output: { type: 'object', schema: z.object({ tags: z.array(z.string()) }) },  // or Output.object({ schema })
});
const { output: label } = await services.inference.generateText({
  model: 'openai:gpt-5-mini',
  prompt: 'Is this note a task or a reference?',
  output: { type: 'choice', options: ['task', 'reference'] },   // label: 'task' | 'reference'
});

// Tools, looping until the model answers (at most 5 steps)
const lookup = tool({
  description: 'Look up a note by title',
  inputSchema: z.object({ title: z.string() }),
  execute: async ({ title }) => services.repository.noteQueries.all().find((note) => note.title === title)?.content,
});
const answer = await services.inference.generateText({ model: 'openai:gpt-5', prompt: 'What does my shopping note say?', tools: { lookup }, stopWhen: isStepCount(5) });

// Streaming
const stream = await services.inference.streamText({ model: 'google:gemini-2.5-pro', prompt: 'Draft a reply' });
for await (const part of stream.textStream) process.stdout.write(part);

// An agent: instructions, tools and output, reused across calls
const planner = await services.inference.createAgent({
  model: 'anthropic:claude-opus-5',
  instructions: 'Turn notes into tasks.',
  tools: { lookup },
  output: { type: 'array', element: z.object({ task: z.string(), due: z.string().optional() }) },
});
const { output: tasks } = await planner.generate({ prompt: 'What do I need to do this week?' });

// Embeddings, images, speech and transcription
const { embeddings } = await services.inference.embedMany({ model: 'openai:text-embedding-3-small', values: ['Buy milk', 'Call Sam'] });
const { image } = await services.inference.generateImage({ model: 'openai:gpt-image-1', prompt: 'A carton of milk' });
const { audio } = await services.inference.generateSpeech({ model: 'openai:gpt-4o-mini-tts', text: 'Buy milk' });
const { text: heard } = await services.inference.transcribe({ model: 'groq:whisper-large-v3', audio: audio.uint8Array });
const { rerankedDocuments } = await services.inference.rerank({ model: 'cohere:rerank-v3.5', query: 'groceries', documents: ['Buy milk', 'Call Sam'] });
```

- **Embeddings a vector index holds are embedded for you.** An entity type whose manifest entry declares `embed`
  (see the manifest guide) keeps each changed chunk pending; `embedPending()` from `@apackdev/sdk/services` embeds them
  with the index's model through `embedMany`, and `embedSearchText(type, text)` makes the vector `near` and `hybrid`
  take.
- **`output` takes data or an `Output`.** The data forms mirror `ai`'s `Output` helpers, and `output` in the result is typed from them:

  | `output` | Same as | Result |
  |---|---|---|
  | `{ type: 'text' }` | `Output.text()` | `string` |
  | `{ type: 'json', name?, description? }` | `Output.json()` | any JSON value |
  | `{ type: 'object', schema, name?, description? }` | `Output.object({ schema })` | the schema's type |
  | `{ type: 'array', element, minItems?, maxItems?, name?, description? }` | `Output.array({ element })` | an array of the element's type |
  | `{ type: 'choice', options, name?, description? }` | `Output.choice({ options })` | one of the options |

  An `Output` (including one you implement) passes through as is. The data form can be stored, and code that can't import `ai` can write it. `schema` and `element` take what `Output.object` does (a zod or other standard schema, or `jsonSchema()` from `ai`) or a plain JSON Schema object, as stored settings hold one: the provider gets that schema, and the result is typed `unknown` and isn't validated against it.
- **Every model is named by id,** including the one `prepareStep` (or an agent's `prepareCall`) picks for a step or call: `prepareStep: ({ stepNumber }) => stepNumber > 0 ? { model: 'openai:gpt-5-mini' } : undefined`.
- **The rest of a call's pieces are `ai`'s:** `tool`, `isStepCount` and types like `ModelMessage`. `ai` 7 is a peer dependency of `@apackdev/sdk`, installed with it (add it to your pack's own dependencies if your package manager doesn't install peers); your pack never builds a model or holds a key.
- **TypeScript 5.7 or later**, which `ai` 7's types need.
- **Actions** can't import `ai`, and don't need to: `output` as data, tools as plain `{ description, inputSchema, execute }` objects (`tool()` only returns its argument), and `stopWhen` as a function (`({ steps }) => steps.length >= 5`).
- **Unit tests** mock the service with `mockInference` (see [Testing](testing.md#models)).

Pack code never imports `@apackdev/host`, the app's private package: `apack pack build` fails a bundle that does.

---

## EARS (Entity-Attribute-Relation Store)

EARS is a graph database on elmdb, a Rust engine over LMDB, which keeps no copy of the data in memory. Packs declare entity types and relation kinds in the manifest, and use the repository pattern for data access.

The engine is its own package, `@apackdev/ears`, which packs may depend on and import directly: the app shares one instance of it with every pack, as it does `@apackdev/sdk`. Import from:

| Module | What |
|---|---|
| `#generated/ears` | Your pack's `EARS` constants and the typed `query`, `create`, `upsert`, `write`, `transact`, `newId` and `getAttr` (checked against your, your dependencies' and the SDK's shapes). Use these by default |
| `#generated/repository` | `repository`, typed with your and your dependencies' repositories |
| `@apackdev/sdk/ears` | The app's engine, untyped: `untypedQuery`, `untypedCreate`, `untypedUpsert`, `untypedWrite`, `transact`, and the relation and role reads |
| `@apackdev/ears` | The engine itself: `createEarsEngine` for tests and tooling, `EarsError`, the core `EARS` types and `BaseEntity` |
| `@apackdev/sdk/repositories` | The SDK entities' repositories, and `RepositoryError` (`NOT_FOUND`, `VALIDATION_ERROR`, `OPERATION_FAILED`), which a repository throws to refuse |
| `@apackdev/sdk/types` | What the SDK adds to the engine's types: its `EARS` (with the SDK's entities and relation kinds) and the SDK entity shapes |
| `@apackdev/sdk/repositories` | The SDK entities' repositories |

### Declaring entities

```json
{
  "data": {
    "entities": { "Bookmark": {}, "Tag": {} },
    "relations": { "tagged_with": {} }
  }
}
```

Entity keys are their wire identities; `null` leaves their attributes untyped. Feature-owned entities use the same grammar under `features.<id>.entities`. Relation wires are declared once at pack level; their uppercase names become constants. `generate-entries` creates typed exports in `__generated__/ears.ts`:

```typescript
// Auto-generated — import from here
import { EARS } from '#generated/ears.ts';

EARS.Entity.Bookmark  // "Bookmark"
EARS.RelKind.TAGGED_WITH  // "tagged_with"
```

**A relation kind is declared before anything links with it.** `EARS.RelKind` is the closed union of the pack's
kinds, its dependencies' and the SDK's, so every place that names a kind — `link`, `unlink`, `out`, `in`, `both`,
`descendants`, `ancestors`, `pathTo`, `degrees`, `outEdges`, `inEdges`, `linkedTo`, `linkedFrom`, `unlinkedTo`, `unlinkedFrom` — completes the declared ones and refuses a misspelled one at
compile time. The engine refuses an undeclared kind at runtime too (`UNKNOWN_RELATION_KIND`), on a read as well as
a write, since a read naming a kind nothing declared would answer as if no entity had such a link. A kind that
arrives as data (an event's field, an imported file) is narrowed with `EARS.isRelKind(value)`; `EARS.RELATION_KINDS`
lists them all. There is no escape from the pack's facade: an undeclared kind is a missing line in `apack.json`.

### Queries and writes

EARS queries and writes are **synchronous** — do not `await` them.

```typescript
import { EARS, query, create, upsert, write, transact } from '#generated/ears.ts';

const bookmarks = query(EARS.Entity.Bookmark).pickAll();                 // typed with the Bookmark shape
const id = create(EARS.Entity.Bookmark, { url, title }).id();          // EARS.EntityId<'Bookmark'>
write(id).set('title', 'Docs');                                       // an entity that exists
upsert(EARS.Entity.Bookmark, { id: someId, url, title });            // created when no entity has someId
```

**A created row is the whole row.** `create(type, row)` takes it in one object: every field the shape requires,
any it allows, and, for an import keeping them, its `id`, `createdAt` and `updatedAt`, which no field can be named:

```typescript
create(EARS.Entity.Bookmark, { url, title });                                  // a new id, created now
create(EARS.Entity.Bookmark, { id: givenId, createdAt: originalTime, url, title });   // an import keeping both
```

A row missing a required field doesn't compile, and the engine refuses one at runtime too (`REQUIRED_FIELD`) —
through the untyped writes, content and the Database console as well — so a row read back has what its shape says it
has. Deleting a required field is refused the same way: `set` replaces it. `upsert` may
create, so it takes the same row. Code that needs an id before it can write the row — a terminal takes one before its process starts — mints it
with `newId(type)` and creates the row once it knows it.

Each entry point takes one kind of argument and refuses what it can't account for:

| Call | Starts from | Refuses |
|---|---|---|
| `query(type)`, `query([types])` | every entity of the types | a name that isn't a registered entity type, `undefined` included |
| `query.ids(id)`, `query.ids([ids])` | the ids given that exist | — absent ids are dropped |
| `query.all()` | every entity but the relations (`findRelations` reads those) | — |
| `create(type, row)` | a new entity: the row's fields, and its `id`, `createdAt` and `updatedAt` when given | an unregistered type; an id already in use; any other of the engine's own fields |
| `write(id)` | the entity with the id | an id no entity has |
| `upsert(type, { id, ...row })` | the entity with the row's `id`, written with the row, or created as `type` with it when there is none | an unregistered type; an entity of another type |

A refusal is an `EarsError` with a `code` (`UNKNOWN_ENTITY_TYPE`, `NO_SUCH_ENTITY`, `ID_IN_USE`,
`TYPE_MISMATCH`, `RESERVED_ATTRIBUTE`, `NO_VALUE`, `NOT_A_LIST`). So a query for a type whose pack isn't installed throws
rather than answering with nothing, and a write to an id that was deleted throws rather than bringing back
attributes with no entity behind them. `#generated/ears` rejects an entity name your pack and its dependencies
don't declare at compile time, and an id passed where a type is meant.

What a write builder does:

| Member | Does |
|---|---|
| `set(k, v)` / `setMany({ ... })` | Replaces the attribute's value |
| `append(k, v)` | Appends `v` to the attribute's list, starting one when there is none |
| `merge(k, partial)` | Merges into the attribute's object |
| `delete(k)` | Removes the field |
| `removeAt(k, index)` / `removeValue(k, v)` | Removes the list's element at `index` / the list's first element equal to `v` |
| `link(kind, target, { info?, weight? })` | Links to `target`. An edge is its ends and the values of its kind's `key` fields in `info` (none declared: one edge to `target`), and linking to an identity an edge holds updates it, keeping its id: a given `info` replaces its info, a given `weight` its weight. A kind declared `acyclic` refuses a cycle through it (`CYCLE`). `weight` is a weighted kind's only (`data.relations.<kind>.weighted`): from 0 to 2^960, 1 when not given |
| `unlink(kind, target?)` / `unlinkAll()` | Removes edges of the kind (to `target` only, when given) / every edge from the entity |
| `grant(role)` / `revoke(role)` / `grantExclusive(role, among)` | See *Roles* |
| `destroy()` | Deletes the entity and its edges |
| `id()` | The entity's id |

`updatedAt` is the engine's too: `create` stamps it (a row's own `createdAt` and `updatedAt` keep an import's
times), and every attribute write stamps it once per `write(id)`. A write that is no edit of the entity — when it was
last viewed, a position kept for later — passes `{ touch: false }`: `write(id, { touch: false }).set('lastSeen', now)`.
`null` is a value like any other; `setMany` leaves a field whose value is `undefined` alone, `set(k, undefined)`
refuses, and `delete(k)` is the one way to remove a field.
So a read answers `undefined` for nothing there — `pickOne`, `first` and `last` with no entity, a field `pick` finds
unset — and `null` only ever for a stored `null`.

An attribute holds one value, and a list is one array value: a read gives back exactly what was written, a
one-element list as a list. `append`, `removeAt` and `removeValue` work on that array and refuse a value that isn't one
(`NOT_A_LIST`); `where(k, v)` matches a value equal to `v` or a list holding it.

`id`, `entityType`, `createdAt`, `updatedAt`, `role` and `trashedAt` are the engine's: every attribute write refuses
them. `create` stamps `entityType` and `createdAt`; pass `createdAt` to keep an original time (an import).

The write builder from `#generated/ears` checks a write when it knows the entity: started with an entity type,
or with an id that carries one (see *Entity ids* below). It names only the fields the shape declares, without the
engine's own, and stores each one's declared type. A plain id leaves every write unchecked, and so do the
`untyped*` writes from `@apackdev/sdk/ears`, for a field the shape doesn't declare.

```typescript
write(id).set('title', 'Docs')        // ok
write(id).set('title', 42)            // compile error: title is a string
write(id).set('clickCount', 3)        // compile error: the shape declares no clickCount
write(plainId).set('title', 42)       // ok: a plain id doesn't say which entity it is
```

`untypedCreate`, `untypedUpsert` and `untypedWrite` from `@apackdev/sdk/ears` are the same functions on the app's engine, unchecked.

The query builder narrows with `where(k, v)` (a value, or a function tested against each value), `has(k)` and
`lacks(k)`, `withRole`, `ofType`, `within`, `linkedTo`/`linkedFrom` (to or from an entity, or with none named any
entity at all) and their negations `unlinkedTo`/`unlinkedFrom`, and `linkedWith`, and walks edges with `out` and `in`.
A tree's roots are `query(type).unlinkedFrom(parentKind)`.

**A unit of writes.** `transact(fn)` runs `fn` as one unit: if it throws, every write it made is undone and none
is persisted; if it returns, its writes are persisted together. Reads inside it see its own writes. `fn` must be
synchronous, and a unit inside another commits into it.

```typescript
transact(() => {
  const id = create(EARS.Entity.Bookmark, { url }).id();
  write(id).link(EARS.RelKind.TAGGED_WITH, tagId);   // throws (no such tag) → nothing above stays
});
```

`query.ids(id).out(kinds)` walks to the entities an entity links to, `in(kinds)` to those linking to it and `both(kinds)` to either; `outEdges(kinds)` and `inEdges(kinds)` return the edges themselves, and `degrees(kinds, type?, { direction? })` how many each entity of the query has, as a `Map` from its id. A relation reads the same wherever it comes from — `outEdges`, `inEdges`, `findRelations` — as `{ id, kind, source, target, info }`: its own id, its kind, its two ends and its `info` (a flow edge's handles). `findRelations` finds relations by any of `kind`, `source` and `target`, and `getSchemaStats().relations` counts each kind's:

```typescript
import { findRelations, getRelation, removeRelation, getSchemaStats } from '@apackdev/sdk/ears';

const [edge] = findRelations({ source: nodeId, kind: EARS.RelKind.TRANSITIONS_TO });
edge.target;                       // the node it leads to
edge.info;                         // { sourceHandle: 'yes' }
getRelation(edge.id);                     // the same row, read by its id
removeRelation(edge.id);                  // that one edge, leaving any other between the same nodes
getSchemaStats().relations.contains;      // { total, uniqueSources, uniqueTargets }
```

`untypedQuery` from `@apackdev/sdk/ears` is the unchecked query, for fields only known at runtime.

### Roles

A role is a name an entity holds, stored as an attribute, so it persists with the entity. Like a relation kind, a role
is declared before anything grants it — `data.roles` in `apack.json`, beside `data.relations` — and its uppercase name
becomes a constant (`entry_event` → `EARS.RoleKind.ENTRY_EVENT`). `EARS.RoleKind` is closed over the pack's roles, its
dependencies' and the SDK's (`ROOT_FLOW`, the flow the app starts with, and `ENTRY_EVENT`, a flow's entry listener), so
`grant`, `revoke`, `grantExclusive` and `withRole` complete them and refuse a misspelled one at compile time; the engine
refuses an undeclared role at runtime (`UNKNOWN_ROLE`). A role that arrives as data is narrowed with
`EARS.isRole(value)`, and `EARS.ROLES` lists them all.

| Call | From | Does |
|---|---|---|
| `write(id).grant(role)` / `.revoke(role)` | `#generated/ears` | Adds / removes the role; no-op when already there / absent |
| `write(id).grantExclusive(role, among)` | `#generated/ears` | Makes `id` the only holder among `among`: revokes the role from each of them, then grants it |
| `query(type).withRole(role)` | `#generated/ears` | Narrows a query to holders |
| `getRoles(id)` | `@apackdev/sdk/ears` | The entity's roles, `string[]` |

### Relation and entity helpers

From `@apackdev/sdk/ears` (untyped, on the app's engine):

| Call | Does |
|---|---|
| `getRelation(relationId)` | The relation's row (`{ id, kind, source, target, info }`), or `undefined` when no relation has the id |
| `updateRelation(relationId, { source?, target?, info? })` | Moves a relation to new ends, or replaces its info, keeping its id; refuses an id no relation has |
| `removeRelation(relationId)` | Removes that one relation; refuses an id no relation has |

A relation's id is an `EARS.RelationId`, which every relation read gives back (`findRelations`, `outEdges`,
`inEdges`). A relation is not an entity, so `write` refuses a relation's id at compile time.
| `isEntityType(name)` | Whether the running app has registered the entity type: the SDK's and every registered pack's |

### Hierarchies

A tree — folders, nested notes, threads — is entities linked by one relation kind, parent to child. Two query
steps walk one any number deep, nearest first; each visits an entity once, so a cycle already in the data ends it,
and goes only where the query could reach, so a trashed entity ends it unless the query started from
`query.withTrashed`:

| Call | Returns |
|---|---|
| `query.ids(id).descendants(kind, type?)` | Every entity reachable by following `kind` out of `id`, `id` excluded: its subtree |
| `query.ids(id).ancestors(kind, type?)` | Every entity reachable by following `kind` into `id`, `id` excluded: in a tree, its parent first and its root last |
| `query.ids(id).pathTo(to, kind, { direction?, depth? })` | A shortest path from `id` to `to`: its entities in order, both ends included, or none. Edges are followed `out` unless `direction` is `in` or `both` |
| `wouldCreateCycle(source, target, kinds)` | `true` when `target` already reaches `source`, or is `source`, so linking `source → target` would close a cycle |

`type` keeps the reached entities of that type and walks through the rest. `{ depth }`, after `type`, stops a walk that many edges away (`descendants(kind, undefined, { depth: 2 })`), and a path any longer than that is none. Check `wouldCreateCycle` before moving an
entity under a new parent, or declare the kind `acyclic` in `data.relations` to have the link refused instead. A path to the root
is `query.ids(id).ancestors(kind).ids().reverse()`.

### Graph algorithms

These reads treat a query's entities as a graph: the entities are its nodes, and the edges of the kinds you name
between two of them are its edges. An edge to an entity the query doesn't reach doesn't count, so a query narrows the
graph first — a type, a search, a walk:

| Call | Returns |
|---|---|
| `query(type).rank(kind, { direction?, seeds?, weights? })` | The query's entities by how much they matter from `seeds`, highest first: personalized PageRank, a walker following edges (`out` unless `direction` is `in` or `both`) and jumping back to a seed. With no `seeds`, every entity is one, which ranks what is central overall. A seed is an id, or `{ id, weight }` to start walkers there in proportion to its weight. Over a weighted kind a walker follows an edge in proportion to its weight; `weights: false` weighs every edge 1. End with `hits()` for each score, and `limit(n)` keeps the `n` highest |
| `query(type).weakComponents(kind)` | The groups the edges join, whichever way each points: each group's ids, the largest first |
| `query(type).strongComponents(kind)` | The groups whose entities each reach every other following the edges' direction: a group of more than one is a cycle, and an entity on no cycle is a group of its own. Each group's ids, the largest first |
| `query(type).topological(kind, { direction? })` | The query's entities in an order where each edge (`out` unless `direction` is `in`) leads forward: with `blocks`, what blocks comes before what it blocks. The members of a cycle stay together; what the edges leave free keeps query order |
| `query(type).similar(id, kind, { direction?, measure? })` | The query's entities that share neighbours with `id`, most alike first: `jaccard` (the default, shared over either's) or `adamicAdar` (a rarely linked shared neighbour counts more). A neighbour counts wherever it is, so files can be alike by the symbols they use. End with `hits()` for each score |
| `query(type).communities(kind, { resolution?, seed?, weights? })` | The communities the edges form: groups more densely linked inside than out (Leiden, by modularity), each connected, the largest first. A higher `resolution` (1 by default) finds smaller ones; `0` keeps each connected group whole. An edge of a weighted kind counts by its weight unless `weights` is false. The same data answers the same communities every time |

```typescript
// The ten notes most related to the open one, by the links between notes
const related = query(EARS.Entity.Note).rank(EARS.RelKind.REFERENCES, { direction: 'both', seeds: [noteId] }).limit(11).hits()
  .filter((hit) => hit.id !== noteId);
```

A seed the query doesn't reach is ignored, and a query reaching none of them answers nothing. Every edge counts
once. The answer is the same each time the data is: ties go to the earlier entity in the query.

### Repository pattern

Each feature can keep its reads and writes in repository objects:

```
src/features/bookmarks/be/repository/
  queries.ts     # export const bookmarkQueries = { … }
  commands.ts    # export const bookmarkCommands = { … }
```

Declare them in the feature's `repositories` (name → `path#exportName`):

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "repositories": {
        "bookmarkQueries": "src/features/bookmarks/be/repository/queries.ts#bookmarkQueries",
        "bookmarkCommands": "src/features/bookmarks/be/repository/commands.ts#bookmarkCommands"
      }
    }
  }
}
```

The generated pack entry carries them in its registration, and the app holds them with the pack's other contributions before any system starts. Repository names are the app's, not the feature's: `apack pack build` fails on a name two of your features declare, or one a dependency declares, naming both, since the app refuses to register two packs that share a repository name. Use them through `repository` from `#generated/repository`, typed with your repositories and your dependencies':

```typescript
import { repository } from '#generated/repository.ts';

repository.bookmarkCommands.create({ url, title });
```

### Views

A view is a feature's data as a window shows it: a named read the window subscribes to with its own arguments. The
app runs it on the engine and runs it again after every commit that could change its result, and sends each changed
result to that window alone. Nothing that writes says who is looking, and no surface keeps a copy of the rows that it
patches from events.

```typescript
// src/features/bookmarks/be/views.ts
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';

export const bookmarkViews = defineViews({
  page: ({ page }: { page: number }) => repository.bookmarkQueries.page(page),
  byId: ({ id }: { id: EARS.EntityId }) => repository.bookmarkQueries.byId(id) ?? null,
});
```

Name the export in the feature's `views` (`"views": "src/features/bookmarks/be/views.ts#bookmarkViews"`), and read a
view in a component:

```typescript
import { useView } from '#generated/fe.ts';

const list = useView('bookmarks', 'page', () => ({ page: page.value }));
const open = useView('bookmarks', 'byId', () => (selectedId.value ? { id: selectedId.value } : null));
// list.status: 'idle' | 'loading' | 'ready' | 'error'; list.data: the result; list.error; list.commit
```

`useView` is typed by the declaration: a feature or view name it doesn't declare, or arguments that aren't the
view's, don't compile. Arguments may be a ref or a getter; a change that asks for something different subscribes
again, and `null` or `undefined` leaves the view idle. The subscription ends with the component.

- **A view is a pure read of the engine.** What it reads elsewhere — the clock, settings, a module-level cache, a
  file — isn't tracked, so its result would go stale without a word. It reads through your repositories and `query`,
  and writes nothing.
- **Arguments and results are plain data**, since they cross to the window as JSON. A view that finds nothing returns
  `null`.
- **Read what the window shows.** A view re-runs when anything it read changes, so a view that reads a whole table to
  show a count re-runs on every write to that table. `count`, `pick` and the indexes keep it narrow.
- **Windows asking for the same view with the same arguments share one read.** A pack reloading re-runs its views on
  the new code; a view that throws, or whose pack isn't running, reaches the window as `status: 'error'` and recovers
  on its own.
- `untypedUseView(ref, view, args?)` from `@apackdev/sdk/fe` is the escape hatch, for a view named by data or another
  pack's.

**A surface drawn in more than one place follows its views from its machine.** A component's `useView` lives as long as
the component, so a surface whose canvas routes and chat area come and go has no one component that holds a view for
all of them. `fromView` (`#generated/fe`) is the view as actor logic: the machine spawns it with the view's arguments,
gets the event it builds from each result, and stops or replaces it when it wants something else.

```typescript
import { fromView } from '#generated/fe.ts';

const surface = setup({
  actors: {
    page: fromView('bookmarks', 'page', (update, args) =>
      (update.ok ? { type: 'PAGE.READ', page: args.page, rows: update.value } : { type: 'PAGE.FAILED', error: update.error })),
  },
}).createMachine({ /* spawnChild('page', { id: 'page', input: { page: 0 } }) where the surface wants it */ });
```

`untypedFromView(ref, view, read)` from `@apackdev/sdk/fe` is its escape hatch.

**What a view cannot read is fetched, and its answer is replied.** A file on disk, the run history and a walk over the
whole store are not views: the first two are outside the engine, and the third would re-run on every commit anyone
makes. A surface asks for them and its system answers it with `reply`. A surface asks for what it starts from when the
shell hands it `SURFACE_STARTED` (`SurfaceLifecycleEvent`, `@apackdev/sdk/fe`), which arrives in a delivery naming the
surface; a send from the machine's own entry is in none, carries no sender, and so cannot be answered.

### Trash

The engine has a trash. `write(id).trash()` puts an entity in it: it stays stored, with its edges, marked with when
it was trashed (`trashedAt`, an attribute only the engine writes), and **no query reaches it** — not `query(type)`,
`query.ids`, `query.all`, an edge's far end (`out`, `in`, `outEdges`, `inEdges`) or the `find*` helpers. A write still
reaches it, so `write(id).restore()` takes it out. Two entry points read the trash:

```typescript
query.withTrashed('Bookmark').ids();             // every bookmark, trashed ones included (also .ids, .all)
query.withTrashed.ids(id).out('contains');   // a trashed entity's children, themselves trashed or not
query.trashed('Bookmark').pickAll();             // only the trashed ones, each with its trashedAt (also .ids, .all)
query.trashed.ids(id).exists();                  // whether this entity is in the trash
```

The entities trashed more than a week ago, say, are a query over `trashedAt`:

```typescript
query.trashed('Bookmark').where('trashedAt', (at) => at < Date.now() - 7 * 24 * 60 * 60 * 1000).ids();
```

What trashing means beyond the mark stays with your feature: trashing an entity's children with it, or emptying the trash by deleting the entities (`write(id).destroy()`).

### Engine instances

Each app has one EARS engine, which the app creates at startup. Everything above (`query`, `create`, `write`, the helpers from `#generated/ears` and `@apackdev/sdk/ears`) acts on the engine the app *bound*; a pack never creates or replaces it in the app.

Unit tests and tooling create their own with `createEarsEngine` from `@apackdev/ears`. A new engine is empty, and shares nothing with the app's or with other engines:

```typescript
import { createEarsEngine } from '@apackdev/ears';

const engine = createEarsEngine({
  isEntityType: (name) => ['Bookmark', 'Tag'].includes(name),
  isRelationKind: (name) => name === 'tagged_with',
  isRole: (name) => name === 'featured',
});
engine.create('Bookmark', { url: 'https://example.com' });   // an operation on the engine you hold
engine.query('Bookmark').count();                             // 1

```

- The engine's members are its operations: `query`, `create`, `upsert`, `write`, `transact` and relation reads, untyped.
- `engine.admin`, beside them, is for the code that created the engine: bulk loading, clearing (`admin.clear()`), direct attribute and relation writes. Pack code never gets it.
- `isEntityType` says which names are entity types: `create('Bookmark')` and `query('Bookmark')` refuse `'Bookmark'` unless it returns true for it. `isRelationKind` says which are relation kinds, which a link and every read or walk over links refuse otherwise, and `isRole` which are roles.
- An engine you create is the one you hold: nothing acts on it but what you call on it. The functions in `@apackdev/sdk/ears` act on the app's, and with none bound (a script, a test without the harness) they throw, naming how to bind one.

In a pack's unit tests you don't need any of this: `setupPackTests` from `@apackdev/testing/harness` installs an engine with your pack's and its dependencies' entity types, relation kinds and roles, and gives each test a fresh one ([Testing](testing.md)).

### Entity shapes

To get typed attributes on entities, declare shapes in the manifest:

```json
{
  "features": {
    "bookmarks": {
      "description": "Save and organize bookmarks.",
      "entities": {
        "Bookmark": { "shape": "src/features/bookmarks/be/types.ts#BookmarkAttributes" },
        "ImportIndex": {}
      }
    }
  }
}
```

The shapes (yours, your dependencies' and the SDK's) type the query helpers that
`#generated/ears` exports: `query`, `create`, `upsert`, `write`, `transact`, `newId` and `getAttr`.
Rows are a query's: the row with an id is `query.ids(id).pickOne()`, rows of a type `query(type).pickAll()`, and of a type
with a field's value `query(type).where(field, value).pickAll()`; a write reads its entity back with `row()`.
A query reads live entities; `getAttr(id, field)` (one field) and `getRow(id)` (the whole row, from `@apackdev/sdk/ears`)
read an entity by id as it is stored, the trash included, answering `undefined` for nothing there. `@apackdev/ears` exports the
writes unchecked, as `untypedCreate`, `untypedUpsert` and `untypedWrite`, and `transact`. The `find*` helpers leave out rows in the trash, as every query does. A shape the build can't find (a missing module or exported TypeScript type) fails the build. It also
exports the types `EntityShape<E>` (one entity type's shape), `OwnEntityShapes` (this pack's
declared shapes), `PackShapes` (the SDK's, the dependencies' and this pack's), `EntityName`, and
`AllEntities` (the `EARS.Entity` map). Queries written with a declared entity type are checked
against its shape:

```ts
import { EARS, query } from '#generated/ears.ts';

query(EARS.Entity.Bookmark).where('url', u)      // ok — declared attribute
query(EARS.Entity.Bookmark).where('urll', u)     // compile error
query(EARS.Entity.Bookmark).pickAll()[0].title   // typed, no cast needed
query(EARS.Entity.Bookmark).orderBy('createdAt') // BaseEntity fields are included
```

`where`, `orderBy`, `distinct`, `groupBy`, `pickAll`, `pick` and `pickOne` all narrow this way
(`pick`/`pickOne` take only declared fields and return exactly those), and `out(kind, type)` and
`in(kind, type)` narrow to the *target* entity type, so a `pick` after them checks the target's fields. Entity types **without** a
declared shape read as `BaseEntity & Record<string, unknown>`: every field is there, but
you have to narrow a value before using it. An id carries its entity type when it comes
from a typed helper (`newId(EARS.Entity.Bookmark)` returns `EARS.EntityId<'Bookmark'>`),
so builders written with it (`query.ids(id)`, `write(id)`) are typed too;
unbranded ids (`EARS.EntityId`) and `query.all()` read as undeclared.

**A short code is declared in the manifest and numbered by `create`.** Give the entity's entry a `shortCode`
prefix, and leave the field out of its shape: the engine writes it, and your `#generated/ears` adds it to the shape,
typed from that prefix — the build refuses a shape declaring it, since that would be a second account of the
prefix. A prefix is three uppercase letters —
the word's common abbreviation where it has one (`DOC`, `MSG`), otherwise its first letter and next two distinct
consonants (`THR`, `BKM`) — and unique across every pack, the SDK's `FLW`, `ACT`, `PRM` and `DOC` included.

```json
"entities": {
  "Bookmark": { "shape": "src/features/bookmarks/be/types.ts#BookmarkEntity", "shortCode": "BKM" }
}
```

```typescript
export interface BookmarkEntity extends BaseEntity {
  url: string;            // no shortCode: the generated shapes add it, BKM-1, BKM-2, …
}

// Where your own types need the code, name it from the generated facade
import type { ShortCodeOf } from '#generated/ears.ts';
type BookmarkCode = ShortCodeOf<'Bookmark'>;   // `BKM-${number}`
```

`create` numbers every row, and a number is never handed out twice for a type, a destroyed row's included. The code
is the engine's, like the id: no write sets or deletes it, and a created row brings one only on import, as
`create(type, { shortCode })` with a `BKM-<n>` no other row holds. A code is unique, so the typed query finds its row,
and the value index answers it:

```typescript
const bookmark = query(EARS.Entity.Bookmark).where('shortCode', 'BKM-12').pickOne();
```

For a code whose type you don't know — one a user typed, or one found in text — `entityTypeOfShortCode(code)`
(`@apackdev/sdk/services`) names it from every installed pack's prefixes (`'BKM-12'` → `'Bookmark'`), and the query
follows.

### Entity ids

Ids carry their entity type when it's known: from `newId` and `create(entityType).id()`, and
from typed queries (`ids()`, `first()`, `pick` and a row's `id`). The next call is then typed
without naming the shape:

```ts
const first = query(EARS.Entity.Bookmark).first();   // EARS.EntityId<'Bookmark'> | undefined
if (first) query.ids(first).pickOne()?.title;      // typed with the Bookmark shape
```

A plain `EARS.EntityId` (from an event, JSON or a route) carries no entity type and is accepted
anywhere a typed one is, including `includes`/`Set.has` on a list of typed ids. Only an id of a
*different* entity type is rejected:

```ts
const openBookmark = (id: EARS.EntityId<'Bookmark'>) => { … };
openBookmark(idFromEvent);     // ok: a plain id
openBookmark(tagId);           // compile error: an EARS.EntityId<'Tag'>
```

`apack pack build` lists your entities without a shape, whose fields read as `unknown` values.

Declare every attribute you actually write. A field written at runtime but missing from
the interface (a status flag, say) becomes a compile error at its read sites.

### Entity names

The helpers take an entity type as a literal only when your pack or a dependency declares it:
an undeclared name isn't registered at runtime, so a query for it silently matches nothing.
`#generated/ears` exports the accepted names as `EntityName`. A name known only at runtime
(typed `string`) is accepted and reads as undeclared.

```ts
import { EARS, query, type EntityName } from '#generated/ears.ts';

query(EARS.Entity.Bookmark)            // ok
query('Bookmark')                      // ok: declared
query('Bookmrk')                       // compile error
query(nameFromSettings)                // ok: a string, rows read as undeclared

// A generic helper constrains its entity type to EntityName
function newestOf<E extends EntityName>(entityType: E) {
  return query(entityType).pickAll().sort((a, b) => b.createdAt - a.createdAt);  // fields every entity has
}
newestOf(EARS.Entity.Bookmark)[0].title  // callers get the Bookmark shape
```

A helper generic over any string (`<E extends string>(entityType: E)`) is rejected, because
TypeScript can't check a name it doesn't know yet. Constrain it to `EntityName`, or pass
`entityType as string` to opt out. To use another pack's entities, declare that pack in
`dependencies`: this also brings in its shapes.

### Constraints

- Entity types and relation kinds must be globally unique across all installed packs.
- The SDK owns a few entity types and relation kinds, which every pack has and none declares:
  - `Relation`: every link between entities is stored as one (`RelationEntity`).
  - The flow model its flow compiler, flow applier and steps API use: `Flow`, `Node`, `Action` and `Prompt` (`FlowEntity`, `NodeBase`, `ActionEntity`, `PromptEntity`), and the `contains`, `transitions_to` and `instance_of` relation kinds.
  - Your step node types extend `NodeBase` (`interface PingNode extends NodeBase`). Your pack reads `Node` rows as the union of its own and its dependencies' step node types (each pack's facade exports them as `PackStepNodes`), or as `NodeBase` when none define any.
  - The document model: `Document` and `Collection` (`DocumentEntity`, `CollectionEntity`) and the `parent_of` relation kind, which nests folders while `contains` holds documents in them. Store a document without depending on whichever pack edits documents; the app reads them itself, which is how the chat finds the ones whose `documentType` marks them command lists. default-setup's Library is the editor, and what draws the tree is still its own: paths, counts, the index, search, import/export and symlinks.
  - The SDK owns these entities' repositories too, exported from `@apackdev/sdk/repositories`: `flowRepository` (flows, nodes, edges, the root flow, `importFromDSL`), `actionRepository`, `promptRepository`, `documentRepository` and `collectionRepository`. Call them directly; they aren't in `services.repository`, which holds packs' repositories (default-setup's `flowsQueries`, `actionQueries` and `promptQueries` expose them by reference and add their views, so its code uses `repository` alone; a pack of yours can do the same).
  - Notes belong to default-setup (`Note`); a pack depending on it uses them like any dependency's entities. The host owns settings and app state: use caller-bound settings handles and `services.onboarding.isComplete()`, rather than querying their stored rows. API keys aren't entities: the host keeps them ([API keys](#api-keys)).
  - A flow run is not an entity: what each run did is in the run history (`services.runHistory`), a store of its own beside the database, never loaded into the engine.

---

## Migrations

Migrations are synchronous data transformations declared by target version under `migrations.pack`
or `migrations.app`. The selected line determines which version is compared; shipped and external
packs use the same rules.

### Scaffolding

```bash
apack pack add migration 1.2.0       # this pack's version line
apack pack add migration 0.4.0 --app # apack's version line
```

The command writes `src/migrations/<version>.ts` and its manifest declaration. Edit the declaration's
description to explain the change. The version and description live only in the manifest:

```json
{
  "migrations": {
    "pack": {
      "1.2.0": {
        "description": "Add default tags to bookmarks",
        "up": "src/migrations/1.2.0.ts#up"
      }
    }
  }
}
```

The source module exports behavior only:

```typescript
// src/migrations/1.2.0.ts
export function up(): void {
  // Apply the change synchronously, checking first whether it is needed.
}
```

### Rules

- Target the next release: migrations run when `stored version < target <= current version` on their declared line. Pack-line migrations compare against the pack's version; app-line migrations compare against apack's version, regardless of where the pack came from.
- Keep changes idempotent: development boots, prereleases and resets may repeat them.
- The release process owns version bumps; adding a migration does not bump `package.json`.
- Put changes targeting the same version and line in one declaration.

See [manifest migrations](manifest.md#migrations) for execution and failure behavior.

## Preferences

App preferences belong to the host and are available without default-setup. `AppSettings` from
`@apackdev/sdk/types` describes `hotkeys`, `personal` and ordered `projects` (each project has
`name`, `color` and ordered `directories`). The host validates writes with the same declarative
JSON Schema used to generate that type. Pack-wide and feature preferences use declarative schemas
and owner-bound generated handles; see [settings declarations](manifest.md#feature-settings).
