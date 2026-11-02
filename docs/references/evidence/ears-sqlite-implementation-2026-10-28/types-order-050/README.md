# Current EARS typecheck, correctness lint and 56 regressions

At `050b935a78`, all five EARS inputs changed since frozen `a9c9340df7` were mounted read-only over the verified frozen dependencies: vector execution, numeric ordering, both affected test files, and the watch benchmark. Disposable Linux arm64, two CPUs/6 GiB/no swap/network. Other recorded source hashes were checked before execution.

The complete EARS TypeScript project passes, including its tests and benchmarks; correctness lint passes on all five changed files. This verifies the concrete TS2554/TS7006 scope-counter registration fix found by strict `087` qualification. The runner initially resolved its relative Vitest config twice and failed before tests started; raw startup failure is retained. The corrected absolute-config invocation passes all 56 actual cases in the complete ordering-cost and vector-model suites, with no deselections.

Covered behavior includes keyed inline/overflow ordering, scalar/decoder/corruption semantics, scoped native owner expansion and canonical reranking, read snapshots, transaction rollback, model publication/refresh, independent ownership, worker drain and abrupt owner-process death recovery. This is not the full repository chain, all EARS contracts, supported-platform packaging or application acceptance. Existing active hosted runs retain their original revisions and must not be relabeled as validating this fix.

Compressed original reports, logs, hashed input manifests and reproduction scripts accompany this note; receipts hash uncompressed bytes.
