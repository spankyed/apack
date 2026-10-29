# Compiler fixture timeout investigation — 2026-10-29

Published a4c377cf5b / Strict chain 40827265393 fails integration-2 independently of the Windows candidate
failures. Its dependency-graph setup exceeds 240 seconds and its first build-registry case exceeds 140
seconds. The actual job log and chain artifact are retained in the adjacent Windows portability evidence.
Those logs do not identify the compiler phase that consumed the deadline. The previous all-green source
is 60d4283f68; no claim is made that the new SQLite changes caused these compiler timeouts.

The focused Linux diagnostic starts at e452d67ae1 and temporarily annotates `commands/build.ts` with
append-only stage timestamps, process CPU totals and memory readings. The exact diagnostic patch is in the
results archive; it is not applied to committed production code. The two original fixture files and their
test/hook budgets stay unchanged. Five package builds and **all seven cases in those two files pass**.
Vitest's JSON `numPassedTestSuites` also counts nested suites; the actual file results are two, not five.
The invocation takes 111 seconds including loading; the file reports are about 35 seconds each. Individual
facade phases are roughly 2.4–3.2 seconds; other visible stages include input capture, generation, frontend
and final validation. This does not reproduce or diagnose the macOS failure, establish normal performance
or clear the required integrated gate.

The first attempt intentionally disables network but setup needs the pinned `lru-cache` tarball absent
from the read-only seed. Dependency acquisition fails with EAI_AGAIN; package setup also fails. Both logs
remain retained. The final runner stops immediately on dependency failure and permits package acquisition;
the checked-in lockfile must remain byte-identical. Both attempts use one disposable Linux arm64 container
at a time, two CPUs, 6 GiB, dropped capabilities and actual permission-denial preflight. No compiler runs
on the daily-use Mac and no mutable dependency/native build is shared.

The existing focused macOS workflow is dispatched once at exact e452d67ae1:
[App acceptance 40834826426](https://github.com/spankyed/apack/actions/runs/40834826426), suite `integration`,
only dependency-graph.integration.spec.ts and build-registry.integration.spec.ts. It is confirmed live
at dispatch; poll this handle, never duplicate it because observation times out. It covers the actual
failing platform after Linux fails to reproduce. Its result remains pending. A focused pass cannot
substitute for the required full strict gate, and no deadline, assertion or input scope is relaxed.
