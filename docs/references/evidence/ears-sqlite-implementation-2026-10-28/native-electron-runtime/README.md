# Native SQLite runtime and installed-app validation checkpoint

Base: `3333361c3cfe65ea2eddadf29d3f5c893e132177`, with the validation changes hashed in
[current-inputs.json](current-inputs.json). Production remains elmdb. This is component qualification,
not an installed or signed app certificate.

A disposable Linux ARM64 environment ran the actual strengthened packaged-smoke SQLite section under
Node 23.11.1 and Electron 37.2.4 (embedded Node 22.17.1). Both load the identical better-sqlite3 13.0.3
and fs-native-extensions addon bytes without rebuilding: both runtimes support Node-API 10. The initial
ABI-rebuild concern was disproved; selective node-pty rebuilding remains unchanged. Driver SQLite is
3.53.4; `process.versions.sqlite` describes the unused built-in SQLite, not this driver.

The probe writes 4097 128-dimensional vectors, starts the real model service and worker, waits for an
actual ready native model, searches, drains and reopens read-only. FTS, substring and regex checks pass.
Both extracted-section runs complete within the unchanged 60-second parent smoke budget. Missing model
ownership and resolution outside the staged app each fail as expected. See [raw results](results/smoke-section.json).
This does not execute the entire node-pty/keyring/elmdb smoke or an installer. Synthetic timing at
0.5 CPU/768 MiB is not performance acceptance. No binary/dependency corpus is committed.

An initial copied fixture omitted workspace-owner dependency trees and resolved root Ajv 6 rather than
private Ajv 8. Its original failure is retained under `results/initial-owner-dependency-fixture`; correcting
the fixture resolved it without changing product imports. Commands and owner resolutions are retained.

Root E2E types, bundled-editor fixture types and changed-file lint pass in isolated Linux (2 CPU/6 GiB).
The subsequent YAML-only change uses a Bash variable for the repetition regex for macOS compatibility;
the workflow guard was rerun afterward. `final-inputs.json` records pre-change inputs; `workflow-check.json`
and `current-inputs.json` record final workflow bytes. No TypeScript changed after its successful checks.

The new `installed` app-acceptance suite builds an ordinary unsigned Preview, runs the full packaged
native smoke, then launches that actual executable with isolated SQLite selection. Its process-boundary
witness requires both SQLite file headers and model claims held by the packaged API, alongside the five
existing smoke cases. Its report verifier refuses missing/skipped witnesses or retries. Actual CI execution
is pending at this checkpoint; signing, final provenance after inner signing, required architectures and
remaining app/CLI/SDK flows remain required.

The optional bounded `repeat_each` input allows repeated bundled-editor diagnostics without changing the
original assertions or timeouts. One focused pass at base source does not resolve the earlier intermittent
failure. Failure-only diagnostics add focus state; no product behavior is changed here.
