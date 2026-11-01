# Preserve packed consumers' dependency ownership, 2026-10-30

Exact [Strict 40982500877](https://github.com/spankyed/apack/actions/runs/40982500877)
on `dd5d7da67e96c44b323e2572c48e529e7593da2e` is terminal failure. Its producers, all
three SQLite platform jobs, both native jobs and integration-2 pass. Integration-1 fails a
**different** case from the prior run: facade equality between workspace and packed consumers.
The original refused-replacement case passes at 93.541 s under its unchanged 200 s deadline.
The app/rest job exceeds the unchanged 600 s host-suite budget; it reports no new assertion
failure before being killed. That timeout remains unresolved, not excused by focused passes.

The packed consumer's fixture links only the root node_modules externals. EARS declares Ajv 8
and resolves its installed private copy, but the packed fixture instead resolves the unrelated
root Ajv 6. Loading the newly reachable SQLite schema module therefore fails on Ajv's named
export. Changing validation code or accepting Ajv 6 would hide the bad dependency graph.

The fixture now preserves each package's private external overrides, found through the existing
package resolver, while keeping packed @apackdev modules in the consumer. Actual bundled files
are retained. A new assertion checks that each declared external dependency resolves from its
owning installed package. The old flattened fixture fails that exact assertion for EARS/Ajv.

On base `1860dd2eb1` plus recorded fixture/test hashes, independent disposable Linux with two
CPUs / 6 GiB / no swap passes **six cases, zero skips**: the dependency witness, all four
TypeScript/current-floor × module-resolution export cases, and the original real workspace/
packed facade-build equality case. Package builds and import-specifier/pack-rule checks pass.
The original implementation is used only in a copied workspace for the negative control.
No assertion, deadline, production dependency version or schema validation rule is relaxed.

Source/overlay receipts, positive/negative reports, commands and compressed exact failed-CI logs
are retained here. New exact full validation remains required, particularly diagnosis of the
host-suite deadline. Canonical stays on its previously full-green source.
