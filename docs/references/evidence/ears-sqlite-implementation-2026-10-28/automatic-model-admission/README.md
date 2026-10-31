# Automatic initial native model admission

2026-10-30. Base `844e0f6184978565b126b2cccf08ad082c291350`; `final-inputs.json` identifies the
later tested implementation overlay. All compilation, tests and runtime probes ran in private Linux ARM64
containers limited to two CPUs, 6 GiB and zero additional swap, with capabilities dropped. Node 23.11.1,
SQLite 3.53.4 and the normal pinned membership extension binary
`360c068120fbd25bb947d08ab2908d8981122da84ace8aeba218cd15c90b403d` are used.
No working-agent checkout, shared writable dependency/output tree or daily profile is used.

## Implemented owner behavior

An attached native model owner now discovers initial admission without callers enqueueing jobs.
The policy matches the existing exact-query boundary and native owner budget: supported training dimensions
128–4096 divisible by eight, more than 4,096 live chunks, and at least 256 distinct live owners.
Existing registered generations, including failed attempts, are not repeatedly enqueued; explicit retry remains.
Failed logical generations do not create model work. Unsupported dimensions retain ordinary query execution.

Eligibility scans page at most 128 integer references plus owner/trash metadata, with LIMIT materialized
before the live-owner join. They use `chunk_native_admission`; no canonical vector payload is hydrated.
One active scan stores at most 256 distinct owners, a capped live count and scalar cursor/range metadata.
Schema-sized dependency maps, dirty-generation revisions and registered-generation sets are separate from
this data-independent page bound. Input identifier/metadata bytes and native VM memory are not certified
by a row-count bound.

