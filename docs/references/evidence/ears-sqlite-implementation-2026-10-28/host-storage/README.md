# Real host storage integration, 2026-10-28

Functional descriptor/backup pin b36c179fe2 introduces database format identity, host-owned opening/data-file
descriptors, real constructor selection and both-store import preflight. Normal production composition stays
elmdb. BinaryDatabase omits the new format field, so the pinned native ABI does not change. A recognized wrong
backend refuses as STORAGE_MISMATCH, preventing run-history salvage from moving an incumbent aside. Metadata
remains provenance; actual files select backup open/validation. Cross-format physical import is refused before
validation/replacement. Ambiguous files and non-ENOENT inspection failures refuse.

Pinned b36 validation in owned two-core / 6 GiB Linux passes five package builds, EARS types, **41 host cases**,
two independent failing mutations followed by restored host cases, **413 SQLite / 250 native EARS cases**,
3 EARS / 30 SDK API checks, host/SDK/CLI typechecks and import rules. The EARS root API report adds only the
readonly format property; SDK reports are unchanged. Full source hashes, committed source pin and raw logs are
retained. The checker uses the read-only dependency seed and immutable 6ab native volume; no Mac build runs.

The initial real appData success fixture at c0646697c3 failed two of 45 cases because it had not bound the host,
which the actual app does before migrations. Its failure logs and source hashes are preserved. Test-only fix
1d7b7a9930 binds/unbinds the runtime and composes installed host/SDK declarations rather than a Note-only schema.
The corrected full host check is live; this evidence does not yet claim those service cases pass. The newer
format-preflight mutation tests also assert no validation/replacement calls before inspecting the refusal message.

Real constructor tests cover native and SQLite primary/run-history backups, metadata independence, populated
replacement, media/acceptance rollback, second-store refusal, committed sync-error recovery, retained readable
incumbent copies, both first/second-store format checks, ambiguity and wrong-backend run-history preservation.
No module aliases are used; the historical alias harness is removed. This is a host-boundary checkpoint, not
complete app boot, CLI profile selection, physical fault injection, filesystem certification or adoption. Original
performance failures and all remaining goal phases stay open.
