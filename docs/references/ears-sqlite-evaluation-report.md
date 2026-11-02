# EARS SQLite candidate evaluation

Status: experiment delivered, 2026-11-02; production adoption not recommended. Implementation is `93ed37e67f40faee3fd25a10f3b897c15e55c858`;
subsequent commits contain documentation/evidence only. Integrated master is
`461f7bf2cb9f52b968957a423744168740bf37a7`, native elmdb `f496470679a7bd9764398108b20f62a73333c701`.
[Draft PR #286](https://github.com/spankyed/apack/pull/286) contains the complete candidate. Production
continues selecting elmdb; no merge, release, daily-profile migration or PR closure is authorized.

**Recommendation: retain elmdb.** SQLite can implement the current app-facing EARS needs, including
its graph/search/watch API, but this implementation has not established a net adoption benefit or lower
maintenance cost. Final current-layout admission/resource qualification passes all 24 fresh-process trials. The [implementation reference](ears-sqlite-candidate.md) describes behavior,
and the [goal](../archive/goals/goal-ears-sqlite.md#current-handoff) records the completed delivery and follow-up dispositions.

## Requirement audit

Evidence paths below are under [the source-pinned evidence directory](evidence/ears-sqlite-implementation-2026-10-28/).
The detailed [contract matrix](../archive/plans/ears-sqlite-contracts.md#ownership-and-acceptance) maps individual
facade invariants to code/tests; this table maps the original seven delivery phases.

| Requirement | Inspected evidence | Result and limits |
| --- | --- | --- |
| 1. Pinned contracts, types and integration | `platform-93ed`, `strict-93ed-producers`, `strict-93ed-consumers`, `integration-93ed-replay`, `final-input-audit` | Whole strict succeeds: eight original passed jobs plus one full failed-shard replay on original 93ed. Producer has 19 successful stages; current API/package/facade checks pass and 103 report inputs match source. Linux runtime inventory maps 2,630 assertions to 204 fixture files. This is pinned integration, not compatibility with a moving master. |
| 2. Structured storage and native SQL | Current 946 EARS cases on Linux/macOS, 942/four existing POSIX exclusions on Windows; `operational-f6`, `remeasure-built-f55` | Typed primary values, unchecked repair contract, units/savepoints, commit identity, projections/pages/traversals, query plans/call counting and independent models pass in their tested scopes. Native adapter/core contracts pass; native's frozen keyword comparison remains a separately reported 24/25 diagnostic. No generic SQL framework or public raw-binding compatibility layer was required. |
| 3. Dynamic declarations, admission and watches | Current platform/host contracts, `operational-f6`, `admission-watch-009`, `sustained-bd4`, `admission-5d80` | Atomic registry authority, readiness/refusal/recovery, precise watch dependencies and model lifecycle have actual contract/counterfactual evidence. Sustained matched durable workloads converge. Final run 41520371169 passes all four value/search × OFF/FULL cohorts and 24 fresh-process trials after the text layout change. Independent checks reproduce every budget/quantile and all 138 source hashes per cohort. Expected INDEX_BUILDING notifications converge to correct ready answers; they are not failed jobs. |
| 4. Search, vectors and usefulness | `relevance-93ed`, `relevance-repeat-67ae`, `corpus-93ed`, `corpus-repeat-67ae`, `fallback-a902` | Unchanged SQLite keyword gates pass 25/25 in both none/English configurations; hybrid usefulness/highlights pass 25/25 per engine, 125 contracts/four effective old-source controls pass. Two corrected managed-model cohorts each pass 1,800 queries/18 groups, original mean-recall/query-p95 targets, with minimum means 0.988/0.990 and different actual models at both native sizes. Earlier untrained fallback independently passes at its recorded source. Declared language/feature choices and model/provider scope are explicit; no arbitrary-model or multilingual semantic guarantee is inferred. |
| 5. Complete app lifecycle and tools | `full-app-6d`, `app-flows-1de`, `strict-93ed-consumers`, current host/CLI reports, `operational-f6` conversion, backup audit | Full source app passes 33 cases and ten discovery cases; its one packaged-only exclusion passes in signed macOS. Current strict adds six once-passing SQLite storage/app witnesses, published authoring, external packs and CLI maintenance. Real app flows admit 120 measured actions/30 warmups and 58 cases/four controls, with 200 raw hashes checked. Primary/history/media populated replacement, acceptance/refusal, rollback and retained recovery are exercised. Native-only tooling has an explicit disposition. |
| 6. Errors, recovery and supported runtimes | `operational-f6`, `filesystem-full`, `wal-c471`, `installed-ddc`, `installed-f6-signed`, `final-input-audit` | Actual read/full/EIO/ENOMEM/retry, retained-reader release, eight successful-sync/process-death cases and two disabled-injector controls pass in their recorded scopes. Post-sync uncertain commits fence and reopen with exactly one commit. Linux/Windows packaged native/API and private-signed macOS native plus six lifecycle cases pass. Of each fault report's 68 source files, 66 match current; only vector query options/policy changed. Core storage/worker/backup/driver/native inputs remain unchanged, while new retrieval has direct current evidence. Physical power loss, arbitrary filesystems, notarized distribution and independent duplicate-driver access are not certified. |
| 7. Cost, ownership and adoption review | Build/field benchmark protocols, `remeasure-built-f55`, `cold-27`, `sustained-bd4`, `admission-watch-009`, `wal-c471`, corpus/app-flow receipts; invariant/dependency reviews | Warm/cold-file/reopen, sustained writes/watches, background work, ingestion, model variation, whole-process high-water RSS, sampled disk/WAL and checkpoint costs are recorded with variance/source limits. These measurements do not establish a general SQLite speedup or lower total ownership cost. Current admission accounting passes without relaxing any budget. Experiment delivery is complete; adoption remains a separate decision. |

## Results that matter to the decision

The corrected managed corpus uses paired OpenAI text-embedding-3-small 1,536-dimensional vectors and full
text, with independent Float64-reference answers under enforced 2 CPU/6 GiB/no swap. Query p95 meets the
original 100 ms at 10k and 200 ms at 99.9k limits in both corrected runs. At 99.9k in the first corrected
run, all-live lexical/held-out p95 is 88.62/77.18 ms, one-percent scope 18.65/20.56 ms and ten-percent scope
111.22/101.27 ms. The repeat's actual models differ. Full private identity/text/vector pairing and cleanup
pass; no source payloads are published. Three sampled reopens per size reproduce answers; these are not
cold-device tests. The separate cold-file study verifies residency and eighty fresh-process reads on one
Linux filesystem, with its source/factory-timing limits retained.

At 99.9k, corrected load/admission takes 67.23/46.65 seconds, versus 77.84/47.83 in the independent repeat.
Whole-harness peak RSS is 1,523,708/1,534,444 KiB; maximum sampled store/sidecar bytes are
1,972,178,976/1,972,244,512. These include setup/reference/harness work and sampled logical file lengths;
they are not isolated storage allocations, OS-cache totals or instantaneous disk peaks.

The current real app cohort records native/SQLite medians of 761.30/670.40 ms for thread opening,
28.80/25.95 ms for current-query search and 849.50/978.05 ms for deterministic streaming completion.
These warm native-first macOS observations use differing default durability and no network model provider.
All actions pass correctness/capture admission; they are not matched engine timings or a new general app
latency threshold. Their direction varies from earlier cohorts.

The matched durable synthetic write study observes median SQLite/native throughput of 3,813/2,841 commits/s
without views and 2,466/2,712 with views. Ordered-view reads and acknowledgment tails favor native in that
study. Earlier built-package field/page/walk comparisons also generally favor native at their recorded sources;
small-field reads are about 2.5–2.6 times slower in SQLite. These workload-specific tradeoffs explain the
recommendation better than a single microsecond ratio or an uncontrolled before/after comparison.

## Accepted degradation and retained failures

The user explicitly accepts synchronous foreground responsiveness degradation for experimental completion.
Original 16 ms heartbeat misses remain failures, not passing measurements: eight/nine groups miss in the two
corrected corpus runs, and other retained checkpoint/chunk-skew studies expose longer synchronous stalls.
No async app-search API is implemented or promised. Correctness, keyword judgments, mean recall, the recorded
query-latency limits and resource accounting remain requirements.

Current admission evaluation preserves every raw harness outcome. Admission below 100 ms, operation/lookup
(and search-lookup) p99 below 16 ms, observed WAL/file limits, correctness/commit identity, cleanup and original
workloads are not relaxed. Timer/heartbeat responsiveness results are reported separately with the existing
user decision. Do not convert a failed parent workflow or raw `passed:false` into an unqualified green claim.

The former 32-probe corpus miss (0.94890625 against 0.95) remains preserved. The 64-probe correction passes
two fresh model cohorts; it retains binary candidate approximation and cannot guarantee every model/query.
Native keyword's 24/25 remains a baseline diagnostic, while both candidate modes pass 25/25. The strict compiler
publication timeout remains an observed first-attempt failure; the full unchanged replay passes its case in
146.4 seconds under 200 seconds. No causal timing fix or stable future CI guarantee is claimed.

## Ownership findings and path forward

SQLite supplies mature transactions, page recovery and FTS execution. The candidate still owns lossless value
semantics, query adaptation, dependencies/watches, live index admission, canonical vector lifecycle and backup
coordination. Patched vec1, better-sqlite3, sqlite-vec, graph WASM, Rust-regex WASM and file locking carry source,
ABI/build, provenance, licensing and upgrade responsibilities. Moving the facade to SQLite does not remove
that work. The [detailed invariant/complexity/dependency review](../archive/plans/ears-sqlite-contracts.md#candidate-invariant-and-maintenance-review)
records bounded outputs versus retained work: exact scans scale with eligible chunks × dimensions; owner caps
do not cap chunks per owner or coarse filtering; graph algorithms retain selected-graph memory; large values
and private snapshot/staging disk remain material. No hidden constant-work/constant-memory claim is made.

Keep elmdb as the production backend unless a concrete product need demonstrates that SQLite's tooling,
interoperability or operational advantages outweigh migration and retained maintenance costs. Preserve the
backend-independent contract/model tests and review shared watch/registry fixes independently of engine choice.
Avoid a permanent two-backend product. If SQLite is selected later, give the native patch and dependency upgrade
procedure a named owner, remove temporary selection/comparison machinery and obsolete production paths,
qualify the chosen product/provider/filesystem rollout targets and perform explicit copied-data conversion.

The build-tools follow-up is to diagnose intermittent multi-build compiler-test timing and reduce redundant
fixture/compiler cost without weakening publication/stamp checks or increasing deadlines after failures.
Broader provider/language usefulness and the dormant semantic library UI need product-specific qualification
when enabled; literal Unicode and controlled inference tests do not establish those capabilities. New filesystem
or duplicate-driver topologies require their own supported ownership/fault design before use. None of those
limits is silently claimed complete by the recorded candidate tests.
