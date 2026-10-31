# Application performance investigation, 2026-10-31

Execution follows the [approved plan](../../plans/application-performance-optimization.md).
Initial application source: `54007b7094`; native: `dde229d90c60`. Detailed captures use
512 KiB allocation sampling. Sample-attributed bytes describe JavaScript allocation, not live heap,
native allocation or exact allocation totals. CPU-profile elapsed samples include idle time and
profile admission/teardown; they must not be reported as action CPU consumption.

## Initial attribution

Twenty measured thread openings attributed approximately 1,639 MiB of renderer allocation samples
to editor construction and rendering. The largest self-allocation sites were regular expressions
(13.0%), Tiptap option construction (11.8%), string replacement (7.7%) and extension storage
construction (5.1%). Renderer elapsed CPU samples included garbage collection (13.0%),
`getClientRects` (10.1%) and message truncation checks (5.7%). These are recording-window samples,
not exclusive action costs. Backend elapsed samples were predominantly idle (82.1%).

Search backend allocation captures contained only ten samples across twenty actions. They cannot
support a codec optimization recommendation. Previous native decompression/copy improvements are
already present at the measured pin and are not new work here.

## Candidates and acceptance, declared before prototypes

1. **Artifact query starting set.** `threadQueries` starts from all entities, filters by a link,
   then keeps artifacts. Compare that recipe with a type start and the same link filter. Require
   identical projected values and order, one crossing, at least 90% fewer start visits on the
   populated search-sized graph and its doubled shape, and no broader watch dependency. This is
   a query-work claim; an empty-artifact fixture cannot establish a visible latency improvement.
   Preserve either-direction links, arbitrary relation kinds, trash handling and live watches.
2. **Editor configuration allocation.** Inspect the sampled option/storage construction before
   changing it. Reject cross-editor option/storage caching if extension state or contributed
   executable lifetimes could be shared. A local change needs at least 10% less sampled allocation
   and 5% less unprofiled thread-open median in matched runs, with editing, viewer and contribution
   replacement behavior intact. A larger rendering redesign is outside this bounded investigation.
   First attribute input/paste-rule construction within read-only viewers: Tiptap exposes existing
   switches, so unused rule creation could be avoided without sharing editor state. Reject it if
   the attributed opportunity cannot plausibly reach the declared benefit.
3. **Codec/assembly.** Obtain focused attribution on selected real query shapes if window captures
   cannot distinguish encoding, native crossing and decoding. Accept a localized change only with
   at least 10% less measured per-query time or allocation, unchanged request/result semantics and
   no unexplained regression on nested/binary/prototype-sensitive values. Do not optimize the rare
   prototype-key fallback solely from reading its implementation.

Recording overhead is a separate acceptance issue: the initial lightweight search comparison was
12.2 → 14.1 ms (+1.9 ms, +15.6%), exceeding the unchanged 5% budget. Retain that failure. Diagnose
its action timeline and recording work before proposing instrumentation changes; no favorable
replacement run erases it.

Focused disabled A/A controls for search and populated startup used the maintained revision
coordinator, the same checkout for both sides, twenty measured actions per side and the existing
ABBA protocol. They measure same-revision process/driver variability; two application workers
(and independent startup seeds) differ from the single-process mode comparison, so they cannot
certify that lightweight overhead is absent. The predeclared interpretation was: if the control's
absolute median difference reaches 1.9 ms, the original gap cannot confidently be assigned entirely
to tracing without a narrower control. Apply the same rule to startup's observed 478.2 ms gap.
The original budget failures remain failures either way.

The controls measured +0.6 ms for search and +1,111 ms for startup. Startup variability is therefore
materially larger than its observed recording gap; search's control gap is smaller. Neither result
replaces the original failed assessment. See the [baseline record](2026-10-31-application-performance.md).

## Selected query dossiers

| Caller | Recipe / projection | Observed work | Disposition |
|---|---|---|---|
| `getThreadArtifacts` | All entities → linked with thread → Artifact; six projected fields | One crossing; 1,242/2,484 start visits to return ten rows | Use the existing type start; preserve creation-order ties and both-direction links |
| `messageById` | One id → first row; twenty projected fields | One crossing; 298 request bytes and approximately 2,136 response bytes per synthetic 2 KiB-body row | Keep projection and independent watch ownership; remove demonstrated builder allocation |
| `searchMessages` | Bounded native hits, then batched related edges and topics | Three reads per lightweight action; 45,618–45,670 response bytes in its recording window | Existing filtering, limit and batched reads already avoid the previous waste; no further query change justified |

