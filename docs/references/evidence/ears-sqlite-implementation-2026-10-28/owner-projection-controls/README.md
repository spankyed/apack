# Owner projection controls — 2026-10-30

This private diagnostic compares the current compact-IN library (generated C `04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a`)
with a metadata-only lookup prototype (`c57c9a8c9c4c48eff7338f4de446d4a1fc5e8707b04aef3a7353b0e944cc996a`)
and a SQL-only alternative using the unchanged library. No production implementation is promoted.

The C prototype uses an opaque query-plan choice to prepare `id,NULL,c0,...` for indexed ANN queries
that do not request vector/distance columns. It preserves metadata positions and the original base-row
existence seek; full scans, index:none and vector/distance projections keep the existing path. SQLite
string allocation failure returns NOMEM. Allocation-fault injection and complete packaging qualification
are not established by these ordinary controls.

The SQL wrapper instead joins native row IDs to the pinned module's base table with LEFT JOIN. It reads
specific owner metadata without requesting the native vector column and explicitly refuses a missing base
row, so an inner join cannot hide corruption. This relies on the pinned shadow schema and needs explicit
maintenance review before adoption; it is not an upstream-supported stable storage abstraction claim.

The original membership suite selected only rowid, which does not exercise native base-row metadata
lookup. This extended suite compares rowid/owner/active with ordinary SQLite across all 15 existing groups
and 49 controls/group, then verifies full returned vector bytes, distance projections and indexed missing-
base refusal. NULL/wide/mixed/real metadata, alternating prepared parameters, write units and rollback remain.

The initial two-library run passes 735 independent comparisons per library, vector bytes and all ten
missing-base refusals. Its final cross-library distance comparison fails only in IVF groups: each process
trained its own model. Preserve that actual failure. The corrected run trains five reference models once,
then uses those exact bytes for baseline, C prototype and SQL alternative. All three pass 735 comparisons,
all vector bytes, all 15 paired distance-group hashes and ten missing-base refusals each. Model hashes,
source/test hashes, compiler arguments and raw failed/successful reports are retained losslessly.

Checks run in one two-CPU/6-GiB/no-swap container. The separately compiled baseline is byte-identical to
the packaged `b16f6c4fcd84c776c1c3e1d3f2df33a5229dc987a1b8fd3b7d0343683fc10fd0` library, which remains unchanged.
The C prototype binary is `8925c4b72ffaa21c5c3f819e4d77d66cca297508f8927b20612be86d4127867b`.
Models/binaries/database payloads stay private. The next finite checkpoint compares 900 actual EARS
queries per variant against the same retained read-only 1536-dimensional snapshot, inspecting answers,
quality, native counters and SQL plans. Complete initial/update, multi-chunk/unit/fresh-owner/platform/
installed evidence remains required before product adoption. All original performance gates remain open.
