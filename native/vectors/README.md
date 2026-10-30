# SQLite candidate vector extension

`build.mjs` builds SQLite's vec1 extension at upstream commit
`814fd8ef4d42d6567f1613a66f556c8194764d06` with `vec1-membership.patch`.
The upstream source SHA-256 is checked before patching or compiling. The upstream
copyright disclaimer stays in the generated source. Build provenance records source,
patch, compiler, SQLite header package, target and binary hashes. No database value
chooses executable code. The database owner supplies a trusted built extension path.

```sh
node native/vectors/build.mjs .temp/vector-native
node native/vectors/membership-test.mjs .temp/vector-native/vec1.so .temp/vector-membership.json
```

The first argument must name a new output directory. A second builder argument may
supply a local copy of the exact pinned source, still subject to its hash check.
Build prerequisites are Node, Git, installed workspace dependencies and the platform
C compiler: cc on Linux, clang on macOS, or an MSVC developer environment on Windows.
The output is `vec1.so`, `vec1.dylib` or `vec1.dll` respectively. These commands are
for build environments; applications load the resulting artifact rather than compiling.

The patch changes integer membership filtering, not storage, model training or ANN
settings. Upstream compares each entry against each allowed owner. Long integer
operand lists are sorted once; compact 1/4-byte metadata then uses binary search
through upstream's converted operands. Generic metadata also uses binary search for
all-integer lists, preserving full signed 64-bit owners without a dense-ID bitmap.
Each entry needs logarithmic membership comparisons. Lists shorter than eight,
non-integer operand lists and other operators retain upstream behavior. The compact
path still accepts upstream's numeric conversion before sorting mixed operands.
It reuses existing operand buffers; the C library owns sorting auxiliary storage.
Previously excluded rows stay excluded when this predicate is applied.

`membership-test.mjs` makes 555 independent comparisons with ordinary SQLite over
none/flat/IVF modes, including compact/sparse/full-width IDs, NULLs, mixed values,
combined filters, prepared-query reuse, updates, deletion and nested/outer rollback.
The CI wrapper delegates to this same builder; platform qualification must execute
these comparisons and the EARS generation/training/model cases using its artifact.
The older scratch bitmap/text patches remain historical benchmark evidence and are
not combined with this patch.

This is the draft SQLite candidate's native source component. Normal production
composition remains elmdb. Installed Electron/CLI loading, signing, physical recovery,
automatic model ownership and the frozen performance/recall gates remain required
before adoption. Native C cancellation is not guaranteed immediate. A successful
source build or lifecycle test does not certify those requirements.

For an upstream upgrade, review the changed filtering/operand-ownership code, rebase
the patch, update source/patch provenance, rerun membership and complete EARS tests,
then all platform, frozen recall/performance and installed-artifact checks. Do not
silently fall back to unpatched code or treat a benchmark-only patch as the build.
