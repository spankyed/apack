# Candidate portable graph core

The SQLite candidate uses a synchronous WebAssembly transport for pinned `leiden-rs` 0.8.1,
the same single-threaded implementation as elmdb d33f859. The Rust core is built during package production,
never at database open. Supported installed-runtime and resource qualification remain required.
The initial TypeScript dependency passed connectivity tests but failed the native karate-club quality
fixture (0.3952 versus 0.4198); that failure remains required, without changing seed or threshold.

The wrapper owns validation/transport only and propagates errors. Upstream's convenience WASM function
silently returns singleton partitions on error and omits resolution, so it is deliberately not used.
No threads, Rayon, CLI or graph-library adapters are enabled. The getrandom WASM backend permits the
crate's transitive entropy code to compile; every actual Leiden invocation receives an explicit seed.

`build.mjs` uses the committed Cargo lockfile, Rust 1.99.1 and wasm-bindgen 0.2.105. It keeps tools and
targets under this checkout's ignored `.temp/`, remaps build paths, and records source/loader/WASM hashes
plus dependency license texts. Cold production needs rustup/Cargo and registry access; later builds reuse
these private intermediates. No compiled binary enters Git.

The source and compiled entries resolve `dist/sqlite/graph`. App-owned opens validate and instantiate
before creating the database; ordinary internal fixture handles load lazily. Each handle owns a fresh
generated CommonJS module and linear memory, avoiding Node's global require cache, and close releases
its reference. Integrity-checked binding code runs through Node's synchronous module factory; executable
code and locations never come from stored metadata. Missing or changed assets refuse explicitly.

Initial portable CI proves native karate-fixture modularity 0.419789612, repeated results and truthful
errors. Focused EARS qualification includes the unchanged failed quality test and negative loader checks.
Full production-build/platform/app acceptance and realistic graph resource costs still need evidence.
