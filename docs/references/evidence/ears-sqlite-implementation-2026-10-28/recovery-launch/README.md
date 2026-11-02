# Recovery child resolution — 2026-10-28

Strict CI [40796822583](https://github.com/spankyed/apack/actions/runs/40796822583) on exact published source
`d9e23b00b7df22124e59625ea8c5de266860c583` failed app/rest; the other five jobs passed. All five failures
were the new recovery crash cases. Their plain-Node children inherited `--conditions=@apackdev/source`,
selected SDK TypeScript, and failed before the intended kill boundary with unsupported namespace syntax.
The prior isolated Linux run did not set that parent condition, leaving this composition untested.

The fix uses the existing `withoutSourceCondition` helper for both `execFile` and reader `spawn`, preserving
other Node options. Children assert EARS and SDK resolve to built output. Actual SIGKILL boundaries,
incumbent/candidate assertions and original 15-second child/30-second case limits remain unchanged.

The retained archive is based on `ebf86401a2120c406eba47253b35bddb3b4484c4` plus the single test-file edit
recorded in the source manifest. In one isolated Linux arm64 container (two CPUs, 6 GiB, capabilities dropped),
normal package builds and host types passed, followed by **73 recovery/storage cases** with parent
`NODE_OPTIONS=--conditions=@apackdev/source`. Lint passed. Removing only the two child environment overrides
made the five crash cases fail again under that condition. Exact runner, archive hash, permission preflight,
passing logs and failing removal-control output are retained. No production code changed. The focused Linux
result does not replace the required strict gate on the new published revision or certify macOS/Windows recovery.
