# SQLite maintenance platform checkpoint

Exact source 34c612ab84d176a1ae4107dbc815892470694181: [run 40873999402](https://github.com/spankyed/apack/actions/runs/40873999402) completed SUCCESS on Linux x64, macOS ARM64 and Windows x64. The ordinary app-acceptance job is deliberately skipped for the focused SQLite matrix.

Each platform passed all nine real offline rebuild/audit command cases, selected text cases and host recovery/storage. EARS passes 539 on Linux/macOS and 538 on Windows with its explicit platform skip; host passes 98/98/86 respectively. Receipts preserve per-platform native/runtime provenance, nonvacuous verification and full report hashes with all skipped-case names. Original raw JSON/logs are in the run artifacts, also downloaded privately for review. No failure or platform skip is relabeled as a pass.

This checkpoint predates local atomic list-membership repair and its kill/resource work. It does not establish a newer full strict/native gate, installed/signed Electron/CLI qualification, arbitrary filesystem support, physical power-loss durability or final adoption. Canonical remains exact full-green 6cf6c8349e; master is unchanged.
