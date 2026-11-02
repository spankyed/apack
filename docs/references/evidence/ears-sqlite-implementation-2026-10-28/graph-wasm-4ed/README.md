# Portable native Leiden closes the retained quality regression

[41210058617](https://github.com/spankyed/apack/actions/runs/41210058617), source `4ed06bd5a5`, succeeds. The thin WASM wrapper builds pinned single-threaded `leiden-rs@0.8.1`, matching the native algorithm dependency. Actual Node execution reaches independently computed karate-club modularity **0.41978961209730437**, reproduces its result, separates the leaders into four groups, rejects two invalid inputs instead of returning invented communities, and handles an empty graph. The retained TypeScript dependency result was 0.3952169625246548; its failed test and target remain unchanged. The generated Cargo lockfile is reviewed and committed; binary/loader hashes remain in the raw report, with binaries outside Git.

## SQLite integration

Read-only current EARS overlays over frozen a9 dependencies, plus the integrity-verified CI core, pass full EARS typechecking and all **106** focused cases without skips: shared queries/storage, relations, exhaustive graph algorithms, module-state checks and five core-loader checks. This includes the previously failing independent quality test, two independent WASM memories, real invalid-input errors, missing/relative asset refusal and changed loader/WASM/source refusal. The rejected `leiden-ts` dependency is removed. Each SQLite handle retains its own module/memory and close releases its reference. App-owned opens load before creating database files.

The integrated package builder now performs locked Rust/WASM production, keeps private reusable intermediates, remaps source/registry paths, stages executable assets and license texts, and records pinned source/loader/binary provenance. Build fingerprints include its actual inputs, including the hidden Cargo configuration; LF checkout rules preserve the cross-platform source identity. The packaged probe now executes a real communities query before and after read-only reopen and retains graph provenance. These new production-build/packaging changes are **not qualified by the focused overlay run**; their CI run must build and exercise the emitted package before claiming acceptance.

## Preservation and older strict checkpoint

The cleanup receipt removes only owned empty overlay mount points after testing and verifies all 1602 original frozen source hashes before and after; no database files are touched. The original benchmark payloads and source remain protected.

Earlier strict [41206485155](https://github.com/spankyed/apack/actions/runs/41206485155) is now terminal success at `dcbb289e56`, including producers, all three SQLite platforms and five consumer shards. Its final job metadata is retained. It predates pinned-master graph integration and does not qualify the current graph implementation. Realistic graph/app resource costs, new-pin native comparisons, exact-current full CI and packaged-platform checks, and all remaining original SQLite goal gates remain required.

Compressed reports/logs/recipes and uncompressed-byte receipts accompany this note. No compiled payload enters Git.
