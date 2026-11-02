# Offline native package production and default loading

2026-10-30. Base `a658be490383120518f186fdf31fa1af3a202991`; `suite-inputs.json` identifies
the complete source-suite overlay and `final-inputs.json` the corrected fixture/build-coverage inputs.
All compilation and runtime checks run in private Linux ARM64 containers with **network disabled**,
`--cpus 2 --memory 6g --memory-swap 6g --cap-drop ALL`, image
`sha256:0146a4490634fe153ec35c63e7075a4b3e31b1d1a2996d29c77506c5d07b6507`.
The other agent's observed Rust/Electron validation containers are allowed to finish before this
session starts its next expensive run. No daily profile, working-agent output or Mac compiler is used.

## Package behavior

Ordinary EARS package production now compiles the pinned source from vendored `native/vectors/upstream.c`,
checks its original digest, applies the existing membership patch and verifies the canonical resulting C.
Only the current-target library, stable target/source/binary manifest and upstream copyright disclaimer
ship under `dist/sqlite/native/<platform>-<arch>/`. Compiler intermediates and absolute build provenance
stay in `.temp/`. Build inputs explicitly include the builder, upstream C and patch. No package version,
release metadata, dependency or model/training parameter changes.

App-only SQLite opens resolve that package-owned artifact by default and load it before connection writes.
The resolver checks target, pinned source/patch/upstream, header package and actual library hash. Missing or
modified artifacts refuse `NATIVE_MISSING`/`NATIVE_CHANGED`; no runtime compiler/download or silent fallback
is added. An explicit absolute application-owned extension override remains available. Database metadata
and manifest filename fields do not choose executable paths. Source/compiled modules resolve the same built
asset, and an unpacked published module resolves its own packaged copy.

Windows requests deterministic linking, and macOS uses a fixed install name to avoid embedding a build
directory. Shared Windows Node setup now establishes the compiler before ordinary package production.
The platform wrapper independently rebuilds and requires identical ordinary-package library bytes; its
verifier requires all five loading/integrity cases and rereads both binary hashes. Cross-platform checks
on these new flags/source are still required; the Linux result does not prove them.

## Evidence

- Offline ordinary package build and independent build produce the same binary
  `360c068120fbd25bb947d08ab2908d8981122da84ace8aeba218cd15c90b403d`, also identical to the earlier
  qualified Linux ARM64 library. Canonical C remains `5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b`.
  A subsequent ordinary rebuild after precise input-coverage changes retains those binary bytes.
- All **555 independent membership comparisons** pass against the ordinary package artifact.
- `npm pack` produces a real tarball. The offline probe extracts it, supplies this session's private,
  lock-matching package runtime dependencies, imports its compiled SQLite and engine modules, opens without
  an extension override and executes both `vec1_info()` and EARS create/query. Its native path is inside the
  extracted package; only LICENSE/manifest/library ship. Tarball hash, file list, dependency versions and
  native manifest are retained as JSON; the tarball/compiled binary are not committed.
- All **642 SQLite EARS cases pass**, zero skips, on the runtime overlay. Typecheck then catches the new
  test's use of private `putMeta`; the fixture now inserts the same metadata through its public SQL helper.
  The five artifact cases and types pass after correction. Runtime loader/compiler/index code is unchanged;
  precise build inputs and the stronger platform verifier are subsequently checked separately. This is not
  a later exact full-suite rerun. Current complete platform/Strict qualification remains required.
- Final EARS/host/script types, boundaries, correctness lint and **78 build-coverage/repro guard cases** pass.
  Removing the default loader and omitting binary-byte verification each fail exactly their intended test;
  original bytes are restored and hashed. Actual failures are retained in `controls.json`.

The first offline tarball probe incorrectly inherited root Ajv 6 instead of EARS' declared/private Ajv 8.
Its failure is retained. The corrected probe reconstructs runtime package ownership from the EARS dependency
context, verifies Ajv 8.20.0 and records every dependency source/version. No production import workaround
or network install is used. This tests a real npm payload with controlled private dependencies, not a cold
registry install. Historical runners resume `ears-auto-admission-work` with hashed overlays and read-only
native/dependency seeds; receipts are command evidence, not self-contained images. Exact limits, source hashes,
reports and failed intermediate checks are retained. Corpus/model/dependency payloads and compiler targets
remain outside Git.

## Remaining acceptance

Signed/installed packaging is **not complete**. Signing changes native library bytes; packaging must finalize
binary provenance after signing the inner library and before sealing the app/installer. The unsigned npm
package does not establish that lifecycle or Electron ABI/installed CLI coverage. Other OS/architecture
builds, normal app model-owner creation/recovery, live replacement suspension, physical model refresh,
complete native maintenance, faults, resource/performance/relevance/recall and final Strict/adoption review
remain required. The last real 100k heartbeat still fails 16 ms. No production profile or default elmdb
composition is changed. SQLite source checks use the recorded older native binding as an unused backend
dependency; they do not certify the newer `006d6cec88` elmdb pin.
