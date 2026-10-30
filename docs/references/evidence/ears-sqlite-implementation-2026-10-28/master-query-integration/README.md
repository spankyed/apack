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
