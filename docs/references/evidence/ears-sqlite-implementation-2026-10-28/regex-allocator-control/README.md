# Controlled Rust-regex allocator rebuild — 2026-10-28

The published rregex 1.13.1 registry gitHead and downloadable npm provenance both name upstream source commit
`ffdc766d0ce78c2bad3eb9ce5f02229e5a47bd8a`. This experiment downloads that exact source archive and retains its
SHA-256 and Cargo.lock hash. The provenance payload is retained as source attribution; this screen did not
independently verify the Sigstore signature bundle.

Disposable Linux uses Rust/Cargo 1.99.1 and official wasm-bindgen 0.2.100 (the version in the lockfile). The CLI
archive is checked against the official release asset's SHA-256. Two builds share the exact source, lockfile,
compiler, bindings generator, target and panic-hook feature. The single feature difference is wee_alloc:

- `--no-default-features --features console_error_panic_hook,wee_alloc`
- `--no-default-features --features console_error_panic_hook`

Each generated Node binding runs the original syntax and three fresh-process memory controls. Both pass syntax.
The wee_alloc rebuild reproduces the published artifact's exact memory sequences: about 81 MB for repeated
patterns and 104 MB for unique/compile-only patterns at 3,000 instances. The default allocator remains at
**1,572,864 bytes** at every sample in all three controls. This isolates allocator selection as the cause in
these repeated-allocation workloads; it does not assert that any allocator makes every application workload bounded.

## Native comparison and mixed workload

The default-allocator artifact then compares 20 patterns over 20 scalar/list/null/empty/text inputs against
pinned native engine 6ab2f69. All 400 input/pattern answers agree, including Unicode properties/words, inline
flags, class intersection, anchors, captures, empty matches, astral text and per-list-element semantics. Five
invalid patterns are refused by both. Actual native and WASM binary hashes are in qualification.json.

A criterion was written before the next measurement: after 200 warmups and eight 500-compile/match/free batches,
the final four WASM memory samples must be equal. The mixed corpus includes Unicode classes, multiline/dotall,
large repetitions and literals. All eight samples equal **2,752,512 bytes**, through 4,200 compiled instances;
observed process RSS stays about 87.8 MB. These samples are not representative app latency, packaged-platform
qualification, a general memory bound or the full search acceptance corpus.

The controlled default WASM SHA-256 is `d811bfd20cacbca239971303e4a28be40a1fcbf7f35dea2258b519bcd20b8c5d`.
Generated runtime assets and private Cargo target remain in owned Linux volume `apack-ears-regex-ffdc766d`;
only source recipes, logs, hashes and JSON evidence are copied out. No Rust build ran on the daily Mac.

## Next integration checkpoint

Use the proved default allocator for an explicitly source-owned, reproducible matcher build; do not install the
stock npm artifact or hide its growth behind a small pattern cache. Keep Rust-compatible bounded matching and
explicit resource release. Qualify lazy synchronous loading, source and packed/Electron/CLI asset resolution,
invalid-pattern refusals and memory stability before treating the bridge as ready.

Integrate native SQLite trigram candidate selection with exact per-element verification, preserve case-folding
and pipeline order, and test against the native oracle. Required-literal extraction must be conservative: a
pattern without a safe selective literal uses the correct scan path. Background generations/readiness and full
realistic relevance/vector/app/I/O acceptance remain in the goal; this successful matcher screen closes none
of those remaining criteria by itself.
