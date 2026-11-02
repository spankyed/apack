# Focused owner reuse and process-death regressions

Current `d57021f70e` vector source/test files were mounted read-only over frozen `a9c9340df7` dependencies in a disposable Linux arm64 container (two CPUs, 6 GiB, no swap or network). All other recorded source inputs were checked against retained hashes. Fresh temporary test databases were used; retained benchmark databases were not touched.

Two selected tests pass; 34 cases are intentionally deselected. The real native selection/owner-expansion test verifies canonical scoring, ties, scope and exclusion, transaction rollback, and no scope-function execution during final reranking. The child-process test commits its training claim with syncs enabled, launches a real worker, and kills its own process without draining. Reopening observes the unaccepted training attempt, preserves canonical embedding bytes and logical commit, recovers the attempt and reaches ready. It does not establish that the kill landed inside a native I/O call or simulate power loss.

The mutation mounts pre-fix `e6212b542e` reranking code with the same current tests. It fails exactly the owner-expansion test: expected zero scope evaluations during final reranking, observed 4500. The process-death test still passes. The mutation harness accepts only that expected failure; the suite itself is correctly recorded as failed.

These focused checks do not replace exact current-candidate platform/full-chain qualification. Compressed original reports, logs, hashed inputs and launch scripts are retained; receipts hash uncompressed bytes.
