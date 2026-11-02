# Missing SQLite search structure recovery

The previous writable open used CREATE IF NOT EXISTS on missing search structures, then trusted an unchanged
schema and cached text hashes. A deleted FTS table could therefore become an empty index with silent missing
matches. A missing external-content trigger could leave stale postings even after the trigger was recreated.

The continuation inventories declared physical search groups before reading. Read-only open refuses incomplete
groups as CORRUPT. Writable repair checks schema revision and physical structures under BEGIN IMMEDIATE,
resets incomplete FTS groups through virtual-table DDL, clears affected text hashes and reconstructs search inputs
from primary values in one transaction. Failure rolls back DDL/postings; a rollback failure keeps both errors,
and closing the constructor's connection discards the transaction. Logical commit identity does not change.
Healthy opens do not take writer ownership and can read committed state while another handle owns a write unit.

Repair reads only affected types and the union of their current search-input fields, in pages of at most 256.
Intact embeddings are preserved when text/model/dimensions agree. Lost chunk storage is regenerated pending,
requiring the ordinary embedding service to compute vectors again. This is not a restore of lost embeddings.

The 18 recovery cases cover thirteen missing objects (virtual tables, source docs, owner/pending indexes,
triggers, metadata/chunks and FTS shadow tables), stale postings, partial repair rollback, secondary rollback
failure, healthy concurrent opens, and paged selective hydration. The first shadow-table fixtures hit SQLite's
normal defensive refusal; the corrected fixture explicitly enables unsafe mode only on a disposable raw test
connection. Production keeps SQLite's default protection. Normal repair uses DROP/CREATE VIRTUAL TABLE;
it never writes shadow content or sqlite_schema directly. See the
[upstream FTS5 storage documentation](https://www.sqlite.org/fts5.html#fts5_data_structures).

Seven independent mutations must fail: remove read-only validation, omit primary reconstruction, retain a
partially present group, retain cached hashes, hydrate whole rows, remove the repair transaction, and make healthy
opens acquire writer ownership. Restored source is rechecked after mutations. The earlier 391-test checkpoint
predates the healthy-open refinement; it is retained separately rather than relabelled as final evidence.

Limits remain explicit: repair is paged in memory but synchronous and atomic over the affected corpus. Neither
its foreground duration nor peak byte memory is bounded by the page count. Background search generations,
readiness/fallback semantics, writer/WAL budgets and retired index cleanup remain phase 3 work. Physical presence
is not a checksum of existing postings: audit/rebuild, real corruption and I/O/crash qualification remain open.
No production-adoption, filesystem or full-app performance claim follows from this checkpoint.

Final Linux validation: EARS types, 90 focused cases before/after all seven mutations, the full **392/392**
SQLite suite, five package builds, three unchanged API reports, 64 build-input cases, root/workspace lint and
import/pack rules pass. The separate local documentation check resolves all 19 relative link targets in the
four edited documents; it runs no compiler. Exact commands, source hashes and raw results are retained here.

Terminal logs and JSON reports are gzip-compressed without changing their bytes, preserving ANSI output and
whitespace from failed assertions. Read them with `gzip -dc <file>`. Build/validation scripts remain plain text.
