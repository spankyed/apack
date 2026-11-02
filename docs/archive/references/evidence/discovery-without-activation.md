# Discovery without activation — checkpoint evidence

Historical evidence for [the discovery plan](../../plans/discovery-without-activation.md).
Its current checklist and the [execution goal](../../goals/goal-settings-and-pack-contracts.md) own
current status and execution order. Dated surveys, proposals and “next” instructions below do not
override them. Unmet acceptance remains required; this record is not an archive of completed work.

### Build cancellation ownership

Implemented in `6641b2c99`. `withBuildSignals` owns public one-shot/watch signals before startup,
drains owned build work, then restores the original signal exit. `runPackBuild` remains caller-controlled
for development and release verification. Development hands initial-build and watcher-startup promises
to its existing hold before awaiting them, aborts them on release, and drains cleanup before profile
removal or process exit. App/profile selection and frontend compilation behavior are unchanged.

Refresh remains in the shared builder, before compiler capture. A real captured-worker case proves
both checkout refreshes affect the executed compiler and a failed refresh prevents reuse. Moving
refresh after capture fails the case. The obsolete assertions placing refresh directly in
`buildCommand` are replaced by this behavior check; the goal records the failed strict run and correction.

Acceptance evidence:

- Ten hold/dev checks pass. Removing drain waits fails both startup cases when cleanup is held across
  an event-loop turn, detecting premature exit/profile removal. Restored source passes.
- Nine real worker/dev cases pass. The three public stop phases preserve SIGTERM exit and remove their
  worker and private compiler; interruption during compilation publishes no build. Existing deadlines remain.
- All 852 CLI unit cases, CLI typechecking and lint pass. The converged strict checkpoint passes all
  30 checks (11 executed, 19 cached), including all 745 integration cases. Seven EARS/content baselines match.

Evidence: `/private/tmp/apack-build-cancellation-{restored,mutation,process,signals,typecheck,lint}.log`,
`/private/tmp/apack-build-cancellation-refresh-{focus,mutation}.log`,
`/private/tmp/apack-build-cancellation-cli-unit.log`, and
`/private/tmp/apack-build-cancellation-converged-strict.log` (run `2026-10-16T03-43-08Z-54352`).

This completes the cancellation slice. Coherent frozen inputs, ambient runtime options, long-lived
frontend compilation, whole-build receipt publication and passive freshness consumers remain required
before a freshness-reader migration. Source commits and focused passes do not complete those contracts.

The caller audit also identified release verification. Implemented in `bc6464a9c`: its current
contract intentionally retains bumped version files when verification fails and reports recovery,
with no automatic rollback. Signal ownership covers only the compiler build and runs that recovery
report before restoring signal exit. Synchronous typecheck/test runners and subsequent release phases
retain their existing signal behavior. No real publication or repository version metadata changed.

All 30 local release cases, CLI typechecking and lint pass. Two recovery-before-exit cases fail if the
interruption callback moves after `process.kill`; restored source passes. A normal verification case
proves build signal ownership ends before synchronous runners. All four real public cancellation
phases pass, including release dry-run: worker/compiler removed, SIGTERM preserved, no archive published.
Focused evidence: `/private/tmp/apack-release-build-lifetime-{focus,mutation,restored,process,typecheck,lint}.log`.

The strict checkpoint passes: run `2026-10-16T04-08-31Z-96133`,
`npm run chain -- --strict --cores 4 --no-classify`, exit 0, 841.0s, 29 checks executed and one cached,
including all 749 integration cases in 58 files. All seven EARS/content baselines match byte for byte.
Log: `/private/tmp/apack-release-build-lifetime-strict.log`. Source stayed fixed through validation;
`bc6464a9c` commits it. No further broad run is needed to record this evidence.

Next is the complete input/publication contract above. In particular, inherited `NODE_OPTIONS` still
reaches the worker while `captureCompilationInputs` records only its export conditions. Account for
actual loader/preload code, its resolution and options in the owned compiler execution view; a new
hash alone does not freeze that execution. Preserve the full pack/external-input, frontend lifetime,
atomic receipt and passive freshness scope rather than substituting an ambient-options-only fix.

### Resolution namespace identity checkpoint

Current audit: `readCompilerModuleInputs` forwards missing-file, directory and directory-entry probes
to subscriptions, but only loaded text enters its hash. A missing external resolution directory becoming
an empty directory, or a dangling external link changing targets, therefore leaves the old identity
unchanged. Both cases reproduce with private filesystem fixtures before this change.

Record these observations in the same reader, normalizing physical paths through existing compiler
origin mappings, and include them in its fingerprint. Preserve authored/generated exclusions, relocation
and timestamp independence. Refuse differing observations of one namespace within the scan. This is a
namespace-identity prerequisite, not frozen execution: supported pack/external bytes, ambient loaders,
long-lived frontend execution, atomic receipt publication and all passive consumers remain required.
Do not switch the mtime readers on this narrower evidence.

Acceptance: missing-directory and dangling-link changes invalidate identity and exact restoration
restores it; a link changing during discovery refuses; generated-output creation does not invalidate;
existing private-capture, relocation, type/Vue and external-package coverage stays green. A real content compiler creating a missing external resolution directory must refuse publication,
retain the incumbent output and clean staging. Exercise a successful public pack build through the
required strict checkpoint gate before committing.

Focused acceptance passes: 32 module/compiler/builder cases, three compilation/publication cases,
CLI typechecking and lint. Removing namespace hashing fails the three new identity cases; the real
publication case also fails because the mutated build incorrectly succeeds. Exact source is restored.
The final publication fixture resolves its SDK dependencies and reports no unrelated build errors.
Logs: `/private/tmp/apack-module-namespace-{before,restored,publication,mutation,publication-mutation,typecheck,lint}.log`.
The first strict gate fails one existing watcher assertion: run `2026-10-16T04-30-36Z-35063`,
849.3s, 749/750 integration cases pass. The external-types watcher does not observe publication or
reported failure within its unchanged 20-second bound. The same case passes alone; the cause is not
proved. Evidence: `/private/tmp/apack-module-namespace-{strict,watch-focus}.log`. No external-pack app
check ran, so that coverage remains outstanding.

The original recorder redundantly sampled filesystem operations after TypeScript had already returned
their outcomes. A private-fixture probe measures 4,940 stat / 8,172 realpath calls versus the committed
reader's 2,290 / 187. Record actual query results and reuse only logical parent normalization; physical
targets remain freshly observed. The same probe now measures 2,292 / 5,088 calls. These single-probe
measurements establish avoidable work, not the watcher timeout's cause. A new ancestor-retarget case
checks that logical normalization cannot hide a changing physical target. Thirty focused namespace/watch
cases pass. Exercise the watcher with its relevant peer suites before the required converged gate;
no broader rerun as diagnosis and no deadline or assertion changes.

The equivalent committed-reader peer baseline passes all 15 cases (external-types: 54.423s). The
candidate's next focused peer run still reaches the 60-second total limit (14/15 pass), despite avoiding
failed realpath calls for absent leaves while resolving their parents freshly. Evidence:
`/private/tmp/apack-module-namespace-{base-peers,query-peers,cost-query-final}.log`. Do not claim a proven
timeout cause from these comparisons. Stop rerunning validation or making small probe optimizations.
Keep the acceptance above and integrate namespace recording with the coherent captured input-read
view already required by this plan. Actual compiler queries should consume captured data/bytes rather
than adding repeated live reads. The candidate is not accepted or committed; full input/publication
ownership and all discovery/goal phases remain required.

#### Captured TypeScript read view

The private probe observes 2,650 queries but 638 distinct path/query pairs. The next implementation
owns one filesystem view per TypeScript input scan. Configuration parsing, Vue script extraction and
the compiler host consume its captured metadata, file bytes, directory results and physical bindings.
Repeated queries return those owned values; they do not resample live files to construct a fingerprint.
Use one projection for its fingerprint and check the captured inputs once after the program finishes.
Changed/missing inputs, link targets and directory membership refuse; exact restoration remains valid.
Retain byte identity and TypeScript's supported BOM decoding, physical/source-origin normalization,
generated-output exclusions and duplicate-origin refusal. Returned arrays must not mutate the view.

The view is a TypeScript-query boundary. Authored root membership continues through the shared walker
and must be checked before accepting that scan. This does not freeze Node imports, esbuild/Vite reads,
content compilers, dependencies or long-lived frontend execution; all remain in the full input-frame
work. It is not the successful whole-build receipt or permission to switch mtime-based consumers.
Return the captured scan's validator with its identity. `captureCompilationInputs` must validate that
owned read-set and root membership rather than instantiate a fresh TypeScript program at every
assertion. Keep full npm graph, compiler implementation and execution-option checks; newly winning
resolution candidates are refused through their captured negative/namespace inputs. This is per-build
ownership, not a timestamp/global cache. Poison rediscovery after capture and prove unchanged checks
still pass while changed authored bytes and new roots refuse.
Acceptance adds actual captured-byte/negative-query reuse and changed-input refusal, keeping all saved
namespace and real-publication regressions. Re-run the targeted peer workload only after the changed
ownership is implemented and focused checks pass; broader validation still needs a converged candidate.

The implementation retains the scan's data validator in `captureCompilationInputs`; a poisoned
rediscovery path proves unchanged assertions avoid reconstructing the program while changed authored
bytes and new roots refuse. Fifty-eight focused cases and four real compilation/publication cases
pass; CLI typechecking and lint pass. The `outDir` relocation regression is fixed by canonicalizing
inferred absolute glob exclusions. Captured mappings/arguments/results cannot mutate the fingerprint.
Five guard mutations are caught and restored; the goal records their logs. The four-file watcher
workload passes all 15 cases in 65.66s, at four-worker width with unchanged limits; external-types takes
56.935s. `/private/tmp/apack-compiler-file-view-watch-peers.log`. The older recorder is preserved in
stash `5443490ae`.

Implemented in `e171b3acf`. The converged gate passes: run `2026-10-16T05-29-27Z-83403`,
`npm run chain -- --strict --cores 4 --no-classify`, exit 0, 823.5s, 29 executed and one cached,
including all 751 integration cases in 58 files and the external-pack app check. All seven EARS/content
baselines match byte for byte. `/private/tmp/apack-compiler-file-view-strict.log`. Source stayed fixed;
no validation process remains active. No further broad run is needed for recording this result.
The existing output-change warning still belongs to complete publication/freshness ownership.

The next checkpoint below reproduces and repairs the private phase-cache/output association defect.
Then complete the full frozen execution frame and receipt. This checkpoint owns TypeScript discovery
queries and validation of their read-set; it does not freeze all pack/dependency/compiler execution,
complete the receipt, migrate freshness consumers or finish the remaining discovery and goal phases.

### Publish phase-cache metadata with the output it describes

The inspected ordering risk is reproduced on `e171b3acf`: a real typed pack initially exports a string
field. After its source changes to number, a refused `replaceDir` retains the incumbent output but
leaves the candidate's stamps in `.apack/build-cache.json`. Retrying reports facade reuse and seals
the old string facade against the new source. `/private/tmp/apack-phase-cache-placement-before.log`.
This proves the cache association defect; it does not explain the separate chain output-change warning.

Write private phase metadata to `phase-cache.json` in the staged build, before sealing it. Read it only
from the verified incumbent `dist`, checking the consumed bytes against its receipt. The same directory
replacement then publishes cache and output together; refusal retains both. Staging's existing section
policy omits this root private file from installed/archive layouts. No second build-revision protocol,
old-path read, compatibility conversion or new public manifest/format key. Missing/unreadable cache
means a cold build. Keep the complete integrity check before any reuse.

Acceptance: reproduce a failed replacement and successful retry with the correct new facade; retain
incumbent cache bytes/revision on refusal; include the source cache in integrity while excluding it
from verified staged installation; reject edited output/cache for reuse. Preserve valid unchanged
phase reuse and worker-failure retention. Run focused cache/publication/worker checks and required
checkpoint validation. This is private phase reuse, not the whole-build input receipt or source-freshness
authority. Diagnostic reads remain outside the published tree and need accepted-output association
with the complete input/publication contract; all frozen-execution and later goal scope remains required.

Source `17438889d` passes 12 real publication cases, DSL retention/reuse/removal, real worker repeat-build
identity and 23 cache/read unit cases. The DSL preflight first refused a stale distributable CLI;
refreshing packages and the targeted DSL/worker run close that prerequisite. Verification-bypass and
post-seal-cache mutations both fail and are restored. The reader now verifies before consuming cache
bytes; final damaged-output/cache cases pass. The goal records exact logs. The converged strict
checkpoint passes on fixed source: `npm run chain -- --strict --cores 4 --no-classify`,
run `2026-10-16T06-10-32Z-26560`, 865.3s, 29 steps executed and one cached, all 753 integration
cases in 58 files and both external-pack halves passing. All seven EARS/content baselines match after
validation. `/private/tmp/apack-phase-cache-strict.log`; PID `26560` is terminal. No further broad run
is needed to record this checkpoint. The default-pack output-change warning remains unresolved.

Next finish complete execution ownership and whole-build input/output association before replacing
freshness readers. In particular, inherited `NODE_OPTIONS` has executable preload/loader effects
beyond the export selectors currently fingerprinted, and the dev Vite server outlives the captured
compiler worker in the supervisor. Preserve supported options and live development while closing
these boundaries; neither a hash-only options patch nor silently stripping options establishes
coherent execution. All remaining discovery and goal phases stay required.


### Launch-capture proof and native-view prerequisite (2026-10-16)

The disposable proof runs `--require`, `--import` and a transforming `--experimental-loader` from
captured copies, after changing and then deleting their original source directory. It exercises the
actual CLI, TypeScript/JSX content compiler, backend esbuild and Vue frontend bundle. Captured preload
values reach compiled content; CJS source globals, ESM metadata, loader origin and relative resolution
retain logical source paths. Relocating the captured copies between two full builds changes none of
14 output digests. This is evidence for the execution boundary, not a complete input receipt.

One tempting implementation fails before the compiler starts: installing the same synchronous ESM
hook from an early CJS preload also installs it in Node's loader thread, where the probe fails with
`resolveSync() method is not implemented`. The successful probe uses CJS resolution/compilation hooks
in the prefix preload and an earlier asynchronous ESM byte-projection loader. It does not replay user
preloads after loading the compiler, change their relative order, or require their original modules.

Source `0c038442b` removes TypeScript activation from the native file view. Its compiler adapter now
supplies glob enumeration; queries retain that provider for validation. A bundled view has only five
local native modules and loads/reads/disposes without loading TypeScript. That production view also
runs in the successful prefix-preload probe, in both the main and loader threads.

Keep the working prototype saved, not installed as runtime code: stash
`989c457c4a543270f395014e28084d58641ebcb3` includes the portable experiment under
`scripts/launch-capture-proof.mjs`. Its portable packaging is syntax-checked; the executed proof and
raw results are `/private/tmp/apack-launch-proof-native-view.mjs`,
`/private/tmp/apack-launch-proof-native-view.log`, and fixture
`/private/var/folders/4p/krfrhcfn4497f_6_ks06f9dr0000gn/T/apack-launch-proof-dEMOac`.

The next implementation must connect this boundary to the existing owners, rather than add another
source scanner or treat this prototype's hand-maintained fixture as an input inventory:

Observation prerequisite `2208be219` supplies serialized native-view facts and a common conflict-checked
merge/hash projection. Stat fields and cursor positions are separate facts, permitting complementary
thread reads while rejecting overlapping disagreements. A real Worker proof preserves a conflict after
the source returns to its original bytes. This does not implement the startup transport, reuse the
preload frame in compilation, validate originals at publication, or authorize passive freshness.
See the owning goal's current handoff for focused evidence; the following integration remains required.

Adoption prerequisite `f684f9b7e` extracts the native authored-input view factory and lets compilation
retain a preexisting view. A real Node require-preload proof creates it before TypeScript activation;
later compilation retains the early reads' bytes, validation and lifetime. This supplies the shared
main-thread owner without introducing another exclusion policy or recapturing its observed inputs.
It does not yet install automatic preload interception or implement the main/loader transport.

1. Define the pre-startup handoff from the selected captured compiler, existing package/input traversal
   and logical path projection. Preserve effective user options and native preload/loader ordering;
   identify internal instrumentation by the process that owns it, not by an option-name blacklist.
2. Give main and loader threads one coherent capture/observation contract. Reuse native file/query
   semantics, include newly observed external inputs and reject conflicting observations of one source.
   Avoid synchronous main-thread RPC from loader callbacks; prove `import.meta.resolve` stays live.
3. Reuse that frame after preloads during actual compilation. Final original-input validation must
   reject changes/deletions made after capture; the prototype deliberately does not enforce that
   producer rule. Only then bind the frame to sealed output and enable passive receipt consumers.
4. Give backend and frontend one compiler-generation owner. Ordinary source edits need fresh build/
   transform views and live original-path watches, preserving Vue HMR. Compiler/preload changes must
   replace both consumers through a checked generation handoff. A one-off frontend bundle is not proof
   of the live development contract; exercise that path before settling the complete session design.

Generic module/data capture, options beyond these probes, native resource/Windows/detached-process
ownership, coherent cross-thread observations and live HMR remain required. This proof does not justify
publishing incomplete receipts, activating packs for discovery, or deferring any remaining goal phase.

### Execution ownership audit after phase-cache publication

