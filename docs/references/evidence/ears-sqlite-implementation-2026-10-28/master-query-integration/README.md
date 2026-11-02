# Pinned master/query integration and real SDK backend coverage, 2026-10-30

Detached candidate `330efa68e6` merges exact candidate `68cf78a2f4` and master
`8b1a479b96` (PR #287), including query-efficiency behavior/tests, SDK `testCalls`
and native `4d558a27543a74e2ea4c131aff1cb32455708994`. Handoff-only commit
`0961982729` is published for [full Strict 40974548264](https://github.com/spankyed/apack/actions/runs/40974548264).
The redundant standalone platform run 40974550572 was cancelled because Strict already
contains that gate. The canonical full-green checkout and other-agent sources remain unchanged.

The new pin is built from its exact independent Git source, in a fresh private Docker
volume with a fresh Cargo target. No Mac compilation, target copy or borrowed mutable
native build is used. Rust 1.99.1, two CPUs, 6 GiB and no swap are recorded. Build time
is 104.98 s; tracked source remains clean. Module exports load successfully. Binding
SHA-256: `7ca9bc6ec1d25df0d9ef4d7e1db7246a7b03734120e587f37629d0efe96f1874`;
CLI SHA-256: `1fd3539dc3e63fd70afb8ef0a95e8e314f83739409089061cd5c8a0086ca643a`.
The actual live build image/resource receipt and complete compiler log are retained.

A coverage gap was found: pack/SDK tests constructed elmdb directly even when the
candidate env selected SQLite for EARS tests. At `e8750da8c6`, a private test-only
factory selects real SQLite for both SDK app and history fixtures with
`EARS_EVALUATION_BACKEND=sqlite`, defaulting to elmdb and refusing unknown selectors.
Production storage remains unchanged. No new public API or API report change is needed.
Repository tests retain all assertions and check the bound query's SQLite explanation
before counting, so native execution cannot stand in for the candidate.

Disposable Linux on matching native source/artifacts passes:

- Two SDK backend-format assertions on SQLite and the same two on elmdb.
- Four current built-pack repository-query cases on each backend, including size scaling,
  page/queue order and watch work, with the SQLite marker asserted on the bound engine.
- Package build, SDK API report and import boundaries.
- 1,319 SDK cases on SQLite with one built-content case skipped because its pack had not
  been built in that separate run. A forced elmdb fallback fails backend selection assertions.
- That missing built-content case passes in a separate prepared run with
  `REQUIRE_CONTENT_RUNTIME=1`; it is not retroactively counted as part of the earlier batch.
  New CI requires the complete prepared SDK suite on Linux with zero skips, the built
  content case, both fixture stores and all four app repository cases on every host.

**The new native pin does not fix the prior own-unit embedding-visibility failure.**
The unchanged targeted assertion executes once and fails (seventeen unrelated cases
are deliberately filtered out). After replacing embeddings inside an open outer unit,
nearest-vector still returns the owner of the old embedding instead of the newly nearest
owner. Its exact source, binding/CLI hashes and raw output are retained under
`native-unit-failure/`. This is not attributed to an old artifact or a changed threshold.
Resolve it in isolated native work, preserving unit/savepoint/rollback assertions, before
claiming full Strict success. The SQLite contracts above pass; they do not excuse this
baseline failure or establish native/SQLite performance parity.

Later selector/CI additions are not qualified by the earlier `0961982729` full run.
Inspect exact live/terminal CI state before advancing canonical. All remaining query/
ANN/WAL/resource/packaging/adoption gates stay in the goal. JSON formatting is normalized
without changing values; original and retained hashes are in `receipts.json`.

## Completed Strict run

On exact pre-selector `0961982729`, completed job `123802305982` (`app-and-rest`)
fails the same unchanged own-unit vector assertion reproduced locally. Its host pool
reports 6,178 passed, one failed and 316 skipped; these counts are that pool, not the
whole Strict run. Completed job `123802306004` (`integration-1`) has a separate failure:
`build-output-swap.integration.spec.ts` /"does not reuse facade files from an incumbent
with stamps from a refused replacement" exceeds its 200,000 ms test deadline. Keep the
assertion and deadline; diagnose fixture/build cost before a targeted rerun. Expected
refusal stderr elsewhere in these logs is not classified as an additional failure.
Raw exact logs are under `strict-40974548264/`. The parent is now terminal **failure**:
producers, both native jobs, integration-2 and all three SQLite jobs passed; only
app-and-rest and integration-1 failed. This is the older pre-selector source, not current full acceptance.

Native diagnosis is isolated at `/private/tmp/ears-native-unit-fix`, an independent
clone checked out at `4d558a2754`, with no shared target and no edits to the working
agent's elmdb checkout. At that failed-Strict checkpoint no native fix had been
committed or published. The later fix and its required validation are recorded below.

## Prepared SDK and current repository platform qualification

[Platform 40977802135](https://github.com/spankyed/apack/actions/runs/40977802135)
is terminal **success** on exact `d28e2de39c974a2b7e96cfafdc38185c1a05d75c`:
Linux x64, macOS ARM64 and Windows x64 jobs all pass. Each host actually executes
both SDK database-selector cases, four built-pack repository-query cases, seventeen
native generation/training/model cases and five profile-conversion kill cases.
Linux's complete prepared SQLite SDK run has **1,320 passed, zero failed or skipped**,
including the built-content runtime case. Linux also qualifies native baseline and
converted-profile API boot, live pack update and restart. Windows retains its explicit
POSIX/directory-sync omissions: 624 EARS / 122 host cases versus 625 / 135 on POSIX.

Raw suite artifacts remain attached to that exact run. Compact verification, runtime,
SDK selector and repository-query receipts are retained under `platform-40977802135/`,
with original and normalized SHA-256 values. This qualifies the new SQLite platform
coverage; it does not fix the older full Strict failures, qualify the uncommitted native
patch, establish packaged Electron support or satisfy remaining performance budgets.

## Native own-unit fix and unchanged CLI reproduction

Native `8ab7088f9a583202f9ccc766381a31e39d19851f` overlays pending embeddings during
unit reads while keeping graph writes deferred until commit. Cosine/L2 regression
covers initial embeddings before graph metadata, replacement, scoped new items,
savepoint rollback and deletion/abort. It passes all 23 vector cases, Clippy,
348 Rust cases (ten existing ignored cases), doctests, protocol/one-LMDB checks,
binding build/types and 33 applicable binding cases (four macOS cases skipped).
Restoring the old implementation in a disposable copy fails the intended assertion.

The original EARS own-unit test now passes once (seventeen unrelated cases filtered)
on exact app `3931f0982f` with the recorded isolated fixed binding. Its native receipt
names base `4d558a2754` plus the tested Rust patch and binary hash, rather than
pretending the binary was built from the later commit. The only subsequent Rust
change relocates an existing doc comment; `source-equivalence.json` verifies identical
non-comment implementation and identical regression source. Exact native platform
[CI 40982141666](https://github.com/spankyed/elmdb/actions/runs/40982141666) is running.
The draft candidate now pins that published fix; no native main merge/release occurred.

The unchanged CLI refused-replacement case also passes: 31.164 s test time, 33.638 s
whole invocation, two CPUs / 6 GiB / no swap. Timestamped logs show all three real
builds complete, with final facade assertions intact. Thirteen unrelated cases were
filtered. The earlier 200 s CI timeout is retained and remains unexplained; this
Linux reproduction does not prove the cause or qualify concurrent macOS execution.
No timeout, assertion, compiler input check or phase was relaxed. Fresh private locked
dependencies were installed after an earlier attempt stopped before setup because
its old seed volume was missing. Full Strict must rerun on the new pinned candidate.

`native-unit-fix/` retains exact app/native/mutation receipts and runners. Source
and generation/training corpus payloads remain outside these records. All remaining
performance, packaging and adoption requirements are unchanged.
