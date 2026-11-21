# Relations through `write`: a relation builder

Status: deferred, 2026-10-24. An alternative to the relation API that landed; designed, not started.

## Where relations are

A relation is not an entity (step 9), and it has its own operations, held by one module (elmdb's `packages/ears/src/relations.ts`):

| Job | How |
|---|---|
| find many | `findRelations(match)` |
| walk from an entity | `query(...).outEdges(kind)` / `.inEdges(kind)` |
| read one by id | `getRelation(relId)`, `undefined` for no such relation |
| create | `write(source).link(kind, target, { info })`: idempotent, both ends checked |
| change ends or info | `updateRelation(relId, patch)` |
| remove | `removeRelation(relId)`, refusing an id no relation has (`NO_SUCH_RELATION`) |
| relation id type | `EARS.RelationId`, which `write` refuses at compile time (`WriteTarget`) |

The engine, `@apackdev/sdk/ears` and the Database console all expose the four operations.

So relations and entities are two families with the same shape: entities have `query` / `getRow` / `write`, and
relations have `findRelations` / `getRelation` / `updateRelation` / `removeRelation`.

## The alternative

A relation has an id and data (`info`), which is the property-graph model. The ISO GQL standard, Neo4j, Apache
TinkerPop, ArangoDB, SurrealDB and TypeDB let the generic, id-addressed operations reach an edge — read it, change it,
delete it — while each kind keeps its own entry point for finding many and its own kind-specific operations:

- **Neo4j:** `Node` and `Relationship` share an `Entity` interface (`getProperty`, `setProperty`, `delete`).
- **Gremlin:** `Vertex` and `Edge` share `Element`, with `g.V(id)` and `g.E(id)` as separate entry points.

Systems whose edges have no identity are the other camp: Datomic references, EdgeDB links, flecs pairs and plain RDF
triples.

The alternative routes relations back through the id-addressed pipe:

| Job | How |
|---|---|
| read one by id | `getRow(relId)` → `RelationRow` |
| change | `write(relId).setInfo(info)`, `.mergeInfo(patch)`, `.reconnect({ source?, target? })` |
| remove | `write(relId).destroy()` |

- **The relation builder** (`RelationWriteBuilder`) holds the operations that apply to a relation and nothing else.
  It keeps the entity builder's vocabulary: writes chain, and `destroy`, `id` and `row` end a chain.
  `reconnect` is held to `link`'s rule: both ends exist when the change commits.
- **Routing.** `write` and `getRow` return by the id's type:
  `<E>(id: WriteTarget<E> | EARS.RelationId) => …`, giving a `RelationId` the relation builder and the relation row.
  At runtime both dispatch on the `Relation-` prefix, so an untyped caller lands on the right builder too.
- **One pipe for changes.** `updateRelation`, `removeRelation` and `getRelation` would go from the engine, the SDK
  and the console, leaving `findRelations` as the relation entry point (as `g.E()` is Gremlin's).
  `admin.updateRelation` stays: it is the unchecked loader.
- **Unchanged either way:** a relation is not an entity. `query` never reaches one; it holds no attributes, roles or
  trash; and storage stays the relations module's.

## Why it was not taken

Both designs fix what was wrong before: a relation's id typed as an entity's, and a builder that type-checked members
it then refused. They differ on whether relations share the entity pipe or sit beside it:

- **Separate operations** need no conditional type in the change-controlled typed contract. They add no runtime
  dispatch on an id's prefix, and they give each operation one meaning, which `RelationId` and `WriteTarget` hold at
  compile time.
- **The builder** keeps "everything goes through `write`", the uniformity the property-graph systems offer. That
  matters most to code holding an id without knowing its kind, which nothing in the repo is today.

## What building it would take, from here

1. **Let `write` and `getRow` take a `RelationId`.** Replace `WriteTarget`'s refusal with the conditional return
   above, in elmdb's `packages/ears/src/runtime.ts`, `typed.ts` and `write.ts`.
2. **Build `RelationWriteBuilder`** over the relations module (`relations.update` and `relations.remove` already do
   the work). Keep a runtime refusal naming the relation operations for an entity member called on a relation.
3. **Retire the separate operations.**
   - Remove `getRelation`, `updateRelation` and `removeRelation` from the engine, the SDK and the console.
   - Migrate `flow-repository.ts`: its edge moves become `reconnect` / `setInfo`, and its removals become
     `destroy()`.
4. **Record it.**
   - Engine specs for the builder.
   - The vocabulary spec over both builders.
   - The ears and root `CLAUDE.md`, and `docs/public-facing/services-and-data.md` and `cli.md`.
   - `api:update` for ears and the SDK.

**The open decision: may a relation's ends move?** Neo4j and Gremlin don't allow it; moving an edge there is a
delete and a create. The flow editor moves edges and keeps their ids, which the canvas is keyed by.

- **Keep it, as `reconnect`:** the canvas keeps its edge ids.
- **Follow the precedent:** the flow repository unlinks and links on a drag, and the canvas copes with a changed id.

**Risks:**
- **The typed contract.** The conditional returns sit in change-controlled files, and
  `packages/apack-sdk/TYPED-EARS.md` records a conditional type that compiled and broke editor completions. Its
  checklist and the facade completion spec have to pass, and `write(id).` must still complete entity members for a
  typed entity id.
- **A cold chain.** The change is in the bottom layer.
- **Performance should be unchanged.** The builder's operations are the relations module's existing writes. Verify
  with EARS' benchmark (its `bench` script, run in elmdb), against the recorded baseline.

## When to revisit

When code that handles ids of either kind generically appears. A table mixing entities and relations, a generic
"delete this row", or tooling over raw ids would each make one pipe worth its type-level cost.
