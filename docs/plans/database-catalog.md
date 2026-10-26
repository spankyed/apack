# The database's catalog, kept as it writes

Status: planned, 2026-10-26. Nothing built. Follows live queries
([archive/plans/live-queries.md](../archive/plans/live-queries.md), Open: "Schema counts the engine keeps").

## Where it stands

The database surface shows what the data holds: the entity types, attribute names and relation kinds present. It
fetches that rather than watching it. The window asks `GET_SCHEMA` when it opens, on refresh, after its own transaction
and after a replacement, and the system replies `SCHEMA_READ`.

Every answer walks the whole store:

- `getSchemaStats` (`apack-ears/src/engine.ts`) reads every row for attribute and role counts, and every relation for
  each kind's total and its distinct ends.
- Its entity counts come from elmdb's `stats()` (`maintenance.rs`, `stats_of`), which scans every key too.

A view over that would re-run a full scan after every commit.

**The surface reads names, not counts.** `generateSchemaInfo` (`features/database/be/repository/schema.ts`) keeps only
the keys. `buildQueryContext` (`be/services/database.ts`) walks only to list the types. The counts are read by console
code: `apack db`, a `query` flow step, and the AI query prompts (`content/prompts/db-query-system.ts`).

**The declared schema answers every name but the fields.** Entity types, relation kinds and roles must be declared:
the engine refuses any other (`UNKNOWN_ENTITY_TYPE`, `UNKNOWN_RELATION_KIND`, `UNKNOWN_ROLE`). So which ones exist is
the schema, and whether any data holds one is a count. Fields are not: `toElmdbSchema` declares only required,
indexed and searched fields and allows every other (`additionalFields: 'allow'`, `apack-ears/src/schema.ts`), so the
fields the data holds are known only to the data.

elmdb keeps one count already: live entities per type (the derived key `d/c`, `entities.rs`). It's maintained on
insert, trash, restore and destroy, rebuilt by `rebuild()`, and read by `query(type).count()`, which a watch tracks.

## What other databases do

Two things share the word "schema" here, and databases keep them apart:

- **The catalog** is the names and structure: which types, fields and kinds exist. It's exact, cheap and current.
  Examples:
  - Postgres `information_schema`.
  - Neo4j's token stores, which `db.labels()`, `db.relationshipTypes()` and `db.propertyKeys()` read without a scan.
    A property key is registered on its first write.
- **Statistics** are the counts and distributions. Mostly they're estimates, refreshed by an explicit pass:
  - Postgres `ANALYZE` into `pg_stats`: null fraction and distinct values per column.
  - MySQL `ANALYZE TABLE`.
  - SQLite `sqlite_stat1`.
  - MongoDB Compass samples documents to infer fields.

  No mainstream database keeps exact per-field counts on every write.
- **The exception is entity and edge counts.** Neo4j's count store keeps exact counts of nodes per label and
  relationships per type, maintained in the write transaction, because its planner and `count()` read them. MongoDB
  keeps a per-collection count in its metadata. elmdb's `d/c` is already this.

Against that, the candidate steps:

| | standard? |
|---|---|
| Types listed from kept per-type counts | yes: Neo4j's count store, Mongo's collection count |
| Kept relation counts per kind | yes: Neo4j's count store |
| Kept per-field entity counts | no: elsewhere that's statistics, sampled or computed by an explicit pass |
| A full walk for detailed stats, on demand | yes: `ANALYZE`, Compass's sampling |
| A live schema view | unusual. Tools fetch on demand. It's natural here because every read is a view; it costs nothing once the catalog is kept |

## The decision

The catalog is kept on write and can be watched. Statistics are an explicit pass. The engine keeps only what's exact
and cheap in the write path: one key per name, never a per-row aggregate beyond the counts graph databases keep. The
pit of success is that the cheap read answers what UIs and code ask most ("what's here, how many"). The walk is
spelled as what it is, so nobody calls it from a hot path or a view.

1. **elmdb keeps relations per kind** (`d/rc kind`), beside `d/c`: maintained on link, unlink, and a relation's
   removal, including the ones a destroy removes. Rebuilt by `rebuild()` (`derive.rs`, as `d/c` is). This is Neo4j's
   relationship-type count.
2. **elmdb keeps a field registry per type** (`d/f type field`), Neo4j's property-key tokens scoped to a type. The
   first write of a field puts the key: one `get` per field written, and a `put` only the first time. A registered
   name stays when its last value goes, as a token does. `rebuild()` recomputes it exactly, which is the one way to
   prune it.
3. **elmdb exposes the catalog as tracked reads**: the declared types with their live counts, each type's fields
   (declared ∪ registered), the declared relation kinds with their counts, and the declared roles. Reading it
   touches one key per name, so a watch over it re-runs only when a count moves or a field is registered. A schema
   change is a commit past the key log, which every watch already hears.
4. **The engine names the two apart.** A new `catalog()` read on `Ears` returns the step 3 answer and can be watched.
   `getSchemaStats` stays the on-demand pass for what only a walk answers: values per field, per-role counts, a
   kind's distinct sources and targets. Its doc comment says it reads everything and isn't for a view. The console's
   prompts teach `catalog()` first.
5. **The database surface's schema is a view over `catalog()`.** `GET_SCHEMA` and `SCHEMA_READ` go, and so do the
   refresh-after-transaction asks. `buildQueryContext` lists types from it. `DATABASE_REPLACED` stays for the run
   history and the results a window holds. Another window's write shows at once, with its counts.

Format 1 is edited in place for steps 1–2 (root `CLAUDE.md`, Backward compatibility): `rebuild()` derives both keys
from the primary data, so a database crosses by `elmdb dump`/`load` or a rebuild, as for any derived-key change.

## Not chosen

- **Exact per-field entity counts.** That's a write-path aggregate no peer keeps, paid on every attribute write and
  delete, for a number only console code reads. The registry answers which fields exist, and the pass answers how
  many hold one.
- **Declaring every shape field to elmdb** (`additionalFields: 'refuse'`), so the declared schema *is* the catalog.
  This is the stronger long-term position, as in Postgres where nothing exists undeclared. But it changes what an
  untyped write may do, across every pack, and the registry gives the surface its answer without that. It stays the
  direction if a later change wants the engine to refuse unknown fields for its own sake.
- **Names only, from `d/c`, with no elmdb change.** That gives a cheap type list, but fields and kinds still need the
  walk, so the schema still can't be a view.

## Open questions

- **Trashed rows.** `d/c` counts live entities only. The catalog shows live counts, so a type whose rows are all
  trashed drops out of the list. `getSchemaStats` counts the trash (`withTrashed`) and can show it.
- **The run history's database** has its own engine; `catalog()` comes with it, and nothing reads it there yet.

## Done when

- `catalog()` answers types, fields, kinds and roles, and the model-based harness holds it against the model after
  every op, links, destroys and a rebuild included.
- A watch over `catalog()` re-runs on a new type, field or kind and on a count moving, and not on a write that
  changes neither. The second half is checked with `trackStats` or a counted re-run.
- The database surface has no `GET_SCHEMA`. A write from another window changes its schema panel without a refresh,
  and a case covers it.
- `getSchemaStats`'s comment and the console's prompts name it as the full pass, and `catalog()` as the cheap read.
