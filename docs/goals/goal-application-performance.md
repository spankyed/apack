# Application performance implementation

Status: active. Branch `session/application-performance`, isolated worktree
`/private/tmp/apack-application-performance`, initial source `62f1798c9b`.

## Acceptance

Implement the approved application-performance plan for all four actions: thread opening,
scripted streaming reply, search and populated startup. Recording is development/test opt-in.
Include bounded OpenTelemetry recording, EARS observation, cross-process/actor propagation,
correct view-ready milestones, source-identified reports and comparison, counterfactual and
overhead qualification, then one evidence-backed application optimization if supported.
Deliver dependent reviewable PR checkpoints and required repository validation. No version
changes, release, automatic CI enablement or speculative engine features. Preserve concurrent work.
The detailed design remains `docs/plans/application-performance.md`; the approved implementation
also declares 10,000 observations/16 MiB per process, 20 measured trials per revision in ABBA
order, and a 5% lightweight instrumentation median-overhead budget. Four actions are in scope
for the initial delivery, even though thread opening is the first vertical implementation slice.

## Current handoff

- Isolated dependencies and package outputs installed/built through repository tooling. No shared
  app dependencies/output; elmdb pin and release metadata unchanged. Host uses sdk-trace 3,
  context-async-hooks 3 and a direct API ^1.10 to match SDK peers (no deprecated sdk-trace-base).
- Private host buffer, span processor and EARS-to-OpenTelemetry adapter are implemented. Recorder
  excludes payloads and error messages, bounds encoded bytes/spans, reports SDK metadata loss,
  and preserves unit/action ancestry for synchronous EARS operations. No global provider installed.
  A clean npm ci now verifies one API 1.10 instance. Regenerating the lockfile from the original
  pinned inputs removed an invalid new nested 1.9 resolution without unrelated dependency upgrades.
- EARS admin.observe registers/detaches an optional EARS-owned observer. Reads/writes/loads/units
  report encoded request/result byte counts, watch/unit flags and available sequence metadata.
  Recorder errors and metadata lookup failures cannot change application results/errors; callback
  reentrancy is suppressed. NOT_DURABLE is distinguished from refusal using native error code
  and actual sequence advancement. Metadata is not a claim about a read's snapshot transaction ID.
- 66 focused tests pass (8 host diagnostics, 6 EARS observations, 6 existing calls and 46 existing
  transactions); host and EARS TypeScript checks passed. An isolated copy with the byte-budget guard
  removed fails the oversized-observation contract using Node's assertion API. A disposable source
  copy with the observer exception guard removed likewise fails its result-preservation assertion.
  Tracked source was untouched for both proofs.
- Public EARS API report regeneration requires built package outputs; don't bypass its guard.
  Initial tsx socket permission failed in the sandbox, then normal escalation allowed it. First
  report update and metadata-optionality refresh passed; generated API diff was reviewed.
  All focused tests and typechecks were repeated successfully after clean dependency installation.
  No setup/test/build process is running. This is the recorder/observer foundation checkpoint;
  full-chain and application-scenario acceptance remain outstanding.
- Next: add
  session lifecycle (active/missing actions, stop/cancel and completeness), standard W3C carrier
  propagation via @opentelemetry/core (declare direct dependency if imported), async context owner,
  actual transport/actor/view-delivery wiring and host lifecycle integration. The adapter accepts an
  explicit active-context getter so it doesn't choose global recording policy. No scenario is built
  yet and admin.observe is not attached by production composition.
- Implement thread-open then streaming/search/startup, source-identified reports/comparison,
  counterfactuals and disabled/lightweight/detailed overhead measurements. Select one supported
  application optimization only after evidence. No end-to-end or performance acceptance is claimed.
- Required chain, strict validation, API checks, real process scenarios and reviewable PRs remain.
  Preserve all four scenarios and optimization scope; do not stop at unit-test instrumentation.
