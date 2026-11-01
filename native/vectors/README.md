# SQLite candidate vector extension

`build.mjs` builds SQLite's vec1 extension at upstream commit
`814fd8ef4d42d6567f1613a66f556c8194764d06` with `vec1-membership.patch`.
The exact upstream `upstream.c` is vendored with its copyright disclaimer. Builds are offline;
the upstream source SHA-256 is checked before patching or compiling. After patch application,
generated C is canonicalized to LF and its exact expected digest is checked before compilation,
including when Git has a Windows CRLF policy. The upstream
copyright disclaimer stays in the generated source. Build provenance records source,
patch, compiler, SQLite header package, target and binary hashes. No database value
chooses executable code. The database owner supplies a trusted built extension path.

```sh
node native/vectors/build.mjs .temp/vector-native
node native/vectors/membership-test.mjs .temp/vector-native/vec1.so .temp/vector-membership.json
```

Ordinary `@apackdev/ears` package production invokes this builder and stages the library,
minimal target/source/binary provenance and upstream license under `dist/sqlite/native/<platform>-<arch>/`.
Compiler intermediates and absolute command provenance remain under `.temp/`, outside published files.
App-only SQLite opens resolve that package-owned artifact by default, check provenance and the actual
library hash, then load it before connection writes. Missing/stale artifacts refuse rather than compiling
at runtime or silently falling back. An application owner can still supply an explicitly trusted built path.
The CI wrapper independently rebuilds and requires identical ordinary-package library bytes before tests.
Windows links reproducibly; macOS uses a fixed install name rather than embedding its build directory.
Cross-target, installed/signed app, performance and full integration qualification remain separate.
Signing changes library bytes: packaging must finalize the runtime manifest after inner-library signing
and before sealing the outer app. The ordinary unsigned npm package does not establish that lifecycle.

The first argument must name a new output directory. A second builder argument may
override the vendored input with a local copy of the exact pinned source, still subject to its hash check.
Build prerequisites are Node, Git, installed workspace dependencies and the platform
C compiler: cc on Linux, clang on macOS, or an MSVC developer environment on Windows.
The output is `vec1.so`, `vec1.dylib` or `vec1.dll` respectively. These commands are
for build environments; applications load the resulting artifact rather than compiling.

The patch changes integer membership filtering, not storage, model training or ANN
settings. Upstream compares each entry against each allowed owner. Long integer
operand lists are sorted once; compact 1/4-byte metadata binary-searches those
query-owned 64-bit operands directly, avoiding whole-list conversion/allocation for every block.
Generic metadata also uses binary search for all-integer lists, preserving full signed
64-bit owners without a dense-ID bitmap. Compact NULL sentinels remain excluded.
Each entry needs logarithmic membership comparisons. Lists shorter than eight,
non-integer operand lists and other operators retain upstream behavior. The compact
path still accepts upstream's numeric conversion before sorting mixed operands.
It reuses existing operand buffers; the C library owns sorting auxiliary storage.
Previously excluded rows stay excluded when this predicate is applied.

`membership-test.mjs` makes 735 independent comparisons with ordinary SQLite over
none/flat/IVF modes, including compact/sparse/full-width IDs, NULLs, mixed values,
compact NULL-sentinel/out-of-range RHS cases, combined filters, prepared-query reuse, updates,
deletion and nested/outer rollback.
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

## Isolated runtime-dispatch investigation

`app-acceptance` suite `sqlite-vector-dispatch` builds the unchanged generic artifact,
then `dispatch-build.mjs` compiles the same checked patched C into upstream's two-object
Linux/x64 runtime-dispatch library. The AVX2 object explicitly disables FMA; the baseline
object owns upstream CPU/OS feature admission. This diagnostic does not alter ordinary
package production, published manifests, model policy or the supported CPU baseline.
Both artifacts must pass all 735 independent membership comparisons; `dispatch-model-test.mjs` also writes BQ model databases with each artifact and reads them with the other, in separate processes at 128/1536 dimensions, checking full filtered memberships, independent Float64 canonical cosine and cross-backend canonical cosine differences no greater than 1e-5. Hidden approximate BQ distances are recorded separately; the runtime report
records actual Scalar/AVX2 selection and hashes, preserving failures. Compilation happens
in disposable CI. No diagnostic library is substituted into the application.

A passing trial establishes build/loading/membership compatibility on its actual runner,
not latency, recall, representative trained-model variance, non-AVX fallback execution,
Windows/macOS packaging or installed/signing acceptance. Those are required before any
promotion. Next compare paired frozen corpus runs with verified actual backend selection
and unchanged candidate/recall/heartbeat criteria; never infer a speedup from compiler flags.

The diagnostic also runs the actual EARS training suite against both artifacts. Named
OFF/FULL cases hold a real worker snapshot during foreground commits, require checkpoint
busy refusal with retained WAL, and require truncation after worker exit. Existing real
malformed-input/repair, cancellation, stale-generation and close/drain cases remain
required with no skips. These checks prove their specific regimes rather than all
contention, resource or physical storage failure behavior.
