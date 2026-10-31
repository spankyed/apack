# EARS query efficiency

Status: done, 2026-10-29: [the readings](../../references/evidence/ears-query-efficiency.md).

## Outcome and ownership

Reduce demonstrated unnecessary database and JavaScript work in representative apack queries, keeping
their answers, ordering, errors, transaction behavior and view updates correct. Prefer requesting less
data over making unused data cheaper to return. No performance improvement is claimed by this plan.

apack owns repository queries, EARS compilation and JavaScript result handling. elmdb owns Rust
execution, encoding and the binding. Companion plans in the sibling elmdb repository are
`docs/roadmap/read-allocation-codec.md` and `docs/roadmap/query-work-efficiency.md`. They own internal
optimization and planner acceptance; this document owns application query selection and integration.
Do not require the full application performance suite before a bounded query investigation can start.
Use its [scenario contracts](application-performance.md) when available and preserve interim evidence
with explicit limits.

## Existing behavior to retain

[EARS](../../../packages/apack-ears/CLAUDE.md) compiles a query to a plan at a terminal; it does not execute
each builder step separately. elmdb already has indexed leading filters, streaming early termination,
bounded top-k sorting and field projections. A JavaScript function predicate splits execution at the
function boundary. These are existing capabilities, not missing features to implement again.

Relevant entry points are EARS `src/query.ts`, `src/database.ts`, `src/calls.ts`, feature repositories
in default-setup and their consuming views. Honor the typed-EARS change controls in repository guidance.

## Bounded investigation

Choose at most three concrete queries from populated-thread open, search or a repeatedly updated
view. For each record its caller, fixture, exact EARS recipe and compiled plan, requested fields,
result size, operation count, EXPLAIN observations where supported and elapsed time. Inspect reads
inside watch callbacks and loops as well as their individual execution cost.

Classify the observed waste before changing code:

- Whole rows returned when callers need named fields or identifiers.
- Unbounded materialization before paging or an existence check.
- Repeated point reads that can use an existing set read without changing snapshot expectations.
- A JavaScript predicate preventing useful native execution, where an equivalent existing plan step exists.
- Repeated codec/object work in the connection, measured separately from Rust execution.

An EXPLAIN result describes the native plan; it does not count JavaScript filtering, decoding or
subsequent renderer work. Measure those separately. A returned-row count does not establish rows visited.

Before each prototype, declare the expected reduction and acceptable latency/memory tradeoffs using
the caller's workload. Freeze fixture and source/build identities. A synthetic control can isolate a
mechanism, but only an equivalent application query supports an application improvement claim.

## Implementation policy

Use existing projections, limits, existence terminals and set reads first. Keep the renderer's required
fields explicit and typed. Do not hide multiple independently failing writes in a batch or change an
operation's snapshot solely to reduce crossings.

For measured redundant decoding or copying, coordinate the same workload with elmdb's allocation plan.
Implement only the demonstrated redundant operation; preserve prototype-sensitive field names,
binary values, nested values, frozen results and error handling. One codec pass needed for validation
or ownership is not redundant merely because it allocates.

Do not add decoded caches, prepared-query infrastructure, lazy-row APIs, storage changes or a new
query language under this plan. A query requiring new engine behavior becomes a bounded candidate in
elmdb's query plan, with its exact reproduction and semantics. No speculative index additions: account
for index build, write and disk costs as well as read savings.

## Checkpoints and acceptance

| Checkpoint | Deliverable and dependencies | Done when |
|---|---|---|
| Select queries | At most three query dossiers, from source inspection and reproducible disposable fixtures | The actual redundant work and expected improvement are named; baseline and stopping rule recorded before tuning |
| Reduce requested work | Small repository/EARS changes using existing capabilities; depends on selected queries | Equivalent answers and observable view behavior; counters show the intended work reduction; a deliberate reversion on a disposable copy makes the meaningful work guard fail |
| Remove proven connection waste | Optional measured copy/decode cleanup, coordinated with elmdb profiling | Owned/frozen values and refusal semantics retained; matched measurements justify the change; otherwise record no-change disposition |
| Integrate and close | Current source, focused regressions, required repository gates and maintained documentation | All selected queries have an implemented, no-change or explicitly unresolved disposition; integrated evidence distinguishes native, codec and visible-action effects |

Correctness cases cover empty/missing values, nullable fields, large bodies, ordering ties, pagination
boundaries, units and watch invalidation where affected. A narrower returned projection must still track
all fields that determine membership/order, so changes cannot silently stop refreshing the view.

Use deterministic operation/result-size guards in ordinary tests, not noisy timing assertions. Follow
[bounded validation](../../../CLAUDE.md#keep-validation-bounded); document-only work needs no app suites.
Implementation changes need relevant focused checks and the required converged gates. Preserve failures
and explain differences; do not rerun until a favorable timing appears.

## Evidence and stopping rules

Record dated results under `docs/references/evidence/ears-query-efficiency.md` when execution begins:
source/native build identities, fixture seed/shape, runtime/resources, commands, cache/warmup policy,
raw trial locations, work counters, timings, memory and limitations. Keep mechanism and action results
separate. Do not sum nested call durations or treat an end-to-end decode measurement as pure codec time.

Stop after the selected queries and their bounded candidate fixes. A negative result is useful closure,
with a concrete reopening trigger. Broader planner or API work requires its own evidence and scope.

## Current handoff

Done, 2026-10-29: [the readings](../../references/evidence/ears-query-efficiency.md).
- Admitted: the chat page (thread open), the thread list (a view that refreshes repeatedly) and notes search, with
  message search's short page fixed beside them.
- The chat page took one elmdb change (its `docs/roadmap/query-work-efficiency.md`); the rest were caller-only.
- The list's re-runs were found to be needed: every field it reads is shown or sorted on.
- Follow-ups: `addMessage` finds queued messages by an index on `status`, and the library's folder contents and
  document reads take one read per relation kind.

The application-performance plan remains a separate, unimplemented deliverable.