The point-read projection is the repository's actual field list; most optional values in this probe
are absent. It does not characterize large nested/binary message payloads. The existing ownership
and watch suites remain required. Combining independent message watches into a single broad read
would change useful invalidation granularity and is not justified by their small measured cost.

## Dispositions

**Artifact starting set: proceed to correctness validation.** The original/all-entity and type-start
recipes returned identical ten projected rows, including either-direction links over two relation
kinds. Start visits were 1,242 → 30 and 2,484 → 60 (97.6% less). Balanced unprofiled query medians
were 0.670 → 0.074 ms and 1.373 → 0.082 ms. The link-neighbor set still costs work proportional to
the thread's degree: this does not make artifact lookup constant-time. The existing view lifecycle
case now commits an unrelated thread and then a related artifact in the same turn, waiting for a
real tab delivery before checking coalesced reads. It fails the original implementation with one
unnecessary skipped read. Positive integration validation remains required before shipping.

**Read-only input/paste-rule switches: rejected without a prototype.** Named rule-construction
ancestors accounted for 4.50 MiB of 1,639 MiB of thread-opening allocation samples (0.27%). Even
eliminating all of that cannot meet the 10% allocation target. Sharing mutable editor parsers,
options or storage to pursue the larger construction cost is also rejected in this bounded work.
Streaming Markdown serialization accounted for 9.50 MiB of 212.3 MiB (4.5%); removing it entirely
would likewise miss the allocation target, and the serializer has observable update semantics.

**Query-builder allocation: prototype justified.** A focused existing-projection probe made 50,000
message point reads with twenty projected fields. Its complete 512 KiB allocation profile attributed
180.9 MB of 420.7 MB (43.0%) to `builder`: every recipe constructs its entire method table, even
when the caller uses only `pickOne`. The native/binding boundary and codec ownership remain intact.
Use shared methods with per-recipe immutable state; retain stable extracted methods without eagerly
binding every unused method. No decoded rows, request results or database lifetimes may be cached.

Before the prototype, acceptance is at least 10% less sample-attributed allocation on this point-read
shape, no more than 5% median regression in balanced unprofiled point and chained-query batches,
and identical protocol/answers. Preserve retained recipes across writes, independent branches,
function predicates, method extraction, units and watch behavior. Use the existing query/ownership
coverage and add only a missing contract case. Report per-query savings separately from app latency.

The unprofiled point-read probe measured forty batches of fifty reads; total time was 178.6 ms,
with 100.3 ms inside a wrapped `readSync` boundary. That boundary includes FFI, native execution and
scheduling, not pure native CPU. The separate profile includes Inspector teardown; its elapsed
sample total is not an unprofiled query duration. Raw evidence remains in the owned work volume
under `query-path-investigation.json`, `read-codec-investigation/` and
`viewer-allocation-attribution.json`.

Request packing accounted for 11.6% of this focused allocation sample and decoded keys for 25.0%.
Those figures do not establish redundant copies or decoding: the read still needs a request and
owned values. The prototype leaves codecs, frozen values and native ownership unchanged. It shares
query implementations and binds only methods a recipe uses, including stable extraction from a
frozen recipe. Type checks and 26 differential protocol/result cases pass; paired native measurement
and the full affected suites remain required. Upstream's new native pin is a separate final
integration checkpoint, not silently substituted into the original captures.


## Implementation checkpoints

The artifact query's existing thread-view lifecycle suite passed on `4ecc941488` and
`ec3e8869d1`; the deliberate original-query counterfactual failed its coalesced-read guard.
This establishes preserved real view behavior and detection of the unnecessary dependency.

The shared-method prototype passed its predeclared paired criteria twice. Both comparisons used
one process, the same database and native binding, identical request/answer hashes, forty balanced
unprofiled samples per shape, and four separate ABBA allocation profiles totaling 50,000 point
reads per variant. Allocation samples include collected objects; they are not retained heap.

| Candidate / native pin | Baseline → candidate sampled allocation | Reduction | Point batch median | Chained median | Predicate median |
|---|---|---|---|---|---|
| `4ecc941488` / `dde229d` | 446.4 → 269.7 MB | 39.6% | 0.839 → 0.819 ms | 0.382 → 0.377 ms | 0.117 → 0.116 ms |
| `ec3e8869d1` / `7b484b0` | 432.7 → 282.8 MB | 34.6% | 0.826 → 0.835 ms | 0.375 → 0.378 ms | 0.118 → 0.116 ms |

A point sample contains fifty projected reads; the other columns are milliseconds per query.
All shapes remained within the predeclared 5% median-regression limit. These establish an allocation
improvement, not a reliable application or query-latency speedup. Full raw samples, profiles, exact
probe and provenance remain under `query-allocation-<revision>` in owned Linux work volume
`apack-linux-work-2bd9183070f1`. Both probes have SHA-256
`ca039e89affa96ec7072b63bb653c6dfa96c671f279c015f267edee55c8a7069`.
The second native binding hash is
`6ceddbed7532de768d3ad51e389c387a0f303982d5e87bbd06562546a94a22db`.

