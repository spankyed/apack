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
