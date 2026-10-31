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
3. **Codec/assembly.** Obtain focused attribution on selected real query shapes if window captures
   cannot distinguish encoding, native crossing and decoding. Accept a localized change only with
   at least 10% less measured per-query time or allocation, unchanged request/result semantics and
   no unexplained regression on nested/binary/prototype-sensitive values. Do not optimize the rare
   prototype-key fallback solely from reading its implementation.

Recording overhead is a separate acceptance issue: the initial lightweight search comparison was
12.2 → 14.1 ms (+1.9 ms, +15.6%), exceeding the unchanged 5% budget. Retain that failure. Diagnose
its action timeline and recording work before proposing instrumentation changes; no favorable
replacement run erases it.

## Dispositions

Investigation in progress. Results and rejected candidates will be recorded here before closure.
