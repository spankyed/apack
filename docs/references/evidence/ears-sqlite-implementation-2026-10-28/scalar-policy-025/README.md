# Choose SQL where it reduces query transport

Decision checkpoint `025923f874`; alternative SQL member aggregation measured at `28dfa80beb`. Same disposable SQLite snapshots, alternating strategies, two CPUs/6 GiB/no swap/network, fresh typed rows with untimed syncs-disabled seeding. The scratch wrapper refuses only the optional scalar-layout guard to select ordinary batched fallback; cached authoritative hydration remains real. Each query verifies which strategy ran, exact output and unchanged logical commit. No production tuning option is added.

144 matching queries: three sizes, two fields, two operations, two strategies and six rounds. First round is retained separately; means below have five timed observations. This is a warm synthetic diagnostic, not application acceptance.

| Entities | Field | Operation | Batched mean ms | SQL mean ms |
| --- | --- | --- | ---: | ---: |
| 1000 | rank | distinct | 2.80 | 2.50 |
| 1000 | rank | groupBy | 2.38 | 3.13 |
| 1000 | bucket | distinct | 2.68 | 1.94 |
| 1000 | bucket | groupBy | 2.15 | 2.16 |
| 5000 | rank | distinct | 13.72 | 12.35 |
| 5000 | rank | groupBy | 11.59 | 14.09 |
| 5000 | bucket | distinct | 12.17 | 10.05 |
| 5000 | bucket | groupBy | 11.26 | 11.28 |
| 20000 | rank | distinct | 56.51 | 50.65 |
| 20000 | rank | groupBy | 56.35 | 59.72 |
| 20000 | bucket | distinct | 50.73 | 41.01 |
| 20000 | bucket | groupBy | 48.46 | 46.86 |

SQL distinct improves about 10–20% in these samples. SQL member-list aggregation provides little benefit and regresses unique-key grouping in this sample. The selected policy keeps SQL distinct and count-only aggregation, and uses projected batched Map assembly when the API needs every member ID. This removes redundant JSON member-array encoding/decoding from the ordinary groupBy path. Count-only performance is not established by this experiment; its correctness/transport is tested.

The separate 72-query native-control run is retained with raw CPU/wall samples. Native controls vary materially between separate runs; do not claim a causal SQL speedup by comparing unrelated wall means. The alternating same-snapshot comparison is the basis for this strategy decision.

At checkpoint 025, full EARS types pass; shared native queries pass 29 cases and SQLite query/cost/transport passes 58, without deselections. source-verification.json checks every tested EARS input against the checkpoint bytes. Corruption refusal, null/scalar/object identity, order, prefixes, integer rounding and representative signed zero remain covered. Exact-tip full-chain/platform, memory, cold-cache, physical durability and app resource gates remain open.

Compressed raw observations, reports, hashes, logs and recipes accompany this note; receipts hash uncompressed bytes.
