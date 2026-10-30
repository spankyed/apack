# Bounded native integer membership, 2026-10-30

App base `dd5d7da67e96c44b323e2572c48e529e7593da2e` plus the recorded native input hashes.
Tests ran in disposable Linux ARM64 / Node 23.11.1 / GCC 12, two CPUs, 6 GiB and no swap.
No Mac compilation, private corpus payload, native binary or other-agent target enters Git.

The candidate now owns `native/vectors/build.mjs` and a small patch to pinned upstream vec1
`814fd8ef4d42d6567f1613a66f556c8194764d06`. Upstream source SHA-256 is
`b341c15fe10e41a9b96981ff3a9c217ea0774b4e04932b5acf3dac1320aeceb1`;
patch SHA-256 is `33cabeb716827e1c2cfaa0db963cd94a2494dd8b000dd4e628559f0ee3047923`;
resulting C source SHA-256 is `5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b`.
CI delegates to that builder, verifies provenance, and requires the independent membership comparisons
on every host, with the test report tied to the actual loaded binary hash. Normal app composition remains elmdb. Installed loading/signing and final native
maintenance/adoption review remain required; this is the draft candidate's source component.

The previous integer-IN path compares each candidate with each allowed owner. Long all-integer operands
are now sorted once. Compact metadata searches upstream's converted integer operands; generic metadata
also searches sorted 64-bit operands. Each entry uses logarithmic membership comparisons. There is no
ID-range bitmap or fallback to a quadratic scan merely because integer IDs are sparse or exceed int32.
Short lists and generic mixed-type predicates keep upstream behavior. Compact mixed-type operands still
pass through upstream conversion before sorting. Operand buffers remain upstream-owned, and the platform
C library owns sorting auxiliary storage. This is not a claim that arbitrary mixed predicates have the
same complexity; actual EARS owner predicates select non-null integer entity ordinals.

Both original and patched builds pass **555 independent ordinary-SQL comparisons** across fifteen
mode/fixture groups: none/flat/IVF and compact, sparse int32, full signed int64, mixed and real metadata.
Cases include 7/8/9 and larger lists, NULLs, combined predicates, prepared-query reuse, type-changing
updates, deletion and nested/outer rollback. The patched build passes **all 625 SQLite EARS cases,
zero skips**, including generation/training/model ownership. These are correctness results, not latency
or recall acceptance.

Additional controls:

- Replacing the new exclusion-bit OR with assignment fails the independent oracle.
- Forcing the existing converted-operand allocation to return NULL reports `SQLITE_NOMEM`, rather than
  returning incomplete neighbors or success. This is a deterministic allocation-site refusal, not a
  claim that all allocator failures or physical disk faults are covered.
- The same 555 comparisons pass with AddressSanitizer and UBSan; leak checking is disabled for the
  Node host. Sanitized binaries are not used for timings.
- A modified upstream source file is refused by the builder before its output directory is created.
- The test report falls back to the actual Git source when no source override is set; all 555 comparisons
  pass in that CI-style invocation and its recorded binary digest matches the loaded artifact.
- JavaScript syntax and the ordinary CI wrapper pass; the wrapper's generated source hash matches the
  tested build. Import checks first stopped on missing SDK build outputs; after private `packages:build`,
  import-specifier/pack-rule checks pass. Both attempts are retained.

Raw inputs/results, failing controls and runners are retained here. Log trailing whitespace is normalized
only as recorded in `receipts.json`; JSON values are unchanged. The owning source build is documented in
[`native/vectors/README.md`](../../../../../native/vectors/README.md). The older bitmap/text scratch
patches remain separate historical artifacts and are not combined with this implementation.

Closing checks are the complete frozen fresh matrix, matching current baseline comparison, all supported
platform jobs and installed/native distribution. Prior responsiveness failures remain failures until new
exact-source evidence passes the unchanged budgets. No ANN parameters or thresholds were changed.
