# Rust regex runtime

Generated from upstream rregex source at the commit in `provenance.json`, using its locked dependencies,
Rust 1.99.1 and wasm-bindgen 0.2.100. The generated JS is renamed `.cjs`; the WASM filename is unchanged.
The build disables default features and enables only `console_error_panic_hook`, selecting Rust's default
allocator. The upstream default `wee_alloc` grows memory in repeated compile/free controls.

The pinned source, tool checksum, exact build recipe, matching comparisons and allocator controls are recorded
in `docs/references/evidence/ears-sqlite-implementation-2026-10-28/regex-allocator-control/` at repository root.
The current runtime also includes the small local `extensions.rs` adapter: Rust Unicode lowercase, exact
substring checks and conservative required-literal extraction using the pinned regex-syntax dependency.
Its source checksum and current build recipe are in `provenance.json`; the recipe is retained under
`docs/references/evidence/ears-sqlite-implementation-2026-10-28/trigram-filtering/`. It adds the module to
upstream `src/lib.rs` before building. Only the five runtime/license/provenance files ship in npm; the
extension source remains in the repository. Runtime hashes are in `provenance.json`. Rebuild in an owned disposable Linux environment; normal package
builds copy these portable runtime assets and require no Rust toolchain. Preserve the upstream license.

The private SQLite matcher loads these files synchronously on first compilation and closes each compiled
pattern explicitly. This is not a separate public regex API. Electron/CLI packaging and the complete SQLite
search/index lifecycle remain acceptance work in the SQLite goal.
