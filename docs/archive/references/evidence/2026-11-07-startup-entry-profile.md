# Startup from process entry: findings and recommended work

The largest identified stage is API startup. It includes eager compiler dependencies and repeated
pack/settings admission. API launch also starts late, behind Electron readiness and presentation work.
These findings replace the earlier unassigned “before renderer recording” bucket with concrete callers.

## Evidence and limits

- [Full capture](https://github.com/spankyed/apack/actions/runs/42336447107), source
  `57ff8904b494114f2fab60557efee076710db56d`, artifact `startup-entry-profile-42336447107`
  (ID 13561042368). Includes main/API CPU profiles, startup Chromium CPU/timeline traces,
  process/navigation markers and actual built app files for attribution.
- [Initial Chromium capture](https://github.com/spankyed/apack/actions/runs/42336138740), source
  `565c54630ff1b1a5afcac3cab28ed904ebc8e2ec`. Its Node preloader was stripped by Playwright's
  Electron launcher; its Chromium profiles remain useful. The correction uses explicit `-r` for
  Electron and arms the API child's preloader from there. Neither run was cancelled.
- Both used the maintained populated-startup seed and assertions: five warmups followed by three
  diagnostic trials, all passed, including correct fifty-message restored chat and process teardown.
  Both raw stores passed `readPerformanceRun(..., 3)`. All three full captures have valid main/API
  CPU profiles, marker streams and Chromium JSON. Native pin: `4b67670ba9b2ed58ee13f8463486a6a91292e412`.
- [Compact attribution and selected raw hashes](startup-entry-profile-2026-11-07/attribution.json).
  Artifact reports retain the full manifests, trial bytes, lifecycle and failures.

**These are profiler-on attribution numbers, not a breakdown of the previous recording-disabled
3.97-second median or a new speedup claim.** Full-capture usable-view durations were 5.24–7.34 seconds;
initial Chromium-only captures were 4.03–4.66 seconds. The runs use different disposable macOS runners;
profiling overhead and execution conditions prevent treating their difference as measured overhead.
The app's own recorder stayed disabled to avoid competing CPU profilers; external profiling was enabled.
Sampling is 1 ms. Inclusive CPU categories and timeline events overlap and must not be added.

The source-run API uses `--conditions=@apackdev/source`; this does not certify packaged-app timings.
The early Node hook starts before application imports, with Electron's native startup trace alongside it.
OS/loader work before the hook is visible as elapsed launch time rather than attributed native stacks.
Cross-process marker epochs are approximately aligned, not a shared nanosecond clock.
No application runtime source, performance deadline or correctness assertion changed.

## Findings

| Observed work | Three full captures | Attribution |
| --- | ---: | --- |
| Launch request → API spawn request | 1,298 / 1,322 / 1,441 ms | API waits for Electron readiness and then startup preparation; presentation also runs before spawn. |
| Electron ready → API spawn request | 504 / 564 / 578 ms | A concrete delay after Electron is already ready. |
| API spawn request → early API preloader | 150 / 92 / 162 ms | Process launch/Node entry is smaller than the subsequent initialization. |
| API preloader → listening | 2,465 / 2,240 / 2,917 ms | Largest identified boot stage. |
| First sampled `initializeBackend` frame | 1,048 / 835 / 932 ms into API CPU window | Approximate initial module-loading/bootstrap boundary, not an exact instrumented function-entry marker. |
| `readPackBuild` inclusive sampled CPU | 572 / 598 / 737 ms | Six distinct sampled call paths in every capture: three shipped-build reads and three installed-build reads for one pack. |
| `_compileSettingsDefinition` inclusive sampled CPU | 421 / 459 / 574 ms | Includes Ajv compilation and semantic/default validation; overlaps pack admission above. |
| Native splash-window construction self CPU | 246 / 214 / 238 ms | `ImageView` native frame called by `SplashScreen.createSplashWindow`. Main-window construction adds 52–65 ms. |

### 1. Compiler tooling is in the API's cold import graph

The actual emitted API statically imports TypeScript and esbuild; Prettier is also loaded in the CPU
profiles. These are paid while restoring an unchanged compiled pack, before a user requests authoring.
The SDK build barrel exports compile utilities and settings type generation alongside runtime metadata.
`compile-utils.ts` imports TypeScript/esbuild at module scope and also owns the small `contentHash`
helper; `settings-types.ts` imports `json-schema-to-typescript`. The emitted API contains these imports
and compiler functions, so this is an observed loading boundary problem, not only a source-graph guess.

Node module-format detection alone sampled 174–410 ms; ESM compilation sampled 80–199 ms, with
additional CommonJS loading. These totals cover the import graph, not TypeScript alone; the profiles
do not identify each file passed into Node's format-detection function. Do not claim that removing
one dependency recovers the entire initial 0.84–1.05 seconds.

### 2. Pack admission repeatedly parses and compiles settings

`initializeBackend` checks shipped packs, refreshes the catalog, and calls `loadAppPacks`.
`loadExternalPacks` refreshes the catalog again; each refresh rereads shipped and installed builds.
`loadSingleExternalPack` reads the installed build again. The sampled `readPackBuild` stacks confirm
all six paths; their aggregate cost is 572–737 ms.

`readPackBuild` verifies files and parses the snapshot and manifest. Snapshot parsing reaches
`ManifestSchema`, whose settings-definition preprocessor invokes `_compileSettingsDefinition`.
That function constructs an Ajv compiler and validates defaults. Settings admission/catalog consumers
also compile definitions. Consequently metadata parsing repeatedly performs expensive semantic work.
Hashing, reads and Zod parsing add cost; Ajv/settings compilation is an overlapping 421–574 ms category.

### 3. Presentation delays the critical backend process

`ApiServer.enable` defers startup to `app.whenReady()`. The module runner starts splash, API and
window-manager modules together, but their ready continuations and synchronous work still compete.
The API is requested 504–578 ms after Electron readiness. CPU stacks attribute 214–246 ms to splash
construction and 52–65 ms to main-window construction. The separate splash also creates a second
renderer, confirmed by its 400×400 document and source ownership. This does not prove eliminating it
saves the sum of those costs: parallel work and profiler overhead still matter.

### 4. Renderer work remains, but module evaluation is not a multi-second hotspot

The Chromium-only captures isolate the real app renderer from the splash. Main-thread script
compilation totals 193–234 ms and module evaluation 80–110 ms. Layout totals 58–80 ms, style updates
38–58 ms and paint 34–57 ms. These categories overlap; background parsing overlaps other startup work.

The full capture also shows substantial post-readiness chat rendering, including native/browser
`(program)` samples and ProseMirror updates. Main's `renderer:ready` is not the usable fifty-message
view boundary. Much native work lacks a specific JS function attribution, so assigning it all to
message parsing or proposing a specific editor rewrite would exceed the evidence.

## Recommended order

1. **Separate runtime metadata/data helpers from compiler execution.** Give runtime code a lightweight
   import graph; keep TypeScript, esbuild and schema-to-TypeScript/Prettier dependencies behind the
   authoring/build operation that needs them. Keep the public authoring behavior and qualify its first
   use. Verify the built API's startup graph, not just the source imports.
2. **Make admission produce reusable validated state.** Carry one verified/admitted build and its
   compiled settings validators through startup discovery, catalog publication and executable loading.
   Keep byte verification at the required trust boundaries and invalidate on build/catalog replacement;
   preserve tamper detection, invalid-default refusal, settings recovery and live pack installation.
   Avoid recompiling schemas as a side effect of repeatedly parsing the same metadata. Some shipped
   and installed checks have distinct purposes; do not delete them indiscriminately.
3. **Start the API before presentation work once paths, token and single-instance ownership are ready.**
   Audit which prerequisites actually require Electron readiness. Consider one application window
   owning startup presentation instead of another Chromium renderer, while keeping the usable-view
   boundary and startup failure handling intact.
4. **Then target initial-chat mounting with the renderer trace.** Attribute native/browser time to
   concrete render operations before choosing changes. Preserve all fifty correct message bodies,
   contribution behavior and existing completion assertions.

After each substantive slice, use focused correctness checks and the maintained recording-disabled
matched comparison. A profile hotspot is evidence to investigate and remove demonstrated work;
it is not a promise that its inclusive duration becomes an equal wall-clock saving.
