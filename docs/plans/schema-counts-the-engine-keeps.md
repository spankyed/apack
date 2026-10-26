# The database surface's schema as a view

Status: planned, 2026-10-26, low value. Nothing built. Follows live queries
([archive/plans/live-queries.md](../archive/plans/live-queries.md), Open: "Schema counts the engine keeps").

## Where it stands

The database surface shows what the data holds: the entity types, attribute names and relation kinds present. It
fetches that rather than watching it. The window asks `GET_SCHEMA` when it opens, on refresh, after its own transaction
and after a replacement, and the system replies `SCHEMA_READ`. Another window's write shows on its next ask.

It isn't a view because every source walks the whole store:

- `getSchemaStats` (`apack-ears/src/engine.ts`) reads every row (`query.withTrashed.all().pickAll()`) for attribute
  and role counts, and every relation (`findRelations()`) for each kind's total and its distinct sources and targets.
- Its entity counts come from `database.stats()`, and elmdb's `stats` (`maintenance.rs`, `stats_of`) scans every
  entity, value, relation and index key too.

A view over that would re-run a full scan after every commit anyone makes.

**What the surface reads is names, not counts.** `generateSchemaInfo` (`features/database/be/repository/schema.ts`)
keeps only the keys of `entities`, `attributes` and `relations`. `buildQueryContext` (`be/services/database.ts`) walks
the store only to list the type names. The counts are read only by console code: `apack db`, a `query` flow step,
and the AI query prompts (`content/prompts/db-query-system.ts`) where `getSchemaStats()` is named. All of those are
one-shot reads, where a walk is fine.

## What elmdb keeps already

A per-type live count, the derived key `d/c` (`entities.rs`, `add_count`), maintained on every insert, trash and
destroy and rebuilt by `rebuild()`. `query(type).count()` reads it, and a tracked read of it re-runs a watch only when
that type's count moves. There is no kept count per field, per relation kind or per role.

## The change

1. **Names without a walk (no elmdb change).** Entity types present: each declared type whose kept count is above
   zero (`query(type).count()`, one key each). `buildQueryContext` takes its list the same way. This alone removes the
   walk from the surface's commonest read.
2. **elmdb keeps two more derived counts**: entities holding a field per type (`d/fc type field`) and relations per
   kind (`d/rc kind`). They are maintained in the write paths beside `add_count` and rebuilt by `rebuild()`, which
   `derive.rs` already does for `d/c`. Format 1 is edited in place, as for any storage change before a release.
   elmdb exposes them as reads a watch can track.
3. **The schema becomes a view.** The database feature declares `schema()` in its `views`, reading the kept counts.
   `GET_SCHEMA`/`SCHEMA_READ` and the refresh-after-transaction asks go. `DATABASE_REPLACED` stays for the run
   history and the results a window holds. Another window's write shows at once.
4. **`getSchemaStats` stays a walk** for what it adds over the names: total values per field, per-role counts and a
   kind's distinct sources and targets. It reads the kept counts where they answer, and keeps its signature and the
   prompts' wording.

## Why it is low value

It makes one developer-facing surface live across windows and cheaper to open. No user-facing feature reads the
schema, and the surface already refreshes on its own writes and on replacements. Step 1 is most of the gain for the
least change; steps 2–3 change elmdb's format and the engine's derived keys for a view only the database surface
holds.

## Open questions

- **Attribute names from the declared schema instead.** The engine's schema already lists every type's declared
  fields. If a write can't hold an undeclared field (to check in elmdb's row rules), step 2's field counts only answer
  "which declared fields does some row hold", and the surface may not need that.
- **Trashed rows.** `getSchemaStats` counts them (`withTrashed`). `d/c` counts live entities only: trashing decrements it and restoring
  increments it (`entities.rs`). Decide which the surface shows, since a type whose rows are all trashed drops out
  of step 1's list.

## Done when

- The database surface has no `GET_SCHEMA` ask. A write from another window changes its schema panel without a
  refresh, and a case covers it.
- Opening the surface reads no row values (a case on a watch's tracked read set, or `trackStats`).
- `rebuild()` restores the new derived counts, held by elmdb's derived-key tests.
