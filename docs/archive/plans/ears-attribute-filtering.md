# Optimize EARS attribute filtering without changing the API

**Status:** superseded, not implemented: the engine moved onto elmdb ([ears-on-elmdb.md](../../plans/ears-on-elmdb.md)), which keeps no copy of the data in memory and holds both databases.
**Scope:** in-memory `query(...).where(X).where(Y)` execution, preserving the public API and current
evaluation behavior. Database persistence and trace-history indexing are outside this plan.

## Decision

Keep the synchronous fluent API and eager filtering at every builder step. Investigate reusing the
attribute store's existing maps before introducing any separately maintained index. Ship an optimization
only if representative measurements show a repeatable benefit without unacceptable regressions.

```ts
query('Note').where('archived', false).where('title').ids()
```

Call sites, signatures, typed facades and terminal methods remain unchanged. This is an internal
execution improvement, not a new query language or a general query planner.

## Findings

- `packages/apack-ears/src/kv/attribute-storage.ts` already owns
  `Map<attributeKind, Map<entityId, values[]>>`. It provides attribute membership and values without
  an additional index. Entity-type membership is separately indexed.
- [query.ts](../../../packages/apack-ears/src/query.ts) materializes initial IDs immediately. Each
  `.where()` filters that array, calling `getAttrs()` for every candidate; each call resolves the
  attribute bucket and returns an empty array for absence. Chaining creates intermediate arrays
  and builder objects, but the next filter already runs over the previous filter's reduced results.
- `.where(kind)` checks whether the value list is nonempty. `.where(kind, value)` uses strict
  equality against any value. An explicit `undefined` selects presence semantics.
- [queries.spec.ts](../../../packages/apack-ears/tests/engine/queries.spec.ts) already covers filtering,
  incoming order and builders retained across deletion. Extend that contract where the optimization
  could change observable behavior.
- [ears.bench.ts](../../../packages/apack-ears/bench/ears.bench.ts) covers a type-filtered value query,
  hydration, writes and relation traversal, but does not yet compare chained presence/value filters
  at different selectivities.

There is no measured filtering bottleneck yet. A chained functional API is not evidence of one.

## Behavioral contract

1. Each `.where()` observes attributes when that method is called. Previously filtered membership
   does not change merely because attributes change later.
2. A retained builder can be branched. Filtering one branch must not modify another branch's IDs.
3. Preserve candidate order and duplicate IDs. Attribute insertion order must not become result order.
4. Preserve starts from a type, multiple types, one ID, explicit ID arrays and all entities.
5. Presence means a nonempty stored value list, including a list containing `null`, `false`, zero,
   an empty string or `undefined`. It does not mean a truthy first value or merely a bucket key.
6. Preserve strict equality: object identity, `NaN` never matching itself, and zero matching negative
   zero. Do not substitute `includes()` or `Set` equality without accounting for their differences.
7. Preserve multi-value and sparse hydrated-list behavior. Adding or dropping values, clearing,
   hydration, destruction and relation-detail writes must remain visible to subsequent filter calls.
8. Preserve existing deletion handling through `setIds()`. Terminal methods hold IDs while projection
   reads current values; this work must not silently redefine builders as complete snapshots or live queries.

Illustrative mutation boundary:

```ts
const filtered = query('Note').where('archived', false); // membership evaluated here
write(noteId).set('archived', true);
const titled = filtered.where('title'); // checks title now; does not recheck archived
```

Fusing those predicates at the terminal would recheck `archived` and change results. Do not implement
lazy fusion, predicate reordering or terminal short-circuiting as part of this plan.

## Proposed implementation

Add a private storage operation that filters incoming candidate IDs by an attribute. Resolve the
existing bucket once per filter call, then apply presence or strict-value matching in candidate order.
Have `.where()` delegate to it and continue to use the existing `setIds()` path.

The operation belongs beside attribute storage because it knows how lists represent membership.
Do not expose bucket maps or mutable lists to the query builder, and do not add a public export.
Use the same operation for `findEntitiesByAttribute()` if it removes duplicate matching logic without
changing that function's ordering or behavior. Do not sweep unrelated query helpers into the change.

This first candidate still scans incoming IDs and retains one result array per eager filter. Its
potential savings are resolving the bucket once and avoiding missing-value array allocations and
repeated wrapper calls. Those savings may be small; benchmark them rather than assuming a win.

Walking a small attribute bucket instead of candidates requires an efficient candidate-membership
structure plus order and duplicate restoration. It is not automatically faster. Consider that second
candidate only if measurements show sparse presence filtering remains expensive after the simple
change. Price transient allocations against the saved probes. Do not create a permanent duplicate
membership index, entity-order registry or planner just to enable this path.

Value indexes, archetypes and bitmasks are excluded. They introduce mutation maintenance costs and
do not follow from the current presence-filtering question. A later value-index proposal must name
an actual query and compare query gains with write, hydration and heap costs.

## Checkpoints

### 1. Establish workload and baseline

**Deliverable:** identify actual `.where()` chains in repositories and extend the existing benchmark
with representative cases. Record baseline measurements before changing execution.

Include single and chained presence/value filters, dense and sparse attributes, missing attributes,
small explicit-ID inputs, reordered/duplicate inputs, type starts and broad starts. Vary selectivity
so an optimization cannot win only on an artificially rare attribute. Keep projection cost separate
from filtering, then include an end-to-end repository-shaped case.

**Closing checks:** verify benchmark result counts against expected results; report repeated paired
before/after measurements and their variability. Agree the observed problem and acceptable query,
write, hydration and memory tradeoff from those results. If no material cost appears, stop with a
documented finding rather than adding machinery.

### 2. Pin semantics and implement bucket reuse

**Depends on:** checkpoint 1 establishing worthwhile work.

**Deliverable:** focused contract cases for mutation timing, retained branches, ordering/duplicates,
strict equality and list presence; private storage filtering operation; `.where()` delegation.

**Closing checks:** new cases pass against the old implementation first, then against the optimized
implementation. Compare ordered results with a straightforward strict-equality filtering reference
across mutation sequences, including bulk load, drop, destroy and clear. Existing query and engine
isolation checks pass. No public API or typed-EARS contract changes.

### 3. Prove value and finish

**Depends on:** checkpoint 2.

**Deliverable:** measured comparison and final implementation decision. Evaluate the optional sparse
bucket path only if remaining measured cost warrants its extra complexity.

**Closing checks:** representative gains exceed measurement noise; existing benchmark cases remain
within the package's documented regression tolerance, including writes and hydration. Run focused
specs during development and `npm run chain` after code changes. If an approach regresses common cases
or needs more machinery than the gain supports, remove that approach and retain the simpler result.

## Validation commands and completion

```sh
npm run spec -- packages/apack-ears/src/query.ts
npm run bench -w @apackdev/ears
npm run chain
```

Use related specs for storage changes too. Read the package's `CLAUDE.md` for benchmark tolerance and
follow the typed-EARS checklist if implementation unexpectedly reaches change-controlled types;
the planned design should not need that. No API report regeneration is expected without public changes.

Completion means unchanged observable query behavior and a demonstrated benefit for the identified
workload, with no separately maintained attribute index. If measurements do not justify implementation,
the valid outcome is an explicit decision to retain current execution. Documentation-only planning
requires link and prose checks rather than running implementation suites.