Transport prerequisite `58f7f3b47` now uses one bootstrap-safe Node option tokenizer/formatter across
source-condition removal, selector capture and the root wrapper. It follows [Node's native tokenizer](https://github.com/nodejs/node/blob/v23.11.1/src/node_options.cc#L1619),
including literal single quotes and backslashes outside double quotes. Native nested-wrapper and
captured-worker checks preserve a preload path containing repeated spaces. The owning goal records
source/build/check evidence; the saved parser stash remains intact.

This does not settle launch ownership. User preloads/loaders run before the current worker creates
its compilation view. The next launch design must own that pre-startup execution and its reachable
inputs, preserving loader ordering and resolution; neither replaying options after compiler activation
nor hashing mutable preload paths meets that requirement. Keep the execution/session and final
receipt requirements below before migrating passive freshness consumers.


A disposable two-process probe confirms the inherited-preload identity gap on `17438889d`.
Both processes use the same minimal pack, compiler, Node arguments and `NODE_OPTIONS=--require=<file>`.
The external preload's bytes change between launches and set different observable global values;
`captureCompilationInputs()` followed by `assertCurrent()` succeeds with the identical hash in both.
Evidence: `/private/tmp/apack-preload-identity-audit.log`, retained fixture
`/private/tmp/apack-preload-identity-64w_dms1`. This proves executed code is absent from the input
identity. It does not reproduce stale emitted pack output or establish the output-change warning's cause.
No repository source, build output or production data changed during the probe.

Current consumers require one execution contract, not an independent options hash:

- `build-process.ts` forwards ambient `NODE_OPTIONS` into the owned worker, while
  `compilationConditions()` records only custom export selectors. Account for executable preloads,
  loaders, their resolution context and reachable inputs before startup, with the code the worker
  actually executes bound to that capture. Preserve supported launch options; do not strip them to
  make the input set easier to describe. Distinguish supervisor instrumentation from compiler inputs
  by actual ownership, rather than assuming every `--require` or `--import` is instrumentation.
- `dev.ts` imports Vite and creates its server in the supervisor; `watch.ts` separately owns a builder
  that can replace its captured compiler. A fresh backend worker therefore does not refresh the HMR
  compiler. Define one session owner and checked handoff for both consumers. Preserve frontend HMR,
  rebuild/reinstall ordering, marker identity, failure recovery and awaited shutdown; a worker's ready
  message must describe the compiler generation it actually holds.
- These changes must fit the full pack/external read frame and successful input/output publication.
  A freshly computed hash over mutable paths is not frozen execution. Do not switch freshness readers
  until the producer owns that association and passive readers can verify it without activating code.

Before implementation, settle the launch representation and session ownership against the current
bootstrap, captured-installation paths and watcher cleanup. Prove real preload/loader effects are
accounted for, equivalent launches remain stable, changes during compilation refuse publication,
and an actual development server cannot keep serving an old compiler after a successful refresh.
Use focused process/filesystem fixtures first; reserve the next broad gate for the converged source
checkpoint. All other source/external-input, receipt, discovery and later-phase requirements remain.


### Snapshot-led hybrid evaluation (2026-10-16)

Production increment `00a6e3db5` routes native module resolution and declaration compilation through
the shared owned input tree. Captured package entry metadata survives transient live edits, implicit
absolute config inheritance works with original configs absent, and original source-map paths and
repeat-build identity are preserved. Keep normal native resolution for ordinary imports: a surface
`build.resolve()` round-trip discards internal per-file configuration context. The owning goal records
focused evidence and the exact retry; no new broad acceptance is claimed.

Source `6b384ff1c` fixes a demonstrated external-glob omission: a successful native bundle could
throw a missing-module error at runtime. A shared syntax observer identifies conservative namespaces
under relative dynamic import/require prefixes. The initial TypeScript scan captures their files and
membership; native-only modules admit them before expansion. Native esbuild still selects matches
according to its [glob import semantics](https://esbuild.github.io/api/#glob-style-imports). The real
external glob case preserves original bytes through a transient live edit; nested runtime dependency
precedence hidden by a declaration entrypoint also matches the native baseline without another
resolver redesign. The owning goal records focused validation.

Source `1a87aa11e`, the absolute-import projection checkpoint, removes the remaining custom resolver
round-trip. Absolute executable module references become equivalent relative references within the
owned tree before native parsing, including generated stdin modules. Ordinary data strings stay
unchanged, authored source text is retained in source maps, and two independent captures produce
identical JavaScript/maps. A previously broken implicit-JSX absolute target and the generated content
compiler now execute correctly. Source-map edit mappings use the explicitly declared `magic-string`
dependency. The owning goal records source and focused evidence.

Remaining native acceptance includes complete namespace/metadata behavior and source-map chaining
for authored pre-mapped JavaScript. Do not infer complete closure from these demonstrated cases.
Source `6c5c6613d` starts the direct Node boundary: content compilation's sync, callback and promise
file reads consume the shared input view under an asynchronous build scope. Raw data uses its own
projection within the same tree, preserving authored JSON values independently of native metadata
projection. Staging-output reads and writes retain their existing behavior; concurrent scopes do not
share captured values. Existing compiler-installation reads stay owned by that installation. Real
content execution, concurrent scopes, source error paths and the actual captured build worker pass.
The worker exposed and removed a synthetic stdin directory import that enumerated shared temporary
files; stdin now prepares the real source scope. The owning goal records source and focused evidence.

Source `477b4fef5` extends the scope to read-only sync/callback/promise opens. Native read streams,
opened descriptors and promise FileHandles consume captured bytes; stream paths retain source
identities. Numeric read-only flags, live writable descriptors and promise output writes have real
compiler coverage; the captured content worker passes. Shared callback dispatch preserves source
error mapping. The owning goal records focused evidence.

Source `e7cd3d3d4` captures native sync/callback/promise directory results, options and Dirent
metadata in the same input view. Consumer mutations cannot modify captured arrays/Buffers/Dirents.
New representations validate overlapping prior observations; repeated queries preserve captured
membership through transient edits. Live validation checks membership/types and explicitly leaves
the captured-read scope, avoiding self-validation and recursive reads. Explicit data reads no longer
inherit source-discovery exclusions. Scoped integration, 61 unit cases, types/lint and the real content
worker pass; the owning goal records the initial scope failure, fix and focused evidence.

Source `9421d496e` adds path metadata/query ownership for stat/lstat, realpath/native realpath,
readlink, access and existence across native API families. Metadata is captured from source inputs,
not readonly copies. Stats field accessors record consumed fields for live validation; unused
volatile timestamps are not dependencies. Real filesystem checks preserve class methods, bigint
values, Dates, structured cloning, inspection and native errors. The initial Proxy representation
failed a cloning probe and was replaced before commit. Native custom promisification for `exists`
is retained. Final metadata execution and the actual captured content worker pass; owning evidence
is in the goal. This does not establish complete native object/reflection or argument-form fidelity.

Source `7906c217f` records numeric/bigint source stat snapshots with captured bytes and projects
owned `fstat`/FileHandle stat results through them. Actual descriptor identity is checked before
projection. Closure and reuse release the operation's exact owner; absent ownership is explicit so
late callbacks cannot adopt/erase a newer owner. Native handles retain their receivers, disposal and
invalid-descriptor errors. Default callback opens capture inputs too. Real path-replacement, writable
output, borrowed-receiver and stale-owner cases pass; the goal records focused evidence.

Source `19e28caea` adds native Dir-backed sync/callback/promise opendir capture. Its own native
traversal order, encoding, buffer size and recursion are recorded rather than borrowing readdir's
semantics. Projected handle reads retain closure/receiver checks and native locking; queued reads,
async iteration and caller-facing relative/Buffer paths have real filesystem coverage. Omitted options
stay omitted, preserving Node defaults. Diagnostic mapping no longer materializes input storage.
The owning goal records focused unit, integration, type/lint and worker evidence.

This implementation drains a requested traversal before returning the handle. Partial iteration and
deferred read-error behavior remain required acceptance, to finish with frame resource closure. Do
not count successful complete traversal as full native Dir fidelity. Resolution, borrowed/pre-opened
resources, special open flags and startup-cached references also remain unfinished. Within-frame descriptor mapping does not establish
cross-generation resource transfer or complete frame closure. Complete metadata identity/provenance
projection with the whole-build receipt; do not treat field recording as a published receipt. This is not a complete Node filesystem adapter or execution receipt. Frontend resources/generation, launch
ownership, whole-build receipts and passive freshness also remain required. Glob capture currently
owns a conservative subtree beneath its static prefix rather than duplicating esbuild's exact matcher.


The user's suggested snapshot-led hybrid is now exercised in disposable proofs, before selecting a
production design. [The evaluation](build-input-snapshot-proof.md) owns the actual matrix,
reports, alternatives and next acceptance. Real TypeScript, esbuild, executable content and Vite
Vue/CSS/glob/worker builds preserve captured source/dependency bytes after the originals change.
Two independent captures produce identical output; only private phase-cache metadata differs from
the live baseline. The fixtures preserve relative external resolution and a linked npm dependency.

The negative cases remain required implementation boundaries: absolute aliases without duplicate
reads use live type/backend bytes, and absolute `fs.readFileSync` in content code reads live data.
The existing duplicate-origin guard catches a different mixed-read case and must stay. Actual frontend
observations map to original paths, but a Vite server simply pointed at the copy watches that copy and
loses original-source updates. Do not interpret the positive build as closing these negative cases.

Continue the hybrid as the next bounded prototype, retaining compiler capture and shared input graphs.
Settle origin/read locations, complete external/namespace coverage, generated outputs and dev/compiler
lifetimes before switching production execution or freshness readers. Test immutable whole-build inputs
separately from a live authoring/HMR view owned by a compiler generation; neither silently replaces the
other's contract. No final production design or exception is established by the proof.

The read-adapter follow-up now closes the demonstrated absolute-alias and direct-file escapes in
the controlled fixture, even with its original external directory removed. It uses actual compiler
paths and retains original frontend observation paths. Its simple configuration projection, selected
Node read interception and broad fixture-parent scope remain prototype limits, not product exclusions.
The evaluation records the successful report and the native-esbuild ESM handoff diagnosis.

Source prerequisite `de5adeb66` normalizes a captured pack's root through the same origin
projection as its files. Physical reads/validation remain unchanged; discovered packages keep logical
source-root ordering. Three behavior regressions and 47 focused checks pass, along with CLI type/lint;
a mutation of the sort base is caught. This does not switch production builds to snapshots or complete
the full input contract. Strict run `2026-10-16T07-01-20Z-71395` fails one 60s
`watch-external-types` case; 752 other integration cases and all other steps pass. Session `3650`
is terminal, exit 1; `/private/tmp/apack-snapshot-root-strict.log`. Its unchanged isolated timing
case passes in 42.64s with cleanup under one second. The test is restored exactly. This does not
establish strict acceptance or the timeout cause. The four-file peer workload passes all 15 cases
at the same four-worker width in 69.55s, including the watcher in 58.244s. Its limits and assertions
are unchanged; all seven EARS/content baselines match. Source `de5adeb66` records the failed strict
gate as an open acceptance condition. All own sessions are terminal; do not repeat broad runs to seek
a pass. The next converged source/final strict gate still has to close acceptance. The goal owns the
logs, next snapshot work and complete later-phase scope.

The inherited-config follow-up now preserves relative/package/array inheritance, JSONC, absolute
config references and native transform semantics with original files removed, on Node 23 and Electron's
Node 22. Selected asynchronous Node reads and public `createRequire` resolution use owned files in
that fixture. The evaluation records the failed sync-hook approach and remaining loader/I/O boundaries;
no engine-floor change or production loader adapter is adopted.

Source `26f73956b` retains resolved configuration with `CompilationInputs` and passes it to
all four native backend bundles. Effective esbuild-supported options and inherited path targets come
from the captured config, without introducing a `baseUrl` or rereading parents between phases.
A real build/stage/load regression catches a transient inherited-config edit even after exact
restoration; eight integration and 74 unit cases, CLI types and lint pass. Standalone calls retain
configuration resolution and missing pack configs retain native ancestor discovery. Complete owned
source/dependency reads, implicit discovery, launch options, dev lifetime and input/output receipts
remain required; this does not replace that scope. Strict run `2026-10-16T08-15-59Z-20777` passes
all 30 steps (one cached), including 761 integration tests, both real authoring halves and external-pack
app checks. All seven EARS/content baselines match. This closes checkpoint acceptance carried from
the earlier root-identity timeout, without diagnosing that timeout or completing the whole goal.
The goal owns exact evidence and next implementation. Prioritize a coherent execution implementation;
use focused checks in that work and broad gates at integrated milestones/final acceptance.

Source `2e68b3ca7` connects all five native module bundles to the owned byte view, rather than
letting esbuild reread live authored/package modules. The same walker captures authored membership;
package graph callbacks supply exact hashed dependency bytes, and codegen admits completed bindings.
A real transient-edit build/stage/load and its negative mutation prove authored, external alias and
separately typed package runtime bytes are consumed from capture. The existing production worker
repeat-build check preserves cache/output identity. Focused types/lint and affected checks pass; the
goal records logs. No broad gate is repeated for this incremental step. Native resolution namespaces,
declarations, direct content reads, frontend/dev, launch options and the final receipt are still required.
That extension now starts in source `5e3530cad`: all three declaration consumers materialize the
existing byte/query view into one verified, read-only filesystem tree. Captured package links and
missing/positive bindings are preserved; compiler path projection and derived phase configuration
have separate owners. The parent owns each public worker's workspace, and cleanup precedes publication.
Focused real-filesystem checks cover abandoned read-only cleanup without following foreign links.
A typed build/stage/load succeeds with original shape/config files absent, retaining the captured
shape and removing its tree; bypassing the consumer fails. All 89 affected unit cases, the real worker's
repeat-build/workspace checks, CLI types and lint pass. The goal owns exact source evidence.

This is a declaration execution consumer, not completion of the frozen execution frame. Extend the
same tree/observations to native resolution, direct content reads and frontend resources; finish
launch/preload and dev compiler lifetime, then receipt/passive consumers. Preserve useful paths for
streamed upstream diagnostics too: mapping returned errors does not establish that acceptance.
No broad gate is repeated for this increment. Integrated and final strict checks, the remaining
contribution discovery and every later goal phase remain required.

The unfinished Node option parser patch is preserved in stash
`c42116fb46a385b5f6065a4fb9cd9e68e2625b80`. All experiment children, private captures and Vite servers
have closed. The initial proof left repository source unchanged from `74890676d`; its documentation
needed no broad validation. The separate root-identity source candidate and gate failure are recorded above. All remaining execution/publication and goal requirements stay in scope.

## Historical foundation audits and checkpoint evidence

Current progress is recorded in the [current discovery checklist](../../plans/discovery-without-activation.md#current-discovery-checklist).
The following initial surveys and dated checkpoints preserve design and validation history.

### Implemented snapshot reader (2026-10-12)

`parseSnapshot` now validates the current build format's manifest, types, definitions, provenance and
flow helpers as data. Its schema must account for every `PackSnapshot` field; it refuses unknown fields
instead of silently stripping a contribution. Validated records preserve names such as `__proto__` and
`constructor`, which Zod's parsed-object merge would otherwise lose. Build publication, CLI dependency
resolution, the test harness and the runtime loader use this validator before consuming a snapshot.
Entity-name and SDK-ownership checks now run on original manifest records before decoding; a regression
test reproduced the `__proto__` alias bypass and both schema-refusal and original-name guard mutations
are caught. Existing fixture builders now write complete snapshots; their lifecycle assertions remain.

Format selection remains separate from interpretation. Dependency resolution can reject a newer-format
candidate and select another compatible release. A CLI staging for a different installed app checks that
app's format without pretending its own schema describes the other format's grammar. Malformed metadata
in the current format is a refusal, not permission to fetch a replacement or execute runtime code.

`readPackBuild` now combines installed snapshot/manifest validation with full `integrity.json`
verification. The runtime loader uses it before requiring any pack code; previously it checked only the
layout version and never checked file checksums. The returned SHA-256 build revision covers the sorted
file inventory and layout version, so installation paths and checksum-map enumeration order do not change
identity, while different bytes with identical declarations do. Active origins retain the accepted revision.
Captured snapshot/manifest bytes must match the verified inventory, refusing an old declaration read
paired with a replacement build's checksums. Manifest identity is checked from the bytes hashed by the
verifier, rather than a later reread. A concurrent-replacement regression proves this agreement guard.
Malformed checksum paths/values, missing/extra files and symbolic links are refused; own `__proto__` file
names are preserved. The installed catalog fixture reads this same boundary with poisoned executable code.
The shared verifier also checks integrity id/version against the manifest before installer teardown or
placement. Shipped-copy comparison verifies the installed receipt and bytes before reporting `current`;
missing, malformed or mismatched integrity and extra links trigger replacement from the shipped build.

This verifies the installed tree at the read boundary, not a signature, an immutable filesystem view or
complete source/dependency freshness. Build output now carries a producer-owned file inventory before staging; production catalog publication, binding membership and accepted frontend asset delivery
must use retained identities rather than rehashing whichever bytes are on disk later. Those remain required.

### Implemented producer-owned output receipts

`apack pack build` writes the canonical manifest and the existing layout `integrity.json` into its
staged output after all gates and the snapshot, before publishing `dist`. Its receipt covers every
output file, including source maps and DSL definitions. Reuse verifies the previous output first;
a damaged tree is rebuilt, preventing cached edited files from receiving renewed checksums.

Source staging and shipped comparisons verify that receipt, the snapshot and the source manifest.
The installation variant retains the existing runtime/build/types file scope and omits source maps.
It copies recorded files into a sibling candidate and verifies them against the producer's expected
checksums before replacing the accepted stage. A copy race cannot manufacture fresh checksums for
changed bytes. Foreign snapshot formats remain opaque; layout verification still checks their bytes.

Checks cover missing receipts, changed runtime/snapshot/source maps, copy-time mutation retaining the
old stage and cleaning candidates, and a real build/rebuild whose damaged reusable facade is regenerated.
This does not yet freeze authored inputs or dependency/tool resolution. DSL output staging is implemented below. Installed-copy verification is implemented below; frontend delivery still needs accepted identities.

### Implemented staged DSL generation and frontend resolution

DSL declaration bundling now takes the build output directory and writes directly into its `defs/`.
Reused definitions are copied into the same staged tree. The library frontend bundle redirects the
existing generated `dist/defs/... ?raw` imports to this build's definitions, and its cache key hashes
that exact directory. Standalone frontend bundling and the development server continue to read the
published output. Missing staged files fail rather than falling back to the accepted build.

A real cold build, changed-definition build with a later runtime failure, recovery and unchanged
rebuild verify that the accepted build/receipt, read record and cache survive failure; recovered
frontend and declarations agree; and both definition and frontend phases reuse unchanged output.
A separate missing-staged-definition check proves the older published copy cannot mask absence.
Frozen authored/dependency/tool inputs, frontend delivery identities, production catalog publication
and contribution binding membership remain required; installed-copy verification follows below.

### Implemented verified installation candidates

Installation copies the complete accepted layout into a private candidate on the destination filesystem.
It verifies candidate bytes and exact receipt equality, including provenance metadata, before checking
the copied descriptor's schema, host compatibility and snapshot. A source changed after the initial
manifest hint cannot silently change pack ownership or evade compatibility checks. Only then does the
teardown hook run, with its own descriptor copy, followed by directory replacement.

Checks cover changed/unsealed bytes, a different valid receipt, changed provenance, source edits during
teardown, raced ownership/compatibility, hook metadata edits and refusal cleanup. Failures in copy or
validation leave the installed build and skip teardown. Hook refusals retain files and clean the
candidate; directory replacement's existing rollback remains. None of these guards rolls back arbitrary
hook/activation effects or proves transactional catalog publication.

### Accepted frontend asset delivery checkpoint

The installed loader retains the verified build revision and immutable file membership/checksums.
`getLoadedPackEntries` and client-readiness classification project those accepted files without rehashing
current disk bytes. Verified installed catalog entries retain the same receipt and derived revision,
including disabled entries and the previous accepted entry when a replacement is refused.

Installed frontends use `pack://<id>/builds/<revision>/<file>`. The identity belongs to the URL base,
so relative chunks, styles and font/image requests retain it. Main reads the receipt, compares its identity
and verifies the exact returned bytes against the listed checksum. Unlisted, missing or changed files,
replacement receipts and symlinks fail. No installed request falls back to shipped output or development.
Stylesheet failures reject before frontend registration/settings binding rather than report success.
Concurrent callers share the actual pending outcome, and unload settles pending loads; finding a link
in the document is not proof that its bytes have loaded.

Source/HMR is an explicit separate route: a development API advertises its live local Vite base URL,
and the renderer loads that graph directly. Monorepo source modules still use the renderer's Vite graph.
A failed source import has no disk fallback. The external fixture uses an async canvas to exercise actual
relative chunk delivery with the same build base as its styles.

Keep the asset reader below descriptor/compiler imports. Importing the broad host packs barrel into
Electron main pulled SDK schema code into that bundle, whose external AJV import resolved the root's
different dependency version and prevented startup. `packs/assets` now depends only on Node builtins
and the shared data/path definitions in `layout-paths`; main imports that entry directly. No vendor import
or validation is weakened to accommodate the wrong dependency. The general bundled-dependency owner
resolution issue belongs in the remaining consumed-API/tool provenance audit.

Chromium did not expose these custom-protocol requests through Resource Timing. The app regression
uses an owned CDP network session with caching disabled during its checks and restores that setting
before detaching. It verifies actual chunk/style request bases while the async canvas renders.

This closes installed byte delivery, not the complete discovery contract. Source/dependency catalog
projections currently lack an installed receipt; they must not manufacture one from their current files.
Their complete descriptor/provenance/freshness admission still needs migration. Runtime-loaded entries
remain execution state; static frontend declarations and window activation/retry coordination must still
move to the common descriptor/catalog before the shell becomes a discovery consumer.

This is the reader foundation, not a completed descriptor/catalog: settings data, contribution metadata,
asset/binding identities and coherent catalog refresh are still required. Installed discovery and offline schema admission now share the reader in `e50838e14`, described below.
Source/dependency freshness and the remaining contribution descriptors are still open.

Validation: 118 focused snapshot/manifest/format checks and six doc-link checks passed. The final strict
chain passed with `npm run chain -- --strict --cores 1` (152.3s, 23 cached), including external-pack and
packaged-authoring app scenarios; evidence `node_modules/.cache/apack-chain/runs/2026-10-12T12-51-44Z-96251`.
An earlier integration run failed a process-cleanup assertion immediately after parent termination;
its four isolated checks and the final chain passed without changing the assertion.

### Implemented declaration/runtime agreement (2026-10-12)

The snapshot and generated BE/FE registrations now carry `declarationRevision`, a SHA-256 identity of
the manifest's JSON serialization. Publication checks the generated entry literals without importing
pack code, including builds using `--skip-generate`. The loader checks the installed manifest against
the snapshot, then checks runtime ownership and revision before passing the compiled directory or
registering contributions. The frontend checks the backend-retained identity before registration and
stylesheet installation. Retaining it in the active origin avoids reading a newly replaced snapshot as
though an older running backend had already accepted it. `feRevision` remains a separate byte-cache key.

These guards exposed an existing reload defect: require-cache cleanup used the requested directory,
while Node caches the resolved path. Cleanup now covers both paths and a symlink regression verifies
that sibling packs remain cached.

This identity currently covers manifest data only. It is not yet a complete build revision: compiled
settings definitions, static contribution metadata, asset hashes, resolved dependency identities and
binding membership still need to join the descriptor contract. Generated-entry inspection checks the
generated modules, not arbitrary custom frontend entry implementations. Runtime checks refuse such
an entry when it exports a different identity; build-time checking of every supported binding remains
part of the descriptor checkpoint. No settings/discovery reader has switched to a catalog yet.

Staging now validates current-format snapshot data and its agreement with the source manifest before
touching the destination. Installation performs the same agreement check for pre-staged layouts, even
when the target app's format is unknown; current-format corruption is distinct from a foreign-format
refusal. Failed validation leaves the accepted installation and teardown untouched and removes temporary
staging. Foreign formats stay opaque and retain explicit target-format checks.

This closes the edited-manifest/retained-build gap for readable declarations. Complete source-input
freshness, static assets and binding membership are still required; manifest agreement alone does not
prove those inputs are current. Do not treat activation refusal as pre-publication rollback.

Staging validation: 364 host pack checks, 27 release checks and six doc checks passed; staging,
unknown-format refusal and temporary-cleanup guard mutations were caught. Release stand-ins now rebuild
snapshot identities and ignore generated output as real pack repositories do; release implementation
and metadata are unchanged. The strict chain passed (180.9s, 16 cached); evidence
`node_modules/.cache/apack-chain/runs/2026-10-12T14-28-19Z-88313`.

Declaration identity validation: 87 focused declaration/codegen/frontend/build checks, 150 runtime lifecycle checks and six
doc-link checks passed. Removing the snapshot identity, binding identity, generated-entry comparison or
resolved-path cache cleanup was caught by its regression tests; each mutation was restored. SDK API
reports were regenerated and reviewed. The stable strict chain passed with
`npm run chain -- --strict --cores 1` (259.9s, nine cached), including real external-pack and packaged
authoring checks; evidence `node_modules/.cache/apack-chain/runs/2026-10-12T13-39-03Z-69678`.
The first broad run correctly refused published-package freshness after a source edit during that run;
the successful rerun held source inputs unchanged.

### Implemented authored-file scopes and publication stability

Codegen and reusable bundle phases share `@apackdev/host/build/pack-inputs`. Module sources are tracked throughout
the pack, rather than only under `src/`; codegen also hashes captured manifest data, declared help and
the SDK source tree. Bundle scopes include generated entries and all asset extensions, including files
outside `src/`. Root build/dependency working trees are excluded; an authored nested `src/dist` is not.
Filename/content boundaries make identities unambiguous and independent of checkout location or mtimes.
Source symlinks are tracked; directory cycles refuse rather than recurse indefinitely.

The build captures authored inputs before reading its manifest and checks them before publication.
A real settings module that adds an authored file during compilation causes refusal, preserving the
previous build and removing staging. This is a stability guard, not an immutable source snapshot:
complete external-input/dependency identities and a frozen/coherent build view remain required before
claiming full build-input freshness. The existing diagnostic reads record remains distinct from cache keys.

Validation: 42 focused checks passed, including outside-`src` exports, asset/config/lockfile invalidation,
generated-output exclusions, relocatable identities, symlinks and real-build refusal/rollback. Three
mutations removing module coverage, asset coverage or the publication guard were caught and restored.
The strict chain passed (282.0s, one cached); evidence
`node_modules/.cache/apack-chain/runs/2026-10-12T14-44-50Z-20334`.

### Implemented catalog prototype

`createContributionCatalog` retains validated snapshot data and host-owned enablement independently
of executable registrations. Host app definitions are supplied explicitly and survive an empty pack
list. `packSettings(packId)` projects inline `extensions.settings` declarations directly from each
snapshot, including disabled packs. Duplicate pack IDs refuse the whole candidate and identify both
directories; group IDs are local to their owner. Immutable copies/readonly views protect the accepted
catalog from input and reader mutation. Failed candidates preserve its revision and lookup map.

The installed poison-runtime fixture proves this projection performs data reads without executing pack
code or changing builds. Semantic-definition, atomic-publication and owned-copy guard mutations are
caught. This prototype is not wired into production boot or existing discovery/settings readers yet.
Feature schemas, static metadata/assets for the remaining kinds, complete build-input freshness, checked form/runtime
bindings, full build revisions and trusted caller binding remain on the completion inventory.

### Initial descriptor gaps (historical)

This starting inventory predates the settings, reference, editor and step migrations. Its remaining-work
column is superseded for status by the [current discovery checklist](../../plans/discovery-without-activation.md#current-discovery-checklist);
retain it as the original coverage inventory, not a list of unimplemented consumers today.

The manifest already names many contributions and implementation references. Codegen produces backend
and frontend registrations, contracts and snapshots; content is compiled; pack staging records integrity.
Reuse this machinery.

Discovery today reads `apack.json` without loading runtime code, but validates only a few identity fields
before casting it to `PackManifest`. Other consumers learn metadata through registered implementations.
`PackRegistration` and `PackFERegistration` are executable binding objects, not complete data descriptors.
The snapshot has a manifest, type declarations and partial contribution provenance, but does not expose
all metadata needed by the shell and tooling.

The completion inventory must cover every field in both registration types and every manifest extension
point. For each field, record identity, ownership, static metadata, data assets, executable binding and
current readers. Nested contribution lists matter as much as top-level keys.

| Surface | Existing declaration | Remaining discovery work |
|---|---|---|
| Pack identity/dependencies | IDs, versions, host range and dependencies | Validate descriptors; retain resolved identities, origin and unavailable reasons |
| Features/surfaces | Feature refs, designations, entry paths and default claims | Declare labels, icon references, pinning, pane/route presence, fallback-panel metadata and static shortcut descriptors |
| Settings | Inline pack/feature schemas, defaults and form references; host app definition | Catalog-based extraction landed in `f3416ad2f`; retain its policy, restore and window checks while completing the other kinds |
| Steps/triggers | Type names, facet paths, runtime flags and DSL metadata | Materialize palette labels/categories, initial node values, static connection metadata and facet availability |
| Blocks/artifacts | Type names, facet paths and artifact icon names | Audit remaining labels/metadata; expose descriptors without importing viewers or backend facets |
| References | A feature names an executable reference module | Declare type/category identities, labels, icons and provider/navigation bindings currently exported from that module |
| Editor contributions | Keyed Tiptap groups/members and app-extension slots (`e40d157f9`); DSL declarations | Complete intrinsic schema ownership, live editor composition and static DSL asset reads without activation |
| Help/content/datasets | Help source path, formats, sources/datasets and writer paths | Publish readable help and compiled-content indexes/assets; separate declared content from rows an applier creates |
| Services/repositories/events | Provided names, contract source paths and generated type declarations | Publish callable API/event contracts and required dependencies as data/type declarations; no service construction for inspection |
| Hooks/migrations | Explicit hook exports and keyed migration descriptions/up references | Data and binding checks landed in `3ec4f0a77`; installed details consume them in `6c876c9ba`. Complete native coverage with the remaining kinds |

This table is the starting audit, not a second author-maintained manifest. Before implementation, expand
it against the current types and codegen, including frontend-only contributions and the dependency tree.
Every supported field must either have a discovery representation or be explicitly an executable binding.

### Registration coverage audit (2026-10-12, master d7e77829a)

Read the current SDK registration interfaces, manifest schema, codegen and host stores before extending
builds. The following is implementation audit evidence, not another author-maintained declaration.
Each grouped row accounts for its named fields; new fields must extend the eventual coverage guard.

| Current fields | Data / executable boundary and ownership |
|---|---|
| `PackRegistration.id`, `name`; FE `id` | Pack identity from the manifest; host origin/update choices are separate |
| BE/FE `features` keys | Pack-local IDs resolved to feature refs; one normalized account for both processes |
| BE/FE feature `designation` | Declared role and owner; cross-pack role conflict checked before binding |
| BE feature `system.machine`, `system.receives` | Machine executable; generated incoming-event names/contracts become descriptor data |
| BE feature `surface.receives` | Generated outgoing/inbox event contract data, not a component import |
| BE feature `services`; BE `services`, `repositories` | Declared API names/contracts plus checked executable object bindings; service and repository names retain their actual collision rules |
| BE feature `settings`; BE `settingsSections` | Replace executable Zod/thunk declarations with the settings plan's schema/default/form data; remove registration-derived defaults |
| BE `ears.entities`, `ears.relKinds`; manifest feature/data `entities` | M1 (`2fff8bb76`) derives identity/ownership/shape through `_packEntities`, with flat compiled EARS names and type-only build references. Remaining entity descriptors must reuse this projection; M2 (`3ff590240`) uses `_packRelationTypes` for `data.relations` and derives flat EARS maps. Preserve SDK/host reserved names and typed EARS behavior. |
| BE `lifecycle.onInit`, `lifecycle.onShutdown` | M3 (`e063ec1a5`) records explicit targets in installed/native declarations and checks runtime bindings without invocation. Metadata survives unload; side effects remain runtime. |
| BE `migrations.app`, `migrations.pack` | Version line, target and description data; `up` remains executable; never infer line from shipping provenance |
| BE/FE `steps` | Identity and available facets from keyed declarations; intentional multi-owner facet composition, not last-wins flattening |
| Step `type`, `kind`, `dsl` | Static identity/kind/DSL metadata, already largely declared |
| Step `node.label`, `defaultLabel`, `defaults` | Materialize initial values/static presentation; classify any per-node label function as execution |
| Step `build` | Compile/validate/decompile/branches callbacks execute; relation metadata is discoverable |
| Step `runtime` | Handler executes; async/subflow/waits flags are data |
| Step `fe.nodeConfig`, `colorKey`, `layout`, `handlePrefix` | Materialize static palette/connection metadata; per-node layout calculations remain execution |
| Step `fe.components`, `loadComponents` | Component availability/binding in data; no discovery-time component loader call |
| Step `trigger` | Track field/persistence/query fields and callback presence in data; compile/decompile/register/validation callbacks execute |
| BE/FE `artifacts`; artifact `type`, `fe.icon`, `fe.component` | Manifest icon identifier and viewer presence become data; icon/viewer objects bind on activation |
| BE/FE `blocks`; block `type`, `kind`, `fe.component`, `be.generateAsideText` | Identity/kind/facet availability in data; component and transcript callback execute |
| BE `contentWriters`, `appliers` | Owned entity/content-key identities and hook availability in data; callbacks execute, with existing cleanup |
| BE `commands` | Key/placeholder data; keep user-content commands and their live notifications separate |
| BE `help` | Materialize article identity/title/body/order/feature filters into readable data assets, not just source directory paths |
| FE feature `default` | Static claim; deterministic catalog selection independent of import completion |
| FE surface `id`, `label`, `isPinned`, `icon`, `hotkeys`, `options.headerClass` | Feature ref, presentation and shortcut descriptors become data; icon objects resolve only when rendering |
| FE surface `state`, `canvas`, `panel`, `chat`, `settings` | Actor/component/route presence and stable references in data; concrete implementations execute. Form ownership follows the settings plan |
| FE surface `fallbackPanel.label`, `toggle`, `isShown` | Label/event contract discoverable; state predicate executes and is not a discovery eligibility check |
| FE `appExtensions` | Named slot/component references, retaining actual slot composition/ownership policy |
| FE `textEditor.extensions`, `popups`, `isSuggestionActive` | Give anonymous contributions stable declared identities; availability in data, extension/component/predicate objects executable |
| FE `dslTypes.prefix`, `schema`, `globals`, `language` | Static editor declarations/assets; read without executing generated frontend imports |
| Feature `references`; reference `category`, `icon`, `svgElements`, `navigate` | Type/category/static icon data discoverable; navigation binding remains until entity-opening callers migrate |
| Reference categories `id`, `label`, `primaryIcon`; provider `category`, `useItems` | Category/provider identity and icon data discoverable; live reactive items require that provider's execution and disposal |
| Content sources/datasets/formats and compiled `content.json` | Declared keys, formats, entity targets and compiled indexes/assets; rows written by appliers are not discovery results |
| Manifest `features.<id>.types`, surface/system contracts and snapshot `defs`, `types`, `flowHelpers`, `provenance` | Build inputs materialize type/event/facade assets and true dependency ownership; source paths alone are insufficient installed discovery |
| Manifest `build`, `$schema`, `$manifestVersion`, license/description/version/dependencies/host range | Build options are authoring inputs; compatibility/identity metadata is data; descriptive permissions do not establish grants |

Current consumers confirmed: backend registration/defaults stores, frontend registration/default selection,
reference aggregate/provider initialization, CLI validate/build, and installed-layout/offline readers.
At this audit, codegen validation returned no issues when dependency resolution threw. The first
foundation checkpoint fixes this with structured incomplete results and read-only dependency resolution.
`PackSnapshot` still holds manifest/types/facade/provenance but not all hidden metadata above. Extend it;
do not add a second descriptor file authored independently.

The eleven default-setup feature settings modules use Zod objects with explicit defaults, strict objects,
arrays, optional fields, records, enums, nullable values and numeric constraints. The audited modules and
shared hotkey schema contain no refine/transform/preprocess hooks. Prove equivalent validation/defaults
for these concrete shapes before removing the executable declarations; do not generalize that observation
to unrelated Zod APIs or uninspected pack fixtures.

### Help publication and browser routing evidence (2026-10-13)

Help articles now materialize in the snapshot, and source declarations explicitly supply parsed data.
Executable registration no longer contains help. Markdown is not an executable-generation input;
the complete build compiles it and checks the authored input identity before publication. The backend
watcher uses that staged build for help edits rather than rebuilding an executable entry containing
articles. Real build coverage verifies changed articles, sealed build admission and preservation of
the accepted snapshot after an invalid Markdown edit.

The inactive-pack app check exposed a separate editor defect. ProseMirror's `handleClick` covers single
clicks; its repeated-click classification can bypass that callback. Viewer links now use DOM click
handling, preserving custom in-app article routing on repeated clicks. The Electron OS-opening boundary
also refuses `help.apack.invalid`. The app check captures `shell.openExternal` and proves no external
browser opening while articles remain navigable with the pack disabled.

Focused publication checks pass (8), shell boundary checks pass (16), and the app reproduction passes
both help and backup restoration. The grep-filtered multi-fixture command then exits nonzero because
its second fixture has no matching tests; that is not a complete multi-fixture pass. The complete strict
chain passes sequentially (135.0s, 25 cached), including the whole external app suite and smoke:
`node_modules/.cache/apack-chain/runs/2026-10-13T05-09-32Z-28459`.

Concurrent runs remain a concrete unresolved issue: backup export can fail to deliver its result within
the existing deadline, and Electron worker teardown can stall although smoke assertions pass. Evidence:
`2026-10-13T04-49-16Z-44777`, `2026-10-13T05-00-07Z-49745`, and
`2026-10-13T05-05-08Z-87164` under the same chain runs directory. The first run's retry exposed the
repeated-click failure; subsequent runs with that fix pass help navigation but still exhibit the backup
and teardown stalls. No deadline or assertion was relaxed. Sequential success does not resolve those
failures or complete the full discovery/lifecycle audit.

Native all-kind declarations, other hidden contribution metadata, full source/dependency freshness,
frontend bindings and remaining consumer migration are still required by this plan.

### Native declaration lifetime checkpoint

Remove `refreshNative`: activation must not manufacture declarations or withdraw them on unload.
Host composition admits its data before binding native systems. Bare native registration requires an
already admitted owner; it checks feature identities, dependencies and current settings definitions.
Installed/source admission remains through its existing verified paths. Native declarations are removed
only by an explicit catalog operation, so failed activation and runtime unload preserve discoverable data.

Migrate test stand-ins through a test-only fixture composer that admits the fixture's authored data
before binding and explicitly removes its fixture definition on removal. It must not become a production
registration fallback. Add direct registry checks proving declaration-before-activation, unload/failure
preservation and refusal of missing or mismatched native declarations. Use the existing common catalog.
This lifetime checkpoint retains the current native settings/identity projection; all-kind native metadata,
complete bindings, assets and reader migration remain required before claiming full native discovery.

Native data admission also validates the original candidate shape through the shared settings schemas;
null records, malformed feature definitions and unknown fields cannot become an empty declaration.
The catalog owns immutable copies. Runtime matching defaults only absent fields, never explicit nulls.
Use `nativePackDeclarationFixture` for authored test data and `createNativePackTestRegistry` from the
host's testing entry for fixture admission/binding/removal. Production composition supplies
`nativeDeclarations` explicitly; it never invokes either test composer to discover its own runtime.

The build compiler is another distinct consumer: `PackConfig.loadDefinitions` already merges and checks
the build-only facets. Pass those definitions directly through `compilePack`'s existing contract; do not
register an executable pack in an otherwise unused host registry merely to retrieve them again.
`CompilePackOptions.importModule` is the common execution boundary for custom content compilers,
flow modules and dependency/generated step definitions. Forward it through `loadDefinitions` and
specialty compilation; no definition loader may silently bypass the build owner's namespace.
`f9015a07f` wires these consumers to the owned input tree. `14aa9fa38` adds a scoped synchronous
Node resolver hook for transitive ESM/CommonJS requests, including absolute URLs and computed
imports. Preserve native resolution and tsx transformation; do not add a competing module loader.
An async loader-thread bridge to the main build owner deadlocks synchronous resolution and is rejected.
The synchronous hook requires Node 22.15+ or 23.5+; the CLI/checkout engines state this explicitly.
`ed72a0388` maps source-parent createRequire into the AsyncLocalStorage-selected input tree and proves
two independent concurrent captures plus native out-of-scope calls. Borrowed functions across disposed
generations, runtime metadata/diagnostic origin projection, broader entry variants, startup loader
options and full execution/receipt acceptance remain required below.

`a0c050a16` moves public publication behind compiler termination: the parent owns the pack lock,
workers report a sealed candidate and exit, and the parent verifies that exact revision plus the
authored input hash after process closure. Exit-handler output changes refuse without replacing the
incumbent. Parent lock waits are abortable. Reuse the shared output verifier and atomic replacement;
do not reseal a changed candidate in the parent. The candidate IPC handoff is not the complete input
receipt and must not become passive source-freshness authority. Watcher acceptance ordering, source
module metadata/diagnostics and deterministic output, external/late input observations, descendant
processes and frontend lifetimes remain required alongside the rest of this plan.

`f67c8d066` separates ESM source metadata from read locations. Native scoped resolution selects owned
inputs; a byte-only loader below tsx preserves logical URLs, filenames and source maps. Entrypoints
must use that checked resolver too, rather than tsx's protocol shortcut. Configuration matching uses
logical source patterns parsed from captured config files, with owned alias targets. Bundled workers
must not add a second unscoped ESM transformer. CommonJS cache isolation still requires its owned
filenames, so CommonJS metadata/configuration projection remains unfinished. Preserve that explicit
acceptance item, repeat determinism, complete launch/input ownership and all later work above.

### Review correction: runtime rollback must preserve incumbent resources (2026-10-13)

`reload.ts` currently unregisters the old registration before trying the new one, then re-registers
it on refusal. That is not a resource rollback. `unregisterPack` consumes the incumbent undo log;
`_createPackServices` revokes its captured settings handles and creates a new binding lifetime.
Re-registering the same runtime object cannot revive the handles its module or actor already captured.
A real registry/generated-binding probe confirms this; the old rollback fixture has no settings binding.

The next checkpoint must settle and implement replacement as one admission transaction. Keep the
incumbent's accepted contributions, origin and binding resources until the candidate can commit.
Failed candidate admission releases its own provisional resources and leaves incumbent handles and
actors usable. Successful replacement retires incumbent resources exactly once; ordinary unload still
revokes every captured handle. Do not introduce a disposal exception, a reusable stale handle, or a
retain-binding flag threaded through unrelated teardown callers.

Pure declaration/collision preflight is useful but insufficient: contribution installation or settings
binding can still throw after it. Audit owned stores and global repository registration so releasing an
old resource cannot remove its replacement. Readers must observe accepted state, not an intermediate
unregistered pack. Reuse existing admission/ownership mechanisms and distinguish their resource
transaction from arbitrary pack initialization, migration or applier effects, which cannot be promised
rolled back. Installed build/catalog publication and runtime activation remain distinct transitions.

Required regressions use actual generated settings handles: a refused replacement retains the same
incumbent handle and settings subscription; a late binding/contribution failure leaves prior definitions
and origin intact; a successful replacement revokes old handles and exposes new ones; cleanup errors
are reported without skipping owned-resource retirement. Add an actual reload fixture with a bound
handle; registration-map equality alone is not its acceptance criterion.

#### Selected registry transaction

The current backend undo log combines pure indexed contributions with one executable lifetime:
`bindSettings`. Rebuilding the former does not require re-executing the latter. Replace that mixed
mechanism with admitted contribution data and separately owned binding cleanup. Capture contributed
collections once at admission so later mutation of the author's registration cannot change removal.
Build candidate designation/definition/writer/applier/command tables privately, preserving command order.
Existing live readers continue to see accepted tables while candidate binding runs.

Repository entries are an engine-owned lookup mirror, not disposal callbacks. Publish changed entries
through the captured engine only after candidate preparation succeeds; restore its prior entries if
publication fails. No incumbent binding cleanup runs before successful publication. Commit registry
maps/tables once, then retire the incumbent binding exactly once. Cleanup failures after commit are
explicit replacement diagnostics, not a refused candidate or a reason to restore a disposed runtime.
Ordinary unregister still removes accepted data and retires its binding even if cleanup reports failure.

Expose this as one host registry `replacePack` operation and route reload through it. Initial registration
uses the same admission path. Do not expose transaction flags to packs or teach callers to unregister
and repair the registry. Preserve boot-hook/actor restart ordering and keep user-data side effects out
of the registry transaction guarantee.

The implemented host binding gate remains pending during preparation and becomes active only after
publication. The host revokes its port and subscriptions even when a hook captures the port and throws
before returning cleanup, or returns cleanup that omits generated disposal. This is a supported API
lifetime guarantee, not confinement of arbitrary in-process JavaScript. Reconnection/unload does not
revive captured handles. A post-commit cleanup error remains a retirement diagnostic.

### Hook and migration declaration checkpoint design (2026-10-13)

Current code imports a whole `boot.hooks` module without checking its exports and reads migration
object descriptions only after executing the module. Replace both contracts outright. `boot.onInit`
and `boot.onShutdown` each name a checked `path#export` function; presence is known from manifest keys.
Each migration version entry contains inline `description` and an `up` function export target. Version
line/target and description are authored only in data; modules export behavior only. Codegen validates
named callable exports without executing them and emits explicit fields. Runtime admission checks
exact declared hook presence and migration descriptions, not just their types. Migrate scaffolding,
fixtures, public schema/API reports and docs; accept no old key or migration-object fallback. Ordinary
versioned data changes remain supported and separate from obsolete-format conversion.

Hook/migration authoring and checked bindings landed in `3ec4f0a77`. Poisoned-module codegen checks,
real CLI scaffolding/typechecking and runtime mismatch refusals verify the data/execution split. The
final strict chain passed at `2026-10-13T11-47-39Z-39675`. Installed snapshots already carry these facts
through their manifest; static consumer/native completeness still requires migration. This checkpoint
is not a complete discovery implementation or a promise to roll back migration effects.


### Shared installed admission checkpoint (2026-10-13)

`e50838e14` makes installed discovery, catalog refresh, boot, activation/reload and offline database
schemas use one data-only build admission path. It validates the snapshot and receipt, checks the
directory's owner and requires a receipt-owned backend entry. Producer/staging readers remain distinct:
a `dist/` build directory is not a managed `packs/<id>/` installation.

Directory presence remains installation evidence when admission fails. Boot now prunes user records
only for removed directories, preserving disabled choices and update provenance through malformed
manifests and later repair. Refused builds under valid pack IDs remain removable without trusting their metadata.
Offline enabled schema sources fail explicitly; `--schema-from` validates complete current snapshots
and declaration identities without loading executable modules. The permissive EARS fragment reader
and unused enabled-pack projection are removed. Data fixtures now use complete sealed builds.

Focused checks and guard mutations cover record preservation, directory-owner refusal before execution,
invalid offline schemas, incomplete/stale named snapshots and invalid-installation removal. Native
all-kind metadata, static shell/reference/editor discovery, complete source/dependency freshness and
atomic installation/runtime publication remain separate required work.


### Frontend declaration membership checkpoint (2026-10-13)

`c67329374` forwards an owned copy of active backend declarations with installed frontend delivery.
Missing declaration data refuses before import. After import, the declaration stamp is necessary but
not sufficient: feature IDs, designation/default claims, custom forms, step types/kinds/facet presence,
artifact/block types/viewers, app-extension slots and DSL names/prefix/globals must agree before styles,
settings grants or component factories are used. Shared name/key checks serve backend and frontend
admission without importing Node modules into the renderer. Unsupported top-level/feature fields refuse.

Codegen now gives an omitted DSL prefix the empty prefix and quotes prefix/global strings as JSON data;
the frontend check uses the same default. This fixes valid omitted/quoted declarations rather than
accepting the producer's literal "undefined" as metadata.

This does not complete frontend discovery. Surface presentation/route/shortcut metadata and stable
anonymous editor contribution identities still require declarations; native frontend admission still
needs the complete native model. Icon identity and DSL asset bytes are not established by member-name
checks. The renderer still has to move static readers off runtime registrations.

Frontend replacement still needs an explicit transaction. Correction from the subsequent source audit:
`registerPackFE()` currently refuses duplicate owners; it does not implement replacement. The shell's
`PACK_SURFACES_UNLOADED` path retires existing frontends before reloading them. Stylesheet ownership is
now staged as described below, but settings/contribution replacement and shell handoff remain open.
Stage resources, publish once, and retire old resources after acceptance; prove failure/cancellation
keeps the incumbent usable. Arbitrary module side effects remain outside rollback.


### Owned stylesheet preparation checkpoint (2026-10-13)

`de0d55480` replaces pack-wide failure cleanup with per-attempt stylesheet leases. Preparation fetches
an inert `media="not all"` link; readiness is awaited, and styles are applied only after frontend
acceptance. Same-href leases share one physical request but own cancellation independently. Disposing
an old owner cannot remove a newer owner using that link. Candidate failure retains accepted CSS;
explicit pack unload disposes accepted and pending leases. Styles-only retries transfer ownership
without duplicating links. An abort during a fresh binding also unregisters that candidate before commit.

The real-app strict gate proves Chromium loads the inert stylesheet and accepted surface styles apply.
DOM and host seam checks prove failure/cancellation/ownership behavior. This closes stylesheet staging,
not the shell's unload-before-reload behavior or a transactional frontend registry replacement API.
Vite/source-module side effects remain outside installed stylesheet rollback.


### Prepared frontend publication checkpoint (2026-10-13)

`5d1c4653d` replaces the frontend contribution undo log with captured candidate tables and explicit
prepared register, replace and remove operations. A host-owned settings gate keeps candidates pending
and revokes retained ports/subscriptions on refusal or retirement, even when generated cleanup fails.
Collision checks and component loaders run before publication. Accepted membership is captured once;
rebuilding or removal does not rerun authored getters/loaders. Stale or disposed preparations refuse.
Cleanup errors after accepted publication are diagnostics rather than false replacement failures.

The loader joins prepared CSS to the registry commit before observers see new forms. Failed replacements
preserve old lookup data, styles and authority. A replacement with no frontend removes the previous
frontend without a placeholder registration. This is a local registry/loader guarantee: the shell's
reconnect path still unloads first, and frontend actor handoff is not yet implemented.

Evidence: 335 focused host checks pass. Mutations that retire the incumbent early, grant pending writes,
or publish tables before binding each fail the intended regression; sources were restored before
validation. Final strict sequential chain passed in 358.6s (one of 30 gates cached), including actual
external-pack app and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T14-50-35Z-99576`;
`/private/tmp/apack-fe-transaction-strict-chain-final.log`.

Next audit and implement shell handoff, preserving accepted actors through refused replacements and
removing genuinely absent owners after an authoritative read. Native/all-kind metadata, source/dependency
freshness, navigation, frontend boundaries and all three Phase 6 streams remain required. No plans are
archived; full requirement review and final strict `--all` acceptance remain outstanding.


### Reconnect handoff and generated binding lifecycle (2026-10-13)

`854eea117` separates connection loss from pack removal. The shell cancels an interrupted loader,
retains accepted actors/definitions/resources, and refreshes them after reconnect. Failed list reads
and refused candidates preserve incumbents. A successful authoritative list removes absent owners.
Accepted replacements stop the previous owner's actors, publish new definitions without duplicate IDs,
retain tab order/visibility/selection where possible, and announce readiness afterward. A replacement
that removes its frontend also removes its old actors. This supersedes the earlier unload-first
reconnection behavior and its tests; explicit disable/uninstall still remove their frontends.

Review found a real gap behind the passing shell mocks: the SDK's generated settings binder refused
replacement when an unchanged build reused its cached module. The real SDK/registry probe reproduced
`Frontend settings are already bound`. The frontend hook now returns explicit `activate`/`dispose`
operations. Preparation leaves the module's accepted accessor unchanged; host commit activates the
candidate before other host resource publication. Failed publication restores a still-active incumbent.
Retirement cannot revive old handles or clear the new accessor, and it releases the rollback reference.
The generated entry and public API report use this contract outright, without an old-hook alias.

Evidence: 345 focused host checks, 16 SDK settings checks and nine generated-compilation checks pass.
The real shell/loader/registry/generated binder test reuses the same registration and import URL across
reconnect, preserves the actor until acceptance, and proves new authority plus old-handle revocation.
Six mutations covering premature unload, missing-owner reconciliation, actor retirement, early accessor
publication, missing accessor rollback and retired-accessor cleanup fail their intended regressions.
Sources were restored. The first combined strict run found the missed cleanup-function call inside a
generated-code fixture; it was corrected to exercise activation/disposal, without weakening assertions.
Final strict sequential validation passes in 303.7s (15 of 30 cached), including integration, actual
external-pack app, smoke and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T15-20-17Z-72081`;
`/private/tmp/apack-frontend-handoff-protocol-strict-chain-complete.log`.

This closes reconnect handoff, not the entire replacement workstream. Backend `RELOAD_PACK` currently
restarts systems and publishes `PACK_CHANGED`, but does not request a frontend refresh while the
connection stays live. Normal activation reads still skip accepted IDs. Add accepted-revision-aware
refresh notification together with coherent build/runtime publication; do not route replacement
through `PACK_DEACTIVATED`. Installed update/install still have pre-teardown paths. Arbitrary actor/module
side effects and pane failures remain the separate boundary work, not rollback guarantees here.
Native/all-kind declarations, remaining static readers, complete freshness, navigation and all three
Phase 6 streams remain required before final `--all` acceptance and archival.


### Accepted runtime identity and grant freshness (2026-10-13)

`244dd5380` gives captured backend registrations a host-issued registration ID. `getPackRuntime`
projects that revision with installed provenance; `packs.loaded` carries it with declaration and build
identities. It changes on acceptance, including identical-byte reloads, remains unchanged after refused
binding, and disappears on removal. Native registrations without installed provenance return no installed
runtime. No manifest, snapshot, build hash or author-supplied revision owns this lifecycle identity.

Settings grant issuance now checks the caller's expected registration ID as well as declaration/build
identity. Resolution checks the current revision, so reusing an origin object cannot preserve an obsolete
grant. Renderer issuance and all owned transport/fixture callers use the required current contract.
This is request freshness over trusted host-issued access; it does not confine arbitrary JavaScript.

Evidence: 103 focused host checks and eight API transport checks pass. Mutations that reuse a revision,
ignore an expected revision, or omit retirement checks each fail its intended regression and were restored.
The real external-pack app proves reactivation of unchanged build bytes rejects the old loaded-record
grant request and old credential, while a freshly read runtime succeeds. Final strict chain passes in
182.9s (18 of 30 cached), including integration, real app, smoke and packaged authoring:
`node_modules/.cache/apack-chain/runs/2026-10-13T15-43-13Z-31425`;
`/private/tmp/apack-runtime-revision-strict-chain-complete.log`.

Two preceding validation findings were corrected: the renderer read stale API declarations until an
explicit API rebuild, and the external-pack credential fixture omitted the newly required revision.
The fixture now also proves stale-record refusal after reactivation. The chain's missing API declaration
build prerequisite remains an open freshness defect; fix that dependency rather than relying on manual
prebuilds before final acceptance. Then publish accepted runtime state through the application system's
normal state publication and compare per-owner revisions in the shell's loader. Live frontend refresh,
installed update publication, complete native/static descriptors and every later goal phase remain open.


### Source API contract freshness (2026-10-13)

`6913dbae8` closes the API declaration freshness defect recorded above. Workspace TypeScript resolves
`@app/api` to `src/types.ts` through the existing source condition; other type consumers use the compiled
entry, and runtime resolution keeps the compiled server. The API's imports are now file-relative in source,
tests and scripts, making the contract portable across package compiler contexts. Removed the API alias
resolver, Vite paths surface, tsconfig alias maps and unused dependency/lock entries. No new build step,
manual prebuild requirement or compatibility alias is introduced.

Evidence: renderer and API typechecks pass; 121 API cases and 67 focused pipeline cases pass. The compiler
resolution regression hides API build output, including its workspace symlink, and still resolves the
source entry. Removing the source condition fails that regression. Actual Node resolution under the source
condition retains `dist/server.js` without importing it. Strict review exposed the API suite's missing root
package metadata cache input; the suite now declares it explicitly. Removing it fails the existing coverage
guard. The source-condition inventory assertion was also updated for the API's type-only contribution.

Final strict sequential validation passes in 228.7s (18 of 30 cached), including integration, real external
pack, smoke and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T16-12-12Z-81950`;
`/private/tmp/apack-api-source-contract-strict-chain-complete.log`.

Continue accepted-runtime state publication and per-owner live frontend refresh, then coordinated installed
update publication. Native/all-kind metadata, remaining static consumers, complete source/dependency
freshness, navigation, boundaries and all three Phase 6 streams remain required. This checkpoint closes
one demonstrated source-contract defect; full `--all` acceptance and archival remain outstanding.


### Live frontend refresh, readiness and mounted lifetimes (2026-10-13)

`ed8904dd1` publishes accepted registration IDs through the application system's normal `SEND_STATE`
path, using a private host event and checked host inbox. The shell retains accepted revisions instead of
an ID-only loaded list. Publication is a reconciliation hint: the loader reads authoritative entries,
refreshes changed owners, skips matching lifetimes, and removes absent owners only after a successful
read. Failure preserves the prior accepted revision/resources; later requests retry the changed owner.
Revisions received during preparation queue another read. Unchanged owners retain actors and selection.

Frontend readiness now names the accepted registration ID. The API refuses stale/unavailable owners,
including identical-origin replacements. The bus records awaiting frontend owners per actor instance:
reload/activation wait, readiness releases them, and removal clears them. Both `CLIENT_CONNECTED` and
`SEND_STATE` requests wait; `PACK_CHANGED` and `DATA_REPLACED` facts still reach their systems. Review
explicitly caught the latter state-publication path after the initial recorder checked only connection.

The real dev-reload check exposed a mounted-lifetime bug: Vue reused a cached canvas whose setup had
captured the stopped actor. `SurfaceScope` now follows shell actor changes and keys its subtree by actor
session, disposing obsolete content and leaving unchanged scopes mounted. Cached custom forms without
actors had the analogous binding problem. Registry form notifications identify their changed owner;
SettingsEditor remounts that owner's form even for the same component object and preserves unrelated forms.
The SDK's inferred render return report is regenerated; jsdom is an explicit SDK test dependency.

Evidence: 173 focused host/bus cases, 24 API/bus cases, 57 SDK frontend cases and renderer lifetime checks
pass. Eleven mutations cover revision comparison, publication, false failed acceptance, stale readiness,
early startup, missing waiting state/publication filtering, missing actor follow/key, and missing form
key/owner filtering; intended regressions fail and sources are restored. The real cached-module reload
passes, checking changed frontend revision and actor identity before interacting with the new canvas.
The endpoint commits backend work; renderer acceptance follows asynchronously. Earlier typecheck and
host-inbox assertions were corrected, with no validation rule or deadline relaxed.

Final strict sequential validation passes in 385.9s, all 30 gates, including real external-pack app,
smoke and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T17-20-14Z-50190`;
`/private/tmp/apack-live-refresh-lifetimes-strict-chain.log`.

This closes ordinary live frontend refresh and standard startup requests. It does not provide rollback
of arbitrary module/actor side effects, preserve arbitrary component-local drafts across actor replacement,
or establish per-window epoch filtering for all outgoing messages. Installed install/update pre-teardown
paths still require coordinated publication. Native/all-kind descriptors and static consumers, complete
freshness, navigation, frontend fault boundaries and all three Phase 6 streams remain required. Final
requirement audit, strict `--all` on completed committed source, and archival remain outstanding.


### Surface declaration audit and implementation design (2026-10-13)

The next slice removes executable surface assembly as the metadata source. Audit at `7e79cd788`
confirms eleven default-setup surface modules, three external fixture surface modules and two native
host views. `SurfaceSchema` currently declares only entry, contract, default and default visibility;
`generateFrontendEntry` imports the surface object wholesale. `frontendBindingProblem` verifies a
nonempty label and a machine, but does not compare presentation or pane membership to declarations.
Installed/source snapshots therefore cannot describe the current UI independently of activation.

Every field of `Surface` is classified below. This is an audit of the supported contract, not another
hand-maintained runtime registry:

| Field | Owner and source after migration |
|---|---|
| id | Generated feature ref; never authored inside a surface binding |
| label, isPinned, hotkeys, options.headerClass | Inline surface declaration data; codegen supplies the registered values |
| icon | Named Lucide icon, consistent with artifact declarations, or an explicit custom component target; discovery reads the reference, rendering resolves the binding |
| state | Explicit module/default or named-export target; machine construction and state remain execution |
| canvas | Optional component target or a declared route map; route identities and component references are data |
| panel, chat | Optional component targets; their presence is known before loading the frontend |
| fallbackPanel.label, fallbackPanel.toggle | Inline declaration data; the event retains its supported type contract |
| fallbackPanel.isShown | Named executable predicate target; discovery never evaluates it or treats its result as eligibility |

Concrete cases constrain the shape. Threads has five canvas routes (`list`, `kanban`, `create`, `view`,
`dashboard`) and a chat component. Library imports the named `librarySystem` export. Brain supplies
one state-dependent fallback-panel predicate. Brain and Code each have two lazy view bindings; Flows
and the Memos fixture each have one. Every current icon is a Lucide export, but the SDK also supports
arbitrary icon components; preserve that capability through an explicit component reference rather
than silently restricting the contract to the in-tree icon set. Optional canvas/panel/chat remain
optional; do not invent panes or actors to fill absent declarations.

#### Authored shape

Keep metadata inline and implementation targets explicit. Replace `surface.entry` with `surface.state`;
codegen assembles the surface instead of importing a second handwritten inventory from `fe/surface.ts`.
Retain existing contract/default/defaultVisible keys and their meanings. A normal surface is:

```json
"surface": {
  "label": "Notes",
  "icon": "NotebookText",
  "state": "src/features/notes/fe/state.ts",
  "canvas": "src/features/notes/fe/canvas.vue",
  "panel": "src/features/notes/fe/panel.vue",
  "contract": "src/features/notes/fe/contract.ts#Contract"
}
```

A component target is a source path (default export), or `{ "entry": "path", "load": "lazy" }`
when lazy loading is required. The object form may omit load for an explicit custom icon component.
Support the existing named-export target syntax where a module uses a named component or machine.
A routed canvas uses `{ "routes": { "list": "path", "view": "path" } }`; the routes wrapper avoids
confusing a route named entry/load with a component-target object. Preserve the six existing lazy
bindings; this is component loading, not the deferred general pack-activation workstream.
Custom icon components use the component-target object, leaving string icons unambiguously Lucide
names. Do not execute custom icons to discover them; their rendered output is execution, not metadata.

Fallback-panel declarations retain label/toggle and name the predicate via path#export. Move Brain's
predicate to a small executable module or an appropriate existing module; do not serialize its result.
Delete obsolete surface assembly files and unused defineSurface authoring exports/callers together.
There are no aliases or dual reads for surface.entry. Generated registrations still use the bound
Surface/SurfaceDefinition types needed by host stores, with metadata supplied from declarations.

#### Native host and common readers

The normalized surface descriptor must be shared by installed, source-authoring and native declarations;
there is no surface-only catalog and no fabricated native receipt. Native host metadata is pure data,
separate from the renderer's executable imports and per-window machine factories. The native renderer
uses that metadata when assembling bindings, and admission checks the same label/pinning/shortcuts,
pane/route presence and fallback-panel metadata as external frontends.

Do not assume native implementations physically live in the metadata owner's package: host Settings
and Packs views live in renderer, while their machines/ownership live in host. Resolve native binding
references through trusted composition/build checks, independently of installed build paths.
The host/application backend surface inbox targets the shell actor; it is not a contributed canvas.
Host/help supplies a system, while its articles appear in Settings. Neither needs a fabricated visible
surface, feature or actor to satisfy a frontend inventory. Classify protocol receivers separately from
contributed views when expanding the remaining native event/system declarations.

The common catalog projects feature refs, declaration identity, enablement and surface descriptor data
before frontend activation. Source declarations retain source identity; installed entries retain their
real receipts; native entries retain trusted native identity. UI availability/readiness remains a
separate runtime concern. Move installed details and known-surface discovery to this projection before
changing shell selection. A declared disabled/failed surface remains describable; it does not become an
eligible destination or trigger component/module execution merely because it is listed.

#### Implementation and verification checkpoints

1. Add shared descriptor/component-target schemas and exhaustive Surface field classification, then
   change codegen and file/export validation together. Generate metadata and bindings from one accepted
   declaration. Check exact pane/route membership and presentation values before frontend publication.
2. Migrate default-setup, native views, both external fixtures and the authoring template in the same
   usable change. Update doctor, contract-leaf actor-entry checks and source/watch inputs to state and
   component targets. Delete obsolete assembly modules/helper calls. Update the real fork acceptance
   case to edit the manifest label and an actual component, preserving its proof of changed executable
   behavior rather than replacing it with a metadata-only test.
3. Publish the common catalog projection and migrate its first production reader. Cover native views,
   disabled and activation-failed external packs without evaluating entry/component/dependency code.
   Readiness, actor startup and existing transactional frontend resource retirement remain intact.
4. Prove single/routed/lazy panes, named machine exports, custom icons and fallback predicates through
   generated-entry/build checks. Refuse mismatched labels, routes, pane presence, shortcuts and unknown
   surface fields before committing a replacement; retain the accepted frontend/settings grant on refusal.
   Mutation-check admission guards. Run the actual external app and packaged-authoring checks, regenerate
   public schema/API reports and update authoring docs before committing the implementation checkpoint.

This design audit is not implementation or completion of discovery. References, steps/triggers,
editor contributions, remaining native contracts, complete dependency/build freshness and the other
listed consumer migrations still require their own coherent checkpoints. Keep every goal phase and
all three Phase 6 workstreams active.


### Declarative surface implementation working checkpoint (2026-10-13)

Surface declarations now hold presentation, machine/component targets, route identities and fallback
predicate references. The shared framework type and schema agree through a checked schema annotation
and exhaustive field maps. Module/export syntax and reserved route names are validated. Codegen builds
bound SurfaceDefinition objects from declarations, checks state/predicate/module exports as values,
checks Vue component files and preserves lazy component imports. No surface module executes during
these checks. JavaScript targets remain supported when the pack's TypeScript configuration permits them.

All eleven default-setup assemblies and three fixture assemblies are removed, along with the authoring
template and defineSurface helper. Library's named machine export, Threads' five routes and all six
lazy bindings are preserved. Brain's predicate is a small executable module; its label/toggle are data.
CLI feature scaffolding writes the declaration directly; doctor shares complete feature-target file
validation. Contract-leaf checks identify the actual state module. The real fork acceptance edits a
manifest label and a Vue component, then verifies the changed component is actually rendered.

Native Packs and Settings presentation now comes from pure host declaration data, with renderer-owned
views and per-window machine composition preserved. Frontend registry preparation accepts explicit
native declarations and applies the shared metadata/pane guard before granting resources. It captures
top-level authored values once, preserving the existing getter-lifetime contract. Native settings groups
are projected into the validator's settings contribution shape; no native build receipt is invented.
Full native contribution coverage and source/provenance verification beyond this view slice remain open.

The existing common catalog projects immutable surfaces from native, installed and authoring owners.
Installed entries preserve declaration identity and enablement; authoring entries do not invent an
installation enablement decision. App-source advertisements are excluded from selected contributions.
Packs details consumes this projection, showing declared labels even when implementations are inactive.
The redundant hasSurface summary flag is removed; declaration presence answers that question.
Shell selection/default readiness is not migrated or declared complete by this details-reader change.

Admission compares labels, pinning, shortcuts, header options, pane/route membership and fallback
metadata, rejects unknown surface fields, and checks executable binding shapes without calling renderers
or predicates. This does not prove arbitrary JavaScript is safe or establish component-source identity
by comparing function objects. Generated imports, checked exports, accepted declaration identity and
existing build integrity remain the implementation-binding path.

Focused evidence includes 182 SDK build/codegen checks, 21 initial schema/file checks, 47 reviewed
schema/generator checks, 68 catalog/native/binding checks, 46 retirement/handoff regressions, 77 combined
binding/retirement checks and 25 CLI authoring/dependency/facade integration checks. The actual default
pack builds and renderer typechecking passes. A label-comparison mutation fails the declaration and
native-admission tests; restored source passes all 31 binding checks. Two sandboxed full-host attempts
closed their worker IPC channel; the elevated two-worker run completed, exposing four real fixture/
getter failures among 1,309 cases. Those four were fixed and their owning suites pass. No guard or
assertion was relaxed. Controlled schema/API reports and public authoring docs are updated.

Strict validation remains required before committing this candidate. All other supported contribution
kinds, remaining native inventory, complete freshness, shell/static-reader migration, navigation,
frontend boundaries, API/provenance work and final goal-wide strict --all acceptance remain required.


Validation follow-through: the first strict candidate passed 4,301 of 4,303 host-pool tests and
refused two incomplete fixture paths. The shared SDK fixture now writes its declared state module,
and its completeness assertion enumerates surface targets rather than reading the retired entry key.
All nine fixture checks and eight build-output-swap checks pass, including the original authored-input
race and build rollback assertions. The next strict run passes the full host/pack unit gates and
638 of 639 integration checks; its remaining contract-leaf fixture still imported a filename the
shared manifest no longer designated as the actor module. The fixture now explicitly declares that
unconventional state filename. All 17 targeted leaf-rule cases pass, with their original refusal
assertions retained. Codegen prose now states that surface modules enter the compiler for value-export
checks while facade event/state types still come from independent contract leaves. Final strict
validation is running; these focused passes are not substitutes for the full app gates or final goal audit.


Final strict validation on the corrected candidate passes all 30 gates in 488.6 seconds (one cached),
including full unit/integration, real external-pack app acceptance in 156.5 seconds, smoke and both
packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T00-28-13Z-89285`;
`/private/tmp/apack-declarative-surfaces-strict-3.log`.
This completes this surface declaration/binding/catalog-details checkpoint, not all-kind discovery or
the larger goal. Source/asset provenance checks for the remaining native contributions, other static
consumers, shell readiness/navigation, boundaries, consumed APIs, dependency identity and final strict
--all on finished committed source remain required. No unfinished plans are archived.


### Reference declaration prototype plan (2026-10-13)

Audit after `27803b90f`: six reference types, three categories and three item providers are defined
inside executable feature modules. Codegen spreads their type objects and concatenates categories;
useReferenceItems constructs a last-wins Map by category. Nothing can inspect these names from the
manifest, and duplicate names/protocols can overwrite one another. The generated aggregate is currently
pack-local and is consumed by default-setup's editor; external declarations do not automatically enter
an app-wide reference registry. Do not claim that generating an external aggregate closes that gap.

Replace the string references key with inline maps:

```json
"references": {
  "types": {
    "note": {
      "protocol": "note",
      "category": "notes",
      "icon": "NotebookText",
      "svgElements": [["path", { "d": "M2 6h4" }]],
      "navigate": "src/features/notes/fe/references.ts#openNote"
    }
  },
  "categories": {
    "notes": {
      "label": "Notes",
      "icon": "NotebookText",
      "useItems": "src/features/notes/fe/references.ts#useItems"
    }
  }
}
```

Types, URI protocols and category names retain their current global identity; category providers are
owned by their declared category. Duplicate feature claims within a pack refuse with both feature ids;
dependency diamonds retain actual ownership while distinct owners conflict. Do not silently compose
providers where the existing contract has one provider per category. Type/category icons use the same
Lucide convention as existing artifact declarations; preserve custom component capability through an
explicit component target if the shared declaration needs it. SVG tuples remain data, not executable
factories. Navigation and useItems are checked function exports and are never called for discovery.
Navigation callbacks remain until the entity-opening phases migrate their callers.

The first coherent checkpoint adds shared schema/types, derives codegen from inline declarations,
checks named exports and duplicate claims, migrates the three shipped modules to executable functions
only, and publishes immutable reference/category metadata through the common catalog. A production
pack-details reader must use that data with disabled/failed runtime coverage. This is the foundation,
not completed cross-pack reference discovery or runtime consumption.

The following work has two checkpoints: frontend binding admission, then catalog/editor integration.
Register reference bindings as explicit frontend contributions, validate them against declarations
before publication and preserve accepted bindings on refusal. Then migrate editor/category readers
to the common catalog plus active provider lookup. Cover external
packs, disabled/failed contributions, unrelated owner collisions and dependency diamonds. Dynamic
items still require their provider's execution and scope disposal. Finish native contribution coverage,
entity routing/readiness and stale delivery without keeping the local/runtime discovery aggregate as
a compatibility fallback. Regenerate schemas/API reports and public authoring docs with each usable
checkpoint; final goal-wide acceptance still covers every remaining kind and workstream.

### Declarative reference foundation checkpoint (2026-10-13)

Implemented the first reference checkpoint above. The manifest owns six shipped reference types,
three categories, their icons/SVG geometry and explicit navigation/provider targets. The three source
modules now export executable functions only. Shared authored/native schema checks refuse duplicate
feature claims; generation checks function exports, category availability and dependency ownership,
including shared-ancestor diamonds and unrelated collisions. Custom component icons retain explicit
lazy loading. Source-file diagnostics include reference targets.

The common catalog exposes immutable native, installed and source reference declarations with truthful
origin/revision/enabled information. The production Packs summary and detail view read those declarations;
an isolated real activation failure and a disabled pack both retain their metadata. This is data discovery,
not app-wide executable admission: the editor still consumes its pack-local generated aggregate. Finish
explicit frontend reference bindings, transactional collision/retirement checks and the catalog-driven
editor/provider migration next. Do not retain the aggregate as a fallback after that migration.

Evidence: 16 focused reference checks passed, including native duplicates, no module execution,
custom lazy icons, function refusals, dependency categories and diamonds. Removing the function-kind
guard caused two named refusal assertions to fail; byte restoration returned all 16 to passing. The
strict chain passed all 30 gates in 548.2 seconds with no cached gates: 4,324 host unit tests, 839 pack
unit tests (two existing skips), 639 integration tests, real external/default-fork app acceptance,
smoke and both packaged-authoring halves. Public schema, API reports and authoring docs are updated.
Run evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T01-17-42Z-60078`;
log: `/private/tmp/apack-reference-declarations-strict.log`.

Other contribution kinds, full native/source/dependency freshness, shell eligibility/entity routing,
frontend recovery boundaries, all three Phase 6 workstreams and final committed-source strict --all
acceptance remain required. No incomplete plans are archived.

### Reference frontend admission plan (2026-10-13)

Bindings belong to `PackFEFeature.references`, preserving the manifest's owning feature. The generated
reference module is the single producer of those bindings; the frontend entry registers them. Admission
checks exact type/category membership, protocols, category names, SVG geometry, labels, component
shapes and callable navigation/providers. Do not invoke these contributions to validate them.

Global types, protocols and categories require explicit collision checks: `createOwnedStore` defaults
to last-wins folding and does not enforce exclusivity. Build candidate maps before running candidate
resources; keep the accepted maps/resources unchanged on refusal or abandoned preparation. Replacement
and removal release captured keys. Capture authored reference data before both native and installed
validation; otherwise a getter can pass validation and publish a different protocol. Freeze accepted
metadata while retaining executable component/function identities.

Use one frontend registry `onChanged` subscription for committed contribution changes. The previous
forms-only name concealed that it already fired for all registration changes; migrate forms readers
without keeping an alias. Reference metadata discovery remains the common catalog's responsibility,
independent of this active-binding read view.

This admission checkpoint precedes the catalog/editor migration. The current editor aggregate remains
an ordinary current consumer, with no old declaration format or runtime discovery fallback. Remove it
when readers migrate. Carry common declarations into the window independently of loaded runtimes;
using active bindings alone would lose disabled/failed metadata. Cover protocol/category additions in
an already-open editor and scope/dispose reactive providers on replacement, removal and view teardown.

#### Window declaration transport audit

`packages/api/src/transport/packs.ts` currently exposes only `packs.loaded`, derived from accepted
runtime registrations. `ShellClient.loadedPacks()` and the shell's frontend loader reconcile that
runtime list. Neither is a declaration-discovery transport: disabled and activation-failed packs
are absent. Keep this execution/readiness path distinct from the next window catalog integration.

Expose the existing common catalog's accepted declaration data without loading pack modules. Its
window reader needs current origin/revision/availability, committed updates and reconnect/cancellation
handling; late responses from a superseded backend/window lifetime must not replace current metadata.
The frontend reference maps above supply accepted executable bindings, not the declaration inventory.
Do not implement discovery by inspecting those maps or by creating another authored reference list.

### Reference frontend admission checkpoint (2026-10-13)

Implemented per-feature `ReferenceBindings` in generated frontend registrations, exact binding checks,
global type/protocol/category ownership checks and immutable accepted metadata. Candidate conflicts
refuse before resource hooks and preserve incumbent maps. Prepared abandonment publishes nothing;
replacement/removal release captured keys. Native and installed validation now use captured reference
data, fixing a reproduced getter that previously validated `note` but published `changed`.

The frontend registry's general `onChanged` subscription replaces its misleading forms-only name;
all forms/style/test callers and the testing shell read-port adapter are migrated with no alias.
Discovery still reads the common declaration catalog. The generated pack-local aggregate is derived
from the same per-feature bindings and remains the current editor consumer until the next migration;
this does not deliver app-wide editor discovery or reactive provider lifecycle yet.

Nineteen focused admission tests and the installed getter regression pass. Disabling ownership refusal
failed five targeted assertions; disabling the callable navigation guard failed its targeted assertion.
Both exact source restorations returned all 19 admission cases to passing. The strict chain passed all
30 gates in 520.5 seconds with no cached gates: 4,344 host unit tests, 839 pack tests (two existing skips),
639 integration tests, real external/default-fork Electron acceptance, smoke and both packaged-authoring
halves. Updated SDK reports cover bindings and the shared change-subscription contract.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T01-50-14Z-96639`;
log: `/private/tmp/apack-reference-bindings-strict.log`.

Next implement the window declaration transport and catalog/editor/provider migration described above,
including an actual external reference contributor in a live editor. Complete native locator checks,
other contribution kinds, freshness, entity routing, boundaries, all Phase 6 streams and final committed
--all acceptance. This checkpoint closes admission only; the discovery plan and owning goal stay active.

### Window catalog transport implementation plan (2026-10-13)

Expose the existing common catalog through `packs.catalog`, a subscription that sends the current
snapshot immediately and later committed changes. A publisher-run identity distinguishes backend
restarts from revision changes; stopping the subscription removes its catalog listener. This endpoint
is independent of `packs.loaded` and does not read executable registrations or load modules.

One window-owned reader captures immutable wire snapshots, checks envelope/revision consistency,
ignores older revisions, refuses conflicting data at one revision and isolates connection generations.
The publisher validates declarations before publication; the window validates the ordinary-JSON
frame and snapshot bookkeeping rather than importing Node build tooling to repeat publication checks.
An initial-read timeout exposes a failure, while cancellation closes subscriptions and ignores late
callbacks. Keep the last accepted snapshot on a transport failure with an explicit unavailable status.

The shell client starts/stops this resource with its bus connection without changing activation order
or gating frontend loads on catalog delivery. Guard superseded bus callbacks too: an old subscription
must not reconnect/disconnect resources or announce readiness for a newer window lifetime. Reference
readers, provider scopes and the SDK's declaration read port are the next integration checkpoint;
transport delivery alone does not complete discovery consumers.

### Window catalog transport checkpoint (2026-10-13)

Implemented `packs.catalog` over the existing common catalog, publishing its current snapshot and
committed changes without runtime enumeration or module activation. Native and disabled installed
declarations are covered through the real router. The window reader captures immutable JSON frames,
checks snapshot bookkeeping and revision consistency, distinguishes publisher runs, ignores older
revisions and closes timed-out/failed/disconnected subscriptions. Late callbacks from old generations
cannot overwrite or resurrect the reader; cleanup during synchronous setup is handled too.

The renderer starts/stops this independent resource with its bus lifetime. Superseded bus callbacks
are ignored, including pending status/settings completions. The composed renderer test demonstrates
catalog data becoming ready before settings bootstrap announces connection readiness. This changes
no activation ordering and does not load cold declaration targets.

Twelve reader tests, two router tests and eight renderer-client tests pass. Removing connection-epoch
guards failed three named restart/timeout/disposal assertions; exact restoration returned the reader
suite to passing. Strict validation passed all 30 gates in 371.4 seconds (12 cached), including fresh
Electron/default-fork acceptance, smoke and both packaged-authoring halves. The final composition
assertion and formatting passed a subsequent strict run in 62.1 seconds (21 cached); rebuilt app bytes
were unchanged, so app acceptance was reused. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T02-18-57Z-31693` and
`node_modules/.cache/apack-chain/runs/2026-10-14T02-26-46Z-59802`;
logs `/private/tmp/apack-window-catalog-strict.log` and `/private/tmp/apack-window-catalog-strict-final.log`.

Next expose the declaration read port and migrate references/editor/providers to catalog data plus
accepted executable bindings, retaining owner and lifetime identity for eligibility. Test actual
external contributions in an already-open editor, provider disposal and disabled/failed metadata.
Remove the pack-local aggregate when that migration lands. Complete all remaining contribution kinds,
native/freshness checks, entity routing, boundaries, Phase 6 workstreams and final committed --all.
Transport is delivered; discovery consumers and the owning goal remain unfinished.

### Reference binding identity audit and prerequisite (2026-10-13)

Before migrating readers, the active reference maps exposed only configurations. Global names could
not identify the owning feature or distinguish an accepted binding from a declaration at that name.
Extend each read entry with the qualified feature ref, declaration revision and host-supplied runtime/
build revisions. Module registration owns its declaration stamp; the host loader supplies executable
identity separately. Capture only those identity fields, so unrelated caller fields cannot overwrite
ownership. Native bindings must not manufacture installed/runtime receipt identities.

Create immutable read entries once during candidate capture, rather than during table rebuilding.
An unrelated pack change must retain entry identity; accepted replacement must change it. This gives
provider scopes a precise replacement signal and prevents unnecessary restarts. Membership/collision
admission and accepted metadata remain unchanged. These maps are executable availability, not the
common declaration catalog; no reader may infer missing declarations from their contents.

The next consumer migration still requires the SDK declaration read port, catalog-driven parsing/
rendering/category discovery, scoped providers and an actual external reference contributor in a live
editor. Eligibility must compare owner and declaration/accepted identity rather than treating a global
name match as sufficient. Entity delivery/readiness still needs its separate planned coordinator.

### Owned reference identity checkpoint (2026-10-13)

Implemented the identity prerequisite above. Reference read entries retain qualified feature ownership,
module declaration stamps and the runtime/build identity supplied by the host loader. The host
captures only its identity fields; extra caller fields cannot overwrite ownership or the declaration
stamp. Native entries omit installed/runtime identities rather than inventing receipts. Entries are
immutable and stable across unrelated registry changes, while accepted replacement creates new entries.
All existing readers/tests use the owned entry shape; no old-shape alias or fallback is retained.

Twenty-one admission checks and 31 loader checks passed. Recreating entries while rebuilding tables
failed the stability assertion; exact restoration passed all 21 admission cases. SDK reports agree.
The strict chain passed all 30 gates in 543.3 seconds with no cached gates, including 4,362 host tests,
839 pack tests (two existing skips), 639 integration tests, real external/default-fork Electron acceptance,
smoke and both packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T02-40-19Z-74516`;
log `/private/tmp/apack-reference-identity-strict.log`.

Next deliver the declaration read port and catalog/editor/provider migration. The pack-local editor
aggregate still exists as its current consumer and must be removed with that migration. Verify actual
external references in an already-open editor, changed protocols/categories and provider disposal.
This identity checkpoint does not complete discovery, entity readiness or the larger goal; all remaining
kinds/native/freshness, boundaries, Phase 6 streams and final committed --all acceptance remain due.

### Common declaration read-port plan (2026-10-13)

Expose typed projections from the existing common catalog through `FeHostRuntime.catalog`; do not
create another authored inventory or derive declarations from active registrations. References are
its first frontend projection. Share `ReferenceCatalogEntry` across host/window/SDK and one pure
projection function across backend and window snapshots. Carry truthful origin, qualified ownership,
enablement and declaration/build identity; native/source entries never manufacture installed receipts.

SDK frontend helpers read declarations and status through that port and subscribe explicitly to
frontend declaration changes. Keep the backend framework's catalog subscription on the backend:
choosing the frontend implicitly when both runtimes are bound would make backend actors observe the
wrong catalog in tests. Tests that reach declarations must provide their catalog explicitly rather
than receiving a fabricated empty inventory.

Cache the window projection by accepted snapshot identity and retain it with unavailable status after
disconnect. Clear it on new connection/disposal. Snapshot observer sets before notifying: subscriptions
created while recreating a view/provider must not be invoked by the current publication. Data reading
must never call providers, navigation or component factories.

After this read-port checkpoint, migrate editor parsing/rendering/category readers and provider scopes,
remove the pack-local aggregate, and prove dynamic external contributions in an already-open editor.
Declaration status and owned executable identities remain separate inputs to eligibility; entity
readiness/delivery follows its dedicated plan. All other discovery kinds and full-goal work remain active.

### Shared declaration read-port checkpoint (2026-10-13)

Implemented `PackCatalogView` on the frontend runtime and the shared SDK reference catalog entry type.
Backend/window readers use one pure projection function over the same common catalog. SDK helpers
read metadata/status and subscribe to frontend declaration changes without consulting active bindings
or invoking contribution code. Backend framework notifications remain backend-scoped. Existing test
bindings provide the new port explicitly; tests needing declarations must supply their catalog.

The window caches reference entries by accepted snapshot identity, retains them with disconnected
status and clears the cache on a new connection/disposal. Notification queues exclude observers added
during the current publication. An observer mutation was caught by the new regression assertion;
exact restoration returned all 14 window reader checks to passing. Thirty focused host checks, 952 SDK
checks and 13 renderer checks pass. Metadata tests cover native, disabled installed and authoring
sources, truthful identity/enablement, immutability, unavailable status and subscription cleanup.

Strict validation passed all 30 gates in 478.8 seconds (11 cached), including 4,366 host tests, 839 pack
tests (two existing skips), 639 integration tests, fresh external/default-fork Electron acceptance,
smoke and both packaged-authoring halves. The initial strict run caught a generic lint rule on an
inline Set copy; an explicit notification queue preserves the required semantics and passes lint.
SDK reports and public docs agree. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T03-07-16Z-13212`;
log `/private/tmp/apack-catalog-read-port-strict-final.log`.

The read port is delivered; reference/editor/provider migration is not. Next replace pack-local
aggregate consumers with catalog metadata and owned accepted bindings, prove external contributions
and protocol/category updates in a live editor, and dispose providers across binding/view lifetimes.
Then finish other contribution/native/freshness, entity readiness, boundaries and every Phase 6 stream.
Final committed --all, complete acceptance auditing and archival remain due. The goal stays active.


### Editor/provider consumer audit and migration sequence (2026-10-13)

The read port is ready, but current editor consumers still import the generated pack-local
`REFERENCE_TYPES`, `CATEGORIES`, `ITEMS_PROVIDERS` and `ALL_PROTOCOLS`. The generator derives these
from `FEATURE_REFERENCES`; only the latter is needed for frontend registration. Replace the readers
and remove those aggregates together, including the now-unused `CategoryConfig` and
`CategoryItemsProvider` exports and their reports. Keep the note-type mapping with the notes feature: it
is that feature's entity-to-reference mapping, not an editor inventory.

Concrete audit findings and required fixes:

- `reference-node.ts` builds one parse rule per protocol when Tiptap constructs its schema. Reading a
  current catalog elsewhere cannot update those already-created rules. Use a generic anchor rule whose
  `getAttrs` resolves the current declared protocol at parse time, returning false for unknown protocols,
  empty ids or malformed encoding. Continue encoding canonical entity ids once; labels/codes remain
  presentation. HTML/Markdown serialization reads current declarations, never executable bindings.
- Node views refresh geometry on node changes only. Subscribe to declaration changes for geometry
  updates, unsubscribe in node-view destruction, and resolve eligible navigation at click time. Missing
  bindings leave declared references renderable without activating their owner. Delete the Markdown
  `updateDOM` loop: it visits anchors and does nothing.
- The suggestion surface filters with the static category list; the popup uses the same static list and
  indexes item icons without an absence check. Read category labels from declarations and render active
  icons only when eligible. A stale or invalid provider item must not cause an undefined-icon crash or
  insert a reference type outside that category's declarations.
- `useReferenceItems.ts` starts every provider during setup and keeps them until the containing component
  dies. Start only the selected eligible category while the suggestion is active. Own a child effect scope,
  stop it before replacement/category change/closure, and dispose all listeners at parent-scope teardown.
  Stable accepted binding identity avoids restarts for unrelated publications. Existing SDK surface-state
  readers already use `onScopeDispose`, so child effect scopes release their actor/shell subscriptions.

Use one SDK reference reader to join declarations and accepted bindings; editor components must not
repeat ownership/identity comparisons. Metadata reads remain executable-free. Execution requires a
ready catalog, a matching qualified owner, and a current enabled contribution. Installed bindings must
match declaration and accepted build identities; absence of an build receipt is not permission
to execute an installed entry. Source declarations advertise authoring metadata without installed
eligibility. Native declarations/bindings use their explicit native ownership contract, without
inventing installed stamps. Catalog disconnect stops providers and navigation, while retained metadata
can still describe references. Subscribe to both declaration and accepted-binding changes because their
publications have independent timing. Neither event alone proves an executable binding is eligible.

Implement the shared reader and lifecycle checks first, then migrate all editor consumers and generated
output in one consumer checkpoint. Verification must include actual editor HTML/Markdown parsing after
a protocol is added to an already-created editor, live category/geometry changes, owner/stamp mismatch,
disconnect, disabled/failed contributions, and provider disposal on replacement/removal/closure/teardown.
An unrelated pack update must not restart the selected provider. Exercise an actual external reference
contributor in the app acceptance fixture, not just a mocked default-pack aggregate. Keep Node's typed
array realm intact in editor tests by using the existing explicit JSDOM-global setup.

This sequence changes consumers and subscription ownership, not stored document format. Entity
destination readiness and frontend failure recovery remain requirements of their dedicated plans;
the reference reader must not invent a parallel routing or fault-boundary implementation.


### Reference eligibility reader implementation (2026-10-13)

The SDK now owns the join between common declarations and accepted reference bindings. Metadata
readers never consult executable registrations. Category metadata retains qualified feature ownership
and duplicate names; no map silently overwrites an owner's category. Global-name type/binding readers
refuse ambiguous runtime claims. Authoring source advertisements do not supersede or duplicate an
installed/native runtime claim; source-only entries remain descriptive and cannot execute.

Executable lookup requires ready catalog status, explicit enablement and matching feature ownership.
Installed entries also require a matching nonempty declaration/build identity and an accepted runtime
identity. Native bindings have no installed stamps. Readers return the stable accepted object without
calling its provider/navigation/component. Frontend binding notifications are separate from declaration
notifications, so consumers can follow either publication order and dispose both subscriptions.

Focused tests cover both executable groups, status changes, disabled/missing enablement, declaration/
build changes or missing receipts, foreign ownership, source metadata, native bindings, ambiguity,
removal/replacement and listener cleanup. Removing owner or build matching independently fails the
corresponding named refusal assertion. Editor consumers and provider scopes are still unmigrated;
continue the preceding migration sequence, including actual external contribution acceptance.


### Editor/provider consumer implementation (2026-10-13)

Editor consumers now use the shared declaration and eligibility readers. Protocol resolution belongs
to the SDK and distinguishes authoring advertisements from runtime claims. Generic anchor parsing
looks up current protocols at parse time; rendering/serialization use declaration data, and node views
subscribe to geometry changes with destruction cleanup. Navigation resolves eligible bindings at click
time. The empty Markdown DOM hook and pack-local aggregate exports/types are removed. The notes
entity-to-reference mapping stays with notes rather than recreating a cross-cutting settings/inventory owner.

The picker follows actual editor transaction events, cleans up when its editor changes, and reads
declared category labels. Only its selected eligible category starts a provider. An owned effect scope
ends before replacement/removal, on closing/category change/disconnect and on view teardown; stable
bindings survive unrelated publications. A provider that closes the picker during setup cannot publish
stale items. Unknown/inactive/wrong-category items are excluded before insertion. Popup mounting now
waits for a real editor instance. Actual provider failures still belong to the separate pane-boundary work.

The first frontend build exposed an integration prerequisite missed by the read-port checkpoint:
`@apackdev/sdk/fe/references` was not in the host-shared module map. Its new runtime helpers would have
inlined a second host binding. Add that subpath to the existing shared map; do not add a separate bridge
or inline fallback. Pack tests use the supported frontend test runtime's start/stop lifecycle.

The external fixture declares memo references, exports navigation and a reactive provider, and supplies
a real editor. Its app acceptance check exercises an already-mounted viewer's parsing/navigation and
the editor picker. Focused tests separately cover protocol additions after editor construction, geometry
changes, unavailable navigation, provider scope replacement/closure/disconnect/removal and listener
cleanup. Removing provider disposal fails named lifecycle assertions. Full app acceptance is required
before recording this as a validated checkpoint.

Continue the broader editor contribution/native/freshness audit and verify initial document parsing
when catalog delivery is delayed; generic live parsing alone does not prove initial unknown links are
upgraded when metadata arrives. Every remaining discovery kind, entity readiness, fault boundary and
Phase 6 workstream remains active, alongside final committed-source --all and the full acceptance audit.


### Runtime-check cache correction (2026-10-14)

The final editor cleanup changed the shipped pack's frontend while leaving app workspace bundles
unchanged. Strict app checks incorrectly reported cached because their declared inputs omitted
`PACK_OUTPUTS`: the app loads that pack separately at runtime. Correct external-pack app, smoke, full
E2E and packaged-authoring app inputs to include the separately loaded build. A fingerprint regression
changes only shipped frontend bytes and requires each app check's key to change. Runtime build
success or unchanged app bundle bytes alone never proves an unchanged running app. This is part of
required discovery/source-build freshness, not a speculative cache optimization.


Editor/provider validation passed all 30 strict gates after the runtime-check cache correction
(209.3 seconds, 20 cached). External-reference Electron acceptance ran fresh (157 seconds), including
the real fixture's canonical navigation and picker insertion test, alongside smoke and packaged-authoring
app acceptance. Earlier full consumer validation passed in 450.7 seconds; final lifecycle verification
passed 19 focused checks and 850 pack tests. Provider-disposal, retired-node-handler and shipped-pack
cache-input mutations each fail their named regressions, followed by exact source restoration.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T04-06-57Z-42359` and
`/private/tmp/apack-editor-strict-cache-fixed.log`. Initial catalog-delivery behavior and the remaining
contribution/native/freshness work are still due; this is not whole-goal completion.


### Delayed reference metadata: identity contract correction (2026-10-14)

The initial-delivery audit reproduced actual target loss, not merely a missing icon: a cold external
reference is reduced to label text before its declaration arrives. The common UI also still hardcodes
three pack-owned schemes. Waiting for a particular pack or reparsing a whole document would preserve
the wrong dependency and risk edits; discovery metadata must not be required to decode saved identity.

Follow the [reference wire correction](../../plans/open-entity.md#reference-wire-identity-correction-2026-10-14):
one explicit internal URI containing reference type and canonical entity id, with pure SDK parsing/
formatting independent of declarations. Keep the existing node attributes and use declarations only
for presentation/eligibility. Remove per-type protocol fields/claims/readers and hardcoded UI schemes
outright, migrating all owned contracts and examples without compatibility parsing.

This supersedes the earlier protocol-per-type discovery/consumer design. Type/category ownership and
all other contribution, native/source freshness and entity-readiness requirements stay intact. The
new parser must preserve a target while its pack is absent as well as during first catalog delivery;
publication should refresh presentation without replacing the document or invoking navigation.
The failing reproduction and source audit establish the next implementation; the wire correction
has not been implemented or validated yet.


### Metadata-independent reference identity implementation (2026-10-14)

Follow the implemented [reference identity contract](../../plans/open-entity.md#reference-identity-implementation-2026-10-14).
The SDK has one pure URI formatter/parser usable by backend and frontend. Existing editor nodes
preserve canonical identity before metadata arrives or after it disappears. Per-type protocols and
their claims are removed rather than becoming aliases; category/type ownership remains unchanged.
Backend note/task backlinks use the same parser. Public schema, reports, manifests, content examples
and actual external reference acceptance migrate to the current URI format.

Continue the intrinsic editor-schema ownership audit: a default-pack-supplied parsing extension is
not proof that a host-only editor preserves references without activating that pack. Resolve this
alongside native editor declarations rather than claim all editor discovery delivered. Entity
routing/readiness, every other contribution/native/freshness kind, failure boundaries and Phase 6
work remain active. Current focused checks do not substitute for final strict/app validation.


The reference identity checkpoint passed all 30 strict gates in 545.8 seconds with no cached gates,
including 4,405 host tests, 855 pack tests (two existing skips), 639 integration tests, fresh real
external-reference/default-fork Electron acceptance, smoke and both packaged-authoring halves.
The external reference/picker case passes with the new URI. Schema and three reviewed SDK API
reports agree; content parity passes all 145 checks after deliberate golden regeneration.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T04-44-15Z-64383`;
`/private/tmp/apack-reference-wire-strict.log`. The intrinsic editor-schema ownership and remaining
whole-goal work above are still required.


### Restored manifest requirements and handoff (2026-10-14)

[Manifest consolidation](../../plans/manifest-consolidation.md) restores all 17 original redesign decisions,
settles both naming questions and maps every original phase check. Complete its M1–M6 before
extending additional consumers across the split root entity/shape declarations. Existing settings and
reference checkpoints remain valid; they do not complete this restored scope. The roadmap and owning
goal now require these outcomes rather than merely surveys or syntax deferrals.

Discovery additionally owes static flow-to-action relationships and rename-side diagnostics, actual
`apack pack info` contribution identities/availability, consistent authoring/doctor/codegen declarations
and named early validation where possible without execution. Dynamic binding validation remains an
activation boundary; unused utility exports are not undeclared contributions. Preserve source/build
freshness and no unnecessary content reapplication through manifest-only changes.

The facade checkpoint must use `facades`, `PACK_TYPES_FACADE` and cache `facades/`, with named
missing/incapable dependency refusal and unchanged capability-based acceptance. DSL defs remain defs.
Editor and app contributions are declared directly as `extensions.textEditor` and
`extensions.appExtensions`, alongside other contributions; there is no frontend container;
`hostVersion` remains the single-host compatibility range. All native/source/install readers, fixtures,
templates, schema/reports and public docs migrate together. Intrinsic editor-schema ownership, every
remaining kind, navigation/readiness, boundaries and all Phase 6 streams remain active.


### Dependency facade audit and checkpoints (2026-10-14)

Current inspection contradicts the earlier claim that capability-based dependency admission already
exists. `fetch-deps.ts` calls `_snapshotFormatMismatch` before `parseSnapshot`; installed dependency
tests explicitly refuse absent/different stamps. They prove exact-format refusal, not capability
acceptance. In addition, `generatePackFiles` interpolates a missing facade as `undefined`, so an empty
facade map can reach generated typing without a named dependency error. Correct these defects rather
than treating the historical evidence as proof.

Implement in coherent checkpoints:

1. Use `PackSnapshot.facades`, `PACK_TYPES_FACADE` and cache `facades/`, preserving DSL `defs/monaco`
   and physical `pack-types.d.ts`. Refuse missing/empty required facade data in codegen before output;
   migrate producers, schema, every reader, native/test fixtures, reports and public docs outright.
2. Inspect declared facade type exports against the actual generated consumer's requirements. A
   missing/incapable facade must name dependency, required exports and rebuild remedy. Dependency
   discovery accepts usable current-data capabilities with absent/different build stamps as
   diagnostic context; installation/runtime build readers retain their explicit exact format policy.
   Use one current-data reader with honest optional stamp types for dependencies, not a dual reader,
   old-format converter, synthesized stamp or fake export. Actual dependent TypeScript/build checks
   must prove acceptance and refusal, including cached and installed candidates.
3. Keep required facade inputs in source/dependency freshness and provenance. A runtime test must
   independently satisfy runtime admission; type capability acceptance does not authorize executing
   an incompatible runtime. Preserve existing DSL assets and controlled EARS types throughout.

This is part of full discovery, before expanding remaining contribution kinds. Native all-kind
declarations, steps/triggers/editor assets, frontend naming, static content edges, CLI inventory and
all later execution phases remain required. No release/version metadata or format constant is changed
by the vocabulary checkpoint.


### Facade vocabulary/data validation outcome (2026-10-14)

Checkpoint 1 above is implemented in `c1d8497b4`: snapshot `facades`, `PACK_TYPES_FACADE`, cache
`facades/`, named missing-content refusal and safe cache names are migrated with all readers/fixtures/
reports/public docs. DSL definitions and physical facade filenames are preserved. Actual dependent
facade typing/completion and flow-helper execution pass; guard mutations fail. Strict passed all
30 steps in 504.7s, recorded in the execution goal.

Checkpoint 2 is still required. Current format-refusal tests remain valid build-policy tests; they
do not demonstrate capable type admission. Implement the separate current-data dependency reader,
actual required type-export checking and honest stamp diagnostics, including installed/cache/real
authoring checks. Keep runtime execution admission distinct. Remaining kinds and all later phases
retain their scope.


### Consumed facade export inspection outcome (2026-10-14)

`b1eeebd19` implements actual consumed type-export checks using the shared TypeScript reader and
virtual bundled declarations, with stale-file precedence and no directory writes. Required imports
define requirements; backend-only consumers do not acquire unused surface-state requirements. Syntax
recovery cannot count as usable capability. Missing/value-only/unresolved/syntax-invalid types fail
by dependency and rebuild remedy. Focused/mutation/real authoring checks and all 30 strict steps passed;
the execution goal records source and exact evidence. EARS/content bytes and API reports are unchanged.

Checkpoint 2 remains open for the separate dependency current-data reader and honest optional stamp
types. Current resolution still rejects absent/different stamps. Audit build/test executable dependency
consumers and preserve exact runtime/install admission before relaxing type-data resolution. Deliberate
skip-generation paths remain in the required dependency/tool freshness audit. No adapter, alias,
synthesized stamp or legacy-key read is authorized. All remaining goal phases retain their scope.


### Dependency current-data inspection outcome (2026-10-14)

`0159acd11` completes checkpoint 2 above: honest optional dependency stamps and shared current-data
validation, actual consumed facade type checks, installed/cache/source resolution and executable-file
withholding on stamp mismatch. Real producer/consumer builds and editor queries accept capable data;
poisoned build/runtime files are never imported by that inspection. Content compilation and harness
execution independently enforce build-format eligibility. No aliases, conversions, synthesized
stamps or obsolete-key readers exist. Exact execution validation remains a current build contract.
Focused tests, restored guard mutations and strict validation pass; the owning goal records evidence.

Checkpoint 3 remains open. Inspected `build --skip-generate` bypasses generation checks, then only
warns when dependency release versions differ. That cannot prove same-version source/facade/tool
freshness or generated-file integrity. Implement one generation freshness check shared with normal
generation; prove skip paths refuse stale/missing/edited outputs before sealing a build. Keep actual
resolved dependency capabilities and codegen implementation inputs in that identity. Audit normal
source reload and build cache paths too. Preserve explicit runtime admission and defer no later goal
phase: remaining contribution/native discovery, frontend naming, content inventory, navigation,
boundaries and all three Phase 6 streams retain their scope.


### Generation freshness outcome and remaining watcher gap (2026-10-14)

`82d9d7a9c` implements the shared freshness check specified above for normal generation and both build
and facade-report skip paths. Successful generation records exact output hashes. Resolved dependency
snapshots and source/codegen inputs identify the generation; same-version changes do not rely on a
release-version warning. Builds use one dependency resolution for generation and compilation, refuse
stale output before executing content compilers, and recheck before sealing. Actual authoring/build
checks and restored guard mutations pass; the goal records strict evidence and preserved EARS/content.

Checkpoint 3 remains open for watched publication and the remaining dependency/tool/cache audit.
Inspected `build/watch.ts` directly replaces the runtime bundle without refreshing snapshot/facade
metadata or the receipt. A runtime lock prevents writer overlap but cannot make that build coherent.
Replace this path with verified publication that preserves matching declarations, checked bindings,
facades and receipt identity. Prove invalid edits retain the accepted build, source-contract edits
reach discovery and runtime together, and concurrent watcher requests are not lost. Avoid a second
inventoried discovery projection or unverified reload exception. Assess the cost of the complete build
versus a correctly validated incremental publication before retaining the runtime-only optimization.
Keep all remaining kinds/native discovery and later goal phases required.


### Watched publication outcome and external-input audit (2026-10-14)

`1fa16bd7b` closes the inspected runtime-only receipt defect and duplicate watcher/drop-on-busy paths.
Checkout and external-pack development share staged, verified publication before reload. The input
filter is shared with builds, and session teardown waits for in-flight work before profile removal.
Real filesystem, installed receipt, catalog and host-runtime checks pass, as do meaningful restored
mutations and strict validation. The owning goal records evidence and the observed build cost. This
is complete build publication, not a promise of the former runtime-only latency.

Checkpoint 3 remains open for the explicit external-input graph: symlinked authored sources outside
the watched root, dependency snapshots and executable build files, and SDK/tool implementation inputs.
Inspect current readers and caches, retain exact version/origin/content identity and explicit linked
source policy, and prove their changes cannot silently reuse stale declarations or code. Reuse build
input knowledge rather than inventing a separate authored contribution inventory. All remaining
contribution/native discovery, frontend naming, navigation, boundaries and Phase 6 streams remain
required; lazy activation and stronger isolation stay deferred.


### Linked input outcome and dependency/tool evidence (2026-10-14)

`255e80e4d` closes linked authored-data subscription gaps through shared input traversal, parent watches
for atomic replacement and subscription refresh before validation. Executable modules remain physically
inside their pack; no confinement exception is added. Real linked-manifest/host-runtime checks, a restored
subscription mutation and strict validation pass; the execution goal records exact evidence and failures.

Checkpoint 3 remains open for dependency/tool graph identity and provenance. Inspected local dependency
resolution exposes executable files by stamp/existence without verifying receipts, while cache writes
and reads omit resolved source identity. Replace this with coherent verified cache publication and
recorded exact origin/version/content identity, retaining independent type-data inspection. Inspect
source and bundled tool implementation inputs, imported helpers and dependency build code; prove their
changes invalidate stale outputs without relying on release-version changes. Do not preserve the cache
comment that treats provenance as optional. Source and cached/installed build identities must agree.

The editor offline audit is also required: the Monaco loader defaults to jsDelivr, and no renderer
configuration overrides it. The external settings-editor test failed once awaiting the editor and then
passed on retry; network-backed success is not offline acceptance. Ship local editor/worker assets and
exercise real schema completion/diagnostics without external networking. All other goal phases retain
their scope; lazy activation and stronger isolation remain deferred.


### Offline editor outcome and output identity gap (2026-10-14)

`07d544606` closes the inspected CDN editor/worker dependency: renderer-owned Monaco and all supported
language workers are bundled locally. A real renderer reload and JSON assistance/save test runs with
external HTTP blocked, with a rebuilt negative bootstrap mutation proving refusal. Disposal cancellation
uses vendor origin, preserving application errors routed through Monaco. The execution goal records
source, focused checks, restored mutations and strict evidence; the moved staged-DSL integration keeps
all its original assertions.

Source/tool freshness remains open. A negative out-of-band renderer build followed by exact source
restoration left stale built output while the chain reused the previous source-input key. Explicit
rebuild was necessary before the accepted final app checks. Audit output identity as well as input and
implementation/import graphs. Preserve dependency origin/version/content and receipt requirements,
independent type-data inspection, and every remaining discovery/native and later goal phase. The local
editor checkpoint does not complete broader editor contribution declarations or frontend migration.


### Dependency identity checkpoint (2026-10-14)

`439883713` validates requested versus embedded pack IDs across local/file/cache resolution and selected
release versus build/snapshot versions before caching. Focused checks and three caught identity
mutations plus strict validation are recorded in the execution goal. This closes identity substitution
only; cache receipts, coherent publication and persistent provenance/content identity remain required.
Current schema validation rejects invalid declarations normally; no obsolete-key inventory or special
historical-format refusal is introduced. Exact executable build-format checks remain distinct from
capability-based inspection of current type data.


### Verified dependency build cache and terminology outcome (2026-10-14)

`ff4358588` migrates CLI and harness admission to the shared verified-build cache. Exact version,
origin and content identity persist in the resolution record; publication retains old immutable paths
and failed copying/admission leaves the incumbent. Captured snapshot hashes prevent source swaps
from pairing old metadata with new executable identity. Type-only inspection remains independent of
executable admission, with no obsolete-layout reader or conversion.

Pack build APIs, installed inventory, catalog/reference/frontend identity fields and asset URLs now
use build terminology. “Artifact” remains the actual contribution/viewer concept. Current docs,
fixtures and generated API reports agree; the execution goal records source, guard mutations, focused
and complete strict evidence. Historical checkpoint prose retains its historical vocabulary.

Storage/admission is implemented; provenance inspection, dependency/tool graph and out-of-band output
freshness remain required. Neither this cache nor the naming cleanup closes the remaining contribution
inventory, native declarations, frontend boundaries, navigation or Phase 6 workstreams.


### Inspection data outcome (2026-10-14)

`d6fa2c6dc` removes filesystem-count substitutes from pack info. Verified compiled index metadata and
dependency provenance are available without module activation, source files, downloads or cache writes.
The shared index validator also protects existing writer/preview/import/harness paths without changing
provider requirements or serialized output. Info distinguishes data availability from execution and
verified bytes from current authored declarations; doctor uses one dependency frame for checks and
presentation. The execution goal records evidence, including actual producer source removal.

This improves compiled inventory and completes provenance presentation, not discovery for every kind.
Static flow/action dependency edges, native/other contribution kinds, complete tool/dependency/output
freshness, frontend migration and later goal phases remain required.


### Shared output freshness outcome (2026-10-14)

`a667b161a` closes the observed source-restoration output hole: cache reuse checks actual produced
files/bytes, not input identity plus path existence alone. The goal records a real runtime stamp probe,
exact renderer restoration, guard mutation and full/warm strict evidence. This preserves source/
descriptor publication behavior; it does not establish implementation/import-graph coverage, dependent
executable key scope or the drive launcher’s separate freshness nudge. Complete those required checks
and the remaining discovery kinds/later phases before closing this plan.

### Resolved TypeScript input outcome (2026-10-14)

`f8c17e99c` covers fresh resolved TypeScript inputs outside authored/package-declared scopes, including
transitive external declarations, undeclared packages and ambient type roots. Exact source/resolution
metadata bytes enter the common compilation key and publication revalidation. Generated files are
excluded even through imports. Missing targets becoming available change identity; discovery scanning
imports no executable modules. The goal records the pre-fix real-generation failure, passing external
metadata regression, focused checks, byte-omission mutation, costs and full/warm strict evidence.

Do not equate this with full executable closure. Next audit distinct compiler-version/options readers,
Vue/dynamic/runtime inputs, external watch subscriptions and already-loaded compiler identity; the
watcher now uses fresh CLI processes (see the following outcome). Complete coherent frozen execution/publication and scope-cost work,
then manual-build/drive freshness. All remaining contribution/native/static-content discovery and
later goal phases remain required. No plan is closed or archived by this checkpoint.

### Fresh watcher execution outcome (2026-10-14)

`01eec3309` removes executable module-cache reuse between watched builds by spawning the normal
CLI build in a fresh process. The regression distinguishes custom tsImport (already fresh) from
ordinary flow imports (previously stale). Linked packages are checked before child startup; readiness,
staged verified publication, failure retention and reload ordering are preserved. Real source/manifest
replacement, linked data retargeting, invalid edits and host reload checks pass. The goal records
regression/mutation and accepted strict evidence, including the independent reconnect fix
`82bca6529` found in real app settings acceptance.

Worker lifetime does not freeze bytes during compilation. External watch subscriptions, Vue/runtime/
dynamic inputs, exact compiler consumers and coherent frozen reads/publication remain required,
with measured costs. Then complete manual-build/drive freshness and every unfinished contribution/
native/static-content and downstream phase requirement.

### External TypeScript watch outcome (2026-10-14)

`b956785fe` subscribes to fresh inherited configuration and TypeScript resolution probes, including
missing paths and physical aliases. Existing subscriptions survive failed builds; creating only the
missing external target can recover publication. Authored root watches are shared, duplicate byte/
topology frames are skipped, and package-root compression bounds native recursive subscriptions
without recursively watching filesystem ancestors. Linux retains selected leaf watches.

`ba3d8df85` aligns declaration bundling with inherited aliases and baseUrl resolution while preserving
genuine package/Node imports, fixing the full-build refusal the watcher fixture exposed. The goal
records actual facade/event updates, refusal retention, mutation checks, platform topology, measured
subscription cost and full/committed-source strict evidence.

Resolved type/configuration subscriptions are implemented. Runtime/Vue/dynamic and dependency input
closure, exact compiler consumers and coherent frozen execution remain required before freshness
certification. Then finish manual-build/drive behavior and all remaining contribution/native/static
content and downstream goal phases.

### Compiler-discovered runtime package outcome (2026-10-14)

`61d882b7d` closes a concrete cached-frontend gap: unchanged npm declarations previously hid changes
to an undeclared imported package's JavaScript. The common compiler projection now exposes package
owners; the existing byte/dependency graph includes those owners and their transitive dependencies.
Watch signatures and subscriptions use the same graph, including runtime files, directory membership
and absent dependency candidates. Package entries are never executed for discovery. Consumer roots
remain excluded from library byte scopes, including when nested beneath a discovered owner.

Actual build and watcher regressions prove a JavaScript-helper-only edit updates the frontend.
The goal records the failing baseline, scoped-link/ownership checks, async refusal and repair coverage,
strict timeout diagnosis, subscription optimization, measured scope/cost, and passing strict checks on
committed source. No input coverage or test budgets were dropped to obtain that result.

Vue/script/style/asset and dynamic inputs, exact compiler consumers and coherent frozen execution
remain required. Pre/post byte verification does not freeze compiler reads. Continue manual-build/
drive freshness and every remaining supported contribution, native/static-content and downstream
phase after those source-build requirements; this checkpoint does not complete discovery.

### Vue script import outcome (2026-10-15)

`94ab5f834` extends the common compiler input projection to Vue scripts using the existing SFC parser.
Inline blocks, script setup and external script sources resolve through in-memory script roots without
execution or filesystem output. Physical component context handles linked imports; both authored-root
spellings exclude generated output, and canonical paths keep input identity independent of checkout
location. Pack-local manifest entry validation is preserved.

Actual cached frontend builds update after only inline/external script dependencies or a linked nested
component's outside helper change. Automatic watching covers a Vue-only undeclared npm import.
The owning goal records failing baselines, focused checks, compiler-suite placement corrections,
strict failures, measured cost and accepted strict validation on committed source. EARS/content are
unchanged; test assertions and timeout values are preserved.

Styles, template assets and other runtime/dynamic inputs still need their own consumer audit. This
script projection is neither a Vue component typechecker nor an immutable execution environment.
Retain exact compiler-consumer alignment, frozen execution/publication, scope cost, manual-build/drive
freshness and every remaining contribution/native/static-content and downstream goal requirement.

### Frontend compiler authority checkpoint (2026-10-15)

Source `7c97e8553` removes frontend output reuse: an actual two-build regression retained stale CSS
when only an external Vue stylesheet changed. Vite runs once per build; facade and DSL reuse remain.
The current compiler reports watch files and PostCSS directory dependencies over private worker IPC,
independently of optional diagnostic records. Ready subscriptions retain incumbent/partial scopes
through refusal and replace them after success. Logical and physical directory identities preserve
link-retargeting detection. Authored outputs and unrelated profile activity are excluded.

Rename events use a subscription-scoped ancestor index, and package traversal uses directory-entry
file types rather than repeating metadata reads. Package fingerprints remain byte-identical; no input
scope is narrowed or cached across builds. Vue input cases now prove compiler-frame invalidation as
well as real Vite output; disabling script discovery fails all three invalidation assertions. Full CLI
watch/publication, atomic replacement, refusal retention and external-file recovery coverage remain.

The owning goal records focused, mutation, type and real CLI evidence. The source checkpoint is
reviewable, but bulk strict validation is unresolved: the last completed run exceeded the aggregate
integration deadline without a logged assertion failure. It is not a full acceptance pass. The user
requested a 60s feedback cap shared by the chain and direct integration runner; do not repeat long
whole-suite retries to diagnose a local failure or silently treat the cap as an assertion failure.
Resolve the bulk gate before final committed-source strict --all and completion.

The following checkpoints cover static empty-glob forms and worker compiler inputs. Continue dynamic
graphs, exact compiler-consumer alignment and coherent frozen execution/publication. Retain manual-build/drive freshness and every remaining
contribution/native/static-content, navigation, frontend boundary and Phase 6 requirement. Nothing
is archived or excluded by this checkpoint.

### Nested content-directory links (2026-10-15)

`7ad1f0396` and `01aaa18ab` observe physical targets beneath reported content directories, including initially empty
and dangling nested links. The same traversal signs directory membership and collects subscriptions;
canonical ownership excludes authored outputs and visited physical roots bound cycles. Unchanged
tracked-link metadata does not invalidate the namespace; creating an unreported stylesheet symlink
still triggers missing-target repair. Watching remains independent of diagnostic read records.

A failing baseline, 105 passing focused cases, CLI typechecking and an actual Tailwind CLI
rebuild prove this slice; target additions and retargeting into authored templates both publish the
expected CSS in 20.7s under the 60s bound. Link identity remains signed when target contents belong
to the authored tree, so output exclusion does not hide topology changes. The goal owns the evidence.
This completes reported-directory link coverage, not arbitrary glob/worker/dynamic input closure,
frozen execution or the outstanding bulk strict gate. All other goal scope remains required.

### Frontend globs and worker compiler inputs (2026-10-15)

`49f2647f3` adds membership subscriptions for static external `import.meta.glob` declarations,
including arrays, exclusions, literal `base` and root-entry subpath imports. `53550379d` installs
input-reporting surfaces in Vite's separate worker builds, including nested workers. Each report
accumulates the compilation's files, so the main bundle's final report cannot discard worker inputs;
diagnostic records and live subscriptions share that set. Worker globs use the same directory observer.
Actual Vite tests cover dependency-only changes, nested worker glob additions and changed output.
A real CLI test retains the accepted revision after worker compilation fails and publishes its repair.
The goal records baseline failures and focused validation. Arbitrarily computed glob options,
remaining dynamic graphs, exact compiler identity, coherent frozen execution/publication,
manual-build/drive freshness and the aggregate strict gate remain required. No broader phase is closed.

`a6be184da` additionally observes the fixed relative directory prefix of variable import templates,
which Vite expands after user surfaces. A previously empty import graph now observes matching-file
additions/removals, including filename prefixes; explicit `@vite-ignore` imports remain runtime-owned.
This is conservative subscription coverage, not a replacement for Vite's expansion or proof of frozen
reads. The goal records the failing baseline, seven passing compiler cases, nested-worker regression,
105 focused checks and type/lint evidence. Computed glob options, exact compiler identity, coherent
execution/publication, manual-build/drive freshness and the full strict gate remain open.

`f74617e5f` also routes the initial `pack dev` build through a fresh CLI process after refreshing linked
packages, removing its in-process compiler-cache boundary. Supervisor teardown aborts the initial
child; private input reporting is enabled only for observed builds. Actual startup, cancellation and
watcher refusal/repair checks pass, and a mutation back to in-process compilation fails the regression.
This does not prove direct-command bootstrap identity, long-lived frontend compiler identity or frozen
reads/publication. Those remain part of the full compiler-consumer and freshness acceptance gate.

### Direct build bootstrap correction

The audit found `buildCommand` imported compiler modules before refreshing linked packages. Move actual command
compilation to a private worker entry selected by the existing native bootstrap over an owned IPC
channel. The public command validates flags and delegates; `runPackBuild` refreshes before spawning.
Initial development and watched builds use that same entry directly, avoiding recursive public-command
dispatch and the duplicate child-side refresh. Preserve public build flags, generation/refusal and
atomic publication behavior; leave release orchestration unchanged. The worker terminates on lost
parent IPC and disconnects after completion. Ship the private entry in the bundled CLI; source mode
uses the existing source bootstrap. No public worker command, compatibility route or new manifest key.

Acceptance: real direct/source and copied-package builds honor flags; changed same-version compiler
chunks invalidate skipped generation; watched builds retain compiler reports and refusal recovery;
startup/cancellation checks remain valid. Verify worker packaging and parent-channel lifetime, and
typecheck/lint changed code. This establishes the command's fresh-process boundary, not immutable
filesystem inputs or long-lived frontend compiler identity. Keep those and the final strict gate open.

Implemented in `1a1895529`. Four source/copied-package and worker-lifetime cases pass in 14.68s;
78 focused checks and both CLI/tooling typechecks pass. Startup/cancellation and real watched worker
error/repair pass in 24.19s. A mutation back to in-process public compilation fails the regression.
The goal owns the logs. The lifetime test observes process exit plus ended output streams: an isolated
Node reproduction showed parent-initiated IPC disconnect can omit `close` even when both streams
end. No process-group machinery is needed. Frozen reads, long-lived frontend compiler identity,
remaining input closure, manual-build/drive freshness and the aggregate strict gate remain open.

### Frontend editor declaration checkpoint

Replace the opaque frontend registration-module target with explicit surface groups:

```json
{
  "extensions": {
    "textEditor": {
      "suggestions": {
        "extensions": {
          "reference": "src/editor/reference.ts#ReferenceNode"
        },
        "popups": {
          "references": "src/editor/ReferencePopup.vue"
        },
        "isSuggestionActive": "src/editor/suggestions.ts#isSuggestionActive"
      }
    },
    "appExtensions": {
      "toolbar": "src/Toolbar.vue"
    }
  }
}
```

Surface and popup keys are local to their pack/group; extension keys preserve actual Tiptap names.
Keep meaningful surface grouping. Registration carries matching keyed bindings; generated imports name
each declared export. Validate missing/extra groups and members, extension-name mismatch and predicate/
component shapes without executing them. Reject extension-name collisions transactionally, naming
both pack/group owners. No conventional aggregate export or anonymous arrays remain.

Use the same frontend data contract for native declarations, installed snapshots and authoring data.
Project it through the common catalog/window view and CLI inspection without importing executable
modules; retain origin, enablement and accepted identities. Migrate schema/module-target validation,
codegen, every reader, native/test fixtures, default-setup, public docs and API/schema reports together.
Prove poisoned/unavailable executable modules do not affect discovery, binding refusals preserve the
incumbent, and real external-pack/default-pack compilation agrees with declared members.

This checkpoint does not complete editor ownership: host-owned intrinsic document parsing, native
editor composition and live editor/palette migration remain required. Preserve the reference wire
identity and behavior; do not invent features or treat mutable runtime results as static inventory.
All other discovery/source-freshness, navigation, boundaries and Phase 6 work stays in the goal.


### Explicit editor contribution checkpoint (2026-10-15)

Source `e40d157f9` declares editor groups and app slots directly under `extensions.textEditor`
and `extensions.appExtensions`. This replaces the earlier proposed frontend wrapper at the user's
request: a contribution kind's placement does not claim exclusive ownership of frontend behavior.
Native declarations carry the same fields directly. Each editor group names extension objects,
popup components and its optional suggestion predicate; generated bindings import checked exports.
Schema checks refuse duplicate extension claims within a pack, and active binding admission refuses
cross-pack collisions transactionally. Captured membership cannot be changed through caller-owned
maps. Catalog/window projections and CLI inspection expose native/source/installed identities without
executing modules or requiring authored source files; disabled declarations remain visible.

Validation: 251 focused declaration/codegen/catalog/renderer tests pass in 6.22s
(`/private/tmp/apack-editor-final-unit.log`); 22 default-pack reference editor tests pass in 3.00s
(`/private/tmp/apack-editor-default-tests.log`). A real external-pack build with Tiptap objects,
Vue popups/app extensions and a typed predicate passes, then its copied output is inspected after
removing authored source (`/private/tmp/apack-editor-external-final.log`, 9.36s). Default-setup builds;
all seven baseline generated EARS/content files remain byte-identical. Public API/schema reports
were regenerated and reviewed; strict validation passes API/schema/export checks, all typechecks,
lint/specifier/tier checks, runtime build, smoke, external-pack contract and packaged authoring.

The strict checkpoint is **not fully green**: the aggregate integration pool was killed at its
existing 60s deadline, with no assertion failure in its captured output. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-15T09-09-11Z-19925`,
`/private/tmp/apack-editor-strict-retry.log`. The earlier strict attempt found two missing catalog
methods in default-pack test mocks; those fixtures are fixed and the pack typecheck now passes.
The aggregate gate and final committed-source strict `--all` remain required. This checkpoint does
not complete intrinsic editor-schema ownership, native editor composition, live editor/palette
migration, remaining contribution discovery/source freshness, navigation, boundaries or Phase 6.
No scope is excluded or archived.

### Intrinsic reference schema ownership checkpoint

Current code still declares the `reference` Tiptap node in default-setup's suggestions group. That
module owns persistence parsing/serialization, node presentation and a pack-specific suggestion
surface. Consequently a renderer without default-setup's frontend lacks the stored-document schema,
even though reference declarations themselves are available without activation.

Split those responsibilities at the existing composition boundary:

- Move `ReferenceNode` into `@apackdev/ui` with the other document primitives. Preserve its wire node
  name, attributes, URI parser, HTML/Markdown behavior, node-view refresh/disposal and eligible click
  behavior. Navigation callbacks remain until the entity-navigation phase migrates them.
- The host's native declaration claims `textEditor.references.extensions.reference`, with its
  module/export reference. The renderer supplies that UI object in its existing `host` registration.
  Native declarations remain data-only; host/backend code does not import UI or the Tiptap node.
  Existing checked binding and cross-pack ownership rules cover the intrinsic name too.
- Default-setup declares a separate `referenceSuggestion` extension that installs its existing
  ProseMirror suggestion surface. It no longer owns the reference node. No alias, fallback node,
  invented feature, second registry or duplicated document-schema inventory.
- Move the node behavior tests with its owner; prove cold HTML/Markdown and stored JSON preserve
  targets with no external packs registered. Exercise actual renderer host registration and collision
  refusal, and prove the pack's suggestion extension still installs its surface alongside the native
  node. Update public exports/reports and manifest documentation with the move.

This checkpoint does not complete live editor recomposition: editors already open while a contributed
extension group changes still need an explicit state-preserving strategy. Resolve that next, including
pending edits, selection/history, removed nodes and popup/provider disposal; do not pretend a fresh
editor instance or static metadata alone proves that behavior. Other discovery/freshness, navigation,
boundaries, dependency/API/replacement work and the aggregate strict gate remain required.


### Native reference schema ownership checkpoint (2026-10-15)

Source `f8c6b2262` moves `ReferenceNode` and its behavior tests into `@apackdev/ui`. The native host
catalog declares `textEditor.references.extensions.reference`; the renderer supplies its binding
before loading external frontends. Backend discovery imports no UI implementation. Default-setup
now contributes `referenceSuggestion`, which installs its existing suggestion surface alongside the
host-owned node. The URI/node/attribute identities, Markdown/HTML behavior, metadata-driven icon
refresh and eligible navigation are preserved; navigation callbacks still belong to Phase 4's migration.
No alias, fallback schema, new feature or duplicate registry was introduced.

Seventy-five focused catalog/binding/UI/native renderer checks pass in 6.82s
(`/private/tmp/apack-native-reference-regressions.log`). Nine default-pack suggestion/provider tests
pass in 2.75s (`/private/tmp/apack-native-reference-suggestion.log`), including suggestion activation
and dismissal. Removing both native declaration and binding makes the actual renderer test fail on
its missing reference pill; exact source is restored and passes
(`/private/tmp/apack-native-reference-{mutant,restored}.log`). The built Electron app passes with
default-setup disabled: it renders a saved reference and preserves JSON/HTML/Markdown targets, using
the app's actual shared UI module and native registration
(`/private/tmp/apack-native-reference-electron-final.log`, 3.9s). The first browser assertion ran before
Tiptap's deferred view attachment; the test now waits for its DOM through Playwright. E2E typechecking
and final whole-repo lint pass. The UI export map/report are regenerated and reviewed; all seven
baseline generated EARS/content files remain byte-identical.

Strict checkpoint evidence: `node_modules/.cache/apack-chain/runs/2026-10-15T09-20-06Z-30733`,
`/private/tmp/apack-native-reference-strict-final.log`. Type/API/schema/export/facade/specifier/tier
checks, default-pack/runtime builds, external-pack contract and packaged-authoring checks pass or
retain valid cached results. The aggregate integration pool again exceeds its 60s deadline; it has
no completed assertion failure in captured output, and remaining scheduled app checks are not proved
by that interrupted gate. This is not a green full chain or phase completion. The aggregate gate,
final committed-source strict `--all`, live editor recomposition, remaining discovery/source freshness,
entity navigation, frontend boundaries and all Phase 6 workstreams remain required. Nothing is
excluded or archived.

### Accepted editor binding identity and lifetime

The current editor takes `textEditorExtensionsRegistry.getAll()` once during setup. Popup membership and
Escape predicates therefore retain an unloaded pack, and an editor created before a pack arrives
never adopts it. The registry also discards pack/group identity when projecting its accepted bindings.
The catalog supplies declared membership, but cannot stand in for accepted executable bindings.

Installed Tiptap source confirms `Editor.setOptions()` only updates options/view props and state;
it does not rebuild the extension manager or schema. `registerPlugin()` reconfigures ProseMirror
surfaces, not node/mark definitions. Do not use either API as an alleged general schema replacement.

Implement in coherent checkpoints:

1. Preserve `packId`, `groupId` and the captured `binding` in the registry's accepted editor projection.
   Return immutable rows and a detached list, preserving pack/group order and incumbent binding object
   identity across unrelated commits. Expose committed-change subscription through the existing SDK
   registry. Refused/disposed candidates publish nothing; disposal unsubscribes. Native bindings use
   this same contract. This is runtime availability, distinct from the declaration catalog.
2. Recompose the actual editor only when its accepted extension membership/objects change; metadata
   changes alone must not reset it. Key popup lifetimes by qualified contribution identity and editor
   generation, and read predicates from the current accepted generation. Dispose old popup/provider
   and editor resources before exposing replacements.
3. Preserve pending document content and selection/focus when the replacement schema can represent
   them. Verify schema round-trips rather than silently dropping unknown nodes/attributes/marks.
   If required content has no usable provider, retain the original document and present an unavailable
   editor until it can be represented safely. Do not keep unloaded executable callbacks alive or emit
   normalized/damaged content as a save. Cover parent content/entity changes while unavailable.
4. Treat undo/surface state explicitly: arbitrary opaque surface state is not transferable across schema
   replacement. Preserve history for updates that do not replace the editor; reset it on actual schema/
   extension replacement and document that boundary. Do not access private Tiptap managers or mutate
   ProseMirror history internals to suggest stronger preservation than the libraries support.

Prove install/replace/remove/re-enable against an already-created editor, stable unrelated updates,
pending edits, selection, provider/pop-up disposal, unavailable content and unchanged native reference
parsing. Include a real external contribution path. This work remains part of Phase 3, together with
all other discovery/freshness and downstream goal requirements; it is not an exclusion or completion.


### Accepted editor binding identity checkpoint (2026-10-15)

Source `45e8465ad` preserves `{ packId, groupId, binding }` in the accepted editor registry, including
native groups, and exposes committed-change subscription through `textEditorExtensionsRegistry.onChanged`.
Rows are immutable, returned lists are detached, and unrelated registrations retain incumbent
binding objects. Consumers use `.binding`; declarations/unavailable groups remain in the catalog.
No alias or second registry. This implements step 1 of the editor lifetime design above; the editor
still takes its initial snapshot, so live recomposition and retirement are **not** complete.

Fifty-five focused ownership/transaction/native renderer tests pass in 1.93s
(`/private/tmp/apack-editor-binding-tests.log`). A lost-notification mutation fails the subscription
regression; exact source is restored and all ten lookup tests pass
(`/private/tmp/apack-editor-binding-{mutant,restored}.log`). The rebuilt Electron host-only editor
preserves saved references through the new binding projection
(`/private/tmp/apack-editor-binding-electron.log`, 10.5s). Affected direct typechecks pass, public
frontend/runtime API reports are regenerated and reviewed, and all seven baseline generated EARS/
compiled-content files remain byte-identical.

Strict checkpoint: `node_modules/.cache/apack-chain/runs/2026-10-15T09-29-51Z-38416`,
`/private/tmp/apack-editor-binding-strict.log`. All type/API/schema/export/facade/lint/specifier/tier
checks and pack/runtime builds pass; smoke, external-pack contract and packaged-authoring checks
pass. The aggregate integration pool is killed at its existing 60s limit, with no completed assertion
failure in its captured output. This remains a failed full checkpoint gate; it is not waived or a
phase-completion claim. Final committed-source strict `--all`, editor recomposition/unavailable
content handling, every remaining discovery/freshness kind and all downstream phases stay required.


### Live editor composition checkpoint (2026-10-15)

Source `8863043a6` replaces the editor's one-time binding snapshot with scoped accepted-change
subscription and generation-checked composition. Qualified extension identity determines replacement;
unrelated commits and popup/predicate-only changes preserve the editor/history. Popup lifetimes have
qualified keys. Replacement retires old views/providers first, then restores pending JSON, selection,
stored marks and focus. Exact document/mark round-trips refuse silent attribute/node loss. An
unavailable schema retains pending data without emitting a save; compatible re-enablement restores
it, and explicit document/entity changes replace suspended state. Actual extension replacement resets
opaque undo/surface state, as selected above. Failed cleanup is logged and view/listener cleanup is
attempted without preventing a usable replacement. No private Tiptap managers or history internals.

Twenty-seven focused UI/reference/lifetime checks pass in 3.69s
(`/private/tmp/apack-live-editor-verified-unit.log`), covering rapid generations, unmount/subscription
retirement, popup/predicate replacement, focus/selection/pending formatting, history boundaries,
sub-document notifications, unavailable nodes, schema attribute loss and throwing cleanup. Removing
the document integrity guards makes the data-loss regression fail; exact source is restored and all
nine lifetime cases pass (`/private/tmp/apack-live-editor-{mutant,restored}.log`). Two built Electron
checks pass in 6.6s (`/private/tmp/apack-live-editor-electron-provider.log`): native-only references and
an already-open unsaved slash-command/reference draft while the installed default pack is enabled
and disabled through the real loader. Document, selection and save count remain unchanged.

Strict evidence: `node_modules/.cache/apack-chain/runs/2026-10-15T09-47-54Z-48208`,
`/private/tmp/apack-live-editor-strict.log`. Type/API/schema/export/facade/lint/specifier/tier checks,
pack/runtime builds, smoke, external-pack contract and packaged authoring pass. Public report
regeneration produces no contract change; all seven baseline EARS/content files stay byte-identical.
Final renderer/E2E typechecks and whole-repo lint also pass after the added focused tests. The aggregate
integration pool still hits its 60s override; the full gate remains failed, not waived. Final strict
`--all` on committed source is still required.

This closes the selected open-editor update checkpoint, not the whole editor/discovery phase. These
checks do not prove arbitrary cold custom-node documents without their implementations; retain that
provider/readiness audit with remaining static DSL/Monaco/palette discovery and consumer migration.
Every remaining source freshness, navigation, frontend boundary and Phase 6 requirement stays active.

### Integration deadline scope correction

The temporary 60s feedback cap is applied to the entire integration pool in both the chain and direct
runner. Individual integration tests and hooks already have independent 60s bounds. Recent strict
runs show multiple healthy build/watch cases completing before the aggregate is killed at 62s, with
no assertion failure; the aggregate cap therefore prevents the required gate from completing rather
than detecting the earlier worker-close bug (which is fixed and regression-tested).

Remove the named-step override and its helper/message/test scaffolding. Both aggregate callers use
the existing `suite` ceiling (300s), while test/hook bounds remain 60s and focused `quick` checks
remain 60s. This is a correction to which operation the limit governs, not a new timeout class or
measured-cost multiplier. Run existing timeout/graph checks, then the real strict chain; investigate
any actual assertion failure or stall instead of increasing limits again. This supersedes the earlier
pool-wide cap instruction after the observed interference; no required validation is waived.

### Validation work placement corrections

Deadline source `b910bc66e` removes the aggregate-only override; all 89 graph/timeout checks pass.
The strict run (`2026-10-15T10-02-14Z-56915`) and an isolated integration run now expose actual work
placement defects instead of the 60s aggregate cutoff. The isolated run passes 54/55 files before its
300s ceiling: `frontend-resources.integration.spec.ts` combines 19 serial glob, worker and asset
scenarios in one worker. Split it by those existing concerns, sharing fixture cleanup/output readers
and preserving every test body, assertion, input variant and per-test bound. Do not increase deadlines.

The app gate also exposes `default-pack-fork.spec.ts` building all of default-setup in `beforeAll`.
Its 60s hook expires under load and `afterAll` deletes the still-compiling source directory. Move the
fork's source mutation, real external build and archive production into the existing contract-preparation
stage. Declare its source inputs and generated output handoff in the chain. The app test reads that
prepared archive and keeps the 60s hook/test policy; normal boot/reload/replacement acceptance remains.
No fake archive, bypassed compile, new success stamp or package-manager cache protocol. Retain bounded
producer cleanup, and leave release/version metadata and unrelated work untouched. Prove the full
integration and external app paths after these structural fixes, then resume required discovery work.


### Validation placement outcome (2026-10-15)

`21110749b` implements the fixture/watcher separation above. All 19 watcher cases and 58 assertions are
preserved; contract preparation builds the real fork archive, and app runners check its shipped-build
provenance. Replacement, reload and normal fork/removal/restoration boot checks pass. The isolated pool
then completed all 57 files / 739 tests but exposed a task-update RPC timeout: the two long synchronous
scaffold suites needed the existing between-case event-loop yield policy. Adding those hooks clears it.
The final strict checkpoint passes, and strict validation on committed source passes with unchanged
successful checks cached. The owning goal records exact runs and counts. This is not final `--all` or
completion of discovery; all outstanding consumer, source-freshness and later-phase requirements remain.


### Step discovery: declaration and reader sequence (2026-10-15)

Current code keeps `StepEntry.node` as an exported `StepNodeFacet` target. Codegen imports it into both
registrations; backend binding checks only its presence/object shape. Palette labels/defaults therefore
require executable module imports despite being data. `StepFEFacet` also hides category, icon target,
connection rules, colors and layout flags beside executable components/layout callbacks. UI
`node-styles.ts` caches active-registry projections indefinitely. Native declarations do not yet cover
steps. This is required work, not a reason to treat the existing module paths as complete discovery.

Implement these dependent checkpoints:

1. Inline `extensions.steps.<type>.node` as `{ label, defaultLabel?, defaults? }`. Generate the same
   data into both bindings and compare it exactly before admission. Migrate every authored pack,
   scaffold/template, source reader, fixture and public/schema/API contract; remove the redundant node
   exports outright. The StepDefinition runtime node data contract remains. Inspect useful node data
   without authored modules or activation. A metadata-only step has no executable directory; do not
   invent a module path to find types/helpers. Checkpoint 2 replaces the remaining executable-directory
   inference with explicit `types` and `dsl.helpers` module declarations. No aliases or conversion.
2. Declare the frontend's static step metadata and component/layout bindings, sharing checked schemas
   with native declarations. Keep calculated layout callbacks executable and expose their availability,
   not predicted results. Preserve component loading metadata and module-reference semantics. Complete
   common catalog/window projections and native/installed binding membership before switching readers.
3. Replace palette/style/default and static layout discovery reads with committed catalog data;
   executable node/form/layout evaluation still requires accepted bindings/readiness. Remove active-
   registry discovery unions and permanent derived caches. Prove disabled/unavailable declarations,
   replacement/unload/re-enable, ownership conflicts, native parity and real external authoring.

For checkpoint 1, preserve every default exactly as JSON data: the current LLM model string is a pack
node default; omit the switch default's `predicate: undefined` because the durable JSON contract means
absence. Verify the resulting creation behavior. Do not change generated EARS types or compiled content
identities. Keep the model runtime fallback separately where execution uses it. Required checks include
schema/codegen/static-target coverage, backend/frontend mismatch refusal retaining incumbent bindings,
CLI inspection with poisoned modules, real scaffold/external/default builds and app node defaults.
Regenerate reviewed schema/API reports, run focused and strict checkpoint checks, commit and record
source evidence before continuing. This sequence leaves the full goal and native/static assets,
source execution/freshness, navigation, boundaries and all Phase 6 requirements intact.


### Inline step node data outcome (2026-10-15)

`324816421` completes step checkpoint 1 above: node labels/defaults are inline manifest data, both generated
bindings carry it and reject differing data, authored node exports are removed, and scaffolds, module
readers, CLI inspection, schema/API reports and public docs agree. Metadata-only nodes do not trigger a
pack-root types/helpers search. Nested defaults are copied on creation; actual repository/trigger/model
checks pass, with all seven baseline EARS/content files unchanged. Guard mutations fail and exact source
is restored. Strict serial-step validation and committed-source default strict validation pass; the owning
goal records commands, runs and counts, including the earlier invalid-fixture failures and their fixes.

Continue with the planned native/installed frontend step declaration and checked-binding checkpoint,
then migrate palette/style/default/layout discovery readers and remove permanent active-only caches.
Calculated layout and actual compiler/runtime/provider calls stay executable. This does not close step
or full discovery, source execution/freshness, native lifecycle, editor readiness, navigation, boundaries
or any Phase 6 workstream. Nothing is archived or excluded.


### Frontend step declaration design (2026-10-15)

The current 15 authored frontend step modules contain data, Vue/icon imports, lazy component factories,
and two calculated layouts. Replace their opaque `fe: "path#export"` target with a data object:

```json
{
  "node": { "label": "Example" },
  "types": "src/extensions/steps/example/types.ts",
  "fe": {
    "nodeConfig": {
      "icon": "Box",
      "category": "logic",
      "connectionRules": { "inputs": 1, "outputs": 1 }
    },
    "colorKey": "indigo",
    "components": { "form": { "entry": "src/extensions/steps/example/form.vue", "load": "lazy" } },
    "layout": { "hasInput": true, "getHeight": "src/extensions/steps/example/layout.ts#getHeight" }
  }
}
```

Keep the meaningful `nodeConfig`, component-slot and layout groups. Icons/component loading use the
existing component-target grammar; component and function targets stay pack-root-relative. Layout
callbacks remain code and get checked named exports, not computed JSON results. Preserve all existing
flags, connection counts (including -1 for unlimited), colors, prefixes and loading modes.

Deleting the frontend modules removes the last useful directory anchor for frontend-only steps. State
step type modules explicitly in `types`, and custom flow-helper modules in `dsl.helpers` (a whole-module
export-star contribution). Remove `dsl.custom`, executable-directory inference and all three conventional
file probes. No dummy executable facet to locate types, no extra type aliases/shapes, no dual reads.
Migrate every pack, fixture, scaffold, source/module/freshness reader and public schema/API/doc in the
same checkpoint. Preserve generated EARS and compiled content bytes. A typed helper missing its declared
source is an error, never an empty union or invented typing.

Execute checkpoint 2 in two source checkpoints, before any palette consumer migration:

- **2A:** authored frontend data and binding generation, explicit type/helper sources, checked installed
  frontend bindings, and removal of `StepFEFacet.loadComponents` plus its host execution path. Components
  are bound directly, with declared lazy wrappers. Retire factory-only tests; retain atomic refusal and
  incumbent-resource coverage through real ownership/binding failures. Exercise a real external build,
  source-free inspection, declared callback/component failures, layouts and default/runtime parity.
- **2B:** native step declaration/admission and shared catalog/window projections across native, installed
  and source owners. Audit and close the current unchecked native frontend composition path; test-only
  fixture composition may extract authored test data before binding, never synthesize production discovery
  from activation. Preserve explicit ownership/collision rules, data capture, eligibility and revisions.
  This work remains required in this goal; 2A does not claim native/full step discovery is complete.

Then execute checkpoint 3's live palette/style/default/layout reader migration, including ownership and
readiness for executable components/callbacks and removing permanent active-registry caches. Full trigger/
build metadata, all other contribution kinds, source execution/freshness, editor readiness, navigation,
boundaries and all Phase 6 workstreams remain required. Deferred activation/security/storage stays deferred.


### Frontend step checkpoint 2A outcome (2026-10-15)

`cda9fa00e` implements the authored contract above: inline frontend data, checked icon/component/layout
bindings, explicit step type/custom-helper modules and removal of frontend facet factories and directory
inference. All 15 declarations preserve previous static fields/loading modes/layout slots; all seven
baseline EARS/content files and the default-pack facade report are unchanged. Actual source-free external
inspection followed by supported host admission, lazy component/layout execution and unload passes.
Three guard mutations fail as intended and exact source is restored. Strict checkpoint and committed-source
strict validation pass; the owning goal records counts, runs and the corrected test-boundary failure.

Proceed to **2B**, not palette migration: declare/admit native steps and project them through the common
catalog/window inventory with source/installed ownership, captured metadata, eligibility and revision
semantics. Close unchecked native frontend admission before consumers depend on this projection. Then
execute checkpoint 3's live readers/cache removal. Full trigger/build metadata and every other remaining
goal workstream stay required; no phase is complete or archived here.


### Native step/catalog admission audit and execution order (2026-10-15)

At `cda9fa00e`, native declarations have no steps; frontend native checking consequently cannot compare
step metadata. Backend native admission checks data/settings/lifecycle but ignores steps. Both runtime
indexes use the generic last-wins/facet-folding owned store, allowing another pack to supply part of the
same step wire. Captured step tuples still retain the caller's mutable node/presentation objects. The
window catalog already owns immutable frames and caches projections per committed snapshot.

Use the existing `StepEntry` schema/type for native `steps` as for authored `extensions.steps`; no second
shape, executable inference or fake native build. Add a `StepCatalogEntry` per `(packId, type)` with the
complete declared value, origin and the same enablement/declaration/build identity rules as reference
entries. Native composition has no installed build identity. Disabled installed and unbuilt source
entries remain discoverable. The common projection and window reader must agree without imports.
Different inactive owners may declare the same wire: discovery reports both; execution never silently
folds one owner's data into another's implementation. Refuse conflicting active runtime owners before
publishing a candidate, including replacement. Copy node/default/presentation/slot/layout data at
admission while preserving executable component/function identities; later caller mutations cannot
alter accepted metadata or collection membership. Reuse backend step-binding validation for native
composition, including exact node data and facet/handler/flag membership.

Complete checkpoint 2B through these dependent source checkpoints, with no palette migration between:

1. **2B.1 — Native step data and common projection:** shared native step grammar, backend/native frontend
   step comparisons where declarations are admitted, source/installed/native catalog and window projection,
   captured step data and active owner collision checks. Migrate authored native fixtures rather than add
   missing-data defaults to production. Prove declaration-only discovery, disabled/unbuilt entries, stale
   window frames, callback nonexecution, atomic refusals and exact preserved typing/content.
2. **2B.2 — Complete frontend admission authority:** close the existing unknown-native-owner bypass.
   Audit all frontend registration fields before changing its API: native declarations also cannot yet
   represent artifact/block/DSL contributions or feature designations, while native test composition
   exercises them. Give supported native fields the existing shared declaration grammar before enforcing
   complete admission; do not drop those fields, exempt test owners, accept undeclared bindings, or invent
   installed identities for native tests. Pass accepted declarations explicitly or admit them independently
   before binding, retaining pre-settings validation and stale prepared-candidate rejection. Migrate the
   public test-shell composition and native fixture helpers with the production API. Preserve the
   supported installed loader path and remove redundant unchecked paths. Add accepted owner/revision
   binding information needed to match catalog entries to executable components in checkpoint 3.

Each checkpoint includes focused/mutation checks, reviewed schema/API/docs and strict validation before
committing. 2B.1 alone does not close native frontend admission or authorize switching consumers. 2B.2
remains required before checkpoint 3, alongside full trigger/build metadata and all other outstanding goal
workstreams. This ordering exposes the dependency on the rest of the native frontend grammar instead of
hiding it behind optional validation. There are no compatibility aliases, inferred production declarations,
new activation modes or changes to deferred isolation/storage requirements.

The 2B.1 parity test additionally reproduces Zod record decoding dropping an own `__proto__` key from
opaque JSON defaults. Native admission retained the original data while source/snapshot decoding lost
that key. Validate and clone JSON default objects without record decoding for both node and settings
defaults, retaining the existing `Record<string, unknown>` types. Keep the generated JSON Schema's object
shape explicit and test all three declaration origins; this is data preservation, not format conversion.

The final native admission review also reproduced structured cloning normalizing a class-valued default
before schema validation. Validate native declaration JSON purity before any copy: reject accessors without
invoking them, foreign prototypes and other non-JSON values, preserving the prior catalog on refusal.
Check the separately declared trigger registration slot in the shared backend step validator too; full
trigger/build metadata migration remains required and is not replaced by this slot-membership check.


### Native step checkpoint 2B.1 outcome (2026-10-15)

`fdd967ec5` implements the native step grammar and common catalog/window projection above. Data capture,
active ownership and backend/native frontend step comparisons are covered. JSON defaults preserve own
keys across all origins; native and binding data are checked before copying, and declared trigger
registration slots are checked without invocation. Native fixture composition supplies existing node data,
never a production default. Eight mutations fail as intended; all seven baseline EARS/content files and
facade types are unchanged. Strict and committed-source strict validation pass; the owning goal records
counts, reproductions, source commits and runs.

Continue **2B.2** before palette migration. All supported native frontend fields need declarations before
complete enforcement: artifact/block/DSL contributions and feature designations remain absent alongside
the unknown-native-owner bypass. Make accepted declaration authority mandatory for binding operations;
use one explicit tagged native-declaration or backend-loaded-pack input, rather than optional checking or
a special test-owner exemption. Native test composition may build that input before registration through
clearly named fixture operations; its object must still satisfy the production registry interface when
passed to the loader/shell. Provide valid machine/component fixtures, not casts hiding invalid bindings.

Share browser-safe declaration schemas before enforcing native frontend semantics; do not import the
Node build pipeline into the renderer or duplicate its grammar. Keep declaration origin separate from
frontend delivery: a verified installed declaration may be served through the checkout's dev frontend
map. Do not infer its authority/origin from that delivery choice. Preserve validation before settings
access, capture-before-check semantics, stale prepared-candidate checks and accepted owner/revision data
needed to match catalog rows to executable components. All other goal work and deferred-work decisions
remain intact; 2B.1 does not close 2B or discovery.

#### Browser-safe native admission foundation (2B.2)

The current canonical Zod grammar is pure, but its build-directory placement hides that fact and the
`/build` barrel loads Node tooling. Move that grammar and its pure dependency/check-policy parsers into
`framework`, retaining the existing public build exports for their build consumers. Native artifact,
block, DSL and feature-designation fields use the same constituent schemas and inferred types as authored
manifests. Expose a small native-declaration problem checker through `/framework`, including JSON purity
before decoding/copying. The host catalog and frontend admission must use that checker; browser bundling
proves it reaches no Node tooling or authored pack modules. This is a foundation checkpoint within 2B.2,
not closure of its mandatory registration-authority and binding-identity work.

The subsequent mandatory-admission change also owns the capture gap: current frontend snapshots copy
references, editor groups and steps, but retain mutable surface metadata/routes, artifact/block facet
containers, DSL globals and form/extension slot maps. Capture those containers before comparison while
preserving actual machine/component/function identities. Route maps need accepted declaration context;
a component object must not be guessed to be a route map. Validate in the loader before allocating settings,
and make registry preparation retire provisional host settings on every failure, including declaration or
capture refusal. Tests must mutate each accepted container and prove both retained lookup behavior and
candidate cleanup. This closes the gap rather than merely adding a required argument to unchecked state.


#### Browser-safe foundation outcome (2026-10-15)

`92b2804ae` implements the shared grammar/checker foundation above. Native artifacts, blocks, DSL and
feature designations use authored schemas; native catalog/frontend checks share the browser-safe checker.
A public-framework browser bundle contains neither build tooling nor authored pack modules and executes
its admission checks. JSON purity precedes copying, including the native registry constructor. Public
reports are reviewed; authored schema semantics, EARS/content and facade output are unchanged. Three
mutations, focused checks, strict and committed-source strict pass; the goal records runs and counts.

Next implement the rest of 2B.2 as one coherent admission change: mandatory native/loaded authority,
complete declaration-directed container capture, failure cleanup, valid native fixtures/public shell,
and accepted binding owner/revision data. Do not switch palette readers while optional native-owner
checking still permits unknown registrations. All other discovery and goal acceptance criteria remain.


#### Required admission identity correction (2026-10-15)

The 2B.2 audit reproduced the loader retaining its caller's mutable `LoadedPackEntry` across module
and stylesheet awaits. Changing only runtime/build identities while delivery was pending let old code
claim the new identities; changing declaration metadata instead refused the originally valid binding.
Pin the entry's scalar fields and own its JSON declaration data before asynchronous delivery. Retain
attempt/cancellation handling around this capture; invalid candidates must supersede older attempts
without retiring accepted resources. Source delivery remains independent of declaration authority.
This closes the frontend admission race; complete compiler input/implementation identity and frozen
execution requirements elsewhere in this plan remain required.


The concurrent read-only own-key audit in
[manifest consolidation](../../plans/manifest-consolidation.md#required-own-key-preservation-correction-2026-10-15)
reproduced `__proto__` entity declarations disappearing during schema decoding. Source `29f0cc556`
closes that preservation gap across authored/native parsing, snapshots, generated bindings and real
source-free installed inspection/loading. The linked outcome and owning goal record its evidence.
The complete remaining discovery/compiler/navigation/boundary/Phase 6 scope stays required.


#### Mandatory admission outcome (2026-10-15)

`e5dcdec63` completes 2B.2: mandatory native/loaded declaration authority, full preparation capture and
cleanup, valid public native test composition, and accepted step binding rows. Identity checks precede
settings binding; JSON checks precede declarative reads/copies. Capture itself is guarded against registry
reentry. Metadata containers are owned while executable identities remain intact. Native bindings have
no installed stamps; backend stamps remain backend identities through development frontend delivery.
The loader pins its entry/declarations before awaits. Getter, cleanup, async identity and reentry
reproductions and ten guard mutations pass; strict and committed-source strict pass. The goal records
source, counts and runs. Public frontend testing has its own host entry, avoiding private test imports
and backend build tooling in the renderer.

The keyed-declaration correction is now committed in `29f0cc556`. Next switch live readers in
checkpoint 3 and remove active-only caches, then finish the full remaining kind/content/asset,
compiler/freshness/scope-cost, native/editor, navigation, boundary and Phase 6 work. 2B.2 does not replace
those acceptance criteria or final committed-source strict `--all` validation.


### Live step reader implementation (2026-10-15)

Checkpoint 3 reads declared node/presentation/layout data from the common catalog. A unique native or
installed owner takes precedence over authoring-source previews; ambiguous runtime owners yield no
selected contribution. Metadata remains readable when disabled or disconnected. Executable frontend
bindings require a ready catalog, enabled runtime owner, matching pack/type and accepted declaration
and build identities. Native entries have no fabricated stamps and must match captured declaration data.
Reading or subscribing never loads a component, evaluates layout or starts a provider.

The SDK owns these selection/readiness rules. A scoped reactive step reader observes catalog and
frontend publications independently and releases both subscriptions. UI node-style helpers keep their
imperative reads fresh; a scoped composable supplies the same helpers to Vue consumers with reactive
catalog tracking. Remove permanent node/color caches and the nodeConfigs proxy rather than add an
invalidation protocol. Palette/menu defaults are computed, and open nodes/forms refresh on publication.
Retain unavailable metadata with disabled creation and a host fallback icon/component; custom code
requires current eligible bindings. Static layout flags come from declarations, callable layout from the
eligible binding. Do not remove actual backend/runtime execution lookups in this frontend reader change.

Prove native/source/installed parity, duplicate owners, source-preview precedence, every readiness and
identity refusal, source-free/poisoned executable metadata, replacement/unload/re-enable, and scoped
subscription cleanup. Exercise mounted consumers, real external authoring and app paths; preserve
ordinary node creation, EARS types and compiled-content baselines. Backend creation defaults, obsolete frontend step lookup removal and full trigger/build metadata remain
required subsequent work. This frontend checkpoint is 3A, not completion of checkpoint 3 or the goal.


Mounted pack-component checks belong to the pack's suite. Its frontend project compiles Vue in jsdom
without the backend harness; ordinary specs keep Node and SFC stubs. Both resolve published packages.
Use workspace-qualified project names (`<workspace>:backend` / `:frontend`); the duration reporter
attributes those only when the root package.json confirms ownership. Unrelated names retain their
refusal, and collection/input guards remain intact. Do not place these specs in the renderer or broaden
its dependency inputs to accommodate private pack-source imports.


#### Live frontend step reader outcome (2026-10-15)

Source `76df2f0e5` completes frontend reader checkpoint **3A**. SDK selection returns one unambiguous
runtime owner ahead of source previews. Disabled/disconnected metadata remains readable; bindings
require matching owner, declared data and accepted identities. Native data equality has no fabricated
stamps. The scoped reader observes both publication sources and releases both subscriptions.

Node styles, palettes, menus, node/form selection, frontend creation defaults and brain presentation now
use declarations and eligible bindings. Permanent node/color caches and both contribution proxies are
removed. Static layout flags survive unavailable code; retained descriptors cannot invoke retired or
replaced callbacks. Ordinary EARS/content baselines and facade are unchanged. Mounted pack-owned
Vue checks, full backend/frontend pack tests, five guard mutations, real installed step disable/re-enable,
API reports and strict/committed-source strict all pass; the owning goal records counts and runs.

Next complete **3B**: audit/migrate backend creation defaults through committed declarations and actual
provider eligibility, and retire the now test-only frontend `stepRegistry.getFE/getComponent/getFormComponent`
methods through the checked frontend API. Audit the remaining shared active-registry paths before
removing them; preserve genuine runtime/compiler execution. Full trigger/build metadata, remaining
contribution kinds/content/assets, exact compiler/input/frozen-publication and freshness work, native/editor
lifecycle, navigation, boundaries and all Phase 6 workstreams stay required. No phase or goal is archived.


### Backend step reader design, checkpoint 3B (2026-10-15)

Expose declaration rows and captured accepted backend bindings as separate read-only ports on the
backend registry. Share pure owner selection with the frontend. Defaults and node labels read only
committed declarations, including unavailable providers; reading them activates nothing. New node
creation requires a matching active backend owner before relation handling, trigger validation or writes.
Capture declaration data and accepted identities during admission, before user binding callbacks, and
retain those rows through existing atomic replacement/retirement. Do not reconstruct accepted metadata
from changed origin objects or disk.

Source execution in the harness is intentional: it has an accepted declaration revision and actual
runtime generation, without an installed build receipt. Compiled dependency declarations can likewise
lack a build receipt in this harness. Match optional build identities exactly; do not invent installed
stamps. Native bindings use their actual runtime generation and captured declarations, with no installed
version/build metadata. Unavailable/foreign/stale bindings cannot authorize a new write.

Make `stepRegistry` backend-only, remove unused frontend facet/component methods and migrate their
tests to frontend binding APIs. Preserve actual active runtime/build lookups for in-flight work and
compiler execution; they are not metadata discovery. Test stand-ins declare metadata explicitly rather
than deriving declarations from execution maps. Prove no provider invocation during reads, data survives
unload, replaced/disabled/foreign owners refuse creation without writes, valid source/native/installed
paths work, and normal defaults/validation/relations remain intact. Keep the full remaining discovery,
compiler, navigation, boundary and Phase 6 scope active.


### Backend step reader outcome, checkpoint 3B (2026-10-15)

Implemented in `71fad4013`: backend metadata/defaults use the catalog, while new writes require a
current accepted backend generation. Raw execution/retirement keeps its own lifetime. Backend and
frontend ports are separate; each registry stores accepted binding rows once, with exclusive ownership.
Accepted origin/declaration/relation/query-field data is captured before callers can mutate it. Test
stand-ins author metadata explicitly. The installed fixture proves backend-confirmed defaults and
continues to follow disable/re-enable.

Strict validation passes all 30 steps, run `2026-10-15T18-05-11Z-9023`; committed-source strict passes
again, run `2026-10-15T18-11-45Z-25483`. Full counts, corrected fixture assumptions, guard mutations and
logs are recorded in the owning goal's checkpoint 3B entry. Seven EARS/content baselines stay identical.

Next finish full trigger/build metadata, then remaining contribution/content/asset readers and their
binding/freshness rules. Compiler closure/frozen publication, source watch/manual-build/drive freshness,
native/editor lifecycle and the goal's navigation, frontend boundaries and three Phase 6 workstreams
remain required. This reader checkpoint does not complete discovery or authorize archiving the plan.

### Complete backend facet declarations, checkpoint 3C design (2026-10-15)

The remaining step gap is in `build` and `trigger`: object-export references hide relation metadata,
trigger track fields/persistence/query fields and optional callback membership. Flow helper codegen
currently regex-scans the trigger implementation for `trackField`; a valid aliased/computed implementation
can silently lose its helper. Discovery cannot use that source scan, particularly in installed builds.

Keep both semantic groups, but declare their data and callable references directly:

```json
{
  "build": {
    "compile": "src/steps/action/build.ts#compile",
    "validate": "src/steps/action/build.ts#validate",
    "getLabel": "src/steps/action/build.ts#getLabel",
    "decompile": "src/steps/action/build.ts#decompile",
    "relation": { "field": "actionId", "targetEntity": "Action" }
  },
  "trigger": {
    "trackField": "schedule",
    "persistent": true,
    "queryFields": ["cronExpression"],
    "compile": "src/steps/schedule/build.ts#compile",
    "decompile": "src/steps/schedule/build.ts#decompile",
    "validateTrack": "src/steps/schedule/build.ts#validateTrack",
    "validate": "src/steps/schedule/build.ts#validate",
    "register": "src/steps/schedule/register.ts#register"
  }
}
```

These illustrate alternative step/trigger entries, not one entry containing both. Build compile,
validate and getLabel remain required when build is present; decompile/branches are optional. Trigger
trackField, compile and decompile are required; persistence/query fields and validation/register are
optional. Preserve callback signatures, semantics and actual registration order. Register stays lazy
and backend-only; compiler callbacks stay out of frontend bundles. Native runtime definitions retain
the same semantic groups and use their separately admitted declarations.

Use one projection of each declared group's data and callbacks for source targets, generation and
binding validation. Build checks every callback export as a function; generated typings check signatures.
Host admission compares data and exact callable membership before publication, including native packs.
Flow helpers read declared trackField directly. No source scans, duplicate capability booleans, runtime
metadata fallbacks, aliases or old object-facet reads. Preserve unrelated module objects and their
meaningful metadata rather than imposing blanket export flattening.

Migrate authored packs, native fixtures, scaffolds, all readers, public docs and schema/API reports in
this checkpoint. Prove optional callback refusals, track-field helpers independent of implementation
source spelling, source-free/offline CLI declarations and actual external authoring/runtime behavior.
Preserve all generated EARS/content baselines. Mutation-check guards and run strict checkpoint validation
before committing. Remaining contribution kinds, compiler/freshness and later goal phases stay required.


Checkpoint 3C reader audit: graph edge classification and relation-field selection are declarative
editing policy, so they read catalog data even when a provider is unavailable. Brain trigger queries,
flow persistence/completion and callback dispatch describe or execute a running flow; retain their
accepted active facets rather than substituting current catalog revisions into an execution lifetime.
Node updates are the next required write-boundary checkpoint before expanding discovery readers: creation
is guarded, while updates currently read active validation separately. Require an eligible, unchanged
binding when a declared validator must run; preserve data-only edits without callbacks and audit node-type
changes. Do not mistake discovery data for permission to execute or silently skip required validation.


Checkpoint 3C lands in `8ec5285ed`; the owning goal records focused, mutation, full strict and
committed-source evidence. Backend callback membership and data now use the declaration projection;
flow track helpers read metadata directly. Authored/native admission, scaffolds and offline inspection
are migrated. All seven EARS/content baselines are unchanged. Node-update write eligibility is next;
remaining kinds, compiler/freshness contracts and later goal phases remain required.


### Node-update write boundary, checkpoint 3D design (2026-10-15)

`updateNode` currently looks up a raw trigger independently of its declaration and skips validation
when that runtime is absent. It can also change `nodeType` while validating with the old type. Make
node type immutable through this operation (same-type full-node updates remain valid). Select the
current declaration and its relation field once; refuse unknown declarations rather than guess their
relation/validation policy. When the declaration includes a node validator, require a matching eligible
backend and recheck its generation/declaration after validation before any row or relation write.
Share that final check with creation. Edits with no declared validator retain their existing ability
to work without an active provider. Running-flow execution lifetimes are unaffected.

Prove this against actual registry admission/unload/replacement and changed declarations, not only
mutable test maps. Invalid validation, missing/stale providers, provider replacement/retirement during
validation and attempted type changes must leave both the node and its relations unchanged. Same-type
updates must still validate successfully. Preserve source-free relation editing without compiler
activation. Mutation-check the write guards; run required strict validation before committing.


Checkpoint 3D lands in `f7d63434c`; the goal records actual-registry, mutation, strict and committed-source
evidence. Creation and updates share their accepted-provider recheck. Declared validation cannot disappear
when execution is unavailable; node type stays fixed. Known declarations without validation still permit
relation/field edits without an active provider. The watch-publication fixture now owns setup/cleanup in
Vitest hooks; a forced test timeout proves the next test remains isolated without raising timeout limits.

### Required content-based source freshness correction (2026-10-15)

The 3D validation sequence exposed disagreement between the chain and app preparation after source
restoration. Run `2026-10-15T19-40-18Z-57807` reports the shipped build cached, then
`staleBuildOutput(defaultSetup)` refuses `query.ts`. A manual rebuild repairs the disagreement.
Evidence: `/private/tmp/apack-node-update-stable-strict.log` and
`/private/tmp/apack-node-update-restored-pack-build.log`.

**Current-code audit corrects the initial diagnosis.** The chain already compares both input identity
and every output digest: `unitStaleReason` in `packages-built.ts:815` calls `outputDigests`. It must not
gain another output-hash mechanism. The inconsistent reader is `packs/layout.ts` `staleBuildOutput`:
it compares the newest source mtime with the oldest built entry/snapshot mtime. Restoring unchanged
bytes can therefore refuse a content-current build. The initial producer-cache diagnosis in the 3D
evidence was provisional and wrong; no producer-cache defect is established by that failure alone.

The existing integrity receipt proves published output bytes. It does **not** record complete authored
source/compiler inputs. `build.ts` captures `packInputsHash` and `captureCompilationInputs` for its
publication checks; the snapshot does not persist them as a whole-build source-freshness contract.
Private phase-cache records cover particular reused phases, not this missing contract. Do not pretend
an existing complete source receipt is available, or read a private phase cache as the build's authority.

Fold this correction into the required compiler/input-closure and publication work:

1. Complete the existing source/compiler/dependency input-identity audit before settling the produced
   receipt. Reuse shared input traversal and captured compilation knowledge; no second authored
   inventory, directory guess or reader-specific scanner. Account for external linked inputs, build
   options, actual compiler execution identity and coherent frozen publication, not only pack-root bytes.
2. Publish the successful build's input identity with its owned output, atomically after all validation.
   Decide the common data contract and layer placement from the existing producer/consumer graph;
   the host must not import CLI internals. Failed builds retain the incumbent input/output association.
   The phase-cache association defect is now reproduced and repaired in the checkpoint below:
   a failed placement followed by a retry previously reused stale facade types. Cache metadata is
   staged, sealed and replaced with its output. Keep that verified association when implementing the
   whole-build receipt; the private phase cache is not the missing source-freshness authority.
3. Replace `staleBuildOutput`'s mtime gate and the pack side of drive-preflight's mtime guidance with
   that common current-input/output authority. Audit archive, prebuilt testing, default-fork preparation,
   direct/manual builds, watch and drive. Define which supplied compilation context each source consumer
   compares; installed/offline discovery must still verify builds without authored files or a compiler.
4. Prove a timestamp-only touch and edit followed by exact byte restoration remain current; actual
   same-mtime byte edits, added/removed or linked inputs and relevant tool/dependency/option changes
   invalidate current-source reuse. Changed/missing output still refuses through existing verification.
   Include an actual cached-chain plus app-preparation reproduction, not only an isolated hash test.
5. Preserve unchanged deterministic output caching, explicit deliberately stale drive behavior and
   read-only inspection. No fallback conversion or consumer-triggered build/staging on discovery paths.

This is the next required source-freshness work before expanding more discovery readers. Do not
replace the outstanding exact compiler/input/frozen-publication scope with a patch to timestamp
comparison. All remaining contribution kinds and later goal phases stay required.


#### Authored scope prerequisite: keep run output under `.apack`

Current `packInputFiles` hashes arbitrary authored paths and excludes the pack's `.apack` work directory.
The testing helpers instead write Playwright results, screenshots and driving reports into `tests/` and
`drive/`, so persisting the current authored hash would make a test stale its own source frame. Keep one
input policy: default generated pack-run output belongs under `.apack/tests` and `.apack/drive`, while
scripts/configuration remain authored. Move helper defaults, CLI driving outputs, scaffolds, fixture
output declarations and public guidance together; preserve explicit user output overrides. No aliases
or fallback reads of previous output directories. The root app E2E config delegates the same helper; chain output/failure-evidence declarations must follow that output path too.

Prove real helper-created output is excluded from `packInputsHash` and actual authored changes still
invalidate it, including linked sources. Test Playwright configuration and CLI scaffold/drive paths;
then run required strict validation. This prerequisite does not complete the receipt, exact compiler
identity, external-input closure, frozen publication or source-freshness consumer migrations above.


The authored/run-output prerequisite lands in `ecbb2c6af` (3E). Public helpers, scaffolds and CLI
outputs use the private work directory; actual screenshot/report IO and before/after full-app hashes
prove the default namespace does not invalidate authored inputs. The goal records restored mutations,
initial/full and final strict checks plus committed-source evidence. This closes output placement,
not the input receipt or compiler/frozen-publication contracts above.

The bundled-UI smoke uses targeted locator input for its render/model-edit purpose after a deterministic
focus interruption reproduced truncation from global key events. Eight traced successes showed no
editor replacement, which does not establish the original failure's cause. Keep a separate required
live-editor case that types across an actual accepted contribution replacement and verifies content,
focus, selection and pending marks. Do not treat locator-fill smoke as keyboard/recomposition evidence.

Producer/consumer audit to carry into the next checkpoint:

- `captureCompilationInputs` rehashes live implementation/package/compiler-module bytes and checks again
  before publication. `build-worker.ts` statically imports the compiler before that capture. Matching
  live filesystem hashes alone do not prove which bytes already-loaded code executed; account for actual
  compiler loading and long-lived frontend compiler lifetime before claiming exact execution identity.
- `packInputsHash` covers arbitrary authored paths, while `readCompilerModuleInputs` adds configuration,
  Vue scripts, outside imports and discovered npm scopes. Source-frame membership, options, dependency
  origin/content, directory additions and unresolved/resolution candidates need one coherent account.
  Do not freeze a partial observed-file list and silently miss later additions or newly winning paths.
- Existing integrity proves output membership/bytes; private phase caches are not the successful whole
  build's source record. Settle the shared produced data contract and layer placement, publish it with
  its output and migrate archive/prebuilt/default-fork/drive consumers together. Installed/offline reads
  still require neither authored source nor executable compiler activation.

All required compiler/input/frozen-publication, other contribution kinds and later phases remain active.


#### Shared authored input ownership

Before adding a produced source receipt, move the existing traversal and hash implementation into
`@apackdev/host/build/pack-inputs`. The host is already shared by CLI producers, source-build consumers
and testing; a compiler-independent reader must not import CLI internals. Migrate every CLI caller and
move the behavior tests with the implementation. Keep the same authored exclusions, linked traversal
and deterministic content identity; no wrapper or second scanner. Exercise timestamp-only edits,
same-mtime byte changes and file membership so this shared primitive has the required source semantics.
This establishes layer ownership only: complete compiler/input capture, coherent execution, the produced
receipt and all freshness-reader migrations remain required before replacing the mtime gate.


Input-scope profiling before publication (2026-10-15): the shared-layer move remains an uncommitted
candidate while strict integration validation fails timing/watcher assertions. All 48 cases from the
eight failing files pass with one worker; a whole diagnostic integration run also passes, but subsequent
strict runs still fail. Do not attribute all of this to the other worktree or keep retrying the full
suite. The goal records exact runs and failure evidence. A real three-build CPU profile attributes
7.513s to npm input hashing and 2.815s to TypeScript module input discovery. One minimal pack's current
npm scope visits 14,316 files / 229,646,040 bytes, including Octokit release types, LMDB and test tooling.
Use this evidence in the required exact compiler/scope-cost audit. Preserve actual compilation and
package-resolution coverage while removing irrelevant work; no timestamp/global cache, reduced
assertions or larger deadlines as a substitute. `chain --cores` is scheduling admission, not a lower
Vitest worker cap. Complete compiler capture/publication and the shared receipt before switching
freshness readers; the other contribution kinds and later goal phases remain required.


Validation correction before accepting the shared-input move: a prototype deriving compiler package
requests from a fresh esbuild graph was measured, then discarded. Its small improvement did not justify
new selection logic that still needed implicit metadata/read coverage. Keep the conservative input policy
while completing the required coherent source/compiler design. Do not mistake this rejected prototype
for a landed closure or receipt.

The inspected validation defect is separate: `chain --cores` sized scheduler weights without forwarding
that budget to Vitest. The pool still used the whole machine's configured worker count. Forward the
existing budget through the private chain handoff, derive pool limits from `coresFor`, pass both pool
maximums and minimums explicitly, and include actual worker configuration in both cache layers and
measurement guidance. Standalone pool configuration remains its own default. Verify with Vitest's actual
argument parser, malformed handoff cases, cache identity changes and a real strict run observing worker
counts. Preserve all input coverage, tests, assertions and deadlines. This fixes budget enforcement;
exact compiler capture, input closure, coherent publication and source-freshness consumers remain required.


#### Shared authored scope outcome — checkpoint 3F

`882d2a50b` moves the authored traversal, content hash and link watches unchanged into host build
utilities, migrates every CLI caller and moves its behavior tests. The same-mtime case uses equal-sized
changed bytes. The tooling-only export is explicitly excluded from the pack runtime bridge. No second
scanner or compatibility wrapper. All seven generated EARS/content baselines remain unchanged.

The validation prerequisite lands separately in `2f8b6f4ba`: the existing chain budget reaches actual
Vitest worker limits, including minimums, and both cache layers and measurement guidance retain the
actual configuration. It caps existing widths rather than treating the budget as a hypothetical machine.
A source mutation removing worker flags is caught; 196 focused pipeline checks pass. The final strict
run passes all 741 integration cases with three actual workers in 496.85s; the whole chain passes in
712.9s (22/30 cached). Committed source passes strict again in 1.1s (29/30 cached). The goal records paths
and earlier failures. No input coverage, assertions, test/hook/watcher deadlines or aggregate deadlines
were reduced or relaxed.

The preceding validation hold is resolved. Keep the measured scan-cost problem open: the conservative
scope remains intact. The rejected static-graph prototype also revealed that general CLI utilities pull
app-release code into today's compiler graph, so excluding Octokit merely as “release-only” would omit
an actual current import. Implicit shared-package metadata reads also need coverage before narrowing
package scopes. The prototype is absent from committed source.

The next freshness-reader switch must deliver the complete source/compiler input and publication
contract before changing freshness readers. It must account for capture before compiler loading,
long-lived compilers, options/dependencies, outside inputs, missing/resolution candidates and namespaces,
coherent execution, atomic input/output association and passive source consumers. Installed/offline
inspection still verifies output without authored source or executable compiler activation. Existing
integrity and private phase caches remain separate proofs; neither is the missing whole-build source
receipt. Every later contribution kind and goal phase remains required.

Compiler capture below is an independently validated prerequisite checkpoint. Committing it does not
authorize a partial source receipt or freshness-reader migration.

A local APFS probe (`/private/tmp/apack-filesystem-generation-probe.log`) observed a transient replacement
read returning different bytes, followed by exact original inode/bytes/mtime restoration; ctime changed
for both a file and a symlink. This only informs research into active-build guards. It does not establish
a portable frozen view or justify a timestamp cache or timestamp-based source freshness. Any selected
coherence design still needs its own actual compiler/publication proof.

#### Compiler installation capture candidate (2026-10-15)

The next input/publication checkpoint now has a concrete compiler boundary under implementation.
`readPackageInputs` in host owns one normalized graph: raw package metadata, resolved dependency
edges and lookup paths, file content, executable bits, physical link targets and directory membership.
Root contents are explicit; source-pack roots retain their separate authored scope. Compiler capture
copies the bytes supplied by that reader, mirrors physical paths, restores package/file links and
verifies the private graph before ordinary Node startup. No executable package import is needed for
capture or verification. Each invocation owns its temporary copy; worktrees share neither this copy
nor their package builds. Global dependency lookups are rebound to captured copies.

Public builds, initial/watched builds and release verification select this distributable compiler after
refreshing the relevant checkouts. Owned workers bypass project hand-off: that selection already
happened before capture. Cleanup follows child close, including abort errors, so an early error does
not remove compiler files while its child is still exiting. Internal compiler tests remain in-process.

This candidate is not yet a validated source checkpoint or the complete source-freshness contract.
Focused copy/execution and one real public build pass; strict validation remains to run. The measured
initial capture is 5.341s for 292 packages / 12,315 files; graph-only capture is 2.822s. Evidence:
`/private/tmp/apack-compiler-installation-{profile,worker,focused}.log`. Keep these as observations,
not performance thresholds. Do not replace the conservative closure with the rejected static graph.

Required next work remains: complete frozen pack/external/compiler input execution (including ambient
Node loader/preload options and long-lived frontend compiler lifetime), atomic whole-build input/output
association, passive freshness authority and every consumer migration above. Preserve manual builds,
unchanged deterministic phase caching and deliberate stale-drive behavior. Installed/offline discovery
continues to require neither source files nor a compiler. A compiler copy alone does not complete any
of those requirements or authorize the mtime reader switch.

Compiler path identity correction during review: the first strict candidate run was stopped after
confirming that TypeScript's standard-library input names included the random captured directory.
Passing type/schema/lint/build legs from that interrupted run are not a full pass. Private worker
handoff now carries captured-to-source path mappings; module identity/sorting, diagnostic reads and
frontend subscriptions use source origins while reads still consume captured bytes. Different live
and captured bytes claiming one origin refuse. Disabling either normalization or that conflict guard
is caught by its behavior test. A real pair of public builds now keeps its facade cache stamp and
complete output revision; the second reports actual facade reuse.
`/private/tmp/apack-compiler-repeat-build.log` and
`/private/tmp/apack-compiler-mutation-origin-{identity,conflict}.log`.

Persistent tsx transforms are disabled in the private worker so a captured transformer does not reuse
another installation's transform cache. Ambient execution overrides and the full pack/frontend frame
remain part of the required input audit above; origin normalization is not that complete contract.


#### Compiler session correction after strict feedback (2026-10-15)

The restored strict candidate (`2026-10-15T23-44-12Z-95602`) failed seven watched-rebuild cases in four
files; 735 integration cases passed. It is not a passing checkpoint. The source stayed fixed during the
run. Its default-pack output-change warning also remains part of the required common freshness work;
no mtime-only consumer fix is substituted here.

A worker CPU profile attributes about 4.945s to repeated package scans; separate capture profiling
shows the cost of repeatedly materializing and deleting the compiler tree. A controlled JavaScript/native
path-resolution comparison finds no meaningful warm improvement; that experiment is removed.
Evidence: `/private/tmp/apack-private-worker-profile.log`, its CPU profiles, and
`/private/tmp/apack-package-input-path-comparison.log`.

The implementation now scopes one compiler installation to `createPackBuilder(root)`. Before reuse it
checks original inputs and the copied graph against the captured identity. Each build still starts a
fresh process. Read-only compiler inputs and private metadata bind the worker to the selected CLI;
its immutable fingerprint replaces redundant live rescans of those copied packages. Live pack and
outside-module inputs keep their publication checks. A single public build closes its builder, while
a watcher closes it after aborting/draining active work and observers. No global cache, timestamp cache,
input-scope reduction, timing-assertion change or compatibility path is introduced.

The two isolated module-watch cases improve from 40.444s / 48.322s to 27.453s / 32.984s, with unchanged
20s publication and 60s test deadlines. The remaining failing watch scenarios and strict checkpoint
validation are still pending. These measurements are evidence, not gates.

The scoped-builder candidate passes all 13 watched cases with one and three workers, while retaining
the existing publication/test deadlines. Real process checks also cover source/private worker refusal,
changed compiler input refresh, damaged copy repair, shutdown ordering and public watch signal cleanup.
The worker's private metadata binds its actual CLI to the captured graph before compiler import; only
that verified, read-only compiler scope uses the captured fingerprint. Live pack/outside scopes are
still re-read. No optional private worker path bypasses captured input ownership. In-process compiler
unit paths remain distinct from that public producer. Strict validation and the complete source frame,
whole-build receipt and consumer migrations remain required.


The complete candidate strict gate still fails: run `2026-10-16T00-57-18Z-53171` reaches the external
contract watch test's 60s limit and the integration pool's 600s aggregate budget. Do not treat earlier
focused passes as full acceptance. The contract fixture's frontend is necessary to its generated
contract assertion and remains unchanged. A measured traversal optimization now carries resolved
directory paths into ordinary file identities, resolving file symlinks explicitly; all normalized
fields and the hash match the previous scanner across 292 compiler packages. Warm scans improve
from about 1.0s to 0.67s, without input-scope or deadline changes. Nineteen graph tests and 28 compiler
capture/module/worker/builder tests pass; warm watch and strict acceptance remain pending. The goal
records exact evidence, including failed experiments. Whole-build source/compiler coherence, receipt
publication and every freshness consumer migration above remain required.


Compiler disposal is asynchronous and awaited throughout ownership, including failed capture and
replacement; the factory and all callers use that promise. Focused public/private worker checks pass
with the existing shutdown/cleanup deadlines. Full strict validation remains required. The required
build-session audit must also cover cancellation during startup and one-shot commands: ready-watch
signal coverage is not proof of those lifetimes. Complete that ownership with the full input frame and
publication contract before migrating freshness consumers, rather than claiming every termination
path is covered by the retained-watcher check. All later goal scope remains active.


Watch validation now distinguishes IPC exit from retained-tree cleanup. Signal tracing proves prompt
receipt and complete deletion before the public process re-raises its signal; that filesystem wait
uses 20s, while IPC-only waits remain 2s and whole tests remain 60s. CSS startup/teardown are fixture
hooks, retaining the complete transition/assertion sequence and 20s publication limits. A forced body
timeout proves compiler cleanup finishes before fixture deletion; normal concurrent checks pass.
These validation corrections do not establish startup/one-shot signal ownership, complete frozen
inputs or the whole-build receipt. The goal retains those requirements and exact failed/passing evidence.


Public watch cancellation now owns startup as well as readiness: signal handlers precede startup,
abort closes the initial builder, and shutdown waits for cleanup before re-raising the signal.
A real-process regression covers both phases; restoring late handler registration leaks the compiler
and fails that check. This does not cover one-shot/dev startup or close the remaining complete input
frame/publication/freshness work. The goal records diagnostic passes and the unresolved strict gate.


### Flow-reference projection (2026-10-16)

`7196d61d3` implements declarative `dsl.references` fields and a build-time projection into each
content-index entry. Readers consume serialized references without loading step callbacks or source
modules. Literal targets are resolved against compiled item identities; computed targets remain
explicitly dynamic. Missing targets support rename/removal review without conflating inventory with
runtime data. An omitted analyzer is unavailable, an empty result means no known references, and
neither claims exhaustive runtime analysis. Existing validation and compiled record hashes are preserved.

The owning goal records 86 focused cases, types/schema/API/import/lint checks, and the real shipped
build with 76 indexed flow edges. The remaining inventory reader and navigation audit are next; all-kind/final discovery acceptance and the outstanding strict gate remain open.


### Declaration-driven app navigation (2026-10-16)

`cfcbb53f9` projects enabled installed/native surface declarations into toolbar/menu data before runtime
loading. Catalog order is stable across frontend delivery; host tabs follow pack tabs in each pinned
or unpinned group, and directional keyboard selection uses that same order. Visibility uses user
choices over declared defaults. Current eligible bindings supply icons; missing bindings use the
shell placeholder. Source previews and disabled packs remain catalog metadata, not app destinations.
The renderer observes declaration and runtime updates without retaining a duplicate inventory.

Backend `surfaceDefaults` reads declarations, and the runtime registration's redundant `defaultVisible`
field/comparison/codegen are removed. Runtime surface storage remains for actual actors/components.
The goal records focused host/SDK checks, installed loader/codegen checks, the shipped build and pack
consumer proof, types/API/lint/import/tier checks. Final window and all-kind acceptance remain required.

Scope correction: the prior checkpoint handoff introduced JavaScript-body analysis beyond the
original requirement for static flow-to-action edges. Those edges are published. Pack-owned services
must not be hardcoded into an SDK analyzer; unsupported analysis remains explicitly unavailable.
Import preview's applier eligibility is execution planning, not a discovery fallback, and remains.
Continue service/repository/event/native/static-asset inspection and loader ownership; all later phases
and build-input/freshness acceptance remain active.


### Complete declaration inspection (2026-10-16)

`a13c4c6e4` replaces the CLI's selected inventory with the full validated manifest in JSON `declared`.
The prior projection silently omitted feature-owned services. Human inspection now includes owner
context for services, repositories, systems and reference identities, plus extension kinds,
lifecycle/migrations, entities/relations and content. Compiled output/inventory remains separately
verified; listing declarations imports no executable modules and requires no authored sources.

The owning goal records 13 focused offline/poisoned-runtime cases, CLI types and lint. Migrated
own-key/editor integration assertions retain their final real-build execution requirement. Complete
manifest printing is not native metadata parity, static event-contract extraction or all-kind binding
acceptance; continue that field-by-field audit and loader ownership, preserving all later goal phases.


### Native API declaration parity (2026-10-16)

`506582b94` records native service/repository targets and feature ownership in declaration data, with
native pack-level maps for APIs without feature owners. Discovery neither constructs the objects nor
calls methods. Metadata survives runtime unload; native/authored API bindings share name/ownership
validation. Schema admission rejects competing owners with both paths before activation. Native test
composition records fixture names before binding, and direct replacement fixtures declare changed
names explicitly. The goal records focused/source-free/retention/mutation evidence and repaired fixture
checks, plus types, schema/API, package builds and lint/import/tier checks.

Remaining native system/event contracts must account for the shell's non-toolbar inbox. Do not invent
a visual surface or infer executable behavior to fill that gap. Method-contract consumption belongs to
Phase 6; native content/migration data, static assets, loader coordination and all-kind acceptance
remain required alongside the full build-input/freshness and later goal scope.

### Static endpoint contracts (2026-10-17)

Source checkpoint: `774b0844c`, following the settled endpoint contract in `fe2c28146`.
The generator reads declared TypeScript incoming/outgoing and inbox contracts without executing their
modules. Generated event JSON feeds runtime entries, the build snapshot and the source harness.
Manifest routing additions remain explicit; private machine handlers do not become public inputs.
Installed snapshots refuse missing endpoint contracts. Native declarations supply the same data and
may leave declared systems unbound; the native shell inbox needs no contributed UI pane.

The catalog and CLI expose endpoint data independently of activation; an uncompiled source preview
reports unavailable metadata rather than an empty inbox. Backend admission checks event membership
and captures effective inputs/surface inboxes once, adding shared SDK protocol events. Mutating a
registration afterward cannot change accepted routing or machine identities. Host endpoint metadata
now lives in a data-only module. Event names do not validate payloads or authorize senders.

The external runtime check exposed a separate queue-ordering boundary: a pack can send a message
behind its own teardown request while the bus handles its caller. Actor cleanup completed, then the
inline completion callback unregistered the inbox before the already queued message was processed.
A failing two-test reproducer proved that ordering. The bus now queues `SYSTEMS_STOPPED` after actual
actor/subscription cleanup, allowing earlier sends to drain before the existing callback retires
runtime authority. No timer, extra request framework or suppressed diagnostic was added.

Focused evidence:

- Codegen/event/shape cases: 121 pass; snapshot cases: 41 pass; immutable event admission/replacement
  cases: 32 pass; window catalog cases: 20 pass; CLI offline/poisoned-runtime inspection: 16 pass.
- The initial SDK/host runs exposed stale synthetic fixtures, repaired in the owning tests. Shared
  catalog changes also require renderer/API consumer validation: limiting the initial focused checks
  to SDK/host missed those consumers. Renderer types and all nine native-editor cases pass.
- Five CLI/API fixture files pass all 35 cases after declaring their actual endpoint metadata. The
  handwritten dependent-runtime integration fixture now writes the same generated data a real
  author's codegen writes; all five cases pass in 27.3s. No runtime inference/fallback was added.
- All 110 bus/lifecycle cases pass. The exact real Electron disable/remove/replace/restore case
  passes in 14.2s against a rebuilt app. Before that repair the full external-pack run passed 26/27,
  including canonical reference navigation and real default-fork dev reload; do not call that a full
  passing run. Its evidence is `2026-10-17T00-15-59Z-21258`.
- Public schema/API reports and docs were regenerated/reviewed. Final CLI/testing types and lint pass
  after the last fixture repair. No protected typed EARS implementation or shape types changed.

Required strict gate attempt (before the final harness-fixture repair):
`npm run chain -- --strict --cores 4 --no-classify`, run
`2026-10-17T00-23-23Z-27374`, **failed**, 1,262.3s. All 5,168 host unit tests pass; pack tests pass
888 with two intentional skips. Types, lint, import/export/tier/schema/API checks, default-pack and
runtime builds, facade check, external authoring, smoke and both packaged-authoring halves pass.
Integration reported `ENOSPC` while writing captured inputs/build output and reached its existing
600-second aggregate limit. It also contains compiler/publication assertions and individual timeouts
that are not yet classified; disk exhaustion is not proof of every failure's cause. In particular,
retain the compiler exit-handler incumbent assertion and the original compiler/watch evidence for B6.
The dependent-runtime fixture failure was diagnosed and repaired afterward with the focused pass above.
The final full external-app step was not reached. No full strict pass, `--all` pass or whole-goal
completion is claimed. Earlier passing default-build output was later changed by the external fixture
producer; its cache invalidation remains build/publication acceptance evidence, not an endpoint fix.

Evidence is in `node_modules/.cache/apack-chain/runs/<run-id>/`; focused logs are under
`/private/tmp/apack-endpoint-*`. After the run, `df` reported 6.3GiB available on a 99%-full data volume.
Before another broad B6 run, establish disk capacity and diagnose exact retained failures; do not
increase deadlines, weaken assertions or sweep global temporary prefixes. No broad rerun was launched
after this resource failure. Native migration/content/backend-viewer parity and static-asset/readers
remain the next discovery implementation, followed by the preserved B1–B6 and Phase 6 workstreams.

### Native backend viewer parity (2026-10-17)

`be5a9344b` closes the native artifact/block admission bypass. Both native and built packs now use
`backendViewerBindingProblem` for exact identities, block kind, backend-facet presence/shape and
refusal of frontend facets in backend registrations. Checks run before settings authority or registry
publication. No new declaration grammar, runtime inventory or compatibility handling was introduced.
The native fixture composer now declares its artifact/block metadata. Backend lookup fixtures no
longer contain frontend components; existing real frontend registry lookup tests remain and pass.

Acceptance: 77 initial cases pass, then all 705 cases across 47 affected pack/loader/registry, frontend
lookup and SDK fixture-consumer files pass in 12.3s. Thirteen new native cases prove source-free metadata,
binding identity without executing callbacks, retained declarations after unload and atomic refusal.
Host/SDK types and lint pass; public signatures and schema are unchanged. Logs:
`/private/tmp/apack-native-viewer-{parity,consumers,lint}.log`.

The previous strict integration gate remains failed/incomplete; no broad rerun was made after its
resource failure. Next: native content/migration parity. Audit found explicit native applier execution
through `importCompiledContent` in registered-lookups tests, while automatic content/migration targets
currently derive from installed origins. Preserve that supported explicit operation and resolve the
runner distinction before introducing metadata that cannot execute. Static assets/readers, B1–B6,
all three Phase 6 workstreams and final committed-source strict `--all` remain required.

### Native content declarations (2026-10-17)

`2e1701fad` adds native `content.writers` and applier-only `content.sources` declarations. It reuses
shared authored field grammar, writer entity-ownership validation and exact backend operation binding
checks. Native composition describes its existing functions without importing target modules during
inspection. Explicit `importCompiledContent({ compiledDir })` continues to dispatch native appliers;
automatic application continues to target installed builds. Native paths/formats/datasets are refused
because this composition path does not compile them. No dummy build directory or compatibility path
was added. Fixtures now declare their actual entity owners and content names; invalid writers fail
before publishing any contribution or granting settings authority.

Evidence: 761 affected host pack/runtime and SDK framework cases pass in 14.0s; all 46 authored manifest
cases pass. Twelve native content cases prove absent-source discovery, explicit dispatch, callback
identity, no activation-time execution, cleanup/retained metadata, entity ownership and atomic refusal.
The first new ownership test used a non-JSON undefined property; correcting that fixture exposed the
intended ownership check. Host/SDK types, lint, package freshness/builds, reviewed SDK API generation
and authored schema check pass. An equivalent schema-field simplification has its own 12-case/SDK-type
pass. Public architecture docs and both affected API reports match the contract. No protected EARS
types or release metadata changed. Logs: `/private/tmp/apack-native-content-*`.

The previous full strict gate remains incomplete; no broad rerun followed its resource failure. Native
migration declarations/targeting are next: registration currently accepts migrations but automatic
runners enumerate installed origins. Resolve their identity/version semantics and checked functions
without silently ignoring native migrations. Static assets/readers, all-kind lifetime acceptance,
B1–B6, Phase 6 and final committed-source strict `--all` remain required.

### Native migration targeting (2026-10-17)

`f72cb8756` closes native migrations' unchecked-and-unexecuted path. Native declarations reuse the
existing `migrations.app` / `migrations.pack` grammar. App-line owners need no native version;
nonempty pack-line declarations require their own valid SemVer version. Both native and authored
bindings share exact target/description/callable checks before authority. Discovery imports no target
modules. Test composition accepts explicit native version metadata rather than inventing a version.

Admission captures owner version/dependencies and migration target/description/function membership.
Native and installed owners share dependency ordering before caller subsets and line-specific target
projection. Runner targets carry `packId`, callbacks and the pack cap where applicable, with no fabricated
manifest/directory or old-shape alias. Catalog updates and original registration mutation cannot change
accepted callbacks or advance their cap. Synthetic installed origins without accepted manifests now
refuse migration functions instead of silently accepting work no runner can see. Normal startup,
reset/import, activation and reload use the migrated target contract.

Two reproduced version-record bugs were repaired: a legal `constructor` pack ID read an inherited
function as a stored version, and SemVer build metadata caused the same migration to run twice. Stored
version lookup now checks owned keys; the shared comparator ignores build metadata for precedence while
records retain the complete declared version. Five direct comparator cases cover release/prerelease
ordering with build metadata. No real release metadata, migrations or production data was edited.

Acceptance: all 840 affected cases across 58 registry/loader/migration/startup-reset/schema/framework
and comparator files pass in 11.2s. Sixteen native cases cover discovery without modules, real startup
ordering, both caps, retry/recording, mixed native/installed dependencies, subset ordering, mutation
isolation, unload, fixture version metadata and atomic refusal. The initial run exposed a stale mock;
its repair briefly changed the separate content mock too. Both now derive parameter types from their
actual function signatures, and the unchanged content/reset assertions pass. Host/SDK types, lint,
package freshness/builds, reviewed three SDK API reports and unchanged authored schema check pass.
Logs: `/private/tmp/apack-native-migrations-*`, including the two failing reproducers and final acceptance.

The prior full strict integration gate remains incomplete; no broad rerun followed its resource failure.
Next: static-asset and remaining-reader audit, including whether native display names have a real
consumer, then all-kind acceptance. The app-line record remains global; disabled-owner catch-up is the
existing Phase 6 requirement, not solved by native targeting. B1–B6, all three Phase 6 workstreams and
final committed-source strict `--all` remain required.

## Required build entries and display metadata (2026-10-17)

Source `123efbd6f` removes `PackRegistration.name` and its generated assignment. No runtime reader
uses it: loaded-pack entries use `PackOrigin.name`, Packs UI uses manifest names and native panes use
feature labels. No native display-name field is introduced. The exact registration-field inventory,
SDK API report and misplaced adjacent settings comment are updated. All 36 generator cases, SDK
TypeScript, lint, local package builds and reviewed API generation pass:
`/private/tmp/apack-registration-name-{tests,types,lint,packages,api}.log`.
Default-setup entries regenerate and its Vue/TypeScript check passes:
`/private/tmp/apack-registration-name-default-{generate,types}.log`.

Source `b916d0e5e` closes a distinct output-completeness gap. `verifyPack` proves byte equality with the
producer's receipt, but sealing an already-incomplete file set previously accepted a missing backend
entry and missing frontend entries for declared contributions. The isolated filesystem regression run
reproduces ten such acceptances (backend and nine frontend cases); its initial reference fixture was
invalid and was corrected rather than counted as proof. Final coverage includes references too:
`/private/tmp/apack-required-entries-before.log`, `/private/tmp/apack-required-entries-after.log`.

Current-format build reading, source staging and installer admission now require `runtime/index.cjs`
and require `runtime/fe.js` for generated frontend memberships: feature surfaces/designations/forms/
references, group forms, steps, artifacts, blocks, editor groups and app extensions. Empty maps and
inline command/settings data do not require frontend code. Discovery reads declarations and receipt
membership without importing either poisoned runtime or missing authored files. Synthetic successful
build fixtures now supply frontend files; sealing helpers do not repair missing output automatically.
The foreign-format forwarding boundary remains opaque to the current CLI.

Acceptance:

- All 705 affected pack and CLI cases pass across 46 files (11.75s), including all 101 layout cases,
  missing-before-seal refusals, incumbent stage retention, source-free inspection and backend-only
  builds. Four initial sandbox-denied `os.uptime()` cases pass with access; nine other failures were
  incomplete synthetic fixtures, now corrected. Logs:
  `/private/tmp/apack-required-entries-consumers{,-final}.log`.
- Two actual compiler/build integration cases pass (51.61s). A declared step pack builds normally;
  a subsequent `--skip-fe` build refuses and preserves the incumbent integrity receipt. Undeclared
  flow-step refusal also passes: `/private/tmp/apack-required-entries-build.log`.
- Host and CLI TypeScript, final lint and refreshed local package builds pass:
  `/private/tmp/apack-required-entries-{types,cli-types,lint-final,packages}.log`.

This establishes required entry presence, not the completeness of every produced file. Compiled-content
index/data/media and bundler CSS/lazy-chunk output graphs still require audit and acceptance. Facade
text, flow-helper text, help and DSL data already live inline in snapshots; their duplicate files or
authored sources are not installed discovery prerequisites. Keep producer/input association in B1–B4;
no new receipt inventory or executable inspection was introduced. The preserved strict integration
failures, all-kind acceptance, all three Phase 6 workstreams and final committed-source strict `--all`
remain open. Concurrent documentation commits `71e854172` and `70547b7f9` are preserved.

## Compiled content admission (2026-10-17)

Source `3119205be` moves verified compiled-content inventory into the common build reader. The CLI's
separate index-existence/owner checks are removed; `PackBuild.content` carries the captured parsed
index. Source staging and current-format installer admission use the same validator. No compiler or
pack module is imported to inspect installed content; explicit native imports remain separate.

The validator checks index pack identity, exact compiled source/dataset membership, written policy
and receipt membership for each compiled JSON data file. A missing index cannot look like an empty
inventory, and its captured bytes must match the receipt even if the file changes after verification.
Applier-only sources intentionally have no indexed data entry; their pack index can be empty. Empty
datasets remain indexed as non-written. Existing manifest validation already rejects a key shared
between sources and datasets. Specialty compilation previously skipped missing declared source paths;
it now refuses them rather than silently publishing an incomplete index.

Evidence:

- Before repair, seven invalid sealed inventories were accepted and all three specialty compilers
  silently skipped absent sources. The new positive captured-index assertion also failed because the
  build reader returned none: `/private/tmp/apack-content-admission-before.log`.
- The affected pack/content/CLI run passes 740 of 741 cases. Its one failure was an existing reload test
  expecting a malformed index to reach apply. That boundary is now tested as an admission refusal
  preserving the running pack; a separate real applier execution failure preserves the first-apply
  installed-error-record requirement. The corrected focused run passes all 166 cases (4.26s):
  `/private/tmp/apack-content-admission-{consumers,final}.log`.
- Final layout acceptance passes all 110 cases (3.11s), including actual installer refusal before
  placement, incumbent stage retention and mutation between verification/capture:
  `/private/tmp/apack-content-admission-capture-final.log`. The first capture mock did not update Node's
  named filesystem exports; synchronizing them, as sibling filesystem-race tests do, fixes the test.
- Host, SDK and CLI TypeScript, final lint and refreshed SDK/testing/CLI package builds pass:
  `/private/tmp/apack-content-admission-{host-types-final,cli-types,lint-final,packages}.log`.
- Read-only checks against the actual previously compiled default-setup and external fixture outputs
  pass with five indexed entries each, including specialty and generic formats. These are reads of real
  compiler output, not a new build or runtime acceptance claim:
  `/private/tmp/apack-content-admission-real-output.log`.

Media-file completeness and frontend CSS/lazy-chunk output graphs remain unproven. A media directory
alone does not identify all required files, and receipt byte equality does not prove a producer emitted
every required file. Continue that audit with compiler observations/producer ownership in B1–B4. The
preserved strict failures, all-kind/external acceptance, all three Phase 6 workstreams and final
committed-source strict `--all` remain required. No broad gate was rerun for this checkpoint.
