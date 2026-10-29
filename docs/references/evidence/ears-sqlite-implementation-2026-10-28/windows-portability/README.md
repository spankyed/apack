# Windows candidate portability — 2026-10-29

Exact published source a4c377cf5b6fcabd74ba26a932fef1cd9c039f5c completed
[Strict chain 40827265393](https://github.com/spankyed/apack/actions/runs/40827265393) with seven passing
jobs and two failures. macOS arm64 and Linux x64 each pass the built Node probe, all **492 SQLite / 95 host
cases**, and the selected-suite verifier. Windows x64 passes the built Node probe but has **488 passing,
three failing and one skipped EARS cases**; its host suite never runs. Integration-2 separately fails a
240-second dependency-graph setup hook and a 140-second build-registry case. That compiler failure is
unresolved; none of these checks justifies promoting this candidate over green 60d4283f68.

## Fixes and causal evidence

- Git's Windows checkout converts the frozen `rregex.cjs` bytes to CRLF. A real `core.autocrlf=true` clone
  reproduces the exact failing CI SHA. `.gitattributes` marks the controlled regex directory `-text`;
  a second real clone preserves both manifest hashes. No asset, manifest hash or comparison is changed.
- The call-count assertion normalizes OS path separators when locating its own file. Production call-site
  reporting stays native to the host, and count/time assertions remain unchanged.
- The interrupted-index test now has the parent kill its child after observing and checking the committed
  cursor. The child blocks further background work after its witness, and the parent retains the exact
  `SIGKILL` assertion, reopen/cursor equality and readiness/result checks. Removing the explicit cursor
  step fails the `afterSeq > 0` assertion. Cleanup stops only this owned child. The original ten-second
  deadline remains; it is not enlarged to hide a failure.

On the approved Windows development VM, a tiny Node-only probe independently reproduces self-kill's
`status: 1, signal: null` and parent-kill's `signal: SIGKILL`, using Node 23.11.1 / Windows 10.0.26100.
Its returned script hash matches the local probe. Both uniquely named VM scratch files were removed;
no compiler, shared checkout, native dependency or VM power configuration was changed. This is a signal
reporting proof, not execution of the corrected SQLite recovery test on Windows.

## Validation scope

The exact three-file source snapshot is based on 2f7de63221; `ears-windows-portability-source.json` records
its archive hash and `validated-source.patch` preserves the changes. Archival checked the working bytes
against that tested archive. The disposable Linux arm64 run uses two CPUs, 6 GiB, dropped capabilities,
real permission-denial preflight and the pinned 6ab2f69 native engine. Five package builds, EARS types,
**35 focused / 492 SQLite / 289 native cases**, lint and import checks pass. The cursor-step removal
control fails for the intended reason, then the source is restored before the complete suites.
`results.json` records setup only; later outcomes are in their named logs. No failed trial is discarded.

The platform CI archive retains runtime/source/loaded-asset hashes and JSON reports from all three
published lanes. This establishes functional built-Node results on those actual hosts, not signed or
installed Electron/CLI distribution, filesystem certification, recall or performance acceptance.
Windows must still run the corrected suite and the independent compiler timeout must be diagnosed
before a new exact integrated gate can be accepted. The full goal's phase 3–7 requirements remain open.

The plain integration job log and its downloaded chain artifact are retained separately. Both timeouts
come from real compiler fixture builds; current logs do not isolate which compiler stage consumed the
budget. Do not attribute them to SQLite, host scheduling, GC or a compiler defect without more evidence,
increase their deadlines, or rerun unchanged source until it happens to pass.
