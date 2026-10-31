# Candidate portable graph core

This unfinished integration evaluates a synchronous WebAssembly transport for pinned `leiden-rs` 0.8.1,
the same single-threaded implementation as elmdb d33f859. It is not loaded by the app yet.
The initial TypeScript dependency passed connectivity tests but failed the native karate-club quality
fixture (0.3952 versus 0.4198); that failure remains required, without changing seed or threshold.

The wrapper owns validation/transport only and propagates errors. Upstream's convenience WASM function
silently returns singleton partitions on error and omits resolution, so it is deliberately not used.
No threads, Rayon, CLI or graph-library adapters are enabled. The getrandom WASM backend permits the
crate's transitive entropy code to compile; every actual Leiden invocation receives an explicit seed.

The initial disposable CI job generates Cargo.lock and records it for review before ordinary locked
build integration. Qualification must prove native fixture parity, truthful errors, deterministic seeds,
asset provenance, supported Electron/Node packaging and resource costs. No compiled binary enters Git.
