---
'@apackdev/ears': minor
---

EARS runs on elmdb's `main` (`vendor/elmdb.rev` at `2029f9c`), whose blocking read is `read`, no longer `readSync`.

`EarsDatabase`, the port a database is passed to `createEarsEngine` through, follows the binding:

- `readSync(reads)` is now `read(reads)`, blocking as before;
- `openReport` says what opening did: the schema's changes, a restore to the last synced commit that a power loss or a
  failed sync made (`restored`, with the sequence it opened at), and whether the record of the last sync named another
  file (`notBorneOut`); `acknowledgeRestore()` says the restore was read, so no later open reports it;
- `rebuild(type?, index?)` writes every index's derived data again, or one's.

`admin.waitForIndexBuilds()` now throws `SYNC_BEHIND` or `READERS_FULL` when what holds a build up is a sync that
failed or a full reader table, rather than waiting on it.

A `QueryStage` from `explain()` gains the fields elmdb now reports: `places`, `set`, `within`, `held`, `sorted` and
`wants`.
