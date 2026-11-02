# Compact integer owner membership, 2026-10-29

Benchmark source `5c248f33b3`; no runtime dependency, loader, schema or layout changed.
The patch is [bench-only source](../../../../../packages/apack-ears/bench/sqlite/vec1-integer-in.patch)
against the same pinned upstream vec1 file. It is separate from, and does not include,
the earlier text-IN patch. No upstream PR/message was posted.

The previous UUID text predicate was expensive. This check assigns dense private integer
owner ordinals and binds them as BigInt so SQLite actually stores INTEGER metadata,
without changing any app-facing ID contract. Compare identical ordinals/model/corpus
on unmodified and patched vec1. Actual EARS surrogate mapping is not implemented here.
Both containers are sequential, two CPUs/6 GiB/no swap, capabilities dropped with actual
mode-denial, FULL WAL, 64 MiB cache and private ordinary database paths. These are ten
previously observed queries, not full/fresh acceptance or a randomized paired trial.

The patch uses a bitmap only after upstream numeric membership conversion, at least
eight operands and integer range span at most 1,048,576. Maximum extra allocation is
128 KiB per chunk and is freed before the next chunk. It ORs exclusion bits, preserving
preceding filters. Short/sparse/wider ranges keep the original path; large sparse ranges
therefore retain the unfavorable complexity and are an unresolved production concern.
This is not a universally efficient membership implementation or a final native choice.

Original and patched code each pass **306 ordinary-SQL semantic comparisons** across
none/flat/IVF-binary modes and mixed/small-integer/wide-integer fixtures. Cases cover
NULLs, 7/8/9 and larger lists, negative/near-int32-limit values, dense and wide spans,
numeric coercion/mixed types, extra metadata predicates, updates and nested/outer
rollback. The patched extension also passes 20 existing small compatibility groups,
including read snapshots, compacted read-only backup and reopen. Allocation failure,
sanitisers and all supported platforms are not qualified by these tests.

At 9,889 owners, owner-IN p95 is **96.19 ms unmodified /13.65 ms patched**.
At 988 owners it is **17.42/9.48 ms**. Both return identical candidates/distances to
the logically equivalent native range control. Patched broad range p95 is **17.50 ms**
in this first-pass diagnostic and remains retained, not discarded as an outlier.
The static scope description in these raw receipts still says UUID-shaped owners;
`ownerStorage: integer`, INTEGER table definition and explicit BigInt binding identify
the actual fixture. That description is corrected in later benchmark source.

No responsiveness acceptance follows from these ten-query results. All raw timings,
plans, answers, native/model/source/patch hashes and limits remain retained. No private
corpus/model or third-party binary enters Git. The [original UUID result](../vec1-owner-scope/README.md)
and [text-only optimization](../vec1-text-in-patch/README.md) remain separate.

The next work is an actual EARS generation/admission/transaction integration and an
explicit native maintenance/distribution choice, not another claim from a primitive.
A [fresh query protocol](../../../../../packages/apack-ears/bench/sqlite/REAL-VECTOR-FRESH-PROTOCOL.md)
is frozen before testing a new validation partition. It excludes query vectors from
both training and eligibility, including the update mapping. Fresh files and oracle
results have not yet been generated. Original thresholds and every remaining goal gate
remain unchanged. Do not adopt a native fork from this diagnostic alone.
