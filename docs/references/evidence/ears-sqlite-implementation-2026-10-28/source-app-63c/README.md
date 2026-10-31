# Source-app candidate failure — 2026-10-30

[Run 41152805669](https://github.com/spankyed/apack/actions/runs/41152805669) is terminal failure at
`63c8267994c611bdbf9dbe30e161ba18c949513c`: 32 actual passes, one unexpected failure, one intended
installed-only skip, no flaky results. The exact failing case is `an open editor follows installed pack
activation without losing its draft`, at its original five-second `referenceSuggestion` predicate.
This does not qualify the complete source-app suite after the native change.

The original per-case report, job metadata/log, worker logs and test trace remain lossless. Worker 2 shows
the toggle received at 01:19:13.474 UTC and backend pack activation at 01:19:16.572. The predicate fails
at 01:19:18.005. Backend activation does not prove frontend binding acceptance or editor replacement.
There is no captured frontend contribution snapshot to establish whether delivery was late or the editor
refused a binding. The optional absent Codex executable is handled; it is not established as the cause.

A diagnostic-only test change records the observed extension names at each original poll and, on failure,
attaches accepted frontend editor bindings and app context before cleanup. It keeps the original predicate,
deadline, draft/selection/update checks and original thrown error. No product fix or successful repeat is
claimed. The earlier source-app pass and older unexplained editor intermittent remain separate evidence.
The next checkpoint is a focused real-app observation with these diagnostics, then a causal fix and affected
qualification. All original goal requirements and production elmdb selection remain intact.

The diagnostic source at `e76d83c412` now passes the repository's focused oxlint check (zero warnings/errors)
and complete `tests` TypeScript check with incremental caching disabled. The current 118 tracked test/config
files are copied and hash-verified before checking in one two-CPU/6-GiB/no-swap container. The first local
invocation used ESLint at repository root, which has no ESLint config; it failed before typechecking. That
invocation error and the corrected oxlint/type results are preserved separately. Neither is a product fix
or real-app pass. Focused three-case real-app observation is run 41155440320; inspect its actual report.
