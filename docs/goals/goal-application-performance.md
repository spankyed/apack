# Application performance implementation

Status: active. Isolated worktree `/private/tmp/apack-application-performance`, branch
`session/application-performance` (capability checkpoint), initial source `62f1798c9b`.
Draft PR: https://github.com/spankyed/apack/pull/293. Main checkout and live native source are untouched.

## Acceptance

Implement the approved application-performance plan for all four actions: thread opening,
scripted streaming reply, search and populated startup. Recording is development/test opt-in.
Include bounded OpenTelemetry recording, EARS observation, cross-process/actor propagation,
correct view-ready milestones, source-identified reports and comparison, counterfactual and
mode-overhead qualification, then one evidence-backed application optimization if supported.
Deliver dependent reviewable PR checkpoints and required repository validation. No version changes,
release, automatic CI enablement or speculative engine features. Preserve concurrent work.
The design remains `docs/plans/application-performance.md`; acceptance declares 10,000 encoded
observations/16 MiB per process recording, 20 measured trials per revision in ABBA order, and a 5%
lightweight instrumentation median-overhead budget. All four actions remain in scope.

## Completed capabilities and evidence

- **Recorder and EARS observation:** opt-in, connection-owned recording; bounded spans, metadata,
  links and starts; no global provider, business payloads or error messages. Disabled recording creates
  no provider/context manager/sampler. EARS reports encoded request/result bytes, sequences and
  committed-not-durable outcomes. Diagnostics preserve business outcomes. Focused faults/mutations
  cover observer/export failure, buffer overflow and unfinished work. Capture integrity is distinct
  from instrumentation coverage; sequences are not read-snapshot identities.
- **Context and lifecycle:** W3C carriers outside business envelopes/keys; Node ALS and explicit browser
  restoration; authenticated admission and owner cleanup. Root backend/surface ActorLogic adapters
  restore queued carried events. Coalesced reads are parentless and link affected commits, retaining
  unknown/dropped causes. Fifty Linux tests include a real native two-write view; 104 bus/shell/actor
  tests passed. Internal untagged XState events are not claimed as covered.
- **Thread-open:** real transport, exact requested fifty-message page and full laid-out bodies, matching
  subscription/delivery and Vue flush. It exposed unsolicited pagination during initial positioning;
  `1bc6afe750` fixes generation-owned positioning and suppresses automatic paging until it settles.
  Seven pack tests pass. On `c3ac8b6fde`, five warmups plus twenty measured opens passed with clean
  provenance, complete captures and backend process statistics:
  `thread-open-lightweight-1793392911873`. This is a correctness/work-bound improvement, not a speedup claim.
- **Search:** 1,200 deterministic messages, two complete twenty-match result sets, real supersession,
  correct identities/timestamps/snippets and correlated delivery. The earlier default-length run passed;
  integrated frozen-pin proof on `c2c487ffe0` passed six trials:
  `search-lightweight-1793392521893`. A wrong-identity fault fails despite the correct count. The built-app
  `search-supersession` test rejects actual old results delivered to the actor after supersession and
  cancellation. Transport callback generations have separate contract tests; no forced late wire packet
  is claimed by the actor-level proof.
- **Streaming:** actual CLI service/chat flow, executable configured through normal Settings, fresh
  twenty-message conversation per trial, 24 scripted chunks, intermediate DOM progress and complete
  final text/timestamp in a database-backed view. On `e78bacdcd5`, all 25 trials passed with complete
  captures and backlog data: `streaming-lightweight-1793393644130`. Backlog retains at most 64 raw
  production/receipt points per trial and pending UTF-16 units at receipt, with approximate epoch
  alignment and explicit clock-order mismatches. It is not database commit latency. Real subsequent
  CLI invocations exposed log overwrites; exclusive per-process logs and unique completed-production
  admission fix that. Missing or ambiguous capture fails the scenario.
- **Populated startup:** controller owns, seeds, closes and copies a profile outside measurement;
  parent monotonic launch boundary through admission and the actual restored chat. Preparation finishes
  real onboarding and opens the declared chat. Completion requires the corpus, exact fifty full bodies
  laid out, matching chat revision and Vue flush. The initial main-list predicate was wrong: chatStart
  restores a recent chat and openThread intentionally selects the dashboard. No navigation is injected
  into the measured boot. On `c3ac8b6fde`, six fresh launches passed with clean provenance, complete
  captures and backend statistics: `populated-startup-lightweight-1793392828133`.
- **Node resources:** constant-memory aggregate CPU, sampled RSS/heap maxima, GC and event-loop
  observations for enabled recordings; no per-action attribution or true-peak-memory claim. Timers and
  observers stop; sample faults invalidate capture. Eighteen Linux diagnostics tests and portable-schema
  roundtrip/fault tests pass. Renderer resource observations and CPU/allocation profiles remain open.
- **Report admission:** actual app/native output hashes, clean/dirty authored-source identity, fixtures,
  runtimes, machine/resources, mode/cache/warmups. Whole-run validation rejects missing/duplicate trials,
  invalid warmups, mixed scenarios/modes, missing processes and unsuccessful samples. The manual checker
  bounds input to 64 MiB before parsing and verifies startup aggregate/per-launch consistency. Comparison
  compatibility and ABBA-order primitives exist; orchestration/whole-run retention remain open.

