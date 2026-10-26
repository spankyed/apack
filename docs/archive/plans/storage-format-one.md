# Storage format 1 until a release has users

Status: done, 2026-10-26. Steps 1–3: elmdb `14bd362` and the apack commit that pins it. Step 4: elmdb `c51e0f1` and the
apack commit that pins it.

The app's stored data has one format, 1, and it stays 1 until a release ships to people other than us. Until then, a
change to how data is stored edits format 1 in place, and our own databases are reset or converted once, by hand, on
a copy. The day a release has users, format 1 is locked, and every later layout change comes with an upgrade step.

## Why

A format number and a ladder of upgrade steps exist to carry users' data across versions. There are no users. The
last release anyone ran, v0.3.14, predates every format number, so every database that exists is one of ours.

What the ladder has cost so far:

- apack's own LMDB storage went through formats 1 to 4 in about a month, each with a converter, a spec and prose, all
  written for data only we held. All of it was deleted with the move to elmdb.
- elmdb repeated the pattern straight away. It is on format 2 with `elmdb upgrade` stepping 1 → 2, a step that only
  rebuilds text indexes, which `rebuild()` does anyway (`crates/elmdb/src/upgrade.rs`, `upgrade_format`).
- elmdb's next goal makes it a rule: "a change to stored data's layout bumps `FORMAT_VERSION` with an `elmdb upgrade`
  step" (`elmdb/docs/goals/goal-elmdb-next.md`, G3). Phase 8 there plans format 3 for value compression.
- Each step is code to write, a spec to keep green, a CLI path, and prose describing a history nobody needs. It is
  paid on every change, and it makes every storage change look more expensive than it is.

SQLite, Postgres and the databases elmdb is modelled on all work the same way: the on-disk format moves freely until
a release commits to it, and only then do upgrades exist. Before that, a format number has one job, which is refusing
files a build can't read.

## The rule

**Before a release has users:**

- `FORMAT_VERSION` is 1. It exists only so an open refuses a database it can't read, with a message that says so.
  It is never the first step of a ladder.
