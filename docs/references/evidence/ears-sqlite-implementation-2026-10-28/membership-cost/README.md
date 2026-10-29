# Populated offline membership repair cost

Exact source 2952e038df, fixed preregistered order 1k OFF/FULL, 10k FULL/OFF, 100k OFF/FULL. Six fresh processes, all correctness checks passed, no retries/discards. Disposable Linux ARM64, two CPUs/6 GiB/no swap. OFF is synchronous=0; FULL is synchronous=2, both WAL. Native provenance and exact benchmark source hash are in every raw profile.

| Entities | Membership SQL OFF ms | Membership SQL FULL ms | Whole rebuild OFF ms | Whole rebuild FULL ms |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 13.62 | 12.89 | 45.64 | 192.35 |
| 10,000 | 104.94 | 105.68 | 349.81 | 2120.44 |
| 100,000 | 1190.27 | 1233.20 | 3565.26 | 22234.39 |

The source has 2048-character overflow bodies and eight mixed array entries per entity. Corruption removes only the duplicate-tag posting, retaining the remaining populated acceleration before repair. The 100k repair restores 587,500 unique membership rows. Primary content/commit, selective queries and stale-handle refusal pass. These are individual cost samples, not distributions or app acceptance.

At 100k the database is about 431.6 MiB; WAL file size is 22.5 MiB both before/after. This does not measure transient WAL peak or bytes physically written. Sampled process RSS before/after repair is around 201–205 MiB; cumulative maxRSS includes seeding and is not a repair-only peak. Synthetic repetitive fields do not represent real entropy or every shape/large-array cost. FULL versus OFF is not a matched acknowledgment comparison to elmdb.

The source always admits value generations for role/shortCode, even when absent, so ordinary background rebuilding still schedules empty batches. Source inspection motivates local ad2cd0eab5: during explicit offline rebuild only, prove absence natively and mark that fresh generation ready; populated or missing primary rows still take the validating backfill path. This is a causal hypothesis for follow-up measurement, not a measured commit-count attribution. Dynamic schema admission and foreground policy are unchanged. Validate correctness before executing the same six-profile cohort on the new implementation. Resource/duration policy, maximum individual arrays and physical power-loss acceptance remain open.

Offline absence-proof source ad2cd0eab5 passes all 38 audit/recovery cases, build/types and lint, including a populated role remaining in the validating builder and absent short-code fields becoming ready. The same fixed six-profile cost cohort is now running against exactly that source with unchanged benchmark/input/limits. No faster-result claim precedes the result.
