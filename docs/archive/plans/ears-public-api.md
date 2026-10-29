# EARS's API says what it does

> Archive: this records earlier design and behavior. Examples use current EARS names; descriptions of former behavior are historical, not current guarantees.

**Status:** done through phase 3; phase 4 (change 4) is carried out as [`ears-naming-axes.md`](ears-naming-axes.md)'s phase 1. Source read
at `ff45e4ff7` (2026-10-22). Call-site figures come from a TypeScript AST pass over every `.ts`/`.vue` file
outside `dist/`, `__generated__/` and `node_modules`, on that tree; the typecheck is the exact count once a
signature moves.
**Scope:** the public API of `@apackdev/ears`: the engine, the write builder, the query builder's entry
points and semantics, the typed facade, and what the LMDB store records to back them. Persistence
durability, query performance and a disk-resident engine are outside it (see
[What this is not](#what-this-is-not)).

## Why

EARS is the most reusable thing in this tree, and its API is the part a newcomer can't use without reading
the source. Every quirk below is either a name that promises something the code doesn't do, or one
argument that means two things depending on state the caller can't see. Inside this repo the typed facade
and the people who wrote it absorb that; a pack author doesn't have either, and nor would anyone installing
the package from npm.

Four rules decide every change below:

1. **A name promises its semantics.** the former write shorthand promises atomicity, `where` promises a predicate, `put` with a
   flag promises nothing at all.
2. **One argument, one meaning.** A string is a type or an id because of where it's passed, never because
   of what the engine happens to have registered.
3. **The engine you hold is the engine you use.** `@apackdev/ears` has no ambient state; "the app's engine"
   is a concept one layer up.
4. **A name the engine cannot account for is an error.** Not an empty result, and never a write.

A fifth falls out of the data check: **one fact, one record.** Every inconsistency the stored data showed
(below) is a fact kept in two places that drifted apart.

No backward compatibility: every caller, test, fixture, template and doc moves in the same change, per the
root CLAUDE.md.

## What the stored data says

Measured 2026-10-22 on copies of two data dirs, read-only, with a probe outside the tree:

| | prod primary | prod trace | dev primary | dev trace |
|---|---|---|---|---|
| entity rows | 98,935 | 19,687 | 616 | 53 |
| attribute rows | 256,788 | 188,009 | 2,636 | 383 |
| relations | 45,798 | 31,332 | 320 | 66 |

"Prod" is the long-lived `abuddy` data dir (`ears-db` 306 MB, `ears-trace` 72 MB); "dev" is `apack-dev`. The
prod files were copied while the app may have been running, so a torn page was possible; nothing read
inconsistently.

**The type is safe to store, and already is.** Every id with an attribute has an `entities` row, every row's
`type` equals its id's prefix, no id lacks a dash, and no type name contains one, in all four environments.
Moving the type off the id needs no conversion of the type itself.

**But four facts are kept twice, and each pair has drifted:**

1. **`entityType` is missing as an attribute on 20,284 prod primary entities** (Terminal, Message, …) **and
   on every one of 19,615 trace TNodes.** The attribute was stamped by only some creation paths over time, so
   a row read today has no `entityType` for those entities while the index knows their type.
2. **`createdAt` disagrees between the attribute and the row on 22,679 prod entities.** The row's value is
   the time of the flush that wrote it (milliseconds later); the attribute's is the time of `create`, or an
   original timestamp an importer preserved (`threads/be/import-threads.ts:125`). The attribute is the
   authoritative one, and the only one any code reads.
3. **Relation details are stored twice, and 29,814 of the copies are in the wrong environment.** Each
   relation is a row in the `relations` table *and* a `relationDetails` attribute. The row is routed by its
   endpoints (a relation touching a TNode goes to the trace environment) and the attribute by the relation's
   own id (`Relation` → primary), so every `instance_of`, `spawned` and `tracked` edge of a run (11,266,
   11,231 and 7,317) leaves its attribute copy in primary. Trace isn't hydrated at boot, so those load as
   29,814 `Relation` entities whose endpoints don't exist and which no relation index holds.
4. **Entity rows exist for things that were never created.** `onAddRelation` ensures a row for both
   endpoints (`lmdb/adapter.ts`), so trace holds 71 `Flow`/`Node` rows for entities that live in primary,
   and prod primary holds 506 `Relation` rows whose relation is gone.

**Duplicate edges:** prod primary has none. Trace has one pair, `TNode-Root instance_of Flow-root-…`, 36
times: the root TNode is recreated on every boot because trace isn't hydrated
(`brain/be/repository/index.ts:479-507`, where `findById` misses), and each boot's edge persists to a
partition nothing reads back. That is not what `link`'s default decides, and it is
[`ears-persistence-and-history.md`](ears-persistence-and-history.md)'s subject, not this plan's.

## The changes

Ordered by how much damage the current behaviour can do, not by implementation order
([Phases](#phases) has that).

### 1. the former write shorthand becomes a builder, and a transaction becomes real

**Today.** Every builder method writes memory and calls the persistence sink immediately
(`transaction.ts`, `self.put` onward). There is no commit and no rollback, so a chain that throws partway
(`safeLink`'s cycle check, `link`'s self-loop check, a caller's own throw between two builders) leaves
everything before the throw in memory and, a microtask later, on disk.

The LMDB adapter has two more paths that a unit would have to survive and today can't:

- **A destroy writes immediately**, in its own `transactionSync` (`onDestroyEntity`), not through the
  buffered flush. A unit that destroys an entity and then throws has already deleted it from disk.
- **A failed flush is retried row by row** (`runSteps`), which is right for unrelated writes buffered in one
  microtask and wrong for a unit: it turns one refused row into a partly applied unit.

**Change.**

- `engine.transact(fn)` runs `fn` as one unit. Inside it, memory still mutates immediately, so `fn` reads
  its own writes synchronously, and every mutation also appends its inverse to a journal. If `fn` returns,
  the journal is dropped and the sink receives the unit's calls together; if it throws, the journal is
  replayed in reverse, the sink receives nothing, and the error is rethrown.
- Every storage write needs an inverse, including the compound ones: `destroyEntity` (its attributes and
  every relation it removes), `merge` at an index, `updateRelation`, and a role grant that revokes elsewhere.
  The contract suite gets one rollback case per write.
- The sink receives the unit as a unit: the engine holds the unit's sink calls and forwards them on commit,
  ending with `onCommit()`, a new `PersistenceSink` member. The LMDB adapter applies a committed unit in one
  `transactionSync` per environment, with a destroy buffered like every other write and **no per-row
  fallback**: a unit that fails to write is reported whole through `onWriteFailure`. Writes outside a unit
  keep today's isolation.
- **Atomicity stops at an environment.** A unit touching a TNode and a Node writes to two LMDB environments,
  which cannot commit together. `transact` promises an atomic unit in memory and per environment, and says
  so; what happens when one environment commits and the other fails is the persistence plan's to define.
- Nested `transact` joins the outer unit. `transact` is synchronous; an `async fn` is refused (a returned
  promise throws), because an `await` would split the unit silently.
- Outside `transact`, each builder call is its own unit, which is what happens today, now stated rather
  than implied.
- The journal exists only while a unit is open, so code outside `transact` pays nothing. The benchmark
  (`npm run bench -w @apackdev/ears`, +10% median tolerance) covers both paths, with a new case for a
  1,000-write unit.

The builder stops being called the former write shorthand (see 2). The word "transaction" belongs to `transact` alone.

### 2. One argument, one meaning

**Today.** `write(typeOrId, useProvidedId)` and `query(start)` decide what a string is by asking
`isEntityType` at runtime (`transaction.ts`, `transaction()`; `query.ts`, `resolveStart`):

- `create('Memo')` on an engine without that type writes attributes to an entity whose id is `"Memo"`.
- `query('Memo')` returns nothing instead of failing.
- `query(['Note', 'Task'])` is a list of types only if *every* item is a registered type; one unregistered
  name turns the whole list into ids.
- `create(type, { id })` is a boolean meaning "this id is new": 95 call sites, of which 9 are production code (plus
  one through `createEntityWithDefaults(…, providedId)`), 47 are tests and 39 are ears' own tests.
- `query.all()` with no argument means every entity, relations included: 17 real calls.

**Change.** Each meaning gets its own entry point, and each refuses what it can't account for:

| Today | After | An unaccountable argument |
|---|---|---|
| New entity by type | `create(type)` | an unregistered type throws `UNKNOWN_ENTITY_TYPE` |
| New entity with a caller-selected id | `create(type, { id, createdAt? })` | as above; an id already in use throws |
| Existing entity or creation by id | `upsert(type, id)` | as `create` when absent; an existing id of another type throws |
| Write an existing entity by id | `write(id)` | an id not in the engine throws `NO_SUCH_ENTITY` |
| Read entities of declared types | `query(type)`, `query([types])` | any unregistered type throws, `undefined` included |
| Read selected entity ids | `query.ids(idOrIds)` | absent ids are dropped (a query over ids is a filter) |
| Read all entities | `query.all()` | — excludes `Relation`, which `findRelations` serves |

**`upsert` exists because five production sites already hand-write it**: the host's `AppState-app`
(`app-state/index.ts:103`), `Settings-app` (`features/settings/be/store.ts:104`) and
`AppliedContent-<packId>` (`app-state/applied-content.ts:110`), the browser's tab sync
(`browser/be/repository/commands.ts:33`, a frontend-supplied id), and the root TNode
(`brain/be/repository/index.ts:498`, which then used the former write shorthand and relied on implicit
creation). Each is a singleton or a caller-keyed row, which is the case `create` and `write` each refuse
half of.

**`write` throwing for an absent id finds bugs, and the audit found two.**
`brainCommands.updateTNodeStatus` and `updateTNodeAttributes` (`brain/be/repository/index.ts:532-560`)
write to TNodes from asynchronous step completions with no existence check, so after `clearVolatileData` or
`DATA_REPLACED` they resurrect orphans: attribute-only entities with no row and no `entityType`.
`tnodeRepository.updateTNodeResult` already checks. Both get the same guard, and that fix needn't wait for
this plan. Every other write by id (the format applier, trash, the update step, the actions, prompts,
threads, notes and code repositories, the library/notes/threads importers through `hasIdCollision`) checks
first or writes an id it just created. Backup import and restore use admin bulk loads, not the former write shorthand, and no
migration or seed calls it. `write(id).destroy()` on an absent id throws like any other `write`; every
current destroy checks first (threads `system.ts:809`, the search index, the CLI's `destructive.ts:156`).

**One flow path changes from silent to loud**: the Flows surface's DSL import (`flows/be/system.ts:326` →
`flowRepository.importFromDSL`) has no collision check, and compiled ids depend only on the flow's name, so
re-importing a flow of the same name overwrites it in place today. Under `create` it would throw partway. It
runs inside `transact`, destroys the existing flow first as `flow-applier.ts` already does, and so replaces
the flow whole or not at all.

The typed facade already gives ids and names different types (`TypedTx`'s two overloads in `typed.ts`), so
splitting the functions makes the compiler list every typed call site. Only `untyped*` calls with a
`string` argument need reading by hand.

**The current permissiveness is documented as deliberate, and the split is the answer to its reason.**
`packages/apack-ears/CLAUDE.md` states it outright — an unknown name "could equally be a typo, an id with no
type prefix, or a type whose pack isn't installed, and the engine can't tell which" — and names the specs
that pin both sides (`tests/engine/queries.spec.ts:36` pins `query('Memo').ids()` as `[]`, and
`transactions.spec.ts` the write). That reason is a statement about *one* entry point carrying two meanings:
the engine cannot tell which was meant because the caller was never asked. Separate entry points ask, which
is what makes refusing correct rather than merely stricter — `query(type)` is a claim about a type and
`query.ids(…)` a claim about ids, and each can be held to its own claim. So that paragraph and those cases move
in this change, with their rationale replaced rather than deleted.

**`query.all()` excluding relations breaks no caller.** Every production `query.all()` narrows by a role or a
relation (`withRole` at `flow-repository.ts:132,221`, `flow-to-dsl.ts:354`, threads `repository/index.ts:55`,
`apack-testing/src/app.ts:269`; `relatedTo(id).ofType(Artifact)` at threads `:315,416`), and none wants a
`Relation` row. What moves: `apack-ears/tests/engine/queries.spec.ts:27,37`, which count 5 entities plus 3
relations as 8, and the comment at `apack-host/src/database/schema.ts:35`, which describes `query(undefined)`
answering with the whole database.

This makes [Part 1 of `undeclared-entity-names.md`](undeclared-entity-names.md#part-1--ears-refuses-a-name-it-cannot-account-for)
the engine's default behaviour; that plan's Parts 2–3 (the console's schema) are unaffected.

**That plan lands first, and this does not wait for it**, because the two fix different things: its Parts 3
and 2 make the console *answer correctly* on a data dir with no snapshots, and nothing here can — the
engine's refusal only stops a wrong answer. Its Part 1 is then a diagnostic: the engine catches
`query(undefined)` once `query.all()` exists, and what the console's `Proxy` adds is a message naming the known
types and `--schema-from`, which an engine that sees only `undefined` cannot produce. It also closes that plan's first recorded adjacent bug — `TypedQx` accepting
`undefined` as a start — for free, since the no-argument overload is what the typed facade widens.

Nothing in the former query shorthand stands in the way: `setIds` re-enters with `start === undefined` on every chained step
(`query.ts:74-75`), but it re-enters the internal `qxImpl` with `known` already resolved, and the public
the former query shorthand is a one-argument wrapper over it (`query.ts:276`). So `query.all()` is a change to the public entry
alone, and the chaining is untouched.

### 3. One record of each fact

**Implemented** (the phase this plan called "stored type"), and the code changed the plan on the way. This
section first proposed moving an entity's type off its id into a stored map. By the time it was built, the
id had become the frontend's record of the type: `entityTypeOf` is exported through `@apackdev/sdk/fe` and
routes `openEntity(id)` (`apack-sdk/src/fe/navigation.ts`), and reference nodes keep ids inside stored
documents. An id therefore has to go on naming its type as long as any document holds one, and a stored type
beside it would be a second record of the same fact, which is the problem this phase exists to remove. So
**the id is the type's one record**, and the rest of the phase removes each other record:

- **One parser.** `entityTypeOf` (`attribute-storage.ts`) is the only code that reads an id's type; the
  router's and the policy's private copies are gone (`PartitionPolicy.routeEntity` takes a type). `create`
  refuses an id naming another type, which is what keeps the contract true.
- **`entityType` is read from the id**, on every row and through `getAttr`/`getAttrs`/`where`, and stored
  nowhere. That fixes the 39,899 stored rows that lacked it without touching them.
- **`createdAt` stays one attribute**, written by the engine (`create`, or `create(type, { createdAt })` for
  an import). Entity rows no longer carry the flush-time copy that disagreed with it on 22,679 entities.
- **A relation is its row in the relations table.** Its details are no longer persisted as an attribute,
  which is where the 29,814 misrouted copies came from, and it has no entity row. A removed relation leaves no
  entity behind in memory either.
- **An entity row is `{ type }`, written by `onCreateEntity` and nothing else**: no rows for a relation's
  ends, none for an attribute write.

**Stored data.** `LMDB_FORMAT_VERSION` is 2. A database that records no format and holds data is format 1
and is refused at open, naming the conversion; a new, empty one is stamped 2. `convertToFormat2`
(`@apackdev/ears/lmdb`) converts one environment in place, and `scripts/ears-format-2.ts` runs it over a
data dir's partitions. Nothing at boot calls it, per the root CLAUDE.md's rule for stored developer data.

Run 2026-10-22 on a fresh copy of the prod data dir: primary lost 2,533 `entityType` attributes, 75,612
relation-detail attributes and 76,118 relation rows, and rewrote 22,817 entity rows; trace lost 1
`entityType` attribute and 71 endpoint rows and rewrote 19,616. Hydrated afterwards, the primary partition
holds 45,798 relations, the relations table's count (it held 75,612 before, the phantoms included), none
with a missing end, and rows read with `entityType` and `createdAt`.

### 4. The package holds no ambient engine

**Today.** Every free export (`untypedQuery`, `untypedWrite`, `repository`, `findRelations`, `grantRole`,
`spawn`, the graph walks, the `defineEars` facades) acts on a module-level engine set by `installEngine`
(`installed.ts`) and throws `NO_ENGINE_INSTALLED` without one. `createEarsEngine()` returns a working
instance, but most of the API ignores it, and two engines in one process means swapping the global (17
files call `installEngine`: 6 in host, 4 in the SDK, 4 in ears' own tests, 2 in the CLI, 1 in
publish-checks).

**Change.**

- `@apackdev/ears` exports the engine factory, its types and pure helpers; everything that reads or writes
  data is a member of `engine.query` or `engine.admin`. `installed.ts` leaves the package.
- `defineEars<Shapes, Names>()` takes the engine to bind: `defineEars<S, N>(() => query)`. A getter rather
  than a value, so a facade can be generated before the engine exists, which is the case for every pack.
- "The app's engine" moves to `@apackdev/sdk/runtime`, beside the bus and the services it already binds
  (bind resources, derive behaviour): `bindHost` holds it, `startTestRuntime` replaces it, and the generated
  `#generated/ears` passes the SDK's getter. Pack code doesn't change shape; it imports the same names from
  the same generated module.
- The `untyped*` twins stay as SDK exports over the bound engine, since that's where a pack reaches them.
  Host code that holds an engine calls its members directly.
- Tooling that installs a private engine today (the CLI's flow compiler, `exportFlowsToDSL`) passes it
  instead, which `exportFlowsToDSL(dir, { engine })` already does.

### 5. One builder vocabulary

**Today.** `transaction.ts`'s builder has 22 members with overlapping meanings:

- `put` and `update` call the same storage function (`updateAttr: put` in `attribute-storage.ts`), and
  `batchPut` and `updateBatch` are the same loop over them.
- `put(k, v, true)` is `add(k, v)`.
- `merge`, `drop` and `dropIf` take `v: unknown` while `put` and `add` are field-typed (`runtime.ts`,
  `TransactionBuilder`).
- Three ways to link: `link` appends a duplicate edge, `linkOne` replaces the edges of that kind to that
  target with one (`edge-store.ts`), and `safeLink` adds cycle and symmetry options.
- Three ways to unlink (`unlink(relId)`, `unlinkIf(kind, target?)`, `unlinkWhere({ kind?, target? })`)
  and two ways to patch (`relPatch` by relation id, `patchLink` by kind and target).
- `ensure(role, scope?)` revokes the role from every entity in the engine when no scope is passed.
- `define` bundles attributes, links and roles (3 callers).
- `destroy(skipPersistence?)` is typed `never`, so code after it reads as unreachable, and its flag is an
  admin concern on the pack-facing face (2 callers pass it).
- Attribute names share a namespace with the engine's own kinds: `put('role', x)` writes a role and
  `put('relationDetails', x)` overwrites a relation's endpoints.

**Change.** Named after the root CLAUDE.md's naming rules (`set`/`delete` for keyed stores):

| Member | Replaces | Note |
|---|---|---|
| `set(k, v)` | `put`, `update` | |
| `setMany(record)` | `batchPut`, `updateBatch` | |
| `add(k, v)` | `add`, `put(k, v, true)` | |
| `merge(k, partial, index?)` | `merge` | field-typed |
| `delete(k)` | `drop(k)` | the whole attribute |
| `deleteAt(k, index)` | `drop(k, i)` | field-typed |
| `deleteValue(k, v)` | `dropIf` | field-typed |
| `link(kind, target, { info?, replace?, acyclicIn?, symmetric? })` | `link`, `linkOne`, `safeLink` | see below |
| `unlink(kind, target?)` | `unlinkIf`, `unlinkWhere` with a kind | |
| `unlinkAll()` | `unlinkWhere()` | |
| `grant(role)`, `revoke(role)` | same | |
| `grantExclusive(role, among)` | `ensure` | `among` is required |
| `destroy({ keepStored? })` | `destroy` | returns `void`. `keepStored` (was `destroy(true)`) stays on the builder: the brain clears run records from memory and leaves them on disk, and a pack has no admin face |
| `id()` | same | |

**`link` is idempotent on the whole edge: kind, target and `info`.** Linking an edge identical to one that
exists does nothing, keeping its relation id and its position. A different `info` is a different edge, and a
`link` with no `info` matches any edge between the ends (which is what `addRelation` already did). `link`
refuses an options object with keys it doesn't know, since that is what `info` passed positionally — the old
signature — looks like when the value is typed `any`.
`replace: true` gives `linkOne`'s behaviour: remove that kind's edges to that target, then add this one.
The audit of every caller decided each part of that:

- **`info` is part of the identity because flow edges need it.** `transitions_to` is a multigraph keyed on
  handle: `flowRepository.createEdge` (`flow-repository.ts:358`) refuses only an edge with the same target
  *and* handles (`assertEdgeAllowed`, `:58-80`), and the compiler emits `exit-<n>` handles from one listener
  that can reach the same step twice (`flow-compiler.ts:406-411`), written by `importFromDSL` (`:239`).
  Keyed on the pair alone, linking A→B on `case-1` would delete A→B on `case-0` without an error.
- **No-op rather than replace, because order is data.** A thread's `contains` edges are its message order
  (`relinkMessageToEnd`, threads `repository/index.ts:585-590`, which depends on a re-link moving the edge to
  the end). Replacing an identical edge would mint a new id and move it.
- **No `duplicate` option**: no caller wants two identical edges, and prod data holds none. The counts that
  read relations (`forkCount`, threads `:246`; `documentCount`/`childCount`, library `queries.ts:135`,
  `commands.ts:260`; notes `queries.ts:15`) count distinct pairs, so duplicates could only have inflated them.
- **`replace: true`** is what the two `linkOne` callers mean (library `commands.ts:139`, `link-utils.ts:36`).
  The "unlink, then link" moves (library `:329,417`, threads `:273`, notes `:43`) keep working and can use it.
- `createRelation` (`transaction-helpers.ts`) delegates to `link` and inherits all of this.

**Found during the reshape:** `flowRepository.deleteNode` and `flowEdges` took
`findRelations({ src, kind, tgt })[0]` once per link entry, and `.links()` yields one entry per edge, so two
handle edges between the same nodes collected one relation id twice: the second edge survived a delete and was
missing from the list. Both walk `findRelations` directly now.

The relation-id operations (`unlink(relId)`, `relPatch`) become `removeRelationById(relId)` (which already
existed) and `updateRelation(relId, patch)`, free functions and query-face members, since they don't act on the
builder's entity. `patchLink`'s one real caller (`reindexHandles`) already held the relation's id, so it uses
`updateRelation` too and the builder gets no `retarget`. `define` is deleted; its callers write `setMany`,
`link` and `grant`.

`ensure` has no production caller: the console's examples (`database/fe/components/query-editor/transaction-examples.ts:59`),
the transaction prompt (`content/prompts/db-transaction-system.ts:78`), `docs/public-facing/services-and-data.md:334`
and ears' own specs. `flowRepository.grantRootFlowRole` (`flow-repository.ts:220-224`) hand-writes the same
exclusivity over `query.all().withRole(ROOT_FLOW)`, and becomes `grantExclusive(ROOT_FLOW, query('Flow').ids())`.
`BlueprintBuilder.ensure` is a different builder (`bp`, `spawn`) and keeps its name.

**Reserved names.** `set`, `setMany`, `add`, `merge` and the `delete*` family refuse the engine's own kinds
(`role`, `relationDetails`), the metadata (`entityType`, `createdAt`) and `id`, throwing `RESERVED_ATTRIBUTE`.
Refusing costs no storage format change; namespacing the keys would. Nothing writes `role` or
`relationDetails` as an attribute today. What does write the others, and what each becomes:

- **Redundant restatements** of the type or the creation time, removed: threads `repository/index.ts:164-169,
  638,807,920,924`, `flow-repository.ts:176-181,269-271`, code `repository/index.ts:58`, library
  `commands.ts:75,193,443`, the host's three singletons and the root TNode's `batchPut` (`brain` `:499-506`).
- **A preserved timestamp** becomes `create(type, { createdAt })`: `import-threads.ts:125` (the thread
  itself is created through `threadCommands.create({ id })`, which stamps now, so an exported thread's
  `createdAt` is already lost on import; this fixes that too) and the flow compiler's rows
  (`flow-compiler.ts:281,285`, every trigger's `compile`, the CLI's trigger template), which
  `importFromDSL` (`flow-repository.ts:235-236`) passes to `create` instead of `setMany`.
- **A read row written back**: the library search index spreads a `pickAll()` row into `updateBatch`
  (`search-index/repository.ts:331,426,467,493`), which carries `id`, `entityType`, `createdAt` and roles.
  Those sites write the fields they mean to change.
- **User-configured step fields**: the create and update steps pass a user's fields to
  `createEntityWithDefaults`/`updateEntity` (`extensions/steps/create/runtime.ts:33`, `update/runtime.ts:29`).
  Their build facets' `validate` refuses a reserved field, so a flow says so when it is saved rather than
  when it runs.

### 6. Query semantics that read as written

**Today.** `where(k)` with no value means "has this attribute", so `where(k, undefined)` can't ask for
absence; matching is `===`, so an object or array value never matches; `page()` cursors are base64 of an
offset (`query.ts`), so a write between pages skips or repeats rows.

**Change.**

- `has(k)` and `lacks(k)` for presence; `where(k, v)` requires `v` and refuses `undefined`. No caller passes
  a possibly-undefined value. The single-argument callers are the Database surface's generated queries
  (`database/fe/constants.ts:7,23`, `graph/constants.ts:9,16`, which become `query.all().has('…')`), the query
  prompt (`db-query-system.ts:46`), ears' own spec and the completion fixtures (`facade-packs.ts:370,383`).
- `where(k, predicate)` for anything `===` can't express, so object values have an answer.
- `page()` is deleted: its only caller is `apack-ears/tests/engine/queries.spec.ts:104-107`. A cursor that
  survives writes needs a stable order key, and nobody has asked for one.
- The builder stays eager and synchronous. How filtering performs is
  [`ears-attribute-filtering.md`](ears-attribute-filtering.md)'s subject; its "no API change" premise holds
  for its own work, which can land before or after this.

### 7. Everything that teaches the API moves with it

Users type this API, and an LLM is taught it. The console (`apack-sdk/src/database-console/index.ts:44-72`)
exposes `query: untypedQuery` and `write: untypedWrite` to code run by `apack db exec`/`script`/`repl` and the in-app
Database console, so renaming the former write shorthand changes what a user writes there. Every one of these moves in Phase 3,
in the same commit as the code:

- **The console**: its globals; `WRITE_HELPER_NAMES`, which the query step refuses
  (`extensions/steps/query/runtime.ts:21,67`); `default-setup/tests/defs/database-console-globals.spec.ts`;
  `apack-sdk/tests/database-console/database-console.spec.ts`; the CLI's help text
  (`commands/db/code.ts:18`, `db/script.ts:32`, `db/repl.ts:15`) and `db.integration.spec.ts`.
- **In-app teaching**: the transaction prompt (`content/prompts/db-transaction-system.ts`, which lists
  `put`/`batchPut`/`updateBatch`/`drop`/`link`/`linkOne`/`safeLink`/`unlinkWhere`/`ensure`), the query
  prompt (`db-query-system.ts`), the console's examples (`transaction-examples.ts`) and generated queries
  (`database/fe/constants.ts`). Changing a prompt moves its compiled row's hash, so
  `content-parity:update` re-records there.
- **Docs**: `docs/public-facing/cli.md`, `services-and-data.md` and `getting-started.md`;
  `packages/apack-sdk/TYPED-EARS.md`; `packages/apack-ears/CLAUDE.md`, `packages/default-setup/CLAUDE.md`
  and the root CLAUDE.md's the former write shorthand/`untypedWrite` twin.
- **Type fixtures**: `apack-cli/tests/_support/facade-packs.ts`.

The CLI's pack templates need nothing (their repository template is empty), nor does `generate-entries`.
`CHANGELOG.md` is the release process's.

## Phases

Each phase leaves the chain green and is one commit.

| Phase | What | Depends on | Done when |
|---|---|---|---|
| 0. Check the data | The stored-data probe | — | **Done 2026-10-22**: [What the stored data says](#what-the-stored-data-says) |
| 1. `transact` | 1, with the adapter's unit flush and buffered destroy | — | **Done** (`110ee8f1a`): a throwing unit leaves memory and the LMDB files as they were (one case per write, each mutation-checked); a returning unit reaches one LMDB transaction per environment; writes outside a unit cost what they did |
| 2. The reshape | 2, 5, 6 and 7 in one migration of every call site | 1 | **Done** (`467f2be2d`): no the former write shorthand, `put`, `update`, `batchPut`, `updateBatch`, `linkOne`, `safeLink`, `unlinkIf`, `unlinkWhere`, `relPatch`, `patchLink`, `ensure`, `define`, `page` in the tree; the reserved-name and unknown-name refusals each have a firing case; DSL re-import replaces a flow whole |
| 3. One record of each fact | 3: one id parser, `entityType` read from the id, one record per relation, no endpoint rows, format 2 and its conversion | 0, 2 | **Done**: every doubled fact reads zero on a converted copy of the prod data, which hydrates with no phantom relations |
| 4. No ambient engine | 4 | 2 | Carried out as [`ears-naming-axes.md`](ears-naming-axes.md)'s phase 1, which supersedes change 4's `engine.query` |

**The reshape comes before phase 3**, because phase 3's sink takes the type at create, and only after the
split does every creation (`create`, `upsert`) name one. `transact` comes first because the reshape's DSL
re-import uses it.

The TNode updaters' existence guard (see 2) landed first, on its own (`6ad0a966a`).

Phase 3 is one pass on purpose: entry points (2) and builder members (5) appear on the same lines, and
moving them in two passes touches every line twice. Its size, as write-family calls outside the engine's own
source:

| Package | Source | Tests |
|---|---|---|
| default-setup | 130 | 30 |
| apack-sdk | 35 | 44 |
| apack-host | 7 | 25 |
| apack-cli | 1 | 11 |
| api | 0 | 16 |
| apack-ears | — | 165 |
| apack-testing, `tests/` | 0 | 6 |

Phase 4 changes imports, not call shapes, so it stays separate and reviewable.

Every phase that moves a public export runs `npm run api:update` (ears and SDK) and
`npm run facade:update -w @app/default-setup`, and reads the diff. Phases 1 and 3 change written rows (the
`entityType` attribute stops being stored; the prompts change), so `content-parity:update -w
@app/default-setup` re-records deliberately in those two and nowhere else.

## Decisions

- **The storage format goes to 2**, with the one-off conversion above run on a copy of the prod data. This
  is the one change here that touches data on disk.
- **The builder names: `create(type)`, `upsert(type, id)` and `write(id)`.** `write` reads well in a chain
  (`write(id).set('title', t)`) and doesn't collide with `updateEntity`; `upsert` is the conventional name for
  what five sites hand-wrote.
- **`EntityId` keeps its `${string}-${string}` template.** Every id in the data has a dash, literal ids
  (`'TNode-Root'`) keep compiling, and the split already turns `query.ids('user-note')` into a compile error, which
  is what TYPED-EARS.md's Incidents asked for. The untyped twins reject an id-shaped name through
  `TypeName<E>` (`write.ts`).

## What this is not

- **Durable persistence.** [`ears-persistence-and-history.md`](ears-persistence-and-history.md) owns flush
  barriers, failed-save state and cross-environment behaviour, including what a unit spanning two
  environments promises when one fails, and the trace partition's per-boot root edge. `transact` gives it the
  logical unit it asks for; it doesn't make writes durable.
- **The console's transactions.** [`goal-console-transactions.md`](../../goals/goal-console-transactions.md)
  becomes a caller: console code runs inside `transact`, and its Phase 1 is this plan's Phase 2.
- **A disk-resident engine** ([`goal-lmdb-only.md`](../goals/goal-lmdb-only.md)). Everything here is
  storage-agnostic; doing this first gives that goal a smaller API to reimplement.
- **Reactivity, a query language, or publishing EARS on its own.** A standalone package also needs a README
  that doesn't assume AgentBuddy and a name that isn't already a well-known requirements-syntax acronym.
  Both are easier once the API says what it does, and neither is in scope here.
