# Literal compound ranking passes the original keyword gate

[Run 41478710010](https://github.com/spankyed/apack/actions/runs/41478710010), source `34ced96b43`, passes all 25 original SQLite judgments in both unstemmed and English configurations, with zero exclusions. Native elmdb comparison remains 24/25 in each configuration; its distinct baseline failures remain explicit. The fixture, query, target and top-five threshold are unchanged.

EARS production build and full EARS source/test typecheck pass. Selected contracts: 122 pass, three fail. All three failures are in new English upgrade/lifecycle/audit regressions, at the companion native integrity command: SQLITE_ERROR, not assertion mismatches in ranking. Old-source controls and hybrid inference were skipped, so this is not full acceptance.

Pinned upstream SQLite 3.53.4 `ext/fts5/fts5_storage.c` prepares FTS5_STMT_SCAN with SQLITE_PREPARE_NO_VTAB. Native external-content integrity checking therefore refuses a virtual content source, although normal indexed queries succeed. The correction stores each source string once in an ordinary document table, sharing it between both external-content indexes. See [SQLite source](https://github.com/sqlite/sqlite/blob/version-3.53.4/ext/fts5/fts5_storage.c#L199) and [native integrity semantics](https://sqlite.org/fts5.html#the_integrity_check_command).

Original numeric keyword reports are gzip-preserved with decompressed SHA-256. Contract failures are minimized to names/reason and original report hash, without raw logs or corpus text. This failed run is preserved rather than relabeled successful. Strict 41479016465 and queued corpus 41479389479 were cancelled as superseded by the known native-audit correction, not because of observation timeouts.