## Controlled measurement proofs

- Full read: tracked disposable-copy script reproduces `app-read-work-bound` with fifty correct rows,
  533,750 returned bytes against the declared 164,809-byte action-window budget:
  `thread-open-lightweight-1793393476165`. This is aggregate window work, not exact causal attribution.
- Backend CPU block: actual console query returned a 200,000-microsecond CPU charge in a process
  distinct from Electron main; backend totals retained 209,995 microseconds, complete captures:
  `backend-block-1793393634712` on `e78bacdcd5`.
- Missing completion: deliberately withholding the correlated finish signal retained fifty actual
  messages but produced `incomplete`, no duration and no success marker, with complete process captures:
  `thread-open-lightweight-1793393806852` on `5b305de133`.
- Observer/export preservation, bounded-buffer loss, queued overlapping contexts and coalesced links
  have focused contract/mutation coverage. A final review must audit the combined evidence against
  acceptance; these proofs do not themselves establish recorder overhead.

## Execution and validation

Native qualification uses clean `/private/tmp/apack-performance-elmdb-pinned`, selected with
`APACK_LINUX_ELMDB_ROOT`, at unchanged `vendor/elmdb.rev`
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. Never use the changing live native checkout for qualification.
The Linux runner preserves owned reports and verifies/reuses existing chain producer caches. Check for
another expensive owner; track the existing job to completion. Raw evidence named above is retained in
ignored `.apack/performance/linux-evidence/`. Commands and interpretation are in `tests/performance/README.md`.

Full local `chain --no-native` and strict CI run `41109512527` passed at `c72035b90f`:
https://github.com/spankyed/apack/actions/runs/41109512527.
Later changes have focused tests/types/lint, regenerated API reports and built-app evidence above.
No final broad-gate claim is made for the current tip.

## Qualification continuation

`session/application-performance-qualification` continues from frozen capability checkpoint
`e68e178f8c`. Strict CI for that checkpoint is run `41127756000`: producers, both integrations and both native
shards passed. App-and-rest failed one repository guard (6,016 tests passed): the guard rejects a
legitimate `testMatch` helper argument. That integration defect is fixed in base commit `da0600e4b0`; twelve focused guard tests and its
typecheck pass. A final full gate is still required.

Detailed Node capture now uses an owned local Inspector session, with no debug listener. It records
V8 CPU and sampled allocation formats, including discarded allocations, sampling parameters and its
30-second requested window. Serialized output is capped at 2 MiB per profile, reserved within the
existing 16 MiB total recording budget. Protocol calls have deadlines; stop closes partial sessions,
retains usable evidence and reports loss. Stop awaits profile cleanup even if trace export fails.
API/startup admission waits for readiness, and connection closure during admission is tested.
Twenty-five focused host tests, eight API tests and ten portable-report tests pass, including real V8
profiles, timeout/expiry/oversize faults and original-error preservation. Host/API/renderer types pass.
Built-app detailed-mode verification is still pending.

Renderer collection is now wired before application actor startup through the SDK's host-only
main/preload bridge. Main owns each debugger with a per-window lease, rejects production/subframes,
and releases on stop/navigation/destruction. A replaced debugger is never queried or detached by its
former owner. It collects named CDP task/layout/heap metrics and the shared detailed profile formats;
frontend long-task aggregates retain no DOM/attribution data. Loss survives in process report fields.
Four focused main tests and nine renderer tests pass, including stale leases, foreign ownership and
observation faults. Public SDK/testing reports are regenerated. On `7e2019da47`, six detailed built-app thread
opens passed with clean source/native provenance, complete backend/renderer CPU and allocation
profiles, all eight renderer metrics available and long-task support enabled:
`thread-open-detailed-1793399557483`. Startup and injected-renderer-stall proof remain pending.
The existing EARS `query.explain()` API provides actual native stages/indexes/visited counts; the
maintained detailed workflow must make that capability explicit without silently rerunning business reads.

## Dependency-ordered remaining work

1. Detailed CPU/allocation profiles and renderer resource observations, with explicit bounded capture,
   cleanup and failure semantics. Preserve the implemented business/recording contracts.
2. Maintained bounded run/comparison orchestration and manifest/trial consistency, including balanced
   ABBA execution and matched-source disabled/lightweight/detailed overhead qualification. Preserve raw
   failures, declare budgets before tuning, and report absolute samples/effects/ranges without tail claims.
3. Complete the prescribed final trial counts on the integrated final source/native identities, including
   populated startup. Reuse valid functional evidence; no timing claim from focused six-trial runs.
4. Final correctness/completeness review, material fixes, broad local/strict validation on pinned tips,
   source-qualified decision evidence and dependent reviewable PRs. Keep #293 draft until qualified.

Do not mark the goal complete from implemented infrastructure, passing individual scenarios or capture
integrity alone. No scope reductions or automatic timing gates are authorized.
