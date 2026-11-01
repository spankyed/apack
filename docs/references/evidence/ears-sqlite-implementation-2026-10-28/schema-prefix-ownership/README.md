# Atomic issued-prefix refusal — 2026-10-28

Schema admission previously inspected issued short codes before taking SQLite's writer lock. A second handle
could issue the first code between that inspection and BEGIN IMMEDIATE, without changing the schema revision.
The first handle would then admit a different prefix despite incumbent codes. Checking the revision again did
not close this race because ordinary entity creation leaves it unchanged.

The incumbent-dependent prefix refusal now runs under BEGIN IMMEDIATE, before layouts, indexes or metadata
change. Structural type-name checks remain outside the transaction. A deterministic two-handle test commits
the competing entity just before the first handle acquires the writer lock. Admission must refuse with
SCHEMA_CHANGE_REFUSED, preserve the stored/cached schema and revision, release the transaction and retain the
other handle's correctly prefixed entity. An unused prefix remains changeable.

Private Linux passes EARS types and **29 schema/index/operational cases**, both initially and after restoring
an independent mutation. Moving the same check back before BEGIN makes the race case fail because the change
is accepted. Logs, mutation runner and complete EARS source/test fingerprints are retained here. This proves
this incumbent-dependent refusal, not complete structural schema validation or production I/O qualification.
