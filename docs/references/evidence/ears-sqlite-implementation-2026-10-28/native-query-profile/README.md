# Native query attribution — 2026-10-30

The extension already provides `vec1cat.qprofile`; this diagnostic uses its existing counters without
changing compiled code. It follows the [SQL trace](../query-attribution/README.md) and
[rejected cheaper query policies](../query-policy/README.md). Source is `1eb47d88e1`, default target 256,
`nprobe=32`, with the same closed updated snapshot/model as the policy comparison. Nine cohorts x100 held-out
queries complete. The primary file SHA256 is identical before/after; hits, scopes and recall are checked.
All three large eligible cohorts execute 100 native candidate calls; exact small cohorts execute none.

| Cohort | Metadata scan / native total ticks | Index reads / native total ticks | Quantized scan / native total ticks |
| --- | ---: | ---: | ---: |
| 10k, 100% | 50.8% | 15.8% | 26.6% |
| 99,900, 100% | 0.14% | 32.3% | 57.6% |
| 99,900, 10% | 53.7% | 15.2% | 24.7% |

These are ratios of upstream timer ticks, **not CPU-time percentages**. The AArch64 timer is `cntvct_el0`;
no frequency conversion is assumed. The native total excludes some result iteration/materialization, so
these ratios do not describe the whole EARS call. Category boundaries are upstream instrumentation, not
independently traced syscalls. All raw deltas and query samples are retained.

Each of the 100 filtered native queries scans about 665 metadata blocks. Source inspection shows that
`vec1MetaFilterIntList` converts the integer RHS into a temporary array for each block. The current binary
search patch improves membership comparisons but does not remove repeated whole-list conversion/allocation.
A query-owned cached representation could avoid that repeated work; it is a hypothesis requiring semantic,
lifetime, bounded-memory and actual-query proof. Existing supported larger block sizes should be measured
before maintaining another native fast path; larger blocks may instead increase COMMIT write amplification.
Unfiltered native scanning and repeated SQL scope work remain distinct costs.

This is a 900-query updated-snapshot diagnostic, not the full four-pass initial/update matrix or performance
acceptance. The runner enforces two CPUs/6 GiB/no swap/dropped capabilities, waits for quiet, and pauses only
its own container if another starts. No pause events were recorded. The source metadata retains inherited
policy-matrix fields; the `purpose`, actual report and runner establish this run's 900-query scope. No model,
corpus, database or native binary payload is committed. Production code, ANN settings, FULL/checkpoint policy,
canonical bytes and all original acceptance gates remain unchanged.