- A change to the stored layout edits format 1 in place. The number doesn't move, and no upgrade step is written.
- A change to derived data (an index, a text index's postings) needs nothing at all, since `rebuild()` builds it from
  primary data.
- Our own databases come along by reset, or, when we want the data, by a one-off conversion run on a copy and not
  committed. This is the root `CLAUDE.md`'s existing rule for stored developer data, made the only path.
- Accepted cost: a build can misread a database from before an in-place change instead of refusing it. The fix is
  the same reset. With no users, that's the right trade.

**The day a release ships to users** (its tag is the condition, not a date):

- Format 1 is locked as of that tag.
- From then on, every change to the stored layout bumps `FORMAT_VERSION` and ships with its upgrade step, run on a copy
  and never on open. That is elmdb's current Versions section, which applies from then and not before.
- The rule text in `CLAUDE.md` and `format.md` changes to say the format is locked, naming the tag.

## What changes

### elmdb

- `crates/elmdb/src/format/mod.rs`: `FORMAT_VERSION = 1`. Format 1 is today's layout, the one format 2 describes.
- `crates/elmdb/src/store/mod.rs`, the format check: drop the `upgrading` branch. A database in any other format is
  refused, naming its format and this build's. A newer one keeps "update elmdb to open it". An older one says it is
  from before the format was fixed and must be re-created.
- `crates/elmdb/src/upgrade.rs`: delete `upgrade_format` and `unbuild_text_indexes`, the 1 → 2 step.
- `crates/elmdb-cli/src/main.rs`: `elmdb upgrade <dir>` (one directory, the form that runs `upgrade_format`) goes.
  `elmdb upgrade <dump> <dir>` reads an lmdb-js dump and stays until the move off lmdb-js is done (below), and then
  goes too.
- Specs:
  - delete `upgrade_steps_a_format_1_database_rebuilding_its_text_indexes_with_the_words_as_written`
    (`engine/tests/maintenance.rs`);
  - rewrite `refuses_a_newer_format_saying_to_update_and_an_older_one_naming_the_upgrade` (`store/tests.rs`) for the
    new refusal: a newer format still says to update, and an older one no longer names an upgrade.
- `docs/architecture/format.md`, Versions: replace the table and the paragraph with this rule.
- `docs/architecture/design.md`, principle 7, "Formats are explicit": keep that the format is recorded and checked;
  upgrades start when the format is locked.
- `docs/goals/goal-elmdb-next.md`:
  - G3 becomes this rule.
  - Phase 8 (value compression) changes format 1 in place, with no bump and no upgrade step. Its "Done when" loses
    "the upgrade step's spec converts a database of the previous format" and gains "our databases are reset or
    converted once, on a copy".

### apack

- `packages/apack-ears/src/lmdb/database.ts`: `DATABASE_FORMAT = 'elmdb/1'`. The backup metadata's `storageFormats`
  follows it.
- `packages/apack-cli/tests/commands/db.integration.spec.ts`: no change to what it asserts. It names
  `DATABASE_FORMAT`, so it follows. Check that the case recording another format (`storageFormats: { lmdb: 99 }`)
  still reads as "another format" and not "a newer one".
- Root `CLAUDE.md`, Backward compatibility: add the rule, one paragraph, beside "Stored developer data is not a
  compatibility requirement". Its evidence is this plan.
- `packages/apack-ears/CLAUDE.md`, Persistence: `DATABASE_FORMAT` is `elmdb/1`, and point at the rule.
- The app's database opened in an unreadable format: the API refuses to start, which is right. Check that the
  refusal's own message reaches the user. On 2026-10-25, a refused database showed only a generic "failed to start
  within 60000ms" dialog after a minute of splash screen. If that's still true, it's a defect to fix here, because
  this plan makes "reset your database" the normal answer and the message has to say so.
- `openRunHistory` moving an unreadable run history aside and starting a new one stays. A log is the one store where
  that is the right answer.

### What stays

- The format number and the refusal. A build that can't read a file must say so, not misread it.
- The run history's move-aside, above.
- The pack format stamp (`integrity.json`'s `formatVersion`) is not this plan's subject. The same rule already
  applies to it: it is 1, and nobody bumps it without a direct request.

## Our databases

Wiped rather than re-stamped (2026-10-26): every elmdb or lmdb-js database on the development machine except the
installed app's own — the development profile's (`apack-dev`, its app database, run history and a format-3 backup) and
each `apack-cli` profile's — so each opens a new format 1 database. The installed app's data is converted from its
backup after a release, by hand on a copy. Temporary data dirs a running test or agent holds were left alone.

## The move off lmdb-js

The path from apack's lmdb-js storage (`tools/lmdb-js-export`, `elmdb upgrade <dump>`, `apack db import-runs`) was a
one-time move of our own data, not a format upgrade, kept until the last lmdb-js data we want had moved.

That data was the backup of 2026-10-17 (the two backups of that day are byte-identical). On 2026-10-26 a copy of it went
through the path once: `scripts/ears-convert.ts` at `3e0b280ff` to format 4, `tools/lmdb-js-export`, then
`elmdb upgrade` with no schema, which read 22,816 entities, 178,131 fields and 45,798 relations, the counts apack's own
conversion reports. The result was written out by `elmdb dump`, which this step added to elmdb: a file of the schema and
the primary data as loads, naming no stored layout, so it outlives any in-place change to format 1 (`format.md`, Dumps).
A load of it, dumped again, is byte-identical. It is kept beside the backups, at
`~/Develop/backups/abuddy-backups/elmdb-dumps/`, with a README of how it was made. It is the source of goal-elmdb-next's
production-shaped data (G8) and of the conversion of the installed app's data after a release.

It holds the backup's data in the backup's own contract: its `Note` type, its older short code prefixes and 17 duplicate
short codes (`elmdb/docs/evidence/phase-7.md`). Converting that to apack's current contract is the by-hand conversion
this plan leaves to the lead developer.

Then the path was deleted in one change: `tools/lmdb-js-export` and `elmdb upgrade` (`upgrade.rs`) in elmdb `c51e0f1`,
and `apack db import-runs` in apack. Neither backup holds a run history, so there was nothing for `import-runs` to move.

## Order

1. **elmdb: collapse to format 1.** Change `FORMAT_VERSION`, the format check, delete the 1 → 2 step and its CLI and
   spec, and update the docs. One commit. Run elmdb's own checks and its model harness.
2. **apack: follow it.** `DATABASE_FORMAT`, the `CLAUDE.md` rule, the apack-ears guide, the refusal message check. Run
   the `--no-native` chain.
3. **Our databases** (above): wiped, so the next open makes a format 1 database.
4. **The lmdb-js move path:** the backup moved once and kept as an elmdb dump, then the path deleted (above).

## Done when

- elmdb's `FORMAT_VERSION` is 1, no upgrade step exists, and an open refuses a database in any other format with a
  message naming both formats.
- apack's `DATABASE_FORMAT` is `elmdb/1`, and the chain passes.
- The rule is written in apack's `CLAUDE.md` and elmdb's `format.md`, and goal-elmdb-next's G3 and Phase 8 follow it.
- The development app opens on a new format 1 database.
- An app started on a database in another format shows the refusal's own message.
- The backup is kept as an elmdb dump, and no lmdb-js move path is left in either repository.
