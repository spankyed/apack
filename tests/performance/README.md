# Application performance qualification

This is a manual suite against built application output, separate from the ordinary E2E gate. It
owns a disposable test profile. Never set `E2E_DATA_DIR` to a developer's profile for qualification.
The first scenario is authored but has not yet been qualified in the running application.

Build with the normal repository commands, then run from the checkout root:

```sh
npm run build:default-setup
npm run build:runtime -- --cores 1
npm run test:e2e -- --config tests/performance/playwright.config.ts
```

Use the repository's bounded Linux runner for repeated native/runtime qualification. Electron needs
an available display there (for example Xvfb). `APACK_PERFORMANCE_MODE` selects `disabled`,
`lightweight` (default), or `detailed`. `APACK_PERFORMANCE_TRIALS=1` is a contract/debug run;
it cannot establish latency variability or overhead. The default is five warmups followed by twenty
measured trials in a warmed process. This is not cold disk or fresh-process startup evidence.

The thread scenario imports two deterministic synthetic threads outside the measured interval,
then alternates opening them. Its start is renderer surface-event dispatch, not a physical input
measurement. Completion requires the requested thread, its correlated subscription delivery, all
fifty requested message bodies in the DOM, and a Vue flush. It proves view readiness, not paint.
The display/driver, fixed fixture, and completion checks are common to all recording modes.

Reports go to ignored `.apack/performance/thread-open-<mode>-<timestamp>/`:

- `manifest.json` identifies source/dirty state, actual build/native output hashes and checkout identity, fixture distributions, runtimes,
  machine, recording mode, cache policy and warmups.
- `results.json` retains warmups, failures/incomplete trials, raw process records and median/range/count.
- `trace.json` is Chrome Trace Event JSON for Perfetto. Durations are local monotonic measurements;
  cross-process epoch placement is approximate. Parent ids/links live in event arguments.

Capture integrity (`complete`) does not certify instrumentation coverage. Coalesced watch re-reads
currently have no action parent; contributing commit links and raw actor queue coverage remain open.
Detailed mode currently uses the same bounded tracing foundation; CPU/allocation profiles and process
statistics remain to be implemented. No overhead or performance improvement is established yet.
Streaming, search, populated startup, cross-revision orchestration and qualification remain in the goal.
