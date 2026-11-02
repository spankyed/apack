# SQLite per-string substring and regex filtering

The candidate uses external-content SQLite FTS5 trigram tables, owner indexes and transactional triggers.
Each scalar string and each string list element gets its own raw/folded document. FTS narrows only when a
conservative required literal has at least three Unicode scalars and no NUL; exact Rust matching verifies
all candidates. Short, broad and NUL-containing patterns use owner-index verification. Duplicates and prior
query scopes are preserved; query disposal frees compiled patterns and removes callback contexts.

The tiny repository-owned Rust adapter uses the pinned upstream regex-syntax extractor and Rust lowercase
and substring operations. The retained build script adds `mod extensions` to upstream `src/lib.rs`, builds
locked dependencies with the default allocator, then generates Node bindings. Source/toolchain and generated
hash reports are retained here; `vendor/rregex/provenance.json` identifies shipped runtime hashes. Only
portable JS/WASM source-owned runtime files were copied to the Mac. Rust target/build trees remained in the
owned Linux volume. The upstream license remains in the runtime directory.

Validation runs in disposable Linux using private dependencies and the pinned 6ab2f69 native oracle. Focused
coverage includes actual FTS plans, owner-index plans, no whole-row hydration, early-limit callback counts,
list boundaries, Unicode/NUL, rollback/unchecked repair/reopen, watch settlement, and exception disposal.
The differential corpus checks 20 substring-mode combinations and nine regex patterns over twelve inputs.
Six mutations remove FTS narrowing, join list elements, change case folding, skip update refiling, omit query
disposal or omit the owner index; every mutation must fail its corresponding test before restoring source.

An initial seventh mutation removed a proposed special single-type broad-pattern branch. It still passed the
streaming callback guard. That special branch was removed rather than claiming an unproved optimization;
the unchanged cost guard remains. The failed experiment is retained separately from passing mutation logs.
The full-suite report and installed SDK/runtime packaging checks establish this checkpoint only, not app
or production acceptance. The previous strict run 40716716057 failed because a packaging assertion excluded
the intentional runtime directory; the updated test checks an exact five-file whitelist and executes the
matcher from the installed npm package. It is not a waived or retried failure.

Still open: background text/trigram/vector admission and readiness, missing derived-table recovery and retired
index cleanup; native lazy refusal ordering with mixed types and later zero limits; representative corpus
relevance, full-text phrase/list boundaries, vector recall, resource/latency and supported Electron/CLI packaging.
No filesystem, durability or production-readiness certification follows from these tests.

Final functional validation: EARS types pass; 73 focused cases pass before and after all six mutations; the full
SQLite suite passes 374/374; five package builds and all three API reports pass. The installed SDK case
passes and source, staged and actual npm-tarball runtimes load and match. Static import checking was
interrupted when its parent container exited, so its partial log is not a pass; separate static validation follows.

Separate static validation passes the normal five-package build, 70 build-input/document-link cases, root/workspace
lint, import specifiers and publish-checks types. Its source includes the updated provenance/README. Logs are in
`static/`. The earlier interrupted import log is retained for diagnosis and is superseded by this completed check.
