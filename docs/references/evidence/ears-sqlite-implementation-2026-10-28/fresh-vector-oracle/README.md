# Frozen fresh vector oracle, 2026-10-29

Source `89539dda3e` generates the fresh partition specified before retrieval evaluation
in [the protocol](../../../../../packages/apack-ears/bench/sqlite/REAL-VECTOR-FRESH-PROTOCOL.md).
The independent NumPy 2.5.4 Float64 oracle completes all eighteen prefix/scope/update
cohorts. Fifty-four scalar `math.fsum` cosine checks agree with matrix results within
1e-12. The same 101-ordinal exclusion union applies before and after updates, removing
all 100 selected queries and the row whose update would introduce a selected vector.

Truth SHA-256: `ca6356a0cf0059ba87e5f628e9ae0a32260adf146617acb498c880cdf9442545`.
Fresh query Float32 SHA-256: `eead047d2b850bb6dc1944ca46c333fd5de216cb5fe4e75a3c994dcffbee8ca4`.
Exclusion little-endian uint32 SHA-256: `80ca2d4970a41d2487bb697d9c38447469813a100458e4f86db3aecd3414f678`.
The report contains ordinals/scores and exact eligible counts, never private vector
payloads, text or publisher source IDs. The canonical private corpus is mounted read-only.

Execution uses the prior pinned Python image
`python@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`,
two CPUs, 6 GiB and no swap. The oracle asserts actual cgroup limits and one BLAS thread.
Binary-only wheel installation metadata/hashes, source receipt and runner are retained.
Observed oracle time is 4.31 seconds, peak RSS 800,788 KiB. These are oracle-generation
costs, not database performance. A first attempt used the Node image, which lacked pip
and stopped before processing; that prerequisite failure is retained. The short successful
container exited before an external inspect receipt could be captured; no such receipt is
claimed. No compiler or corpus computation ran on the daily Mac.

No native model from exploratory runs may be reused: it may contain these query vectors.
Actual EARS training and eligibility must apply these exclusions, then all frozen recall,
latency, heartbeat, first-pass and resource checks still need execution. This truth does
not qualify query performance, real multi-chunk relevance, model refresh, packaging or adoption.