Review found an observable regression: callback terminals consulted the overridable public `ids`
method rather than their recipe. A baseline/candidate differential check failed before the fix;
terminals now use a private recipe read. The existing callback test covers the override while
retaining its result-ownership assertion. Vocabulary inspection now includes public prototype
members, preserving all existing rules and exceptions. On `ec3e8869d1`, focused query/vocabulary
checks passed all 33 cases, and the real thread-view suite passed. The full Linux EARS suite passed
245 of 247 cases; both model-based cases exceeded their unchanged 30-second deadlines, with worker
RPC timeouts also retained in the log. These failures are unresolved, not semantic passes.

Master subsequently merged weighted relations at `27518626c4` and advanced its native pin to
`1849f6899e3d707ac8e25e7f81fa52b472b2a9a0`. The implementation retains both new weighted
query options. Twenty-nine differential protocol/result probes, including those options, and EARS
type checking pass after integration. Final native measurements use this checkpoint, with the
original query factory compiled against the same current engine. A matched fixed-seed model-test
control retains the existing 120/40 workloads and deadlines; the normal suite retains randomness.
Final application recording qualification remains required and does not supersede historical failures.


## Final combined result

The reviewed implementation at `03a572ff0a`, integrated with weighted relations, passed the same
paired acceptance on clean native `1849f68`. The baseline differs only in query construction: its
original factory is compiled from `27518626c4` against the same current engine, schema and binding.
That base has the same tree as remote master's merge commit `9ec9888705`.

| Shape | Original factory median | Shared methods median | Sampling unit |
|---|---|---|---|
| Projected point reads | 0.814191 ms | 0.801900 ms | Fifty reads |
| Chained query | 0.379666 ms | 0.367818 ms | Per query, ten per timed batch |
| Predicate query | 0.120688 ms | 0.119753 ms | Per query, ten per timed batch |

All request/answer hashes matched. Sample-attributed allocation fell **36.8%**, from 416,985,944
to 263,412,256 bytes over 50,000 point reads per variant. All four allocation captures were complete,
and all three balanced unprofiled shapes met the unchanged 5% median-regression ceiling. This is
an allocation result, not an established whole-app speedup. The native binding hash is
`9c0469d914d90d0ad7763e84378f0f7149855a85420ae2965dcfb4b4eb2f1474`;
the exact saved probe hash is
`f9c2de95605eb23246ea36dd0def60a8d208a09266b3911abe328397b5c4df81`.
Reports and profiles are retained in the owned volume under
`query-allocation-03a572ff0a-clean-native-serial/`.

Clean-native focused validation passed all 68 query/vocabulary/relation assertions, including the
new weighted options, followed by all six real thread-view cases. Parallel files passed their
assertions but incurred two Vitest worker-update RPC timeouts during long synchronous tests.
Running the focused files with `--maxWorkers=1` passed cleanly in 26.38 seconds. Only invocation
parallelism changed: every assertion, workload and deadline, and the committed test configuration,
remained unchanged.

The fixed-seed model controls retained 120 synchronous and 40 watched workloads and their existing
30-second test deadlines. On this Linux/external-drive environment, both original and shared-method
factories timed out: the synchronous cases took 47.572 and 47.548 seconds, respectively; both watch
cases reached the same deadline. The full unchanged random suite, also run serially, passed 251 of 253 tests, with only
those two deadline failures. These are failed local gates, reproduced without the implementation,
not semantic passes. Required broad correctness acceptance remains the final strict CI gate.

One intermediate native checkpoint is **invalid**: copying a completed compiler target into the
new native checkout reused the preceding revision's binary despite the new declared pin. The
identical binding hash and failures of the six weighted cases exposed it. The run finished, its
reports and invalidation manifest were retained, and a provenance refusal prevented dependent
timing trials. Only the owned generated target was removed; a clean rebuild produced the binding
above and passed the weighted contracts. No result from that copied-target checkpoint certifies
`1849f68`. The final measurements above use the verified clean rebuild.

The [final four-action qualification](2026-10-31-application-performance.md#final-implementation-qualification)
passed the unchanged lightweight overhead budget for every action. Required strict CI on the final
implementation source: [run 41240214068](https://github.com/spankyed/apack/actions/runs/41240214068),
which covers all runtime/code changes at that checkpoint. Subsequent changes record evidence only;
the linked gate is the source of its final outcome.
