# `apack db` writes beside the running app

Status: deferred, 2026-10-26. Nothing built. Revisit when a person needs to change the database from a terminal
without quitting the app; an agent already can, through the drive server's `/transact` (`docs/public-facing/cli.md`,
"`/query` and `/transact` reach the live database").

## Where it stands

A command that changes the database (`apack db exec`, `script`, `repl --write`, `reset`, `import`,
`clear-settings`) is refused while an app runs on the data dir (`openTarget`, `packages/apack-cli/src/commands/db/target.ts`), and the app refuses to start while a tool holds
the database's write lock (`assertNoDatabaseWriter`, `@apackdev/host/database`, called by the API's composition). A
read is allowed, and sees what the app has committed.

The refusal's reason is the engine that held the database in memory: an app running beside a tool would overwrite the
tool's change from its copy, or lose it. That engine is gone. The engine reads and writes its store and keeps nothing
of the data, numbering sequences and index markers included (`packages/apack-ears/CLAUDE.md`, "An instance"), and
LMDB serializes writers across processes, on lmdb-js and on elmdb ("Several processes may open one database",
`elmdb/docs/architecture/engine.md`). Two processes writing one database is safe for the data.

`openTarget`'s doc comment still gives the old reason ("which holds the database in memory"); it is corrected with
the refusal it describes.

## What lifting the refusal breaks

**The app hears only the commits it makes.** Everything that keeps a window current listens in-process:

- **Views.** A watch re-runs when a commit names what it read, and it learns of a commit from its own store's
  commit listener (`OrderedKV.onCommit`, `packages/apack-ears/src/watch.ts`; on elmdb, a local commit's change set).
  A tool's commit reaches the files and no listener: every open view keeps its last result.
- **What systems hold.** The settings store caches the overrides by a revision its own writes advance
  (`features/settings/be/store.ts`), and the systems learn that the data under them changed from the bus's
  `DATA_REPLACED`, which only the app's own replace sends (`onReplaced`, `@apackdev/host/services`). A brain flow
  running over rows a tool destroyed is not stopped.

So a tool's write would land and the app would show the data as it was before it, until something of its own touched
the same keys.

## The design

The tool writes the files directly, as it does with no app running, and then tells the app, which handles it as it
handles a replace.

1. **The refusal goes for the commands that write rows** — `exec`, `script` and `repl --write` — and stays for
   `reset`, `import` and `clear-settings`, which replace data the running app has its own way to replace (Settings'
   reset and import, `services.appData`), the run history's store included. The write lock stays for all of them, so
   an app starting mid-write still waits for the tool to finish.
2. **After its last unit commits**, a tool that found a running app (`findRunningApp`) calls one API procedure,
   `db.changedElsewhere`, with the API token. The token is read from the data dir's token file, which the API writes
   only in development or when it made up its own; publishing it on every run is this plan's one security change, and
   is the same one #274's served database needed.
3. **The app re-runs every watch**, as after a `replaceAll` (a commit heard as writing everything), through an engine
   admin member that does exactly that. On elmdb the same: its contract already treats a commit whose writes aren't
   logged as writing everything.
4. **The bus sends `DATA_REPLACED`**, which every system that holds state already handles, and the settings store
   reads its overrides again.

A tool that cannot reach the app (no token file, the call fails) says so on stderr and exits non-zero after the write
landed: the change is on disk, and the app shows it after its next restart or replace.

**Not chosen:**

- **Serving `apack db` through the app** (#274's `POST /db`, `docs/references/pr-274-review.md`, "Not needed here").
  It runs the tool's code in the app's process and needs an offline path anyway for when no app answers, so it is the
  same command implemented twice.
- **The app noticing foreign commits itself.** LMDB's last transaction id moves on any process's commit, but nothing
  wakes the app to read it except polling or watching the database file, and a file watch on a memory-mapped database
  is not reliable on every platform.

## Open questions

- **The schema a tool writes with.** A tool reads the installed packs' declarations, or `--schema-from`, and warns
  when it found none (`db.schema.degraded`). The app checks writes against the packs it has loaded. While both run,
  they could disagree: a pack the app has disabled, or a dev build ahead of the installed one. Either refuse a write
  when the tool's schema isn't the app's, or accept that the tool checks less, as it does offline.
- **A destroyed row an open editor holds.** After `DATA_REPLACED` the systems drop work over rows that are gone, as
  they do after an import. A window with unsaved input on that row keeps it in its `useSurfaceDraft`; what it shows
  when its view answers `null` is each surface's own, as after an import.

## Done when

- A write from `apack db exec` while the app runs shows in every open view of what it wrote, and in the systems'
  published state, without a restart; a case drives the CLI against a running app's data dir.
- The refusal and its doc comment are gone for `exec`, `script` and `repl --write`, and the CLI guide says so;
  `reset`, `import`, `clear-settings`, backups and pack installs keep theirs.
- A tool that cannot reach the app exits non-zero naming why, and a case covers it.