A schema snapshot prepares generation-specific dependencies before its COMMIT. Acceptance only updates
memory. Committed embeddings, membership changes and declared source-field changes dirty the relevant
generations; unrelated fields/types do not. Registered generations stop receiving initial-admission work.
Raw embedding import and schema/rebuild paths participate too. Another connection's commits conservatively
invalidate eligibility when scheduler/readiness polls `PRAGMA data_version`; this is not an idle file watcher
or cross-process watch notification. [SQLite documents the per-connection counter semantics](https://sqlite.org/pragma.html#pragma_data_version).

Relevant writes mark another pass without restarting an active finite-range scan. Cursor and registration
advance only after successful COMMIT; an enqueue refusal retries the same page. The scan is advisory across
intervening mutations: training still takes its own fresh read snapshot and validates the generation/definition.
Primary data, canonical bytes, logical commit identity, FULL writes, training parameters and default automatic
checkpoint policy are unchanged. No new persistent schema or dependency is introduced.

## Qualification

- All **633 SQLite EARS cases pass**, zero skips, on the final runtime implementation. A later test-only
  strengthening of the 255/256-owner boundary passes all fourteen model cases and types; runtime hashes
  are unchanged (`qualified-inputs.json` versus `final-inputs.json`). Normal package build,
  EARS types, import boundaries and changed-source correctness lint pass.
- Seven new model cases cover threshold/rollback, delayed embedding arrival, unrelated and other-generation
  writes, steady-state updates after registration, raw import, another connection, live/distinct owners,
  bounded metadata pages, ongoing writes during scanning, enqueue commit refusal, rebuild discovery,
  unsupported dimensions and a failed logical generation with more than 4,096 already-projected chunks.
- Five controls each fail exactly their intended assertion: disabled admission; missing import notification;
  restarting the active scan on each relevant write; leaving failed logical work pending; and lowering the 256-owner floor to two. `controls.json`
  records actual failing names/assertions, not just nonzero exits. Candidate bytes are restored and hashed.
- The early selective-invalidation iteration passed functional tests but failed typecheck: embed returns a
  `kind`, not a stored count, and the typed connection exposes prepared SQL rather than `.pragma()`.
  Both are corrected; delayed local embedding arrival and cached external-version observation are tested.
  The failed typecheck is retained separately and supplies no acceptance evidence.

## Real corpus, no harness enqueue

The admission-only probe removes the explicit benchmark enqueue. It uses the frozen fresh oracle
`ca6356a0cf0059ba87e5f628e9ae0a32260adf146617acb498c880cdf9442545`, verifies all primary Float32 bytes,
uses FULL/default automatic checkpoints and runs an actual EARS nearest query after readiness.

| Corpus | Automatic enqueues | Metadata pages / references | Ready model | Actual query |
|---|---:|---:|---|---|
| 1,000 × 1,536 | 0 | 8 / 1,000 | Not required | 10 hits, zero native candidate calls |
| 99,900 × 1,536 | 1 | 33 / 4,224 | Ready, 20,000 training samples | 10 hits, one native candidate call |

Large admission takes 20.771 s; heartbeat p99 is **48.143 ms**, still failing the unchanged 16 ms limit.
WAL after admission is 5,718,592 bytes. Small admission takes 5.614 ms; four heartbeat samples are insufficient
for a percentile-acceptance claim. These independent admission probes do not requalify full query/recall,
updated cohorts, live-training write contention, resource growth or application budgets. No speedup against
previous separately trained models is claimed.

## Host recovery observation remains separate

An intermediate 135-case host storage run passes 134 cases and kills one recovery child at its unchanged
15-second deadline (`sqlite/1`, move, alias=true). It reports no failure in the new admission assertions.
That child uses normal storage composition without an attached native owner. Earlier source hashes and the
failed host report/log are retained; it is not a passing full host gate or final-implementation qualification.

The single case subsequently passes in about five seconds. A targeted concurrent recovery/storage diagnostic
passes all 32 cases and retains 43 parent/child phase records, maximum child wall time 2,338 ms, with no kills.
Instrumentation changes only private stderr timestamps/forwarding; operations, assertions and child deadline
are unchanged. Original spec bytes are restored and hashed. The earlier timeout is not reproduced or causally
explained. Do not call it fixed or repeat broad gates looking for green; final host/Strict qualification remains.

## Scope still required

This is initial admission **inside an attached owner**, not normal app owner creation/loading. Trusted native
distribution/signing, empty-stage cursor preparation before populated profile loading, read-only candidate
loading, exclusive recovery/drain ownership, incumbent-preserving physical model refresh, and the complete
maintenance lifecycle remain required. Responsiveness, contention/WAL bounds, current full query/relevance/
recall, physical faults, installed app coverage and final Strict/adoption review remain in the goal.

## Reproduction and retained evidence

Executed historical runners and compressed original reports are retained with exact hashes in `receipts.json`.
They resume the private session volumes. For a fresh reproduction, use `fresh-qualification-runner.py` with:
an exact base Git archive at `/source.tar`; the files/hash manifest from `final-inputs.json` at `/overlay.tar`
and `/inputs.json`; a private lock-matching dependency seed at `/seed`; a separately built matching native
binding at `/engine`; pinned original vec1 C at `/upstream.c`; and empty private `/metrics` and `/results`.
The runner checks limits/lock/source hashes, builds the ordinary extension and runs the final controls,
complete EARS suite, types, boundaries, lint and package build. These fresh recipes are statically parsed
but not a separately executed qualification; the historical runners are the actual command evidence.

Then `fresh-automatic-real-runner.py` uses the already committed admission-only probe source/metadata,
plus the approved corpus at `/corpus` and fresh oracle at `/truth/truth.json`. The exact Docker image tag used
was `apack-linux-test:74d4b8cfe839`; all runs use `--cpus 2 --memory 6g --memory-swap 6g --cap-drop ALL`.
Keep volumes and outputs private. Corpus, model bytes, dependencies, compiler targets and compiled binaries
are not checked in. Exact host/platform/full Strict qualification of the eventual candidate remains required.
