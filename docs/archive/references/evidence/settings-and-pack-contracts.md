# Settings and pack contracts — checkpoint evidence

Historical evidence for [the active goal](../../goals/goal-settings-and-pack-contracts.md).
The goal’s live ledger owns current status, execution order and acceptance. Dated instructions,
“next” steps and incomplete-state claims below describe their checkpoint; they do not restart work
subsequently completed. Unmet requirements remain owned by the active goal and subsystem plans.
Append evidence here; update the goal’s existing handoff instead of adding another backlog there.

### Compiler checkpoint evidence (2026-10-16; historical, see live ledger)

Latest source is `bbf05ec00` (authored input ownership before preloads). The native pack input view
now captures the existing authored-file inventory and every file's bytes before user initialization,
including linked files and binary assets. TypeScript discovery consumes that frozen inventory instead
of selecting another live root set. The same owner validates membership and bytes and disposes them;
no new walker or authored-path policy is introduced. Generated/build/dependency exclusions stay
unchanged, including creation of a previously absent src parent for generated bindings. Directory
queries remain separately observed when consumed; this is not a claim of complete namespace closure.

The first-read regression fails on preceding source, returning edited bytes rather than captured bytes.
Forty affected view/module cases pass; two final lifetime/exclusion cases, CLI typechecking and lint
pass too. A real native preload edits an unread authored file and clears ambient launch options: the
entry still reads the original value, refuses changed originals, validates exact restoration and starts
no TypeScript runtime before the preload. The public worker's real repeat-build/cache case also passes,
retaining output identity and facade reuse (46.78s for both process cases). Evidence:
`/private/tmp/apack-authored-capture-{before,unit,lifetime,native,worker,types}.log`.

This closes the scoped authored-input slice of B1. The live ledger owns remaining producer work and
execution order; this evidence does not add a prerequisite before independent discovery migrations.

Preceding source `3929897a3` (launch identity before user initialization), following `65a189cb7`
(ordered execution identity) and `c85fc178a` (no-op alias projection removal). The native bootstrap
serializes runtime versions, platform/architecture, ordered native arguments and original user
`NODE_OPTIONS` before executing preloads. Compilation adopts that owned identity rather than reading
ambient values a preload may already have changed. Standalone compilation still captures its current
execution identity and refuses changes, as before.

The real native-prefix regression clears both `NODE_OPTIONS` and `process.execArgv` inside a user
preload. Its entry still receives the original ordered launch identity, with no private bootstrap path.
It passes in 72ms (2.70s including collection). Sixteen affected option/refusal/inventory checks,
CLI typecheck, lint and diff checks pass. `/private/tmp/apack-launch-state-{native,unit,types}.log`.
The preceding ordered-key change's two regressions fail before that source change and all nine
compiler-input integration cases pass afterward (50.23s):
`/private/tmp/apack-execution-identity-{before,after,types}.log`.

Launch-boundary audit: `build-process.ts` deliberately spawns a new entry, inheriting `NODE_OPTIONS`
and forwarding custom export conditions. Other arguments used to launch the supervisor are not
implicitly compiler options: copying entry modes such as --eval/--watch or debugger startup would
change the worker contract. Keep that existing boundary explicit; no new generic argument-forwarding
feature or unsupported flag parser is required by the original launch-ownership acceptance. Original
user options and their actual execution still need complete input/resource ownership; this checkpoint
records launch identity without claiming immutable executable/native-runtime ownership.

Source `37890aa9b` (native compiler startup capture): the private worker installs a
native CommonJS preload before user initialization, owns its early file view, and hands the same view
into compilation. Existing primary-loader threads return serialized observations through a private
barrier; final validation merges their facts and checks originals before publication. The bootstrap
shares filesystem interception with the later ESM compiler, including cached preload APIs. Captured
compiler files and owned scratch remain outside authored reads. Explicit native dependency lookup and
canonical aliases of admitted generated files remain readable. Repeated read-tree admission reuses
materialized directories rather than unlocking them on every read.

Native ESM source reads already pass through the filesystem adapter on both Node 23.11 and Electron's
Node 22.17. Adding a source loader reordered require preloads, so this implementation adds no source
loader and preserves measured require/loader/import order. The coordinator has no resolve/load hooks.
The former implementation is preserved in stash `5bf0d873aa61b67f79f2954b178106886d4f950a`;
all earlier stashes remain intact. This is input coherence, not stronger security isolation.

Evidence:

- Native ordering probes match plain Node on both runtimes; cached preload reads retain owned bytes,
  custom loaders retain their behavior and logical source paths, and loader-only source mutation refuses
  publication. Logs: `/private/tmp/apack-startup-order-fs-probe.log` and
  `/private/tmp/apack-startup-order-fs-electron.log`.
- Two real worker scenarios pass (77.09s), including changed external loader input producing new
  content/revision and a mid-build mutation refusing publication.
  `/private/tmp/apack-startup-fs-only-worker.log`.
- The previously failing incumbent-facade replacement case passes (48.24s) after canonical admission
  repair. `/private/tmp/apack-startup-admission-integration.log`.
- Latest focused checks: 23 view/tree/observation cases and 69 affected CLI/tooling cases pass; CLI
  typechecking, scoped lint and diff checks pass. Logs:
  `/private/tmp/apack-startup-final-{unit,affected,typecheck,lint}.log`.
  A native repeated-read probe drops directory chmod calls from 16 to zero, with code/data projection
  and final integrity checks preserved. `/private/tmp/apack-data-materialization-probe.mjs`.

Required strict validation is **not passing**. Run `2026-10-16T17-18-40Z-5247` completed with failures
(774.8s plus an automatic 8.8s app retry). Schema/API/type/lint/specifier/tier/runtime/smoke checks,
default pack build, external author and external contract passed. Integration exceeded its 600s pool
budget with watch/frontend failures and the generated-facade defect subsequently repaired above.
Packaged authoring's tests passed but Electron teardown timed out; the runner's isolated retry passed.
That retry does not prove pooled acceptance or explain teardown. Preserve the full run at
`node_modules/.cache/apack-chain/runs/2026-10-16T17-18-40Z-5247/` and
`/private/tmp/apack-startup-fs-only-strict.log`.

Source `c85fc178a` removes no-op alias projections during native input materialization. A worker CPU
profile located 7.94s inside read-tree admission, including repeated path projection for identical
logical/physical paths. The implementation now skips those identical-path projections; real aliases and
final integrity checks are unchanged. Temporary timing/CPU probes were removed before committing.
The previously failing publication/refusal/repair scenario passes on the uninstrumented build (65.04s
including fixture setup/cleanup); all 20s publication waits and test/hook deadlines are unchanged.
Eleven tree/path cases, CLI typecheck and scoped lint pass. Logs:
`/private/tmp/apack-read-tree-alias-{publication,unit,types}.log`.
Timing/profile evidence: `/private/tmp/apack-publication-complete-trace.log` and
`/private/tmp/apack-publication-cpu/`. The measured worker rebuild and watch refresh both contribute
latency; this small fix does not establish pooled timing acceptance or complete passive freshness.
The companion manifest-link retargeting/refusal/repair scenario also passes (60.70s), completing both
cases in the affected suite; `/private/tmp/apack-read-tree-alias-retarget.log`. Required strict acceptance
and the other preserved watch/frontend/teardown failures remain unresolved; the focused pass does not
prove those fixed. Do not restart the broad chain to diagnose them.

The live ledger assigns remaining launch/input, frontend-generation, lifetime, receipt and freshness
work to B1–B6. This evidence entry does not impose a second execution order. Startup observations are
not yet a persisted receipt or passive freshness authority. The separate Claude research stays paused;
snapshot research below is evidence, not an additional implementation prerequisite by itself.

Preceding source `f684f9b7e` supplied the native startup-view factory and adoption seam. Its native
preload proof, focused integration and 40 unit cases remain recorded in
`/private/tmp/apack-startup-view-{proof,integration,unit,types}.log`.

Preceding source is `2208be219` (mergeable compiler observations). The native view now exports owned,
serialized query/result entries, and its hash uses that same projection. Merging requires one logical
root and rejects contradictory answers; consumed stat fields and directory cursor positions combine
independently, so complementary reads do not falsely conflict. Captured paths, realpath results and
native error paths share source projection. No TypeScript runtime dependency is introduced.

Evidence: 49 focused observation/view/metadata/directory/module-input tests pass (1.40s); the final
directory representation adjustment passes its eight affected cases (0.227s). CLI typecheck, lint and
diff checks pass. A real Worker transfers production-view observations: complementary reads merge,
and conflicting file bytes refuse even after the source is restored. Logs/proof:
`/private/tmp/apack-observations-{unit,final,types-final,worker-proof}.log` and
`/private/tmp/apack-observations-worker-proof.mjs`. Broad/final acceptance is not claimed.

Preceding native-view source is `0c038442b`. Preceding ESM source `f67c8d066`:
ESM execution now has logical source URLs and filenames while native
resolution and source reads use the owned tree. A private loader below tsx only projects bytes; it
makes no main-thread RPC. The input owner and loader share one storage mapping. Native entrypoint
imports enter the same checked resolver as transitive requests, including package-format metadata;
tsx's opaque scoped-import shortcut no longer bypasses it. Fresh public workers use the stable first
scope namespace; in-process captures keep independent identities.

Captured configs are parsed with get-tsconfig (now an explicit CLI dependency). Include/exclude/files
patterns match logical source paths, while aliases resolve within owned inputs. This retains inherited
rules and generated-file matching instead of inventing a root-file inventory. JSX tests exposed the
previous matcher mismatch. The bundled worker also installed an unscoped tsx transformer, which ran
first with another filename/configuration; that redundant bootstrap is removed only for bundled
workers. Source CLI and other public-command bootstrap behavior is preserved. Disposal now awaits
tsx unregistration and closes the input tree even when teardown fails.

Evidence: the original output-swap test reproduced EACCES at an owned import.meta-relative write,
then passes with the intended source write/input-change refusal (25.80s combined focused run). The
final entrypoint case passes in 14.62s: it temporarily changes package type and module bodies, proves
captured values and original ESM metadata, and compiles configured JSX through static/computed imports
with query/fragment preservation. Two concurrent captures pass before the final tiny native-import
bridge extraction (35.47s). The final packaged JSX/metadata worker passes in 36.95s. Tree cases (3),
packaging cases (9), CLI typecheck and lint pass. The bridge also runs on Electron's Node 22.17.1.
Logs: `/private/tmp/apack-module-metadata-{before,focused,jsx-before,entry-final,native-entry,
worker-native-entry,tree,packaging,types-complete,lint-complete}.log`. No broad gate repeated.

Native-view/bootstrap proof checkpoint `0c038442b` removes the native input view's runtime
TypeScript dependency. The active compiler supplies glob enumeration, and the captured query retains
that reader for live validation. All in-tree callers migrate directly; no optional unconfigured reader,
second scanner or compatibility surface is introduced. Seventeen view/tree cases pass (0.493s), the
real stale-byte/new-root/no-program-rebuild case passes (7.60s), and CLI typecheck/lint/diff checks pass.
Logs: `/private/tmp/apack-native-view-{unit,validation,types}.log`.

A disposable pre-startup snapshot proof exercises actual CLI, TypeScript/JSX, backend and Vue paths.
It preserves CJS/ESM preload order, transforming-loader effects, source globals and relative module
resolution after original preload modules are deleted. The production native view initializes first
without loading TypeScript. Two full builds using different captured-copy directories produce the
same 14 output digests. The failed all-thread synchronous-hook variant establishes a real loader-thread
constraint; the successful boundary separates CJS hooks from an earlier asynchronous ESM byte loader.
The owning discovery plan records the alternatives, exact proof paths and next contract requirements.
The portable prototype is preserved in stash `989c457c4a543270f395014e28084d58641ebcb3`; existing
stashes remain untouched. No broad gate repeated or existing deadline changed.

The prototype is not production launch ownership: it has a fixture-only inventory, incomplete query
coverage and no final original-input refusal/receipt association. Cross-thread observations, the
pre-startup handoff, complete runtime/native/process ownership, actual HMR generation changes and
passive freshness remain required, together with every later goal phase and final committed-source
strict --all acceptance. Do not switch freshness consumers based on this proof.

Node option transport checkpoint `58f7f3b47` adapts the reviewed parser prerequisite from preserved
stash `c42116fb46a385b5f6065a4fb9cd9e68e2625b80`; the stash is untouched. One plain JavaScript owner
serves the pre-TypeScript bootstrap, host source-condition removal and compiler selector capture.
Native spaces/double-quote/escape semantics replace the inconsistent whitespace/shell tokenizers.
Split/equal long/short source selectors are removed without corrupting other option values; literal
single quotes and unquoted backslashes remain literal. Package/check input declarations include this
helper and its declaration. CLI bootstrap source is now declared by directory, fixing three omissions
from earlier compiler checkpoints found by the existing input-coverage guard.

Evidence: 78 source-resolution, selector, nested-bootstrap and graph checks pass in 2.45s. Native Node
executes a preload whose path contains repeated spaces while selecting built SDK exports after source
condition removal. A real captured compiler worker executes that preload and emits its observable value
(27.34s). Required package prerequisites build successfully; host, CLI, scripts and repo-checks typechecks,
scoped lint, import-specifier and tier checks pass. Initial npm static-check invocations hit the sandbox's
tsx IPC restriction; the same scripts pass through `node --import tsx`. Logs:
`/private/tmp/apack-node-options-{focused-final,worker,packages,cli-types-final,host-types,scripts-types,
repo-types,specifiers-final,tiers-final}.log`. No broad gate repeated or deadline raised.

This is option transport, not captured preload execution or the final launch contract. Preloads/loaders
still run before the current compilation view exists; adding their option strings to a hash would not
own their code, resolution or reads. A pre-startup owned execution handoff remains required, together
with complete launch/runtime inputs, frontend generation ownership, final input/output receipts,
passive freshness, remaining process/native-resource ownership and all later goal phases. Final
committed-source strict --all remains owed.

POSIX process-ownership checkpoint `b32ee23a1` launches each compiler worker in its own process
group. On worker exit the parent terminates inherited group members and confirms no executable member
remains before candidate verification/publication. Cancellation allows two seconds for SIGTERM cleanup,
then forces termination; a compiler ignoring SIGTERM cannot retain the builder indefinitely. A grouped
worker whose parent IPC disappears signals its own group. The group handoff is removed from its
environment before pack execution, and the IPC-loss listener remains until synchronous final exit.

Evidence: nine builder/publication checks pass (4.39s), including an unreferenced subprocess and a
SIGTERM-ignoring compiler (2.09s). Real content-compiler subprocess termination and parent-loss group
cleanup pass together on final source (34.20s). Public one-shot cancellation initially fails only in
the sequence after parent-loss testing; the isolated case passes, so isolation alone was not accepted
as a fix. Repeating that exact sequence with retained output identifies `kill EPERM`. Signalling errors
now require an OS state check: terminal/absent groups may finish, live or indeterminate groups still
refuse publication. The corrected parent-loss/public-cancellation sequence passes in 19.01s before the
final IPC-listener lifetime relocation. Final CLI typecheck, scoped lint and diff checks pass. Logs:
`/private/tmp/apack-compiler-group-{unit-final,worker-final,cancellation-final,context-diagnostic,
types-complete}.log`. No broad gate repeated or existing test deadline raised.

This covers inherited POSIX group membership, not children that create another session/group or Windows
job ownership. Those remain required work, alongside native resource lifetimes, runtime/preload inputs,
frontend generations, whole-build input receipts, passive freshness and every later goal phase. Stronger
security isolation remains deferred. Final committed-source strict --all acceptance is still owed.

Terminal input-lifetime checkpoint `3e6809d6c` closes a reproduced disposal hole: file views
continued serving bytes after disposal, and retained scoped tasks could recreate removed input trees.
Compilation, query view and read-tree owners now reject input operations/admissions after disposal;
cleanup is idempotent and releases captured data/query state. Pure source-path/diagnostic projection
remains available. Loader teardown now precedes final synchronous read-set validation and sealing,
rather than awaiting teardown after the last validation. Cleanup failures still refuse publication.

Evidence: the disposed-view regression fails before the repair. Final file-view, tree and cursor checks
pass (22 cases, 1.80s); an actual retained async filesystem read is refused without allocating storage,
while an unscoped native read still works (10.27s). Two public-worker cases pass after the validation
reorder (78.46s total): repeat-build revision/cache identity and termination of pack-created timers.
The final lower-level retained-tree admission guard is covered by the 22-case unit run; that worker
run precedes this last guard. Final CLI typecheck and scoped lint pass. Logs:
`/private/tmp/apack-input-lifetime-{before,unit-final,integration,worker,types-final}.log`.
No broad gate repeated or deadline changed. This does not revoke native resources already handed out,
track descendant processes, or establish frontend/compiler generations or a complete input receipt.
Those ownership/closure requirements, passive freshness and all later goal phases remain required;
stronger security isolation remains deferred. Final committed-source strict --all is still owed.

CommonJS source-globals checkpoint `98ba9de5f` passes the logical source filename to Node's
`_compile`, retaining the module's owned cache/resolution identity. `__filename` and `__dirname` no
longer expose temporary capture directories; source-relative reads still consume captured bytes.
The strengthened regression first reproduces the private filename, then passes alongside concurrent
CommonJS isolation (35.47s total). A real public-worker repeat-build test now emits these globals into
content: both builds produce the same sealed revision and phase stamp, with source checkout paths
(43.51s total). CLI typecheck, scoped lint and diff checks pass. Logs:
`/private/tmp/apack-commonjs-metadata-{before,focused,worker,types}.log`. No deadline raised or broad
gate repeated. This proves this CommonJS path and its repeat output, not universal reproducibility or
complete module-object metadata. Runtime/preload closure, final input receipts, frontend generations,
passive freshness, all later phases and final committed-source strict --all remain required.

CommonJS alias checkpoint `be5dd38e9` uses the same captured, projected tsconfig and get-tsconfig
path matcher as the ESM compiler path. Alias candidates are admitted through the existing input owner
and resolved through the native/tsx resolver, retaining fallback targets and native package-import
resolution. Builtins bypass aliases; imports from `node_modules` do not inherit the pack's aliases.
Only this tree's resolver handles these requests. Its own tsx namespace suffix is normalized when Node
encodes it into a file URL pathname, so it cannot become a fictitious authored filename.

Evidence: the strengthened CommonJS case first fails to resolve its wildcard alias, then passes with
changed source/config/alias bytes while consuming the captured JSX factory, alias and payload. It also
proves a missing first alias target falls through, native `#imports` work and a dependency under
`node_modules` cannot use the pack alias. Final alias and concurrent-isolation cases pass in 8.97s and
17.98s respectively (`/private/tmp/apack-commonjs-alias-final.log`). That run's ESM case fails because
an overly broad test edit accidentally added dependency files after capture; that accidental block is
restored verbatim. The unchanged ESM/query/transitive case then passes in 10.68s
(`/private/tmp/apack-commonjs-alias-esm-final.log`). Final CLI typecheck and scoped lint pass;
`/private/tmp/apack-commonjs-alias-types-final.log`. No broad gate repeated. This does not establish
complete CommonJS metadata, runtime/launch closure, deterministic output, final input receipts,
frontend generations or passive freshness. Those and every later goal phase remain required.

CommonJS checkpoint `5cc9edc78` fixes a reproduced compiler failure: a CommonJS `.tsx` entry
with a custom JSX factory failed with `Unexpected token '<'`. tsx's CommonJS registration accepts no
per-registration config; routing its entry through ESM loading can also restore a shared source cache
key. CommonJS entries now enter its scoped require directly. A tree-scoped CommonJS adapter transforms
owned modules with captured compiler options and original source maps. Native CommonJS lookup runs
outside source-read projection so owned filenames remain owned; executing the compiler body retains
its captured-read scope. Other paths delegate to existing loaders. Teardown disables/removes these
adapters and releases their compilation reference even if another registration is still layered above.

Evidence: the regression changes the compiler body, config and payload after capture, then proves the
original JSX factory and captured top-level file read execute, with stale inputs still refusing final
validation. Existing ESM/transitive loading and concurrent CommonJS/source-parent isolation pass with
it: three cases in 66.28s total (`/private/tmp/apack-commonjs-checkpoint.log`). After the final teardown
reference-release refinement, the CommonJS regression and concurrent isolation pass again in 38.61s
(`/private/tmp/apack-commonjs-checkpoint-disposal.log`). Final CLI typecheck and scoped lint pass;
`/private/tmp/apack-commonjs-checkpoint-types-final.log`. No broad gate repeated. These are in-process
checks, not final packaged-worker or committed-source strict acceptance. CommonJS alias resolution,
logical metadata/diagnostic variants, deterministic output, full runtime/launch closure, complete input
receipts and later phases remain required. No passive freshness consumer is migrated by this checkpoint.

CommonJS deliberately retains per-tree filenames: a disposable proof found that logical CommonJS
filenames reuse another generation's transitive cache. Its metadata/configuration semantics remain
required, not excluded. Complete runtime/launch/preload closure, remaining entry variants and resource
lifetimes, whole-build input receipts, frontend generations and every
later goal phase remain open. Repeat-output and final committed-source strict --all acceptance are
still required; focused evidence does not establish them.

Checkpoint `8e64503cc` repairs the retained-builder fixture for the current worker protocol: a valid
manifest, sealed output, exact candidate IPC, and diagnostics outside authored inputs. Existing compiler
reuse, refresh, damaged-copy replacement, cancellation and cleanup assertions remain intact. The fixture
makes copied staging directories writable because captured compiler inputs are read-only. Seven focused
builder/publication cases pass (1.83s total); CLI typecheck and scoped lint pass. Logs:
`/private/tmp/apack-builder-checkpoint-{final,types}.log`. An earlier sandboxed run also included frontend
watcher cases and failed with native filesystem cleanup/watch errors (`EMFILE`); that is not acceptance
evidence. No watcher source changed or broad gate repeated. Source inspection confirms the existing
observe/accept boundary is already aligned with parent-owned verified publication; remove that stale
implementation task, retaining frontend generation ownership and complete input receipts as required.

Preceding source `a0c050a16`. Public build parents now hold the pack lock from worker startup
through process closure and verified publication. Workers prepare/seal staging, report the candidate's
authored input hash and sealed output revision, drain diagnostics, then explicitly exit. The parent
waits for close, checks cancellation, rechecks authored inputs and verifies the exact reported output
before replacing dist. An exit handler that changes or reseals files cannot renew the candidate's
reported identity. Refusal/abort removes staging while preserving the incumbent. Internal in-process
build tests use the same publisher under their own lock; they do not establish process termination.
Lock waits now accept cancellation because moving that wait into the parent must not defer a stop
until the old wait deadline. Preparation no longer announces build completion before publication.

Evidence: 15 publication/locking cases pass in 1.04s, covering valid output, late source edits, edited
output, resealed output and cancellation without disturbing the other holder. Two real workers pass
in 49.52s together: a referenced timer no longer retains the compiler; an exit handler confirms staging
is SEALED, changes its content, and is refused while the incumbent remains byte-identical. The existing
public one-shot cancellation case passes in 12.10s after the abortable-lock refinement. CLI typecheck
and final scoped lint pass. Logs: `/private/tmp/apack-parent-publication-{unit-final,worker,cancel,
types-final,lint-final}.log`. No broad gate repeated.

The candidate handoff is deliberately not the complete source/compiler input receipt. External and
late-read input observations still need final serialization/provenance, coherent association and passive
consumer migration. Watcher observation replacement already follows accepted publication: `observe()`
extends subscriptions during compilation, while `accept()` runs only after the parent builder returns
from verified publication. No additional watcher mechanism is needed. Finish resource ownership beyond the worker's own Node tasks (including descendant processes and
long-lived frontend compilers). Next inspect authored module metadata: import.meta.url currently names
owned files, while native writes remain native; the output-swap fixture constructs a write URL this way.
Resolve source-path semantics and deterministic output before treating executable input ownership as
complete. Every later phase and final committed-source strict --all acceptance remain required.

Preceding source `ed72a0388`. Captured execution now maps source-parent createRequire calls to
an owned native parent before constructing the require function. Existing captured module/compiler
parents retain their native context. AsyncLocalStorage chooses the compilation; calls outside captured
execution stay native. Node's directory-parent convention is preserved without admitting the directory
above it. No module cache replacement, second resolver or compatibility path is introduced.

Evidence: the strengthened compilation case consumes captured values through an explicit original
package.json require parent. A concurrent two-generation case captures FIRST and SECOND at the same
paths, consumes those respective values after a LIVE edit, then proves ordinary out-of-scope require
still reads LIVE. Both pass in 34.19s together. The real captured worker passes in 25.69s; CLI typecheck
and scoped lint pass. Logs: `/private/tmp/apack-original-parent-{integration-final,worker,types-final,
lint-final}.log`. The first run exposed an overbroad directory seed; the repair admits the exact native
parent context instead of scanning shared temporary-directory entries. No broader gate repeated.

This establishes the tested source-parent and concurrent contexts, not borrowed require functions
across disposed generations, runtime metadata/diagnostic projection, preloads or pending-task lifetime.
Whole-build receipts, frontend execution and every later phase remain required.

Preceding source `14aa9fa38`. A per-build synchronous Node resolver hook admits transitive requests
through the existing native input reader, redirects absolute module/file-URL targets into the owned
tree and leaves resolution/transform/loading to Node and tsx. ESM queries and fragments are preserved;
CommonJS absolute requests remain paths. Hook disposal precedes input cleanup on success and failure.
Node engines now state the actual requirement: CLI `^22.15.0 || >=23.5.0`, checkout `>=23.5.0`.
The installed Electron runtime was checked directly: Node 22.17.1 exposes registerHooks.
See [Node's synchronous hook contract](https://nodejs.org/download/release/v23.11.1/docs/api/module.html#moduleregisterhooksoptions).

Evidence: the focused compilation consumes captured static absolute, computed dynamic and aliased
imports plus createRequire values through temporary edits; synchronous import.meta.resolve stays
inside the owned namespace. The final query/fragment variant passes in 15.01s. The real worker passes
in 26.93s before that final URL-handling refinement. Scoped lint passes; committed-source CLI
typecheck is recorded at `/private/tmp/apack-module-hooks-types-committed.log`. Other logs:
`/private/tmp/apack-module-hooks-{query,worker-final,lint-final}.log`. No broad gate repeated.

A rejected asynchronous MessagePort bridge is preserved in stash `57379e073d36854b9e783dbcc684cc7d5ecf5e87`.
A disposable two-second native probe demonstrated deadlock when synchronous import.meta.resolve
waited for a callback on the blocked main thread. The synchronous API removes that bridge. An extra
load hook conflicted with tsx in the real worker and was removed: owned namespace admission already
precedes native loading, so a second source-loader implementation is unnecessary.

Remaining loader acceptance includes broader parent/entry variants,
module metadata/diagnostic origin projection and deterministic output,
external native/package entry variants, loader/preload startup ownership and pending task lifetimes.
Frontend execution, whole-build receipts and every later goal requirement remain open. The committed
source checkpoint is focused evidence, not the required final strict --all acceptance.

Preceding source `f9015a07f`. Custom content compiler entrypoints now execute from the owned
module tree with captured tsx configuration. The SDK forwards one `PackModuleLoader` through custom
formats, flows, dependency step modules and the pack's generated step module instead of letting the
last three bypass the build owner's loader. Standalone SDK use retains native import as its default.
Captured tsconfig projection now includes the configuration files already read by TypeScript, so
absolute alias targets point into the owned tree. Tool bootstrap exits captured content I/O; authored
module execution remains within it. Updated the SDK API report and contributor guides.

Evidence: a real SDK compilation replaces the compiler entrypoint, aliased dependency, dependency
step module and flow module after capture; it consumes their captured values, then passes validation
after exact source restoration (21.40s). The final real worker build passes (50.09s, including three
package rebuilds). Eighteen SDK content cases, the step collision case, CLI typecheck and scoped lint
pass. API report generation passes after package refresh; reviewed changes are the shared loader type
and its four use sites. Logs: `/private/tmp/apack-content-module-{integration,worker-final,sdk,steps,
types,lint,api-report}.log`. No broad gate repeated.

This closes the inspected authored entrypoint/flow/step bypasses, not arbitrary Node loader closure.
Absolute/computed runtime imports, package-native entry selection, runtime diagnostic/source paths,
loader/preload startup options and pending resource lifetime remain required alongside frontend
execution and whole-build receipts. The complete goal and final committed-source strict gate remain
open.

Preceding source `50ae730a9`. Scoped `opendir` now captures the native consumed prefix lazily,
sharing it across handles for the same query. Validation replays that prefix and checks EOF or a
read error only when observed. Opening and closing without reading no longer drains the directory
or surfaces deferred traversal errors. Compilation disposal closes retained source cursors, including
partially consumed ones. Real native handles continue to supply caller-facing locking and closure.
Error comparison sorts property names because cloning native errors can change property order.

Evidence: 50 affected unit cases pass (3.69s), including partial traversal, mutation isolation,
native async traversal order, deferred errors and disposal. The scoped opendir integration passes
(11.59s); it consumes the initial traversal before mutating membership, then proves all three handle
factories replay it and final validation rejects the changed source. CLI typecheck and scoped lint
pass. Logs: `/private/tmp/apack-directory-prefix-{unit,integration,types,lint}.log`.
No broad gate repeated. This checkpoint does not claim current-source strict acceptance.

Earlier `19e28caea` added native directory handles and allocation-free diagnostic projection.
The eager traversal limitation recorded there is replaced by this consumed-prefix implementation.
Pending asynchronous work, leaked public handles and resources borrowed across compilation frames
remain part of resource-lifetime acceptance; closing the hidden source cursor does not complete it.
Whole-build receipts, remaining compiler paths and the rest of the active goal remain required.

Earlier source `7906c217f`. Source numeric/bigint stat snapshots now accompany captured data,
so path and descriptor metadata can refer to the same byte generation. Read-only opens record their
actual descriptor identity; `fstatSync`, callback `fstat` and native FileHandle `stat` project source
metadata instead of readonly-copy inode/permissions. Native descriptor validation preserves `EBADF`.
Close/reuse releases only the owner observed by that operation, including an explicitly absent owner;
a delayed unowned close cannot erase a newer owner. Native handle objects, borrowed stat receivers
and async disposal are retained. Default callback `open(path, callback)` also captures bytes.

Evidence: 67 affected unit cases pass; the final three descriptor cases pass after strengthening the
borrowed-receiver check and fixing the absent-owner race. The metadata/descriptor integration pair
passes, and the final descriptor case passes in 13.29s. It proves byte/size/inode/permission agreement
through pathname replacement, closure errors and native writable-output behavior. The real content
worker passes in 26.02s before the final default-open/release refinements; those have focused coverage.
Final CLI typecheck/lint pass. Logs: `/private/tmp/apack-descriptor-{unit,final,worker,race-final,
release-final,types-final,lint-final}.log`. All own processes are terminal; no broad gate repeated.

Earlier source `9421d496e`. The content read scope captures stat/lstat, realpath (including native
variants), readlink, access and existence queries across their native API families. Metadata comes from
original inputs rather than readonly materialization, preserving source permissions/inodes. Query
results/errors are owned copies; negative results and link targets are rechecked before publication.
Native Stats instances use observed field accessors, so unused timestamps do not invalidate a build.
Methods, bigint fields, mutable Dates, structured cloning, inspection and native error brands have
real-filesystem checks. An initial Proxy rejected `structuredClone(stat)`; it was replaced before commit.
Node's custom promisification hook for `exists` is preserved. Metadata errors construct/map diagnostic
storage outside captured execution, avoiding recursive filesystem interception.

Focused evidence: 61 related unit cases plus the original three metadata cases pass; the final four
metadata cases pass after native-value fixes. All four scoped integration cases pass in the affected
run. The final strengthened metadata case passes in 5.41s, and the captured content worker in 25.93s.
CLI typecheck and focused lint pass. Logs: `/private/tmp/apack-metadata-{unit-final,
integration-final,native-values,native-integration,native-worker,native-types,native-lint}.log`.
All own processes are terminal. No broad gate repeated; this is not full filesystem acceptance.

Preceding source `e7cd3d3d4` captures native directory queries/options and copied Dirents/Buffers;
new representations validate overlapping earlier observations. Explicit data reads can admit files
excluded from source discovery, while staging output stays separate. Validation explicitly leaves
captured execution to check live inputs. Source `477b4fef5` owns read-only opens/streams/descriptors;
`6c5c6613d` owns sync/callback/promise file reads in isolated asynchronous scopes with raw-data and
native-metadata projections in one tree. Writable opens and staging reads stay native. Evidence:
`/private/tmp/apack-directory-*.log`, `apack-content-handles*.log`, `apack-content-reads*.log`.

Next finish frame resource closure, borrowed/pre-opened descriptor ownership, special flags,
native object/reflection and argument-form acceptance. Resource-frame closure and descriptor transfer
between generations are not established by the within-frame ownership map. Current Stats field
instrumentation uses accessors; do not assume every reflective/native consumer is already proved.
Then complete loader/startup/preload ownership, startup-cached references and pending task lifetimes.
Retain metadata identity/provenance projection in the whole-build receipt work, frontend resources
and compiler generations, complete contribution discovery, navigation/frontend boundaries and all
three Phase 6 workstreams. Native namespace completeness, authored source-map chaining and diagnostic
stream source paths remain required. All Phases 0–7 and restored manifest deliverables remain active;
run integrated/final committed-source strict `--all` gates after convergence, not each helper edit.

Prior `1a87aa11e` preserves native per-file configuration for absolute module references and generated
stdin without custom resolver round-trips; independent captures emit identical JS/maps. `6b384ff1c`
owns external glob inputs through transient edits and proves hidden runtime package precedence;
`00a6e3db5` records initial native tree execution and worker repeat identity. Their evidence remains in
the preceding checkpoint commits and `/private/tmp/apack-native-*.log`.

#### Previous owned-declaration checkpoint

Previous source checkpoint `5e3530cad`: facade, flow-helper and DSL declaration bundles use one
lazy owned filesystem tree per build. It materializes captured bytes, namespace queries and package
bindings without an ancestor sweep. Inputs are read-only and verified; derived configuration uses
separate writable storage. TypeScript path projection belongs to compiler configuration. Declaration
programs capture parent configuration where applicable without changing native per-file discovery.
Normal disposal precedes publication; failure disposal remains guaranteed. The public worker's parent
owns an exact workspace and can remove abandoned read-only children without following foreign links.

Focused evidence: 89 affected unit cases, final typed build/stage/load and production worker checks,
CLI typecheck and lint pass. The typed entity facade preserves `value: string` while its original
shape and inherited configuration files are absent during bundling; private trees are removed and
emitted types contain no private paths. Bypassing the tree fails that regression; source restored.
The final real worker passes repeat-build identity and both parent-workspace removal assertions in
21.73s. File/directory links, dangling links, executable files, conflicting origins, copy tampering
and foreign-link preservation have real-filesystem checks. The captured-root identity test exposed
directory permission differences; only file executable bits enter identity, retaining its original
source/copy equality assertion. Logs: `/private/tmp/apack-owned-tree-{unit-final,declarations-final,
worker-final,types-final,lint-final,mutation}.log`. The earlier ten-case integration run also passed;
final focused checks exercise the changed metadata/lifetime wiring. All own processes are terminal.
No broad gate was repeated for this execution-frame increment; integrated/final strict acceptance is
still required. Source `2e68b3ca7` remains the owned-byte consumer for all five native module bundles.

Previous source `26f73956b` passed strict run `2026-10-16T08-15-59Z-20777` in 825.8s, 29 executed/
one cached, 761 integration cases, real authoring and app checks; all seven EARS/content baselines
matched. That is previous checkpoint evidence, not strict acceptance of newer source.

Next extend the shared frame to native resolution, direct content filesystem reads and frontend
resources, preserving observations, original paths, deterministic output and live authoring. Complete
launch/preload ownership before startup and the retained frontend compiler's generation/lifetime,
then the whole-build receipt and passive freshness consumers. Returned declaration errors/read records
are projected to source paths; upstream TypeScript diagnostics printed directly by the surface still
need source-path acceptance through the complete worker output handoff. Do not mistake returned-error
mapping for proof about that stream. The generic Node/Vite read adapters remain experimental.

The user explicitly corrected the pace: prioritize substantial implementation over more proof/test
machinery. Use focused checks while implementing; reserve broad gates for integrated milestones and
final acceptance, rather than each helper change. All Phases 0–7 and all three Phase 6 workstreams
remain required. Preserve unrelated work and saved stashes. Stronger isolation/lazy activation stay deferred.

#### Earlier compiler-installation evidence

- Source checkpoint: `aba660aed` captures compiler installations and owns their build sessions. Preserve the unrelated
  `docs/issues/ISSUE-plan-consolidation-scope-loss.md` and the other agent's independent worktree.
- Checkpoint claim: selected compiler bytes remain owned for worker execution; failed builds preserve
  the incumbent output; public watch startup/readiness shutdown drains workers and removes the compiler.
- Proven: focused compiler/package-graph checks recorded below; all 18 concurrent diagnostic cases;
  public-watch startup mutation fails on the leak, and restored ready/compiling cases both pass.
- Checkpoint validation passed: `npm run chain -- --strict --cores 4 --no-classify`,
  run `2026-10-16T02-58-25Z-98482`, log `/private/tmp/apack-compiler-startup-owned-strict.log`.
  Exit 0, 825.1s, 29 checks executed and one cached. Integration: 58 files / 744 tests pass,
  including publication refusal and both public-watch shutdown phases. All seven EARS/content baselines
  match byte for byte after the run. Source was unchanged throughout; `aba660aed` commits that source.
  This is checkpoint acceptance, not the final committed-source strict `--all` gate for the whole goal.
- The earlier publication deadline failure did not recur under equivalent strict coverage. Preserve
  its diagnostic evidence without claiming a root cause. The run still warns that default-setup outputs
  changed after their producer passed; the shared freshness/publication work must resolve that warning.
- Next: complete frozen pack/external inputs, ambient compiler options, one-shot/dev
  lifetime, atomic whole-build input/output association and passive freshness consumers before expanding
  discovery. All Phases 0–7 and all three Phase 6 workstreams remain in scope.

The repeated broad-run loop consumed over four hours without landing this source checkpoint. That is
an execution failure, not additional acceptance work. The current handoff above owns the next action;
chronological evidence below does not authorize reopening every previous investigation.

The compiler checkpoint is now committed. No further broad rerun is needed for its documentation or
commit operation. Design and implement the next coherent input/publication checkpoint with focused
acceptance first, following the bounded workflow above.

The [cancellation checkpoint](discovery-without-activation.md#build-cancellation-ownership)
is committed as `6641b2c99`, on top of authoring repair `f40158544`. Public one-shot/watch commands own
signals before startup; development drains initial-build and watcher-startup cleanup before removing
its profile or exiting. Focused checks and mutation evidence are recorded in the plan.

The first strict run (`2026-10-16T03-35-20Z-41306`) fails only two obsolete source-text assertions
requiring refresh directly in `buildCommand`; 3,291 other host tests pass. It stops before the remaining
pool/app checks. `/private/tmp/apack-build-cancellation-strict.log`. Those assertions are replaced by
real-worker refresh-before-capture and failed-refresh refusal coverage. Moving refresh after capture
fails the new behavior check; restored source and all 852 CLI unit cases pass. No production change
was needed after that gate failure.

The converged strict gate passes: `npm run chain -- --strict --cores 4 --no-classify`, run
`2026-10-16T03-43-08Z-54352`, 702.7s, 11 checks executed and 19 cached. All 745 integration tests in
58 files pass. All seven EARS/content baselines match byte for byte afterward. Source stayed fixed;
`6641b2c99` commits that tested source. `/private/tmp/apack-build-cancellation-converged-strict.log`.
No validation process remains active, and no further broad run is needed for recording this result.

Release verification's build-only signal ownership is committed as `bc6464a9c`. It drains the
compiler and reports the existing recovery state before signal exit. Synchronous verification runners
and later release phases retain their signal behavior. All 30 local release cases and four real public
cancellation phases pass; the discovery plan records the mutation evidence.

The strict checkpoint passes: `npm run chain -- --strict --cores 4 --no-classify`, run
`2026-10-16T04-08-31Z-96133`, exit 0, 841.0s, 29 checks executed and one cached. All 749 integration
cases in 58 files pass. All seven EARS/content baselines match byte for byte after the run. Source was
fixed throughout; `bc6464a9c` commits the tested source. Log:
`/private/tmp/apack-release-build-lifetime-strict.log`. Session `30588` is terminal. No further broad
run is needed for this documentation update. No real publication or repository version metadata changed.
The existing default-setup output-change warning remains part of the required publication/freshness work.

Next: complete the coherent pack/external/compiler input frame, ambient execution options, long-lived
frontend compilation, atomic whole-build input/output association and passive freshness consumers.
The audit confirms `build-process.ts` forwards inherited `NODE_OPTIONS`, while `compilation-inputs.ts`
only identities export conditions; loader/preload execution therefore still needs explicit input
ownership. This finding is not a completed design or permission to drop other input requirements.
The source-freshness acceptance and every later goal phase remain required. These cancellation
checkpoints are neither the whole input contract nor the final committed-source strict `--all` gate.

The next input-closure candidate records TypeScript resolution namespaces in the existing module-input
reader: missing targets, physical origins and directory membership. The missing-directory and dangling
link cases both failed before the change. Focused module/compiler/builder checks pass; removing namespace
hashing fails all three new namespace-identity cases, and source is restored exactly. A real build whose
content compiler creates a missing external directory refuses publication and retains incumbent output.
CLI typechecking and lint pass. This is a prerequisite, not a frozen-input receipt or reader migration.
Strict run `2026-10-16T04-30-36Z-35063` is terminal (exit 1, 849.3s). All but one integration case
pass (749/750); `watch-external-types.integration.spec.ts:50` observes neither publication nor a reported
error within its existing 20-second bound. No external-pack app check ran. Preserve
`/private/tmp/apack-module-namespace-strict.log` and its run evidence. The failing watcher case passes
alone with the same bound; that does not establish the broad failure's cause.

A targeted filesystem probe finds duplicate namespace sampling: 4,940 stat / 8,172 realpath calls versus
2,290 / 187 for the committed reader on the same private fixture. Record actual TypeScript query results,
normalize logical lookup parents once and keep physical targets fresh. The candidate now uses 2,292 /
5,088 calls in that probe; this is not a claim that the timeout's cause is proved. Focused namespace/watch
checks pass; run the failing watcher with its relevant peer suites before the required converged gate.
The focused peer run (`71594`) is terminal: 14/15 cases pass, but the external-types watcher reaches
its unchanged 60-second total test limit. Its final repair publication appears in the log. Do not infer
that duplicated probes explain either timeout. Broad reruns are stopped pending this diagnosis.

The same-width, same-four-file committed-reader baseline (`74190`) passes all 15 cases in 67.43s;
the external-types case takes 54.423s. Exact candidate source restoration was verified. Baseline log:
`/private/tmp/apack-module-namespace-base-peers.log`. This supports investigating candidate overhead;
a single comparison is not proof of causation.

The candidate now also avoids an expected failed-realpath call for absent leaves: it checks whether
the leaf exists, follows any link, and otherwise resolves the parent afresh. Positive targets and
missing-path parents remain freshly resolved. Thirty namespace/watch cases pass. The same probe
records 2,292 stat / 3,503 realpath calls (398ms; a single sample). The CLI is refreshed for this source.

The changed candidate's peer check (`31438`) is terminal (exit 1): 14/15 cases pass, and the same
watcher hits its unchanged 60-second total limit. Log:
`/private/tmp/apack-module-namespace-query-peers.log`. No validation process remains active. The
completed baseline script's restore trap is no longer active; do not restore its older backup over
the current candidate. The private CLI currently matches the improved candidate.

The naive namespace candidate is preserved as stash `5443490ae6edcabbd6759e9f6330c5325a5eac76`;
it was stored without clearing the working tree. Do not pop it over the newer implementation.

The replacement owns one TypeScript file view per scan. Configuration, Vue extraction and the compiler
host consume captured metadata/bytes/physical bindings and directory/glob results. Source membership
uses the shared walker. The scan returns its read-set validator; `captureCompilationInputs` retains
that validator instead of reconstructing a TypeScript program for every assertion. Package/tool and
recorded-option checks remain. Origin mappings, glob arguments and returned arrays are owned values.

Focused acceptance: 58 module/view/configuration/watch/compiler/builder cases pass, four real
compilation/publication cases pass, CLI typechecking and lint pass. A relocation case with `outDir`
first exposed absolute inferred glob exclusions in the fingerprint; normalizing those query parameters
fixes it. Mutations removing byte reuse, namespace validation, retained-read-set validation or root
membership validation each fail their corresponding cases; injecting program rediscovery fails the
poisoned-rediscovery case. Source is restored after every mutation. Logs:
`/private/tmp/apack-compiler-file-view-{restored,publication,typecheck,lint,mutation-bytes,mutation-namespace,mutation-validation,mutation-rediscovery,mutation-membership}.log`.
An initial view probe observes 1,278 stat / 1,290 realpath calls versus the naive recorder's 4,940 / 8,172;
this is scope evidence, not a proof of the broad timeout's cause or a final benchmark.

The refreshed distributable CLI's focused four-file watcher workload passes all 15 cases in 65.66s,
with the same four-worker width and unchanged limits. The external-types case takes 56.935s.
`/private/tmp/apack-compiler-file-view-watch-peers.log`. Session `23982` is terminal. This closes the
focused reproducer; it does not establish the earlier broad timeout's complete cause.

The converged strict gate passes: `npm run chain -- --strict --cores 4 --no-classify`, run
`2026-10-16T05-29-27Z-83403`, exit 0, 823.5s, 29 checks executed and one cached. All 751 integration
cases in 58 files pass, as does the previously missing external-pack app check. All seven EARS/content
baselines match byte for byte after validation. Source stayed fixed; `e171b3acf` commits that source.
Log: `/private/tmp/apack-compiler-file-view-strict.log`. Session `9280` is terminal. No validation job
remains active, and no further broad run is needed to record this evidence. The older recorder stash
is preserved. The existing default-setup output-change warning remains unresolved under the broader
publication/freshness work; this checkpoint does not establish its cause.

The next publication audit reproduces the phase-stamp defect: after a refused replacement, a retry
reuses an old string facade against a new number shape. `/private/tmp/apack-phase-cache-placement-before.log`.
The candidate writes `phase-cache.json` into staged output before sealing; reads verify the incumbent
and the consumed cache bytes. Cache and output publish together, and installed/archive staging omits
the private root file. The failure/retry now preserves incumbent cache bytes and publishes the number
facade. No old-path reads or conversion. All current source/test references are migrated.

Focused acceptance: 12 publication cases, the DSL retention/reuse/removal case, the real worker's
repeat-build identity case and 23 cache/read unit cases pass. CLI typechecking and lint pass. A DSL
preflight initially refused stale CLI output before any test ran; `packages:ensure` and the targeted
DSL/worker run close that prerequisite. Mutations bypassing output verification or writing stamps
after the seal fail on damaged facade reuse and unsealed layout respectively; exact source is restored.
The final reader verifies before consuming cache bytes, and both damaged-data cases pass afterward.
Logs: `/private/tmp/apack-phase-cache-{publication-focused,dsl-worker,unit,mutation-verification,mutation-seal-order,restored,typecheck,lint}.log`.

Source checkpoint `17438889d` publishes the phase cache with its verified output. The single converged
strict gate passes: `npm run chain -- --strict --cores 4 --no-classify`, run
`2026-10-16T06-10-32Z-26560`, 865.3s, 29 steps executed and one cached. All 753 integration cases
in 58 files pass, along with both real packaged-authoring halves and external-pack contract/app checks.
All seven EARS/content baselines match byte for byte after the gate. Source stayed fixed throughout.
Log: `/private/tmp/apack-phase-cache-strict.log`; PID `26560` is terminal. No gate remains active.
No further broad run is needed for this commit or its evidence. The default-pack output-change warning
remains unresolved and is not explained by this repaired association defect.

Next complete the coherent pack/external execution frame and whole-build input/publication contract.
The inspected launch boundary still inherits `NODE_OPTIONS`, but `compilationConditions` accounts only
for export selectors. The dev Vite server is imported and retained in the supervisor outside the captured
compiler session. Resolve both within complete execution ownership; do not silently strip supported
options, narrow the input contract or treat a hash-only change as frozen execution.

A disposable two-process probe now confirms that changing executed external preload bytes leaves
`captureCompilationInputs()`/`assertCurrent()` with the same hash. Evidence:
`/private/tmp/apack-preload-identity-audit.log`. This is an input-identity defect, not yet a stale-pack-output
reproduction; it does not explain the output-change warning. The discovery plan owns the launch/session
audit and acceptance for the next implementation. The probe changes no repository source or output.

The user's snapshot-led suggestion is now tested against actual compiler paths, with positive and
negative results recorded in [the proof evaluation](build-input-snapshot-proof.md).
Two independent owned-source/dependency builds preserve emitted bytes and revision after live inputs
change; only private phase metadata differs from the live baseline. Absolute aliases and direct content
file reads can still escape the copy, and a dev server on an immutable copy loses original-source
updates. Existing conflict guards and origin-mapped compiler observations remain useful. Continue the
bounded hybrid prototype before choosing the production ownership/remapping and dev-lifetime design;
do not claim these defects, whole-build receipts or any later scope complete.

The next adapter proof succeeds through the real build with original external files removed:
TypeScript, esbuild and absolute content-file reads consume owned bytes, while frontend observations
retain original source paths. This closes the demonstrated escapes only within the controlled fixture;
complete configuration/loader/I/O coverage, external discovery and dev lifetime remain required.

Source checkpoint `de5adeb66`: `compiler-file-view.ts` normalizes the root as well as file origins;
`compiler-module-inputs.ts` uses that source root for discovered-package ordering. Physical reads and
validation remain owned. Three regressions cover equal identity, original disappearance, owned-byte
mutation and dependency order. Forty-seven focused cases, CLI typecheck and lint pass. The two initial
regressions fail on baseline; the physical-sort mutation fails and exact source is restored. Evidence:
`/private/tmp/apack-snapshot-root-{regressions-before,focused,mutation-order,typecheck,lint}.log`.
The converged strict gate is terminal and failed: run `2026-10-16T07-01-20Z-71395`,
911.0s, 752/753 integration cases pass; `watch-external-types` hits its existing 60s test bound.
All other gate steps pass. Session `3650` exited 1; `/private/tmp/apack-snapshot-root-strict.log`.
Do not restart the broad gate. A focused timing run passes the unchanged case in 42.64s: ready
at 14.08s, first publication at 25.04s, missing-input refusal at 30.97s, recovery at 41.69s,
compiler cleanup at 42.63s. The exact test is restored; no deadline/assertion change.
`/private/tmp/apack-snapshot-root-watch-timing.log`. The timeout cause is not established and
this focused pass does not establish strict acceptance. The previously accepted four-file peer
workload passes all 15 cases at the same four-worker width in 69.55s; this case takes 58.244s with
unchanged limits. `/private/tmp/apack-snapshot-root-watch-peers.log`. All seven EARS/content
baselines match after these runs. The exact instrumented test is restored; sessions `3650`, `47270`
and `83599` are terminal. Source `de5adeb66` records the focused validation and failed strict gate
explicitly; full checkpoint/goal strict acceptance remains open. Do not repeat the broad gate to
seek a pass or weaken deadlines/assertions. Continue the bounded snapshot work and carry this
required acceptance forward; a later converged source checkpoint/final gate must close it.
Every whole-build snapshot/publication and later requirement stays required.

The two-file unfinished parser patch is preserved in stash
`c42116fb46a385b5f6065a4fb9cd9e68e2625b80`. All disposable experiment processes/servers are closed. The initial evaluation left repository
source at the strictly validated phase-cache checkpoint; the root-identity candidate and its current
validation state are recorded above.

Keep this reproduced association defect, the separate output-change warning and the missing input
receipt distinct. Private phase stamps must not become the source-freshness authority. Optional
diagnostic reads still need accepted-output association under the full publication contract.

This owns TypeScript discovery queries, not the complete frozen pack/external execution frame.
Node imports, esbuild/Vite/content execution, ambient preloads, long-lived frontend lifetime, atomic
input/output publication and passive freshness consumers remain required. Do not switch mtime readers,
claim source freshness complete or waive any later phase on this narrower checkpoint.

## Design review before further implementation (2026-10-12)

The user requested a design review after the assistant draft introduced an unjustified feature, actor,
entity and event contract. Implementation is held at `29431f57b`; the uncommitted draft is not an accepted
checkpoint. Continue the full goal, beginning with this review rather than building on that draft.
See the corrected responsibility and lifecycle requirements in
[settings architecture](../../plans/settings-architecture.md#onboarding-design-correction-2026-10-12).

This is an architectural disposition, not a claim that all 220 changed files have been reviewed:

| Change family | Requirement / current evidence | Disposition and next proof |
|---|---|---|
| JSON Schema/defaults and generated settings types (`839dec923`, `b6ec616b0`, `74a48e0f3`) | One declarative value contract; shipped definitions are data and types derive from schemas | Retain as candidate foundation. Review defaults/override/reset semantics and supported schema behavior through the same live writer for all three owners. |
| Host app ownership (`29431f57b`) | App defaults and validation work without a pack; prior changes also added old-format boot/import conversion | Retain host ownership as candidate foundation. Remove unnecessary historical-format accommodation; verify current-format lifecycle preservation and explicit-choice semantics through the integrated writer. |
| Snapshot reader and declaration stamps (`d801b5580`, `23b4b026a`, `b085edd3d`) | Discovery requires data matching generated implementations | Review as one boundary: declaration identity is distinct from executable bytes. Binding membership/completeness remains unfinished. |
| Publication, receipt, staging and copy checks (`44cc56fb1`, `b7d1d10fe`, `8f137ced9`, `20c8194e7`, `ccc9e605f`) | Failed or mismatched builds must not replace the accepted build | Review each check against a named publication/copy transition. Consolidate duplicate policy; retain verification where copying or mutable inputs can change bytes. Frozen dependency/tool inputs and frontend delivery remain incomplete. |
| Catalog prototype (`18116c99a`) | Installed settings must be discoverable without activation | Exported/tested, but no production consumer. Do not call discovery delivered. Connect the common catalog to a complete settings path before expanding further abstractions. |
| Uncommitted assistant draft | Preserve onboarding state outside preferences | Reject its new feature/actor/entity. The real Brain stops after restore; the mock concealed lost delivery. Reuse existing owners and prove the corrected event sequence. |

For each family, inspect authoritative readers, writers, failure paths and behavioral coverage; record
concrete findings in its owning plan. Green tests demonstrate only what their assertions exercise.
The source audit found old-format migration complexity and missing live validators. The user clarified
that there are no users and no backwards compatibility is required. Do not repair obsolete-key handling
by creating more compatibility storage or reader branches. Current-format overrides for disabled or
uninstalled packs still need preservation. The settings writer currently takes validators from runtime
registration; catalog-only tests do not prove disabled settings behavior.

The next implementation must demonstrate the full settings route: host app preference, two same-named
pack groups and a feature preference, all through declarations -> installed common catalog -> effective
values -> trusted owner-bound access -> edit/reset -> notifications -> export/import. Include a disabled
or activation-failed pack, a restricted dependency, and an unavailable custom form. This is the first
integrated checkpoint, not a reduction of the goal or a substitute for remaining contribution kinds.

The user identified the retained default-setup `src/app-settings` assembly as a missed architectural
boundary. Delete that directory, `content/default-settings.ts`, their aliases and pack whole-document
types together with `settingsSections` and arbitrary section addressing. Do not rename/rearrange the
assembly or commit catalog integration as a substitute for removing it. Follow the audited deletion and
integrated owner-contract checkpoint in
[settings architecture](../../plans/settings-architecture.md#remove-the-packs-app-settings-abstraction).

The rejected assistant draft has been removed and bindings regenerated. Before further implementation,
settle real root/client readiness semantics in the settings plan. Do not invent a lifecycle field to
retain the obsolete timestamp or move domain-specific logic into Brain instead of designing the boundary. All Phases 0–7 and all three Phase 6 workstreams remain required.

## Progress

Record the completed naming baseline at kickoff, then implementation evidence as work proceeds:

| Checkpoint | Commit | Validation / outcome |
|---|---|---|
| Naming prerequisite | `3d389b9c8` | Ancestry verified against master `d7e77829a`; archived completion included |
| Kickoff / Phase 0 | `70408039e`; base `d7e77829a` | Initial isolated setup, independent `npm ci`, default-setup/runtime builds and six doc checks passed. Full strict chain passed: 30 steps, `npm run chain -- --strict --all --cores 2` (270.9s). |
| Contribution inventory | `b5761c0db` | BE/FE registration and nested metadata coverage audited in discovery plan; six doc checks passed. |
| Main-checkout promotion | Branch preserved at `b5761c0db` | Both checkouts were clean; switched main checkout to `session/settings-pack-contracts` at user request. |
| Schema prototype | Disposable `/private/tmp/apack-settings-schema-prototype` | Ajv 8.20.0 / json-schema-to-typescript 15.0.4 passed pure validation, optional/nullable/enum/record/array/local-reference and generated-type probes; no runtime contracts changed yet. |
| Shared diagnostics | `fd11b82ff` | SDK checks 52, CLI resolution/report checks 66, external validation checks 10 and doc links 6 passed. Incomplete-result guard mutation was caught. `npm run chain -- --strict --cores 4` passed all 30 steps (229.6s); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T11-30-43Z-30065`. `validate --json` is read-only and exits 0/1/2 for valid/invalid/incomplete. |
| Settings contract kernel | `839dec923` | 29 focused validator/generator checks passed, including strict generated-type checks and guard mutations. Public SDK API reports regenerated. `npm run chain -- --strict --cores 1` passed (13.2s, 28 cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T12-12-30Z-16840`. Earlier concurrent app runs passed functional assertions but timed out closing Electron; isolated retries and the serial chain passed. No settings consumers switched yet. |
| Shared snapshot reader | `d801b5580` | 118 focused snapshot/manifest/format checks and six doc checks passed; schema-refusal and original-record name guard mutations were caught. Producer, CLI, harness and loader validate the same current-format data contract. `npm run chain -- --strict --cores 1` passed (152.3s, 23 cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T12-51-44Z-96251`. An earlier process-cleanup assertion failed; four isolated checks and the final chain passed unchanged. Descriptor/catalog publication, settings conversion and trusted caller binding remain unfinished. |
| Declaration/runtime agreement | `23b4b026a` | Manifest identities agree across snapshots and generated BE/FE bindings; loaders refuse mismatches before registration. Active origins retain the accepted identity. Fixed resolved-path require-cache cleanup exposed by version-changing reloads. 87 focused checks, 150 lifecycle checks, six doc checks and four guard mutations passed. Reviewed SDK API reports. Strict chain passed (259.9s, nine cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T13-39-03Z-69678`. Full descriptor/catalog, staging coherence and trusted settings caller binding remain required. |
| Inline pack declarations / catalog prototype | `18116c99a` | 137 focused checks, six doc checks and three guard mutations passed. Reviewed manifest editor schema and SDK API report. Strict chain passed (310.2s, one cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T14-08-48Z-18516`. An architecture check initially mistook schema prose for a pack entity name; clarified the prose without weakening the check. Host catalog owns immutable snapshots and reads disabled pack groups without activation. Production consumers, full descriptors, staging coherence and trusted handles remain unfinished. |
| Staging declaration coherence | `b085edd3d` | Current-format snapshots and source/installed manifests must agree before staging or teardown, including installs with unknown target format. Foreign-format policy stays explicit. Temporary staging is cleaned on refusal. 364 host pack checks, 27 release-fixture checks, six doc checks and three guard mutations passed. Strict chain passed (180.9s, 16 cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T14-28-19Z-88313`. Release stand-ins now regenerate declarations and ignore build output; release implementation/metadata unchanged. Full source-input freshness, descriptor/binding completeness and runtime settings integration remain required. |
| Authored-input scopes / publication stability | `44cc56fb1` | Shared scope covers module sources outside src, generated bundle entries and all asset extensions; codegen tracks captured declarations and SDK source. Builds refuse persistent authored-input changes before publication and retain the previous build. 42 focused checks and three guard mutations passed. Strict chain passed (282.0s, one cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T14-44-50Z-20334`. Complete external/dependency identities, a coherent frozen build view, descriptor completeness and runtime settings integration remain required. |
| Async codegen / schema-derived pack group types | `b6ec616b0` | `generatePackFiles` now returns a Promise across SDK/CLI callers. Facades export schema-derived `PackGroupSettings`; per-group referenced types remain independent. Generation holds its lock through settlement and preserves prior files/stamp on rejection. 156 focused checks, six doc checks, SDK/CLI typechecks and two mutations passed; removal of type isolation or generation awaiting is caught. Strict chain passed all 30 steps (333.0s); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T15-08-26Z-56743`. Feature conversion, typed group handles, trusted caller policies, production catalog integration and complete build/dependency freshness remain unfinished. |
| Inline feature declarations / schema-derived feature types | `74a48e0f3` | All 11 shipped definitions, external fixtures and scaffolds use inline JSON Schema/defaults; navigation visibility belongs to `surface.defaultVisible`. The conversion audit compared 844 probes with the previous effective-value schemas. Focused host checks (453), shipped checks (47), schema/codegen edge checks (102) and scaffold/dependency-runtime integration checks (13) passed. Three guard mutations caught schema ownership, non-JSON writes and unsafe generated object literals. Reviewed editor schema, SDK reports and shipped facade. Strict chain passed (226.6s, 14 cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T15-55-35Z-29737`, including external and packaged app checks. Two earlier runs exposed stale fixture assertions; both were corrected and verified. Host ownership, pack handles, trusted policies, forms, stored-data migration and production catalog/freshness integration remain required. |
| Installed build verification / accepted identity | `b7d1d10fe` | The shared reader validates declarations against verified file bytes before runtime execution and refuses concurrent declaration/build replacement. Installer identity checks run before placement; shipped refresh verifies receipts before reporting current and repairs invalid copies. Focused host pack checks (382), install/refresh checks (78), restored race/docs checks (139), CLI/layout checks (78) and four guard mutations passed. CLI install tests now use isolated storage even when run directly. Strict chain passed (291.7s, one cached); evidence `node_modules/.cache/apack-chain/runs/2026-10-12T16-30-32Z-32191`, including external and packaged app checks. An earlier unrelated process-cleanup integration failure passed unchanged in isolation and subsequent chains. Source-build sealing, complete dependency/frozen-input identities, production catalog wiring, binding membership, frontend asset delivery and settings ownership/policies/migration remain required. |
| Producer-owned output receipts / verified staging | `8f137ced9` | Build publication now includes the canonical manifest and complete integrity inventory; reuse verifies the previous output, and staging/shipped comparison refuse edited output. Staging verifies copied bytes before replacing the prior stage. Focused pack/runtime/CLI/docs checks passed (480), three additional boot/lifecycle fixture checks passed (6), release fixture integration passed (27), and four guard mutations were caught and restored. Synthetic producers now seal their completed files. Final strict chain passed (208.5s, 17 cached), evidence `node_modules/.cache/apack-chain/runs/2026-10-12T16-52-29Z-8008`, including external-pack app, smoke and packaged authoring/app. Earlier runs identified unsealed simulated producers; those fixtures were corrected without relaxing guards. No release behavior/version metadata changed. Live DSL output writes, frozen authored/dependency/tool input views, accepted placement/frontend copies, production catalog wiring and checked bindings remain required; settings ownership and all later phases remain unfinished. |
| Staged DSL generation / frontend definition coherence | `20c8194e7` | DSL bundling writes directly into staged output; the frontend resolves and hashes that same definition tree. A real cold/failing/recovered/reused/removed-definition build proves preservation of the accepted build, receipts, read record and cache, matching frontend/declarations, reuse and removal of obsolete output. Missing staged definitions refuse the older published copy. Focused unit/docs checks (34), DSL integration (7) and three restored guard mutations passed. Strict chain passed (295.0s, one cached), evidence `node_modules/.cache/apack-chain/runs/2026-10-12T17-03-47Z-41045`, including external-pack, smoke and packaged authoring/app. The live DSL output write gap is closed; frozen authored/dependency/tool inputs, accepted placement/frontend copies, production catalog wiring and checked contribution bindings remain required, as do settings ownership and all later phases. |
| Verified installation candidates | `ccc9e605f` | Copies and verifies the complete accepted layout before teardown, compares the exact receipt including provenance, rechecks copied compatibility/ownership, and gives hooks an independent descriptor. Copy/validation refusals retain the prior files and skip teardown; hook refusal cleans the candidate without promising rollback of arbitrary hook effects. Broad host/CLI checks passed (476 tests, 36 files); five restored guard mutations failed their targeted assertions. An initial parallel chain hit the process-cleanup grandchild assertion; all four process tests passed unchanged in isolation. Strict serial chain passed (118.4s, 26 cached), evidence `node_modules/.cache/apack-chain/runs/2026-10-12T17-30-08Z-25422`; external-pack, smoke and packaged checks passed in the earlier run `2026-10-12T17-26-16Z-81782` and were reused. Frontend delivery/catalog publication, frozen inputs, checked binding completeness and settings ownership/migration remain unfinished. |

| Host app ownership / stored app migration | `29431f57b` | Host JSON Schema/defaults and schema-derived SDK types now own hotkeys, personal info and ordered projects at `app`; default-setup no longer supplies them, and all active app consumers/forms use the new location. The host 0.4.0 raw migration preserves destination choices, orphan data and project/directory order, prunes copied historical defaults and handles the legacy projects wrapper. Real boot, reset and backup import checks passed. Fixed the shared writer admitting newly missing required fields and allowed removal of existing orphan section fields without new undeclared writes. Host/CLI lifecycle checks passed (546), rebuilt migration/settings checks passed (74), real import/docs checks passed (25), shipped migration/event checks passed (51), and the full shipped suite passed (834, two already skipped). Project form interaction checks passed (3); eight restored guard mutations were caught, with disposal strengthened after Vue's unmounted emit suppression hid the first probe. Reviewed public SDK API report and generated type parity. Strict chain passed (188.4s, 16 cached), evidence `node_modules/.cache/apack-chain/runs/2026-10-12T17-57-59Z-93144`, including external-pack app, smoke and packaged authoring/app. The final strengthened-test chain passed (64.7s, 21 cached), evidence `node_modules/.cache/apack-chain/runs/2026-10-12T18-02-21Z-20394`, reusing unchanged accepted app outputs. The earlier strict run identified an external fixture still asserting general; it was migrated and independently verified. Pack groups/handles, trusted policies, assistant lifecycle, window settings runtime/CAS, full catalog/binding/freshness and later phases remain unfinished. |

### Design review checkpoint

Reviewed the responsibility boundaries at `29431f57b` plus the uncommitted draft. Source inspection
exposed an obsolete provider-key assumption and lost delivery to a stopped Brain. This checkpoint
records those corrections, the requirement-to-change-family disposition,
the confirmed unresolved-key preservation defect, and the missing live catalog/validator integration.
The review does not clear the whole PR or establish completion of any remaining phase.

The rejected draft's strict chain passed in 416.1s, evidence
`node_modules/.cache/apack-chain/runs/2026-10-12T18-24-24Z-53935`; this is explicitly insufficient design
acceptance because its restore assertion mocked the stopped receiver. No assistant implementation is
committed. Further implementation starts with rejected-draft cleanup and real-runtime probes, followed
by a complete settings route; rejected draft cleanup must preserve unrelated work.

### Compatibility correction (2026-10-12)

The lead developer explicitly rejected backwards compatibility for a product with no users. This
correction supersedes historical-format preservation and automatic settings conversion requirements
in earlier plan text and progress evidence. Those recorded checks describe prior work, not acceptance
criteria to retain. Target one current contract, update all owned callers together, and remove obsolete
readers, invalid-value exemptions and historical timestamp scaffolding. Preserve current-format
export/import and unavailable-pack override lifecycle behavior. The tested developer backup stays
untouched; any necessary conversion is separately invoked on a copy, outside normal runtime behavior.
All Phases 0–7 and the three Phase 6 workstreams remain in scope.

### Current settings contract cleanup

Removed host/default-setup historical conversions and their fixtures/tests. Writes validate complete
available app/feature values, without unchanged-invalid exemptions or unchanged-unknown-root acceptance.
Real current-format restore covers app preferences, onboarding completion and unavailable feature
retention. Migration version-line infrastructure remains for deliberate future changes. Focused host
checks (81), API backup checks (7), and strict chain passed (351.5s, six cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-12T19-03-47Z-16723`, including external and packaged app
checks. Raw import preflight, catalog-fed settings definitions, owner handles, onboarding readiness and
all later phases remain unfinished. No subsystem plan is complete or ready to archive.

### Onboarding design evidence

Six real-flow characterization probes confirm lost initialization before a usable root, missing workflow
resumption after data replacement/restart, and duplicate live workflows behind idempotent thread reuse.
Root-entry initialization alone loses frontend thread-opening effects because pre-client output is
ignored. The settings plan now selects generic once-per-root-run `client.ready` delivery, with eligibility
and progress in the authored workflow. No assistant feature/entity, historical timestamp or Brain
onboarding policy is needed. Probes did not establish real multi-window, pack reload or database restore
acceptance; those remain implementation gates. Temporary broken-behavior assertions were removed after
retaining probe sources/log outside the checkout. All goal phases remain unfinished as previously recorded.

### Onboarding readiness checkpoint

The authored root now checks host completion on actor-bound `client.ready`. Brain remembers its existing
first-client fact and replays readiness to a new root; Threads no longer contains onboarding/provider
policy, a process-wide start guard or a historical timestamp. No assistant feature/entity or old-field
conversion is introduced. Real workflow tests cover reconnect, pause, late root, replacement/restart,
completion and custom roots; real LMDB restore preserves progress and requires explicit restart.
Focused checks (38), API reset/restore checks (3), content checks (145) and two guard mutations passed.
Strict chain passed (225.5s, 16 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-12T19-35-10Z-62769`. An earlier typecheck failure exposed an
unnecessary event payload, which was removed. Multi-window and pack-reload acceptance remain outstanding,
along with the catalog, settings handles/frontend runtime and later phases; no plan is ready to archive.

### App-settings boundary correction

Audited all remaining assembly callers after the user's correction. The directory contains a root-section
thunk, a pack-authored whole-document type and an unused hotkey schema; the assistant baseline remains in
a separate content source. Section APIs and transport targets still encode the old ownership. The plan
now requires deletion of this abstraction in the integrated app/pack/feature contract change, rather than
relocation. This turn's partial installed-catalog draft was discarded from source and retained only as
`/private/tmp/apack-catalog-draft-before-owner-redesign.patch`. Its focused run passed 99 checks and caught
one loader fixture registering a settings definition absent from its manifest; future integration must
correct that fixture rather than relax declaration agreement. No production catalog integration was
committed and no settings phase is complete.

### Settings owner-contract rewrite — in progress, 2026-10-12

The working change deletes default-setup's app-settings assembly, its duplicate content defaults,
whole-document types and aliases. Assistant preferences are inline pack-group declarations. The
shared SDK document has fixed app/packs/features owners; arbitrary section addressing and the
separate runtime defaults store are removed. The host writer validates every owner against the
common catalog and retains explicit default-equal choices until reset. Document checks share the
SDK JSON-data validation and reject malformed ownership and non-JSON data before persistence.

Focused owner/discovery checks passed: 64 host checks across document, writer, app definitions,
catalog, verified installed discovery and command registration. These include same-named independent
groups, default changes/reset, unavailable current-format overrides, dependent/owner mutation policy,
invalid writes, immutable publications and retaining accepted declarations on malformed replacements.
The SDK typecheck and 40 focused frontend/handle/codegen checks passed. Evidence is recorded in
`/private/tmp/apack-settings-owners.log` and `/private/tmp/apack-settings-sdk-focused.log`.

This is **not a completed checkpoint**. Host typechecking still reports unmigrated test contracts;
renderer settings still depend on the Settings view. Trusted execution/sender binding, window
readiness and correlated outcomes/CAS, import preflight, generated files/API reports and full
integrated acceptance remain required before committing this working change. Later goal phases
also remain unfinished. Focused writer policy tests do not prove caller provenance at transport or
loader boundaries.

### Window settings runtime — working integration, 2026-10-12

The current working change binds renderer settings to one window resource before the shell starts,
intercepting settings snapshots/outcomes on the existing bus subscription. The Settings view no longer
holds shared values, loading state or save status. SDK writes return correlated results; each form's
save composable tracks its own requests. Complete snapshots carry backend-run identity, publication
revision, readiness and the declaration catalog. Reconnect obtains a freshly correlated snapshot;
stale runs/revisions, timeouts, disconnect and disposal are handled independently of surface activation.

The writer compares a draft's original value and backend run before replacement. Unrelated settings
changes do not reject a targeted edit. Projects retains dirty drafts across incoming values and emits
its original comparison; whole-document JSON editing also supplies a comparison and preserves refused
text. Data-replacement boundaries advance the publication revision and refuse pack mutations.

Window/runtime/store/presentation checks passed 36 tests; SDK frontend/handle checks passed 10.
Final follow-up checks passed: 32 window/writer tests, six renderer adapter/Projects tests, SDK
typechecking and renderer typechecking. Projects tests exercise actual inputs and the runtime over a
mocked transport, including draft retention and its original comparison. Logs:
`/private/tmp/apack-settings-window.log`, `/private/tmp/apack-settings-sdk-window-tests.log`,
`/private/tmp/apack-settings-renderer-current.log`, `/private/tmp/apack-settings-renderer-tests.log`.

This is still **uncommitted, incomplete integrated work**. Caller-bound frontend access and trusted
loader/sender provenance are not implemented by a host-owned window port. Import preflight, catalog-fed
custom-form discovery/loading, remaining test/caller migration, generated/public files, full app
acceptance and later goal phases remain. These focused instances are not actual two-window Electron
acceptance. Do not treat transport labels or caller-provided targets as authorization evidence.


### Assembly-removal audit and writer follow-up — working changes

The default-setup guide no longer describes the deleted app-settings directory, executable section
assembly, settings content defaults or removed aliases. Its ownership and access examples now distinguish
host app preferences, inline pack groups, feature definitions and custom forms. Source searches find no
remaining default-setup assembly references or SDK/host section-default APIs.

Migrated host lookup, registration, lifecycle and event fixtures to catalog definitions and independent
surface visibility. The installed-loader fixture now declares its settings in the sealed manifest and
publishes that catalog before registration; it does not rely on executable defaults for discovery.
Focused catalog/registration checks passed 75 tests, and loader/lifecycle/event checks passed 85 tests.
Host and SDK typechecking passed. The caller-bound service facade had dropped the draft comparison;
it now forwards that condition, with 10 SDK runtime/handle checks passing. The writer refuses malformed
stored rows instead of treating them as absent defaults, and isolates subscriber failures after accepted
writes and across replacement boundaries; 38 app/writer checks passed. Evidence:
`/private/tmp/apack-settings-catalog-callers.log`, `/private/tmp/apack-settings-loader-callers.log`,
`/private/tmp/apack-settings-service-forwarding.log`, `/private/tmp/apack-settings-store-current.log`,
`/private/tmp/apack-settings-host-current.log`, `/private/tmp/apack-settings-sdk-current.log`.

Live writes and backup preflight now share pure catalog validation. Real API/LMDB import checks passed
10 tests, including refusals for invalid app values, obsolete roots and null settings before live data
replacement. CLI typechecking passed. Import retains well-formed overrides for unavailable owners;
editing cannot create or change those unavailable-owner values. Evidence:
`/private/tmp/apack-settings-import.log`, `/private/tmp/apack-settings-cli-current.log`.

This remains an uncommitted integrated rewrite. Trusted loader/transport caller binding, catalog-driven
form loading, generated frontend group/dependency interfaces, migrated pack/API test callers, public
builds and actual app acceptance are still required. Backup source/staging consistency also needs
review before claiming refusal atomicity for concurrent changes. Existing working-integration evidence
above supersedes the earlier statement that the renderer still reads the Settings view; it does not
supersede the outstanding authorization or real-window acceptance requirements.


Full host suite follow-up: 981 tests across 91 files passed
(`/private/tmp/apack-settings-host-suite.log`). The first sandbox run stopped at child-process IPC;
the authorized isolated-fixture run exposed seven failures. Corrected the reload fixture's installed
origin and reset its catalog between cases, made the immutable layout section list readonly, and
updated declaration-refusal assertions. A disabled pack retains its declaration diagnostic, since
turning activation off does not make an invalid manifest discoverable. No validation guard was relaxed.
This is host-suite evidence only; the integrated commit and full strict/app acceptance remain pending.


### Generated settings handles and subscription unification — working changes

Generated backend handles now expose scoped reads/subscriptions and typed write/reset. Both local and
qualified own selectors resolve to the same owner. Dependency handles become readonly when the accepted
dependency declaration specifies owner-only mutation; the frontend follows the same policy and now has
pack-group composables. Schema-derived values retain path/value pairing. Compiler probes cover shared
and restricted dependencies for groups and features, own owner-only definitions, empty settings maps,
wrong selectors/value types and creating a handle during feature-service module initialization.

Backend subscriptions observe catalog-default changes as well as accepted writes, retain user choices,
and release their catalog listeners on unsubscribe. The Settings actor's separate defaults listener and
internal defaults event are removed; it consumes the same service notification path as other consumers.
Focused interface/compiler checks passed 45 tests; focused host runtime/writer/subscription checks passed
51. Subsequent full suites passed 895 SDK tests (78 files) and 982 host tests (91 files).
Evidence: `/private/tmp/apack-settings-typed-handles.log`, `/private/tmp/apack-settings-subscriptions.log`,
`/private/tmp/apack-settings-sdk-suite.log`, `/private/tmp/apack-settings-host-suite.log`.

Public feature authoring prose now describes the three owners, explicit choices, retained disabled
contract data, local form save state and the renamed feature/group accessors. Regenerated the public
manifest schema, SDK API reports and shipped pack facade. Normalized generated report line endings to
retain reviewable diffs. Full local package builds succeeded. Renderer typechecking passed after its
standard library was aligned with Electron's ES2022 support, including existing Error.cause usage.
Harness typechecking also passed. The first report update correctly refused stale packages; it ran
after rebuilding them. Logs: `/private/tmp/apack-settings-packages-build.log`,
`/private/tmp/apack-settings-renderer-handles.log`, `/private/tmp/apack-settings-harness-handles.log`,
`/private/tmp/apack-settings-api-update.log`, `/private/tmp/apack-settings-pack-facade.log`.

Shipped-pack acceptance is still incomplete. Its first full suite could not collect because newly added
host administration imported source-only SDK runtime internals from the published harness. Replaced
that import with an internal SDK service entry sharing the bound SDK instance; ordinary pack services
still omit administrative methods. The new entry and the final codegen fix require another API-report
refresh. The shipped-pack typecheck also found unmigrated branded feature refs, frontend targets and test
callers, plus an accidental backend dependency field emitted in frontend registrations. Source targets
and that field are corrected; rebuilt typecheck/tests and remaining test migration are next. This is
not yet proof of loader/transport caller provenance, which remains mandatory before the integrated
checkpoint. No goal phase is marked complete by these partial checks.


Content-build correction: adding a ref-resolution import to actions was refused by the content
compiler's existing no-package-import rule. Removed those imports. A serialized `SettingsTarget`
accepts a qualified string ref, with runtime grammar/declaration checks, while generated selectors stay
schema/manifest constrained. The compiler probe also rejects a bare serialized feature name. This
changes the settings transport input, not EARS or the SDK's branded `FeatureRef`. No content compiler
guard or import policy was relaxed. Rebuilding packages and shipped content after this correction is
still in progress; previous green suites do not prove these final source changes.


Final source follow-up: SDK and host typechecking passed after the serialized-target correction, full
local packages rebuilt, and the shipped pack build passed including compiled content and frontend.
Final compiler/frontend/runtime probes passed 23 tests. Refreshed the three subsequently changed SDK
API reports and normalized line endings. Evidence: `/private/tmp/apack-settings-final-handle-checks.log`,
`/private/tmp/apack-settings-sdk-handles.log`, `/private/tmp/apack-settings-host-subscriptions.log`,
`/private/tmp/apack-settings-default-setup-build.log`, `/private/tmp/apack-settings-api-update.log`.

The rebuilt shipped suite collected successfully after the private-entry fix: 707 passed, 110 failed,
two skipped, and 74 unhandled errors across 108 files (`/private/tmp/apack-settings-pack-suite.log`).
Many failures trace to the harness registering installed-origin runtimes without publishing their
accepted definitions into the common catalog. The harness now verifies the pack's built build,
checks its declaration revision against the source manifest, validates dependency snapshot identities,
and publishes those declarations before starting/registering runtimes. It reads no settings defaults
from executable registrations. Harness typechecking and its package build passed; real actor checks
are running in `/private/tmp/apack-settings-harness-activation.log`. The pack typecheck now reports
primarily tests still using removed settings APIs (`/private/tmp/apack-settings-pack-typecheck.log`).
Those tests require migration, not compatibility methods. The last unused source import was removed.
Full pack acceptance and the larger integrated checkpoint remain unfinished.


Harness activation follow-up: all 13 real actor/schedule/subflow checks across three shipped-pack
files passed (`/private/tmp/apack-settings-harness-activation.log`). This verifies that the published
harness can load, settings declarations are available before actor boot, and the real Brain/schedule
paths run and stop correctly. It does not substitute for full shipped-pack or real Electron acceptance.

### Shipped-pack owner reset and identity checks — working changes

Migrated reset, secrets, onboarding and feature-identity tests to the current owner contracts. Scoped
reset requires an explicit app, pack/group or feature target; whole-document reset is the separate host
`RESET_ALL_SETTINGS` event. Missing-target refusal leaves overrides intact. App and pack-group resets
preserve other owners, and resetting all preferences preserves onboarding progress and AppState lifecycle
facts. Generated local and qualified handles reach the same feature. An unrelated registered pack does
not grant read/write/reset access without a declared dependency. Tests inspect persisted rows through
EARS rather than restoring an administrative API on pack services.

Focused settings/onboarding checks passed (18), followed by identity, CLI routing and real Brain/Flow
checks (27). Evidence: `/private/tmp/apack-settings-owner-reset.log` and
`/private/tmp/apack-settings-owner-identities.log`. Removed stale content-guide instructions to export
feature defaults and the deleted settings content entry; SDK/host guides now describe catalog definitions
and the current store constructor. `git diff --check` passes. The shipped-pack typecheck still fails in
`feature-settings-updated.spec.ts` and `pack-settings-defaults.spec.ts`, whose old aggregate defaults and
administrative service calls remain to migrate. No full-suite or integrated acceptance claim follows
from these focused checks. Caller binding/transport policy, catalog-driven custom forms and all remaining
phases are unfinished; the integrated rewrite is still uncommitted.

### Complete shipped settings caller migration — working integration

The shipped pack no longer calls the removed aggregate defaults/section/settings-administration APIs.
Notification fixtures write through their own registered pack identity; host replacement fixtures enter
`whileReplacingData` so replacement suppresses incremental diffs and publishes final values on success
or failure. `getTestSettings()` on the test harness provides explicit host fixture administration and
throws outside an active test; ordinary pack services gain no administrative methods. Whole-document
editor checks now retain explicit default-equal choices rather than pruning them.

The first full shipped suite found six remaining old-event failures in directory updates, reset broadcasts
and request outcomes. Migrated those payloads and strengthened the reset broadcast case by changing a
hotkey before reset and asserting the default reaches the shell. Focused notification/catalog checks
passed (33), then request/broadcast/directory checks (7). The shipped-pack typecheck passes and the full
suite passes: 817 tests, two existing skips (107 files passed, one skipped). Evidence:
`/private/tmp/apack-settings-notification-catalog.log`,
`/private/tmp/apack-settings-window-notifications.log`,
`/private/tmp/apack-settings-pack-typecheck.log`, `/private/tmp/apack-settings-pack-suite.log`.

A further caller audit found the drive engine still manufacturing section payloads and reading only the
sparse database row. It now reuses SDK `SettingsTarget` for app, pack/group and feature writes and reads
`GET_SETTINGS` through the existing correlated request path, returning the host snapshot. The reply
waiter extracts the declared snapshot field for this read, retaining the existing result field for query
and transaction operations. The testing package suite passes (111), its typecheck passes, and the public
testing/drive guides describe the new contracts. Evidence:
`/private/tmp/apack-settings-harness-admin-suite.log`,
`/private/tmp/apack-settings-harness-admin-typecheck.log`.

These results do not prove trusted loader/transport caller binding, catalog-driven custom forms,
multiple-window packaged behavior or full discovery. Those remain required before the integrated
removal checkpoint is committed. All later phases remain active.

### Runtime settings admission audit — working changes

Registration's settings comparison used truthy filtering, silently treating null/false/zero/empty-string
feature definitions as absent. Its pack-group comparison also treated null as absent. Both now preserve
provided values for comparison against the accepted declarations; malformed runtime settings are refused
before services or catalog data publish. Registration, origin and manifest identities must agree.
Seven independent-registry cases assert refusals leave catalog identity and registered services unchanged.

All three deliberate guard mutations were caught, with source restored: removing identity admission
failed two cases; restoring truthy feature filtering failed four; restoring null-as-absent pack groups
failed one. Evidence: `/private/tmp/apack-settings-admission-mutation-{identity,falsey-feature,null-pack}.log`.
Focused registration/loader checks passed (108). The full host suite initially exposed a bus fixture
registering a fake second frontend pack under the first pack's origin. Replaced it with one registration
whose recorder, frontend files and origin share the same identity; readiness assertions are unchanged.
The full host suite now passes (989 tests, 91 files), host typecheck passes, and `git diff --check` passes.
Evidence: `/private/tmp/apack-settings-runtime-admission.log`,
`/private/tmp/apack-settings-host-suite.log`,
`/private/tmp/apack-settings-runtime-admission-typecheck.log`.

This repairs admission checks; it does not implement trusted caller injection. The generated backend
settings service still closes over a generated pack ID, and the frontend settings port remains host
administration. Actual loader-bound/revocable caller access and untyped transport policy are unresolved;
so are catalog-driven forms and the later goal phases. The integrated removal remains uncommitted.

### Backend accepted-runtime settings binding — working integration

Removed the generated factory that took a pack ID and reached ambient host administration. Generated
services now create a runtime-local `_createPackServices()` binding; the generated registration exposes
its `bindSettings` hook. The registry obtains a scoped service from the host composition callback using
the accepted registration identity, and records revocation with the existing contribution undo log.
The API composition and published test harness supply that callback. Before binding and after unload,
retained handles refuse settings access; revocation disposes subscriptions and is idempotent. A refused
registration receives no capability, and failed catalog publication revokes a provisional binding.

The host-store integration checks cover local writes, retained override data after unload, shared
dependency read/write/reset and owner-only mutation/reset refusal. Generated-runtime tests also cover
pre-binding access, repeated binding refusal, subscription disposal and stale repeated cleanup after
rebinding. Removing revocation failed its guard case; substituting another caller ID failed both caller
and policy cases. Mutation sources were restored. Evidence:
`/private/tmp/apack-settings-binding-mutation-{revocation,caller}.log`.

Public packages and the shipped pack rebuilt successfully. SDK reports and exact generated-contract
coverage include the binding; the owning settings plan describes the mechanism and its frontend limits.
The full SDK suite passes (896), full host suite passes (993), rebuilt shipped suite passes (817, two
existing skips). SDK/host typechecks pass. API typechecking first found two old app-reset settings calls;
these now use explicit host administration. All API typechecks pass, and real LMDB reset/restore checks
pass (13). The invalid-backup fixture now seeds valid live data independently after exporting its
intentionally invalid candidate, instead of asking the writer to read a null fixture row. Evidence:
`/private/tmp/apack-settings-runtime-binding-{sdk-suite,host-suite,pack-suite}.log`,
`/private/tmp/apack-settings-runtime-binding-api-types.log`,
`/private/tmp/apack-settings-runtime-binding-api-integration.log`.

This completes this backend binding path, not the full policy requirement. The frontend port still
carries administrative authority; generated frontend code and raw transport require accepted caller
binding. Catalog-driven custom forms, multiwindow/packaged acceptance, remaining discovery/binding
completeness and all later phases remain unfinished. The integrated removal is still uncommitted.

### Frontend settings transport audit and authorization component — working changes

The actual frontend boundary still exposes host administration. `bus.send` checks addressability but
explicitly does not authenticate `from` or `sender`; connection identity is server-stamped. Frontend
readiness also supplies no settings authority. The owning plan now specifies a host-issued,
connection/runtime-bound credential outside event payloads, preserving existing request correlation.
Generated frontend access must receive the resolved scoped port; raw transport must refuse absent or
invalid credentials and keep pack scopes away from whole-document operations.

Added `createSettingsAccess` in host settings with distinct host administration and pack service grants.
Pack issuance checks the accepted ID and nonempty declaration/build stamps. Resolution rejects
unknown credentials, another connection, replacement/unload and acceptance metadata changed in place.
Revocation is connection-owned, and disconnect releases all of that connection's grants. Ten focused
checks and host typechecking pass, including the added identity/metadata cases. Evidence:
`/private/tmp/apack-settings-transport-access.log`,
`/private/tmp/apack-settings-transport-access-types.log`.

The component is not yet consumed by API ingress or renderer ports. No policy-completion claim or
standalone checkpoint commit is made. Next: accepted frontend/tool/host issuance, existing bus delivery
integration, per-connection disposal, injected frontend ports and raw transport refusal tests. Custom
forms, multiwindow/packaged acceptance and all remaining goal phases stay required.


### Window snapshot admission and shared settings boundary — working integration

Window snapshots now validate their shape, revisions, declaration owners, schemas/defaults and effective
values before publication. Validation does not complete missing values from defaults. Invalid initial
reads end disconnected; invalid broadcasts retain accepted data. Unchanged revisions cannot silently
replace declarations or values. Subscriber exceptions are isolated; malformed refusal payloads and
unserializable writes settle explicitly without leaking pending requests.

The browser build exposed the JSON editor importing the backend settings barrel, pulling Node-only
persistence into the renderer. Pure `settings/document.ts` and `settings/validation.ts` now sit beside the
feature halves, and the frontend entry exposes document checks directly. Boundary checks distinguish
actual browser accesses from import-path text and inspect the frontend/shared-contract runtime closure
for Node-only dependencies. No pack application-settings assembly or compatibility path was restored.

The full host suite passes (1,024 tests, 92 files), both host and renderer typechecking pass, renderer
settings/Projects checks pass (six), and the production renderer build passes. A final boundary-only
strengthening also guards browser accesses in reached shared contracts; restored focused checks pass
(49 across three files), and final host typechecking passes. Removing semantic snapshot validation failed four cases, and adding a Node import to the
shared document failed the boundary check; both experiment sources were restored. Evidence:
`/private/tmp/apack-settings-window-admission-{host-suite,types,renderer,renderer-types,renderer-build}.log`,
`/private/tmp/apack-settings-window-{admission,boundary}-mutation.log`,
`/private/tmp/apack-settings-window-admission-final-{focused,types}.log`.

This closes snapshot admission defects, not frontend caller authorization. Accepted loader-bound ports,
raw transport policy, catalog-driven custom forms, actual multiwindow/packaged acceptance and remaining
goal phases are still required. The integrated settings extraction remains uncommitted until that path
is complete and validated.


### Generated frontend binding and registration cleanup — working integration

Replaced the ambient generated `_useSettings` accessor with a runtime-local `_createFeSettings()`.
Generated frontend entries expose `bindSettings`; handles capture their accepted port and refuse writes
or resets after unload, including after a cached module is rebound. Subscription disposal is idempotent
and attempts all cleanups even when one throws. Value-comparison conditions pass through unchanged.

The frontend loader obtains a host-owned port/disposal resource after declaration acceptance. The
registry records binding revocation and resource release in its existing contribution undo log. Missing
providers, rejected contributions, failed binding and duplicate registration are covered. A real generated
entry executes in a Node child process without any ambient host binding and proves feature/group target
resolution, accepted writes and revocation/rebinding behavior. Removing registry revocation failed the
unload guard; the experiment source was restored.

Published packages rebuilt and the SDK frontend API report updated. Full SDK checks pass (900 tests,
78 files), full host checks pass (1,031 tests, 93 files), and SDK/host typechecks pass. Restored
frontend registration checks pass (19). Renderer typechecking also passes after its test project adopted
the application's ES2022 built-in baseline for aggregate cleanup errors. Evidence:
`/private/tmp/apack-fe-settings-binding-{sdk-suite,host-suite,sdk-types,host-types,packages,api}.log`,
`/private/tmp/apack-fe-settings-binding-mutation.log`,
`/private/tmp/apack-fe-settings-binding-{restored,renderer-types}.log`.

The renderer does not yet supply this loader resource, and API ingress does not yet resolve settings
credentials. Generated frontends therefore require that implementation before an app checkpoint: no
administrative fallback or old accessor remains. Ambient public mutation APIs/callers, raw transport
policy, custom forms, actual multiwindow/packaged acceptance and remaining goal phases stay unfinished.
The integrated settings extraction remains uncommitted.

### Transport authorization and window-bound pack writes — working integration

API settings issuance now distinguishes trusted window/tool bootstrap from accepted pack access.
Pack credentials require the backend origin's declaration and verified build stamps. Raw bus writes
without credentials refuse; credentials stay outside the event and are stripped before bus dispatch.
A host-side event resolver is preserved through correlation copying and resolved again by the settings
actor, preventing a runtime removed after ingress from keeping authority at delivery. Whole-document
administration requires the host service. Connection abort releases credentials; cleanup is registered
once per shared abort signal rather than once per procedure context object.

The window settings resource now shares its validated snapshot with independently bound mutation
transports. Each binding owns its pending requests and subscriptions. Disposal settles only its writes,
prevents queued sends, clears reactive reads and remains permanent through reconnection. Host forms
and other pack bindings remain independent. This introduces no pack settings assembler or lifecycle
feature, and does not restore the removed default-setup app-settings abstraction.

The actual API router/bus/settings actor/writer test proves shared dependency writes, owner-only refusal,
independent trusted administration and revocation using the window resource. Native test declarations
and synthetic accepted origins mean this is transport/writer evidence, not installed-loader admission.
Mutating the bound port to use the administrative transport made the owner-only assertion fail; source
was restored and the route checks rerun. Host checks pass (1,035 tests, 93 files); focused host checks
pass (48), route checks pass (18), and host plus API application/test/scripts typechecks pass.
The initial sandbox host run could not run process/uptime checks; the authorized unrestricted rerun
passed. Evidence: `/private/tmp/apack-settings-scoped-port-{host,api,restored,mutation}.log`,
`/private/tmp/apack-settings-scoped-port-{host-types,api-types,api-test-types,api-script-types}.log`,
`/private/tmp/apack-settings-transport-host-suite.log`.

Renderer bootstrap and accepted-loader issuance remain unwired, as do catalog-driven custom forms and
ambient mutation caller removal. Reconnect audit found the shell currently retains loaded pack frontend
registrations when its bus connection drops (`BUS_CONNECTION_LOST` only changes `busSubscribed`);
its next loader run skips those IDs. Binding disposal therefore requires a coherent frontend reacceptance
path before wiring the provider. Do not revive old handles or infer administration from a sender label
to work around this. Real multiwindow/installed/packaged acceptance and later goal phases remain required.
The integrated settings extraction remains uncommitted pending the complete usable checkpoint.

### Renderer authority bootstrap and frontend reacceptance — working integration

Renderer window bootstrap now acquires explicit host access and waits for a validated correlated settings
snapshot before calling the shell's connected callback. The pack frontend provider obtains its own
credential from the accepted backend declaration/build identities, injects its bound port and releases
provisional or unloaded access. A missing build identity refuses instead of borrowing host access.
The loaded-pack metadata publishes the accepted backend build stamp; an actual sealed installed-pack
loader fixture proves it reaches that response. Native app reset now uses the injected window host
operation and reports transport rejection without leaving its reset button busy.

The shell now unloads registered frontends on disconnect using the existing unload path, stops their
surface actors, and retains the selected feature for fresh acceptance. A loader interrupted by a dropped
connection is invalidated, but remains the sole running loader until it settles: late registrations are
undone, never merged or announced, and a queued fresh run starts afterward. Offline requests do not
start a new run. Removing the stale-result check failed the delayed-import regression; source restored.
Tests cover selected-view restoration, distinct surface actors, delayed imports across reconnect,
styles-only reacceptance, onboarding/error states, independent credentials, provisional credential
cleanup and the actual renderer subscription's readiness barrier on two connections.

Full host checks pass (1,040 tests, 94 files); full renderer checks pass (44 tests, 10 files), host and
renderer typechecks pass, and the renderer build passes. API built to regenerate the router declarations
consumed by the renderer (the first renderer typecheck correctly exposed their stale output). Evidence:
`/private/tmp/apack-settings-reacceptance-{tests,loader-tests,mutation,types,host-suite}.log`,
`/private/tmp/apack-settings-renderer-credentials-{tests,suite,types,build}.log`,
`/private/tmp/apack-settings-renderer-api-build.log`, `/private/tmp/apack-settings-reset-injection-tests.log`.
These are source/fixture checks; no real external-pack, multiwindow or packaged acceptance is claimed.

The provider and reconnect lifecycle are now wired. Catalog-driven forms (including pack groups and
features without activated surfaces), ambient mutation API/caller removal, backup staging consistency,
installed/frontend declaration admission completeness and remaining goal phases are still required.
The complete integrated settings checkpoint remains uncommitted until it is usable and accepted.

### Explicit frontend writers and migrated shipped callers — working integration

Removed ambient SDK `updateSettings`/`resetSettings` exports and made save tracking require an explicitly
supplied writer. Renderer host forms supply their window administrative port. Shipped pack controls use
generated bound app or feature handles instead; the new generated `useAppSettings()` exposes a typed
handle through the same accepted factory as feature/group access. All shipped frontend app readers use
that generated handle too. No compatibility aliases remain. Log controls no longer forge optimistic
`FEATURE_SETTINGS_UPDATED` events that could conceal a refused save.

The generated entry child-process check now proves app writes use the supplied port without an ambient
host, and that retained app handles refuse after revocation. Save tracker checks prove an injected writer
is used even when a different port is ambient. The code section menu supplies literal typed paths after
the pack typecheck caught its union-key update; no casts of setting updates or weakening of the public
path/value contract was used.

Published packages rebuilt, default-setup regenerated/built, SDK frontend API report regenerated and
reviewed, and public feature docs updated. Full SDK checks pass (901 tests, 78 files), full default-setup
checks pass (817 plus 2 existing skips, 108 files), renderer checks pass (44 tests, 10 files), and SDK,
default-setup and renderer typechecks pass. Evidence:
`/private/tmp/apack-settings-explicit-writes-{sdk,sdk-suite,sdk-types,packages,api,default-build,default-suite,default-types,renderer-suite,renderer-types}.log`.

The form audit confirms definitions already support `settings.form`, but codegen does not consume it;
forms remain attached to `Surface.settings`. The next integration must declare forms beside their schemas,
register their components under their actual settings owners and render catalog entries independently
of active surface discovery. Feature actor context remains available only where a custom form actually
requires its active surface; groups and features without surfaces must not acquire invented actors.
Disabled declarations remain discoverable and editable through the validated advanced editor while their
executable form is unavailable. Assistant's presenter belongs with a pack settings extension, never a
replacement app-settings assembly or new assistant feature. Real app/packaged acceptance and remaining
goal phases stay unfinished. The integrated checkpoint remains uncommitted.

## Manifest-owned settings forms — integration evidence

The working change now consumes `features.<id>.settings.form` and
`extensions.settings.<groupId>.form` during frontend codegen. Forms register by qualified settings target,
independently of surfaces. The host registry owns atomic accepted availability and unload notifications;
Vue reactivity stays in the renderer. `Surface.settings` is removed without an alias. Default-setup declares
its eleven feature presenters beside their schemas and its assistant presenter beside the pack group;
there is no replacement app-settings assembly or assistant feature.

Settings lists now come from the installed settings catalog. Pack groups and features remain visible
without an executable form, with the validated JSON editor available. The shared renderer editor supplies
the selected target itself rather than trusting a contributed event to choose an administrative target.
Actual mounted pack-settings tests prove distinct same-named owners, arrival/removal of a form without a
surface, unavailable-form fallback and refusal to retarget an emitted edit. Registry checks cover rollback,
qualified group/feature identities and subscriber isolation. Source validation now diagnoses missing group
forms at their manifest address, matching the existing feature-form check.

Current evidence: codegen/source validation 50 tests pass; focused host form/binding/loader/boundary checks
33 pass; full renderer 46 tests pass and renderer typecheck passes. Published packages and default-setup's
actual Vue bundle build successfully. SDK API reports regenerated and reviewed. Logs:
`/private/tmp/apack-settings-forms-{validation,ui,host-tests,renderer-suite,renderer-types,packages,api,default-build}.log`.
Default-setup suite/typecheck and external authoring contract checks remain running at this entry; their
outcomes must be recorded from terminal results. Real Electron/packaged acceptance remains unproved.

The remaining authority audit confirms two gaps to fix before the integrated checkpoint: backend generated
handles dynamically resolve a facade and can regain authority after the same factory is rebound; teardown
also stops at the first throwing unsubscribe. Capture the accepted binding for retained handles and attempt
all cleanup, matching permanent frontend revocation. Backup preflight validates the original path but import
later copies from that path; stage the candidate first and validate/import the same staged bytes before live
teardown. Neither defect warrants compatibility logic. Other goal phases remain required and this integrated
change remains uncommitted.

The form-integration processes above are terminal: default-setup's full suite passes (817, with 2 existing
skips) and its typecheck passes. The external-pack authoring contract command passes across its fixture
packs, including 37 harness tests; it validates/builds their manifests and frontends and typechecks their
generated facades. Evidence: `/private/tmp/apack-settings-forms-{default-suite,default-types,external-contract}.log`.
These results predate the following backend lifetime correction; affected packages and generated bindings
must be rebuilt before acceptance uses them.

Backend handles now capture the accepted `SettingsService` rather than repeatedly fetching the current
service from the generated proxy. Each binding owns a permanently revocable facade and its subscription
set. Teardown revokes before callbacks, attempts every unsubscribe, reports aggregate cleanup failures and
suppresses late notifications. Rebinding creates new authority without reviving a retained service or
handle. Focused SDK checks pass (50 tests including runtime revocation, handles and codegen), as does SDK
typecheck: `/private/tmp/apack-settings-backend-revocation-{tests,types}.log`. Build/API refresh and downstream
acceptance remain required; the backup staging defect and other remaining goal requirements are still open.

Backend lifetime correction additionally passes 78 host settings/actual-loader tests. Published packages
rebuilt successfully and the SDK services API report was regenerated/reviewed (handle receives a captured
service). Evidence: `/private/tmp/apack-settings-backend-revocation-{host,packages,api}.log`.
Default-setup regeneration against this correction is running; prior form acceptance is not claimed to prove
the changed backend lifetime behavior in an actual app. Backup staging, remaining discovery/binding work,
real multiwindow/packaged acceptance and all other unfinished goal phases still require implementation and
verification before commit/completion.

## Validated backup staging and drive settings authority

Default-setup regeneration against permanent backend revocation completed successfully:
`/private/tmp/apack-settings-backend-revocation-default-build.log`.

Database import now copies the candidate into a private temporary directory, validates the staged LMDB
settings through the installed catalog, and installs that same copy. The optional host replacement scope
runs only after preflight passes; app settings are suspended and refreshed around actual replacement and
memory hydration, without announcing replacement for invalid candidates. Rollback copies use LMDB's own
snapshot operation. Failed installation restores the previous databases and prior media absence; if rollback
also fails, recovery copies are retained and their location is reported. User-facing malformed-backup errors
still identify the requested source path, rather than the internal temporary directory.

Four actual LMDB tests pass: invalid settings never enter replacement/close live data; deleting the original
backup after preflight cannot change imported data; reopen failure restores current data and media absence;
double failure retains a readable rollback snapshot. Host typecheck passes. The sandboxed LMDB worker was
terminated; its unrestricted rerun passes, consistent with prior native LMDB checks. Real API backup/reset
checks pass (13), including unchanged snapshot/no notifications on refusal, repeat restoration and onboarding
lifecycle behavior. CLI backup/import acceptance passes. Evidence:
`/private/tmp/apack-settings-backup-staging-{tests,types,api,packages,cli}.log`.

Drive's `setSetting` no longer sends an unbound settings mutation. The trusted tool API client explicitly
bootstraps its own connection-bound host settings credential for `sendSettings`; ordinary sends never attach
it. The settings writer's saved/refused correlation remains unchanged. Bootstrap refusal sends no mutation;
concurrent explicit writes share one issuance. Session and actual WebSocket protocol tests pass (61), and
testing package typecheck passes: `/private/tmp/apack-settings-drive-authority-{tests,types}.log`.
This is trusted tool bootstrap, not a new sandbox or production attach capability.

Broad repository validation follows these changes. Actual settings-form/multiwindow Electron acceptance,
remaining discovery/binding contracts and all other unfinished phases remain unproved. No partial integrated
settings checkpoint is committed.

The first broad `--all` chain stopped at lint after 24 completed steps; it is not a passing chain or app
acceptance result. Five lint failures concerned unnecessary copies while iterating subscription/binding
collections and a deliberately sparse array fixture. Removed the copies after checking that revocation
prevents new entries in those collections; unsubscribe can delete current/other entries during traversal.
The sparse array fixture now explicitly deletes an element, preserving its actual holes check. Focused
host disposal/document tests pass (49), SDK frontend/backend revocation tests pass (21) and repository
lint passes. Evidence: `/private/tmp/apack-settings-teardown-cleanup-{host,sdk,lint}.log`.
Chain failure evidence: `node_modules/.cache/apack-chain/runs/2026-10-12T22-53-22Z-96940`.
The subsequent chain must verify changed inputs and run the remaining gates before broad acceptance is claimed.

## Broad validation exposes authoring and acceptance consumer gaps

The recheck chain is terminal and failed in integration and external-pack app checks. It passed lint,
all selected type/schema/API/facade gates, runtime compilation, external-pack contract checks, actual
Electron smoke and packaged external-authoring app checks. This is partial evidence, not broad completion:
`node_modules/.cache/apack-chain/runs/2026-10-12T22-55-36Z-2467` and
`/private/tmp/apack-settings-integrated-chain-recheck.log`.

Integration failures identify an admission mistake: `setupPackTests` unconditionally reads the source pack's
`dist` build even though its supported source harness runs generated registration/content runtime before
a bundle exists. Repair source-authoring declaration admission explicitly, keeping sealed installed-build
admission strict; do not add a missing-build fallback or derive discovery from executed registrations.
The source manifest and generated declaration identity must agree, dependencies retain their checked
snapshots and caller binding must still use accepted ownership. This also needs a coherent catalog lifetime
when source runtimes register/unregister; ad hoc `setNative` followed by a refresh that discards it is insufficient.

The CLI database integration fixtures installed only a manifest and seeded obsolete `general` settings.
Updated them to copy the actual sealed default-setup build and write current `app.personal.name`, including
CSV expectations. Their first updated run passed 63/64; the remaining failure was a removed layout import still
used by another fixture, now restored. That case passes independently; a whole-file rerun is in progress:
`/private/tmp/apack-settings-current-db-{fixtures,fixture-unknown-types}.log`.

Three external app failures read `host/settings` actor `context.settings`, which has deliberately been removed
in favor of the window settings resource. One also asserts disabled feature definitions disappear, contradicting
installed declaration discovery. Migrate these consumers to supported read access and test catalog visibility,
actual custom-form save/reset and unload/reacceptance rather than restoring the obsolete actor projection.
Actual custom-form inputs rendered and accepted user interaction in the failing run, but their saved values
have not been proved by the stale assertions. Source-harness correction, these actual app assertions, multiwindow
acceptance, remaining discovery/contracts and every other unfinished goal phase remain required. The integrated
settings change is still uncommitted.

The corrected CLI database integration rerun is terminal and passes all 64 tests in one run:
`/private/tmp/apack-settings-current-db-fixtures.log`. This resolves the CLI fixture failures from the broad
run; it does not resolve source-harness admission or the stale external app settings assertions.

## Source admission and actual window acceptance

The source harness now admits a validated manifest explicitly into the common catalog, independent of
installed sealed builds and native registrations. It requires generated content-runtime and optional
registration identities to match before runtime setup. Source declarations survive executable unload;
cross-admission collisions and stale registration identities refuse atomically. Installed dependencies
still use checked build snapshots; there is no missing-build fallback.

The harness checks exposed property-order-sensitive declaration hashes: schema parsing reorders object
keys without changing their meaning. Declaration identity now sorts object keys recursively while keeping
array order; meaningful changes still invalidate generated bindings. All changed builds were rebuilt.
Source harness integration passes (7), dependency-runtime integration passes (3), host catalog/registration
checks pass (58), and declaration identity checks pass (2). SDK types, external contract and runtime build
pass. Evidence: `/private/tmp/apack-settings-source-{harness-integration,dependency-integration,registration-tests,sdk-types,external-contract,runtime-build}.log`
and `/private/tmp/apack-settings-canonical-declarations-identity.log`.

Actual isolated Electron memos acceptance now passes all 9 tests, including disabled declarations with
unloaded custom forms, re-enable/startup delivery, correlated form save followed by window reload, and
edit/reset propagation between two independent settings windows. The initial reload assertion failed
because fixture setup dismisses onboarding only in the current window; the new page must wait for app
readiness again. The shared helper's documentation now accurately states that dismissal does not complete
persisted onboarding. Evidence: `/private/tmp/apack-settings-memos-windows-app.log`.

This proves the external feature route and actual multiple-window notification/reset behavior. It does
not yet prove the complete host/pack-group product route, all-owner restore/restriction acceptance, full
discovery/binding inventory or the remaining phases. The integrated settings checkpoint remains uncommitted;
run broad validation on the corrected candidate before deciding which requirements remain.

The subsequent chain is terminal and failed at host unit checks (5 failures; 3967 passed), while
integration, external-pack app, smoke, packaged authoring and packaged app gates pass. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-12T23-22-10Z-70121` and
`/private/tmp/apack-settings-source-window-chain.log`. Two API database-parity failures and packaged
role precedence share a concrete cause: their prior runtime settings binding remains registered when
they close the store/unbind the ambient host, so loading the cached module again refuses an already
bound capability. Audit shutdown ownership and fixture cleanup rather than allowing simultaneous bindings.

The generated-service module-initialization test exposes a separate import cycle: a feature service
imports its settings handle while the generated services module imports that feature service, before its
proxy is initialized. Handle construction before acceptance remains required; using it before acceptance
must refuse, and a retained handle must never regain authority after unload. Separate the binding module
from feature-service imports and attach handles to a single binding lifetime, including construction
before initial acceptance. Do not remove the test or replace revocation with a resolver that silently
follows later registrations.

The spec-name routing test also used a fixed ceiling of 40 matching filenames, which new correctly
named specs exceeded. Removed that arbitrary ceiling; the test requires nonempty matches and verifies
every result's basename contains the requested word, preserving the actual packages-prefix regression.
Focused routing verification passes all 112 tests: `/private/tmp/apack-settings-spec-routing-check.log`.
The initial attempt was blocked by the sandbox's tsx IPC restriction; the authorized rerun passes.
Host Personal Information additionally needs its draft to follow
accepted changes/import/reset without mutating incoming values; its initial ref does not do this today.
The complete integrated settings checkpoint and later phases remain open.

## Binding lifetime and host form corrections

Generated settings and services now share an independent `runtime-services.ts` module with no feature
imports. Settings handles can be constructed during feature-service module initialization; they capture
the pending binding lifetime. Operations refuse before acceptance, work after first acceptance, and stay
revoked after unload even if a new binding is accepted. Retained subscriptions are released and late
notifications suppressed. A new regression exercises predeclared handles across acceptance/revocation/
rebind, in addition to the actual generated-module initialization probe. Complete SDK checks pass
(909 tests, 79 files); SDK types and reviewed API report regeneration pass. Evidence:
`/private/tmp/apack-settings-module-lifetime-{sdk-full,types,api-report-final}.log`.

API boot/parity fixtures now run shutdown hooks and unregister loaded packs before closing their stores
and unbinding the host. Schema comparisons capture the registered types before teardown. Both failing
files now pass all 5 tests: `/private/tmp/apack-settings-boot-binding-api.log`. These were fixture lifetime
leaks, not a reason to permit duplicate bindings or weaken designation precedence.

Personal Information uses a detached settings draft that follows accepted reset/import/remote updates.
Its whole-value write carries a run/value condition, pending superseded saves are canceled, and emitted
values are copies. AddressInput no longer emits normalized incoming snapshots as user edits; its detached
draft emits only changed addresses. Mounted personal/project/pack form checks pass (9), renderer types
and repository lint pass. Evidence: `/private/tmp/apack-settings-personal-draft-{tests,types}.log`
and `/private/tmp/apack-settings-module-lifetime-lint.log`.

The rebuilt actual Electron fixture passes all 11 memos checks, now including host personal edits in both
directions between windows and same-named `assistant` groups from default-setup and an external pack.
Their defaults, saves, overrides and resets remain independent; disabling the external pack keeps its
declaration visible while unloading its custom form, and re-enabling restores its saved value. This
adds actual app/pack/feature product-route evidence, but is not the two-external-pack/full restricted,
restore/advanced-schema acceptance audit. Evidence: `/private/tmp/apack-settings-three-owner-app-recheck.log`.
External contract and runtime builds pass. The initial expanded app run failed only on an ambiguous
Packs button selector; the corrected complete run passes. Run the broad chain on this candidate next.
The integrated checkpoint and all remaining goal phases remain open and uncommitted.

The broad candidate chain is terminal and failed on Electron teardown, not the settings assertions:
`node_modules/.cache/apack-chain/runs/2026-10-12T23-39-08Z-16200` and
`/private/tmp/apack-settings-module-lifetime-chain.log`. External app assertions pass all 16 tests, but
its first concurrent run exceeds the 60-second worker teardown deadline. The chain's isolated retry
passes both external fixtures (16 and 1 tests), including teardown; this does not erase the original
chain failure. Packaged authoring app assertions also pass (2), then time out during teardown. Its
separate serial rerun is in progress. Do not increase timeouts or replace graceful shutdown with a
silent forced exit to manufacture a green gate; establish the shutdown outcome and investigate any
reproduced failure. Integration and the other reported type/schema/API/build gates pass. All remaining
settings acceptance and goal requirements still apply.

The separate packaged-authoring app rerun is terminal and passes, including graceful teardown, offline
database checks and no-monorepo-symlink checks (28s):
`/private/tmp/apack-settings-module-lifetime-packaged-app-serial.log`. No shutdown behavior or timeout
was changed. Recheck the chain with one-core admission so the failed app gates run without competing
Electron scenarios; this is a checkpoint rerun, not the final strict `--all` audit of the completed goal.

That serial chain is terminal and failed on one generated-module inventory guard, with 3975 host unit
tests passing: `node_modules/.cache/apack-chain/runs/2026-10-12T23-46-50Z-48378` and
`/private/tmp/apack-settings-module-lifetime-chain-serial.log`. Added `runtime-services` to the explicit
generated population. It is deliberately outside the actor/contract-import set: its SDK factory import
has no feature-service or actor entry dependencies. The existing derived closure check verifies that
classification; all three focused guards pass (`/private/tmp/apack-settings-runtime-module-boundary.log`).

The remaining advanced-editor requirement is demonstrably unfinished: SettingsJsonEditor currently
passes only `language="json"` to SimpleMonacoEditor and calls address-only `settingsProblems`; no
catalog-composed schema is registered for completion/descriptions/value diagnostics. Implement this
against the common catalog, keeping document-local references scoped to their owners and preserving
unavailable current-format overrides. Editor feedback must agree with default composition and the
authoritative host writer; raw-schema required-field validation must not contradict accepted sparse
overrides. Do not treat successful form routes as completion of the settings plan.

The next serial chain is terminal: host units, shipped-pack units and integration pass, but the first
external fixture again passes all 16 assertions then times out during Electron teardown. This reproduces
without peer chain steps, so contention alone is not an established explanation. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-12T23-48-37Z-54189` and
`/private/tmp/apack-settings-module-inventory-chain-serial.log`. Earlier targeted settings, external retry
and packaged serial runs did complete teardown; the failure is intermittent. Next inspect the graceful
quit/inspector/process boundary with main-process lifecycle diagnostics and the full fixture sequence.
Do not restart a live job, increase deadlines, silently force a successful outcome, or claim broad
acceptance from passed assertions. All test jobs from these runs are terminal; no live validation handle
remains. The integrated change is still uncommitted and the full goal is active.

### Advanced settings editor contract and real-window acceptance

The whole-document writer had an input ambiguity: the editor presents a complete effective document,
but `replaceAll` also accepted sparse overrides and filled missing required values. The settings plan
now separates the operations explicitly. Replacement validates complete effective values before the
common writer records supplied values as choices; targeted writes and backup preflight keep their sparse
override contract. Reset alone opts back into defaults. Focused host settings checks pass (40 tests),
including atomic refusal of incomplete replacements and retained unavailable owners:
`/private/tmp/apack-settings-complete-replacement.log`.

The editor now registers model-specific schemas from the accepted catalog, with separate owner resources
that preserve local references and isolate identical schema IDs. Host validators also gate Save, including
unavailable-owner edits. Catalog revision/run changes refresh the registration and revalidate dirty drafts;
ordinary value writes do not restart the worker. Disposal preserves unrelated editor registrations.
The draft action is named Discard changes, distinct from resetting stored preferences. Data replacement
holds the draft and disables Save. Public settings documentation describes these contracts.

Actual Electron testing caught a Vue readonly proxy cloning error missed by the original plain-ref mock.
The renderer now unwraps the catalog at its boundary; the host validator remains independent of Vue,
and mounted tests use readonly snapshots. Monaco worker validation, completion, hover descriptions and
the actual save round-trip subsequently worked, but leaving the editor exposed an uncaught vendor
cancellation. The existing Monaco filter now recognizes only exact Canceled errors whose stack names
Monaco; application cancellations still reach fatal reporting. Handled promise rejections stop propagation
before the fatal reporter as handled error events already do. The final full external-app gate is in
progress; no acceptance claim is based on the earlier failing runs.

Renderer suite passes (56 tests, 14 files): `/private/tmp/apack-settings-editor-renderer-suite.log`.
The final revision-watch/disposal checks pass (8 tests):
`/private/tmp/apack-settings-editor-revision-watch-tests.log`. Host/renderer types and renderer lint
passed earlier in this editor slice; final checks remain due after the last changes. UI API extraction
passes and reports zero public-contract changes. Runtime builds and the rebuilt external contract
fixtures pass. The full goal and integrated checkpoint remain open; no partial settings commit is made.

Shutdown diagnostics from the preceding investigation completed normally in four runs, including
worker-only tracing: `/private/tmp/apack-settings-electron-quit-diagnostic.log`,
`/private/tmp/apack-settings-electron-quit-diagnostic-2.log`,
`/private/tmp/apack-settings-electron-quit-minimal.log` and
`/private/tmp/apack-settings-electron-exit-pipes.log`. These passes do not establish a fix for the
intermittent teardown failure. Opt-in tracing observes process exit, Playwright close and pipe state;
no timeout, force-exit or production shutdown behavior was changed.

The complete external-app gate is terminal and passes, including graceful teardown of both fixtures:
17 main-fixture tests (the advanced editor included) and one bundled-UI test. Evidence:
`/private/tmp/apack-settings-editor-external-app-gate.log`. No page/console errors are reported in that
run. Final renderer types and root lint pass; host boundary and settings checks pass (50 tests):
`/private/tmp/apack-settings-editor-final-types.log`, `/private/tmp/apack-settings-editor-final-lint.log`,
`/private/tmp/apack-settings-editor-final-host-tests.log`. The broad serial checkpoint chain is running
at `/private/tmp/apack-settings-editor-integrated-chain.log`; preserve its live session rather than
starting another run. This is not the final `--all` audit of all goal phases. Remaining real settings
acceptance includes two external group owners, onboarding/replacement/restore sequences and the
requirement-by-requirement integration audit; discovery, navigation, boundaries and all Phase 6 scope
remain required. The integrated working change remains uncommitted.

The serial chain is terminal and failed on five shipped-pack event fixtures that still sent sparse
`REPLACE_SETTINGS` payloads: `node_modules/.cache/apack-chain/runs/2026-10-13T00-17-05Z-99229`,
`/private/tmp/apack-settings-editor-integrated-chain.log`. All preceding reported package, host-unit,
type, schema, export and lint gates passed. Transport callers are part of the replacement contract,
not just direct `replaceAll` calls. All in-tree event references were audited; valid fixtures now send
complete values, malformed fixtures assert their specific refusal among all diagnostics, and unavailable
owners remain unchanged. The prototype-key test now proves a successful own-key round-trip rather than
passing because an incomplete replacement was refused. All 28 affected event tests pass:
`/private/tmp/apack-settings-editor-replacement-events.log`.

The external editor check also now requires zero diagnostics for the original valid full document,
covering host-local references as well as the invalid feature value. A separate mounted error test covers
handled promise rejection propagation. Recheck the corrected candidate through the chain; no test
expectation was weakened to admit sparse replacements and no compatibility branch was added.

The corrected broad serial chain is terminal and passes (312.3s, 14 of 30 steps cached):
`node_modules/.cache/apack-chain/runs/2026-10-13T00-21-58Z-8749`,
`/private/tmp/apack-settings-editor-replacement-chain.log`. Both unit pools, integration and the changed
type/lint/contracts pass. External-app acceptance passes quietly (17 and 1 tests), including the strengthened
zero-diagnostics check, save/reset and graceful teardown. Smoke and both packaged-authoring steps pass,
including packaged app teardown. This proves the current editor/removal candidate's broad checks,
not a diagnosis of every intermittent shutdown outcome or the final all-phase `--all` gate.
All validation sessions in this editor slice are terminal. The next integrated settings evidence must
cover two external group owners, restricted dependency requests and real onboarding/export/restore
sequences before the removal checkpoint is committed. The full Phase 0–7 goal remains active.

### Extraction ownership review and external policy evidence

The user reiterated that default-setup's app-settings abstraction must be removed, not repackaged.
The source audit confirms its directory, content-defaults module and aliases are deleted in the working
change. The host guide still described view-bound section access; that prose is corrected. The owning
settings plan now records the actual responsibility map and the remaining administration gap.

Two external packs with independently declared `assistant` groups pass actual app save, disable/enable,
reset and uninstall/reinstall checks; saved overrides survive normal reinstall without affecting the
other owner. Evidence: `/private/tmp/apack-settings-two-external-app.log` (terminal pass).
A normally CLI-built dependent pack passes generated-type policy checks and actual authenticated API
requests: shared dependency writes/reset work; owner-only mutations, spoofed caller IDs and bulk settings
operations are refused without changing the document; disabled origins lose their credential and reaccepted
origins receive working access. Evidence: `/private/tmp/apack-settings-dependency-policy-app.log`
(terminal pass); fixture contracts pass at
`/private/tmp/apack-settings-dependency-policy-contract-recheck.log`. These focused passes do not replace
the full external gate, real restore/onboarding acceptance or the final all-phase audit.

The service audit found that generated pack services scope settings but forward `AppDataService`,
including whole-data reset/import. The real Database consumer uses that broader authority. The settings
and declared-API plans now require an explicit supported administration contract, with onboarding and
backup operations inventoried separately. No new permission field or production service change was
introduced during this review. This gap prevents claiming all supported API policy paths are complete.
The integrated working change remains uncommitted; all phases remain required.

The full external-app gate is now terminal and passes: 19 main-fixture tests and one bundled-UI test,
including both new ownership/policy cases alongside editor, multiwindow and reload acceptance.
Evidence: `/private/tmp/apack-settings-ownership-full-gate.log`; both app fixtures close normally.
The first sandbox attempt refused tsx IPC before starting tests; the authorized escalated run passed.
`git diff --check` passes, and active package/fixture source searches find none of `settingsSections`,
`useSettingsSection`, `#app-settings`, `getBaseSettings` or `setInSection`.

Restore coverage was also inspected directly. The existing real API onboarding test restores workflow
progress and completion state, then requires an explicit Brain restart; it is not evidence of automatic
multiwindow recovery or completed onboarding through the UI. The remaining integrated acceptance must
exercise actual export/import with app, both external groups and feature values, observe live consumers,
and verify the intended user-visible onboarding/restart behavior. Neither the external gate nor deletion
searches prove those remaining requirements or the whole-data administration boundary.

### Actual multiowner backup/import and publication correction

A new external-app test saves host personal values, two external pack groups and an external feature,
keeps another settings window open, disables one pack, exports through the Database feature, changes
the preferences, and imports through that same feature. It checks all restored values, the second
window's live feature form and the disabled pack's custom form after re-enabling it.

This exposed a real snapshot defect: `onReplaced` published hydrated values before the replacement
bracket advanced the revision. Both live windows rejected the inconsistent state and retained their
previous form values. The shared reset/import boundary now settles the settings bracket before general
data-replaced notification; transported snapshots retain their published values/declarations while
hydration is pending. Internal reads remain available for migrations. Window identity guards are unchanged.
A direct store regression mutates the database during replacement and proves stable, detached snapshots
until settlement. Focused store/API reset/import checks pass (43 tests):
`/private/tmp/apack-settings-replacement-publication-tests.log`. The runtime rebuild passes:
`/private/tmp/apack-settings-replacement-runtime-build.log`. Fixture TypeScript passes:
`/private/tmp/apack-settings-restore-final-types.log`.

The original real-window restore case passes after the correction (5.9s), with graceful app teardown:
`/private/tmp/apack-settings-restore-publication-fixed.log`. Its filtered wrapper exits nonzero because
the second fixture has no test matching that filter; this is not a full-gate pass. The full external gate
is running at `/private/tmp/apack-settings-restore-full-gate.log`; preserve that live run. Earlier failed
runs include two test mistakes (status label and missing Database backup-view transition), then a stale
model selector; selecting the visible editor exposed the actual runtime failure. No production timeout
or acceptance guard was relaxed. Actual onboarding UI acceptance, the administration contract and all
later goal phases remain unfinished; the integrated change is uncommitted.

The first full restore gate is terminal and failed on leaked preferences from the new case:
`/private/tmp/apack-settings-restore-full-gate.log`. The fixture shares an app per worker; the restore
case now restores its incoming preferences and removes its companion installation after its assertions.
Further full runs still fail during post-restore settings navigation, with a Playwright navigation wait
and, in one run, an empty custom-form input. Evidence:
`/private/tmp/apack-settings-restore-full-gate-recheck.log`,
`/private/tmp/apack-settings-restore-cleanup-gate.log`,
`/private/tmp/apack-settings-restore-cleanup-verified-gate.log` (all terminal failures).
The intermediate-value/revision defect is verified corrected by the real restore assertions, but those
passes do not prove continued usability after replacement. Do not attribute the remaining failure to
test isolation without evidence or move the test last to conceal it. A full-suite trace run is active at
`/private/tmp/apack-settings-restore-navigation-trace.log`; preserve its live process. Inspect retained
traces under `tests/packs/external-pack/tests/results` before selecting a further fix. No root chain is
currently running, and the integrated checkpoint remains unaccepted.

The navigation cause is now verified. Electron diagnostics captured a renderer-requested reload of
`renderer/dist/index.html` with `blocked: true`; Chromium reported `reason: reload` before Playwright
became stuck. The Database backup view scheduled `window.location.reload()` 1.5 seconds after import.
Its reset-success action used the same blocked path. Evidence:
`/private/tmp/apack-settings-restore-native-navigation.log`. The plain Playwright trace contained only
test calls; explicit Electron-context tracing supplied actual window snapshots and native events.
Temporary tracing, CDP listeners and main-process diagnostic hooks are removed from the source.

Import/reset now rely on live replacement publication. Database success clears row results, trace caches
and outstanding query identities; failed import retains the current results. The editor and authoritative
settings/schema survive. Initial mutable trace state is allocated per actor. The import message reaches
the toast, including the backend's explicit Brain restart instruction. Redundant frontend copies of the
canonical backend backup/reset events are removed. The reviewed shipped facade changes by one optional
`DatabaseContext.backupResult.message` field; facade update and shipped build pass:
`/private/tmp/apack-settings-database-facade.log`, `/private/tmp/apack-settings-database-live-build.log`.

Final Database actor checks pass (20 tests), including failed-import preservation, late-reply refusal,
instructions and per-window state: `/private/tmp/apack-settings-database-live-final-tests.log`.
The complete external-app gate passes without diagnostic hooks: 20 main-fixture tests and one bundled-UI
test, both with graceful teardown, at `/private/tmp/apack-settings-restore-live-full-gate.log`. The original
restore case and subsequent navigation/installation cases all pass in the same worker. This verifies the
identified publication and blocked-reload defects; it is not proof of the still-pending onboarding UI
acceptance, whole-data administration contract, discovery/navigation/boundary phases or Phase 6 scope.
Run the broad strict chain against this candidate before further source changes. The integrated change
remains uncommitted until its remaining acceptance and ownership review are complete.

The strict serial checkpoint chain is active at `/private/tmp/apack-settings-live-replacement-chain.log`
(`npm run chain -- --strict --cores 1`). Published package checks, shipped build/facade, external contracts,
all type checks, specifiers/exports/schema, tiers and lint have passed so far. Preserve the live process
and inspect its terminal result before modifying source or starting another chain. This is a checkpoint
run, not the final full-goal `--all` audit.

That strict chain is terminal and failed on the independent HostRuntime reset composition test:
`node_modules/.cache/apack-chain/runs/2026-10-13T01-14-47Z-61589` (158.8s, 22 steps reached).
The host unit pool passed 3065 tests and failed one because replacement looked up an ambient SDK host.
The fix supplies the store's owning engine explicitly and injects the composed settings service into
app-data, removing ambient settings/engine borrowing from those paths. Every store construction is
migrated; the test harness explicitly resolves its current installed engine after reset. A two-runtime
regression proves installing another engine cannot redirect either settings service's data.

Focused real store/API reset/import checks pass (46 tests):
`/private/tmp/apack-settings-owned-runtime-tests.log`. Engine ownership, app defaults, registration and
transport access checks pass (99 tests): `/private/tmp/apack-settings-owned-engine-tests.log`.
The unbound composition test remains independent; no extra host binding or compatibility fallback was
added to make it pass. Recheck the corrected candidate through the strict chain before further source
changes. These tests do not complete the supported administration contract or later phases.

The corrected strict serial chain is running at
`/private/tmp/apack-settings-owned-composition-chain.log`. Preserve its live run and inspect the terminal
result before another source edit or chain invocation. All focused validation sessions above are terminal.

That corrected run is now terminal and passed: 381.4 seconds, 29 executed steps and one cached step,
recorded at `node_modules/.cache/apack-chain/runs/2026-10-13T01-22-52Z-69894`.
It includes the full external app suite, smoke and packaged-authoring checks. This validates the current
candidate, not all Phases 0–7. The next source work may proceed.

The consumed-API audit in `declared-capabilities.md` now records a second concrete mismatch: generated
dependency service types are narrower than the runtime's global service union. Non-settings delegates
also follow the ambient host instead of the accepted pack lifetime. Address these with administration
and action injection in the supported API checkpoint; do not close only the `appData` method gap.

Real onboarding acceptance is being added in the external app suite. It uses configured temporary
executables that fail CLI detection and a temporary project, avoiding reads of the developer's installed
provider sessions. The real welcome/project/completion workflow already exercised host project and Code
working-directory writes. Persisted completion and restart assertions are not yet verified.

This acceptance exposed a frontend error-handling defect: `renderer/index.html` installs an early
unhandled-rejection fallback that opens the fatal page before the app's later Monaco filter can cancel
the event. Vue also has a separate error-page effect. The working fix shares the vendor classification
with Vue and defers the HTML fallback until listener delivery settles, respecting `defaultPrevented`.
Do not suppress application cancellations or extend deadlines to conceal the failure. A regression
executes the actual HTML bootstrap script with a later filter and a genuine unhandled startup error.
The Database Execute button also needs an accessible name when responsive styling hides its label.

Terminal failed acceptance evidence: `/private/tmp/apack-settings-onboarding-full-app-gate.log`
(20 passes, new onboarding test failed); `/private/tmp/apack-settings-onboarding-accessible-full-gate.log`
(19 passes, onboarding and restore failed); `/private/tmp/apack-settings-onboarding-final-diagnostic.log`
and `/private/tmp/apack-settings-onboarding-error-shape.log` capture the fatal vendor stack. None is a
successful gate. The corrected build/test sequence is currently live with logs at
`/private/tmp/apack-settings-html-bootstrap-tests.log`,
`/private/tmp/apack-settings-onboarding-final-pack-build.log` and
`/private/tmp/apack-settings-html-bootstrap-runtime.log`; inspect its terminal result before acceptance.


The bootstrap acceptance is now terminal: `/private/tmp/apack-settings-native-listener-full-gate.log`
passes 21 main-fixture tests and one bundled-UI test. Real onboarding persists host projects and Code
preferences, completes existing lifecycle state, and retains completion after preference restoration
and Brain restart. The final HTML fallback uses the next task: native event dispatch performs microtask
checkpoints between listeners, so a microtask did not allow the later Monaco filter to run first.
Seven error-boundary regressions pass at `/private/tmp/apack-settings-native-listener-tests.log`.
No diagnostic hooks, relaxed assertions or longer acceptance deadlines remain.

Independent host-only acceptance passes both tests at
`/private/tmp/apack-settings-host-only-final-ui.log`: Personal and actual shortcut navigation work with
default-setup disabled; an existing hotkey form follows a second window's edits and preserves `global`
on its next save. This uses temporary current-format installed records and no external dependency pack.
The shipped-pack disable refusal is recorded in the replacement plan, not removed out of phase.

The custom-form audit found nested Vue proxy writes in Threads and Code as well as host Hotkeys.
The SDK frontend adapter now detaches reactive values and compare conditions for both form saves and
generated handles, preserving invalid data for host refusal. Focused validation passes 170 tests in
28 files at `/private/tmp/apack-settings-reactive-boundary-spec.log`; SDK compilation passes at
`/private/tmp/apack-settings-reactive-boundary-build.log`. This does not prove every custom form's UI
behavior or close the supported-API administration and later-phase gaps. Re-run strict checkpoint
validation against this corrected candidate before committing the integrated extraction.


The extraction checkpoint chain failed at lint after 130.4s, with all reached type/schema/facade and
external-contract checks passing: `node_modules/.cache/apack-chain/runs/2026-10-13T02-26-07Z-38341`.
Fixes use ordinary array construction, document Playwright's required empty fixture destructuring,
and restore onboarding preferences without a finally-block throw masking the original failure.
The test now cleans temporary files even when initial navigation fails.

A further transport audit found that structured cloning can drop symbol/hidden properties, invoke
accessors or erase custom prototypes before host validation sees the input. The window writer now
uses the existing JSON-data validator before cloning the complete request, including replacement and
compare conditions. A regression proves malformed writes are never queued and accessors never run.
Focused runs pass 170 tests in 28 files and 177 tests in 23 files (overlapping suites), recorded at
`/private/tmp/apack-settings-json-boundary-spec.log`. Root lint passes at
`/private/tmp/apack-settings-extraction-lint.log`. The strict checkpoint must be rerun on these corrections.


The corrected strict checkpoint is terminal and failed at the external-app gate after 335.4s:
`node_modules/.cache/apack-chain/runs/2026-10-13T02-30-32Z-44479`. All reached type, lint,
host/pack unit, integration and runtime-build checks passed. The app suite passed 20 tests and failed
one: the refused-access case observed an extra settings revision (47 to 48). The broad revision
assertion was retained; value equality now runs first to expose the changed owner if it fails.
A diagnostic rerun passes all 21 main tests plus the bundled test at
`/private/tmp/apack-settings-refusal-revision-app.log`. That pass does not explain the earlier revision.
Failure-only attachments now capture before/after values and intervening settings publications, without
runtime hooks, longer deadlines or relaxed assertions. Continue investigating if the next checkpoint
reproduces the discrepancy; do not classify a passing rerun as proof that a race was fixed.

Root, host and SDK developer guides and the declarative-contributions reference now describe catalog
settings ownership, removing stale section, default-export and installed/runtime-union instructions.
The remaining supported-API, all-kind discovery, navigation, failure-boundary, provenance and replacement
work is unchanged. No plan is archived and the integrated extraction remains uncommitted.


Integrated extraction checkpoint validation passes: `npm run chain -- --strict --cores 1`, 170.0s,
12 executed and 18 cached steps, evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T02-39-30Z-83266` and
`/private/tmp/apack-settings-refusal-audit-chain.log`. This includes external app, smoke and packaged
authoring/application checks. Final host-only UI acceptance passes both tests in 6.0s at
`/private/tmp/apack-settings-extraction-host-only-checkpoint.log` on the same built candidate.

Checkpoint `f3416ad2f` commits the integrated app/pack/feature extraction. Obsolete pack assembly,
section contracts and aliases are absent; declarations, generated contracts, common writer, caller-bound settings, forms, restore,
onboarding and guides move together. The supported administration/global-service mismatch remains an
explicit Phase 6 item; no full-goal or all-kind-discovery completion is claimed. Keep the unexplained
historical revision discrepancy recorded with its failure-only capture. Next extend the catalog and
checked binding inventory across remaining contribution kinds before dependent consumer refactors.


The next discovery checkpoint adds backend binding membership checks before installed content
initialization and before origin-bearing registry mutation. It compares feature IDs, roles, system/surface
presence, surface default visibility, feature service names, aggregate services and repositories with the
accepted manifest. A matching stamp alone previously permitted undeclared contributions. Explicit null
maps are refused, while omitted empty maps remain valid. This does not complete frontend/static-asset
or remaining contribution-kind binding coverage.

The first broad focused run exposed 33 inconsistent installed fixtures; their manifest declarations now
name their real runtime features/services. The follow-up passed 925 tests and failed only the remaining
packaged role fixture; after correcting it, 927 tests passed and the new refusal test alone failed because
it expected undefined rather than the registry's documented null result. Corrected binding/loader checks
pass 86 tests at `/private/tmp/apack-discovery-binding-focused-proof.log`; explicit-null checks pass at
`/private/tmp/apack-discovery-binding-null-proof.log`. Host typecheck and lint pass at
`/private/tmp/apack-discovery-binding-host-types.log` and `/private/tmp/apack-discovery-binding-lint.log`.
Run the strict chain on this corrected candidate before committing. No guard or existing behavioral
assertion was removed to admit those fixtures; the no-publication test proves no registration, service,
catalog revision or settings authority is installed on mismatch.


The strict backend-binding run is terminal and failed at integration after 234.1s:
`node_modules/.cache/apack-chain/runs/2026-10-13T02-54-58Z-62950`. All reached type, lint, host/pack
unit and external-contract checks passed. Integration confirmed that data-only harness setup incorrectly
adapted content bindings into full backend registrations; hand-written backend integration fixtures also
omitted their actual memos feature from the manifest.

The owning discovery plan now distinguishes backend and content facets explicitly. The host registry
adds checked `registerContentRuntime` alongside full backend registration, sharing mutation, collisions,
rollback and teardown. Content identities, entities, relations, repositories, writer names and supplied
source-key appliers are checked against accepted declarations without claiming actors or services.
`ContentRuntime` moves to SDK framework ownership; codegen and callers migrate, the old testing export
is removed, and the harness's `contentRuntimeRegistration` assembly is deleted. Reviewed API changes
are the unchanged interface moving between framework and testing reports, with normalized line endings.
No skip-validation flag or invented actor is used.

Corrected content registration/teardown checks pass at
`/private/tmp/apack-discovery-content-teardown-proof.log`; the two previously failing harness integration
suites pass all 10 tests at `/private/tmp/apack-discovery-content-harness-integration.log`. Published
packages rebuild successfully at `/private/tmp/apack-discovery-content-packages-build.log`; host typecheck
and lint pass at `/private/tmp/apack-discovery-content-host-types.log` and
`/private/tmp/apack-discovery-content-facet-lint.log`. Validate the final applier guard and rerun the strict
checkpoint chain before committing. Remaining discovery kinds, frontend/static metadata and all later
phases are still required.


The content applier check now accepts declared class instances and rejects unknown/duplicate source
keys before any repository registration. All eight content-facet tests pass at
`/private/tmp/apack-discovery-content-appliers-proof.log`. Repository removal is verified through the
actual unregistered-name refusal, rather than enumeration of the repository proxy (which exposes no
keys). Public testing docs and SDK/host guides describe the separate contracts. The next strict chain
covers the complete corrected backend/content checkpoint; do not treat focused checks as its substitute.


Backend/content binding checkpoint validation passes: `npm run chain -- --strict --cores 1`, all
30 steps in 390.8s. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T03-15-21Z-96692`
and `/private/tmp/apack-discovery-backend-content-chain.log`. This includes public contracts/reports,
host/pack unit tests, complete integration, runtime build, external app, smoke and packaged authoring.
The earlier content-versus-backend integration failure is resolved through distinct checked operations,
not a validation exemption. Checkpoint `a76d66235` commits the validated backend/content contracts,
callers, fixtures, reports and documentation.

Next continue the complete discovery inventory: remaining backend contribution kinds and implementation
shape checks, frontend declaration membership and static metadata/assets, common catalog projections and
consumer migration, source/dependency freshness and host-native declarations. The backend key checks
alone do not complete any of those requirements. All Phase 6 workstreams and remaining phases stay active.


The next backend checkpoint checks the remaining declared arrays and maps: own EARS values, writers,
source-key appliers, steps/facets/runtime flags, artifacts, blocks/kinds, commands/placeholders,
migration lines/targets and hook-module presence. Missing/extra/duplicate contributions and explicit
null or non-callable declared handlers are refused. Help bodies and hidden hook/migration metadata,
frontend bindings and complete catalog projections still require descriptor work.

Expanded checks exposed installed fixture manifests omitting their actual boot, migration, writer,
entity and applier facts. Those declarations were corrected without bypassing admission. Initial broad
focused failure evidence is `/private/tmp/apack-discovery-backend-contributions-spec.log`; the corrected
run passed 959 tests but exposed an undefined local target-list variable and one remaining writer
fixture, both fixed. A new regression also found two producer defects: migration spreading could
replace the manifest target and lose prototype methods; path generation assumed every source was
inside src. Codegen now binds explicit migration fields while retaining callback context and computes
imports from the actual generated directory.

The bundled generated migration passes its real target/receiver checks; focused backend arrays, loader
and runner tests pass 102 checks at `/private/tmp/apack-discovery-backend-array-focused.log` (plus the
separate SDK regression). Affected lifecycle/reset/reload/installation checks and malformed-facet checks
pass at `/private/tmp/apack-discovery-backend-array-lifecycle.log`; lint passes at
`/private/tmp/apack-discovery-backend-array-lint.log`. Run strict checkpoint validation before committing
or starting another implementation slice. No full discovery or goal completion is claimed.


The expanded backend checkpoint chain is terminal and failed at integration after 283.7s:
`node_modules/.cache/apack-chain/runs/2026-10-13T03-54-48Z-93411`. All reached type, schema,
report, lint, host/pack unit and external-contract checks passed. Of 36 integration files, only the
migration scaffold assertion failed: it expected the old object-spread code. Its expected binding now
checks explicit target/description/up fields, preserving version order and the real tsc check. All
18 tests in that integration file pass at `/private/tmp/apack-discovery-migration-scaffold-integration.log`.
Re-run strict checkpoint validation on the corrected assertion before committing. The bundled class
migration still provides independent behavioral proof of target authority and receiver preservation.


The corrected backend checkpoint rerun is terminal and failed on the unrelated bounded-spawn cleanup
assertion, after 110.6s with 17 cached steps:
`node_modules/.cache/apack-chain/runs/2026-10-13T04-03-14Z-22384`. All 18 migration scaffold tests
passed; 637 integration tests passed and one failed because it probed grandchild disappearance
immediately after parent exit. Inspection confirms the reaper queues SIGKILL before parent exit;
that syscall does not await kernel reaping. The test now uses bounded polling for ESRCH, still requiring
the exact spawned process to disappear and propagating permission/other errors. It uses the existing
poll bound and changes no production cleanup behavior. Signal/abort checks pass all four tests at
`/private/tmp/apack-discovery-bounded-reaping-proof.log`; lint passes at
`/private/tmp/apack-discovery-bounded-reaping-lint.log`. Re-run strict checkpoint validation on this
correction before committing; no cleanup invariant was waived.


Expanded backend checkpoint validation passes: `npm run chain -- --strict --cores 1`, 213.7s,
12 executed steps and 18 cached. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T04-13-53Z-49690` and
`/private/tmp/apack-discovery-backend-contributions-reaping-chain.log`. It includes the corrected
integration checks, runtime build, external app, smoke and packaged authoring/application. Earlier
matching-input successes supply the cached checks; final full-goal `--all` validation is still required.

Checkpoint `1d99b0f5e` commits the expanded identities/facet checks and migration/path producer fixes
with behavioral tests and corrected fixture declarations. `57b35a98f` separately commits the
OS-reaping test observation correction. Help/hook/static module metadata, frontend binding completeness, all-kind catalog views
and consumer migration remain open, along with all later phases and the three Phase 6 workstreams.


### Static help checkpoint and repeated-click correction (2026-10-13)

Commit `2169d29f8` moves help into snapshot data and the common declaration catalog, removes executable
help registration and its store, and supplies explicit source help through the authoring harness. The
public subscription is `onPackCatalogChanged`; the bound registry exposes `onCatalogChanged`. All
callers and API reports move together, with no alias. Disabled poisoned-entry build coverage proves
help can be read without activating a pack and returned articles cannot mutate accepted data.

Help Markdown no longer invalidates executable generation. Complete builds compile and validate articles
before staged publication; the backend watcher uses that complete path for help changes. Real build
coverage proves edits update the snapshot and invalid Markdown retains the accepted sealed build.
Focused publication tests pass (8) and shell URL refusal tests pass (16).

The actual app test revealed repeated clicks could bypass ProseMirror's single-click callback and open
an internal help URL in the developer's browser. Viewer links now use DOM click handling, and Electron
refuses `help.apack.invalid` at the OS-opening boundary. The app regression captures external opens and
proves none occur while help remains navigable with its contributing runtime disabled.

The complete sequential strict chain passes (135.0s, 25 cached), including host/shipped unit suites,
external app and smoke. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T05-09-32Z-28459` and
`/private/tmp/apack-discovery-help-serial-diagnostic-chain.log`.

Concurrent chain failures remain unresolved: backup export can deliver no result before its existing
5-second deadline, and Electron worker teardown can hang after passing smoke assertions. Their runs are
`2026-10-13T04-49-16Z-44777`, `2026-10-13T05-00-07Z-49745` and
`2026-10-13T05-05-08Z-87164` in the same evidence directory. The first retry additionally caught the
repeated-click failure, fixed and verified thereafter. One intermediate run was deliberately cancelled
after finding a regression case placed in the allowed-URL table; it was corrected and all 16 cases pass.
No timeout or assertion was weakened. Sequential success is a usable checkpoint, not proof the concurrent
lifecycle failures are solved; investigate those before final acceptance.

The user's settings-boundary concern was rechecked against source: default-setup's app-settings assembly
is absent, app definitions belong to the host, pack/feature declarations are inline and custom forms own
presentation only. This does not complete the supported-API authority audit for whole-data administration.
The goal remains active across all Phases 0–7. Native all-kind catalog ownership, other hidden metadata,
frontend binding/asset and source/dependency freshness, navigation, frontend fault boundaries and all three
Phase 6 workstreams remain required. Nothing is archived at this checkpoint.


### Native lifecycle diagnostics and directory-intent finding (2026-10-13)

The lightweight concurrent smoke/external app reproduction passes. Full-load runs reproduce backup
and native shutdown stalls. The testing fixture now supports `DEBUG_E2E=sample` on macOS, producing a
native sample only if its own Electron process remains alive five seconds into teardown. Backup
acceptance persists failure-only state/file diagnostics and optionally samples the API after verifying
its parent is this fixture's Electron process. No assertion or timeout changes.

Strict full-load evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T05-22-36Z-47970`
and `2026-10-13T05-33-16Z-50463`. Both fail actual app lifecycle acceptance; other checks pass.
Native samples and JSON are retained in their captured results. The backup JSON reports active backup
state, exporting true, no result and a zero-byte metadata file. Its API main thread is in subprocess
creation while filesystem workers are idle. Logs show repeated same-directory Code intents; the owning
settings plan records the idempotent-command correction to implement and verify next.

The minimal native comparison at `/private/tmp/apack-native-exit-probe/results.log` exits three of three
no-window controls; two of three hidden-window runs remain alive after quit, with native samples matching
the stalled app's loop. The runner samples and kills only its own temporary test children and removes
its own profiles. That isolates shutdown from apack's settings code. Upstream comparison is linked in
the settings plan and remains an inference across different versions, not a confirmed fix.

This is diagnostic progress, not completed lifecycle acceptance. Do not mark the goal complete or
archive its plans. All remaining discovery/native declaration, freshness, navigation, boundary and
Phase 6 requirements remain in scope.


### Idempotent Code directory checkpoint (2026-10-13)

Commit `aedc0c3ef` remembers explicit navigation separately from changing the effective directory.
Repeated selection retains the existing repository/watcher and avoids child-system refresh. The first
explicit selection of an already displayed default still writes the preference. Real-system coverage
passes (3 cases); removing the identity guard fails the new regression and restored source passes.
Evidence: `/private/tmp/apack-code-directory-{idempotence-spec,guard-mutation,restored-spec}.log`.

The concurrent external app suite passes all 21 main-fixture cases and its bundled fixture, including
backup restoration. The compared run has two smart-base requests rather than the captured failure's
96, consistent with eliminating repeated initialization. Concurrent strict evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T05-46-47Z-3566`. It still fails smoke/packaged worker
teardown in the independently reproduced native loop. The unchanged strict sequential chain passes
(76.6s, 25 cached), at `2026-10-13T05-50-21Z-25389` in the same directory. No deadline or assertion changes.

The diagnostics checkpoint is `061395540`. Native shutdown remains an environment/runtime issue to
resolve before final acceptance, not a settings workaround. Further source audit also found Code's async
watcher startup lacks actor-stop cleanup; the settings plan records the actor-owned resource/handoff
and stop-during-start checks required next. This is separate from the native minimal reproduction.

All Phases 0–7 remain active. This checkpoint does not complete native all-kind declarations, remaining
metadata, asset/binding and source/dependency freshness, navigation, frontend boundaries or any of the
three Phase 6 workstreams. Do not archive or declare completion from these narrower checks.


### Code-owned watcher and debounce checkpoint (2026-10-13)

Commit `7d1389ded` replaces duplicate async watcher actions and unawaited handoff with one invoked
resource actor. It retires callbacks immediately, cancels pending filesystem preflight, serializes
close/start settlement, skips superseded selections and closes on Code stop. GitWatcherService requires
a startup signal, ignores late ready/write-completion events after close and clears callbacks/timers
before native handle close. The commit child's debounce is also an invoked resource, eliminating its
post-stop refresh events. The intentional signal signature is reflected in the pack facade report.

Twelve focused cases pass, covering controlled pending startup and close, failed startup recovery,
actual preflight cancellation, deferred repository notification retirement, real Git watcher teardown,
coalescing and timer cancellation. Removing either startup cancellation or write-completion retirement
fails its regression; restored source passes. The earlier watcher probe observed the wrong module
namespace and was replaced by a shared-prototype probe, then verified with both mutations.
Evidence: `/private/tmp/apack-code-owned-resources-final-spec.log`,
`/private/tmp/apack-watcher-mutation-{startup,write-completion}.log`.

Strict sequential validation passes (232.3s, 16 cached), including integration and external app checks:
`node_modules/.cache/apack-chain/runs/2026-10-13T06-25-13Z-75617`.
The preceding concurrent run passes all 21 main external-app cases and the bundled UI assertion; its
bundled worker teardown hits the separately reproduced native quit loop. Evidence:
`2026-10-13T06-20-27Z-47998` in the same directory. No assertion/deadline is relaxed, and native lifecycle
acceptance remains open. The initial report mismatch and test Promise-lib error are corrected.

Return to declaration/catalog work next: native declarations must have an independent lifetime, and
remaining hidden surface/step/reference/editor/hook metadata and accepted assets/bindings must move to
the complete data contract. Full freshness, navigation, frontend boundaries and all three Phase 6
workstreams remain required. This resource checkpoint adds no feature, stored lifecycle field, settings
assembly or compatibility path, and does not complete or archive the goal.

### Native declaration lifetime checkpoint (2026-10-13)

Commit `9e9bbb7ac` removes registration-derived `refreshNative`. Host composition admits its feature
data before binding systems. Native runtime bindings require an admitted owner and matching
feature IDs, dependencies and settings. Shared settings schemas validate native admission; malformed/null
records cannot silently become absent definitions. The catalog owns immutable copies, and runtime unload
or failed registration preserves admitted data until explicit removal.

Authored test stand-ins use `nativePackDeclarationFixture` and `createNativePackTestRegistry`; the latter
is available only through the host's testing entry, not its pack runtime bridge. Real API fixtures admit
their data explicitly. Direct production-registry regressions prove the lifetime and binding contract.
Twenty-six focused native/settings discovery cases pass; removing the binding guard fails 11 cases and
removing data admission validation fails nine. Restored source passes. Evidence:
`/private/tmp/apack-native-{binding,data}-guard-mutation.log` and
`/private/tmp/apack-native-declaration-restored-spec.log`.

The first strict run exposed an unrelated use of executable registration in the build compiler. Its
definition loader already merges/checks build facets, so the CLI now uses `compilePack`'s direct definition
contract instead of constructing a host registry to retrieve those values again. Both compiler-isolation
checks pass. SDK reports and package trees were regenerated and reviewed; reordered inferred schema
properties introduce no additional contract changes.

The strict sequential chain passes (376.4s, one cached), including external app, smoke and packaged
authoring checks. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T08-16-40Z-47831` and
`/private/tmp/apack-native-declaration-strict-chain.log`. Its unit suites pass 4,081 host and 831 shipped-pack
cases; no assertion or deadline was weakened. This successful run does not prove the previously reproduced
intermittent native shutdown issue is fixed.

This closes native declaration lifetime, not all-kind native discovery. Native metadata/binding coverage,
remaining executable discovery fields, accepted frontend assets, full freshness, navigation, frontend
boundaries and all three Phase 6 workstreams remain required. The goal stays active; nothing is archived.

### Accepted frontend byte delivery checkpoint (2026-10-13)

Commit `e9fe3e9b0` retains installed file receipts in the catalog and active origins. Loaded frontend
metadata/readiness use the accepted membership instead of finding or rehashing current files. Installed
URLs carry the build identity in their base, preserving it through relative chunks, styles and assets.
Main checks the receipt identity and the exact bytes returned; missing/unlisted/changed files, replacement
receipts and symlinks fail. Shipped/source fallback and the independent `feRevision` digest are removed.
Development advertises an explicit local Vite base only in the development environment. Source imports
do not fall back to installed bytes.

Stylesheet errors now reject before registration/settings binding. Concurrent requests share their actual
pending outcome; unloading settles pending loads. Focused checks pass (102 host, 14 API, 13 protocol,
seven stylesheet cases, nine readiness fixtures). Removing either byte checksum or build comparison
fails its regression; removing pending-outcome sharing or cancellation also fails. Restored source passes.
Evidence: `/private/tmp/apack-assets-{checksum,revision}-mutation.log`,
`/private/tmp/apack-styles-{pending,cancel}-mutation.log` and the corresponding restored-spec logs.

The first broad check exposed obsolete disk-inference/style-success fixtures, corrected without weakening
assertions. The subsequent run failed Electron startup: the broad host barrel brought SDK schema code into
main, whose external import resolved root AJV 6 rather than SDK AJV 8. A bounded isolated launch captured
the actual named-export failure (`/private/tmp/apack-assets-launch-diagnostic.log`). The asset reader now
imports only Node builtins and shared path/data definitions through `packs/assets`; schema/compiler code
is outside main's delivery boundary. No vendor import/validator was weakened. The general dependency-owner
resolution finding remains part of the consumed-API/tool provenance audit.

The real external fixture now splits its async canvas into a chunk. Its app regression verifies rendered
styles and actual chunk/style request bases through an owned CDP session, restoring caching and detaching
afterward. Resource Timing did not expose these custom-protocol requests, so it was replaced as an observer,
not treated as evidence of missing delivery. The focused app case passes in 4.3s; evidence:
`/private/tmp/apack-assets-relative-chunk-app-spec.log`.

Strict sequential validation passes (318.8s, one cached), including integration, external app, smoke and
packaged authoring. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T09-32-53Z-32444` and
`/private/tmp/apack-accepted-assets-strict-chain.log`. This does not prove the previously reproduced
intermittent native shutdown issue is fixed. No deadline or assertion was relaxed.

The goal remains active across Phases 0–7. Source/dependency projections do not yet have complete build
admission; static native/surface/step/reference/editor/hook metadata and the window activation/retry/stale
binding coordinator remain unfinished. Full freshness, navigation, fault boundaries and all three Phase 6
workstreams still require their own implementation and evidence. Nothing is archived.

### PR review: frontend cancellation and truthful readiness (2026-10-13)

Reviewed branch `988a8ff77` against the goal rather than treating its green checkpoints as completion.
The branch changes 467 files relative to master. Existing settings ownership and installed receipt
verification are retained; the following concrete frontend defects are corrected in this checkpoint:

- An import or settings grant completed after unload/reconnection could still register contributions.
  The frontend load now checks its attempt identity after asynchronous boundaries; actor disposal aborts
  pending acceptance. A stale settings grant is disposed, and an older failed attempt cannot remove a
  newer attempt's styles.
- Failed frontend loads sent PACK_FRONTEND_LOADED with an empty list, falsely recording success,
  announcing readiness and suppressing retries. Only successful loads now send that event. Failed packs
  remain retryable without blocking other packs.
- Unregister cleanup could throw before removing styles. Styles now leave in a finally block.
- Runtime documentation still described unversioned assets and failed loads as loaded. Corrected those
  contracts and obsolete module names in the runtime guide.

Validation: 96 related frontend checks and host typecheck pass. Removing the cancellation guard is
caught by the delayed-completion regressions; the guard is restored and focused checks pass. Strict
sequential chain passes in 327.2s (one of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T09-47-35Z-63880`; log
`/private/tmp/apack-pr-review-lifecycle-chain.log`. This is checkpoint validation, not final --all closure.

The review also found a post-registration reload initialization exception can leave old actors running
against a newly accepted registration; fix and validate that next. All-kind/native discovery, catalog
consumer migration, complete source/dependency freshness, entity navigation, pane/form boundaries and
all three Phase 6 streams remain incomplete. Generated settings access is scoped, but supported global
SDK/AppData administration paths still need the declared-capability audit. Do not describe this goal or
its owner-only policy as complete, and do not archive its plans.

### PR review: completeness audit (2026-10-13)

**Historical audit.** Its discovery gaps are superseded for current status by the
[current discovery checklist](../../plans/discovery-without-activation.md#current-discovery-checklist).
In particular, installed-pack information, reference/editor consumers and step palettes subsequently
migrated, and hook/migration metadata and frontend membership gained declaration checks. Retain the
original findings and evidence below; consult current acceptance before treating a finding as unresolved
or closed. Later-phase requirements remain in their owning plans.

Review base: `988a8ff77`; frontend corrections are committed in `a8ba9d801`. Review follows
responsibility boundaries and their failure paths, not the historical progress entries as acceptance
claims. The implementation is a set of validated checkpoints, not a finished goal. This table records
what still prevents closure; the linked plans retain their complete acceptance criteria.

| Area | Implemented evidence | Remaining requirement / authoritative code |
|---|---|---|
| Settings ownership | Host app, pack groups and feature definitions share schema/default validation; old default-setup app-settings assembly is removed. Integrated and real app acceptance is recorded above. | Finish the supported global administration/API audit before claiming owner policy holds through every supported route. `services/app-data.ts` and SDK `services/index.ts` still expose reset/import and ambient service access. |
| Settings lifecycle | Current-format import preflight, sparse overrides, effective snapshots, comparison writes, window binding disposal and custom forms have checks. | Preserve these assertions when migrating declaration consumers and replacement. A passing restore fixture does not imply rollback of later migration or arbitrary pack effects. |
| Descriptor/build admission | `parseSnapshot`, declaration stamps, staged publication and full installed receipts reject invalid/stale builds. Reports/schema checks pass. | Dependency/tool input provenance and complete source/watch publication remain incomplete; accepted installed receipts must not be invented for source/cache projections. |
| Native discovery | Native identity/settings declarations precede runtime binding and survive unload. | `NativePackDeclaration` still lacks all-kind contribution metadata; runtime/native registration is not a complete discovery source. |
| Backend binding | Contribution identity/membership, settings and content bindings are checked before registration. | Hidden hook exports, migration descriptions and other runtime-only metadata still need descriptor materialization. Keep actual queries/appliers executable. |
| Frontend acceptance | Accepted bytes/revisioned chunks/styles and declaration stamps are checked; cancellation, stale settings disposal and retry are now covered. | Full declared frontend membership/static surface metadata and one catalog-driven navigation/readiness coordinator remain unfinished. A matching declaration stamp alone is not complete membership validation. |
| Information consumers | Settings/help use catalog data. | Packs information still joins disk manifests/runtime extensions and calls `packFrontendFiles`; disabled/failed contributions can lose their metadata. Palette/editor/reference readers need their complete data projections. |
| Entity navigation | Existing executable navigation remains available. | Phase 4's declarative destinations, owner/destination distinction, short-code resolution and stale readiness delivery are not implemented. |
| Frontend fault boundaries | Import/registration failures have containment and runtime contributions have undo logs. | Canvas, panel and custom-form recovery boundaries and real throwing-contribution fixtures remain unimplemented. Cancellation alone does not satisfy Phase 5. |
| API consumption | Generated settings lifetimes receive caller-bound access. | Required consumed APIs/provider availability and the actual supported ambient/global surface need the separate Phase 6 contract. This is not a JavaScript sandbox. |
| Dependency provenance | Snapshots/receipts identify built declaration/file data. | Exact dependency version, origin/content identity, linked development and cache reuse/inspection remain incomplete. The main bundle's previously exposed AJV owner-resolution problem still warrants the tool/dependency audit; the asset reader was corrected with a leaf import. |
| Shipped replacement | Installation and receipt checks protect pre-publication failures. | Explicit update ownership/removal suppression and replacement/restoration are not implemented; current shipped refresh can overwrite a fork and `canUninstall` still conflates policy. |
| Final acceptance | Strict checkpoint chains pass, including isolated app/packaged checks. | Final --all validation on the finished committed tree and requirement-by-requirement closure remain due. The independently reproduced intermittent native Electron shutdown issue remains recorded, not declared fixed by a later pass. |

Additional runtime review fixes are validated in the next checkpoint: initialization errors on
reload no longer skip actor restart after a committed registry swap; failed activation releases runtime
contributions and records its failure while retaining installed declarations; service/repository
collision checks use own properties rather than inherited Object members; obsolete loader EARS fill-in
is removed. Focused runtime checks pass (149 tests). Mutating the reload guard fails one regression;
restoring inherited-property collision checks fails two. The frontend cancellation mutation fails three.
All mutated source is restored.

The replacement plan still prescribed old-file conversion and one-time historical ownership adoption,
contradicting the user's no-compatibility decision. Removed both: new shipped installs explicitly record
app ownership, unrecorded builds remain user-owned even with identical bytes, and restoration is
explicit. The roadmap and goal now say current-format stored data. Future deliberate versioned data
migrations remain separate; developer backup conversion does not belong in boot/import behavior.

A further blocking runtime defect is confirmed: reload's unregister/register/restore sequence restores
registration metadata after refusal, but unregister already revoked incumbent settings handles. A Node
`--import tsx` probe using the real registry and `_createPackServices` returns the prior value before the
sequence; after restoring the same registration, the captured handle throws "Pack settings binding has
been revoked" while a newly constructed handle works. The existing reload rollback fixture has no
settings binding and therefore misses this regression. Do not make disposed handles revive as a fix.
The replacement transaction must retain incumbent resources until candidate acceptance commits, and
release only provisional candidate resources on refusal. Cover late contribution/binding failure, not
only a pure preflight collision. See the corrective checkpoint in the discovery plan.

Fix transactional reload rollback next, then continue in goal order: complete discovery/freshness and
its consumers, entity navigation and frontend boundaries, then all three Phase 6 streams. Do not close
or archive the goal from this review.

Runtime checkpoint validation: strict sequential chain passes in 327.3s (one of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T09-57-40Z-95167`; log
`/private/tmp/apack-pr-review-runtime-chain.log`. The isolated handle probe performs no production-data
reads/writes. This successful chain does not cover the newly identified transactional rollback defect.

### Transactional runtime replacement checkpoint (2026-10-13)

Implemented and committed `1ed8b09a2`, fixing the rollback defect identified during PR review.
Backend contribution indexes now prepare from captured ownership/address data without changing live
readers. Executable step/artifact/block objects retain their identity. Command order is preserved.
Registry maps/tables publish once after candidate binding and repository publication succeed; refusal
leaves the exact incumbent origin, captured handles, subscriptions and lookups intact. Ordinary removal
uses captured addresses rather than re-reading authored getters. Reload calls one `replacePack`
operation instead of unregistering and attempting to restore disposed resources.

The host owns the settings port's pending/active/revoked lifetime. Candidate operations are unavailable
until publication. A hook that captures a port and throws, or returns cleanup omitting generated
release, cannot leave a usable port/subscription after refusal or unload. Retirement runs once after
commit and reports cleanup failures without restoring a disposed runtime. Repository publication
restores attempted entries on failure and retires the provisional binding. Reentrant registry writes
are refused during the transaction. Runtime initialization, migrations/content effects and installed
build/catalog publication remain separate transitions, not arbitrary-side-effect rollback claims.

Checks: ten new transaction cases, an actual reload using a captured generated handle, and related
checks pass (95 in the final focused run); host typecheck passes. A broader existing admission/lifecycle
run passed 171 before the final gate. The old getter-based teardown failure fixture now proves its
address is read exactly once, executable identity survives another registration, and all contributions
leave cleanly. This improves removal rather than hiding cleanup failure; real cleanup-failure cases
remain in the new resource tests.

Four guard mutations were caught and restored: early incumbent retirement (four failing cases),
missing repository rollback (one), reinstating unregister-and-restore reload (one), and missing
host-owned revocation when generated cleanup is omitted (one). Final strict sequential chain passes
in 325.2s (one of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T10-56-31Z-61811`; log
`/private/tmp/apack-registry-transaction-gate-strict-chain.log`. The earlier pre-gate strict pass at
`2026-10-13T10-33-46Z-29826` was not treated as final evidence after the gate was added.

Next fix the independently reproduced repository dictionary defect: the real in-memory engine's
`registerRepository('__proto__', { owner: 'candidate' })` is absent from its own repository snapshot,
exposes an undeclared `owner` lookup, and that lookup survives `unregisterRepository('__proto__')`.
Use explicit keyed storage rather than a prototype-bearing object; verify inherited-looking valid
names and unavailable names through the real engine and host publication. This probe used an isolated
in-memory engine and no production data. Then continue complete discovery and every remaining phase;
this checkpoint does not finish native all-kind metadata, source/dependency freshness, navigation,
frontend boundaries or any Phase 6 stream.

### Owned repository keys checkpoint (2026-10-13)

Committed `ccafe7396`. The engine repository registry uses a Map rather than a prototype-bearing
object. Named repositories remain explicit keys, snapshots retain own properties without changing
object prototypes, and removal really makes the provider unavailable. This fixes the prior isolated
`__proto__` probe and prevents inherited `constructor`/`toString`/`hasOwnProperty` lookups from appearing
as undeclared providers. Host transaction tests cover publishing, replacing and removing these keys;
the registry's resource transaction and generated settings gates are retained unchanged.

Validation: 15 engine-query checks and 13 host replacement checks pass. Restoring the original storage
makes four engine regressions fail; source is restored and checks pass. Strict sequential chain passes
in 383.3s (all 30 gates), including API reports, typechecks, integration, actual app/external pack and
packaged authoring; evidence `node_modules/.cache/apack-chain/runs/2026-10-13T11-10-24Z-93017`, log
`/private/tmp/apack-repository-owned-keys-strict-chain.log`. No public API report/type or release metadata
change was needed. The fix is an explicit-key availability contract, not a JavaScript confinement claim.

Continue full discovery with hook availability and migration descriptions: current manifest hooks name
one module and migration targets point to objects whose descriptions are only available after loading.
Re-audit current native/installed declarations and codegen, move these facts into data with checked named
bindings, and migrate owned fixtures/docs without compatibility aliases. Native all-kind declarations,
frontend metadata/consumer migration, complete freshness and all later phases remain required.

### Declarative hook and migration metadata checkpoint (2026-10-13)

Committed `3ec4f0a77`. The manifest now declares each `boot.onInit`/`boot.onShutdown` function reference
explicitly. Each migration version entry contains inline `description` and its named `up` function
reference. Codegen reads/checks exports with TypeScript, never executing modules to discover these
facts, and emits explicit callback bindings and declared descriptions. Module-wide hook spreading and
migration-object metadata reads are removed. Runtime admission checks exact hook membership/callability
and exact migration target/description agreement. Removed `DeclaredMigration`; `PackMigration` retains
the runner's complete declared metadata and executable function. Public schema/API reports, real pack
manifests, scaffolding, doctor, fixtures and docs use the new contract without aliases or conversion.

Validation includes five codegen/schema cases (poisoned modules that would throw if executed, missing
and noncallable exports, removed shapes), 30 backend agreement checks, the lifecycle/migration suites,
real CLI scaffolding with generated TypeScript and doctor integration (26 before adding the independent
step-path regression, nine final doctor cases). SDK/host types pass. Removing callable export checks
or description agreement fails its regression; source is restored. An initial API update correctly
refused stale package builds; packages were rebuilt before regenerating and reviewing the two
reports, with generated line endings normalized.

Strict runs found two missed changes: doctor's step-path read had been inadvertently changed to the
migration object shape, and a codegen fixture still passed obsolete `boot.content`. Corrected the step
read and added a missing/present-step doctor test. The fixture now uses `content.sources` and asserts
an actual actions applier, rather than merely an array declaration. No validator or assertion was
weakened. Final strict sequential chain passes in 259.6s (15 of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T11-47-39Z-39675`; log
`/private/tmp/apack-declared-lifecycle-strict-chain-complete.log`. The two preceding terminal failures
(`11-40-34Z-29265` and `11-43-38Z-32586`) were investigated before rerunning with frozen source.

This closes hook/migration authoring and checked binding, not every discovery consumer. Native all-kind
declarations and frontend static metadata, reference/editor/content indexes, catalog-only information
readers, full source/dependency freshness and all later goal phases remain required. Continue those
contracts before entity navigation, frontend fault boundaries and the three separate Phase 6 streams;
only the full requirement audit and final --all run can close/archive this goal.


### Installed pack information review checkpoint (2026-10-13)

`6c876c9ba` moves the Packs view to accepted catalog declarations instead of raw manifests and
runtime contribution inventory. Disabled packs retain metadata; refused replacements retain the last
accepted metadata. Unreadable new builds remain visible with a diagnostic and absent version.
Frontend availability uses the accepted receipt, not file existence. Refusal diagnostics now belong to
the immutable catalog publication, so listeners cannot observe an updated catalog with stale diagnostics.
Diagnostic-only updates preserve the settings projection's identity and revision.

Evidence: 55 focused host checks and six renderer checks pass. Dropping disabled declarations and
omitting catalog diagnostics each produces a failing regression; restored checks pass. Strict validation
first found two lint errors, then the existing settings-identity regression; both were corrected without
weakening checks. The final strict chain passed in 331.2s (one of 30 gates cached), including real
external-pack app, smoke and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T12-14-27Z-80260`;
`/private/tmp/apack-catalog-review-strict-chain-final.log`.

This is a Phase 3 consumer checkpoint, not goal completion. Raw installed discovery in the loader and
offline schema tools, native/all-kind metadata, eligibility, and the three Phase 6 streams remain open.
Next review target: `loadExternalPacks()` prunes installation records using successfully parsed manifests;
a malformed installed manifest can therefore lose its recorded disabled choice. Prove this with an
isolated boot regression while migrating installed inventory to the common admission boundary.
No plans are archived, and final `--all` acceptance remains outstanding.


### Shared installed build admission checkpoint (2026-10-13)

`e50838e14` fixes the confirmed boot-pruning bug: an unreadable installed manifest no longer erases its
disabled choice or update provenance. Directory removal still prunes the record. Installed discovery,
catalog refresh, boot, activation/reload and offline schema inspection share full build admission,
including directory-owner agreement and the receipt-owned backend entry. The loader no longer accepts
an unchecked manifest argument. Offline schemas refuse invalid enabled builds; named snapshots use
the common snapshot validator. Refused builds under valid pack IDs remain removable. No historical conversion or
compatibility path is added.

Evidence: the record-preservation regression failed before the change; 255 restored focused checks pass.
Pruning invalid builds, bypassing owner checks and silently omitting invalid schema sources each fail
an intended guard regression. Broader integration found one manifest-only database-import fixture;
it now creates a complete sealed build and still proves orphaned rows survive import. Content tests
now declare their own prompt entity/writer instead of overriding an SDK-owned writer through native setup.
The final strict chain passed in 220.3s (17 of 30 gates cached), including integration, real external-pack
app, smoke and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T12-43-46Z-41676`;
`/private/tmp/apack-installed-admission-strict-chain-final.log`.

The goal remains open: native/all-kind descriptors, remaining static consumers and source/dependency
freshness, navigation, frontend boundaries and all three Phase 6 streams are still required. Next
implementation review should remove the obsolete runtime pack-information projection and complete
native/frontend declaration coverage. No plans are archived; final `--all` acceptance remains outstanding.


### Frontend declaration membership checkpoint (2026-10-13)

`c67329374` closes the frontend stamp-only admission gap for currently declared member identities.
Installed frontend delivery includes an owned declaration copy. Missing data refuses before import;
matching-stamp undeclared features, roles/defaults, forms, extensions and facets refuse before new styles,
settings authority or component factories. Top-level and feature key coverage is checked against SDK
registration types. Name/key validation is shared with backend admission and stays browser-safe.

Evidence: 147 focused host checks and 38 producer checks pass; bypassing frontend acceptance fails four
same-stamp seam regressions, and bypassing the role guard fails its regression. Final review found that
an omitted DSL prefix became the string "undefined"; codegen and admission now agree on an empty
prefix and codegen quotes prefix/global strings correctly. The final strict chain passed in 370.9s
(one of 30 gates cached), including integration, real external-pack app, smoke and packaged authoring.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T13-31-33Z-2547`;
`/private/tmp/apack-fe-membership-strict-chain-final.log`.

The initial surface metadata audit remains unfinished: labels/icons/pinning/routes/shortcuts still live
in executable definitions, and native/all-kind declarations are incomplete. The owning discovery plan
also records concrete frontend replacement hazards: failure can remove incumbent styles and late
factory failure can retire incumbent bindings. Complete resource transactions and declarative metadata
before claiming Phase 3 done. Navigation, boundaries, source/dependency freshness and all three Phase 6
streams remain required; no plans are archived and final `--all` acceptance remains outstanding.


### Owned stylesheet preparation checkpoint (2026-10-13)

`de0d55480` stages inert stylesheet leases and applies them after frontend acceptance. Each attempt
owns cancellation and cleanup; matching hrefs share the physical load without letting a cancelled or
retired lease remove accepted CSS. Failed same-pack candidates retain the incumbent stylesheet;
explicit unload clears pending/accepted styles. Fresh registration is cleaned up if binding aborts
before style commit. Restored checks pass: 28 host cases and nine renderer/runtime cases. Mutations
that remove all styles on failure, apply candidate CSS before commit, or remove a new same-href owner
all fail. Lint found unnecessary iterable copies; these were removed and disposal checks rerun.

The final strict chain passed in 216.8s (17 of 30 gates cached), including real external-pack app,
smoke and packaged-app checks: Chromium fetched inert CSS and applied it after acceptance.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T13-59-24Z-37300`;
`/private/tmp/apack-style-leases-strict-chain-final.log`.

Audit correction: the frontend registry rejects duplicate registration; it does not currently replace
an incumbent. The shell retires old frontends in its unload-before-reload path. An explicit staged
registry replacement plus shell handoff is still required to preserve bindings/settings resources.
Native/all-kind metadata, remaining static readers, navigation, boundaries, freshness and all three
Phase 6 streams remain open. No plans are archived; final `--all` acceptance remains outstanding.


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


### Reconnect frontend handoff checkpoint (2026-10-13)

`854eea117` retains accepted frontends across disconnect/refused replacements, reconciles removals
from an authoritative read, and replaces accepted actors while preserving selection/order/visibility.
The generated settings lifecycle now supports cached modules through explicit activation and disposal;
real composed checks prove replacement without reviving old handles. The missed generated fixture was
corrected before the final strict pass: 303.7s, 15 of 30 cached, evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T15-20-17Z-72081`.
Detailed contract corrections, mutations and limits are in
[the discovery checkpoint](discovery-without-activation.md#reconnect-handoff-and-generated-binding-lifecycle-2026-10-13).

The goal remains active. Live accepted-revision frontend refresh and installed update publication are
still open, alongside native/all-kind descriptors, static consumers/freshness, navigation, pane boundaries
and every Phase 6 stream. No completed-phase claim or archival follows this local checkpoint.


### Accepted registration ID checkpoint (2026-10-13)

`244dd5380` separates accepted runtime lifetime from build content identity and checks it during
frontend settings grant issuance/resolution. Identical-byte reload, refused binding, same-origin reuse
and real-app reactivation are covered; three guard mutations fail and were restored. Final strict chain
passes in 182.9s (18 of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T15-43-13Z-31425`.
See [the discovery evidence](discovery-without-activation.md#accepted-runtime-identity-and-grant-freshness-2026-10-13).

Next fix the demonstrated API declaration build prerequisite in the chain, then publish registration IDs
and use them for targeted live frontend refresh. Those integrations, installed update publication and
all remaining discovery/navigation/boundary/Phase 6 work remain required. No plans are archived.


### Source API contract checkpoint (2026-10-13)

`6913dbae8` closes stale renderer API types through workspace source resolution and removes the API's
alias/build glue. The API suite's newly exposed root metadata cache input is declared; removing either
that input or the source condition fails its guard. Final strict chain passes in 228.7s (18 of 30 cached),
evidence `node_modules/.cache/apack-chain/runs/2026-10-13T16-12-12Z-81950`.
See [the discovery evidence](discovery-without-activation.md#source-api-contract-freshness-2026-10-13).

The API freshness follow-up from the previous checkpoint is resolved. Continue runtime state publication
and targeted live frontend refresh. Installed update publication and every remaining discovery, navigation,
boundary and Phase 6 requirement remain open; no plans are archived.


### Live frontend refresh and mounted lifetime checkpoint (2026-10-13)

`ed8904dd1` connects runtime state publication to revision-aware frontend refresh and readiness.
Standard startup requests wait for frontend acceptance. Real dev reload exposed cached Vue content
retaining stopped actors; actor scopes and owner forms now remount for their resource lifetime, preserving
unrelated content. Eleven guard mutations fail and were restored. Final strict validation passes all 30
gates in 385.9s, evidence `node_modules/.cache/apack-chain/runs/2026-10-13T17-20-14Z-50190`.
See [the discovery evidence and limits](discovery-without-activation.md#live-frontend-refresh-readiness-and-mounted-lifetimes-2026-10-13).

Ordinary live refresh is delivered. Coordinated installed updates, complete native/static discovery,
source/dependency freshness, navigation/stale delivery, pane boundaries and all Phase 6 streams remain
required. No plans are archived; the complete goal audit and final strict `--all` remain outstanding.

### Installer filesystem acceptance checkpoint (2026-10-13)

`replaceDir` now retains the prior directory through synchronous candidate acceptance, restores it on
refusal and checks destination ownership before rollback. `InstallOptions.accept` exposes the verified
candidate at its final path with independent metadata. This is the filesystem foundation for coordinated
runtime installation, not delivery of transactional app install/update: those handlers still tear down
first and must migrate to `replacePack`, with post-acceptance initialization kept separate.

Focused checks pass 92 tests and the host typecheck. Omitting the acceptance call fails the two installer
refusal tests; the source was restored before strict validation. Initial strict validation failed after
all 21 external app assertions passed: fixture cleanup raced API shutdown and raised `ENOTEMPTY`.
The surviving API log and non-awaited child shutdown are recorded in
[the replacement audit](../../plans/replaceable-shipped-packs.md#installed-publication-audit-2026-10-13).
The unchanged-source recheck passes the strict chain in 115.8s (25 cached gates), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T17-52-50Z-12522`; the cleanup race remains unresolved.
All unfinished phases and final strict `--all` acceptance remain required.


### Coordinated live installation checkpoint (2026-10-13)

`814938b6a` wires installer acceptance to transactional registry replacement. Download, runtime-load
and registration refusal preserve the incumbent build, registration/revision, records and generated
settings authority. Resolved-id reservation prevents competing source installs from publishing one owner.
Initialization runs after filesystem acceptance, restarts old/new systems on success, and cleans runtime
resources after failure while retaining accepted files; arbitrary user-data effects are not rolled back.
Disabled updates preserve disabled state and refresh declarations without activating executable code.

All 163 focused tests pass, with four refusal/cache/ownership/enablement mutations caught and restored.
Strict checkpoint validation passes all 30 gates in 393.9s (one cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T18-05-22Z-18099`. The separate API/fixture shutdown
cleanup race remains unresolved despite passing this run. See
[the coordinated installation evidence](../../plans/replaceable-shipped-packs.md#coordinated-app-installation-2026-10-13).

Next remove the now-unused teardown replacement flag and its registry/bus suppression state, and
replace teardown's obsolete extension projection with its lifecycle lookup. Explicit shipped update
ownership, suppression and replace/restore operations remain required, alongside every other unfinished
goal phase. This is not the final requirement audit or strict `--all` acceptance; no plans are archived.


### Obsolete replacement state removal checkpoint (2026-10-13)

`f048ef9f9` removes teardown's replacement flag, registry window/suppression state and its methods,
and the bus's silent missing-surface drop path. Actual teardown always announces removal; refused
replacement retains delivery through the incumbent, and accepted replacement still reports invalid
events. Removed `getPackExtensions` and its executable metadata assembly: teardown uses system ids,
presence checks use registration and installed information uses catalog declarations. The test-app
registry contract and affected fixtures follow the same surface, with no alias or fallback.

All 226 focused tests and the host typecheck pass. Suppressing reports fails the new composed bus cases;
restored checks pass. The initial strict host unit timeout coincided with 1,454 seconds of system sleep
(14:19:10–14:43:24), not a reported test assertion. The unchanged-source awake recheck passes all 30
gates in 247.3s (21 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T18-48-01Z-55317`. Evidence and limits are in
[the replacement cleanup checkpoint](../../plans/replaceable-shipped-packs.md#removal-of-teardown-first-replacement-glue-2026-10-13).

Next implement explicit shipped-pack update ownership and uninstall suppression, then deliberate
replace/restore operations with restart/reload verification. Every other unfinished discovery,
navigation, boundary, API/provenance and final-audit requirement remains in scope. The independently
observed API/fixture shutdown cleanup race also remains open; no plans are archived at this checkpoint.


### Explicit shipped ownership and removal checkpoint (2026-10-13)

`03745e1dc` implements `updatesWith`, a distinct shipped-source revision and deliberate-removal
suppression in installation records. Boot and id-specific refresh require the target profile's record
file; they preserve unrecorded/user-owned builds and retain suppression across pruning. App-owned
source changes refresh without discarding enablement; unchanged source identity does not certify
installed health or repair edited bytes. Build admission still diagnoses invalid installations.

App/CLI/dev installs choose user ownership before publication, and source recording participates in
acceptance. Record write/refusal/deletion failures restore the prior installation decision. Actual
app-owned shipped reload also accepts registration inside filesystem/record rollback, retaining the
incumbent runtime, catalog, bytes and records on collision. Startup/data effects remain outside rollback.

All 169 focused host tests, seven CLI caller tests and CLI/testing typechecks pass. Five ownership,
suppression, pruning, record-write and rollback mutations fail and were restored. Strict validation
passes all 30 gates in 356.8s (one cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T19-24-50Z-88047`. See
[the selected ownership contract and evidence](../../plans/replaceable-shipped-packs.md#explicit-update-ownership-and-removal-suppression-2026-10-13).

Next deliver explicit replace/restore operations, app-source update offers, provenance-only controls,
archive eligibility and the replacement plan's complete restart/reload acceptance. All other unfinished
discovery, navigation, boundary, consumed-API/provenance and final-audit requirements remain in scope.
The independent API/fixture shutdown cleanup race remains unresolved. No plans are archived, and this
is not final strict `--all` acceptance or completion of the shipped replacement workstream.


### Explicit CLI replace/restore checkpoint (2026-10-13)

`85a7e955b` adds `pack replace <id> <source>` and `pack restore <id> --host <path|beta>`, independent
of `--profile` storage. Replacement validates the explicit id and chooses user-managed updates; plain
install refuses an app-managed incumbent. Restoration selects a declared shipped build without
activation, cwd inference, launch or download, re-enables it and records app ownership. Its accepted
record preparation shares boot's helper. Refusal retains the prior build/record or removal marker.

A composed CLI cycle covers restore, user replacement, boot preservation, uninstall suppression and
restoration. App/pack preferences are written to real LMDB, closed before mutation and read back after
restoration. Poisoned executable pack entries prove these offline operations do not activate code.
Other checks cover identity/compatibility, running-app locks, custom profile isolation, host precedence,
missing/duplicate ids and cached-only beta selection. Twenty-eight focused CLI and 27 host tests pass;
five identity/intent/enablement/offline mutations fail and were restored. Host and CLI/testing typechecks
pass. Strict validation passes all 30 gates in 325.8s (one cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T20-01-02Z-23338`. See
[the CLI replacement evidence](../../plans/replaceable-shipped-packs.md#cli-replacerestore-checkpoint-2026-10-13).

Next complete the advertised shipped-id/source identity catalog, live app UI controls, app-source update
offers, archive eligibility and the full restart/reload acceptance matrix. All remaining discovery,
navigation, pane boundaries, supported APIs, dependency provenance and final-audit requirements remain
in scope. The independently recorded API/fixture shutdown race remains open. No plans are archived,
and this checkpoint does not satisfy final strict `--all` or complete the replacement workstream.


### Manifest shipping privilege removal checkpoint (2026-10-13)

`748781815` removes `builtIn` from the manifest/schema, default-setup, codegen fixtures, controlled SDK
build report and public docs. No alias, conversion or special legacy parser remains. Archive eligibility
now follows build freshness/integrity, enabling the actual default-setup build to be archived as a
standalone verified pack. CLI list exposes update ownership; GitHub updates use recorded ownership,
allowing a user-managed default-id fork's remote source while excluding app-managed updates.

All 92 SDK schema/codegen, 18 focused host and four CLI tests pass. The archive test builds an archive
of the freshly rebuilt real default-setup, verifies its checksum, extracts it and checks the receipt.
The controlled SDK report has exactly six obsolete field declarations removed. Strict validation passes
all 30 gates in 381.0s (none cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T20-15-31Z-55624`. No release/version metadata changes.
See [the removal evidence and remaining controls](../../plans/replaceable-shipped-packs.md#manifest-shipping-privilege-removal-2026-10-13).

Next complete the app source/advertised-id catalog and provenance contract, live replace/restore and
uninstall/toggle controls, app-source update offers, optional Threads selection when no pack supplies
that role, and the full clone/edit/restart/reload acceptance matrix. All remaining all-kind discovery,
navigation, frontend boundaries, consumed APIs, dependency provenance and final audit remain required.
The separate API/fixture shutdown race is not declared fixed by a passing run. No plans are archived;
this is not final strict `--all` acceptance or completion of the replacement workstream/full goal.


### Optional window-local Threads checkpoint (2026-10-13)

`7ef47f69b` removes Welcome's throwing process-global designation lookup. The shell resolves optional
Threads from its injected window registry, then uses existing selection behavior; missing/non-frontend
providers keep the current surface while onboarding advances. No fallback feature or actor is created.
The host-only case follows actual renderer bootstrap, which registers native host frontends first.

Six new cases cover host-only and alternate-surface windows, an alternate Threads provider, a
backend-only role, provider removal and two independent window registries. All 23 focused tests and
the host typecheck pass. A hardcoded default-setup role mutation fails and was restored; an ineffective
extra availability guard was removed because selection already handles absence. Strict validation
passes all 30 gates in 331.9s (one cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-13T20-32-47Z-87954`. See
[the optional-role evidence](../../plans/replaceable-shipped-packs.md#optional-threads-during-onboarding-2026-10-13).

Next continue the app source/advertised-id catalog and provenance contract, live pack controls and
app-source update offers, followed by the complete replacement restart/reload acceptance matrix.
All other all-kind discovery, navigation, frontend boundaries, API consumption, dependency provenance
and final-audit requirements remain in scope. The independent API/fixture shutdown race remains open;
no plans are archived and final strict `--all` is still required.


### Shared shipped-source catalog checkpoint (2026-10-13)

`c14572af5` adds a verified data-only app-source projection, separate from installed/native/authoring
settings owners. Boot and CLI restore share the reader. Duplicate advertisements have no winner;
source withdrawal clears offers, and source publication preserves an installed user fork's settings.
CLI restore carries the captured source revision through filesystem acceptance; changed candidates
retain the prior installed receipt and record. Catalog publication owns immutable copies.

Fifty-one focused host tests, six CLI tests and the host typecheck pass. Removing the restoration
revision guard fails its specific assertion; the restored source/catalog suite passes all 24 checks.
Strict validation passes all 30 gates in 355.4s (one cached), including actual external-pack app and
packaged authoring. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T20-52-16Z-20954`;
`/private/tmp/apack-app-sources-strict-chain.log`. See
[the source contract and remaining consumers](../../plans/replaceable-shipped-packs.md#shipped-source-catalog-prototype-2026-10-13).

Next integrate advertised-id installation guards, live pack replace/restore controls, app-source update
offers and provenance-only uninstall/toggle decisions, then complete the external fork/restart/reload
acceptance matrix. Every remaining all-kind discovery, navigation, pane-boundary, API consumption,
dependency provenance and final-audit requirement remains required. The independent API/fixture cleanup
race is still open. No plans are archived; final strict `--all` on finished committed source remains due.


### Live default controls and runtime retirement checkpoint (2026-10-13)

`f5eb580b2` connects source offers to live default-id install guards and explicit replace/restore
requests. All installed packs have disable/remove controls, with update ownership shown separately.
Missing defaults can be restored or replaced by explicit id; restoration confirms the selected source
revision. Removed `canUninstall` and the shipping-based runtime/presentation restrictions. Source
failures and installed load failures stay visible; the native host remains non-removable.

Real Electron acceptance exposed two API crashes from revoking generated settings authority before
old actor/subscription cleanup, first during disable and then during active restoration. Bus teardown
now waits for actor completion; runtime replacement publishes checked candidates and retires incumbent
bindings through the same stop boundary. Ordinary dev reload follows that coordinator. Enablement
persistence precedes runtime changes, and failed deletion no longer itself stops the incumbent.

One hundred focused host tests, nine renderer checks and targeted actual Electron acceptance pass;
three advertisement/id/retirement mutations fail and were restored. Strict validation passes all 30
gates in 357.0s (one cached), including the real disable/remove/user-replace/app-restore cycle and
packaged authoring. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-13T21-28-44Z-84566`;
`/private/tmp/apack-live-controls-strict-chain-final.log`. Detailed failures, contract corrections and
limits are in [the replacement plan](../../plans/replaceable-shipped-packs.md#actor-and-binding-retirement-correction-2026-10-13).

Next finish app-source update offers, standalone CLI advertised-id/host selection, selected-copy
provenance cleanup and the full cloned-source edit/build/restart/reload/multiple-window matrix. All
remaining all-kind discovery, navigation/stale delivery, pane boundaries, API consumption, dependency
provenance and final-audit requirements remain required. The independent process shutdown cleanup
race remains unresolved. No plans are archived; final strict `--all` on finished committed source is due.


### App-source update offers checkpoint (2026-10-13)

`be40c21fd` derives app update offers from verified source identity versus recorded `shippedRevision`,
only for app-owned installed packs. Same-version changed builds are offered; user forks instead retain
explicit restoration. Source failures remain visible separately from installed status. The selected-
revision app update route requires current ownership/existence, checks ownership again at acceptance,
preserves enablement, and does not execute disabled packs. Source acceptance and record preparation
share restoration's implementation without adopting its enable/adopt semantics. Remote checks/offers
and the GitHub route exclude app-owned records. Refreshed list data no longer erases mutation failures.

All 109 focused host tests, 11 renderer tests and renderer typechecking pass. Ownership/disabled-state/
remote-exclusion mutations fail and were restored. Strict validation passes all 30 gates in 359.0s
(one cached), including real app and packaged authoring. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T21-47-31Z-16865`;
`/private/tmp/apack-source-updates-strict-chain.log`. See
[the app-source update contract](../../plans/replaceable-shipped-packs.md#app-source-update-working-implementation-2026-10-13).

Next finish standalone CLI host/advertised-id selection, selected-copy provenance cleanup and the full
cloned-source edit/build/restart/reload/multiple-window matrix. Every remaining all-kind discovery,
navigation/stale-delivery, pane-boundary, consumed-API, dependency-provenance and final-audit requirement
remains required. The independent process shutdown race remains open. No plans are archived; final
strict `--all` on finished committed source remains due.


### CLI source-host and default reservation checkpoint (2026-10-13)

`98234a39a` requires a selected/associated offline host for ordinary pack installation, sharing source
selection with restoration. Cwd and storage profile do not choose a source. Explicit selection wins;
uncached beta refuses without fetching. Named replacement remains independent of source selection.
The guard checks current advertisements (including invalid claims) and installation ownership before
placement, preventing a source change during download from bypassing reservation. Native host is refused.

All 34 focused CLI tests pass, including actual bin execution, absent/disabled/failed/removed/invalid
advertisements, offline selection, explicit precedence, custom profile isolation and late advertisement.
Removing protection makes all six targeted regressions fail; restored source passes. The first strict
run exposed the packaged-authoring shell's missing host argument after app checks passed. Its caller
now supplies the known build host. Final strict validation passes all 30 gates in 97.2s (21 cached),
with fresh packaged authoring/app acceptance. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T22-12-00Z-78713`;
`/private/tmp/apack-cli-source-guard-strict-chain-final.log`. See
[the CLI selection/reservation contract](../../plans/replaceable-shipped-packs.md#cli-source-selection-and-reservation-working-implementation-2026-10-13).

Next finish selected-copy provenance cleanup and the actual cloned-source edit/build/restart/reload/
multiple-window acceptance matrix. Every remaining all-kind discovery, navigation/stale delivery,
pane boundary, API consumption, dependency provenance and final-audit requirement remains required.
The independent process shutdown race is still open. No plans are archived; final full-goal strict
`--all` on finished committed source remains due.


### Selected runtime identity and priority cleanup checkpoint (2026-10-13)

`b40412df3` removes `PackOrigin.shipped`, `shippedPacks()` and boot/loader/reload/harness argument
propagation. Runtime origins describe the selected verified build; records describe update ownership;
the source catalog describes advertisements. Removed advertised-id registration priority in favor of
deterministic pack-id order. Designation conflicts still refuse the later registration and name both
owners; content dependency ordering remains separate. Catalog eligibility/navigation and required
provider readiness still require their own remaining work, not a claim of completion from this sort.

All 148 focused loader/reload/registration/migration/event tests and the host typecheck pass. A real
verified app advertisement and a distinct selected user build share an id; the loaded origin retains
the user build's name/version/path/receipt/files while the advertisement remains unchanged. Strict
validation passes all 30 gates in 390.7s (one cached), including real app and packaged authoring. After
two stale comment corrections, final strict recheck passes in 208.7s (15 cached). Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T22-20-12Z-93616` and
`node_modules/.cache/apack-chain/runs/2026-10-13T22-27-18Z-24275`;
`/private/tmp/apack-runtime-provenance-strict-chain-final.log`.

Next complete the actual cloned-source edit/build/install/restart/reload/multiple-window replacement
matrix. Every remaining all-kind discovery, navigation/stale delivery, pane-boundary, API consumption,
dependency provenance and final-audit requirement remains required. The independent process shutdown
race remains open. No plans are archived; final full-goal strict `--all` on finished committed source is due.


### Real default fork and normal-boot lifecycle checkpoint (2026-10-13)

`29015d951` adds real external-source acceptance: copy default-setup outside the checkout, edit its
manifest display name and Notes surface label, build and archive with the public CLI, replace through
the live app, and verify both windows and actual dev reload use the accepted frontend. A preference
acknowledged by another settings window survives replacement and reload. The clone borrows the test
toolchain; published-package hermeticity is covered separately, not claimed by this case.

A repository-owned runner performs four normal Electron launches over isolated temporary storage.
It verifies the exact installed fork receipt, label, user ownership and preference after restart;
restores app ownership, uninstalls the default and its dependent test fixture through offline CLI;
proves host-only boot retains removal suppression and host settings; then restores the default and
verifies original frontend, app ownership and preferences after another boot. Public test storage
isolation remains unchanged. The runner is included in the gate's fingerprint inputs.

Two full-run collection refusals exposed macOS path aliasing: JavaScript realpath preserves supplied
case while native realpath returns on-disk casing. Canonicalizing the runner's checkout before using
the existing Playwright resolver fixes the duplicate module identity. All targeted lifecycle launches
and final strict validation pass: 30 gates, 193.2 seconds, 22 cached; the full external-pack app gate ran
freshly in 151.8 seconds. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T23-02-15Z-81766`;
`/private/tmp/apack-real-fork-strict-chain-canonical.log`.

Next audit replacement acceptance against its remaining criteria, including actual app-source update
UI behavior, then continue native/all-kind discovery and reader migration. Entity navigation and stale
delivery, pane boundaries, supported consumed APIs, dependency provenance and the final goal-wide
review remain required. The independent process shutdown cleanup race is still open. This checkpoint
is not final strict `--all` on finished committed source; no incomplete plans are archived.


### Coordinated API shutdown checkpoint (2026-10-13)

`3b6bf3059` closes the recorded normal-quit API/fixture cleanup race. Electron cancels quit while
awaiting actual API child exit, shares repeated requests, and resumes ordinary quit after completion.
Relaunch and startup-error quit use the same boundary; pending starts cannot spawn after shutdown
begins. Removed fire-and-forget API kill and the duplicate last-window handler. Existing platform
window policy remains in the application terminator.

Process shutdown no longer treats a delivered signal or an expired deadline as successful exit.
Concurrent stops retain one waiter, exit clears deadline/escalation timers, timeout rejects, and a
later retry recognizes an exit that occurred after timeout. A refused shutdown leaves quit cancelled
with a diagnostic. Real app fixtures capture the API pid and fail if it survives Electron close.
No deletion retries, suppressed cleanup errors, longer timeouts or forced Electron self-kill were added.

The initial 51 main checks and main/testing typechecks pass. Final review's ten focused checks pass;
removing quit cancellation and resolving timeout instead of rejecting each fail the intended assertions,
and restored checks pass. Initial strict passes all 30 gates in 485.3 seconds (one cached). Final strict
on reviewed source passes all 30 gates in 226.6 seconds (18 cached), with fresh external app acceptance
in 160.2 seconds and packaged app acceptance in 7.8 seconds. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-13T23-09-45Z-96278`;
`node_modules/.cache/apack-chain/runs/2026-10-13T23-18-58Z-29821`;
`/private/tmp/apack-coordinated-shutdown-strict-final.log`.

The replacement plan's leading contract now agrees with implemented controls, ownership and explicit
fork restoration. The independent native Electron hidden-window stall is not claimed fixed by this
coordination. Continue remaining replacement acceptance auditing and all-kind/native discovery and
reader migration, followed by navigation/stale delivery, frontend boundaries, supported consumed APIs,
dependency provenance and final goal-wide review. Final strict `--all` on finished committed source
and archival remain due; this checkpoint does not complete or narrow the full goal.


### Surface discovery design audit (2026-10-13)

Audited Surface/SurfaceDefinition, frontend registration/admission, manifest/codegen, all eleven
shipped surface assembly modules, three fixture surface modules, the CLI template and two native host
views. Existing snapshots omit presentation and pane metadata because codegen imports whole surface
objects. The binding guard checks only label/machine shape, not declaration agreement for those fields.

The owning discovery plan now records a complete Surface-field classification and the next implementation
shape: inline presentation plus explicit state/component/route/predicate targets, with codegen assembling
the binding. It accounts for named Library state, five Threads canvas routes, six existing lazy component
bindings, custom icon support and Brain's fallback predicate. Native Settings/Packs views must share the
metadata contract while retaining trusted per-window executable composition. Host/application's shell
inbox and host/help's system do not require invented visible surfaces or actors.

Implement the shared declaration/binding prototype and migrate owned modules, authoring, fixtures and
first catalog reader together; preserve readiness and transactional frontend retirement. The real fork
test must continue proving changed executable behavior after its label moves to the manifest. This is
a design checkpoint, not a claim that new metadata or readers exist yet. All remaining contribution
kinds, native coverage, freshness and other goal phases remain required.


### Declarative surface bindings and catalog details checkpoint (2026-10-13)

`b5697bb88` replaces surface assembly modules with manifest presentation, explicit machine/component
references, canvas routes and fallback predicate references. Codegen checks exports/files and assembles
the bound surface, preserving Library's named machine, Threads' routes and six lazy view bindings.
Fourteen obsolete assemblies, the authoring template and defineSurface helper are removed. Scaffolding,
doctor, contract-leaf rules, schema/API reports, owned fixtures and public docs follow the new contract.
No surface.entry alias or data conversion is added.

Native host view metadata is declared before binding and consumed by renderer composition. Shared
admission checks presentation, shortcuts, pane/route membership and fallback metadata without executing
views/predicates; a refused native replacement retains its accepted frontend and grants no resources.
Top-level registration getters are captured once. The common catalog projects native, disabled installed
and authoring surface data without activation or invented native receipts/authoring enablement. Packs
details uses that projection; hasSurface is replaced by declaration presence. Shell readiness/selection
is deliberately still an unfinished consumer migration, not silently treated as delivered.

The actual default pack and 25 external authoring/dependency/facade integration checks pass, alongside
focused schema, codegen, catalog, binding and handoff suites. Removing label comparison fails the intended
admission assertions; restored source passes. Full validation exposed and fixed fixture paths, a double
registration-ID read and an unconventional actor-filename contract-leaf case. The real fork test now
changes a manifest label and a rendered Vue component, retaining executable replacement verification.

Final strict validation passes all 30 gates in 488.6 seconds (one cached), including complete unit/
integration, real external app acceptance in 156.5 seconds, smoke and both packaged-authoring halves.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T00-28-13Z-89285`;
`/private/tmp/apack-declarative-surfaces-strict-3.log`. This completes this surface checkpoint, not the goal.

Next complete the other contribution descriptors (references, steps/triggers, editors/content/contracts),
remaining native/source provenance and static readers, then shell eligibility/readiness, entity navigation
and stale delivery. Frontend boundaries, supported consumed APIs, dependency identity, remaining replacement
acceptance and final requirement audit remain required. Final strict --all on finished committed source
and archival remain due. No unfinished plan is archived or requirement moved out of the active scope.


### Canonical reference identity prerequisite checkpoint (2026-10-13)

`fe32a83ba` fixes a reachable writer/parser defect: the picker stored entity ids but HTML/Markdown
serialization used short codes, and Threads sends the Markdown output. References now write encoded
entity ids, decode once, preserve presentation separately and escape Markdown labels. Empty/malformed
targets are refused; unknown types/missing ids do not fall back to thread navigation. Updating a node
view also updates its click target, eliminating delivery to the original entity after a visual update.
The owning entity-opening plan's Phase 0 now describes this canonical contract instead of requiring
an implicit lookup of saved short-code URLs. No legacy reader, conversion or fake actor is introduced.

Eight actual Tiptap HTML/Markdown/DOM tests pass, with typechecking. They verify thread/document
identity, duplicate display codes, encoded punctuation, invalid links and updated click delivery.
Restoring short-code serialization fails four cases; restoring the stale closure fails the update
case; exact source is restored and all eight checks pass again. Descriptor callbacks are stand-ins,
so this proves identity delivery, not the full entity destination/readiness coordinator.

The pack declares the already available editor/DOM test dependencies. An offline install initially
selected newer cached Tiptap packages; the original locked resolutions were restored. Comparison of
every lockfile entry proves only default-setup dev-dependency metadata differs. Node's binary globals
remain intact while the tests install DOM globals locally, avoiding the documented esbuild/jsdom realm
conflict. Production data, application release versions and existing package resolutions are unchanged.

Strict validation passes all 30 gates in 491.1 seconds (none cached), including full units/integration,
actual external app, smoke and both packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T00-51-53Z-23984`;
`/private/tmp/apack-reference-identity-strict.log`.

Continue declarative references/categories/providers and remaining contribution kinds/native metadata,
complete freshness/static readers, entity destinations/readiness/stale delivery, frontend boundaries,
supported consumed APIs, dependency provenance and remaining replacement acceptance. Final goal-wide
requirement audit, strict --all on finished committed source and archival remain required. This
prerequisite checkpoint completes none of those broader phases or the full goal.


### Declarative reference foundation checkpoint (2026-10-13)

Source commit `9c56c6730` replaces executable reference metadata assemblies with inline feature
reference declarations. Six shipped types and three categories now declare their identities,
icons/SVG geometry and checked navigation/item-provider exports. Authored/native schemas refuse
within-pack feature collisions; generation validates category availability and dependency provenance,
accepting a shared ancestor through a diamond while refusing different owners. Executable source
modules contain only navigation and reactive enumeration functions.

The common catalog projects immutable reference declarations for native, installed and authoring
origins. The production Packs summary/detail path reads those declarations; both a disabled pack and
an actual activation failure retain their reference metadata. Native references remain data admission
only: complete native binding/source checks and global runtime ownership are still required.

Sixteen focused reference checks passed. A removed function-kind guard caused the navigation/provider
refusal tests to fail, and exact restoration returned the suite to passing. The final strict chain
passed all 30 gates in 548.2 seconds with no cached gates, including 4,324 host unit tests, 839 pack
unit tests (two existing skips), 639 integration tests, actual external/default-fork Electron acceptance,
smoke and both packaged-authoring halves. Schema/API reports and authoring documentation agree.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T01-17-42Z-60078`;
`/private/tmp/apack-reference-declarations-strict.log`.

Next register explicit reference frontend bindings, validate their complete declaration membership,
reject global owner collisions transactionally and migrate the editor to catalog metadata plus active
provider lookup. Remove the pack-local generated aggregate after migration; do not retain it as a
compatibility fallback. Continue other contribution kinds, native/source/dependency freshness,
eligibility/entity destinations and stale delivery, frontend recovery boundaries and all three Phase 6
workstreams. Final requirement-by-requirement review, committed-source strict --all and archival remain
due. This checkpoint does not complete the whole goal or any broader discovery/navigation phase.


### Reference frontend admission checkpoint (2026-10-13)

Source commit `8371cd4f9` registers generated reference bindings under their owning feature and
checks exact declaration membership, protocol/category/geometry/label data and function/component
shapes before admission. Global type, protocol and category collisions name both feature owners and
refuse before candidate resources run. Accepted reference metadata is captured and frozen; replacement
and removal release its captured keys without altering incumbents on refusal or abandonment.

Review reproduced a validation/publication defect: an authored protocol getter returned `note` during
validation and `changed` during capture. Native preparation and the installed loader now capture
reference data before validation; both paths have behavioral regression tests. The general frontend
`onChanged` subscription replaces the forms-only name that already notified every registration change.
All callers and the testing shell adapter are migrated, with no compatibility alias.

Nineteen focused admission checks passed. Removing ownership refusal failed five named assertions;
removing the callable navigation guard failed its assertion. Exact restoration returned all 19 cases
to passing. Final strict validation passed all 30 gates in 520.5 seconds with no cached gates, including
4,344 host tests, 839 pack tests (two existing skips), 639 integration tests, actual external/default-fork
Electron acceptance, smoke and both packaged-authoring halves. SDK API reports agree.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T01-50-14Z-96639`;
`/private/tmp/apack-reference-bindings-strict.log`.

Admission is delivered; app-wide editor discovery/provider lifecycle is not. Transport audit confirms
`packs.loaded` and `ShellClient.loadedPacks()` report runtimes, excluding disabled/activation-failed
packs. Next carry common catalog declarations into the window independently of that execution path,
then migrate editor readers and dispose/recreate providers on binding changes. Remove the pack-local
aggregate at that migration and test an actual external reference contributor in an already-open editor.
Continue all other kinds/native locator checks/freshness, entity routing/readiness, boundaries and every
Phase 6 workstream. Final committed-source --all, whole-goal acceptance auditing and archival remain due.


### Window declaration transport checkpoint (2026-10-13)

Source commit `aa756b243` exposes the existing common catalog through `packs.catalog`, streaming the
current snapshot and committed updates independently of loaded runtimes. Router checks cover native
and disabled installed declarations without activating their targets; each subscriber releases its
catalog listener. Frames carry publisher-run identity and catalog revision.

The window-owned reader captures immutable ordinary-JSON snapshots, validates frame bookkeeping,
ignores older revisions and refuses conflicting data at one revision. Generation guards reject late
callbacks after restart, timeout, disconnect and disposal. Synchronous setup cleanup, failed observers
and an initial-read timeout are covered. It retains the last accepted snapshot on failure with an
explicit unavailable status. Declaration validation remains the producer's responsibility; no Node
build tooling is imported into the window to repeat build admission.

The renderer connects/disconnects this resource with its bus lifetime without gating activation on
catalog delivery. Old bus/status/settings callbacks cannot resurrect a stopped subscription. A composed
renderer test proves catalog data reaches the real resource before settings bootstrap announces readiness.
Twelve reader, two router and eight renderer-client checks pass. Removing connection-generation guards
failed three named restart/timeout/disposal assertions; exact restoration passed the reader suite.

Strict validation passed all 30 gates in 371.4 seconds (12 cached), including fresh Electron/default-fork
acceptance, smoke and both packaged-authoring halves. The final renderer composition assertion and
formatting passed a subsequent strict run in 62.1 seconds (21 cached); rebuilt app bytes were unchanged,
so app acceptance was reused. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T02-18-57Z-31693`
and `node_modules/.cache/apack-chain/runs/2026-10-14T02-26-46Z-59802`;
logs `/private/tmp/apack-window-catalog-strict.log` and `/private/tmp/apack-window-catalog-strict-final.log`.

Next expose the declaration read port and migrate reference/editor/provider consumers to catalog data
plus accepted bindings, preserving owner and lifetime identity for eligibility. Test an actual external
reference contributor in an already-open editor and dispose providers on binding/view changes. Remove
the pack-local aggregate at that migration. All remaining kinds/native/freshness, entity routing,
boundaries and Phase 6 streams remain required, alongside final committed-source --all and the complete
acceptance audit. Transport is delivered; the owning goal and discovery consumers remain unfinished.


### Owned reference identity prerequisite checkpoint (2026-10-13)

Source commit `53bcabf62` preserves qualified feature ownership and accepted identities in reference
read entries. Module declaration stamps remain separate from the runtime/build revisions supplied
by the host loader. Capturing only host identity fields prevents unrelated caller fields from overwriting
the owner or declaration stamp. Native bindings omit installed/runtime identities instead of inventing
receipts. Immutable entries remain stable across unrelated pack changes and change on replacement.

The pre-migration audit found that configurations keyed only by global names could not prove ownership
or eligibility. This checkpoint fixes that prerequisite, not the consumer migration. All existing
binding readers/tests use the owned shape, without a compatibility alias or runtime discovery fallback.
Twenty-one admission and 31 loader checks pass. Recreating entries during table rebuilding failed the
stability assertion; exact restoration returned all admission checks to passing. SDK reports agree.

Strict validation passed all 30 gates in 543.3 seconds with no cached gates, including 4,362 host tests,
839 pack tests (two existing skips), 639 integration tests, actual external/default-fork Electron
acceptance, smoke and both packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T02-40-19Z-74516`;
`/private/tmp/apack-reference-identity-strict.log`.

Next deliver the SDK declaration read port and catalog/editor/provider migration, retaining owner and
lifetime identity for eligibility. Remove the current pack-local editor aggregate at that migration;
verify external contributions in an already-open editor, dynamic protocols/categories and provider
scope disposal. Continue every remaining contribution/native/freshness, entity readiness, boundary and
Phase 6 requirement. Final committed-source --all, full acceptance auditing and archival remain due;
the whole goal is active and no broader discovery phase is complete.


### Frontend declaration read-port checkpoint (2026-10-13)

Source commit `5576298c5` exposes a frontend SDK read port over the existing common catalog.
Reference projections retain qualified ownership, provenance and available declaration/build
identities. Native and source entries omit identities or eligibility facts they do not possess.
Projection reads execute no provider, component or navigation target and introduce no authored inventory.

The window reader caches immutable projections by accepted snapshot identity and exposes explicit
loading, ready, unavailable and disposed states. Retained metadata on disconnect remains visibly
unavailable. Frontend declaration notifications have their own subscription; backend catalog
notifications keep their existing backend scope. Renderer composition supplies the real read port;
test runtimes refuse undeclared catalog access rather than silently supplying an empty inventory.

SDK checks passed 952 tests, focused host checks passed 30, and renderer checks passed 13.
Iterating the live observer set instead of the publication's captured observers failed the named
new-observer regression; exact restoration passed all 14 window-reader checks. The initial strict
run stopped at lint over an inline Set spread. An explicit observer queue fixed that failure without
suppressing the rule. Final strict validation passed all 30 gates in 478.8 seconds (11 cached),
including 4,366 host tests, 839 pack tests (two existing skips), 639 integration tests, fresh actual
external/default-fork Electron acceptance (165.1 seconds), smoke and both packaged-authoring halves.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T03-07-16Z-13212`;
`/private/tmp/apack-catalog-read-port-strict-final.log`;
`/private/tmp/apack-catalog-port-observer-mutation.log`.

The read port is delivered; editor and provider consumption is not. Next replace pack-local reference
aggregates with declaration metadata and eligible owned bindings, verifying external contributions
in an already-open editor and provider disposal across replacement/removal/view teardown. Every
remaining discovery kind, native/freshness check, navigation/boundary requirement and Phase 6
workstream remains required. Final committed-source --all, full acceptance audit and archival remain due.


### Editor/provider audit checkpoint (2026-10-13)

Plan commit `e86b89978` records the current consumer audit and migration sequence in
[discovery without activation](discovery-without-activation.md#editorprovider-consumer-audit-and-migration-sequence-2026-10-13).
The audit confirmed construction-time protocol capture, static category/icon readers, a no-op
Markdown DOM hook, and providers started eagerly for the entire popup component lifetime. Existing
SDK surface-state composables already dispose subscriptions with effect scopes.

The next implementation uses one shared eligibility reader before switching editor consumers,
then removes generated pack-local aggregates and obsolete public category/provider types. Acceptance
includes dynamic parsing in an already-created editor, scoped provider cleanup, stale/disabled/
disconnected execution refusal, stable unrelated updates and an actual external contributor.
This documentation-only checkpoint passed `git diff --check`; it claims no new runtime validation.
The goal remains active with all previously recorded outstanding requirements unchanged.


### Shared reference eligibility reader checkpoint (2026-10-13)

Source commit `7de659194` supplies the SDK join between common reference declarations and accepted
frontend bindings. Static type/category reads never consult executable registrations. Categories retain
qualified owners and duplicate names. Ambiguous installed/native names refuse executable lookup;
source advertisements do not become runtime claims. Installed execution requires ready catalog status,
explicit enablement, matching feature/declaration/build identity and an accepted runtime identity.
Native bindings use their unstamped native contract. Lookup returns the stable accepted binding and
never invokes navigation, providers or components. Consumers can observe both publication lifetimes
through separate declaration/binding subscriptions and release each explicitly.

Twenty-one focused checks and the full SDK suite (971 tests, 85 files) pass. Independently removing
owner and build checks fails the corresponding named refusal assertion; byte restoration returns
the focused suite to passing. SDK typecheck and the regenerated public API report agree. The first
API-report command hit the sandbox's local IPC restriction; the authorized escalated rerun passed.

Strict validation passed every one of 30 gates in 555.6 seconds with no cached gates, including
4,385 host tests, 839 pack tests (two existing skips), 639 integration tests, actual external/default-fork
Electron acceptance (160.3 seconds), smoke and both packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T03-26-20Z-46494`;
`/private/tmp/apack-reference-reader-strict.log`;
`/private/tmp/apack-reference-reader-owner-mutation.log`;
`/private/tmp/apack-reference-reader-artifact-mutation.log`.

The shared reader is implemented; current editor/provider consumers still use the pack-local aggregates.
Next migrate parsing/rendering/suggestions and provider scopes together, remove those aggregates and
obsolete public types, and verify actual external references in an already-open editor. All other
discovery kinds/native/freshness, entity routing/readiness, boundaries and the three Phase 6 workstreams
remain required. Final committed-source --all, whole-goal acceptance auditing and archival remain due.


### Editor/provider consumer checkpoint (2026-10-14)

Source commit `20ab75efe` migrates the editor from pack-local reference aggregates to shared declaration
and eligibility readers. Protocol lookup is metadata-only and evaluated by generic anchor parsing at
parse time. Existing node views follow geometry changes, resolve current navigation at click time and
release both declaration and click handlers on retirement. Popup state follows real editor transactions;
keyboard handlers leave the previous editor through watcher cleanup. Popups mount only with an editor.

The picker starts only the selected eligible category while open. Child effect scopes stop on category
change, closure, replacement/removal, disconnect and view teardown; stable bindings survive unrelated
publications. Synchronous closure during provider setup cannot publish stale items. Item filtering
refuses unknown/inactive/wrong-category types. Generated references now contain only per-feature
bindings; obsolete aggregate exports and category/provider types are removed. The note-type mapping
belongs to notes. Providers are documented as synchronous effect-scope composables using
`onScopeDispose`, without reliance on a component instance or lifecycle hooks.

The first pack frontend build exposed the missing host-shared `@apackdev/sdk/fe/references` subpath.
The existing shared-module map now supplies that module, preventing a duplicate host binding. The real
external fixture declares memo references, provides reactive items/navigation, and tests its contribution
in an existing viewer and editor picker. Its Electron case passes canonical-id navigation and insertion.
Nineteen focused editor/provider checks pass; provider-disposal and retired-node cleanup mutations fail
named assertions before exact restoration. Fifty-eight chain-input checks pass; omitting shipped-pack
inputs fails four named app-fingerprint assertions. Public reports/docs and generated bindings agree.

The initial strict run stopped at notification-loop lint; explicit publication queues fixed it. Consumer
validation then passed all 30 gates in 450.7 seconds (13 cached), including fresh external acceptance.
Final lifecycle validation passed in 203.5 seconds (17 cached), including 850 pack tests (two existing
skips), but revealed that app checks incorrectly cached over changed shipped-pack bytes: they declared
app bundles and omitted the separately loaded pack build. Correct all app-check inputs, including
opt-in E2E, and remove the stale comment claiming the app compiles pack sources.

The corrected final strict run passed all 30 gates in 209.3 seconds (20 cached), with fresh real
external/default-fork Electron acceptance (157.1 seconds), smoke (4.9 seconds) and packaged-authoring
app acceptance (7.6 seconds); unchanged author/package gates were reused. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T04-06-57Z-42359`;
`/private/tmp/apack-editor-strict-cache-fixed.log`;
`/private/tmp/apack-editor-provider-disposal-mutation.log`;
`/private/tmp/apack-editor-retired-node-mutation.log`;
`/private/tmp/apack-editor-pack-cache-mutation.log`.

Next audit initial document parsing when catalog delivery is delayed, then complete the broader
editor/declaration contribution migration, every remaining kind/native/freshness check, entity
routing/readiness, frontend boundaries and the three Phase 6 workstreams. Current live parsing does
not prove previously unknown anchors upgrade when metadata arrives. Final committed-source --all,
whole-goal acceptance auditing and archival remain due. The goal remains active.


### Delayed-catalog reference identity audit (2026-10-14)

Plan commit `6dd6f62b8` corrects the stored-reference contract after an actual Tiptap reproduction
showed target loss before declaration delivery: Markdown with a cold memo URI serializes as label
text, so later metadata cannot recover its entity id. Evidence:
`/private/tmp/apack-reference-delayed-catalog-repro.log` (named target-retention assertion failed).
The temporary red assertion was removed by exact byte restoration; source remains at the validated
consumer checkpoint. The audit also found hardcoded pack schemes in the shared UI Link configuration.

The owning [entity-opening plan](../../plans/open-entity.md#reference-wire-identity-correction-2026-10-14)
and discovery plan now specify one internal reference URI carrying encoded reference type and
canonical entity id. Parse/write identity without metadata; use declarations for presentation and
accepted bindings for execution. Keep existing node attributes, without a provisional entity or
reparsing user documents. Remove per-type protocol fields/provenance/lookup and the UI scheme list,
migrating every owned contract and example outright. No old-format parsing or compatibility layer.

Next implement and validate this correction, including absent/late metadata, unchanged document/
selection/history on publication, ordinary link behavior and actual external-reference acceptance.
The correction is designed, not delivered. All remaining discovery/native/freshness, entity-opening,
boundary and Phase 6 requirements plus final committed-source --all and archival remain outstanding.
This documentation checkpoint passes `git diff --check`; no new runtime fix is claimed.


### Metadata-independent reference identity checkpoint (2026-10-14)

Source commit `c776d1c5d` implements the reference URI correction. A pure SDK framework codec writes
`apack-ref://<encoded-type>/<encoded-entity-id>` and parses exactly those two nonempty segments,
refusing malformed encoding, extra paths and raw query/fragment delimiters. It escapes Markdown URL
delimiters as well as normal URI component characters. The frontend entry reexports the same codec;
backend consumers need no frontend runtime. No declaration read or activation determines identity.

The existing editor node preserves targets before metadata arrives and after declarations disappear.
Unknown presentation types retain identity and stay inert until matching accepted bindings are ready.
Publication updates icons without replacing document state/node identity, changing selection/history or
replaying navigation. Per-type protocol fields, provenance/collision claims and lookup are removed
outright, including the shared UI's hardcoded reference schemes and obsolete inline note-scheme click
branch. Type/category ownership and accepted-binding eligibility remain intact. No legacy URI fallback.

The audit also found backend note backlink extraction tied to the old scheme. It now uses the shared
codec and a notes-owned mapping shared with the frontend, covering note/task/task-list references,
escaped labels, encoded ids and deduplication. Authored content examples, independent change-tracking
expectations and goldens migrate together. Goldens were regenerated with `content-parity:update`;
all 145 content checks pass. The first content run caught the old syntax in its independent oracle,
which was corrected. Public schema, three SDK reports, all manifests/fixtures and the real external
reference/picker acceptance use the current contract.

Focused checks pass 72 SDK checks plus the later shared-codec/content-runtime checks, 80 host checks,
and 24 editor/provider/backlink checks. Removing URI structure validation fails three malformed-target
assertions; reintroducing declaration-gated serialization fails unknown/cold-target assertions. Exact
restoration passes the checks. The initial pack-test attempt correctly refused stale generated
declarations; rebuilding the pack resolved it without bypassing the freshness guard.

Strict validation passed all 30 gates in 545.8 seconds with no cached gates: 4,405 host tests,
855 pack tests (two existing skips), 639 integration tests, fresh actual external/default-fork Electron
acceptance (164.2 seconds), smoke and both packaged-authoring halves. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T04-44-15Z-64383`;
`/private/tmp/apack-reference-wire-strict.log`;
`/private/tmp/apack-reference-wire-parser-mutation.log`;
`/private/tmp/apack-reference-wire-retention-mutation.log`.

The parsing node still belongs to the default pack's editor extension. Next settle intrinsic schema
availability without that extension, then finish every remaining discovery/native/freshness kind,
entity opening/readiness, pane boundaries and the three Phase 6 workstreams. A new untracked
`docs/issues/ISSUE-plan-consolidation-scope-loss.md` reports potential lost original requirements;
reconcile its evidence with the archived sources before the next implementation, without narrowing
the original scope to the current ledger. Unrelated draft documents are preserved and not included
in this checkpoint. Final committed-source --all, full requirement audit and archival remain due.


### Original manifest scope reconciliation (2026-10-14)

Documentation commit `7f7c75749` restores concrete manifest outcomes that consolidation had weakened
to audits/deferrals. [Manifest consolidation](../../plans/manifest-consolidation.md) maps all 17 original
decisions, both naming questions, all seven original phases and their checks, plus convention-first,
declarative-contribution and facade requirements. Current schema/tool/reader inspection corroborates
unfinished entity/shape maps, relation identity maps, lifecycle root, check sidecar, missing feature
purpose, format key, canonical writer and facade terminology. Static keyed lifecycle bindings already
exist; their current checked contract replaces the old opaque module proposal.

The roadmap, discovery plan and goal now require M1–M6 before expanding more consumers across the
old entity split. Required checks include preserved generated EARS/typed-untyped behavior, content
identity/no syntax-only reapplication, all loosely typed/native/source/install readers, authoring tool
agreement, schema descriptions/assistance and complete public docs. Flow/action relationships, actual
CLI inventory and capability-based facade acceptance remain explicit completion obligations.

Editor and app contributions use direct `extensions.textEditor` and `extensions.appExtensions`;
the frontend wrapper is removed because other contribution kinds also serve the frontend;
`hostVersion` stays the one-host compatibility range. Explicit keyed existence, richer binding data,
settings/help redesign and host-established provenance remain; obsolete `provides`, inferred existence,
partition/volatile additions, compatibility and version bumps are not restored. Lazy activation and
strong isolation remain deferred/separate. Archival changes only the predecessor's successor notice.

Verification: every original decision number 1–17 occurs exactly once in the reconciliation; active
local documentation links resolve; `git diff --check` passes. This is tracking/design repair, not runtime
completion. The new scope-loss issue and recovery prompt remain unrelated untracked drafts. Start M1
by pinning generated EARS/content/completion evidence, then implement the required consolidation.

- M1 baseline: facade typing/completions passed all 10 tests under bundler/node16 resolution (`/private/tmp/apack-manifest-consolidation-completion-baseline.log`). Generated EARS and six compiled content files are pinned in `/private/tmp/apack-manifest-consolidation-baseline`; type references remain build-time only and installed discovery must require neither source files nor executable imports.


### Entity ownership and shape consolidation — M1 (2026-10-14)

Source checkpoint `2fff8bb76` merges entity identity/ownership/optional shapes under
`features.<id>.entities` or `data.entities`. `_packEntities` is the shared projection;
`_packEntityTypes` derives the flat identities used by generators, provenance, offline schema/Packs
inspection and runtime admission. Duplicate homes name both owners. Native declarations share the
value grammar and check runtime entity identities before registration. All authored manifests,
scaffolds, fixtures, readers, reports and public docs moved together; no old-format reads or aliases.

Shape references use the common `path#export` parser/grammar and the existing TypeScript declared-type
checker. Missing/value-only exports and escaped or missing modules fail naming the entity/path.
A poisoned shape module proves generation never executes it; a sealed offline fixture with no source
files and a poisoned runtime proves discovery reads metadata only. Typed EARS implementation/signatures
were not widened. SearchIndex/IndexedDoc remain untyped. Baseline comparison preserved all EARS
constant values, shape mappings and imports; all six compiled content files remained byte-identical.
Feature grouping changes inert generated ordering, reflected in the reviewed facade report, without a
second authored inventory to reproduce historical ordering.

Validation:
- SDK focused: 230 tests; final schema/shape subset: 66 tests. Host focused: 161 tests.
- CLI authoring/runtime: 16 tests; dependent/published facade typing, completions, diamond provenance
  and facade-report integrations: 34 tests. Four repaired fixture/refusal suites: 66 tests.
- Empty-reader mutations failed the named offline discovery and disabled/failed Packs inspection
  assertions; exact source restored, then 58 host tests passed. Logs:
  `/private/tmp/apack-m1-database-mutation.log`, `/private/tmp/apack-m1-inspection-mutation.log`.
- Final strict checkpoint passed in 422.7s (14/30 cached): host 4,409, pack 855 plus two existing skips,
  integration 639; external-pack contract, actual Electron app (161.4s), smoke (5.0s), packaged author
  (57.3s) and packaged app (8.0s). Evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-14T05-40-21Z-13908`,
  `/private/tmp/apack-m1-strict-repaired.log`.
- Strict validation first caught the required facade ordering update, then four stale fixture/test
  readers/refusal expectations. All were repaired before the source commit; no guards were bypassed.
  Generated schema, SDK build/framework API reports and default-setup facade report reviewed;
  `git diff --check` passed. Unrelated issue/prompt drafts remain untracked and untouched.

M1 is complete. Continue M2 relations, then M3–M6 before expanding discovery. The entire remaining
goal, including all three Phase 6 workstreams, stays active; final committed-source strict `--all`
and the complete reconciled requirement audit remain mandatory at closure. Nothing is archived.


### Relation vocabulary consolidation — M2 (2026-10-14)

Source checkpoint `3ff590240` replaces authored root `relKinds` maps with `data.relations` wire lists.
All authored packs were inspected: their constants are already the uppercase wire names. The
predecessor's claim that the old schema enforced that convention was incorrect; new validation now
makes it explicit. Native declarations use the same vocabulary and checked runtime membership.
`data-declaration.ts` and `PackDataDeclarations` provide one shared input for entity ownership/shapes
and relation vocabulary, avoiding separate intersected data interfaces. `_packRelationTypes` feeds
codegen, provenance, schema/Packs inspection and runtime admission. Runtime/snapshot EARS maps remain
flat derived builds. No compatibility handling, aliases or conversion paths were introduced.

Schemas, templates, authored/native fixtures, all readers, CLI authoring, API reports and public docs
moved together. A source-free installed fixture with a poisoned executable proves relation discovery
without activation. Byte comparison against `/private/tmp/apack-m2-baseline` preserved generated
`ears.ts` and all six compiled content files exactly; the existing facade report still passes unchanged.

Validation:
- SDK schema/projection/provenance/generation checks: 124 tests; host/API/CLI focused: 219; actual
  dependent-pack typing/completions and provenance integrations: 15; console fixture: three.
- Removed duplicate-wire checks, uppercase enum derivation, SDK reservation checks and offline reader
  projection in separate mutations. Each failed assertions; exact source restored, then 21 checks
  passed. Logs: `/private/tmp/apack-m2-{duplicate,enum,reserved,offline}-mutation.log`.
- Strict checkpoint passed in 380.7s (16/30 cached): full host run before the final pack-fixture repair
  passed 4,425 tests; final host subset passed 945, pack 855 plus two existing skips, integration 639.
  Actual Electron app (168.1s), smoke (5.0s), packaged author (56.2s) and packaged app (7.7s) passed.
  Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T06-26-58Z-64383`,
  `/private/tmp/apack-m2-strict-console-repaired.log`; full host evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-14T06-24-23Z-57682/test-unit-host.log`.
- Strict caught one test-fixture inference error and a console fixture's lowercase enum alias; fixed
  the fixtures without widening production types. Reviewed schema/API diffs; `git diff --check` passed.
- The prompt draft disappeared during this work, leaving the untracked scope-loss issue's link broken.
  Repaired only that reference to the active consolidation plan; its draft remains untracked and was
  excluded from source commits. Documentation-link checks passed all six tests.

M2 is complete. M3 must cover native lifecycle metadata and checked membership as well as the authored
root move; native declarations currently have no lifecycle field. Preserve execution/content identity,
then finish M4–M6 and the entire remaining discovery/settings/navigation/boundaries/Phase 6 goal.
Final committed-source strict `--all` and the complete requirement audit remain required; nothing is
archived or declared globally complete.


### Checked lifecycle declarations — M3 (2026-10-14)

Source checkpoint `e063ec1a5` replaces authored and runtime `boot` properties with `lifecycle`.
`PackLifecycleDeclaration` carries targets; `PackLifecycleHooks` carries functions. One membership
and callability guard serves native and installed admission without invoking callbacks. Native
metadata survives unload, and invalid bindings fail before registration/catalog publication.
Generators, schemas, API reports, readers, native fixtures, external manifests, UI and public docs
moved together. Actual app boot remains a process phase; activation, hydration, migrations, content
apply and shutdown retain their existing order. No compatibility alias or conversion was added.

Validation:
- Generated EARS and all six compiled content files are byte-identical to
  `/private/tmp/apack-m3-baseline`; the facade report is unchanged.
- Native/installed admission and host-runtime checks: 61 passed after exact restoration. Removing
  membership and function checks separately failed named assertions; logs are
  `/private/tmp/apack-m3-{membership,function}-mutation.log`.
- Full strict chain passed in 573.1s (9/30 cached), including actual external Electron app (187.3s),
  smoke (5.6s), packaged authoring (63.3s) and packaged app (8.8s). Evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-14T06-50-36Z-98234`.
- Final review restored meaningful boot-phase comments and removed an unrelated malformed lifecycle
  property from a collision fixture, giving that fixture a direct `PackManifest` annotation. Its
  focused test passed. Reviewed-source strict validation passed in 287.6s (15/30 cached), with
  typechecks, lint, host/pack/integration checks freshly run; app checks retained the full-run evidence.
  Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T07-01-12Z-29230`,
  `/private/tmp/apack-m3-strict-reviewed.log`. `git diff --check` passed.

M3 is complete. Remove unnecessary moved-key diagnostics under the no-compatibility rule, then
continue M4–M6 and every remaining goal phase. Final committed-source strict `--all` and the full
requirement audit remain required. The unrelated issue draft stays untracked. Nothing is archived.


### Current-schema diagnostics without obsolete-key knowledge (2026-10-14)

Source checkpoint `dd960261a` removes `_MOVED_ROOT_KEYS` and `movedKeyHint`. Validation retains
strict current-schema errors, diagnostic codes, pack ownership and field paths. Tests now assert
those supported diagnostics rather than an inventory of historical keys. This supersedes the
predecessor's moved-key-hint requirement under the user's explicit no-legacy-handling direction.
The active roadmap and consolidation plan use the same rule; archived history remains unchanged.

Focused schema/diagnostic checks passed 41 tests; documentation links passed six. All 30 strict
steps ran and passed in 677.0s: host 4,428 tests, shipped pack 855 plus two existing skips, integration
639, actual external Electron app 187.0s, smoke 5.5s, packaged authoring 60.9s and packaged app 8.3s.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T07-09-38Z-56229`,
`/private/tmp/apack-schema-current-strict.log`. Reviewed diff and `git diff --check` passed.

M4's inspected authoring design is committed in `eaa187b07`. Feature purpose and explicit type-module
authoring remain next, followed by all M5/M6 and remaining discovery, navigation, frontend boundaries
and three Phase 6 workstreams. Final strict `--all` on committed source and requirement-by-requirement
audit remain mandatory. The unrelated issue draft remains untracked; no work is archived.


### Explicit feature type modules — M4 authoring checkpoint (2026-10-14)

Source `0e65ece42` replaces `typesEntry` with optional `types`, a pack-root-relative TypeScript
module whose public types are re-exported. Generation reads only declared modules; conventional
feature files and `export-types.ts` companions no longer create contributions implicitly. One
resolver serves generation and validation; doctor already uses that validation. It handles explicit
extensions and directory barrels, and rejects absolute, escaping and external symlink targets.
Scaffolding declares its generated type module. Default-setup declares eleven modules and explicitly
composes its three companion export files, preserving the public facade without widening shapes or EARS.

Schema, API report, real manifests, external fixture, authoring tests and public docs moved together.
JSON Schema exposes the module-versus-single-export restriction. Corrected stale designation guidance
and the typed-EARS guide's obsolete Settings-entity claim. Native type/facade production remains part
of the full native discovery audit; this source checkpoint does not certify that work complete.

Evidence:
- Final focused schema/generation/validation: 81 passed. Inference, containment and module-reference
  restriction mutations each failed named assertions; exact source restored. Logs:
  `/private/tmp/apack-m4-types-{inference,containment,reference}-mutation.log`.
- Baseline `/private/tmp/apack-m4-types-baseline`: generated EARS and all six compiled content files
  remain byte-identical. The published facade report passes unchanged.
- Full strict first run passed in 646.3s. Final reviewed source passed all 30 strict steps in 613.4s:
  host 4,432 tests, pack 855 plus two existing skips, integration 639, real Electron app 174.8s,
  smoke 5.3s, and packaged authoring/app checks. Evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-14T07-42-34Z-24389`,
  `/private/tmp/apack-m4-types-strict-reviewed.log`. Diff/schema/API review and diff checks passed.
- A new agreement test caught a stale generated schema during parallel preparation. Serial
  regeneration resolved the mismatch; the generator imports source, so stale SDK output was not
  established as the cause.
- An unrelated draft had become staged during validation and was accidentally included in the
  initial commit. Amended only that new commit to exclude it and restored its staged addition;
  its contents were preserved. Future commits use explicit paths, including commit path selection.

M4 remains in progress: required feature descriptions, declared scaffold forms and remaining
authoring/target checks come next. M5/M6, full discovery, navigation, boundaries and all three Phase 6
workstreams remain required. Final strict `--all` on committed source and the complete requirement
audit remain mandatory. Nothing is archived.


### Feature purpose and complete scaffold declarations — M4 checkpoint (2026-10-14)

Source `ae7a995bd` requires nonblank feature `description` through one shared authored/native
schema. Real declarations describe their functionality; native catalog data, installed summaries
and the feature UI retain purpose without activation. Executable feature bindings do not carry it.
`add feature` requires explicit purpose and uses the shared field validator before writing files;
it also declares the custom settings form it already creates. Public guidance, schemas/API reports,
all real manifests and fixture producers moved together. There is no inferred purpose, alias or
conversion in production readers; testing constructors supply authored stand-in metadata.

Evidence:
- SDK checks: 82; native/catalog/runtime focused: 111; feature UI: 12; restored purpose-guard
  checks: 69. Required and blank-value mutations each failed named assertions; exact source restored
  (`/private/tmp/apack-m4-description-{required,blank}-mutation.log`).
- Broad review identified missing metadata in older fixture declarations, not a reason to weaken
  validation. Migrated those declarations and retained their original refusal/rollback assertions:
  six remaining runtime/build fixture files passed 196 tests; transport checks passed 23; real
  external authoring passed, including required-input refusal before writes, scaffolded forms,
  build/typecheck/archive and nonmatching designation roles.
- EARS and six compiled content files remain byte-identical to
  `/private/tmp/apack-m4-description-baseline`; the published facade report passes unchanged.
- Strict validation passed in 411.6s (17/30 cached). Earlier full host run passed 4,436 tests and
  shipped pack 855 plus two existing skips; final affected host subset passed 1,691, integration
  642, actual Electron app 176.9s, smoke 5.6s, packaged authoring 63.3s and packaged app 8.7s.
  Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T08-53-28Z-96971`,
  `/private/tmp/apack-m4-description-strict-integrations-fixed.log`; full host/pack evidence:
  `node_modules/.cache/apack-chain/runs/2026-10-14T08-44-25Z-68976`.
- Strict caught an additional renderer fixture, API origin-helper type and integration fixture
  producers. All were corrected before commit, without widening EARS or bypassing schema checks.
  Facade setup cleanup now avoids masking an initial build failure with an undefined path.
  Reviewed schema/API/source changes and diff checks; committed only the 70 recorded source paths.
  The unrelated issue draft remains untracked and excluded.

M4 remains open for the inspected target parsing/resolution and authoring-tool agreement work,
with the findings in the consolidation plan. Complete it before M5/M6, then finish every remaining
discovery/navigation/boundary requirement and all three Phase 6 workstreams. Final strict `--all`
on committed source and the complete reconciled audit remain mandatory. Nothing is archived.


### Shared module parser and contained file resolution — M4 checkpoint (2026-10-14)

Source `4285d748c` shares parsing for named references and documented default component exports.
Malformed references fail in either mode. One file finder resolves extensionless modules and
directory barrels, checks lexical/physical pack containment, and selects allowed extensions by
purpose. Shape files remain TypeScript-only and never execute. Codegen and validation use it;
doctor shares the step/migration file rules. Feature validation now checks contract, service,
repository and entity-shape files; the latter reuses `_packEntities`, without a reader-specific merge.
Routes, loading and component metadata objects remain intact. SDK build API report is updated.

Evidence: 95 focused parser, diagnostics, file, shape and generation checks passed, including
poisoned modules, missing targets and path/symlink escapes. Removing both containment checks failed
named assertions; exact source restored (`/private/tmp/apack-m4-target-containment-mutation.log`).
SDK/CLI compilation passed. Strict caught four unnecessary quote escapes; removed them before the
source commit. Final strict passed in 637.2s (1/30 cached): host 4,444 tests, pack 855 plus two existing skips,
integration 642, real Electron app 181.3s,
smoke 5.8s, packaged authoring 63.1s and packaged app 8.1s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T09-35-08Z-32154`,
`/private/tmp/apack-m4-target-strict-lint-fixed.log`. Generated EARS and six compiled content files
remain byte-identical to `/private/tmp/apack-m4-description-baseline`; the facade report passes.
Reviewed source/API changes and diff checks; the unrelated draft remains untracked/excluded.

M4 remains required for doctor's complete static-export/incomplete reporting, remaining target
coverage, scaffold/layout agreement and cross-pack default-selection evidence. Then complete M5/M6
and every remaining discovery, navigation, boundary and Phase 6 requirement. Final strict `--all`
on committed source and the full reconciled audit remain mandatory. Nothing is archived.

### Doctor shares static validation — M4 checkpoint (2026-10-14)

Source `d80c0ff1b` makes `pack doctor` use the existing read-only `validatePack` result rather than
a separate collection of checks. It reports missing exports/contracts, source-rule errors and skipped
checks consistently with `pack validate`: exit 0 for complete valid checks, 1 for errors and 2 for
incomplete checking. The absent generated-directory reminder remains. Public and contributor CLI
docs describe these outcomes. No executable pack activation or generated writes are introduced.

Evidence: three real CLI tests passed, covering extensionless targets with a poisoned module, a
missing lifecycle export and unresolved dependencies without cache writes. Forcing the incomplete
exit to success failed the named assertion; exact source restored
(`/private/tmp/apack-m4-doctor-status-mutation.log`). Strict validation passed in 455.7s
(1/30 cached): affected host 3,052 tests, shipped pack 855 plus two existing skips, integration 645;
external-pack contract, real app, smoke and both packaged-authoring halves passed. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T10-04-59Z-66359`,
`/private/tmp/apack-m4-doctor-strict.log`. Generated EARS and six compiled content files remain
byte-identical to `/private/tmp/apack-m4-description-baseline`; the facade check passes unchanged.
Reviewed the four committed paths and diff checks; the unrelated issue draft remains excluded.

M4 remains required for complete declaration-derived target coverage, including independent file
checks when dependencies are unavailable, scaffold/layout agreement and cross-pack default-selection
evidence. Then complete M5/M6 and all remaining discovery/navigation/boundary/Phase 6 requirements.
Final strict `--all` on committed source and the complete reconciled audit remain mandatory.
Nothing is archived and the goal remains active.

### Declaration-derived source inventory — M4 checkpoint (2026-10-14)

Source `cd48b636e` adds one derived module-target list shared by source validation and codegen's
TypeScript program. It includes feature declarations, normalized entity shapes, pack services, step
facets, blocks/artifacts, DSL modules, frontend extensions, lifecycle hooks, both migration lines and
content writers/compilers/appliers. Types, scripts and components retain distinct file-resolution
purposes. No contribution inventory is authored twice and no pack modules execute for file checks.
The SDK checker is now `validatePackSources`; every owned caller/test/export/report is migrated
outright, including the `declared-sources` skipped-check name. No compatibility alias remains.

Evidence: 170 focused SDK source/generation checks and 14 focused CLI checks passed. A regression
removes all declared files and requires diagnostics for each of 20 non-feature targets. Removing
both migration lines from the inventory failed that named assertion; exact source restored
(`/private/tmp/apack-m4-inventory-coverage-mutation.log`). Real CLI doctor and validate both report
missing step/migration files as errors despite unresolved dependencies, without cache/generated writes.
Reviewed the SDK API report: only the intentional checker rename/signature changes.

Strict initially caught one unmigrated skipped-check expectation; updated its name without changing
the assertion's required list. Focused validation tests passed (5). Reviewed strict passed in 396.0s
(16/30 cached): host 4,445 tests, pack 855 plus two existing skips, integration 647, external-pack
contract/app, smoke and both packaged-authoring halves. Real app 155.8s, smoke 5.2s, authoring 53.5s,
packaged app 7.6s. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T10-23-08Z-7446`,
`/private/tmp/apack-m4-inventory-strict-reviewed.log`; initial inspection evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T10-19-43Z-99385`. Generated EARS and six content
files remain byte-identical to `/private/tmp/apack-m4-description-baseline`; facade check passes.
Reviewed explicit committed paths and diff checks; unrelated issue draft remains untracked/excluded.

M4 remains open for scaffold/layout agreement, whole-module versus named-binding grammar and
expected-export checks across actual readers, and cross-pack default-selection evidence. Complete
these before M5/M6, then every remaining discovery/navigation/boundary and Phase 6 requirement.
Final strict `--all` on committed source and the full reconciled audit remain mandatory. Nothing is
archived; the full goal remains active.

### Purpose-specific module grammar — M4 checkpoint (2026-10-14)

Source `9b674ece3` distinguishes whole-module paths from named-export references and permitted
default-export bindings. A shared module-path grammar serves schemas and source/type resolution;
module/export syntax remains shared for TypeScript type references and executable bindings, with
purpose-specific checks. The derived target inventory carries the reference mode instead of an
ambiguous boolean. Codegen normalizes it once before emission, including packs with no named
exports to inspect. Systems/forms/views/DSL/frontend/content whole modules reject export selectors;
system/surface contracts require their named TypeScript exports. Surface/reference binding syntax and
loading/route metadata remain intact. Generated schema assistance and public manifest docs agree.

Evidence: focused SDK checks passed (217), including schema purpose cases, actual existing-file
validation and codegen without export inspection; real CLI doctor/validate checks passed (7).
Disabling the module-path guard failed both named parser and codegen assertions; exact source
restored (`/private/tmp/apack-m4-grammar-purpose-mutation.log`). A service diagnostic now arises
earlier with feature/field ownership; migrated its exact expected text, retaining missing-file/export
and non-service-object assertions. Strict passed in 515.8s (all 30 steps fresh): host 4,449 tests,
pack 855 plus two existing skips, integration 649, external contract/app, smoke and both packaged
authoring halves. Actual app 156.6s, smoke 4.9s, authoring 53.8s, packaged app 7.6s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T10-37-32Z-38363`,
`/private/tmp/apack-m4-grammar-strict.log`. EARS and six compiled content files remain byte-identical
to `/private/tmp/apack-m4-description-baseline`; facade/API checks pass unchanged. Reviewed source,
schema and explicit committed paths; unrelated issue draft remains untracked/excluded.

M4 still requires conventional expected-export checks, scaffold/layout agreement and cross-pack
default-selection evidence. Then complete M5/M6 and all remaining discovery/navigation/boundary and
Phase 6 workstreams. Final strict `--all` on committed source and the full reconciled audit remain
mandatory. Nothing is archived; the entire goal remains active.

### Conventional runtime exports — M4 checkpoint (2026-10-14)

Source `fb9d212fc` records whole-module readers' conventional export names in the shared target
metadata and checks their runtime-value exports without activation. Systems, non-Vue forms/views
and compilers require `default`; appliers require `apply`; tiptap modules require `textEditor`.
Removed the duplicate tiptap guard. Type-only barrels retain their own purpose and Vue component
exports remain checked by the SFC frontend build. Export inspection explicitly includes JavaScript;
CommonJS default imports inspect the module value rather than demanding an ESM default declaration.
Schemas/API signatures do not change; public manifest documentation explains the boundary.

Evidence: 158 focused generation tests and nine real CLI cases passed. Four cases cover missing
modules, absent/type-only conventional exports and valid poisoned module exports for systems, forms,
compilers and appliers. Three format cases prove `.js`/`.mjs` ESM and `.cjs` CommonJS inspection without
execution; named ESM exports do not imply a default. Disabling the value-export guard failed four
named cases; omitting JavaScript from inspection failed three. Both mutations were exactly restored
(`/private/tmp/apack-m4-conventional-{export,javascript}-mutation.log`). Three older applier/compiler
fixtures now write the modules they declare. Strict also identified an unrelated placeholder system
in the build-race fixture; that content-only fixture explicitly declares no features. All eight
build-race/publication checks passed with their original input-change/retention/cleanup assertions.

Reviewed strict passed in 396.3s (16/30 cached): host 4,456 tests, pack 855 plus two existing skips,
integration 651, external contract/app, smoke and both packaged authoring halves. Actual app 155.8s,
smoke 4.8s, authoring 53.3s and packaged app 7.6s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T11-07-37Z-81123`,
`/private/tmp/apack-m4-conventional-strict-reviewed.log`; initial fixture finding:
`node_modules/.cache/apack-chain/runs/2026-10-14T11-02-40Z-73198`. Generated EARS and six content files
remain byte-identical to `/private/tmp/apack-m4-description-baseline`; facade/API/schema checks pass.
Reviewed all seven committed paths and diff checks; unrelated issue draft remains untracked/excluded.

M4 remains open for scaffold/layout agreement and cross-pack default-selection evidence. Then
complete M5/M6 and every remaining discovery/navigation/boundary/Phase 6 requirement. Final strict
`--all` on committed source and the full reconciled audit remain mandatory. Nothing is archived;
the full goal remains active.

### Scaffold and default-selection acceptance — M4 complete (2026-10-14)

Source `11bdc7faa` shares one feature-layout object between module writing and authored references,
so their paths cannot drift independently. The real external scaffold now uses a role different
from its feature ID and passes both CLI validate and doctor before build/typecheck/archive. Public
layout docs include the frontend contract; corrected the feature table's stale settings/role wording
and broken table structure. Runtime declarations and generated output retain their existing paths.

Audit found default-claim uniqueness missing from native admission and direct frontend registration.
Authored/native schemas now share the existing one-default rule; frontend capture refuses duplicate
defaults and claims without a surface before publication. Tests preserve first-registered cross-pack
selection, replacement priority, promotion after winner removal and re-registration order. Invalid
replacement retains the incumbent's surfaces/default. The actual native catalog refuses malformed
duplicate claims atomically; role collision/nonmatching-ID behavior remains covered.

Evidence: 83 focused schema/native/frontend checks and 11 real external scaffold cases passed.
Removing native validation failed two named assertions, removing frontend uniqueness failed one;
all source restored exactly (`/private/tmp/apack-m4-layout-{native,frontend}-mutation.log`). Strict
initially required a regenerated API report. Reviewed all hunks: only surface/settings ordering in
inferred schema types changed (16 identical added/removed lines), no fields/types/signatures changed.
Report preparation first refused after CLI whitespace cleanup; refreshed that package before
regeneration, then reviewed/normalized the report. Final strict passed in 514.2s (all 30 steps fresh):
host 4,460 tests, pack 855 plus two existing skips, integration 651, external contract/app, smoke
and both packaged authoring halves. Actual app 155.4s, smoke 5.0s, authoring 53.5s, packaged app 7.5s.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T11-28-05Z-13985`,
`/private/tmp/apack-m4-layout-strict-reviewed.log`; initial report refusal:
`node_modules/.cache/apack-chain/runs/2026-10-14T11-24-07Z-12592`. EARS and six compiled content files
remain byte-identical to `/private/tmp/apack-m4-description-baseline`; facade/schema checks pass.
Reviewed all ten source paths and diff checks; unrelated issue draft remains untracked/excluded.

M4 is complete across its description/type/parser/inventory/grammar/export/layout/default checkpoints.
Proceed to M5 checks/format cleanup, then M6 canonical writing and full schema/docs coverage. Every
remaining discovery/navigation/boundary/Phase 6 requirement remains active. Final strict `--all` on
committed source and the complete reconciled audit remain mandatory. Nothing is archived.

### Inline check allowances — M5 checkpoint (2026-10-14)

Source `24bd9f116` moves source-check allowances to `apack.json` `checks.allow`. One SDK build
policy lists the five allowable conventions; manifest schema completion, CLI switchability and
enforcement derive from it. Rule implementations/precedence remain in the CLI. Deleted the sidecar
reader outright; no aliases, dual reads, filename-specific refusal or conversion. Updated guidance,
public docs, root CLAUDE and schema/API files; no live source/script/public-doc references remain.
Standalone source auditing still works without a manifest, with all checks enabled. Owned packs
validate the current checks object with the same schema; null/malformed/unknown/non-switchable
values are errors. Rule tooling reads only that manifest field and imports no desktop-launch helpers.

Evidence: 101 schema/rule tests and 11 actual CLI doctor/validate cases passed, covering supported
completion values, malformed policy, mandatory/unknown-rule refusal, allowed convention execution
policy and no source activation/generated writes. Pasting printed advice into a real manifest
silences the intended rule. Ignoring allowances failed two named assertions; exact source restored
(`/private/tmp/apack-m5-checks-enforcement-mutation.log`). Focused review caught a missing diagnostic
return during editing; restored it before validation. The initial metadata-only source tests exposed
the need to preserve unowned source-directory auditing; schema validation is scoped to checks there.

Strict identified both halves of the snapshot-field audit needing the additive key and an unwanted
desktop utility import in repository tooling. Recorded checks in the complete field audit without
changing stamps, and kept tooling dependencies scoped. The targeted contract audit passed. Reviewed
API report changes: new policy/schema and optional checks field; unrelated format/path property
ordering is inert. Final strict passed in 400.6s (15/30 cached): host 4,462 tests, pack 855 plus two
existing skips, integration 653, external contract/app, smoke and both packaged authoring halves.
Actual app 159.4s, smoke 4.9s, authoring 53.4s, packaged app 7.5s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T12-02-43Z-58912`,
`/private/tmp/apack-m5-checks-strict-final.log`. Earlier type/audit findings:
`2026-10-14T11-54-40Z-48764`, `2026-10-14T11-57-21Z-51021`,
`2026-10-14T11-59-08Z-51726` under the same evidence directory. EARS and six compiled content files
remain byte-identical to `/private/tmp/apack-m4-description-baseline`; facade checks pass unchanged.
Reviewed thirteen committed paths and diff checks; unrelated issue draft remains untracked/excluded.

M5 remains required for deleting `$manifestVersion` and exact layout-format validation, preserving
format stamps/release metadata and facade-capability semantics. M6 and all discovery/navigation/
boundary/Phase 6 requirements remain active. Final strict `--all` on committed source and the full
reconciled audit remain mandatory. Nothing is archived.

### Format cleanup — M5 complete (2026-10-14)

Source `9374189e5` deletes `$manifestVersion` from authored schemas, API reports, the current field
audit and public docs. No in-tree manifests/templates declared it; no reader alias/conversion or
key-specific historical refusal is added. Normal current-schema validation remains strict. Layout
verification and revisioned asset delivery now require exact `PACK_LAYOUT_VERSION`, rather than
accepting fractional values through `Math.floor`. Snapshot/layout constants remain 1/2 and release
metadata is untouched. Facade acceptance stays based on the required capabilities.

Evidence: 168 focused schema/generation/layout tests passed; six cases reject fractional, negative,
unsupported, string and null stamps. Asset tests recompute the malformed receipt's revision, proving
that exact format is checked independently. Restoring each rounding guard separately failed its
named 2.25 assertion; exact source restored
(`/private/tmp/apack-m5-format-{layout,assets}-mutation.log`). Twenty installed-dependency checks
passed, retaining absent/different-format acceptance when facades suffice. Reviewed generated schema
and API diff: only the intended authored-key deletion. No live source/script/test/public-doc key or
rounding-format references remain.

Strict passed in 523.6s (all 30 steps fresh): host 4,468 tests, pack 855 plus two existing skips,
integration 653, external contract/app, smoke and both packaged-authoring halves. Actual app 156.7s,
smoke 4.8s, authoring 53.1s and packaged app 7.6s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T12-17-01Z-89946`,
`/private/tmp/apack-m5-format-strict.log`. EARS and six compiled content files remain byte-identical
to `/private/tmp/apack-m4-description-baseline`; facade checks pass unchanged. Reviewed the eight
committed paths and diff checks; unrelated issue draft remains untracked/excluded.

M5 is complete together with inline checks `24bd9f116`. Proceed to M6 canonical writing and complete
schema/docs coverage, then every remaining discovery/navigation/boundary/Phase 6 workstream. Final
strict `--all` on committed source and the complete reconciled audit remain mandatory. Nothing is
archived; the entire goal remains active.

### Shared manifest writer — M6 checkpoint (2026-10-14)

Source `4bd88f6c9` centralizes manifest serialization/writing in the CLI's `manifest-writer.ts`.
Root, feature-definition and extension-kind field order comes directly from the current schemas,
without a second authored field inventory or an obsolete root-key count/order. Feature IDs, named
contribution/dependency/entity maps, arrays and custom settings/schema properties retain authored
order. Serialization does not mutate input and is idempotent. Init/add and the release version
editor use the same writer; release scripts/workflows are not changed or executed, and no current
release/version metadata is edited. Public/contributor docs state the ordering boundary.

Evidence: the serializer regression verifies exact structural order, retained data/order, unchanged
input and idempotence. Removing root ordering failed its named assertion; exact source restored
(`/private/tmp/apack-m6-writer-order-mutation.log`). CLI compilation passed. Real authoring and
isolated release-editor tests passed (38). The first scaffold run refused stale testing/tooling
packages; refreshed them before the passing run. The unit's first expected root order placed
dependencies differently from the schema; corrected that expectation to the chosen schema order,
retaining all preservation assertions. Audited all authoring writes; no direct manifest stringify
remains in those paths outside the shared serializer.

Strict passed in 442.1s (1/30 cached): affected host 3,063 tests, pack 855 plus two existing skips,
integration 653, external contract/app, smoke and both packaged-authoring halves. Actual app 155.4s,
smoke 4.8s, authoring 53.8s and packaged app 7.9s. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T12-38-22Z-29382`,
`/private/tmp/apack-m6-writer-strict.log`. EARS and six compiled content files remain byte-identical
to `/private/tmp/apack-m4-description-baseline`; schema/API/facade checks pass unchanged. Reviewed
thirteen committed paths and diff checks; unrelated issue draft remains untracked/excluded.

M6 remains required for complete meaningful schema descriptions, editor completion/diagnostics,
version/range validation and final public/native/installed/shipped build documentation. Then
finish all remaining discovery/navigation/boundary/Phase 6 requirements. Final strict `--all` on
committed source and the full reconciled audit remain mandatory. Nothing is archived; the full
goal remains active.


### Manifest versions and dependency source grammar — M6 checkpoint (2026-10-14)

Source checkpoint `6c1666d56` replaces prefix-only version acceptance with complete SemVer 2.0
validation, validates nonempty npm host/dependency ranges, and checks dependency pack IDs. Authored
`file:<path>` and `github:<owner>/<repo> [range]` values use one SDK build parser shared with CLI
resolution; native declarations admit ranges, since they do not resolve authored source locators.
Parsing does not execute modules or resolve filesystem/network sources. No obsolete-format handling,
aliases or release metadata changes were added. SDK runtime/type dependencies are explicit.

Focused checks passed 76 SDK tests, five dependency resolver tests, and 14 actual CLI cases, including
invalid metadata failure exits and JSON diagnostics at `version`, `hostVersion` and the dependency
field. Removing range validation failed seven named assertions; exact source was restored before
validation. Generated schema and SDK build API report were regenerated and reviewed (report normalized
to LF). All 30 strict steps passed in 532.9s, including external-pack contract/app, smoke, real scaffold
authoring, packaged authoring (54.0s) and packaged app (7.4s). Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T13-08-23Z-63777`;
`/private/tmp/apack-m6-semver-strict.log`. Generated EARS and all six compiled content files remain
byte-identical to the preservation baseline. Unrelated issue draft remains untouched.

M6 remains open: the current generated-schema audit found 45 fields without descriptions, concentrated
in surface presentation, references, settings titles/descriptions and help paths. Complete meaningful
field assistance and nonvacuous editor completion/diagnostics coverage, plus native/installed/shipped
build documentation, before certifying M6. JSON Schema does not encode the semantic npm range
refinements; authoring tools still perform the shared semantic validation. The full discovery,
navigation, boundaries and all three Phase 6 workstreams remain required. Final committed-source
strict `--all` and the complete reconciled requirement audit remain due; nothing is archived.


### Manifest field help and actual editor assistance — M6 checkpoint (2026-10-14)

Source `9e9a9ac0e` describes every generated-schema property, including union component forms,
loading modes, routed canvases, surface actions/fallback panels, references, settings labels and help
paths. Descriptions were checked against actual consumers. Help guidance now states the compiled
snapshot contract. Feature entity completion retains shape/null grammar as well as ownership; the
first real completion check exposed that its field override had hidden the shared grammar. Public
manifest documentation distinguishes structural editor checks from complete CLI semantic validation.

The SDK owns stable `vscode-json-languageservice` as a test-only dependency. Ten real language-service
checks exercise property and enum completion, documentation, hover, typed/untyped entities and
malformed-value ranges. Schema references use a local draft-07 metaschema; unexpected remote schema
requests fail rather than access the network. The recursive field-help audit includes nested maps,
arrays/tuples and union branches. Removing loading descriptions failed the field audit and actual hover
assertions; exact generated bytes were restored before verification. Focused editor/schema checks
passed 53 tests. SDK typecheck passed, and regenerated API reports were unchanged.

All 30 strict steps passed in 512.3s, including actual external pack/app, smoke, packaged authoring
and packaged app. Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T13-24-39Z-98018`;
`/private/tmp/apack-m6-editor-strict.log`. Generated schema comparison with descriptions removed proves
accepted value grammar is unchanged. Generated EARS and all six compiled content files are byte-identical
to the preservation baseline. Unrelated issue draft remains untouched.

M6 still needs native/source/installed/shipped build documentation and a complete reconciled
acceptance audit. The current public build guides still mention removed settings files and boot hooks;
correct them against current readers/build stages, and document receipts, snapshots, declaration versus
build/runtime identities and native differences without claiming unfinished discovery kinds complete.
Then resume full discovery and every remaining phase, including all three Phase 6 workstreams. Final
strict `--all` on committed source and complete requirement audit remain due; nothing is archived.


### Public pack builds and consolidation acceptance checkpoint (2026-10-14)

Source `0994ae787` adds the public pack build contract: source/build/archive/installed/shipped/native
differences, snapshot versus integrity, declaration/build/runtime identities, shape/null semantics,
source-free declaration reading and build-only editor definitions. CLI/getting-started guidance now
describes staged publication rather than destroying the prior build, inline settings rather than removed
settings files, and current lifecycle names. Architecture guidance preserves explicit app/user update
ownership and producer hashes through staging. The real external scaffold/archive test checks documented
core build paths against actual files. Replacing the documented snapshot path failed that named
assertion; exact documentation was restored.

Focused checks: six doc link/command checks, 11 real external scaffold/build/typecheck/archive cases,
and 171 current-tree consolidation tests in nine files. Strict checkpoint passed in 107.0s (22/30 cached):
1,693 affected host tests and 618 integrations ran; unchanged app, shipped-pack and packaged checks
were reused by their declared input identities. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T13-41-14Z-31339`;
`/private/tmp/apack-m6-artifact-strict.log`; `/private/tmp/apack-m1-m6-acceptance.log`.
Generated EARS and all six compiled content files remain byte-identical. Unrelated issue draft preserved.

M6 is complete across writer, metadata validation, editor assistance and public build checkpoints.
The consolidation plan records a current decision-by-decision acceptance audit for all 17 original
decisions and both naming questions. It explicitly retains unfinished full contribution discovery,
direct editor/app declarations under `extensions`, facade naming/capabilities, static content dependency graph and useful CLI
inventories. Resume Phase 3 on those contracts, then entity navigation, frontend boundaries and all
three Phase 6 workstreams. No plan is archived; no full-goal completion or final `--all` is claimed.


### Facade vocabulary and data refusal — discovery checkpoint (2026-10-14)

Source `c1d8497b4` uses `PackSnapshot.facades`, `PACK_TYPES_FACADE` and dependency-cache `facades/`
through producer, schema, codegen, resolver, fixtures, API report and public docs. Physical
`pack-types.d.ts` and DSL `defs/monaco` paths/behavior remain unchanged; no old-key reader, alias or
conversion is added. Codegen refuses missing/empty required facade content before producing files,
naming the dependency and rebuild remedy instead of emitting `undefined`. Current snapshot validation
rejects unsafe facade names before cache writes. A read-only probe had demonstrated that `../outside`
was accepted and would escape the facade directory; the shared schema and actual dependency reader
now refuse those names.

Focused validation passed 90 SDK tests, 116 resolver/build/version checks, ten real facade typing
and completion cases, three dependent flow-helper typing/runtime cases, 15 generation cases, and
the final 62 SDK guard plus six actual dependency-reader checks. Removing missing-content validation
failed three named assertions; removing cache-name validation failed eight. Exact source was restored.
Two fixtures that previously supplied empty facade maps now bundle their actual generated facade;
no production shape was added or widened. Strict caught a new test inference error and an accidentally
renamed DSL log expectation; both were corrected without weakening assertions. API report was
regenerated, normalized and reviewed.

Reviewed strict passed in 504.7s (1/30 cached), including external pack/app, smoke, packaged authoring
and packaged app. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T14-09-04Z-65038`;
`/private/tmp/apack-discovery-facades-strict-reviewed.log`. Earlier failures:
`/private/tmp/apack-discovery-facades-strict.log` and
`/private/tmp/apack-discovery-facades-strict-final.log`. Generated EARS and all six compiled content
files remain byte-identical. Format constants and release/version metadata are unchanged; unrelated
issue draft preserved.

Current inspection corrects the earlier M5/roadmap evidence: the installed-dependency suite proves
exact-format refusal, not capability-based type admission. Claims that capability acceptance was
already implemented or tested are superseded by this audit. The required next checkpoint validates
exported facade capabilities and accepts usable current-data dependency typing with absent/different
stamps as diagnostic context, separately from exact runtime/install admission. Preserve honest optional
stamp types and current-key/schema validation; no synthetic stamp, fake export, old-format adapter or
dual read. All remaining full discovery, frontend naming, static content/CLI inventory, navigation,
boundaries and three Phase 6 workstreams remain active. No final `--all` or completion is claimed.


### Consumed facade type capabilities — discovery checkpoint (2026-10-14)

Source `b1eeebd19` checks every type actually imported by dependency codegen through the existing
TypeScript export reader. Requirements come from real import generation, not a second capability
inventory. Surface state is required when the consumer emits frontend state access, rather than merely
because a dependency has surfaces. Missing, value-only, unresolved and syntactically malformed
declarations fail with the dependency name, required type/context and rebuild remedy. Type aliases
resolve normally; no fake export, widened EARS shape or fallback typing is emitted.

The shared reader admits virtual bundled declaration text, including relative re-exports before
generated directories exist. It uses canonical paths and one program for source modules and dependency
facades. Virtual snapshot text overrides stale generated files, without writing files or loading pack
modules. A read-only probe demonstrated that TypeScript parser recovery could expose an export from
malformed text; syntax diagnostics now prevent that false capability. Generic unresolved-type advice
no longer incorrectly assumes every caller is reading events. SDK API reports remain unchanged.

Focused checks passed 63 SDK export/shape cases, 113 affected fixture/generation cases, and 23 actual
source/published facade typing, completion and dependent flow-helper cases. Removing export validation
failed all eight missing-type assertions; removing syntax validation failed the malformed-facade
assertion, with exact restoration before validation. The first strict run exposed unit fixtures that
declared surfaces but omitted their state export. Fixtures now model the generator's actual never state
for surfaces without a state contract. The version-warning fixture bundles a real producer facade
instead of maintaining an outdated export list. Production typing and original assertions are retained.

Final strict passed all 30 steps in 509.1s (1 cached), including real external app, smoke, packaged
authoring and packaged app. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T15-00-05Z-38446`;
`/private/tmp/apack-facade-capabilities-strict-final.log`. Initial fixture failures:
`/private/tmp/apack-facade-capabilities-strict.log`; interim accepted source before the syntax fix:
`/private/tmp/apack-facade-capabilities-strict-reviewed.log`. Generated EARS and all six compiled
content files remain byte-identical. Format/release metadata and unrelated issue draft are preserved.

The capability checkpoint is not yet complete: resolver/parser types still require the exact snapshot
stamp. Next implement honest optional dependency stamp types and shared current-data validation,
accepting usable current-data typing with absent/different stamps as diagnostic context. Audit every
build/test runtime loader before allowing that data through resolution: successful type inspection must
not authorize incompatible runtime execution. Also cover deliberate skip-generation paths in the
remaining dependency/tool freshness work. All full discovery kinds, frontend naming, content/CLI
inventory, navigation, boundaries and three Phase 6 workstreams remain active. Final committed-source
strict `--all` and whole-goal completion audit remain due.


### Dependency type-data admission — discovery checkpoint (2026-10-14)

Source `0159acd11` completes the dependency current-data reader from the preceding checkpoint.
`PackDependencySnapshot` retains an optional recorded stamp; `parseDependencySnapshot` validates the
same current fields/revision/help/name safety as executable snapshot validation. Differing or absent
stamps are diagnostic context, with no conversion, synthesized stamp, aliases or obsolete-key reader.
CLI resolution retains the selected source rather than substituting a release solely for its stamp.
Only matching stamps expose dependency build/runtime/content files. Type-only builds can proceed;
content compilation and the harness refuse incompatible execution before importing dependency code.
The execution gate is build-format validation, not special handling of historical manifest keys.

Focused checks passed 37 SDK snapshot cases, 27 resolver/reader cases, 22 real producer/consumer build,
typing/completion and content refusal cases, five actual harness runtime cases, 13 CLI authoring
validation cases and 17 repository placement cases. The real type-data suites poison dependency build
and runtime modules; admission does not execute them. Removing executable-file gating caused four
resolver failures; routing type inspection through exact executable parsing caused three admission
failures. Both mutations were restored before validation. Reviewed the new SDK API report and public
build documentation. Initial strict failures exposed an unused test binding, a missing placement
rationale for the shared facade fixture, and a stale validation test expecting the removed resolver
format refusal. All are corrected without relaxing production validation or restoring legacy handling.

Strict passed in 366.0s (17 of 30 cached), including 1,695 affected host tests, all 680 integration
cases, actual external app, smoke, packaged authoring and packaged app checks. The preceding run also
passed the complete 4,546-case host pool. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T15-51-18Z-9762`;
`/private/tmp/apack-dependency-data-strict-accepted.log`.
Mutation evidence: `/private/tmp/apack-dependency-data-execution-mutation.log` and
`/private/tmp/apack-dependency-data-admission-mutation.log`.
Generated EARS and all six compiled content files are byte-identical to the preserved baseline.
Release metadata, format constants and the unrelated issue draft are preserved.

Dependency/tool freshness remains required next. Current `build --skip-generate` bypasses generation
checks; the later version warning cannot detect same-version changes, missing or edited generated
files, or changed facade capabilities. Audit and enforce those inputs before expanding discovery kinds.
Native/all-kind discovery, frontend naming, content edges/inventory, entity navigation, frontend
boundaries and all three Phase 6 workstreams remain required. Final committed-source strict `--all`
and the whole-goal completion audit remain due.


### Generation freshness and skip paths — discovery checkpoint (2026-10-14)

Source `82d9d7a9c` makes normal generation, `build --skip-generate` and
`facade-report --skip-generate` share one input/output freshness check. The generation stamp records
output SHA-256 hashes, not existence alone. Missing/edited output and same-version source or dependency
facade changes require regeneration. The input identity includes the CLI generation implementation;
SDK code and resolved dependency snapshots remain included. Current stamp validation has no old-shape
reader or converter. Builds resolve dependency files once for generation and compilation, preserving
aggregate unresolved-dependency guidance, and recheck generation freshness before sealing publication.

Focused checks passed 17 generation cases, ten real build/publication cases, two registry cases and
ten real facade-report cases. The registry fixture now declares authored step modules, runs normal
generation and completes a real build; it no longer plants generated output or swallows all errors.
Its negative case explicitly refuses an undeclared step. Bundler failure fixtures likewise use authored
modules rather than bypassing generation. Removing the early skip guard caused both compiler-execution
markers to appear despite stale outputs; removing output hashing failed the edited-output refusal case.
Sources were restored exactly before strict validation. Initial strict failures exposed a duplicated
test field and lost aggregate dependency guidance; both were corrected while preserving assertions.

Strict passed in 475.6s (1 of 30 cached), including 3,069 affected host tests, 855 pack cases with two
existing skips, all 681 integration cases, external app, smoke, packaged authoring and packaged app.
Evidence: `node_modules/.cache/apack-chain/runs/2026-10-14T16-12-39Z-66248`;
`/private/tmp/apack-generation-freshness-strict-accepted.log`.
Mutation evidence: `/private/tmp/apack-generation-freshness-early-mutation.log` and
`/private/tmp/apack-generation-freshness-output-mutation.log`.
Generated EARS and six compiled content files remain byte-identical. Public CLI documentation
matches the skip contract. No SDK public signature, release metadata or format constant changes;
the unrelated issue draft remains uncommitted.

This closes the inspected skip-generation gaps, not all source/build freshness. Next address the
runtime watcher: `build/watch.ts` currently writes `dist/runtime/index.cjs` directly under a lock
without regenerating declarations, updating the snapshot/facades, or resealing the build receipt.
Source edits can therefore disagree with discovery metadata and receipt identity. Make watched
publication follow a coherent accepted build contract, and prove source contract changes, invalid
edits, concurrent requests and host reload against verified current receipts. Audit dependency build-code
identity and remaining cache/tool inputs alongside that work. All contribution/native discovery,
frontend naming, static edges/inventory, navigation, boundaries and all three Phase 6 streams remain
required; final committed-source strict `--all` and whole-goal audit are still due.


### Verified watched publication — discovery checkpoint (2026-10-14)

Source `1fa16bd7b` replaces runtime-only writes and the two duplicate external-dev watchers with one
watcher publishing through the complete staged build. Authored paths inside the pack tree use the same
exclusions as build inputs, including manifests, JSON/assets/help and modules outside src/. Mid-build
edits coalesce into another run. Successful external-dev publications install before reload; invalid
edits retain the verified build and running incumbent. Startup no longer requires a pre-existing
src/ folder or chooses a frontend entry before generation. Watch mode refuses other build flags rather
than silently ignoring them. Session cleanup closes future requests immediately, awaits an in-flight
watcher operation, and only then removes its temporary profile.

Sixteen focused scheduler/input/lifetime cases pass. A real filesystem integration builds and stages
an external pack, inspects its catalog before lifecycle-module activation, and drives the actual host
reload over a local tokened HTTP fixture. Manifest purpose and outside-src module changes reach the
verified receipt, catalog and runtime together; a malformed edit preserves the incumbent and a repaired
edit reloads successfully. The fixture supplies the host's real scoped settings service binding.
Removing pending scheduling fails three cases. Reinstating runtime-only writes fails the integration
because the installer refuses a manifest that does not match built declarations. The first attempt at
that mutation was stopped by package freshness and is not evidence; the successful probe refreshed
packages under the temporary mutation, then restored source exactly before validation.

Strict passed in 433.8s (13 of 30 cached): 3,072 affected host cases, 855 pack cases with two existing
skips, all 682 integration cases, external app, smoke, packaged authoring and packaged app. Evidence:
`node_modules/.cache/apack-chain/runs/2026-10-14T16-50-42Z-3845`;
`/private/tmp/apack-watch-strict-final.log`.
Mutation logs: `/private/tmp/apack-watch-pending-mutation.log` and
`/private/tmp/apack-watch-publication-mutation-final.log`.
Two complete default-setup builds on unchanged inputs took 7.09s and 7.24s here, reusing eligible phases;
logs `/private/tmp/apack-watch-default-build-1.log` and `-2.log`. These are two observations, not an edit
latency guarantee. The incorrect runtime-only optimization is removed; finer safe phase invalidation
can improve cost without introducing unverified publication. Generated EARS and six compiled content
builds remain byte-identical. No SDK public API, format constant or release metadata changes.
The unrelated issue draft remains untouched.

Full source/dependency/tool freshness remains required. Root filesystem watching does not yet establish
coverage for source symlink targets outside that tree, dependency snapshots/build code, or SDK/tool
changes outside the pack. Audit these explicit external inputs, origin/content cache identity and
linked-development policy next; prove changes cannot silently keep old declarations or build code.
Then continue all remaining native/contribution kinds, frontend naming, static content edges/CLI
inventory, entity navigation, frontend boundaries and all three Phase 6 workstreams. Final strict
`--all` on committed source and the whole-goal completion audit are still due.


### Linked authored input freshness — discovery checkpoint (2026-10-14)

Source `255e80e4d` derives linked-input subscriptions from the existing authored-input traversal and
exclusions. Linked directories are watched recursively; parent subscriptions observe atomic file or
directory replacement. Subscriptions refresh before validation/build, so retargeting to malformed data
still observes its later repair. Failed refresh preserves existing subscriptions; session close disposes
all link watches and waits for active work. Executable module references retain their physical pack-root
confinement. The initial test attempted an external executable module and was correctly refused;
the real integration uses linked declarative manifest data, supported by the existing reader/hash model.

Nine focused input/scheduler cases and the real filesystem/installation/host-reload case pass. The
integration covers linked directories/files, external atomic manifest replacement, invalid retarget
retention, repair and subsequent edits to the new target. Removing link subscriptions fails the catalog
assertion after an external atomic save; tooling was rebuilt under the temporary mutation, then source
was restored exactly. Evidence: `/private/tmp/apack-linked-inputs-unit.log`,
`/private/tmp/apack-linked-inputs-integration-final.log`, `/private/tmp/apack-linked-inputs-mutation.log`.

Strict passed in 272.3s (25 of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-14T17-36-34Z-69540`;
`/private/tmp/apack-linked-inputs-strict-accepted.log`. Its accepted unchanged-source predecessor ran
3,073 host cases, 855 pack cases with two existing skips, and all 682 integration cases in
`2026-10-14T17-26-58Z-42940`. The first run rejected an unnecessary 90s test timeout, now restored to
the repository's 60s budget. An unchanged staged-build case timed out under load and passed in isolation
with its original timeout/assertions before the successful pool rerun. A later external-app run failed
waiting for Monaco, then passed on unchanged-source retry. That does not establish offline readiness.
Generated EARS and six compiled content files remain byte-identical. No public SDK API, format
constant or release metadata changes; the unrelated issue draft is preserved.

The audit confirms remaining required work, not optional follow-ups:
- Dependency cache writes lose source provenance; `resolveFromLocal` reads only snapshot/executable
  files. The comment dismissing provenance does not override Phase 6's requirement.
- Local `findDepFiles` exposes matching-stamp executable pointers based on existence, without receipt
  verification. Audit cache publication and exact source/version/content identity before execution,
  preserving independent current-data type inspection.
- Tool implementation/import graphs and dependency build-code changes need complete freshness evidence;
  a version or single-file hash is not proof of the whole graph.
- Monaco currently uses the loader's jsDelivr default with no renderer override. Provide local editor
  and worker assets and prove real completion/diagnostics with external networking unavailable.

Continue those audits, then every remaining contribution/native kind, frontend naming, static edges
and CLI inventory, navigation, boundaries and all three Phase 6 workstreams. Final committed-source
strict `--all` and requirement-by-requirement whole-goal audit remain due.


### Local Monaco and offline assistance — editor checkpoint (2026-10-14)

Source `07d544606` configures the Vue editor loader with locally bundled Monaco and Vite-built
editor/JSON/CSS/HTML/TypeScript workers before component mount. Existing components share the renderer's
editor instance. The external settings JSON test blocks non-local HTTP, reloads the renderer under that
block, and proves real completion, descriptions, diagnostics and validated saving with no attempted
external request. Removing the bootstrap and rebuilding the app fails that test with Monaco loading
errors under the network block. Renderer source was restored exactly and runtime outputs explicitly
rebuilt before accepted validation. Evidence: `/private/tmp/apack-offline-monaco-loading-mutation.log`,
`/private/tmp/apack-offline-monaco-runtime-restored.log`,
`/private/tmp/apack-offline-monaco-reloaded-app.log`.

Bundling exposed a disposal cancellation previously recognized only by its vendor-path stack. Monaco
now has a dedicated vendor chunk, and the filter inspects its origin frame. Application cancellations
remain fatal even when a later frame dispatches through Monaco. Seven error tests pass; changing the
filter to inspect any frame fails the application-origin assertion. Evidence:
`/private/tmp/apack-offline-monaco-errors-final.log`,
`/private/tmp/apack-offline-monaco-origin-mutation.log`.
The repeated 15s unit timeout in the unchanged five-build staged-DSL case was corrected by moving the
case intact into the CLI integration suite. Its assertions and production behavior are preserved;
the focused integration passed in 15.2s instead of expanding the unit timeout.

Strict passed in 173.7s (28 of 30 cached), evidence
`node_modules/.cache/apack-chain/runs/2026-10-14T18-24-25Z-41347`;
`/private/tmp/apack-offline-monaco-strict-restored.log`.
The accepted predecessor `2026-10-14T18-01-57Z-96454` ran 3,148 host cases, 855 pack cases with two
existing skips, all 683 integration cases, external app, smoke and packaged authoring/app checks in
652.4s. The final external-app run includes startup network blocking; unchanged smoke/packaged evidence
was reused. Generated EARS and six compiled content files remain byte-identical. No public SDK
signature, format constant or release metadata changes. The unrelated issue draft remains untouched.

The negative runtime-build probe also exposed a remaining output-freshness issue: after source was
restored, the chain reused its earlier successful input key while the manually built renderer output
still lacked local Monaco setup. That failed app run is not accepted evidence. Explicit output rebuild
restored the bootstrap, and the final focused/strict checks pass. Include out-of-band builds/output
identity in the required source/tool freshness audit; input identity alone cannot prove current output.
Continue dependency receipts/provenance, complete tool graph identity, all contribution/native kinds,
frontend naming, static edges/inventory, navigation, boundaries and every Phase 6 workstream. Final
committed-source strict `--all` and the whole-goal completion audit remain due.


### Resolved dependency identity — checkpoint (2026-10-14)

Source `439883713` checks every selected machine/file/cache snapshot against the requested pack ID.
Downloaded releases must also match the selected release version in both build and snapshot before
cache publication. These are current identity checks, not historical-format recognition or conversion.

Focused dependency checks pass (31 cases):
`/private/tmp/apack-dependency-identity-focused-final.log`. Removing the snapshot identity check fails
three cases (explicit file, renamed cache and downloaded snapshot); source was restored exactly:
`/private/tmp/apack-dependency-identity-mutation.log`. Strict validation passes in 573.1s (1 of 30 cached),
including external-pack app, smoke and packaged authoring/app checks:
`/private/tmp/apack-dependency-identity-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T18-39-38Z-44407`. Generated EARS and all six baseline
compiled content files are byte-identical. The unrelated issue draft remains untouched.

This checkpoint does not establish cache receipt verification, atomic publication or retained origin/
content identity. Complete that required provenance work next, then continue output/tool freshness and
the remaining discovery/navigation/frontend/API/replacement scope. Final strict `--all` on committed
source and the complete requirement audit remain due.


### Verified dependency builds and build vocabulary — checkpoint (2026-10-14)

Source `ff4358588` replaces the incomplete mutable dependency cache with complete verified builds
under `.apack/deps/<id>/builds/<revision>/` and one atomically published `resolution.json`. The record
retains declared spec, exact version, structured origin and content identity. CLI resolution and the
testing harness share admission; type-only data exposes no executable paths. Explicit linked/file
builds are copied coherently, prior resolved paths survive publication, and a changed GitHub repository
cannot reuse another origin's cache. Explicit fetching refreshes remote data; ordinary builds reuse it.
No former-layout reader, alias, converter or special historical-format refusal is present.

Review caught a source-swap race: the snapshot captured before receipt verification could otherwise
be returned with a newer build identity. A common receipt reader now checks captured snapshot bytes
and manifest/identity agreement. Same-ID/version format replacement tests prove inspection and
publication both refuse while preserving the incumbent. Copying never renews a producer receipt.

The user clarified that “artifact” is reserved for the app's actual artifact contributions. Applied the
correction through shared APIs (`PackBuild`, `readPackBuild`, `packBuildRevision`), installed inventory,
catalog/reference/frontend fields (`buildRevision`, `buildFiles`), `pack://…/builds/…` asset delivery,
fixtures, CLI variables and current public documentation. Actual artifact definitions/viewers retain
their domain names. Regenerated and reviewed the two affected SDK API reports; historical progress
uses predecessor vocabulary as history, not compatibility aliases. No format stamp or release
metadata changes.

Evidence:

- 47 focused cache/resolution cases pass:
  `/private/tmp/apack-cache-captured-source-focused-final.log`. Host typechecking passes:
  `/private/tmp/apack-cache-captured-source-types.log`.
- Removing receipt verification fails five cases; wrong-origin cache reuse fails one; non-atomic
  record replacement fails two; omitting captured snapshot hashes fails both source-swap cases.
  Source was restored exactly before final validation. Logs:
  `/private/tmp/apack-cache-receipt-final-mutation.log`,
  `/private/tmp/apack-cache-origin-final-mutation.log`,
  `/private/tmp/apack-cache-publication-final-mutation.log`,
  `/private/tmp/apack-cache-captured-source-mutation.log`.
- Real producer/consumer typing and dependent harness paths passed 27 focused integration cases
  before final review; the final strict run reruns the complete affected integration population.
- `npm run chain -- --strict --cores 1` passes in 588.5s (1 of 30 cached):
  `/private/tmp/apack-verified-build-cache-reviewed-strict.log`,
  `node_modules/.cache/apack-chain/runs/2026-10-14T19-29-14Z-34373`. It includes 3,454 host cases,
  855 pack cases with two existing skips, 683 integration cases, external-pack contract/app, smoke
  and packaged authoring/app checks. All 24 external-app cases pass.
- Initial URL migration missed one escaped E2E expectation; repaired the assertion while retaining
  stylesheet, relative resource and screenshot coverage. Pre-race-fix strict passed in 334.0s at
  `2026-10-14T19-18-46Z-16954`; the final receipt fix is covered by the accepted run above.
- Generated EARS and all six baseline compiled content files remain byte-identical. The unrelated
  issue draft remains untouched and uncommitted.

Required next work remains: expose retained provenance through inspection/doctor; complete dependency
execution/tool import-graph and output identity, including the observed out-of-band renderer build
freshness gap. Continue all contribution/native discovery kinds, frontend migration, static content
edges/inventory, navigation, failure boundaries and every Phase 6 workstream. This checkpoint does
not complete Phase 6 or the goal. Final committed-source strict `--all` and the complete requirement
audit remain due; lazy activation and stronger security isolation remain deferred.


### Read-only pack inspection and compiled index — checkpoint (2026-10-14)

Source `d6fa2c6dc` adds text/JSON dependency provenance to pack info, doctor and validation. A single
read-only resolution frame supplies both codegen validation and diagnostic metadata: declared spec,
exact version, structured origin, delivery directory, content revision and executable availability.
Missing/invalid data remains explicit. Info verifies complete build output and reads content through
the accepted receipt; source-file counts and directory-presence success claims are removed. Build
status distinguishes unbuilt, verified, invalid and stale declarations without claiming complete source
freshness. JSON reports contain metadata rather than entire generated facade bodies.

One current `parseContentIndex` validator now serves compilation, preview, import, harness and inspection.
It checks owner/format, entry counts/identities and duplicate keys without activation. Producer validation
precedes writing while preserving existing serialized bytes. Preview/import retain their provider
requirements; discovery reads data independently. Removed the redundant historical pack-ID reader and
migrated incomplete indexes in fixtures outright. A stale fixture `content.artifacts` key becomes the
current `content.datasets` declaration; actual artifact contributions are unchanged.

Evidence:

- Expanded focused writer/reader/inspection/import checks pass 196 cases:
  `/private/tmp/apack-inspection-fixture-audit.log`. Core inspection cases also pass 78 cases in
  `/private/tmp/apack-pack-inspection-focused-final.log`; SDK/CLI/testing typechecks pass.
- Actual producer/consumer builds and doctor checks pass 15 integration cases:
  `/private/tmp/apack-inspection-external.log`. The new external fixture deletes producer source, then
  the producer directory, and proves compiled IDs/counts, cached origin and static dependent validation
  without executing its poisoned lifecycle module or rewriting the cache record.
- Removing index validation fails five cases; disabling read-only resolution fails the linked-build
  case; omitting full inventory checks fails two cases; ignoring missing dependencies fails three.
  Source was restored exactly. Logs: `/private/tmp/apack-inspection-index-mutation.log`,
  `/private/tmp/apack-inspection-readonly-mutation.log`,
  `/private/tmp/apack-inspection-inventory-mutation.log`,
  `/private/tmp/apack-inspection-incomplete-mutation.log`.
- Regenerated SDK build API report adds only `parseContentIndex`; unchanged feature/manifest type
  members reorder because type traversal changes. AST normalization of type-literal member order
  proves old/new reports identical after excluding the new parser declaration. No EARS widening.
- Strict `npm run chain -- --strict --cores 1` passes in 474.4s (15 of 30 cached):
  `/private/tmp/apack-pack-inspection-strict-reviewed.log`,
  `node_modules/.cache/apack-chain/runs/2026-10-14T20-23-33Z-80067`. It includes 4,588 host cases,
  855 pack cases with two existing skips, 684 integration cases and real external/smoke/packaged app
  checks. Initial strict failure exposed two retired-message assertions; migrated them to current
  schema errors while preserving failure-recording/import assertions. Focused reload passes 18 cases.
- Generated EARS and all six baseline compiled content files, including the index, remain byte-identical.
  Current format constants and release metadata are unchanged; the unrelated issue draft is untouched.

Provenance storage/admission and its inspection presentation are implemented. Required dependency/tool
implementation/import graph and output freshness remain, including the observed manually rebuilt
renderer output surviving source restoration behind an unchanged input key. Full contribution/native
discovery, static flow/action edges, frontend migration, navigation, boundaries and all Phase 6
workstreams retain their scope. Final committed-source strict `--all` and full audit remain due.


### Successful output evidence — freshness checkpoint (2026-10-14)

Source `a667b161a` records complete produced file membership and byte digests after successful work,
separately from input fingerprints captured before it. Freshness now requires both. Input/output walks
are named distinctly; output evidence includes hidden files, shipped prose and nested modules instead
of source exclusions. The shared sweep forgets both walks after declared writes. Atomic publication
may retain a prior record, but changed/partial output cannot reuse it; failed output capture or stamp
publication drops success records. Missing/malformed current records are cold, with no format-version
adapter or special legacy reader.

Focused checks pass 221 cases (`/private/tmp/apack-output-evidence-focused.log`), including changed/
missing/extra output, source restoration after a different manual build, partial multi-output replacement,
complete output scope, sweep forgetting and post-run capture failure. Removing output comparison fails
seven of eight targeted cases; source restored exactly (`/private/tmp/apack-output-evidence-mutation.log`).
Existing tests that asserted input-only reuse were replaced with the required current behavior.

Strict passes in 599.2s with all 30 steps running:
`/private/tmp/apack-output-evidence-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T20-50-13Z-11905`. It includes 4,719 host cases,
855 pack cases with two existing skips, 684 integration cases and external/smoke/packaged app checks.
The actual `build:runtime` graph/stamp rejects a deliberate compiled renderer byte change with unchanged
source and becomes fresh after exact byte restoration:
`/private/tmp/apack-output-evidence-runtime-probe.log`. No app executes the mutated output.
After restoration, unchanged strict validation passes in 1.0s (29 of 30 cached):
`/private/tmp/apack-output-evidence-warm-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T21-00-47Z-44782`.
Generated EARS and all six baseline compiled content files remain byte-identical; no SDK public API,
format stamp or release metadata changes. The unrelated issue draft remains untouched.

This closes the observed source-restoration/out-of-band output gap in shared chain/package freshness.
It does not prove full tool/import-graph coverage or repair the drive launcher’s separate mtime nudge.
Required next work: complete workspace/published implementation identity, dependent executable/helper
content keys, deliberate skip paths and the appropriate launch freshness contract. All remaining
discovery/native/content-edge, frontend/navigation/boundary and Phase 6 workstreams remain required;
final committed-source strict `--all` and the whole-goal audit remain due.

### Artifact terminology audit checkpoint (2026-10-14)

Source `9b171b104` completes the follow-up terminology audit across packaging, dependency/build
readers, CLI help, settings/reference revision fixtures and repository checks. App artifact
contributions/viewers keep their domain names. Compiled pack/app output uses build terminology;
checked-in generated files use recorded-file/report terminology. Packaging writes
`build-integrity.json` and verifies it with `verifyBuildOutputs`; every in-tree caller moves together.
Repository typechecking borrows `RECORDED_FILE_CHECKS`. Release filename prefixes change their internal
identifier only; third-party `artifactName` and `upload-artifact` APIs and release filenames are preserved.
Two overlooked content fixtures now declare/clear `content.datasets` instead of `content.artifacts`.

Current public documentation, subsystem plans and repository guides adopt the same vocabulary.
`docs/references/recorded-files.md` replaces the misleading recorded-artifacts filename with its incoming
links updated. Archived history, existing validation log paths and the unrelated issue draft remain
untouched. No aliases, format conversion, release/version metadata changes or app artifact renames.

Validation: 66 focused repository checks passed; required strict chain passed all 30 steps in 599.3s,
including API/schema checks, real external authoring, integration, smoke and packaged app acceptance.
Evidence: `/private/tmp/apack-artifact-naming-focused.log`,
`/private/tmp/apack-artifact-naming-final-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T21-12-37Z-49088`. The preliminary chain was deliberately
interrupted to finish the audit; only the final run is acceptance evidence. Generated EARS and six
compiled content files remain byte-identical to the preserved baseline. This closes the naming
follow-up only; all unfinished goal deliverables, including tool/dependency freshness, remain required.

### Shared tool implementation identity checkpoint (2026-10-14)

Source `8fab41528` replaces separate one-module/version-only keys with `buildToolHash`, shared by
generation and cached frontend/types/DSL phases. Workspace keys include CLI/bin/package metadata and
host/SDK/EARS source/package metadata. Published keys include every shipped CLI chunk and installed
SDK declarations/package metadata. The key reads fresh bytes and relative membership; additions,
removals, helper edits and same-version package changes invalidate reuse, while paths and mtimes do not.
Missing/empty implementation evidence refuses; no version fallback, alias or compatibility reader.
Existing phase options/tool versions/authored/generated/staged-definition/dependency-snapshot inputs
remain. Generated-current checks at skip and publication boundaries consume the same tool identity.

The initial strict run exposed nested SDK dist/package.json being mistaken for workspace ownership.
SDK/EARS source owners now come from their exported package.json; the host uses an existing source
export because it does not export package.json. Published SDK code may live in workspace dist or at
the installed package root, and the key follows that compiled scope without requiring authored source.
Dedicated regressions cover both layouts; the actual watcher and real published bin/project handoff
pass. The published fixture preserves npm package-local overrides instead of selecting checkout AJV 6
for the CLI's declared AJV 8. No runtime dependency or public API was changed to accommodate a fixture.

Validation: 52 focused checks and both real watcher/published-CLI integrations pass. Final mutations
removing host coverage fail three assertions; removing phase consumption fails one; removing generation
consumption from the packaged helper fails the real --skip-generate assertion. Source/bundle bytes were
restored exactly before validation. Required strict passes all 30 gates in 544.7s (one cached), including
external authoring, 685 integration cases, runtime build, smoke and packaged app acceptance.
`node_modules/.cache/apack-chain/runs/2026-10-14T21-43-39Z-12319` and
`/private/tmp/apack-tool-identity-reviewed-strict.log` are the accepted run. The first strict failure is
recorded in `/private/tmp/apack-tool-identity-strict.log`; it is not acceptance evidence.

Focused evidence: `/private/tmp/apack-tool-identity-focused-final.log`,
`/private/tmp/apack-tool-identity-layout-integration.log`,
`/private/tmp/apack-tool-identity-{scope,phase,generation}-mutation-final.log`. Five fresh hashes average
25.2ms in `/private/tmp/apack-tool-identity-cost.log`. Committed-source warm strict passes in 1.1s with
29/30 cached: `/private/tmp/apack-tool-identity-committed-warm-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T21-53-16Z-44188`. Generated EARS and six compiled content
files remain byte-identical to the preserved baseline. No schema/API/format/release metadata changes.

This closes the owned implementation/helper key gap. It does not close all dependency freshness:
audit actual compiler/type import resolution, external package inputs, verified dependency executable
helper chunks/content compilers, deliberate skips and coherent publication before certifying that
checkpoint. The separate mtime-based drive nudge/manual-runtime-build contract still needs a coherent
producer/launch decision. Complete those, then resume every remaining contribution/native/static-content
discovery requirement, navigation, frontend boundaries and all three Phase 6 workstreams. Final
committed-source strict --all and the full completion audit remain required; nothing is archived.

### Verified dependency frame checkpoint (2026-10-14)

Source `ce503269b` preserves verified dependency files alongside their type/snapshot projection in
`ResolvedDeps`. Generation, initialization, facade reporting and build callers migrate to that one
frame. Every cached phase hashes id/kind/full build revision/snapshot, independent of delivery path.
Identical-snapshot same-version helper changes now invalidate generation and all cached phases.
The captured directories are re-read through the common data-only verifier before reuse and before
publication; changing the selected resolution does not revoke valid previously pinned bytes. No pack
code activates during verification. Incomplete frames refuse instead of silently returning empty data.

Generation rechecks its inputs after asynchronous compilation, before replacing files/stamps. Final
build publication uses the same generated-current/dependency checks. A real content compiler changes
accepted cached dependency runtime bytes during a --skip-generate build: publication refuses while the
prior complete consumer build and generated stamp remain intact. Metadata fixtures use current parsed
snapshots and actual generated/bundled facades; no production or fixture facade exports were fabricated
to bypass a gate. SDK options receive only type/snapshot data, not host-private file metadata.

Validation: 47 focused tests and the actual producer/consumer publication regression pass. Removing
revision identity fails two tests, verification fails five, the post-async generation check fails one,
and the final publication check fails the real compiler regression. Every source mutation is restored
exactly. Required strict passes all 30 gates in 598.9s (one cached), including external authoring,
watcher/harness/typing integration, runtime build, smoke and packaged app checks. Accepted evidence:
`/private/tmp/apack-dependency-frame-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T22-11-49Z-46991`. Committed-source warm strict passes in
1.0s with 29/30 cached: `/private/tmp/apack-dependency-frame-warm-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T22-23-11Z-78476`. Focused/mutation evidence is in
`/private/tmp/apack-dependency-frame-focused-final.log`,
`/private/tmp/apack-dependency-frame-publication.log`, and
`/private/tmp/apack-dependency-frame-{revision,verification,generation,publication}-mutation.log`.
Generated EARS and six compiled content files remain byte-identical to the baseline. No public SDK
API/schema/format/release metadata changes. The unrelated issue draft remains untouched.

The next audit has concrete remaining inputs: TypeScript and json-schema-to-typescript/AJV/Zod used by
generation resolve outside owned source trees; the phase version list also omits rollup-plugin-dts.
`/private/tmp/apack-external-tool-resolution-audit.log` records actual owner/entry/metadata/version
resolution, including SDK-local AJV 8 and package.json not being exported by rollup-plugin-dts. Cover
actual compiler implementations and consumer type/bundle import inputs through data-only resolution,
including package-local overrides, transitive helpers and current conditional exports. Do not use
observed diagnostic read logs or version-only guesses as complete byte evidence. Revalidate the same
scope at publication and measure its cost. The full frozen-input/publication audit and the separate
manual-build/drive launch contract still remain before certifying overall freshness. Then complete all
remaining contribution/native/static-content discovery, navigation, frontend boundaries and all three
Phase 6 workstreams. Final committed-source strict --all and full requirement audit remain due; no
work is archived from this checkpoint.

### Declared installed-package/compiler scope checkpoint (2026-10-14)

Source `169f8ec8a` captures npm package ownership and declared dependency/peer/optional graphs from
the executing CLI and pack, including pack development dependencies. Resolution follows each owner's
Node lookup paths, retaining local overrides and blocked metadata exports without importing modules.
Relative filenames/bytes and graph edges cover transitive helpers, declarations, data, CSS, native
binaries, missing optional packages and package metadata/conditional exports. Workspace source/export
and published/data roots stay separate from scratch; cycles cannot include compilation roots' output.
Root development dependencies remain included even when first reached through another owner.

One captured compilation key combines owned implementation bytes, package graph bytes and runtime
selectors. Generation and cached phases share it; generation and build publication re-read it. The
previous version-only bundler list is removed. Stable external scopes keep generation/dependency unit
tests focused; dedicated scope tests and actual installed-type integration perform real scans. A
same-version provider .d.ts edit changes emitted registration event names and refuses the old stamp;
the poisoned provider module never executes. A post-async library edit refuses before replacing
generated files/stamp. Byte, package-local lookup and publication-check mutations fail nine, one and
one cases respectively; source is restored exactly.

The initial strict run exposed context ambiguity in a scaffold test: an in-process Vitest generation
under development/node conditions was compared to a standalone CLI generation with different
conditions. Temporary component diagnostics prove identical tool/package hashes and differing export
selectors (`/private/tmp/apack-scope-components.jsonl`). Ignore loader/debug instrumentation; normalize
custom export selectors, retaining meaningful development conditions. The reserved framework source
mode is represented by owned implementation resolution. Compare unchanged reuse across two actual
CLI runs under equal conditions; retain output/import assertions and add the first process exit check.
Temporary diagnostics were removed and package outputs rebuilt before accepted validation.

Evidence: 74 focused cases plus the export-condition normalization case in strict validation; actual
installed-type and async-race integrations pass. CLI typecheck passes.
`/private/tmp/apack-package-inputs-focused-final.log`,
`/private/tmp/apack-package-inputs-real-types-final.log`,
`/private/tmp/apack-package-inputs-{bytes,resolution,publication}-mutation.log`. Required strict passes
all 30 gates in 756.5s (one cached), including scaffold/watcher/external typing, packaged authoring,
runtime build, smoke and app acceptance: `/private/tmp/apack-package-inputs-reviewed-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T23-09-36Z-12005`. The first failed run and intermediate
workflow diagnostics are not acceptance evidence. Committed-source warm strict passes in 1.0s with
29/30 cached: `/private/tmp/apack-package-inputs-committed-warm.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T23-23-15Z-43934`. EARS and six compiled content files
remain byte-identical. No SDK public schema/API/format/release metadata changes or compatibility code.

Cost is material: initial byte-graph measurements were 2.3s CLI and 5.0s default-setup, and the accepted
default pack build is 46.7s versus roughly 27s before this scope. Boundaries share one captured key but
revalidation still walks live bytes. Do not describe this as a speed improvement or silently remove
coverage to regain prior timings. Refine declared scopes and frozen execution coherently in the next
audit. Declared npm graph coverage is implemented; complete compilation closure remains unproven for
inherited compiler configurations, path-mapped/undeclared imports and code already loaded before a
changed disk snapshot. Audit those actual readers/configuration paths and the frozen-input/publication
contract before certifying freshness, then the separate manual-build/drive launch contract. Every
remaining discovery/native/static-content requirement, navigation, frontend boundary and all three
Phase 6 workstreams stays required, followed by committed-source strict --all and full completion audit.
No work is archived; the unrelated issue draft is untouched.

### Inherited compiler configuration checkpoint (2026-10-14)

Source `8261e98c8` introduces a common CLI compiler-configuration reader and includes every
configuration/inheritance file it resolves in the compilation key. TypeScript's current parser
resolves relative/package/array inheritance and JSON comments; keys cover normalized relative
filenames and exact bytes, including parents outside the authored root. DSL option selection,
facade checking and source-resolution rules use the same reader. Missing config retains each
caller's existing defaults; malformed/circular/missing parents and invalid options never become
empty or partial options. Only no-input diagnostics are ignored for entry-driven inspection.
The SDK's separate compiler-version-bound module reader likewise refuses parsed configuration
errors; no TypeScript internals or new APIs are exposed to packs.

A real external-generation regression keeps authored tsconfig/package versions unchanged while
changing an outside parent mapping: the generated stamp is stale and registration event metadata
changes. Malformed parent content refuses while retaining accepted generated files. The fixture
correctly inherits paths as a whole, matching TypeScript's override semantics. Five configuration
reader cases, two direct SDK cases, twelve existing DSL/facade integration cases and the repaired
actual generation case pass. Mutation removal of bytes/refusal fails two/two tests respectively;
SDK refusal and scope consumption removal each fail one. All source mutations restore exactly.

The first strict run exceeded the unit suite's 15s limit in a case doing two real builds; premature
fixture cleanup caused subsequent cwd failures. Move the entire real-build publication test file
unchanged to build-output-swap.integration.spec.ts, its appropriate suite, instead of increasing
unit budgets or weakening assertions. All nine publication cases pass there. Accepted strict
validation passes all 30 gates in 651.0s (16 cached), including external/watcher/typing authoring,
runtime build, smoke and packaged app acceptance. Evidence:
`/private/tmp/apack-compiler-config-reviewed-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T23-39-19Z-53265`. Initial failure evidence remains
`/private/tmp/apack-compiler-config-strict.log`; it is not acceptance evidence. Focused/integration/
mutation evidence: `/private/tmp/apack-compiler-config-focused-final.log`,
`/private/tmp/apack-compiler-config-integration-reviewed.log`,
`/private/tmp/apack-compiler-config-integration.log` (DSL/facade cases passed; its early inherited-
fixture failure was repaired), `/private/tmp/apack-compiler-config-build-publication.log`, and
`/private/tmp/apack-compiler-config-{bytes,refusal,sdk-refusal,consumption}-mutation.log`.
Committed-source warm strict passes in 1.1s with 29/30 cached:
`/private/tmp/apack-compiler-config-warm-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T23-50-44Z-83069`. EARS and six compiled content files
remain byte-identical. No public API/schema/format/release metadata changes; unrelated issue draft
is untouched.

Configuration-file coverage and refusal semantics are implemented. External path-mapped/imported
file bytes, undeclared resolution, loaded-code versus captured disk identity, complete frozen
execution/publication and scope cost remain unproven and required. Complete that audit/work before
certifying freshness, then manual-build/drive launch behavior. Retain every remaining contribution/
native/static-content discovery requirement, navigation, frontend boundary and all three Phase 6
workstreams; final committed-source strict --all and the full completion audit remain due. Nothing
is archived from this checkpoint.

### Remaining artifact vocabulary cleanup (2026-10-14)

Source `bd2f45867` corrects overlooked frontend-loader comments/test messages, distribution-plan
package terminology and build/release labels. Actual app artifact contributions, third-party API names,
archived history and historical log paths retain their meanings. No executable behavior changed.
All 31 frontend-loader tests pass; required strict validation passes all 30 gates in 354.0s
(15 cached): `/private/tmp/apack-artifact-terminology-followup-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-14T23-55-19Z-83799`. The unrelated issue draft remains
untouched. The complete goal and every unfinished requirement remain active.

### Resolved external TypeScript input checkpoint (2026-10-14)

Source `f8c17e99c` adds a fresh TypeScript input traversal to the shared compilation key. It starts
from authored script modules under the current compiler configuration, follows resolved imports and
ambient types, and records exact source and resolution-metadata bytes with pack-relative filenames.
This includes external path-mapped/transitive declarations, undeclared installed packages and ambient
type roots; unresolved targets appearing or resolved targets disappearing change the next key. No
module executes. Generated output is unavailable to the traversal, including imports into it, so
regeneration does not change its own input identity. Existing publication revalidation consumes the
same traversal.

The real generation regression failed before this implementation: changing outside declaration bytes
with constant configuration/versions did not invalidate the generated entry. It now passes and emits
the updated outgoing event. Eight focused cases and CLI typechecking pass. Omitting both source-byte
capture paths fails three focused cases; omitting only the explicit program-source collection is an
equivalent mutation because the compiler host still records its reads, not a missing behavioral check.
All mutations restore exact source bytes. Evidence:
`/private/tmp/apack-external-module-regression.log`, `/private/tmp/apack-external-module-fixed.log`,
`/private/tmp/apack-module-inputs-focused.log`, `/private/tmp/apack-module-inputs-typecheck.log`,
`/private/tmp/apack-module-inputs-byte-mutation.log`. Two fresh shipped-pack traversals cost 1.583s and
1.106s with identical hashes; these are observations, not a performance guarantee:
`/private/tmp/apack-module-inputs-cost.log`.

Required strict validation passes all 30 gates in 772.9s (one cached), including real external app,
watcher/authoring/generation integrations, runtime build, smoke and packaged authoring/app checks:
`/private/tmp/apack-module-inputs-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T00-04-07Z-10889`. Committed-source strict passes in
1.1s (29 cached): `/private/tmp/apack-module-inputs-committed-warm.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T00-17-49Z-42842`. EARS and six compiled content files
remain byte-identical to baseline. No schema/public API/format/release changes or compatibility code.
The unrelated issue draft remains untouched.

This proves the resolved TypeScript scope, not complete executable/compiler closure. Audit distinct
compiler-version/option consumers and imports embedded in Vue or dynamically loaded source, runtime
files selected alongside type declarations, and external watch subscriptions. The watcher currently
calls build in-process: current disk hashing does not prove already-loaded implementation freshness.
Frozen/coherent execution and publication, measured scope cost, and manual-build/drive freshness
remain required before certifying full freshness. Then resume every unfinished discovery/native/static
content requirement, navigation, frontend boundaries and all three Phase 6 workstreams. Final strict
--all on committed source and the complete requirement audit remain due; nothing is archived.

### Fresh watched builds and read-only explorer restoration (2026-10-14)

Source `01eec3309` makes the watcher coordinate a fresh CLI process for each complete staged build.
Linked packages are checked before spawning, export conditions are preserved without the reserved
source condition for pack code, and child failure cannot trigger installation/reload. Closing still
awaits the active build. Readiness, coalescing, verified publication and host reload ordering remain
intact; there is no new public command or bypass flag.

The audit corrected an assumption: custom compiler `tsImport` already refreshes transitive modules,
and that initial regression passes. Ordinary flow imports do cache by filename: the real watcher
published the old flow name after an edit. Fresh processes fix that failure; restoring in-process
builds reproduces it. Custom-helper edits and refusal retention also pass. Evidence:
`/private/tmp/apack-watch-flow-regression.log`, `/private/tmp/apack-watch-inprocess-mutation.log`,
`/private/tmp/apack-watch-worker-integration-reviewed.log`. Five debounce/close tests and CLI
typechecking pass. The existing combined publication test exceeded 60s in strict validation; split
its rebuild/refusal and linked-manifest workflows without dropping assertions or increasing budgets.
The SDK runtime remains file-scoped with per-scenario data reset and pack teardown. Both scenarios
pass standalone and in the full integration pool.

Source `82bca6529` fixes the actual settings revision +1 cause found in real app acceptance. The
Code explorer's CODE_CONNECTED handler previously echoed the received directory as a new user
selection, writing settings during restore/reconnect. Hydrate local state and request file listing
instead; explicit user selection still sends the directory command. A shared context factory resets
the tree, including null-directory reconnection, with fresh collections per actor. No writer, schema,
wire contract or refusal assertion was changed. Three focused cases pass; restoring the selection
command fails one. Evidence: `/private/tmp/apack-explorer-restore-{regression,fixed,mutation}.log`.

The first strict run's publication timeout and second run's settings revision failure are diagnostic
evidence, not acceptance: `/private/tmp/apack-watch-worker-strict.log` and
`/private/tmp/apack-watch-worker-reviewed-strict.log`. Accepted required strict passes all 30 gates
in 785.9s (13 cached), including the unchanged refused-write revision assertion, all 24 main fixture
app cases, replacement/restart checks, smoke and packaged authoring/app checks:
`/private/tmp/apack-watch-worker-explorer-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T00-55-08Z-4455`. Committed-source strict passes
in 1.4s (29 cached): `/private/tmp/apack-watch-worker-committed-warm.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T01-10-52Z-36565`. EARS and six compiled content
files are byte-identical to baseline. No public API/schema/release metadata or compatibility changes.
The unrelated issue draft remains staged and excluded; use explicit-path commits.

Fresh worker lifetime resolves reuse of a previous watched build's executable modules; it is not
proof of immutable reads during a build. External watch subscriptions, Vue/runtime/dynamic inputs,
distinct compiler-version/options consumers, coherent frozen execution/publication and scope cost
remain required, then manual-build/drive freshness. Continue every remaining discovery/native/static
content requirement, navigation, frontend boundaries and all three Phase 6 workstreams. Native
shutdown observations still need their separate final lifecycle audit. Final committed-source strict
--all and the complete requirement audit remain due; no unfinished work is archived.

### External compiler subscriptions and authored declaration aliases (2026-10-14)

Source `ba3d8df85` fixes a real compiler-reader mismatch: metadata generation resolves inherited
TypeScript aliases, but facade bundling previously left every bare identifier external. Declaration
bundling now resolves authored aliases and baseUrl modules with the common configuration reader,
while genuine package identity and native Node imports remain external. Exact/wildcard aliases,
catch-all mappings, external parent configuration and real Vue/Node imports have declaration checks.
The generic classifier mutation fails both cases; type-only input modules are not executed.

Source `b956785fe` adds fresh compiler resolution subscriptions, including absent file/directory
probes, inherited config, physical symlink targets and missing-target recovery. Authored-root events
share the existing watcher. External scopes retain old and partial paths through failure; successful
builds replace them. Parent guards observe atomic replacement, and directory membership differs
from ordinary attribute changes. Byte/topology comparisons suppress duplicate notifications while
retargeting remains meaningful. Changes observed across a build queue another attempt. Configuration
bytes now belong to the same module input projection; the redundant configuration-only hash and
reader pass are removed.

The first full-build fixture exposed the private-alias facade defect rather than a watcher problem;
fixing that consumer was required before accepting the watcher. The actual regression replaces an
outside declaration atomically, changes only its parent configuration to a missing path, verifies
refusal retains accepted output, then creates only the outside target and observes updated generated
events and facade types. The authored config remains byte-identical. Removing outside subscriptions
fails that workflow. Existing flow/helper freshness, host reload, linked-manifest retargeting, refusal
and DSL cases continue to pass. Twenty-three focused cases, fourteen integration cases and CLI
typechecking pass. Evidence: `/private/tmp/apack-external-watch-unit-final.log`,
`/private/tmp/apack-external-watch-typecheck-final.log`,
`/private/tmp/apack-external-watch-integration-compressed.log`,
`/private/tmp/apack-declaration-catchall-fixed.log`,
`/private/tmp/apack-declaration-alias-mutation.log`,
`/private/tmp/apack-external-watch-subscription-mutation-final.log`. Source restores exactly.

The initial shipped-pack traversal proposed 754 directory subscriptions. Group bounded package and
node_modules roots on native recursive platforms and include physical workspace roots; use selected
nonrecursive leaves on Linux. Filesystem ancestors remain nonrecursive replacement guards. The
measured native result is 12 subscriptions, five recursive, with about 2.1s traversal, not a speed
guarantee: `/private/tmp/apack-external-watch-cost-final.log`. Platform topology and dangling-link
probe recovery have focused coverage.

Required strict passes all 30 gates in 839.6s (one cached), including full authoring/watcher/typing
integration, real app, smoke and packaged authoring/app paths: `/private/tmp/apack-external-watch-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T02-08-14Z-47397`. Committed-source strict passes
in 1.1s (29 cached): `/private/tmp/apack-external-watch-committed-warm.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T02-23-17Z-81873`. EARS and six compiled content
files remain byte-identical. No public SDK API/schema/format/release changes or compatibility code.
The unrelated issue draft remains outside these commits.

This covers resolved TypeScript/configuration watch paths, not every runtime input or immutable
execution. Continue exact compiler-consumer/version alignment, Vue/runtime/dynamic and dependency
input closure, coherent frozen execution/publication and scope cost; then manual-build/drive freshness.
Retain all unfinished discovery/native/static-content, navigation, frontend boundaries and all three
Phase 6 workstreams, plus final lifecycle observations, committed-source strict --all and the full
requirement audit. No unfinished plan is archived.

### Compiler-discovered package runtime inputs (2026-10-14)

Source `61d882b7d` fixes a reproduced frontend cache defect: an undeclared npm import can resolve
through an unchanged `.d.ts` while its JavaScript helper changes. The previous second build reused
the frontend containing the old value (`/private/tmp/apack-undeclared-runtime-baseline.log`).
Compiler input reading now returns canonical package owners alongside the type/configuration hash.
Those owners join the existing byte/dependency graph, including transitive dependencies, without
executing package entries. Consuming roots remain separately scoped; an ancestor library cannot
accidentally hash the consuming pack's output. Scoped workspace links have ownership coverage.

The watcher consumes that same graph, observing runtime files, directory membership and missing
transitive dependency candidates. Its signature includes package bytes rather than only declarations.
Actual frontend builds and automatic watching both replace BEFORE with AFTERX after changing only
an undeclared package's JavaScript helper. Existing event-type generation, async mutation refusal,
external missing-target repair and installed runtime publication continue to pass. Focused validation:
34 unit cases, seven real-build integration cases and CLI typechecking. Logs:
`/private/tmp/apack-imported-packages-unit-final.log`,
`/private/tmp/apack-imported-packages-integration-optimized.log`,
`/private/tmp/apack-imported-packages-typecheck.log`.

The first strict run timed out in two watcher scenarios; it is not acceptance evidence
(`/private/tmp/apack-imported-packages-strict.log`). The fix removes repeated package-root resolution,
directory probes and ancestor guards within each subscription calculation, and uses keyed lookup for
ordinary file changes. No cross-build byte cache or timeout increase. Subscription setup falls from
about 2.3s to 0.28s in the isolated measurement. The shipped-pack observation is 46,912 paths,
18 subscriptions (six recursive), about 4.8s input traversal plus 0.28s subscription calculation:
`/private/tmp/apack-imported-packages-{cost-breakdown,watch-cost-final}.log`. These are observations,
not a performance guarantee; full-byte graph scanning remains material.

Required strict passes all 30 gates in 803.2s (one cached), including the full watcher integration
suite, real app, smoke and packaged authoring/app paths:
`/private/tmp/apack-imported-packages-reviewed-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T03-00-50Z-19156`.
Committed-source strict passes in 1.7s (29 cached):
`/private/tmp/apack-imported-packages-committed-warm.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T03-14-38Z-54000`.
EARS and six compiled content files remain byte-identical. No public SDK API/schema, build format,
release metadata or compatibility changes. The unrelated issue draft is excluded.

This closes the runtime-byte gap for compiler-discovered npm owners, not all executable inputs.
Continue Vue/script/style/asset and dynamic input coverage, exact compiler consumers, coherent frozen
execution/publication and scope cost, then manual-build/drive freshness. Retain all remaining
discovery/native/static-content, navigation, frontend boundaries, all three Phase 6 workstreams,
lifecycle observations and final committed-source strict --all plus requirement audit. Nothing is archived.

### Vue script input checkpoint (2026-10-15)

Source `94ab5f834` fixes another reproduced frontend cache gap: an undeclared dependency imported only
by Vue script setup changed its JavaScript, but the second build retained BEFORE rather than AFTERX.
Baseline: `/private/tmp/apack-vue-inputs-baseline.log`. The existing SFC parser now exposes script
language and external source metadata. The common compiler input projection follows each script block
through an in-memory, same-directory root; it writes no virtual files and executes no component code.
Inline JavaScript/TypeScript/TSX, both script blocks and external script sources have input checks.

Symlinked component imports resolve from the physical component directory. A focused regression
failed before this correction (`/private/tmp/apack-vue-inputs-link-baseline.log`). Logical and physical
pack roots both exclude generated output; canonical file identities preserve checkout independence,
with a failing relative-import baseline at `/private/tmp/apack-vue-inputs-location-baseline.log`.
Actual builds prove inline scripts, external scripts and a linked nested component update their
frontend after only outside input bytes change. Automatic watching proves the Vue-only npm import
updates too. Manifest entry modules still must stay inside their pack: the initial linked fixture
violated that boundary and was corrected to import the link from a pack-local canvas, without
weakening the declaration validator.

Focused checks pass 65 fast cases, four compiler integration cases, six existing watcher/DSL cases
and CLI typechecking. All eight package-input build/watch cases pass in the accepted strict run below;
the corrected linked case also passes alone. Focused logs:
`/private/tmp/apack-vue-inputs-unit-final.log`,
`/private/tmp/apack-vue-inputs-{linked-final,compiler-integration,affected-integrations,typecheck-final}.log`.
The initial strict run exposed real compiler/build cases in the 15s unit suite. Move those four cases
to the existing compiler integration suite, retaining every assertion; keep pure condition parsing
in the fast suite. No timeout values were changed. A later strict run hit integration and watcher
deadlines; orphaned Vitest workers and memory pressure were observed afterward. Those workers exited
before attempted termination, so no process was killed. Unchanged isolated cases and the subsequent
full integration run pass. The two failed strict logs are diagnostic, not acceptance evidence:
`/private/tmp/apack-vue-inputs-{strict,reviewed-strict}.log`.

Cost remains material: shipped-pack input traversal measured 11.3s, then 9.3s on recheck; subscription
setup about 0.28s over 48,435 paths, 18 subscriptions and six recursive scopes. The uncached shipped
pack build took 66.4s versus 42.2s in the previous accepted checkpoint. These are observations under
the recorded run conditions, not a performance guarantee or proof of a single cause:
`/private/tmp/apack-vue-inputs-{cost,cost-rechecked}.log`.

Required strict passes all 30 gates in 581.9s (23 cached), including 51 integration files, runtime,
real app, smoke and packaged authoring/app checks: `/private/tmp/apack-vue-inputs-accepted-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T03-49-34Z-78251`.
Committed-source strict passes in 286.9s (22 cached), rerunning integration in 249s:
`/private/tmp/apack-vue-inputs-committed-strict.log`,
`node_modules/.cache/apack-chain/runs/2026-10-15T04-00-13Z-5198`.
EARS and six compiled content files remain byte-identical. No public SDK API/schema, build-format,
release metadata or compatibility changes; the unrelated issue draft remains excluded.

This completes Vue script import traversal, not all Vue or executable input closure. Continue style,
template/asset and dynamic/runtime inputs, exact compiler consumers, coherent frozen execution and
publication, scope cost and manual-build/drive freshness. All unfinished discovery/native/static-content,
navigation, frontend boundaries, Phase 6 API consumption/provenance/replacement, lifecycle observations
and final committed-source strict --all plus requirement audit remain required. Nothing is archived.

### Frontend compiler authority source checkpoint (2026-10-15)

Source `7c97e8553` removes unsound frontend reuse and reports current Vite resources/directory
inputs to ready subscriptions over private worker IPC. It preserves failed-build repair scopes and
logical directory links, indexes rename-event matching, avoids redundant package metadata reads
and includes package manifests in repository build dependencies. The user's integration feedback
limit is 60s, shared by the outer chain and direct pool runner with accurate timeout reporting.

Focused evidence:
- Committed-source validation passes 98 checks across five package/watcher/cache/deadline suites in
  1.55s: `/private/tmp/apack-frontend-checkpoint-committed-unit.log`.
- Package/watcher checks pass 30 cases; cache checks passed 20 cases. CLI/script typechecking passes.
  Logs: `/private/tmp/apack-package-walk-fix.log`,
  `/private/tmp/apack-frontend-matcher-unit.log`,
  `/private/tmp/apack-frontend-final-{cli,script}-types.log`.
- All eight frontend resource cases pass; they cover external CSS/imports/URLs, template assets,
  live watching without diagnostic records, missing-target recovery and initially empty content dirs:
  `/private/tmp/apack-frontend-authority-resources-layered.log`.
- All eight package input cases pass; Vue-only imports now require the compiler frame to refuse
  after an outside helper changes, alongside actual Vite output. Disabling Vue script discovery fails
  all three invalidation assertions; exact source was restored:
  `/private/tmp/apack-vue-inputs-layered{,-mutation}.log`.
- Both publication cases retain source/manifest coalescing, refused-source retention, external-only
  link retargeting, repair and atomic replacement: `/private/tmp/apack-watch-publication-atomic-target.log`.
- After the package-walker fix, a real CLI CSS watch/refusal/recovery case passes in 26.7s under the
  60s bound: `/private/tmp/apack-frontend-checkpoint-watch.log`.
- Old/new package walkers produce the identical fingerprint over 12,661 files / 204.6 MiB:
  `/private/tmp/apack-package-walk-compare.log`. This is not an end-to-end performance guarantee.

Full strict validation remains unresolved. The latest completed attempt
(`/private/tmp/apack-frontend-layered-strict.log`, run `2026-10-15T06-48-57Z-62393`) exceeds the
aggregate integration deadline without a logged assertion failure; uncompleted tests are unverified.
Earlier strict timeout attempts and the three-worker diagnostic are not acceptance evidence.
Focused passes justify this reviewable source checkpoint, not phase or goal completion. Do not
repeat blind bulk retries, attribute the failure solely to machine load, or waive the final gate.

Continue nested-symlink/glob/worker/dynamic input closure, exact compiler consumers and coherent
frozen execution/publication, then manual-build/drive freshness. Retain all remaining discovery/native/
static-content, navigation, frontend boundaries, all three Phase 6 workstreams, lifecycle observations
and final committed-source strict --all plus the full requirement audit. EARS and six compiled content
files remain byte-identical; no release metadata, public API/schema or compatibility changes. Nothing
is archived, and the unrelated staged issue remains excluded from this work's commits.

### Nested frontend content links checkpoint (2026-10-15)

Sources `7ad1f0396` and `01aaa18ab` fix a reproduced missed rebuild when an initially empty nested content-directory
link gains files. One traversal signs membership and subscribes physical targets, including dangling
links; canonical ownership excludes authored outputs, and visited roots bound cycles. Generic missing
stylesheet repair via a newly created symlink remains observable. Notifications reflect changed input
snapshots rather than assuming the originating filesystem event identifies the changed input. Link
identity is signed before excluding authored target contents; external-only retargeting into authored
templates rebuilds without a source edit masking the event. That boundary has a failing regression at
`/private/tmp/apack-content-link-owned-retarget-baseline.log`.

Baseline: `/private/tmp/apack-nested-directory-link-baseline.log`. Final focused checks pass 21 cases
(12 frontend and nine compiler watcher cases): `/private/tmp/apack-nested-directory-links-final-unit.log`.
The final five focused suites pass 105 checks in 2.20s:
`/private/tmp/apack-content-link-owned-retarget-unit.log`. CLI typechecking passes:
`/private/tmp/apack-content-link-owned-retarget-types.log`. An actual CLI watcher
compiles initially absent Tailwind classes after only a nested physical target gains HTML; output and
publication assertions pass; it also replaces the content link with an authored-template target,
publishes the new classes and removes the prior classes in 20.7s total under the 60s bound:
`/private/tmp/apack-content-link-owned-retarget-integration.log`. No public API/schema, release metadata,
format or compatibility changes. The unrelated staged issue is excluded.

Continue external glob/worker/dynamic input closure, exact compiler consumers, coherent frozen
execution/publication and manual-build/drive freshness. Retain every remaining discovery/native/
static-content, navigation, frontend boundary, Phase 6 and lifecycle requirement. The aggregate strict
gate remains unresolved; final committed-source strict --all and the full requirement audit are still
required. Nothing is archived or excluded.

### Empty external frontend globs checkpoint (2026-10-15)

Source `49f2647f3` subscribes directory membership for initially empty external `import.meta.glob`
inputs. Syntax-tree inspection runs after Vue/TS transformation and before Vite expansion; module
subpaths use Vite's resolver. Existing frontend subscriptions handle physical directory links.
The reproducer failed before the fix (`/private/tmp/apack-empty-glob-baseline.log`). Four actual Vite
compilation/watcher cases now pass in 4.33s, verifying additions and removals for relative globs,
arrays/exclusions, literal `base`, and a package-root subpath glob through an external link:
`/private/tmp/apack-empty-glob-verified.log`. All 105 focused build/watcher checks, CLI typechecking
and changed-file correctness lint pass (`/private/tmp/apack-empty-glob-unit.log`,
`/private/tmp/apack-empty-glob-types.log`). This covers these static glob forms; computed options,
worker/dynamic input closure, compiler identity, coherent frozen publication and every larger goal
requirement remain open. The aggregate strict gate and final committed-source strict `--all` remain
required; focused evidence does not establish phase completion. No scope is excluded or archived.

### Worker compiler inputs checkpoint (2026-10-15)

Source `53550379d` includes Vite's separate worker compiler graphs in both diagnostic reads and live
subscriptions. Reports accumulate worker and main inputs per compilation, retaining worker files in
the final accepted scope. Nested workers receive fresh reporting/glob surfaces from the same factory.
Both URL and `?worker` entries missed dependency-only changes before this fix:
`/private/tmp/apack-worker-input-baseline.log`. Eight targeted cases pass in 38.54s, including prior
glob regressions, nested workers, an empty nested-worker glob, and real CLI error retention/repair:
`/private/tmp/apack-worker-input-verified.log`. All 105 focused build/watcher checks pass in 2.21s
(`/private/tmp/apack-worker-input-unit.log`); CLI typechecking and changed-file correctness lint pass
(`/private/tmp/apack-worker-input-types.log`, `/private/tmp/apack-worker-input-lint.log`). This is
focused checkpoint evidence; the aggregate strict gate, remaining dynamic/compiler/frozen-publication
work and every larger goal requirement remain open. No exclusions or archival.

### Variable import membership checkpoint (2026-10-15)

Source `a6be184da` observes fixed relative directory prefixes of variable import templates. Vite
expands those templates after user surfaces, so observing authored `import.meta.glob` alone missed
initially empty variable-import graphs. The observer conservatively tracks membership; Vite still
owns expansion and diagnostics. Explicit `@vite-ignore` runtime imports are excluded.
The matching-file reproducer fails before the fix (`/private/tmp/apack-variable-import-baseline.log`).
Seven actual Vite cases pass in 6.78s, proving additions/removals, filename prefixes, ignored imports
and existing glob forms (`/private/tmp/apack-variable-import-final.log`). Nested-worker glob coverage
also passes (`/private/tmp/apack-variable-import-verified.log`). All 105 focused checks pass in 2.30s;
CLI typechecking and changed-file correctness lint pass (`/private/tmp/apack-variable-import-{unit,types,lint}.log`).
This does not establish arbitrary runtime import closure or frozen compilation. Computed glob
options, exact compiler-consumer identity, coherent execution/publication, manual-build/drive
freshness, the unresolved aggregate strict gate and all remaining goal phases stay required.

### Development startup compiler checkpoint (2026-10-15)

Source `f74617e5f` routes `pack dev`'s initial build through the same fresh-process runner used by
watched builds. Previously, refreshing linked packages could leave the supervisor's already-loaded
compiler code executing against new on-disk fingerprints. The startup child is aborted on supervisor
shutdown; unobserved builds explicitly disable inherited private input reporting. Watchers retain
observed reports through the runner's options object. Public CLI flags and release behavior are unchanged.
Two real-process cases pass in 12.52s, proving startup bypasses the supervisor compiler and cancellation
terminates a waiting child (`/private/tmp/apack-dev-fresh-compiler-integration.log`). Substituting the
in-process build makes the startup regression fail (`/private/tmp/apack-dev-fresh-compiler-mutant.log`);
the exact source was restored. Nineteen startup/ownership checks pass; CLI typechecking and changed-file
correctness lint pass (`/private/tmp/apack-dev-fresh-compiler-{unit,types,lint}.log`). The existing real
worker refusal/repair watcher still passes in 25.17s (`/private/tmp/apack-dev-fresh-compiler-watch.log`).
This closes the initial development-build cache boundary only. Direct-command bootstrap identity,
long-lived frontend compiler identity, coherent frozen reads/publication, remaining dynamic inputs,
manual-build/drive freshness, the aggregate strict gate and every other goal requirement remain open.

### Shared private compiler entry checkpoint (2026-10-15)

Source `1a1895529` routes public `pack build`, initial pack development and watched builds through one
private compiler entry after refreshing linked packages. The native bootstrap selects it over an
owned IPC channel in source and copied-package layouts. Flags reach the compiler unchanged; workers
call `build()` directly without recursive command dispatch or another package refresh. Workers stop
on parent loss and disconnect on completion. Release orchestration and public command shape stay unchanged.
Four source/copied-package/lifetime cases pass in 14.68s (`/private/tmp/apack-direct-worker-verified.log`),
including same-version helper-chunk refusal and regeneration. A public in-process compiler mutation
fails with the poisoned supervisor compiler (`/private/tmp/apack-direct-worker-mutant.log`), and exact
source is restored. Seventy-eight focused checks, CLI/tooling typechecking and changed-file correctness
lint pass (`/private/tmp/apack-direct-worker-{unit,types,script-types,lint}.log`). Startup/cancellation
and real watched worker failure/repair pass in 24.19s (`/private/tmp/apack-direct-worker-dev-watch.log`).
Earlier lifetime attempts hit the 60s cap waiting for `close`. An isolated Node reproduction proved
parent-initiated IPC disconnect omits `close` despite process exit and ended streams; the test now
asserts those actual lifetime conditions with two-second bounds. The discarded process-group draft
is absent. This completes the post-refresh process boundary, not immutable compiler/source reads.
Long-lived frontend identity, coherent frozen execution/publication, remaining input closure,
manual-build/drive freshness, the aggregate strict gate and all other goal scope remain required.


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


### Validation fixture and reporting checkpoint (2026-10-15)

Source `21110749b` moves real default-fork compilation/archive production into contract preparation,
with shipped-build provenance checked before app consumption and explicit chain input/output edges.
The app hook no longer compiles or deletes a still-running compiler's inputs. All 19 frontend watcher
cases and 58 assertions remain, split into glob, worker and resource files with shared cleanup.
The two long synchronous scaffold suites now yield between cases using the existing Vitest policy.
No test/hook deadline changes or production behavior changes in this checkpoint.

The first strict run (`2026-10-15T10-27-56Z-94568`) passes contract preparation and actual app checks:
24 external fixture tests, packaged fixture checks, replacement in two windows, live reload and normal
fork/removal/restoration boots. Integration still hits its 300s bound under concurrent load. The isolated
run completes all 57 files / 739 tests in 287s but fails on Vitest's task-update RPC timeout; this is a
failed run, not green evidence. The subsequent scaffold yield fix clears that reporting failure.

Strict run `2026-10-15T10-39-17Z-22498` passes in 369.9s: integration 57 files / 739 tests, host 404 files /
4,824 tests, default-pack 114 files / 845 tests (existing 1 file / 2 tests skipped), type/API/schema/export/
facade/lint/specifier/tier checks and required app/build checks (unchanged checks cached).
Logs: `/private/tmp/apack-validation-reporting-strict.log` and its chain run directory. Committed-source
strict validation passes again at `21110749b` in 1.1s (29/30 cached), run
`2026-10-15T10-45-50Z-51149`, `/private/tmp/apack-validation-placement-committed.log`.

The exact CLI inspection suite also passes all 10 tests, including missing authored modules and poisoned
runtime discovery (`/private/tmp/apack-info-discovery-recheck.log`). `b0e60d2d3` repairs the stale manifest
reference table and consolidation ledger for direct editor/app extension declarations.
This closes the validation checkpoint only. All remaining discovery/freshness, cold editor/provider,
navigation, frontend boundaries and three Phase 6 workstreams remain required; final strict `--all` on
committed source and the whole-goal requirement audit remain outstanding. Nothing is archived or waived.


### Inline step node data checkpoint (2026-10-15)

Design `4d523f514`; source `324816421`. `extensions.steps.<type>.node` now declares labels and JSON
initial values inline. Codegen emits data into both registrations; backend/frontend admission compares
it exactly. The 15 authored default/external step-node exports are removed, scaffolds write the same
grammar, and module-target readers no longer interpret node data as code. Metadata-only steps have no
invented directory; typed DSL helpers still require a real declared code directory. CLI inspection
includes node data and declared bindings without authored modules or runtime activation. Public schema,
API report and authoring docs are regenerated/reviewed. No release metadata or format constant changed:
format 1 is the existing unreleased contract under its once-per-release rule.

Node creation also clones nested defaults, fixing cross-node mutation of the declared baseline. The
LLM initial model remains unchanged; switch defaults express the absent predicate by omission. Actual
repository creation, trigger validation and model behavior pass 54 default-pack harness tests
(`/private/tmp/apack-inline-node-runtime.log`). All seven baseline generated EARS/compiled-content files
remain byte-identical after the strict rebuild. No EARS shape/type widening or compatibility path.

Evidence: 346 focused schema/codegen/binding/inspection tests pass
(`/private/tmp/apack-node-verified-focused.log`); real scaffold, external build and doctor checks pass,
with the corrected doctor file's 14 tests passing (`/private/tmp/apack-inline-node-doctor-restored.log`).
Removing either node-data comparison or default cloning fails its regression; exact source is restored
(`/private/tmp/apack-inline-node-{backend,frontend,defaults}-mutant.log`). A TypeScript-AST audit identifies
and fixes the remaining incomplete step fixtures; affected fixtures now use checked PackManifest types
rather than casts. Earlier failed runs are not green evidence. The dependency helper's three integration
cases and four trigger/generated-module checks pass after their fixture corrections.

Strict `npm run chain -- --strict --cores 1` passes at run `2026-10-15T11-26-38Z-92924`, 553.2s,
`/private/tmp/apack-inline-node-validated-strict.log`. Integration: 57 files / 739 tests. The host pool's
changed projects pass (the preceding successful wider host run covered 395 files / 4,709 tests);
default-pack 114 files / 845 tests pass (existing 1 file / 2 tests skipped). Required type/API/schema/
export/facade/lint/specifier/tier, runtime build, smoke, packaged authoring and real external app checks
pass or reuse unchanged successful inputs. App checks include two-window fork replacement, reload and
normal fork/removal/restoration boots. Serial step admission avoids the previously measured build/pool
contention; no timeout was increased. Committed-source default strict passes again in 1.1s (29/30 cached),
run `2026-10-15T11-36-39Z-23354`, `/private/tmp/apack-inline-node-committed-strict.log`.

This closes step-discovery checkpoint 1 only. Native step declarations, frontend/palette/layout metadata
and live catalog readers remain required in checkpoints 2–3. Every other discovery/freshness, editor/
provider, navigation, failure-boundary and all three Phase 6 requirements remain active. Final strict
`--all` on committed source and the requirement-by-requirement completion audit remain outstanding.


### Declarative frontend step checkpoint (2026-10-15)

Source `cda9fa00e` completes step checkpoint **2A** in the
[discovery plan](discovery-without-activation.md#frontend-step-declaration-design-2026-10-15).
Step `fe` now declares presentation, icon/component targets and loading modes, static layout flags and
named calculated-layout functions. Generated bindings share component grammar with feature surfaces;
frontend admission checks metadata, slot membership and callable layouts without invoking them.

All 15 authored frontend step modules and both frontend scaffold templates are removed. Fire/Switch
calculations live in typed layout exports. `StepFEFacet.loadComponents` and its host execution path are
gone; atomic refusal/incumbent-resource tests now use supported designation collisions. Step `types`
and `dsl.helpers` explicitly name their modules. There is no executable-directory inference, conventional
file probing or `dsl.custom`. Shared type modules enter the generated union/barrel once. Schemas, API
reports, module readers, CLI scaffolds/inspection, fixtures and public docs agree.

Evidence:

- A TypeScript AST comparison against the previous committed modules confirms all 15 declarations retain
  every static field, component slot/loading mode and layout slot (`/private/tmp/apack-step-parity.mjs`).
  All seven baseline generated EARS/content files remain byte-identical after final validation. The
  default-pack facade report also remains unchanged; no EARS type widening or added shapes.
- Real scaffold/dependency builds pass. The extended external editor fixture builds explicit step types,
  helpers, lazy form and layout, copies the build and deletes authored sources, then inspects it before
  importing executable code. Separately, the supported host frontend loader admits that built registration,
  its calculated layout/lazy form work, and unload removes it. Poisoned-build CLI inspection remains covered.
  Actual Fire/Switch layout checks pass in the default-pack suite.
- Three mutations bypassing presentation admission, callable-layout checks and component-export checks
  fail the intended assertions; exact source was restored. Logs:
  `/private/tmp/apack-step-mutation-{host-presentation,layout-callable,component-export}.log`.
- The first strict run caught a CLI test importing a private host source file. Fixed the test to exercise
  the supported loader/registry instead; all 17 spec-placement checks and the real external test then pass.
- `npm run chain -- --strict --cores 1` passes in 624.9s, reusing 16 unchanged accepted steps:
  `node_modules/.cache/apack-chain/runs/2026-10-15T12-20-13Z-37971`,
  `/private/tmp/apack-step-presentation-validated-strict.log`. Host: 395 files/4,712 tests; integration:
  57 files/739 tests, including facade/completion checks; default pack: 846 tests, existing one file/two
  tests skipped. External-pack app/replacement/restart, smoke and packaged authoring/app checks pass.
  No deadline changes. Reused API/package/default-build/facade checks passed in the preceding run
  `2026-10-15T12-12-40Z-29346`, whose sole host-test failure was the corrected private import.
- On committed source, `npm run chain -- --strict` passes in 1.1s (29/30 cached):
  `node_modules/.cache/apack-chain/runs/2026-10-15T12-31-28Z-70329`,
  `/private/tmp/apack-step-presentation-committed-strict.log`. Unrelated staged issue work is untouched.

Next is required checkpoint **2B**: native step declarations/admission and common native/installed/source
catalog/window projections, including ownership, captured metadata and the unchecked native frontend
composition path. Only then migrate palette/style/default/layout readers and retire permanent active-only
caches in checkpoint 3. Full trigger/build metadata, remaining contribution kinds/assets, exact compiler/
frozen execution/freshness, cold editor readiness, native lifecycle, navigation, frontend boundaries and
all three Phase 6 workstreams remain required. This is not phase/goal completion or the final strict `--all`.


### Native step/catalog foundation checkpoint (2026-10-15)

Source `fdd967ec5` completes **2B.1** in the
[discovery plan](discovery-without-activation.md#native-stepcatalog-admission-audit-and-execution-order-2026-10-15).
Native `steps` use the authored `StepEntry` schema/type. `StepCatalogEntry` and `PackCatalogView.steps()`
share one native/installed/source projection, retaining disabled and unbuilt declarations without code
loading or manufactured build identities. Window projections stay stable per committed frame and ignore
stale frames. Different inactive owners remain visible; two active packs cannot share a step wire.

Backend native step admission now shares the installed checker: exact node data, facet/handler/flag
membership and the separately declared trigger registration slot. Both runtime registries capture step
node/default/presentation/component-slot/layout data before checking/publishing it, preserving executable
component/function identities. Later caller mutations cannot change accepted data or membership. Native
JSON and runtime node/connection data are validated before copying, so cloning cannot normalize invalid
classes or execute declarative accessors. Identity getters in executable bindings are read once; the
production-registry test preserves that invariant without deriving declarations from those getters.
Unused definition-store wrappers are removed; unrelated shared slot/DSL behavior remains intact.

A reproduced schema bug also dropped own `__proto__` keys from opaque JSON defaults. Node and settings
defaults now validate and clone JSON without record decoding; inferred `Record<string, unknown>` types
and generated JSON Schema object semantics are preserved. Native fixture composition declares existing
step data/slots explicitly and refuses missing node data, with authored fixtures migrated. No EARS types,
shapes, wire names, content identities or release metadata change; no compatibility path is introduced.

Evidence:

- Focused host/schema/settings/catalog checks pass (1,139 tests), followed by native purity/slot/runtime
  checks (1,031 tests and final 91-test guard recheck). Class normalization was independently reproduced:
  the schema refused a class while the catalog accepted its clone; JSON-key regression failed before its
  fix. Logs: `/private/tmp/apack-native-step-{json-baseline,json-fixed,data-capture-baseline}.log`.
- Eight mutations of native admission, active ownership, node/presentation capture, window projection,
  native JSON-before-copy, trigger registration membership and runtime JSON-before-copy fail the intended
  assertions; exact source restored. Logs: `/private/tmp/apack-native-step-mutation-*.log`.
- The initial full host run caught one old renderer assertion requiring mutable step-object identity;
  the corrected test proves owned node data and retained executable icon identity. Initial complete strict
  validation passes in 862.7s: `node_modules/.cache/apack-chain/runs/2026-10-15T13-04-19Z-79123`,
  `/private/tmp/apack-native-step-foundation-strict.log`, including 395 host files/4,717 tests.
- Final `npm run chain -- --strict --cores 1` after the additional guards passes in 811.0s (one unchanged
  step reused): `node_modules/.cache/apack-chain/runs/2026-10-15T13-25-59Z-16224`,
  `/private/tmp/apack-native-step-foundation-validated-strict.log`. Changed host subset: 299 files/3,571
  tests; integration: 57 files/739 tests, including facade/completion checks; default pack: 846 tests,
  existing one file/two tests skipped. Real external contract, Electron replacement/restart, smoke,
  packaged authoring/app, API/schema/package checks pass. All seven baseline EARS/content files and
  the default-pack facade report remain unchanged. No test/hook deadline changes.
- Committed-source `npm run chain -- --strict` passes in 1.0s (29/30 cached):
  `node_modules/.cache/apack-chain/runs/2026-10-15T13-40-49Z-51256`,
  `/private/tmp/apack-native-step-committed-strict.log`. Unrelated staged issue work is untouched.

Required next is **2B.2**: complete native frontend declaration grammar/admission authority and accepted
owner/revision binding information. The pre-existing unknown-native-owner frontend bypass remains
unfinished, explicitly owned by that checkpoint; it is not an approved exception. Finish it before
checkpoint 3's live palette/style/default/layout readers and permanent-cache removal. Full trigger/build
metadata, remaining kinds/assets, exact compiler/frozen-execution/freshness and scope-cost work, native
lifecycle, cold editor readiness, navigation, frontend boundaries and all Phase 6 workstreams remain
required. This is not phase/goal completion or final committed-source strict `--all` validation.


### Browser-safe native declaration foundation (2026-10-15)

Source `92b2804ae` advances required discovery checkpoint **2B.2**. The canonical authored/native Zod
schema and pure dependency/check-policy parsers now live in SDK framework; build tools retain their
purpose-specific public exports from that same implementation. Native artifacts, blocks, DSL definitions
and feature designations share authored constituent schemas. The small framework native-declaration
checker enforces JSON purity before decoding/copying; catalog and native frontend admission use it.
Frontend comparison accepts immutable declaration data. Native registration tests exercise all added
fields, reject changed DSL globals transactionally, and refuse declarative getters without invoking them.
The browser-bundled public checker executes without Node build tooling or authored pack module imports.

Evidence:

- Focused schema/framework/frontend checks: 1,095 tests; final guard/link recheck: 54 tests. Three
  mutations independently defeat native grammar, frontend contribution projection and JSON-purity checks;
  each fails the intended assertions, with exact source restored. Logs:
  `/private/tmp/apack-native-grammar-{focused-final,guard-recheck,mutation-*}.log`.
- Initial strict validation caught test-fixture literal widening/optional access, fixed with the actual
  `PackFERegistration` contract. The next gate found a moved-source link in the separately staged issue.
  Only its working-tree link target was corrected; its staged content is unchanged and it is excluded
  from this checkpoint. No compatibility file was retained to satisfy the link.
- Final `npm run chain -- --strict --cores 1` passes in 610.5s (21/30 cached from the preceding runs):
  `node_modules/.cache/apack-chain/runs/2026-10-15T13-59-34Z-62601`,
  `/private/tmp/apack-native-browser-grammar-final-strict.log`. Host: 396 files/4,725 tests; integration:
  57 files/739 tests; shipped pack: 846 tests, existing one file/two tests skipped. External contract,
  replacement/restart app, smoke, packaged authoring/app, API/schema/package checks pass. All seven
  baseline EARS/content files and the shipped facade report remain unchanged. No deadline changes.
- Committed-source strict passes in 1.0s (29/30 cached):
  `node_modules/.cache/apack-chain/runs/2026-10-15T14-10-09Z-94686`,
  `/private/tmp/apack-native-browser-grammar-committed-strict.log`. Reviewed schema diff changes only its
  source-location comment; public API reports contain the intended native fields and checker.

Continue **2B.2** with mandatory native/loaded declaration authority, complete metadata capture and
provisional-settings cleanup, real fixture/shell migration, and accepted owner/revision binding data.
The unknown-owner frontend bypass is still required unfinished work. Finish this before checkpoint 3's
live consumers/cache removal. Every other phase and the final committed-source strict `--all` audit
remain required; this foundation checkpoint completes neither 2B.2 nor the goal.


### Mandatory frontend admission checkpoint (2026-10-15)

Source `e5dcdec63` completes discovery **2B.2**. Registry writes require explicit native declarations or
the accepted backend entry; the unknown-owner bypass and optional native constructor checking are gone.
Declaration data is checked before copying. Binding metadata, declaration-directed routes, facet/slot
containers and DSL globals are captured before comparison, retaining machines/components/callbacks.
Capture and validation share the registry's preparation guard; reentrant getters cannot publish nested
writes. Every refused candidate retires provisional settings, including failures before settings binding.

Accepted step rows retain owner, immutable declaration data and backend runtime/build/declaration
identities, with stable entries across unrelated publication. Native rows manufacture no installed
identities. Source delivery does not change backend authority. The loader owns its input/declarations
before awaits: mutating the caller's entry can no longer make old code claim newer identities or refuse
its originally accepted metadata. `getStepFrontendBindings()` exposes these rows through the SDK.
Public native frontend fixture composition supplies valid stand-ins without inferring production data.
`@apackdev/host/fe/testing` separates frontend test composition from backend build tooling.

Evidence:

- Focused runs pass (654 tests across 61 files; subsequent 497-test public-entry/boundary run and 26-test
  capture/reentry check). Ten mutations of identity, cleanup, routes, facets, DSL globals, slots, pinned
  delivery, accepted revisions, JSON-before-read and capture reentry fail their intended assertions;
  exact source restored. Logs: `/private/tmp/apack-mandatory-frontend-mutation-*.log`.
- Getter repetition, declarative identity read before JSON validation, mutable async delivery identities
  and getter reentry were reproduced before their fixes. Reproductions:
  `/private/tmp/apack-mandatory-frontend-{facet-getters,loaded-json,async-identity,capture-reentry}-baseline.log`.
  Fix checks: `/private/tmp/apack-mandatory-frontend-{getters-fixed,race-fixed,capture-reentry-fixed}.log`
  and the final strict run.
  The first strict run caught renderer imports from host-private tests; moving to the public frontend
  testing entry also avoids importing the backend's Node build tooling into renderer tests. No boundary
  exception or environment shim was added. Reviewed SDK reports and public/internal architecture docs.
- Final `npm run chain -- --strict --cores 1` passes all 30 steps in 856.3s:
  `node_modules/.cache/apack-chain/runs/2026-10-15T15-07-32Z-14020`,
  `/private/tmp/apack-mandatory-frontend-validated-strict.log`. Host: 397 files/4,739 tests; integration:
  57 files/739 tests; shipped pack: 846 tests, existing one file/two tests skipped. Real external contract,
  app replacement/restart, smoke and packaged authoring/app checks pass. All seven baseline EARS/content
  files and the shipped facade report remain unchanged. No deadline changes or release metadata edits.
- Committed-source strict passes in 1.0s (29/30 cached):
  `node_modules/.cache/apack-chain/runs/2026-10-15T15-22-26Z-49794`,
  `/private/tmp/apack-mandatory-frontend-committed-strict.log`. The separately staged issue is uncommitted;
  its existing working-tree link correction is retained and its staged content is preserved.

Required next: correct the independently reproduced keyed-declaration loss in
[manifest consolidation](../../plans/manifest-consolidation.md#required-own-key-preservation-correction-2026-10-15),
then checkpoint 3's live palette/style/default/layout readers and permanent-cache removal. A current
valid `__proto__` entity key disappears during Zod decoding; the opaque-default fix did not cover keyed
contributions. Audit and preserve all keyed declarations with accurate schema/type/diagnostic behavior;
prove generated typed/untyped EARS, ownership and offline behavior. This is required completion work.
All remaining discovery/compiler/freshness/scope-cost, native lifecycle, cold editor readiness, navigation,
frontend boundaries and all three Phase 6 workstreams remain required, followed by the complete 17-decision/
phase audit and committed-source strict `--all`. Neither discovery nor the goal is complete.


### Declaration dictionary preservation checkpoint (2026-10-15)

Source `29f0cc556` closes the required own-key correction in manifest consolidation. The shared decoder
preserves every accepted own key and its parsed value, including `__proto__`, with matching key/value
validation, nested diagnostic paths and JSON Schema grammar. Authored/native schemas and snapshot
readers use it; snapshots return parsed data rather than the old raw-data workaround. Generated JS and
EARS define own data properties, preserving wire literal types, typed fields and untyped unknowns.
CLI compiled type inventories retain those keys too. Manifest agreement now ignores object-field order
while still refusing changed declarations. Existing relation and route grammar is unchanged.

Evidence:

- 85 focused decoder/schema/snapshot/catalog/CLI inspection checks passed, including the resumed
  frontend-member inspection test; 89 layout checks and 10 generated compiler/runtime checks passed.
- A real external pack builds and stages, loses its authored source, remains inspectable without
  activation, then loads with the same entity/service identities. Its shape module throws if executed.
- Three deliberate mutations of decoding, JavaScript emission and EARS runtime export are caught;
  exact source restored. Logs: `/private/tmp/apack-own-record-mutation-{record,literal,ears}.log`.
- SDK API reports regenerated and reviewed: record input/output types remain precise; the generated
  JSON Schema is byte-identical. All seven baseline EARS/content files and the default facade are unchanged.
- Strict `npm run chain -- --strict --cores 1` passes all 30 steps in 867.3s, run
  `2026-10-15T15-54-03Z-54510`, `/private/tmp/apack-own-record-strict.log`: host 400 files/4,758 tests,
  pack 846 passed/2 skipped, integration 58 files/740 tests; real external and packaged app checks pass.
- Committed-source strict passes again in 1.0s (29/30 cached), run `2026-10-15T16-08-58Z-90491`,
  `/private/tmp/apack-own-record-committed-strict.log`. Unrelated staged issue work remains uncommitted.

Next is checkpoint 3's live palette/style/default/layout readers and permanent-cache removal. Full
trigger/build metadata, remaining contribution kinds/content/assets, exact compiler identity/input closure,
frozen execution/publication and manual-build/drive freshness, native/editor lifecycle, entity navigation,
frontend boundaries, all three Phase 6 workstreams and the complete requirement audit remain required.
This checkpoint completes neither discovery nor the goal; final strict `--all` on committed source remains.


### Live frontend step readers checkpoint (2026-10-15)

Source `76df2f0e5` completes discovery reader **3A**, not all of checkpoint 3. SDK readers select a
unique runtime owner ahead of source previews, retain unavailable declarations and require current
owner/data/identity agreement for execution. Native bindings compare captured data without invented
stamps. Scoped readers observe independent catalog/frontend publications and release both listeners.

UI helpers share one implementation for fresh imperative reads and scoped reactive consumers. Palettes,
menus, node/form maps, frontend creation defaults and brain presentation use declarations. Permanent
node/color caches and contribution proxies are removed. Unavailable creation is disabled, presentation
uses a fallback icon/component and static layout flags remain available. Retained descriptors recheck
binding identity before invoking callbacks, including after replacement.

Evidence and corrections:

- 22 SDK reader checks, five mounted pack Vue consumer checks and 29 pack layout checks pass. Five
  deliberate readiness/data/publication/layout/snapshot mutations were caught; source restored.
- Mounted tests initially lived in the renderer; placement/input guards rejected that. They now live with
  their pack source. Node/backend and Vue/jsdom projects inherit the shared helper, isolation and timeouts;
  the config guard documents the helper's genuine single-environment limitation. The existing Vue compiler
  is declared as a development dependency, with no unrelated dependency upgrades.
- Workspace-qualified subprojects are attributed only when the root manifest confirms ownership.
  All 11 reporter integration checks pass, including a real multi-project fixture and foreign-name refusal.
  Fixed its readonly-array sorting error before final validation; configuration/placement/input/timeout
  checks pass all 68 cases. One known-invalid validation attempt was deliberately stopped for this correction.
- The actual app test originally bypassed the UI's reply-address wrapper with a raw actor send. Using the
  New Flow button fixes setup; the installed Stamp/Pulse palette stays mounted across disable/re-enable,
  retains metadata and disables/re-enables creation. The focused test and all 25 external fixture app tests pass.
- Reviewed SDK/UI API reports; schema, facade and seven baseline EARS/content files remain unchanged.
  Accepted full host pool: 410 files/4,903 tests; pack: 851 passed/2 skipped; integration: 58 files/741 tests.
- Final strict `npm run chain -- --strict --cores 1` passes all 30 steps in 338.3s (18 cached), run
  `2026-10-15T17-06-09Z-45689`, `/private/tmp/apack-live-step-passing-strict.log`; the changed integration
  subset passes 9 files/375 tests. External/app, smoke and packaged authoring paths pass. Earlier full-pool
  evidence is `2026-10-15T16-55-30Z-15725`; its lone app setup failure is corrected above.
- Committed-source strict passes again in 1.1s (29/30 cached), run `2026-10-15T17-13-14Z-62147`,
  `/private/tmp/apack-live-step-committed-strict.log`. Unrelated staged issue work remains uncommitted.

Next is required **3B**: backend catalog defaults/provider ownership and the now test-only frontend
step lookup cleanup. Full trigger/build metadata, remaining contribution/content/asset discovery,
compiler identity/input closure/frozen publication and manual-build/drive freshness, native/editor
lifecycle, entity navigation, frontend boundaries and all three Phase 6 workstreams remain required.
Finish the complete original-requirement/phase audit and final committed-source strict `--all` before
completion. This checkpoint closes neither discovery nor the goal; nothing is archived.


### Backend step metadata and write eligibility — checkpoint 3B

Source `71fad4013` completes discovery reader **3B**. Backend defaults and labels read committed
catalog declarations without activating providers. New node creation requires an enabled accepted
backend matching the selected owner, declaration data/revision and optional build revision. Its actual
runtime generation is rechecked after trigger validation and before writes. Active runtime/build
lookups retain their separate execution and retirement lifetime.

The host owns accepted origin/declaration snapshots and relation/query-field data before callbacks or
caller mutation. Native and source execution use actual admission generations without fabricated
installed receipts. Backend step lookups bind only to the backend host; obsolete frontend step ports,
facet helpers, harness merging and duplicate binding indexes are removed. Test stand-ins declare
metadata explicitly. Public extension guidance and three SDK API reports match this contract.

Validation and corrections:

- The CLI offline-info test passes with flattened extension keys and no authored modules or activation.
  Four actual-registry tests cover unload, atomic replacement/refusal, source identity and owned data.
  Fourteen SDK binding checks cover unavailable, stale, foreign and ambiguous owners. Repository tests
  prove unavailable providers and retirement/replacement during validation cannot write a node.
- Two deliberate guard mutations were caught: changed declaration data authorized a provider, and
  removing the post-validation generation check allowed writes after retirement/replacement. Restored
  source passes. Evidence: `/private/tmp/apack-step-mutation-{identity,write-boundary}.log`.
- Full host pool: 403 files/4,801 tests. Pack pool: 851 passed/two skipped. Full integration: 58 files/
  741 tests in run `2026-10-15T17-54-49Z-78244`. That attempt's sole remaining failure was app test
  setup: the canvas deliberately ignores palette clicks during its list-to-view transition. The test
  retries the UI action within the same five-second assertion limit; no production timeout changes.
- The focused installed-app scenario passes, then all 25 external fixture app tests, bundled fixture,
  replacement scenarios, smoke and packaged authoring pass. Creation requires a permanent backend ID
  with declared defaults, rather than an optimistic temporary node. Seven EARS/content baseline files
  and the generated facade remain unchanged. Reviewed all three API report diffs.
- Final strict `npm run chain -- --strict --cores 1` passes all 30 steps in 374.6s (18 cached), run
  `2026-10-15T18-05-11Z-9023`, `/private/tmp/apack-step-chain-passing.log`. The changed integration
  subset passes nine files/375 tests. Earlier fixture/origin-identity assumptions and CLI frontend
  call sites were corrected before this accepted run.
- Committed-source strict passes again in 1.1s (29 cached), run `2026-10-15T18-11-45Z-25483`,
  `/private/tmp/apack-step-committed-strict.log`. Unrelated staged issue work remains untouched.

Next audit and finish full trigger/build metadata before expanding the remaining contribution readers.
Remaining contribution/content/asset discovery, compiler identities/input closure/frozen publication,
manual-build/drive freshness, native/editor lifecycle, entity navigation, frontend boundaries and all
three Phase 6 workstreams remain required. Finish the reconciled original-requirement/phase audit and
final committed-source strict `--all` before completion. This checkpoint closes neither discovery nor
the goal; no unfinished work is archived.


### Complete backend facet declarations — checkpoint 3C

Source `8ec5285ed` declares build/trigger data and callable membership explicitly. One SDK projection
feeds module-target validation, entry generation and host admission. Each callback is checked as an
exported function; generated entries check its signature. Relation fields, trigger tracking, persistence
and query fields are discoverable without source imports. Flow helpers no longer scan implementation
text. Trigger registration remains lazy/backend-only; execution retains accepted runtime lifetimes.
Native fixtures, authored packs, scaffolds, CLI inspection, schema, API reports and public docs agree.
Graph edge policy and relation updates use declarations even when execution providers are unavailable.

Evidence and corrections:

- Focused generation/module checks pass 124 cases; backend admission/binding checks pass 67. Three
  deliberate guard mutations catch changed metadata, missing/extra callable slots and non-function
  exports; restored source passes. Logs: `/private/tmp/apack-backend-mutation-{data,callbacks,export-kind}.log`.
- Source-free CLI inspection and trigger-helper checks pass 12 cases. Actual external authoring,
  compiler isolation and dependent flow-helper typing pass 23 integration cases, including a hyphenated
  step name with its declared camelCase track field. JSON editor completion/descriptions pass 11 cases.
- Removed aggregate-export test imports and an incomplete native trigger fixture were corrected before
  acceptance. Repository checks pass 17 cases, including unavailable-provider relation edits/edge policy.
  The full host pool passes 403 files/4,818 tests; pack pool passes 851 tests with two skips.
- The full integration pool passes 58 files/741 tests in 318.6s. Its previous 300s aggregate limit
  interrupted passing tests. At the user's request, the shared suite deadline is now 600s in both parent
  and pool runner; individual test deadlines are unchanged. All 179 focused timeout/boundary/mutation
  checks pass. No separate timeout override or new timeout class was introduced.
- Strict `npm run chain -- --strict --cores 1` passes all 30 steps in 613.7s (18 cached), run
  `2026-10-15T18-57-47Z-64986`, `/private/tmp/apack-backend-declarations-passing.log`. External app,
  smoke and packaged authoring pass. All seven EARS/content baseline files remain byte-identical;
  generated facade and reviewed schema/API reports pass their checks.
- Committed-source strict passes again in 1.1s (29 cached), run `2026-10-15T19-08-15Z-93064`,
  `/private/tmp/apack-backend-declarations-committed.log`. Unrelated staged issue and research docs
  remain outside this checkpoint.

Next required checkpoint: review and fix node-update validation/identity at the write boundary before
expanding discovery readers. A trigger's declared validator must not be silently skipped when its
provider is unavailable, and replacement during validation must prevent writes. Preserve ordinary
metadata/relation edits that require no callback; audit node-type changes explicitly.

Remaining contribution/content/asset discovery, compiler identity/input closure/frozen publication,
manual-build/drive freshness, native/editor lifecycle, entity navigation, frontend boundaries and all
three Phase 6 workstreams remain required. Complete the reconciled original-requirement/phase audit
and final strict `--all` on committed source before completion. Nothing is archived by this checkpoint.


### Node-update write eligibility — checkpoint 3D

Source `f7d63434c` closes the update-path validation gap. Node type is immutable, including attempted
changes inside a validator. Updates select a declaration/relation policy once and require an eligible
backend when that declaration includes a node validator. Creation and updates share the post-validation
owner/generation check before writes. Missing or changed declarations refuse editing; callbacks are never
silently skipped. Known declarations without a validator retain field/relation editing without activating
a provider. The flows system delegates its production updates to this SDK method; active running-flow
lookups retain their separate lifetime. Public extension guidance matches the policy.

Evidence and corrections:

- Actual registry admission/unload/replacement/declaration changes pass 18 host checks, including invalid
  updates, rejected type changes, full-node updates with unchanged type and relation edits after provider
  unload. The 17 SDK repository checks pass too. All 4,832 tests in the full 403-file host pool pass;
  shipped pack: 851 passed/two skipped.
- Four deliberate mutations are caught: removing required update validation, removing the generation
  recheck, allowing input type changes, and allowing a validator to change node type. Source restored.
  Logs: `/private/tmp/apack-node-update-mutation-{validation,generation,type,validator-type}.log`.
- The first strict run found an existing watch test exceeding its combined setup/body deadline and late
  cleanup unregistering the next test's pack. Watch setup now belongs to `beforeEach`, whose returned
  cleanup Vitest awaits before starting the next test, including after timeout. All 21 assertion lines
  are preserved; configured test/hook limits remain 60s. Both focused watch cases pass. A deliberate
  one-millisecond first-test timeout leaves the second test passing, proving cleanup isolation; source
  restored. Evidence: `/private/tmp/apack-watch-timeout-isolation.log`.
- Integration passes all 58 files/741 tests in 311s, run `2026-10-15T19-30-40Z-29547`. Concurrent source
  edits then made app validation refuse a stale shipped build; the user stashed those edits. Rebuilding
  the shipped pack from restored source resolves that operational mismatch. Unrelated work is preserved.
  This exposes a required freshness disagreement recorded in the discovery plan. The subsequent
  current-code audit below corrects its initial producer-cache diagnosis.
- Final strict `npm run chain -- --strict --cores 1` passes all 30 steps in 251.3s (25 cached), run
  `2026-10-15T19-41-55Z-58481`, `/private/tmp/apack-node-update-final-strict.log`. External-pack app,
  smoke and packaged authoring pass. All seven generated EARS/content baselines remain byte-identical
  after the restored-source rebuild. Public signatures, schemas, API reports and facade are unchanged.
- Committed-source strict passes again in 1.3s (29 cached), run `2026-10-15T19-46-26Z-64922`,
  `/private/tmp/apack-node-update-committed-strict.log`. The staged scope-loss issue remains uncommitted.

Next finish content-based source freshness within the required compiler/input/publication work,
then resume remaining contribution/content/asset readers. Compiler identity/input closure,
frozen publication, manual-build/drive freshness, native/editor lifecycle, entity navigation, frontend
boundaries and all three Phase 6 workstreams remain required. Complete the reconciled requirement/phase
audit and final strict `--all` on committed source before completion; this checkpoint archives nothing.


#### Source-freshness audit correction after 3D

Inspection proves the chain already checks output digests (`unitStaleReason`/`outputDigests`). The
observed refusal comes from `staleBuildOutput`'s mtime comparison, which can disagree with content
identity after unchanged source is restored. The initial producer-cache diagnosis is withdrawn; no
new output-hash layer is warranted. Existing integrity verifies outputs, while complete source/compiler
input identity is not yet persisted in the snapshot. Private phase caches are not that contract.

The discovery plan now owns the precise required correction and acceptance: shared complete input
identity, atomic input/output publication, content-based source consumers, timestamp/restoration and
same-mtime-change checks, real cached-chain/app preparation, and source-free installed discovery.
Complete the remaining exact compiler/closure/frozen-publication audit before choosing its produced
shape. This audit does not declare those requirements implemented or narrow any remaining goal phase.


### Generated run output and authored scope — checkpoint 3E

Source `ecbb2c6af` moves default pack E2E logs/screenshots into `.apack/tests` and driving
logs/screenshots/reports into `.apack/drive`. Authored scripts/configuration remain in place. Existing
input traversal/watch policy already excludes `.apack`, so generated runs no longer change that
scope. Helpers, CLI driving/one-shot paths, init-tests ignore scaffolding, fixture output declarations,
root/fixture ignores and public guidance agree. Explicit output overrides remain supported.

Evidence and review:

- Seven Playwright-helper cases and 38 CLI checks pass, including a public-helper filesystem test:
  screenshots, reports and runner logs preserve the authored hash; an authored edit changes it. Existing
  linked-input checks pass. Two deliberate compiled-helper mutations restoring test/drive output inside
  authored paths fail that check. Restored package bytes pass. Logs:
  `/private/tmp/apack-run-output-{focused-restored,mutation-tests,mutation-drive,types}.log`.
- A real external-pack app scenario writes a PNG and report, verifies persisted bytes/PNG format and
  expected private paths. Its focused run passes. Both fixture authored hashes remain unchanged after
  the full app suite, with real app logs under `.apack/tests`; external-pack PNG/report output also exists.
  Evidence: `/private/tmp/apack-run-output-real-app.log`,
  `/private/tmp/apack-run-output-final-input-proof.log` and captured before-run hashes in
  `/private/tmp/apack-run-output-before-final-app.json`.
- First full strict passes all 30 steps in 1034.4s, run `2026-10-15T20-01-22Z-4089`. Affected host pool:
  259 files/3,360 tests; shipped pack: 851 passed/two skipped; integration: 58 files/741 tests. Added the
  actual PNG/report scenario afterward rather than treating suites that took no screenshots as proof.
- The expanded app run found a focus-sensitive bundled-editor smoke failure (`…typ` instead of `…typed`).
  Eight instrumented runs pass without editor replacement; they do not establish the original failure's
  cause. A deterministic focus interruption reproduces the same truncation with the global keyboard
  sequence, while targeted locator input passes. The smoke test now uses `editor.fill`, preserving its
  text/error assertions and timeout. No editor component changes were made from an unproven diagnosis.
  Logs: `/private/tmp/apack-bundled-editor-{trace,focus-global-keys,focus-locator-fill}.log`.
  This does not complete keyboard behavior during contribution replacement; that remains required below.
- Final strict `npm run chain -- --strict --cores 1` passes all 30 steps in 310.6s (21 cached), run
  `2026-10-15T20-34-48Z-71715`, `/private/tmp/apack-run-output-passing-strict.log`. The affected integration
  subset passes nine files/375 tests; all 26 external-pack app scenarios, bundled UI and fork scenarios
  pass. Smoke and packaged authoring remain passing. All seven EARS/content baselines are byte-identical;
  schema, API reports, public signatures and facade are unchanged.
- Committed-source strict passes in 1.4s (29 cached), run `2026-10-15T20-42-02Z-87763`,
  `/private/tmp/apack-run-output-committed-strict.log`. Previous generated fixture logs/screenshots were
  preserved under `/private/tmp/apack-run-output-before-3e-4oo5dv65`. Unrelated staged issue work remains
  outside these commits; concurrent work continues in its separate worktree.

Next finish the inspected input-identity/publication design and implementation, then replace mtime
freshness consumers. The private output namespace is a prerequisite, not a complete source receipt,
exact loaded-compiler identity, input closure or frozen-publication solution. Keep actual typing during
accepted editor-contribution replacement in the required editor-lifecycle checks; locator-fill smoke
coverage does not prove it. Remaining contribution/content/asset discovery, navigation, frontend
boundaries, all three Phase 6 workstreams, the reconciled requirement audit and final committed-source
strict `--all` remain required. Nothing is archived by this checkpoint.


### Shared input ownership candidate and validation hold (2026-10-15)

The uncommitted candidate moves `pack-inputs.ts` unchanged from CLI into
`@apackdev/host/build/pack-inputs`, migrates every caller, moves its tests and accounts for the new
host export as tooling-only in the runtime bridge inventory. No compatibility wrapper or second scanner.
This is a layer prerequisite, not a source receipt or a replacement for `staleBuildOutput`.
The seven generated EARS/content baselines remain byte-identical.

Focused checks pass 34 CLI cases and 13 host cases (the latter includes the five input cases).
The first strict run (`2026-10-15T20-52-01Z-96286`) failed integration timing/watcher assertions during
another worktree's chain; its diagnostic retry passed all 741 cases in 311.29s. A subsequent strict run
caught the omitted tooling-only bridge inventory entry, now fixed. The next two strict runs still
failed timing/watcher assertions; the latest (`2026-10-15T21-27-51Z-90806`) failed three of 741 cases
in 451.34s. A separate single-worker run passes all 48 cases in the eight previously failing files in
405.14s, with unchanged assertions and deadlines. These are not a passing strict checkpoint; source
is held uncommitted. `--cores 2` changes chain scheduling, not Vitest's configured worker cap. The other
worktree is not a sufficient explanation: the latest run had no competing chain steps or observed
other Vitest process. Do not repeat the full gate without addressing the measured cost or another
specific diagnosed cause.

Real isolated build profiling identifies package-input hashing as 7.513s of sampled CPU across three
builds (8.718s cold, 4.442s warm, 5.471s skip-generation wall time). The TypeScript module-input scope
accounts for another 2.815s. An observer audit of one minimal pack's current package scope visits
14,316 unique files totaling 229,646,040 bytes; its owners include release-only Octokit types, LMDB,
Prettier and jsdom as well as actual compiler packages. This is evidence of an overly broad conservative
scope, not permission to drop package/type/asset or resolution coverage. Complete the required actual
compiler/input-closure audit and coherent capture/publication design; preserve current same-version
and undeclared-package invalidation behavior. No global timestamp cache or timeout relaxation.

Evidence: `/private/tmp/apack-shared-inputs-{host,cli,boundary,strict,budgeted-strict,fixed-strict,
final-strict,isolated-failures,profile,profile-scopes}.log`; CPU profiles and reproducible temporary
probe scripts are under `/private/tmp/apack-shared-inputs-profile/`. Source remains a candidate until
required strict validation passes; every later phase and all three Phase 6 workstreams remain active.


### Shared authored scope and bounded validation — checkpoint 3F (2026-10-15)

Source checkpoints `2f8b6f4ba` (worker budgets) and `882d2a50b` (shared authored input ownership) resolve
the preceding validation hold. The existing input implementation moves byte-identically into host;
all callers and tests migrate together, with the new tooling-only export accounted for at the runtime
bridge. Timestamp-only changes preserve identity; equal-sized, same-mtime edits and membership changes
do not. Seven generated EARS/content baselines remain byte-identical. Public SDK APIs, schema, facade
reports and release metadata are unchanged.

The worker fix carries the existing `--cores` cap to Vitest's actual thread/fork limits and minimums,
through private process handoff. Both cache layers and measurement guidance include the actual worker
configuration. Standalone pool defaults remain configured by Vitest. A budget above the machine does
not raise an individual pool's configured width. Removing the worker flags is caught by two regression
assertions; restored source passes 196 focused checks. Evidence:
`/private/tmp/apack-worker-budget-{mutation,restored}.log` and
`/private/tmp/apack-worker-cap-final.log`.

Validation evidence, preserving earlier failures rather than replacing their record:

- The first bounded-worker run (`2026-10-15T22-00-34Z-19299`) reports 26 completed integration files with
  no failing test cases before the 600s aggregate deadline ends it. It is not a pass. Cap semantics were
  then corrected to cap existing widths, rather than derive widths for a hypothetical smaller machine.
- Strict `npm run chain -- --strict --cores 3 --no-classify` passes in 712.9s, 22/30 cached, run
  `2026-10-15T22-17-32Z-40198`. The affected host pool passes 413 files / 4,965 cases; default-setup passes
  115 files / 851 cases with two skips; integration passes all 58 files / 741 cases in 496.85s.
  `/private/tmp/apack-shared-inputs-cap-strict.log`.
- The same command on committed source passes in 1.1s, 29/30 cached, run
  `2026-10-15T22-30-09Z-69716`. `/private/tmp/apack-shared-inputs-committed-strict.log`.
- Live process inspection confirms explicit worker flags; no assertion, test/hook/watcher deadline,
  aggregate timeout, source-input scope or phase guard was weakened. The unrelated staged issue is
  preserved. No production data, release operation or remote Git operation.

The compiler-package graph prototype was measured and discarded: small gains did not justify its
remaining implicit-read gaps. Static inspection also corrects the earlier “release-only” wording:
Octokit is currently imported indirectly by compiler utilities through app-selection code. It cannot
simply be excluded. The original conservative package-input policy remains; source freshness and exact
compiler capture are unfinished, not completed by a worker-count change.

Continue the full input/actual-compiler/coherent-publication design and implementation, then migrate
archive, prebuilt testing, default-fork preparation and drive to its common passive authority. Preserve
manual builds, unchanged deterministic output caching, source-free installed inspection and deliberately
stale drive behavior. The local filesystem-generation probe is research evidence only, not an accepted
replacement for frozen/coherent execution. Remaining contribution/content/asset discovery, native/editor
lifecycle, navigation, frontend boundaries, all three Phase 6 workstreams, reconciled requirement audit
and final committed-source strict `--all` remain required. Nothing is archived by this checkpoint.

### Captured compiler installation candidate (2026-10-15)

The current uncommitted implementation replaces live compiler execution in public build/dev/watch and
release verification with a private copy of the selected distributable worker. One host-owned package
graph supplies hashing, watch probes, byte copying and verification. It records physical file/link
origins, dependency lookup edges, executable bits and empty/dangling membership without activation;
root contents are explicit and dependency names retain own keys such as `__proto__`. Copies preserve
workspace/file/metadata links and cycles. Global Node dependencies bind to captured packages. Workers
bypass project hand-off, and disposal waits for child close, including abort failures. The source
checkpoint still requires strict validation and review before commit.

Evidence so far:

- 53 focused cases pass across graph/source traversal, export policy, compiler copies, checkout freshness
  and public/private handoff. NODE_PATH execution succeeds after deleting the original global dependency.
  Linked metadata and dangling links have separate restored checks.
- Disabling copy verification or the worker handoff rule causes its behavior test to fail; both guards
  are restored. `/private/tmp/apack-compiler-mutation-{copy-verification,worker-handoff}.log`.
- 32 integration cases pass for build/dev/abort and isolated release verification fixtures.
  `/private/tmp/apack-compiler-installation-integration.log`. No real publishing/version operation.
- A real frontend build reports live source inputs after its compiler copy is removed. The fixture's
  explicit `.ts` import and generated default export were corrected before this pass.
  `/private/tmp/apack-compiler-watch-inputs-restored.log`. Diagnostic source-path assertions are included
  in the pending strict run. CLI typecheck passes; seven default-pack baselines remain to recheck there.
- Initial graph/capture measurements are 2.822s / 5.341s, 292 packages / 12,315 files, before directory
  creation deduplication. These are observations, not thresholds or a claim that conservative scan cost
  is fixed. `/private/tmp/apack-compiler-installation-profile.log`.

This prerequisite does not complete frozen pack/external inputs, ambient Node loader/options or the
long-lived frontend compiler boundary. Whole-build input/output association, the passive receipt and
archive/prebuilt/default-fork/drive migration remain required before a freshness-reader switch. All
remaining contribution kinds, navigation, frontend boundaries, three Phase 6 streams, reconciled audit
and final strict committed-source `--all` remain in this active goal. Nothing is archived.

Candidate review found and fixed a temporary-path cache regression before commit. The first strict run
was intentionally interrupted (exit 130) after its passing build/type/schema/lint legs: TypeScript
standard-library names contained the compiler copy's random prefix. No passing full gate is claimed.
Private captured/source origin mappings now serve module identity, sort order, reads and frontend
subscription reporting without changing the bytes read. Conflicting live/captured source contents
refuse. Both new guards have failing mutation evidence and restored focused passes. Two real public
builds preserve the facade phase stamp and complete output revision; the second actually reuses its
facade. `/private/tmp/apack-compiler-repeat-build.log`. The interrupted log is preserved at
`/private/tmp/apack-compiler-installation-strict.log`. Final checkpoint validation remains required.


Strict feedback is preserved: run `2026-10-15T23-44-12Z-95602` failed seven watched-build cases in four
files (735 integration cases passed) after 1064s. The previous compiler candidate is not committed or
called validated. The source stayed fixed throughout. The build:default-setup output-change warning
remains required freshness work, not a reason to patch the mtime consumer in isolation.

Measured correction: a private worker spends about 4.945s in package-input scans, and recreating/deleting
its compiler on every edit adds material work. A native-path experiment has no meaningful warm gain
and is discarded. One pack builder now owns, verifies and reuses its compiler copy while creating a
fresh worker process for every build. Immutable compiler inputs carry a checked fingerprint; pack and
outside inputs retain their publication checks. Watch close aborts/drains before disposal. The two
isolated module-watch cases improve from 40.444s / 48.322s to 27.453s / 32.984s; the original timing
assertions and full input scope remain. `/private/tmp/apack-compiler-session-watch.log`. Focused tests
and CLI typecheck pass; remaining watched scenarios and strict validation remain pending. All larger
input/publication, discovery and later-phase requirements above are unchanged.

Scoped compiler follow-up evidence: all 13 cases in the four failing watch files pass with one worker
(290.12s) and with three workers (179.78s). The latter overlaps the separate one-worker protocol run,
which passes six real build/dev cases in 84.06s; no timing limit or assertion changed. The immutable
compiler fingerprint now comes from a private input record required by workers before importing the
compiler, and source inspections remain independent. A raw source worker with IPC, with absent or
unrelated input metadata, refuses in two real process checks. Two real-process builder cases prove
same-input reuse, fresh processes, changed-input refresh, damaged-copy repair, close rejection and
worker-before-disposal ordering. Public `pack build --watch` signal shutdown removes its retained
compiler (17.835s including initial build); CLI typecheck passes. Evidence:
`/private/tmp/apack-compiler-session-watch{,-three}.log`,
`/private/tmp/apack-compiler-session-worker.log`, `/private/tmp/apack-builder-lifecycle.log`,
`/private/tmp/apack-worker-input-refusals.log`, `/private/tmp/apack-public-watch-shutdown.log`.
The final strict checkpoint remains pending; source is still uncommitted.

Run `2026-10-16T00-50-42Z-42427` stops on one host-pool inventory check: the public SIGTERM cleanup
case adds a third necessary subprocess site to build-worker.integration. Its inventory now records
that process and why an in-process signal test cannot prove the behavior. The 11-case inventory suite
passes. The run's 3,281 other host cases and package/external authoring checks pass; integration had
not run, so this remains an incomplete strict gate. `/private/tmp/apack-compiler-session-strict.log` and
`/private/tmp/apack-compiler-subprocess-inventory.log`. No timing assertion or input scope changed.


Run `2026-10-16T00-57-18Z-53171` fails the integration gate: external contract watch hits its
60s test limit, then the complete pool hits its 600s aggregate budget (602s including cleanup;
782.3s root run). Fifty-four integration files finish, with one test failure; this is not a passing
gate. `/private/tmp/apack-compiler-checkpoint-strict.log`. The seven EARS/content baselines remain
byte-identical. The other worktree's chain was observed during subsequent focused retries, starting
after this strict run ended; that observation does not explain the original strict failure.

A fixture experiment removing its frontend surface fails the existing generated-contract assertion;
the surface is necessary and the experiment is fully reverted. No test assertion or deadline changed.
The retained optimization instead reuses resolved directory paths while scanning ordinary files;
file symlinks still resolve explicitly. Interleaved warm scans preserve the entire normalized graph
and hash across all 292 compiler packages, improving from 997–1019ms to 663–682ms. The first cold
comparison is excluded from that claim. `/private/tmp/apack-package-input-directory-path-comparison.log`.
All 19 package-input cases and 28 compiler-copy/module/worker/builder cases pass. A subsequent watch
retry includes linked workspace rebuilds and reaches its test limit; warm watch and strict validation
remain required. Evidence: `/private/tmp/apack-package-directory-path-tests.log`,
`/private/tmp/apack-compiler-directory-paths-focus.log`,
`/private/tmp/apack-external-watch-directory-paths.log`. Source remains uncommitted.


The warm watch retry also times out: `/private/tmp/apack-external-watch-directory-paths-warm.log`.
During that retry, process inspection shows the separate `claude-code-research` worktree's chain and
integration workers active. At approximately 2026-10-16 01:20 UTC the machine reports load average
105.93 and 21,560.56 MB of swap in use. This establishes contention during the retries, not the cause
of the earlier strict failure. No other session's process is stopped or output/dependencies changed.
Do not start another broad gate under that observed load; validate the original watch sequence and
strict checkpoint when resources settle. Host typechecking passes at
`/private/tmp/apack-package-directory-path-typecheck.log`. Source remains a candidate, uncommitted;
no acceptance assertion, timer or input scope was relaxed. All remaining goal scope stays active.


Low-cost review under continuing contention adds a physical-origin regression: ordinary files and
file links beneath an external directory link retain the same actual source, bytes and executable
bits; retargeting to an otherwise identical tree changes input identity. All 20 graph cases pass.
Removing explicit file-link resolution fails that new case; the guard is restored and the full file
passes again. `/private/tmp/apack-package-directory-links-{tests,restored}.log` and
`/private/tmp/apack-package-directory-link-mutation.log`. No broad retry is launched under the observed
load. This strengthens the compiler candidate's evidence; strict checkpoint acceptance is still pending.


The competing chain and integration workers are confirmed absent before the next focused watch run.
The original external-contract sequence then passes in 49.604s (51.53s runner), preserving every
assertion, its frontend and its 60s test/20s publication limits.
`/private/tmp/apack-external-watch-directory-paths-uncontended.log`. This demonstrates recovery after
contention clears, not that the earlier strict failure was exclusively environmental. Re-run the full
strict candidate with four workers to reduce aggregate wall time; deadlines and input scopes stay fixed.


Strict run `2026-10-16T01-26-42Z-16895` is terminal: 526.8s, 27 steps (one cached). It passes runtime,
external-pack contract, external-pack app/replacement and packaged-authoring/app checks, but fails
smoke worker teardown after all five smoke assertions pass. The existing 60s Electron teardown limit
expires; this resembles the independently recorded native lifecycle symptom, without proving its cause.
The host/pack/integration pools had not started before the failure, so no full acceptance is claimed.
The other worktree starts another chain during this run. The user subsequently pauses it to allow
uncontended checkpoint validation. `/private/tmp/apack-compiler-directory-paths-strict.log`.

Failure inspection finds a concrete omission from generated-run-output checkpoint 3E: the root
Playwright config delegates `definePackE2EConfig`, so it also writes `.apack/tests/results`, but the
chain still declares/preserves `tests/results`. That run therefore preserves stale logs. The chain's
smoke/full-E2E output and failure declarations, evidence fixture and current E2E guidance now agree
with the actual config. A new cross-owner check imports that config and compares both declarations;
restoring the wrong path fails it. All 61 graph/evidence cases pass before and after the restored
mutation. `/private/tmp/apack-root-e2e-output-{declarations,mutation,restored}.log`. No timeout,
assertion, shutdown behavior, output-checksum guard or source-input scope is weakened. Strict validation
is required on the corrected candidate before a source commit.


The first corrected strict run is intentionally interrupted with exit 130 before its test pools,
after review identifies that the evidence spec itself writes its probe into the real Playwright
output. The process is verified by PID, checkout cwd and both log descriptors before interrupting;
no other session is signaled. `/private/tmp/apack-compiler-output-paths-strict.log`.
The spec now creates/removes a unique fixture directory under `.apack`, preserving repo-relative-copy
coverage without racing or modifying live app output. All 61 graph/evidence checks pass on that
correction. `/private/tmp/apack-root-e2e-isolated-evidence.log`. The user has paused the other agent;
notify them as soon as the next strict validation run ends so that work can resume.


Run `2026-10-16T01-40-36Z-60262` finishes all 30 gates and fails only integration: 674.8s root,
404.76s integration, 57 files / 742 tests pass and one public-watch shutdown case exceeds its 2s
bound. Host and pack pools, smoke (including teardown), external app and all reached contract checks
pass. The user is told the app gates are finished and the other agent may resume; no further exclusive
validation window is assumed. `/private/tmp/apack-compiler-isolated-evidence-strict.log`.

The compiler owner previously unlocked and recursively removed its whole read-only tree synchronously.
Disposal is now asynchronous filesystem work, awaited by capture failure, replacement and close; the
factory and every caller/fixture use its promise directly. One local observation is 1.132s synchronous
versus 0.791s asynchronous disposal, not a performance guarantee. Ten focused lifecycle/copy cases and
CLI typechecking pass. Removing the await from builder close fails both real-process lifecycle cases;
restored source passes. The seven real public/private/dev worker cases pass in 65.45s, including the
unchanged 2s public shutdown guard (13.439s including startup). No deadline, assertion or input scope
changed. Evidence: `/private/tmp/apack-compiler-{sync-disposal,async-disposal-profile}.log`,
`/private/tmp/apack-compiler-async-disposal-{focus,restored,typecheck,worker}.log`,
`/private/tmp/apack-compiler-await-disposal-mutation.log`.

The remaining producer-lifetime audit must include signals during startup and one-shot commands, not
only the retained watcher's ready state exercised here: its public signal handlers currently install
after startup returns. Keep that acceptance in the required complete build-session/input-publication
work before source-freshness consumer migration. Ambient runtime options, long-lived development
frontend compilation, frozen pack/external inputs, the whole-build source receipt and all later phases
remain required; this compiler checkpoint completes none of those by implication.


Run `2026-10-16T02-02-32Z-93764` fails integration in 443.72s (754.7s root): 56 files / 741 tests
pass, public watch cleanup exceeds 2s and CSS recovery exceeds the combined test's 60s budget.
`/private/tmp/apack-compiler-async-disposal-strict.log`. The asynchronous change's isolated pass did
not prove full-pool acceptance. No passing strict gate is claimed from that run.

Diagnostic tracing then passes all 17 selected concurrent watch/worker cases. The public process
receives SIGTERM immediately, spends 206ms unlocking directories and 1.201s deleting its complete
compiler tree, then re-raises SIGTERM after deletion. This is ordinary filesystem work with limited
headroom in a 2s IPC waiter, not evidence of a missed signal or a cleanup hang. The new public-watch
shutdown/cleanup waits now use the existing 20s filesystem-operation budget; IPC-only exit guards
remain 2s and the whole test remains 60s. This corrects the candidate test's timing assumption; it is
not a claim of a product shutdown latency guarantee. No cleanup/leak assertion is removed.
`/private/tmp/apack-watch-stop-traced-focus.log` and `/private/tmp/apack-watch-stop-trace.log`.

CSS watcher startup and teardown now belong to beforeEach/afterEach. The startup promise remains
owned even before it returns a handle, and teardown completes before the outer fixture deletes data.
Its transition/assertion body is preserved verbatim, all 20s publication waits and 60s test/hook limits
remain; startup now has its fixture-hook allowance rather than sharing the scenario's test clock.
This is a lifecycle/budget correction, not a build-speed claim. All 17 uninstrumented concurrent cases
pass in 117.08s; CLI typechecking passes. Forcing only the CSS body to time out at 1ms produces the
expected failing test while tracing proves compiler removal ends before fixture deletion begins.
`/private/tmp/apack-watch-fixture-{concurrent,typecheck,forced-timeout}.log` and
`/private/tmp/apack-watch-fixture-timeout-trace.log`. Full strict validation is still required before
committing. Full build-session lifetime/input/publication and all later goal phases remain required.


Run `2026-10-16T02-28-45Z-34610` fails integration (602.9s root, 382.77s integration):
741 tests pass and two fail. The public-watch case observes a leaked compiler after process exit;
the publication refusal case sees no error within its 20s limit. Neither is accepted as a passing gate.
`/private/tmp/apack-compiler-reviewed-strict.log`.

The public watcher now owns SIGINT/SIGTERM before startup begins. Its abort signal reaches initial
compilation and the returned watcher; shutdown awaits worker exit and compiler disposal before
re-raising the signal. Both ready and compiling phases have real public-process coverage. Moving
signal-handler registration back after startup makes the compiling case fail on the leaked compiler;
restored source passes both cases. `/private/tmp/apack-watch-startup-signal-{mutation,restored}.log`.
This covers public watch startup, not one-shot/dev startup or the remaining full build-session work.

The diagnostic concurrent run passes all 18 worker/publication/frontend cases in 129.29s. Its trace
records the invalid lifecycle edit arriving at the watcher, worker startup about 5s later and refusal
about 2s after that. It does not reproduce or explain the earlier missing-error deadline; the 20s
assertion is unchanged and full strict acceptance remains required.
`/private/tmp/apack-watch-publication-events-focus.log` and
`/private/tmp/apack-watch-publication-events.log`. The other agent may run in its independent worktree;
no exclusive validation window is assumed. The complete goal and remaining build-session scope stay open.


### Flow-reference discovery checkpoint (2026-10-16)

Source: `7196d61d3`. `extensions.steps.<type>.dsl.references` maps fields to content keys. Codegen
carries it into build definitions, not executable frontend/backend registrations. Flow compilation
projects trigger fields, nested branch fields and computed targets without evaluating target values.
The verified index rejects unknown reference sources and malformed identities. `apack pack info`
inspects it without importing authored modules; `findContentDependents` supports known incoming-edge
review after a rename/removal. Missing indexed targets remain inspection findings, not a claim that a
runtime database record is absent. Existing flow validation is unchanged.

Evidence: 86 focused SDK/CLI cases passed in 5.72s, covering actual content compilation, unchanged
compiled records/hashes, custom/nested/computed references, renamed targets, invalid indexes,
build-only codegen, and source-free offline inspection. SDK/CLI typechecks, lint, import checks,
generated schema and all 28 SDK API reports pass. The report also normalizes generated field ordering
for existing feature references; no feature-reference contract changed. A real shipped-pack build
passes; verified output contains 76 flow references, all indexed. Logs:
`/private/tmp/apack-content-references-{final-focused,compiler,types,cli-types,lint,specifiers,schema,api-check,default-build,published}.log`.

No broad diagnostic suite was run for this independent slice. Generic inventory/readers, all-kind discovery acceptance, B1–B6 and the final committed-source strict `--all`
gate remain required. This checkpoint closes none of those outstanding acceptance items.


### Catalog navigation checkpoint and scope correction (2026-10-16)

Source: `cfcbb53f9`. The toolbar, its visibility menu and directional keyboard selection now project
metadata from the common catalog, independent of frontend delivery. Labels, pinning, default visibility
and order are declarative; user choices override defaults, native host tabs follow pack tabs within
pinned/unpinned groups, and source/disabled owners are omitted from app destinations. Only current
accepted bindings supply icons; the shell supplies a placeholder beforehand. Active components,
actors, request queues and readiness remain execution responsibilities. The renderer subscribes to
catalog changes with scope-owned cleanup rather than storing another surface inventory.

Backend visibility defaults now also read the catalog before runtime registration. The duplicate
`PackFeatureSurface.defaultVisible`, generated backend copy, binding comparison and active-only visible
surface selector are removed. Schema authors still declare `features.<id>.surface.defaultVisible` once.
The SDK framework API report and in-tree native/installed/pack tests match the contract.

Evidence: 111 focused host/SDK cases (5.53s), 167 additional host/SDK cases including installed loader
and real generated TypeScript compilation (18.19s), final pinned-order projection check, and five
real shipped-pack settings consumer cases (2.91s) pass. Host/SDK and renderer app/test typechecks,
lint/import/tier checks and the SDK API report pass. The actual shipped pack rebuild passes.
Logs: `/private/tmp/apack-surface-navigation-{focused,final-focused,pinning,pack-consumer,host-types,sdk-types,renderer-types,renderer-tests-types,lint,specifiers,tiers,api,default-build}.log`.
The shared shell-state fake is now fresh per test; the prior file retained another test's declared pack.
Final real-window, all-kind and strict acceptance remain outstanding; no broad diagnostic gate rerun.

The previous handoff added arbitrary action/prompt JavaScript-body analysis without a requirement.
The original restored scope requires static **flow-to-action** relationships (discovery plan,
“Restored manifest requirements and handoff”), which `7196d61d3` publishes. Service calls inside
bodies use pack-owned APIs; hardcoding those into the SDK would violate their ownership. The live
handoff is corrected, not treated as a new user exclusion. Static analysis remains explicitly
non-exhaustive and unavailable for unsupported compilers. Every original phase requirement remains.

Inventory audit: `apack pack info` reads the verified content index offline. `previewPackContent`
checks registered appliers because its specific job is showing what an actual import can write; it is
not the discovery inventory and its eligibility check stays. Unwritten datasets have counts without
invented database item identities. Next audit service/repository/event/native/static-asset metadata
and actual CLI inspection gaps before final all-kind acceptance. Loader extraction, B1–B6, entity
navigation, boundaries, all Phase 6 streams and final committed-source strict `--all` remain required.


### Complete CLI declaration inspection (2026-10-16)

Source: `a13c4c6e4`. Inspection exposed a real omission: the selected service-name list read only
`extensions.services`, dropping feature-owned services. Rather than maintain another hand-selected
inventory, `info --json` now returns the full validated manifest under `declared`, preserving its keyed
maps, ownership, targets, metadata and future declared fields. Human output lists feature-owned
systems/services/repositories/reference identities, extension kinds, lifecycle/migrations, entity owners,
relations and content keys. Verified build/content status stays separate from authored declarations.
There are no aliases or parallel old projections. Public docs and all in-tree typed inspection callers
use the complete keyed declaration.

Thirteen focused inspection checks pass (1.86s), including full JSON equality, unavailable authored
modules, poisoned executable runtime, feature-owned service/repository listing, stale/invalid output
and compiled-reference diagnostics. CLI typecheck and lint pass. Logs:
`/private/tmp/apack-info-declarations-{focused,types,lint}.log`. The own-key/editor real-build fixtures'
inspection assertions are migrated and typechecked; those unchanged compiler paths were not rebuilt
again for this reporting change. Their final all-kind execution remains required.

Next: field-by-field native/service/repository/event/static-asset coverage and loader coordination.
Do not treat full manifest output as proof that a compiled event contract or native binding has its
required discoverable data. All original phases, build-input/freshness and final strict acceptance
remain active.


### Native API ownership (2026-10-16)

Source `506582b94` adds keyed service/repository targets to native declarations, at feature ownership
or native pack scope for unowned APIs. Metadata is admitted before executable registration and survives
runtime unload. A shared checker validates native/authored API names and feature service membership;
shared schema validation names competing owners before activation. Native fixture composition records
these names before binding; direct replacement fixtures explicitly declare their changed API inventory.
These references identify native composition bindings, not modules discovery may import. This does not
complete method-contract consumption or system/event discovery. In particular the shell's native
application inbox must not be modeled as an invented toolbar surface to satisfy a schema.

Validation: 124 initial host cases pass; SDK native/browser-schema and codegen-shape cases pass;
all nine native API cases pass, including failed admission retention, unloaded metadata and methods
that must not execute. Disabling native API admission causes the missing-service assertion to fail;
source was restored. The host packs sweep passed 619 cases and exposed 14 undeclared replacement
fixture cases plus four OS-uptime sandbox failures. Migrated replacement tests pass all 14; the two
OS-dependent files pass all 17 with normal access. No full sweep was repeated for reassurance.
Host/SDK types, schema, 28 SDK API reports, lint/import/tier checks and package builds pass.
Logs: `/private/tmp/apack-native-apis-{focused,contracts,guards,mutation,pack-registry,replacement,filesystem,host-types,sdk-types,types,schema,api-check,lint,specifiers,tiers,packages}.log`.
The mutation driver's extra wording assertion was too specific; the preserved Vitest result proves
failure at the expected missing-service assertion and the source restoration was verified.
All-kind, real-window and final committed-source strict acceptance remain open. Continue the live
ledger's system/event/native/static-asset and loader work, then the unchanged later phases.


### Historical discovery checkpoint evidence

Current discovery checkpoint: catalog-driven Monaco consumers and lifetime cleanup in `39e48e66e`
plus explicit-selection correction `eb7d0995b`,
following producer/catalog `8ed188046`. SDK DSL readers select static owned declarations without
consulting executable frontends. Monaco shares module/global libraries per instance, language and DSL,
follows catalog text changes and disposes handles/subscriptions when their last consumer leaves.
UnifiedMonacoEditor owns its active file's release function; direct consumers receive one from
`setupMonacoForFile`. Explicit DSL selection works without a prefix; path inference uses the unique
longest nonempty prefix among declared Monaco targets. Disabled packs retain static assistance;
unbuilt or ambiguous owners cannot supply compiled completions.

Removed the frontend DSL registration/type/lookup/store and capture/checking branches, generated raw
import module, and Vite staged-definition resolver/option. The removed resolver's isolated test described
a contract that no longer exists; producer completeness/publication and snapshot tests own that data
boundary. The five-build publication case retains its coverage, with frontend assertions updated to
require type text remain outside frontend code. Schema assistance and public/reference/package docs
now describe the data contract and cleanup ownership. SDK reports remove runtime fields and add the
four data readers; UI report adds explicit DSL selection and the setup release return type.

Evidence: 128 focused SDK/host/UI/renderer cases pass; generation/library checks pass (5 cases), as do boundary,
export and import-side-effect checks (14 cases). A real TypeScript
language service proves catalog text changes completions, unavailable text removes them, and one of
two consumers closing does not dispose the other's libraries. Final prefix review includes targetless
and empty/ambiguous/longest-prefix cases. Public setup API review caught an untitled-file wiring gap:
`eb7d0995b` makes explicit DSL selection take precedence in language inference, preserves a caller's
explicit language, and verifies completions and release through that public function (3 library cases). Two full real builds pass (36.89s), preserving compiled text
and revision through reuse and source-free disabled installed discovery without activation. The full
shipped pack rebuild passes, removes the obsolete generated DSL file and retains three snapshot type
bundles without embedding action definitions in its frontend. Fifteen real pack consumer cases pass.
Host/SDK/UI/CLI, renderer app/test and default-setup types, schema, 28 SDK / 102 UI API reports,
import rules, lint and tiers pass. The final inference fixes are covered by focused prefix/public-setup cases and the UI package is
refreshed; they do not change the checked public signatures.
`/private/tmp/apack-dsl-readers-{focused,generation,boundaries,prefix-review,explicit-selection,full-build,default-build,pack-tests,host-types,sdk-types,ui-types,cli-types,renderer-types,renderer-test-types,pack-types,schema-check,sdk-api-check,ui-api-check,specifiers,lint,final-lint,tiers}.log`.

Flow-reference inspection is implemented in `7196d61d3`: step declarations name reference fields;
build-only definitions project literal/computed targets and nested branches into the verified content
index. Offline CLI inspection reports indexed/not-indexed/dynamic targets, and SDK helpers find known
incoming references for rename/removal review. Compiled records and hashes are unchanged.

Navigation metadata is implemented in `cfcbb53f9`, and complete CLI declaration inspection in
`a13c4c6e4`. Native API ownership/admission is implemented in `506582b94`. Next finish system/event and other
native/static-asset coverage and loader ownership. The required static
flow-to-action edges are published; arbitrary JavaScript body analysis is not required by this plan.
Pack-defined service calls must not become hardcoded SDK dependency rules. Unsupported analyzers
remain explicitly unavailable, and compiled inventory is not user data. Navigation menu ordering/visibility, remaining
native/service/repository/event/static-asset coverage and all-kind discovery acceptance still remain.
The DSL implementation needs final real Monaco worker/cold-document/window acceptance; the focused
language-service proof does not replace it. Keep the existing five-build 60-second timeout evidence at
B6; no broad diagnostic rerun or deadline relaxation was made here. B1–B6, entity navigation, frontend
boundaries, all three Phase 6 streams and final committed-source strict `--all` stay required.

Earlier producer checkpoint: compiled DSL publication/catalog in `8ed188046`.
The builder copies every declared Monaco target's staged definition text into `snapshot.dslDefinitions`,
including targets without globals and cached definition phases. Snapshot/dependency readers and native
composition require the exact declared target set through one validator. Host and window project the
same immutable DSL metadata/text, with owner, enablement and available declaration/build identity.
Unbuilt sources expose metadata without claiming compiled text. Snapshot format/version stamps and
release metadata are unchanged. Public build docs and the two SDK API reports match this contract.

Evidence: 96 focused snapshot/native/generator/window cases pass; 20 installed catalog cases include a
sealed disabled pack with poisoned runtimes and absent authored modules. Frontend admission/binding
checks also passed with explicit native compiled data. The two-real-build backend-only proof passes
(41.59s): a target without globals publishes text, a source-free disabled installed copy exposes it
without activation, and cache reuse preserves both text and build revision. Full default-setup build
passes and its snapshot contains action, prompt and database definitions. SDK/host/CLI, renderer test
and default-setup typechecks, schema assistance, all 28 SDK API reports, lint/import rules and tiers
pass. Reviewed reports add only the new snapshot/native field and DSL catalog types/accessor.
`/private/tmp/apack-dsl-catalog-{converged,installed,focused,snapshot-build,default-build,sdk-types,host-types,cli-types,renderer-types,pack-types,schema,api-check,lint,specifiers,tiers}.log`.

Required acceptance still open: the existing five-build `staged-dsl.integration.spec.ts` reached its
unchanged 60-second case limit during the fourth (reuse) build. Its initial publication, intentional
runtime-failure retention and repaired publication completed, including the new snapshot assertions;
full frontend reuse/removal did not finish. Preserve `/private/tmp/apack-dsl-catalog-build.log` and the
case at B6. The focused backend-only proof does not replace this case or establish full acceptance.
The original case's deadline, assertions and coverage were not relaxed. No broad diagnostic rerun
was made.

The producer checkpoint's consumer migration is implemented by `39e48e66e`; its broad acceptance
limits and recorded staged-build failure remain as stated above.

Earlier shell checkpoint: shell default selection and new-request dispatch in `69860e4be`.
The host and window share surface metadata projection, including build identity. The window receives
local native host declarations before backend connection. Accepted frontend surface bindings carry
captured declaration/build/runtime identity; the obsolete first-registered-default table and SDK
lookup are removed. Default claims are selected before imports: enabled native owners first, then
installed owners, ordered by fully qualified ref in English lexical order. Saved/popout/explicit
selection takes precedence. Defaults render only after their actors are admitted.

Unknown destinations refuse as soon as declarations are ready; disabled/source/unavailable owners
have specific refusals. Known providers may wait for real actors. Catalog changes reconcile frontends
that arrived ahead of their frame without a duplicate pending inventory; stale load completions and
new requests targeting an incumbent actor after binding replacement are refused. Request correlation
and sender diagnostics remain intact, and shell stop releases the catalog subscription. Host Settings
remains reachable during loading/disconnection through its native declaration and binding.

Evidence: the affected combined host/renderer run passed 154 cases; the final shell/catalog/registry
rerun passed 115 cases after the additional replacement-gap case and final startup selection changes.
Two real pack harness/navigation cases pass. Host, SDK, testing, renderer app/test and default-setup
typechecks, all 28 SDK API reports, lint/import rules and test tiers pass. The report removes only the
obsolete default lookup. Test fixtures now supply declaration authority and accepted bindings instead
of injecting an unadmitted loaded surface. The first API report attempt correctly refused stale dependent
packages after a shell edit; refreshing packages then generating/checking reports passed.
`/private/tmp/apack-shell-catalog-{final-tests,converged,final-shell,navigation,pack-tests,types,sdk-types,testing-types,renderer-types,renderer-test-types,pack-types,api-check,lint,specifiers,tiers}.log`.

The shell checkpoint leaves navigation menu inventory, ordering/visibility and loader coordination
cleanup in Phase 3. Its remaining-work statement is historical; the current next action is above.

Earlier viewer checkpoint: block/artifact readers and checked frontend bindings in `a278d4116`,
following metadata publication in `3e4e10c8f`. Accepted bindings carry owner, declaration, build and
runtime identity. Shared selection and eligibility checks reject ambiguous, disabled, source-only,
disconnected or mismatched providers. Native bindings have no fabricated installed identity stamps.
Artifact icons and block input-kind now come from declarations; viewer/input components come from
matching accepted bindings. Scoped readers follow both publication streams and release subscriptions.
Already-mounted views follow replacement and disablement. Backend transcript callbacks retain their
execution lifetime. Public extension docs and the two affected SDK API reports describe the new readers.

Evidence: 99 focused host/SDK cases pass across viewer readers, frontend admission/declaration binding,
registered lookups and step readers. Forty-five affected real pack cases pass, including two new mounted
artifact/block cases and existing step/reference consumers. SDK, host, testing, renderer application/test
and default-setup typechecks pass; all 28 SDK API reports, lint, import rules and test tiers pass.
The package typecheck also caught four pack test catalog fixtures omitted from the preceding publication
checkpoint; this checkpoint supplies their required artifact/block accessors.
`/private/tmp/apack-viewer-readers-{focused,new,ui,ui-final,host-types,sdk-types,pack-types,testing-types,renderer-types,renderer-test-types,api-check,lint,test-lint,specifiers,tiers}.log`.
The first new test attempts exposed fixture errors (a non-exported test cleanup import and an unaddressed
saved response), corrected before the passing runs. No product response routing was changed.

The viewer checkpoint leaves active low-level runtime lookup lifetimes intact. Its remaining
backend/native-field and superseded-reader audit belongs to Phase 3; it does not complete B1–B6 or
later phases.

Slash-command discovery is checkpointed in `ff48438cd`. The common catalog owns metadata and stable
admission order; the execution picker requires enabled declarations matching accepted runtime identities,
including build revisions. Native commands use the shared schema and checked binding. The runtime
command store and its superseded store tests are removed; active-claim collision validation remains
transactional. Chat owns a catalog subscription through its callback actor, while library-document
notifications and user.command flow dispatch retain their existing paths.

Evidence: all 628 host pack cases are accounted for (624 passed in the normal run; four OS-uptime EPERM
failures passed with their two suites outside the sandbox, 17 cases total). The real default-pack command
suite passes all 19 cases, including catalog-only refresh without SEND_STATE and stopping updates after
actor stop. Native/authored/source metadata, poisoned source-free installed inspection, inactive/stale
picker exclusion, returned-data ownership, stable replacement order and collisions are covered.
Host/SDK/default-pack typechecks, schema, 28 SDK API reports, facade check, lint, import rules and test tiers
pass. Generated report diffs contain only native command schema/type additions and the service's updated
catalog-order documentation. Logs: `/private/tmp/apack-command-catalog-{all-packs,os-cases,pack,final-types,schema,api-check,facade-check,specifiers,tiers}.log`.
This independent reader migration does not claim a new passing broad/strict gate or close B1–B6;
preserved build/watch/frontend/teardown acceptance and final committed-source strict --all remain open.


### Frontend failure boundaries (2026-10-16)

Source `713a6c1fd` scopes contributed canvas/panel/chat/form Vue errors to their pane in both main and
popout windows. Host settings state and controls remain outside custom forms. Accepted frontend
instance identity changes on replacement, including reused components; failed candidates retain the
incumbent identity. Retry checks current catalog/build/instance and view ownership directly, including
retirement before notification. Native host failures retain the host handler. Attributed nonfatal error
reports no longer become fatal merely because their log level is error. Removed the superseded custom
form revision subscription. The fixture manifest was written with the canonical writer.

Evidence: 32 focused Vue/host/error/lifetime checks pass (2.78s). Twenty-six settings/layout/resource
regressions passed; the three form cases needed native owner metadata in their test catalog, then pass
(2.53s). Host/main/renderer app/test and fixture types, lint/import/tier checks pass. The real app and
fixture builds pass. One external-pack Electron case passes (6.2s), proving canvas and panel containment,
canvas retry, form failure, usable host settings and unchanged feature defaults in Settings JSON.
Disabling the retired-instance retry guard fails its targeted assertion; exact source restored.
Logs: `/private/tmp/apack-pane-boundaries-{focused,settings-regressions,settings-forms,host-types,main-types,renderer,renderer-tests,fixture-types,lint,specifiers,tiers,runtime-build,fixture-build,electron,mutation}.log`.
Phase 5 implementation/local acceptance is closed; whole-goal committed-source strict acceptance is
still required. The live handoff above owns the next action.


### Entity destination producer (2026-10-16)

Source `94148c9e0` reads literal `Contract.opens` types without module execution, refuses unknown
entities and competing local features, and publishes the generated JSON map through captured build
inputs into required snapshot data. SDK, own and dependency entities remain distinct from destination
ownership. All handcrafted snapshots now supply the current map; no fallback or format-stamp change.
The external fixture claims `Memo`; its real sealed build contains `{ "Memo": "memos" }`. The installed
catalog fixture retains `Action` destination data while disabled, source-free and runtime-poisoned.

Evidence: the initial generator/reader run passed 253 of 254 cases; its expected snapshot-field inventory
was updated, and all 105 affected reader/generator cases pass. Catalog/layout/cache/CLI consumer checks
pass 153 cases; the extended source-free catalog suite passes 20. SDK/CLI/host and external-fixture types,
schema, all 28 SDK API reports, import/tier checks and real shipped/external builds pass. Removing the
collision guard makes the specific rejection assertion fail; exact source bytes were restored.
Logs: `/private/tmp/apack-entity-producer-{focused,corrected,consumers,source-free,mutation,default-build,external-build,api-check}.log`.

Required strict checkpoint `2026-10-16T21-16-01Z-28683` ran once and failed in 259.9s. All reported
workspace/script/pack typechecks, schema/API/facade/package checks, shipped build and packaged-authoring
author half pass. It found two earlier renderer ESLint expression errors and one stale external shell
wording assertion. Source `876a285b0` corrects those: full `npm run lint:check`, eight boundary cases and
all five external shell cases pass. Logs: `/private/tmp/apack-entity-producer-{chain,lint-corrected,boundary-corrected,shell-corrected}.log`.
No broad rerun was used to diagnose those failures. Steps not reached by the failed chain and final
committed-source strict `--all` remain unverified. The chain also reports shipped-build output changing
after its step; preserve that publication/cache observation for B6 rather than claiming it repaired.


### Entity destination catalog and admission (2026-10-16)

Source `479c75e01` projects native/installed compiled claims into immutable surface entries, leaving
unbuilt previews without compiled claims. One validator checks target feature identity and entity
vocabulary. Enabled conflicts name both owners and refuse the candidate atomically; disabled claims
remain readable. Enablement preflight precedes persistence and activation. Both single-candidate loading
and complete boot loading require the catalog-owning registry before executable imports. Native
bindings retain their accepted destination data; changing claims retires eligibility even with the
same machine object. Installed bindings retain their existing sealed-build checks.

A disposable read-only reproducer showed the window accepting an invalid target with `status: ready`
and `opens: []`. The shared validator now refuses it and preserves the preceding accepted frame.
Catalog/window/native admission and runtime suites account for 208 passing cases in the initial
209-case run; its invalid installed-directory fixture was corrected. All 111 affected catalog/schema
cases then pass; the subsequent admission subset passes 132 cases. Seven new projection/selection
cases pass. Removing collision, native-identity or complete-boot guards causes their behavioral
assertions to fail; exact source bytes were restored. Relevant SDK/host/CLI/API/script types, full lint,
schema, API reports, import and tier checks pass. Logs: `/private/tmp/apack-entity-catalog-{focused,corrected,admission,guards,mutation-claims,mutation-native,mutation-boot,final-host-types,final-cli-types,final-api-types,final-scripts-types,final-lint}.log`.

Strict checkpoint `2026-10-16T21-34-16Z-38082` ran once, failing nine unit cases in 486.1s (5,120 unit
cases passed). Builds, static checks, both packaged-authoring halves, app smoke and external contract
checks pass. `149502836` repairs the diagnosed synthetic compiler bootstrap, missing native service
fixture declaration, unload-spy target, obsolete Monaco state/layout expectation and missing `bin`
suite inputs. Targeted repairs plus affected suites pass 172 cases; publication passes three cases
separately after refreshing stale CLI/testing builds. The API's three cases pass outside the sandbox;
default-sandbox retries lost their worker before collection with `ERR_IPC_CHANNEL_CLOSED`. This
context difference is evidence, not a proven explanation of the worker exit. Logs:
`/private/tmp/apack-entity-catalog-{chain,review-fixes,ui-final,bound-outside-sandbox}.log`.
The broad run precedes the final malformed-frame correction and registry-first signature cleanup;
the focused repair suites and final types cover those changes. Unreached integration/app checks and
final committed-source strict `--all` remain required. No broad diagnostic rerun or deadline change.

## Entity opening lifecycle checkpoint (2026-10-16)

Source `cd9c57de6` implements the generic entity-opening path and its focused lifecycle refactor.
One child actor holds the canonical ID, frozen destination/binding and request token. Its invoked
`fromPromise` actor owns query cancellation; completion/refusal clears the operation and removes its
queued token centrally. Readiness and final delivery independently validate current eligibility.
Missing destination actors produce an attributed refusal. The shell no longer copies entity requests
through selection/delivery or maintains `pendingEntityOpen`/`entityCall`.

All six feature adapters handle `OPEN_ENTITY` directly through existing actions; redundant transitions
are removed while intentional state-specific transitions remain. Reference declarations, generators,
bindings, fixtures and public docs remove `navigate`. The host/API/renderer query port checks existing,
non-deleted rows without narrowing the supported entity-ID grammar. The harness lazily captures one
verified declaration map per test-file setup and refuses missing or mismatched builds. CLI inspection
reports compiled destinations without importing sources. Blueprint node revealing is deliberately a
separate operation; its timer replacement remains required in the active plan.

Evidence:

- Focused routing/reference/SDK/API/CLI checks pass 127 cases before the lifecycle refactor; the final
  owner and shell regression run passes all 60 cases, including abort/supersession, queued readiness,
  destination replacement and missing-actor delivery. The final run emits no XState action warnings.
  Logs: `/private/tmp/apack-entity-migration-focused-final.log`, `/private/tmp/apack-entity-owner-final.log`.
- Host/testing types, pack Vue/TypeScript and full lint pass. Public SDK/EARS reports and schema were
  regenerated and reviewed. The shipped facade diff contains exactly the six `opens` declarations.
- `npm run chain -- --strict --cores 4 --no-classify` ran once: failed in 409.5s, 19 steps, evidence
  `node_modules/.cache/apack-chain/runs/2026-10-16T22-31-16Z-68388`. Pack builds, all typechecks reached,
  schema/API/package checks, packaged authoring's author half and external contract checks pass.
  It failed the UI's undeclared direct EARS type import and the unrecorded facade fields. The import now
  uses the SDK; `check-import-specifiers.ts` and `npm run facade:check -w @app/default-setup` both pass
  after correction. No broad rerun was used to diagnose or confirm those fixes.
- `npm run build:runtime` passes on the refactored source. From `tests/packs/external-pack`,
  `apack pack test --host /Users/spankyed/Develop/Projects/AgentBuddy --prebuilt tests/e2e/memos.spec.ts
  --grep 'external reference declarations'` passes in real Electron (one case, 6.0s). It exercises
  the canonical click, API existence query and declared destination through the current lifecycle.
  Log: `/private/tmp/apack-entity-owner-external-app.log`.

The gate also reported changed default-pack outputs after its successful build step and increased
build/authoring durations. These are preserved B6 observations, not evidence of a shared cause or a
reason to expand this routing checkpoint into pipeline work. Unreached checkpoint steps, all later
goal work and final committed-source strict `--all` remain required. The active handoff owns the next
navigation work; this evidence is neither full Phase 4 acceptance nor a second execution backlog.

## Feature navigation checkpoint (2026-10-16)

Source `831221020` replaces the Brain blueprint caller's timer with one explicit Flows
`NODE.REVEAL { flowId, nodeId }` operation. Flows records the current selection call before sending,
accepts only its matching reply, and cancels on supersession, deactivation or leaving the view.
Cached matching nodes reveal immediately; missing cached nodes trigger a refresh before refusal.
Bootstrap metadata cannot replace an outstanding target. Async layout results belong to the exact
graph that requested them. `FLOW_SELECTED` replies to the asking window; `FLOW_REFRESHED` preserves
the current graph's notification semantics without navigating other windows.

Library's three navigation regressions were reproduced before repair: unsolicited document replies
opened an editor, an older reply replaced a newer target, and an abandoned reply reopened an editor
after collection navigation. The handler now exists only in the edit state and matches its current
document target; it fills data without navigating. Cached opening uses the existing DTO converter,
and leaving the editor retires the target while preserving data until the save action consumes it.

Evidence:

- The blueprint baseline failed both initial behavioral cases; the Library baseline failed all three
  navigation assertions. Logs: `/private/tmp/apack-blueprint-before.log` and
  `/private/tmp/apack-library-navigation-before.log`.
- All 16 new regressions pass, followed by all 99 affected cases across 12 Flows/Library files.
  Logs: `/private/tmp/apack-feature-navigation-focused-final.log` and
  `/private/tmp/apack-feature-navigation-affected.log`.
- Pack Vue/TypeScript, full lint, import boundaries and the regenerated/reviewed facade check pass.
  An invalid test-only breadcrumb field was corrected before the final passing typecheck.
  Logs: `/private/tmp/apack-feature-navigation-{types-final,lint,specifiers,facade-check}.log`.
- One strict checkpoint ran: `npm run chain -- --strict --cores 4 --no-classify`, run
  `2026-10-16T23-05-19Z-85766`, failed in 270.1s (15 steps; one cached). Default-pack build passed,
  as did reached host/API/renderer/SDK/EARS/UI/CLI/main/preload types, schema, exports and package checks.
  Packaged authoring failed at `lstat` of
  `packages/default-setup/dist/runtime/vidstack-BEi14iNw2-Cihp7Omm.js.map` while the default-pack build
  overlapped it. This demonstrates a missing output during overlapping work, not which operation
  removed it. Log: `/private/tmp/apack-feature-navigation-chain.log`; per-step logs remain in the run
  directory. This is preserved B6 evidence; no pipeline fix, deadline change or broad diagnostic rerun.

The new feature paths have no new real Electron acceptance claim. The prior committed shell's real
external-reference check remains recorded above. Remaining handler acceptance, the stored-message
cross-feature click, unreached gate steps and final committed-source strict `--all` remain required.

## Entity navigation acceptance checkpoint (2026-10-16)

Source `95ff95ab3` closes the remaining Phase 4 handler and stored-message acceptance gaps.
Eight Actions/Prompts cases reproduced abandoned selection replies replacing current intent:
list/create navigation, surface deactivation and returning to the already-loaded entity. Detail-state
exit and deactivation now retire the existing pending call. No additional request object or protocol.
Three shell cases reproduced breadcrumb/Back/Forward leaving an entity query pending; these inputs
now use the existing owner cancellation action before forwarding navigation.

All six actual feature handlers refuse unclaimed entity types without transitioning or sending.
Notes opens a nested canonical target from welcome or another editor. Threads loads an unlisted target,
ignores older-target data and does not let data replies replay navigation. Existing Flows/Library
regressions cover graph/node readiness, supersession, document/collection navigation and saving.

Evidence:

- Before repair: eight failures in `/private/tmp/apack-selection-navigation-before.log`, three in
  `/private/tmp/apack-entity-navigation-boundaries-before.log`. Corrected runs pass 24 Actions/Prompts
  cases and all 105 shell cases. Final affected six-feature run passes 159 cases across 22 files:
  `/private/tmp/apack-entity-handlers-affected.log`.
- Host, pack and E2E TypeScript and full lint pass. Logs:
  `/private/tmp/apack-entity-navigation-boundaries-types.log`,
  `/private/tmp/apack-entity-handlers-types-final.log`, `/private/tmp/apack-stored-reference-types.log`,
  `/private/tmp/apack-entity-acceptance-lint-final.log`.
- `npm run build:runtime` passes on the final shell source. One real Electron case passes after that
  rebuild (6.8s including startup): `npm run test:e2e -- tests/e2e/ui/entity-reference.spec.ts`.
  It creates a real note, imports a saved thread message through the supported import operation,
  opens/reloads that message, clicks its rendered reference and verifies the destination note's title
  and body. The label deliberately differs from the title. No inference, injected document/view,
  replacement navigation handler or new test hook. First setup attempt selected a surface before its
  registration; the test now explicitly waits for that surface before navigating. Logs:
  `/private/tmp/apack-entity-acceptance-runtime.log`, `/private/tmp/apack-stored-reference-app-final.log`.

The prior strict run's missing-source-map authoring failure remains preserved for B6. It was not
repeated to diagnose these independent, directly reproduced navigation defects. No passing broad gate
is claimed for this source. Local Phase 4 implementation/acceptance is closed; final strict validation
and all remaining goal phases are still required before archival.

## Native designation admission checkpoint (2026-10-16)

The field-by-field registration inventory is committed in `4ffeba67b`. Its first demonstrated omission
is repaired in source `b268fac86`: native backend designation claims must equal admitted declarations,
before runtime contributions are published. Changed, missing and undeclared claims each reproduced
acceptance before the repair. Matching bindings work; unload removes the runtime role and retains the
declaration. The native fixture helper now projects its declared designation. Replacement fixtures
explicitly admit the candidate role before binding it; their role-swap, rollback, authority and cleanup
assertions remain intact.

Focused admission/registration/replacement checks pass 132 cases. The full affected pack-registry suite
passes 646 cases across 42 files in 8.47s. Host/SDK types and full lint pass. Logs:
`/private/tmp/apack-native-designation-{before,final,packs,host-types-final,sdk-types,lint}.log`.
The first affected run exposed replacement fixtures whose roles had never been declared; those fixtures
were migrated rather than weakening admission or removing replacement assertions.

No public shape, generated schema or API signature changes. No new broad run was used to replay the
preserved authoring failure; its convergence and the final committed-source strict `--all` remain due.
Compiled endpoint contracts and the other inventory omissions remain required next work.

### Static endpoints and queued teardown delivery (2026-10-17)

`774b0844c` implements static event contracts, native/authored endpoint admission, captured routing
membership and offline catalog/CLI inspection. A real default-pack disable exposed queued delivery
after inbox removal; the bus now processes stop completion after earlier messages. All 110 bus and
lifecycle cases and the exact Electron disable/remove/replace/restore case pass. The source checkpoint
includes migrated generators, snapshot/native schemas, readers, harnesses, fixtures and public reports.

The converged strict run `2026-10-17T00-23-23Z-27374` passes both unit pools (5,168 host; 888 pack,
two skipped), types, lint, schema/API/boundaries, builds, external authoring, smoke and both packaged
authoring halves. It fails in integration with `ENOSPC`, unclassified assertions/timeouts and the
existing 600-second aggregate limit; it does not reach the final full external-app step. One actual
handwritten-harness fixture omission was fixed afterward and its five integration cases pass. No
full strict success is claimed and no broad rerun follows the resource failure. See the
[endpoint evidence](discovery-without-activation.md#static-endpoint-contracts-2026-10-17) for the complete
claims and limits. Continue native backend parity/static assets, then B1–B6 and all three Phase 6
workstreams; preserve the full goal and final committed-source strict `--all` requirement.

### Native backend viewer parity (2026-10-17)

`be5a9344b` shares artifact/block backend admission across native and built packs. Native metadata
already existed; the unchecked binding path is now closed without new grammar or a second validator.
All 705 affected cases, host/SDK types and lint pass. The prior strict integration resource failure
remains open and no broad rerun follows it. See [viewer evidence](discovery-without-activation.md#native-backend-viewer-parity-2026-10-17).
Native content/migrations are next, followed by the full remaining goal; this is not overall completion.

### Native content declarations (2026-10-17)

`2e1701fad` declares native writers/appliers, shares writer ownership and backend binding checks with
built packs, and preserves explicit native content application. All 761 affected cases, 46 authored
manifest cases, host/SDK types, lint, package builds and schema/API generation pass. Public docs/reports
are updated; no broad rerun follows the preserved integration failure. See [content evidence](discovery-without-activation.md#native-content-declarations-2026-10-17).
Native migration declarations and executable targeting are next, then static assets/readers and the
rest of the full goal. Final strict `--all` acceptance remains required.

### Native migrations (2026-10-17)

`f72cb8756` declares and checks native migrations and includes admitted native/installed owners in
normal runner targeting. Native app-line owners need no native version; pack-line owners declare their
own cap. Targets no longer pretend to be manifests, and checked callbacks/version data are captured at
admission. Inherited-key version lookup and duplicate migration execution with SemVer build metadata
have reproduced repairs. All 840 affected cases, host/SDK types, lint, package builds and schema/API
generation pass. See [migration evidence](discovery-without-activation.md#native-migration-targeting-2026-10-17).
No broad rerun follows the preserved integration resource failure. Static assets/readers and all-kind
acceptance are next; B1–B6, Phase 6 and final committed-source strict `--all` remain required.

### Early declared dependency inputs (2026-10-17)

`9ecf788fb` captures declared npm bytes, package membership and missing lookups before preloads through
the existing input owner. Focused cases, native startup, unchanged real repeat builds, CLI/host types,
lint and CLI package refresh pass. See [dependency-input evidence](build-input-snapshot-proof.md#early-declared-dependency-capture-checkpoint-2026-10-17).
Remaining native/runtime and transient resolution acceptance, B2–B6 and all other goal phases remain open.

### External compiler executable selection (2026-10-17)

`5c5f733fb` owns configured external esbuild executable bytes/selection through the captured installation,
its reuse checks and worker environment. Native installation, actual repeat-build and cancellation
checks, CLI types/lint and package refresh pass; the stale cancellation mock was corrected without
changing production behavior. See [executable evidence](build-input-snapshot-proof.md#captured-external-esbuild-executable-checkpoint-2026-10-17).
Continue B2's retained frontend generation audit; other B1/B3 and all subsequent goal requirements
remain open. No passing broad gate is claimed.

### Retained frontend compiler ownership (2026-10-17)

`a595246f2` gives initial/dev/watch builds and the Vite worker one captured compiler-generation owner,
with private server caches and awaited retirement. Actual backend/Vite A/B handoff, source watching,
failed replacement retention, watcher/session ownership and process/copy/cache cleanup pass; focused
startup cancellation, affected lifecycle cases, CLI/scripts types, lint and package builds pass. See
[generation evidence](build-input-snapshot-proof.md#retained-frontend-compiler-ownership-checkpoint-2026-10-17).
Close B2's configuration invalidation and browser HMR acceptance next. Remaining B1/B3, B4–B6 and all
other active goal requirements remain open; no new broad gate is claimed.

### Frontend configuration and browser HMR (2026-10-17)

`d3833f788` replaces frontend generations when pack/shared metadata changes and fixes cached UI-link
resolution through the common package lookup. All 39 focused builder/package/shared cases, CLI/host
types, lint and package refresh pass. A real browser loads generated external-pack registration and
preserves component state/document during Vite HMR, with no page errors. See
[configuration/browser evidence](build-input-snapshot-proof.md#frontend-configuration-and-browser-hmr-checkpoint-2026-10-17).
B2 now has implementation and local acceptance; preserve final whole-goal validation. Remaining B1/B3,
B4–B6 and every other active phase remain required. No broad or cross-platform gate is claimed.


### Generation cleanup and runtime feasibility (2026-10-17)

`a67edefc1` simplifies generation operation sequencing and frontend readiness; all 29 affected lifecycle
cases, CLI types and focused lint pass. Disposable Node/Electron runtime copies demonstrate local
owned execution; Electron requires its framework neighbors. See
[runtime feasibility evidence](build-input-snapshot-proof.md#generation-cleanup-and-runtime-copy-feasibility-2026-10-17).
Runtime integration and cross-platform acceptance remain required under B1/B3. No broad gate is claimed.


### Selected runtime ownership (2026-10-17)

`e369d3cb9` retains the selected executable with compiler generations and launches backend/Vite workers
through it. Runtime identity and copied-byte checks participate in admission/reuse; existing generation
shutdown owns cleanup. Twenty-three focused cases across the recorded runs, three real integration
cases, CLI types/lint/package refresh and integrated owned Electron execution pass. See
[runtime ownership evidence](build-input-snapshot-proof.md#selected-runtime-ownership-checkpoint-2026-10-17).
External linked native libraries, platform acceptance and remaining namespace/subscription cases stay
under B1/B3; B4–B6 and every other active goal phase remain required.


### Idle tooling subscriptions (2026-10-17)

`0bb9e64ec` subscribes/fingerprints selected compiler, runtime and configured esbuild inputs through the
existing watcher. Twenty-five focused cases pass, including real idle filesystem event delivery and
broken-configuration repair subscriptions; CLI types/lint/package refresh and real distribution
inventory checks pass. See [subscription evidence](build-input-snapshot-proof.md#idle-tooling-subscription-checkpoint).
Remaining B1/B3 native/platform/namespace/thread cases, B4–B6 and every other goal phase stay open.


### Native module and namespace/thread acceptance (2026-10-17)

`701928e9f` proves an outside native compiler addon executes from owned bytes and rejects later source
changes, using the existing implementation. Thirty-three namespace/view/observation cases, actual
native startup, CLI types and focused lint pass. See
[native and namespace evidence](build-input-snapshot-proof.md#native-module-and-namespacethread-acceptance-2026-10-17).
Effective environment, linked native libraries and platform/thread lifetimes remain B1/B3 acceptance;
all subsequent goal work remains required. No new runtime machinery or broad gate is claimed.


### Initial environment identity (2026-10-17)

`84f473549` records an initial environment digest in execution/frontend/watch identities, normalizing
private paths and excluding explicit infrastructure controls. Actual Vite output now has a matching
changed identity; 25 focused cases, real pre-preload capture, CLI types/lint/package refresh pass.
The repeat-build assertions pass in a 64.02s diagnostic run; its default 60s aggregate-budget failure
remains explicitly unresolved for B6/final validation. See
[environment evidence](build-input-snapshot-proof.md#initial-environment-identity-checkpoint).
Native/platform/lifetime acceptance, B4–B6 and all other active phases remain required.

### Onboarding API separation (2026-10-17)

Source checkpoint: `b39c189b8`.

The API-route audit identified three onboarding action sources using completion state and Database
using reset/export/import/backup inspection. Onboarding now has its own host service:
`services.onboarding.isComplete()` / `.complete()`. AppDataService contains only the four administration
methods. The old methods and redundant TestOnboarding type are removed; the test runtime and harness
use OnboardingService. Authored actions, tests, three generated API reports and guides are migrated.

`createAppState(ears)` shares the existing row/default/write implementation with the default host
instance. The new onboarding service captures its owning engine. Actual two-engine coverage proves
completion does not follow a subsequently installed engine; reset/restore still uses the existing
AppState wire identity. No settings entity, schema, migration or storage conversion is introduced.

Acceptance:

- SDK/runtime, host service/boundary and registration suites: 80 cases pass;
  `/private/tmp/apack-onboarding-focused.log`, `/private/tmp/apack-onboarding-registration.log`.
- Actual API whole-app reset/backup restoration: 13 cases pass;
  `/private/tmp/apack-onboarding-api-runtime.log`.
- Published-pack onboarding lifecycle, preferences-reset isolation and compiled action/prompt body
  checks: 17 cases pass; `/private/tmp/apack-onboarding-pack-runtime.log`.
- SDK, host, test harness, API test types and the default pack's Vue-aware typecheck pass;
  `/private/tmp/apack-onboarding-{sdk,host,testing,api-test,pack-vue}-types.log`.
- Correctness lint passes for all changed code; `/private/tmp/apack-onboarding-lint.log`.
- Changed published packages refresh and the actual default pack builds successfully;
  `/private/tmp/apack-onboarding-packages.log`, `/private/tmp/apack-onboarding-default-build-final.log`.
  The earlier build correctly refused a pack-local guide edit during capture;
  `/private/tmp/apack-onboarding-default-build.log`. Its incumbent remained intact. The retry froze all
  inputs. Root guidance now states explicitly that pack-local guides are captured build inputs.
- SDK API reports were regenerated and their three intended diffs reviewed;
  `/private/tmp/apack-onboarding-api-update.log`. No public aliases remain.

This is the first interface slice for consumed APIs, not completion of A1 or an access-control claim.
Generated services still include all host services; runtime dependency visibility and non-settings
lifetime binding are unchanged. Next complete A1's combined codegen/host-binding prototype: select
onboarding without administration, include Database administration explicitly, distinguish declared
from unrelated installed providers, retire retained handles, and pass the accepted facade into actions.
Only then settle the consumption declaration and complete A2–A5. B1/B3 external/native/platform gaps,
B6, remaining discovery/provenance/replacement acceptance and final strict `--all` remain required.
No broad chain was repeated for this slice; the previous deliberately interrupted gate is still
incomplete. The successful default build and focused suites do not substitute for that gate.

### Consumed service prototype (2026-10-17)

A1's bounded prototype completed against source `85c555e6d`, with no repository implementation edits.
Script: `/private/tmp/apack-consumed-services-prototype.mts`;
SHA-256 `98e70dee41ffeed56cb2bd82b52600211bd6cf3c8b78c8c9a5fe7919d0d9e5e1`.
Result: `/private/tmp/apack-consumed-services-prototype.log`. Its final retained work directory is
`/private/var/folders/4p/krfrhcfn4497f_6_ks06f9dr0000gn/T/apack-services-prototype-F06BeE`.

The script runs actual SDK codegen, applies the proposed type projection to its temporary emitted
files, and connects a prototype facade to actual host registration/replacement through the current
settings admission hook. These are experimental adapters, not production consumption enforcement.
It proves onboarding without appData; a selected dependency without unrelated installed services;
two real TypeScript missing-property diagnostics; destructured private-field methods; provider
replacement, including the same object reused in a new registration; retained caller root/method
refusal across rebind; and host replacement refusal. Reacquiring a live provider obtains its current
instance. It runs the existing action executor and asserts `from`/`via` sender labels. The actual
Database reset handler, bundled with the already accepted generated service module retained rather
than duplicated, invokes the selected appData implementation and emits RESET_DATABASE_SUCCESS.
Its flow query is the existing SDK implementation, registered normally. No production data is touched.

The final proof passes. Earlier prototype failures identified a disposable root lacking ESM metadata,
an accidentally bundled second unaccepted facade, and an unregistered flow query; the experimental
composition was corrected without changing product validation or running broad suites.

The route matrix and selected contract are recorded in
[A1 decisions](../../plans/declared-capabilities.md#a1-prototype-decisions-2026-10-17): qualified refs under
`consumes.services`, four intentional baseline APIs, direct provider ownership, host-accepted facades,
generation-specific retained handles and explicit started-operation/returned-resource boundaries.
The runtime selection prototype used a provider-keyed map; qualified authored refs normalize to that
same selection rather than introducing another runtime policy. No public manifest syntax was changed
just to run the experiment. A2 must implement it in the common declaration pipeline; A3/A4 must carry
it through production bindings, generated types, action consumers, subscriptions and inference handles.
The prototype does not close those acceptance cases, B1/B3/B6 or final strict validation.

### Consumed service declaration foundation (2026-10-17)

Source checkpoint: `1a0de64fb`, following A1 decision/evidence commit `71f76a41b`.

Authored and native declarations now accept `consumes.services` as unique qualified refs. The shared
module owns host names/baseline, direct feature/pack service ownership and selection validation.
Codegen uses that projection for imports, collision checks and consumed-provider validation; an
intersected dependency facade cannot manufacture ownership of a service its manifest does not declare.
Host-name collision checks reuse the canonical SDK inventory. Selection refuses two providers that
would map to the same service property, naming the caller, key and both providers. Dependency
membership uses owned keys, including for a provider named constructor.

The JSON Schema lists known host refs, excludes unknown host names, explains provider ownership and
reports duplicates. PackConsumption is a named readonly data contract in the generated reports.
Contextual checks skip already-invalid child syntax: Zod may invoke a parent refinement after a child
regex failure, and malformed refs now yield validation diagnostics rather than escaping safeParse.
The snapshot field inventory deliberately includes the new optional field; no format/version metadata
was changed.

Evidence:

- All 251 SDK generator/declaration cases pass in 23.78s:
  `/private/tmp/apack-consumption-generators-final.log`. This covers every generator entry path because
  generation now always validates service selection, plus native grammar and editor-schema assistance.
- All 21 host catalog cases pass in 1.51s: `/private/tmp/apack-consumption-catalog.log`. Requests survive
  native/source admission and disabled sealed-build inspection, with poisoned runtime files untouched;
  a changed source request with an old declaration identity refuses atomically.
- Existing 49 host registration cases passed during the initial focused run, preserving collisions:
  `/private/tmp/apack-consumption-declarations-tests.log`.
- Final SDK/host/CLI types, correctness lint, package refresh and schema check pass:
  `/private/tmp/apack-consumption-{sdk,host,cli}-types-final.log`,
  `/private/tmp/apack-consumption-lint-final.log`, `/private/tmp/apack-consumption-packages-final.log`,
  `/private/tmp/apack-consumption-schema-check.log`.
- API reports regenerated and reviewed: `/private/tmp/apack-consumption-api-update-final.log`.
  TypeScript also reordered inferred Zod type members. A temporary AST audit compares all 247
  pre-existing declarations with `71f76a41b`, ignoring type-member/union order and the intended optional
  consumes additions: no other signature changes. It lists exactly the nine intended new framework
  declarations. `/private/tmp/apack-consumption-api-review.mjs`,
  `/private/tmp/apack-consumption-api-review.log`. Report line endings retain the repository convention;
  no production report-normalization machinery was added.

This closes the declaration/codegen slice of A2, not A2/A3 overall. The common catalog already retains
the new facts; next use them to refuse missing/disabled required APIs before importing a runtime and
at admission, and align read-only validation/inspection diagnostics. Registration after module import
is too late for that requirement. Then implement A3's filtered generated/runtime facades with caller
and provider lifetime binding. Existing generated Services and runtime access remain broad at this
checkpoint. Preserve harness mocks, actual action attribution, settings policy and EARS behavior.
Finish A4/A5 migration, external acceptance, the outstanding B1/B3/B6 and other phase requirements,
then the final committed-source strict --all. No broad chain or default-pack rebuild was repeated here.


## Consumed service admission (2026-10-17)

Source checkpoint: `558b42220` (on top of native-boundary planning `b010b6495`, preserved).
The SDK's one selection function now checks dependency versions as well as direct service ownership.
The host projects native, installed and source contracts from one catalog snapshot and validates them
before runtime import, dependency auto-loading in the harness, and registration binding. Provider
requirements are traversed without executing modules; prospective candidates close declaration cycles.
Disabled/invalid installed providers cannot be hidden by source previews. Authoring-only declarations
can satisfy another source consumer, never an installed/native one. Direct replacement refusal leaves
the incumbent installed and invokes no new binding callbacks.

CLI validation checks available requested-provider declarations independently of source validation
and codegen, even if an unrelated dependency is unavailable. Missing requested declarations leave an
explicit incomplete check; wrong direct ownership is invalid. Human info lists qualified requests and
JSON inspection retains the authored declaration. This is declaration availability, not executable
readiness or runtime filtering; A3 still owns accepted implementations and lifetime/type projections.

Focused verification:

- Five service/loader/registration/CLI files: 163 passing cases in
  `/private/tmp/apack-service-admission-tests-final.log`. The sixth file's replacement assertion used
  the registration API initially; corrected to `replacePack`, all six requirement cases pass in
  `/private/tmp/apack-service-admission-replacement.log`. The corrected source is committed.
- Eight real code-generation files, 190 cases: `/private/tmp/apack-service-admission-generators.log`.
- SDK, host, CLI and testing types: `/private/tmp/apack-service-admission-types.log`.
- Lint: `/private/tmp/apack-service-admission-lint.log`.
- Published package refresh: `/private/tmp/apack-service-admission-packages.log`.
- SDK API extraction/update: `/private/tmp/apack-service-admission-api.log`; reviewed report diff is
  only the optional provider version and attributed callback ref. Schema remains unchanged and the
  strict run's API/schema/export checks pass.

Required checkpoint command, run once with frozen source:
`npm run chain -- --strict --cores 2 --no-classify`.
It exited 1 after 666.3s, not a strict pass. Log:
`/private/tmp/apack-service-admission-chain.log`; retained step evidence:
`node_modules/.cache/apack-chain/runs/2026-10-17T09-39-29Z-40982/`.
Twenty-two steps reported success before `test:external-pack:contract` failed. The real authoring half
passed in 290.1s, including release dry-run, checksum and isolated archive installation; its app half
was not reached. Default-setup built, facade/type/import/lint checks passed, and the external pack's
38 cases passed. Preparing the shipped-pack fork then refused:
`Compiler startup input changed: ["file","src/__generated__/.inputs-hash"]`.
The strict post-run audit also found default-setup's outputs changed, invalidating that build stamp.
The producer of the changed marker is not established by this log alone. Do not blame another
session or infer a deletion. Preserve the handoff and investigate this exact writer/reader path before
another broad run; do not increase deadlines or weaken freshness checks. Unit pools, integrations and
real app halves remain unverified by this run, as does final committed-source strict `--all`.

Continue A3 implementation independently of that bounded B4/B6 repair. Preserve the whole active
goal, remaining native/platform evidence, provenance and shipped-replacement workstreams. No stash,
research worktree, production data or release metadata was changed.


## Generated service root retirement (2026-10-17)

Source checkpoint: `3ccd27614`. While starting A3, inspection found that `_createPackServices` gave
all generated roots a getter over the factory's changing binding. A retained root regained settings
authority on a later bind even though retained settings handles stayed revoked.

The root now belongs to its construction frame. Factory disposal installs a fresh frame before
revoking the old one; generated `services` is a live export refreshed in `finally`, so cleanup errors
do not leave the current export pointing at a retired root. A later bind accepts the fresh frame;
retained roots remain revoked. The settings-only hook remains until the full service binding replaces
it; no compatibility alias was introduced.

Proof:

- `npx vitest run --project @apackdev/host --project @apackdev/sdk
  packages/apack-host/tests/packs/registration.spec.ts
  packages/apack-sdk/tests/build/generate-entries/compiles.spec.ts
  packages/apack-sdk/tests/build/generate-entries/shapes.spec.ts --maxWorkers 2`:
  105 cases pass in 18.94s; `/private/tmp/apack-root-lifetime-tests.log`.
  This includes real generated TypeScript typechecking, bundling and subprocess execution over
  disposal, rebind, throwing subscription cleanup and a third successful bind. Actual host
  unregister/register also proves retained-root refusal and fresh-root access.
- SDK/host types pass: `/private/tmp/apack-root-lifetime-types.log`.
- Lint passes: `/private/tmp/apack-root-lifetime-lint.log`.
- Package refresh for executable acceptance: `/private/tmp/apack-root-lifetime-packages.log`.
- API extraction passes: `/private/tmp/apack-root-lifetime-api.log`. Reviewed report change is only
  the factory's readonly current-root getter.

A3 is incomplete. Non-settings members still use the ambient union; retained nested objects/methods,
provider generations, host replacement, matching selective types/runtime and inference resources
remain required. Preserve mocks and action attribution while replacing the backend settings-only
binding with full host-accepted service authority. Do not repeat the A1 design prototype.
The previous strict run's `.inputs-hash` refusal remains open under B4/B6. No broad run was repeated;
final committed-source strict `--all` and the entire active goal remain outstanding.


## Selected service bindings (2026-10-17)

Source checkpoint: `cccc12d5d`. Backend `PackRegistration.bindServices` replaces `bindSettings`
without an alias; the frontend settings-port hook remains `bindSettings`. The host supplies the
normalized own/baseline/consumed selection, and generated `Services` uses the same host/dependency
`Pick` projection. Build checks still require direct service ownership and preserve global collision
policy. Native and authored admitted entries retain their accepted declarations and generation.
Runtime readiness validates the accepted provider rather than a prospective replacement's metadata.

`packs/service-binding.ts` owns pending/active/revoked authority and settings subscriptions.
Retained service objects, nested objects and bound methods refuse after provider retirement, including
reuse of the same underlying service and registration objects. New live lookups can acquire current
compatible providers. Private receivers and frozen objects work. Host bind/unbind increments a
lifetime even when rebinding the same object. Caller retirement follows the existing coordinator's
actor cleanup; a draining caller's own service remains on its original generation. Failed retirement
scheduling now disposes immediately rather than leaving orphaned authority. Hook refusal, omitted
cleanup and thrown cleanup keep host authority/subscription ownership intact.

Inference `createAgent` results are explicitly guarded resources, including agents delivered after
retirement. A real AI SDK agent over `fakeInference` proves its private receiver and retained-method
refusal. Started calls and streams can finish on the original implementation; ordinary result objects
are returned unchanged. There is no generic result-data membrane or new lazy activation.

Harness overrides now enter through the owning registry's `serviceOverrides` map, after selection;
they cannot create an API or borrow another registry's same-named service. The test harness preserves
its file/test mock lifetime. The external fixture declares inference, verifies logger behavior through
the facade, and uses generated repository reads instead of ambient object identity. Default-setup
explicitly requests all six host groups for its existing code/user-authored actions. Reports, guides
and public service docs reflect the new contract.

Converged focused evidence:

- Twenty-one affected files, 452 cases pass on two workers in 29.83s:
  `/private/tmp/apack-full-binding-converged-tests.log`. Includes actual generated TypeScript/bundled
  module execution, missing-member diagnostics for unconsumed host/dependency APIs, backend hook
  consumers, replacement/refusal/reload, class/frozen/nested handles, same-object generation reuse,
  real inference agent lifetime, started stream/result behavior and registry-local mock isolation.
- SDK, host, CLI, testing and shipped default-setup types pass:
  `/private/tmp/apack-full-binding-converged-types.log`.
- All 28 SDK API reports match: `/private/tmp/apack-full-binding-api-check.log`.
  Report changes are the backend hook, current facade type and internal captured-host helper.
- Lint passes: `/private/tmp/apack-full-binding-converged-lint.log`.
- Package refresh: `/private/tmp/apack-full-binding-packages-final.log`.
- Default pack declaration/report generation: `/private/tmp/apack-full-binding-default-facade.log`;
  reviewed report change is the selected HostServices type and its description.

This is core implementation, not A3–A5 or whole-goal closure. A4 still must remove the supported
ambient SDK service route and migrate ActionService/LLM consumers. Its action logger/emitter must
preserve accepted lifetime as well as `from`/`via`; generated filtering alone does not prove that.
The changed external fixture has not yet been rebuilt/run, and the real Database/admin/onboarding
paths need their planned acceptance. No broad chain was repeated: its recorded `.inputs-hash`
refusal remains a bounded B4/B6 investigation before another broad run. Final strict committed-source
`--all`, native/platform evidence, provenance, shipped replacement and the full phase audit remain
required. No legacy fallback, release/version change, production-data operation or stash/worktree
change was introduced.


## Bound action access and ambient route removal (2026-10-17)

Source checkpoint: `bb6df4a45`. Removed the public ambient SDK `services` value and migrated
ActionService/LLM to generated bindings. `PackServiceAccess` explicitly carries the accepted facade
and host-owned action factory. Action views preserve selected APIs, lifetime and logger/emitter
`from`/`via`. Generated roots and factories retain their construction frame across rebind/disposal,
including failed cleanup. Root flows capture the factory once and pass it to children. Actual escaped
user-code callbacks refuse after retirement. Test doubles remain explicit on their owning registry
and test host; settings administration/policy remains canonical.

Focused evidence:

- SDK/host/codegen: 17 files, 297 cases pass, two workers, 24.21s;
  `/private/tmp/apack-action-access-converged.log`. Includes actual generated execution, action sender
  identity, provider/caller retirement, replacement and registry isolation.
- Import boundaries: 302 cases pass, 10.26s;
  `/private/tmp/apack-action-access-specifiers.log`.
- Actual shipped-pack action/inference/settings/onboarding/reset: 44 cases pass, 19.88s;
  `/private/tmp/apack-action-access-default-runtime.log`. The sandbox's five cases then pass with the
  additional escaped-callback regression (`/private/tmp/apack-action-access-escaped.log`): 45 unique
  cases across these runs. Eight onboarding cases pass after the final flow capture change:
  `/private/tmp/apack-action-access-flow-capture.log`.
- SDK, host, CLI, testing and default-setup types pass:
  `/private/tmp/apack-action-access-types-final.log`.
- All 28 SDK API reports match: `/private/tmp/apack-action-access-api-check.log`.
  Four changed reports describe the explicit binding protocol, removed ambient export, action runtime
  factory and test-host override input. Lint passes: `/private/tmp/apack-action-access-lint-final.log`.
- SDK/testing/CLI builds pass: `/private/tmp/apack-action-access-packages-final.log`.
  Default declaration/facade generation passes with unchanged facade report:
  `/private/tmp/apack-action-access-default-facade.log`.

This closes the service/action route implementation, not all of A4/A5 or the goal. Content-target
validation still needs its current-code audit. Migrated CLI harness integration cases have not run
against a current default build. No broad chain was repeated; the recorded `.inputs-hash` mutation
remains open under B4/B6. External runtime/template acceptance, native/platform closure, provenance,
shipped replacement, all-kind audit and final committed-source strict `--all` remain required.


## Generation cache ownership (2026-10-17)

Source checkpoint: `caf57cb0e`. A small external pack built through the real captured compiler passes
`assertPackBuildInputsCurrent`. Running standalone generation produces identical generated modules but
changes its compiler-specific stamp. Before the repair this reproduces the exact strict-chain refusal:
`Compiler startup input changed: ["file","src/__generated__/.inputs-hash"]`.
Evidence: `/private/tmp/apack-generation-stamp-repro.log` (29.39s case).
This identifies this mutation's writer; it does not identify who deleted earlier authoring temp output.

The generation stamp now lives in `.apack/generate-entries.json`, outside generated module outputs.
Its input identity and exact generated-byte checks are unchanged. No observations are filtered away,
no compiler identity is weakened, and no compatibility read or timeout increase is introduced.
The same real-path regression now passes in 33.28s and proves generated bytes remain identical while
the private stamp changes. A subsequent generated-module edit still refuses freshness validation:
`/private/tmp/apack-generation-stamp-fixed.log`.

Other focused evidence:

- Generation locking/output completeness/dependency cache: 25 cases pass;
  `/private/tmp/apack-generation-stamp-unit.log`.
- Content compiler dependency tampering retains the accepted build: one actual integration case passes
  in 45.34s; `/private/tmp/apack-generation-stamp-dependency.log`.
- Chain/repro tooling: 59 cases pass; `/private/tmp/apack-generation-stamp-tooling.log`.
- CLI types and scripts/repo/publish/E2E types pass:
  `/private/tmp/apack-generation-stamp-types.log`,
  `/private/tmp/apack-generation-stamp-tooling-types.log`.
- Lint passes: `/private/tmp/apack-generation-stamp-lint.log`.
  Updated CLI bundle: `/private/tmp/apack-generation-stamp-packages.log`.

The accompanying current-code A4 audit finds content-target checks already implemented in SDK
`generateAppliers()`, using `packRegistry()` / `mergeRegistries()` for own/dependency/SDK entities.
It checks unused own formats and resolved dependency formats, including tree branch entities.
The existing modules case accepts SDK/dependency targets and rejects undeclared ordinary/branch
entities; shape/compilation cases preserve typed/untyped behavior. CLI's
`add-feature-validate.integration.spec.ts` contains the author-facing refusal. Those prior contracts
are retained; the audit is not a claim that their external runtime acceptance ran in this checkpoint.

The actual default/fork path, current-build CLI harness integration and converged strict gate remain
open. No broad suite was repeated to diagnose this cache-ownership defect. All other active goal scope
is preserved, including B1/B3 closure, output completeness, provenance and shipped replacement.


## Current-build service authoring acceptance (2026-10-17)

Source checkpoints: `45f2a3458` and `1fbc1e223`, following service/action checkpoint `bb6df4a45`
and generation-cache repair `caf57cb0e`.

A real default-setup build passes: `/private/tmp/apack-current-service-default-build.log`.
Standalone facade generation/report comparison passes and passive replay confirms its completed build
inputs remain current: `/private/tmp/apack-current-service-facade-check.log` and
`/private/tmp/apack-current-service-facade-freshness.log`. No generated-byte or compiler checks weakened.
Obsolete ignored generation stamps in current-checkout pack outputs were removed explicitly; no
normal-runtime compatibility reader or cleanup was added.

The migrated dependent harness case initially failed because its handwritten fixture imported a
nonexistent generated Services module. `45f2a3458` replaces the duplicated handwritten registration,
event metadata and content runtime with actual generated declarations over the authored contract.
Its five runtime cases pass (13.55s): `/private/tmp/apack-current-service-harness-fixed.log`.
The initial combined run passed the seven unchanged harness setup/scaffolding cases and failed only
that dependent case: `/private/tmp/apack-current-service-harness.log`. This is evidence across runs,
not a claim of a single twelve-case green run. CLI types and focused lint pass:
`/private/tmp/apack-current-service-harness-types.log`.

The first real authoring-contract run built the external fixture, then typechecking found a scheduler
mock typed against the consumer's intentionally filtered Services. The dependency's brain invokes its
own scheduler; the consumer does not need a scheduler grant. `1fbc1e223` types that test double from
the provider's generated Services without changing consumption declarations. External types pass and
the real scheduled-flow file's three cases pass: `/private/tmp/apack-service-external-types.log` and
`/private/tmp/apack-service-external-scheduler.log`. Public testing docs explain this distinction.

The corrected complete authoring contract exits zero:
`/private/tmp/apack-service-authoring-contract-fixed.log`. It validates/builds/typechecks both external
fixtures, runs all 38 external-pack contract cases, then builds and archives the external default fork.
The bundled UI fixture intentionally has no contract-test config; its validation/build/types run.
The first failed run is retained: `/private/tmp/apack-service-authoring-contract.log`.
Prepared fork metadata associates shipped revision
`0952158f499afc03bd3d63485c8849c1d22bd5f036424779f0cf9bda35438f8e` with archive SHA-256
`1e4ba95c6d7554fa3bd2e32a4a109a1ac3c3b3e6b73df9a9f91e4c3a9ddf2105`.

This accepts the real formerly failing default/fork freshness boundary plus selected-service authoring
and harness behavior. Actual app/fork restart/restoration, converged B6 and final committed-source
strict `--all` remain open. Native/platform closure, complete discovery/editor acceptance and all
three Phase 6 workstreams remain in the active goal; no deferred work or compatibility handling added.


## Disabled caller retirement (2026-10-17)

Source checkpoint: `3769e930f`. The first full external app run after the service migration passes
26 of 27 cases, including actual fork reload, pane/form containment, offline JSON assistance,
settings windows/policies/import, onboarding, reference navigation and step-palette updates.
`/private/tmp/apack-service-external-app.log` records the one failure: disabling default-setup causes
its threads actor's queued `sendCommands` action to access `services.library` after catalog enablement
has already retired the caller. The initial backend stack points to `library.commands()` in that
action and reports `Pack "default-setup" services belong to a retired runtime or host`.
The resulting restore wait times out; increasing that deadline would not repair the fatal backend.
The script exits before bundled UI app and normal fork restart/restoration checks.

A 13ms installed-pack caller/peer regression reproduces the exact binding failure:
`/private/tmp/apack-disabled-binding-repro.log`. Catalog availability and actor lifetime had two
retirement owners. The binding now owns caller authority until coordinated disposal; its accepted
own-service generation remains usable during queued work and shutdown. Other callers immediately
lose access to a disabled provider. Retained caller roots/methods still refuse after disposal, and
host generation remains independently checked. No exception is swallowed and no stale-call guard
or deadline is weakened.

Focused binding/replacement/lifecycle/reload/bus teardown: 64 cases pass across five files (3.62s),
`/private/tmp/apack-disabled-binding-focused-final.log`. Host types and three-file correctness lint
pass; types: `/private/tmp/apack-disabled-binding-types.log`.
Published packages were refreshed, then only the affected API app bundle rebuilt:
`/private/tmp/apack-disabled-binding-api-build.log`. The prebuilt check correctly refused the external
fixture's now-changed captured host input (`/private/tmp/apack-disabled-binding-app-focused.log`), so
only that fixture was rebuilt (`/private/tmp/apack-disabled-binding-external-build.log`).

The exact real-window disable/remove/replace/restore case then passes in 14.1s (15.4s runner):
`/private/tmp/apack-disabled-binding-app-fixed.log`. Its backend log contains no retired-runtime or
fatal backend error: `/private/tmp/apack-disabled-binding-app-fixed-backend.log`.
The preceding four-workspace app build also passed on two cores:
`/private/tmp/apack-service-app-runtime-build.log`.

This is the focused repair proof, not a converged 27-case pass or strict gate. The host source changed
captured inputs, so affected default/fork and other fixture builds need their normal refresh before
claiming current prebuilt acceptance. Preserve the earlier accepted authoring evidence as dated
proof rather than silently treating it as post-fix source. All active goal requirements remain open
where their final evidence is absent; no broad run has been repeated to diagnose this bug.


## API composition test migration (2026-10-17)

Source checkpoint: `5f5970e6e`. The strict two-core checkpoint exits 1 at `typecheck:api` after 24.7s.
Four API composition test files still dynamically imported the removed ambient SDK `services` value;
this was an incomplete consumer migration, not a runtime or typechecker defect.
Evidence: `/private/tmp/apack-service-teardown-checkpoint-chain.log` and
`node_modules/.cache/apack-chain/runs/2026-10-17T11-21-23Z-75198/` (six completed step logs).
No producer/app/integration acceptance is claimed from this early stop.

The tests now use the actual runtime's host ports, engine and registered-pack view. Baseline sends use
`createActionEmitter`; no ambient export or production accessor is restored. The same engine,
registered service, sender, reset/restore/onboarding and secret metadata/change assertions remain.

All 30 affected cases across four files pass in 4.49s:
`/private/tmp/apack-api-service-tests-focused.log`. All three API projects pass through
`npm run typecheck:api`: `/private/tmp/apack-api-service-tests-types.log`. Four-file correctness lint
and `git diff --check` pass. A repository search for same-line named/dynamic imports finds no remaining
ambient SDK value imports; this search does not substitute for the unexecuted cross-workspace gate.

Resume the cached strict checkpoint to reach its remaining checks. The early stop and focused repair
are not a broad pass; all remaining B1/B3, cross-phase and final committed-source `--all` obligations
remain in the active goal. No timeout, assertion, source-input scope or compatibility handling changed.


## Packaged inference declaration (2026-10-17)

Source checkpoint: `a0911a017`. The resumed strict checkpoint on two cores exits 1 after 491.1s at
packaged authoring. Before that failure, default-setup builds (179.6s), facade checking (29.6s), all
reached type/schema/export/specifier/tier/lint checks and external authoring/fork preparation (309.7s)
pass. Evidence: `/private/tmp/apack-service-api-checkpoint-chain.log` and
`node_modules/.cache/apack-chain/runs/2026-10-17T11-24-03Z-77139/`.
Unit pools, integration and app halves were not accepted by this run.

The tarball-authored fixture creates a digest service that calls inference, but its authored manifest
omitted `host/inference`. The selected view correctly excludes that API. Six harness cases pass,
including the dependency's llm flow; the demo's own digest case fails on its missing member.
The script now declares the consumed host API explicitly and runs its existing authored-pack typecheck
before the unit tests, so unsupported member access is reported before execution. The host selection
and harness override rules are unchanged.

The failed retained workspace was adapted with that one declaration and regenerated using its own
installed CLI. Its original manifest was preserved outside its authored pack while diagnosing it.
Authored types pass; all seven existing harness cases pass in 3.05s:
`/private/tmp/apack-packaged-consumption-{generate,types,tests}.log`.
Shell syntax, whitespace and tier checks pass (`/private/tmp/apack-packaged-consumption-tiers.log`).
The complete author half then passes in 263s:
`/private/tmp/apack-packaged-consumption-author-full.log`. It proves fresh scaffolding, normal build,
authored types, seven harness cases, published testing declarations, release dry-run, verified archive
installation and handoff publication. Its app half passes in 21s:
`/private/tmp/apack-packaged-consumption-app.log` (two browser cases, offline database export and no
symlinks into the monorepo). No producer rebuild was needed for that app consumer. Normal owned-work cleanup may replace the temporary
fixture; diagnostic logs and the committed source repair are retained independently.

The public content guide now uses caller-bound settings targets, separates onboarding from app-data
administration, removes nonexistent browser/textStream services, and distinguishes the default action
runner's accepted view from a pack's generated source facade. No compatibility accessors or new grants
were added. Final source/consumer/schema/doc and app acceptance still belong to the active goal.


## Unit-pool service migration follow-through (2026-10-17)

The standalone host pool ran on two workers in 156.58s: 454 files passed, two failed;
5,323 collected cases passed and one failed, plus a collection failure. Log:
`/private/tmp/apack-service-host-unit-pool.log`. The bus transport test's complete app-state mock
omitted `createAppState`, required by real host composition. A partial mock preserves the actual
module while retaining its intentional onboarding getter stub. The docs index linked a nonexistent
`prompts/` directory; that row is removed. Source `1f5db11c6`: all 15 bus cases and six documentation
cases pass, API test types and focused lint pass. Logs:
`/private/tmp/apack-bus-composition-mock-fixed.log`,
`/private/tmp/apack-doc-index-links-fixed.log`,
`/private/tmp/apack-bus-composition-mock-types.log`.

The standalone pack pool ran on two workers in 83.67s: 116 files passed, four failed, one skipped;
881 cases passed, eight failed, two skipped. Log: `/private/tmp/apack-service-pack-unit-pool.log`.
All eight failures were assertions against guarded handles: raw service object identity or Vitest spy
inspection on a bound function. Source `df1a937a8` retains original spies for inspection while actions
continue through generated lifetime-bound handles. The harness test proves routing into the test's
mock and absence of leakage outside that test; it no longer relies on object identity.
All 17 cases across the four affected files pass in 4.58s; pack Vue/TypeScript checks and focused lint
pass. Logs: `/private/tmp/apack-pack-guarded-mocks.log` and
`/private/tmp/apack-pack-guarded-mocks-types.log`. The first focused run caught a shared spy's
accumulated call count; its setup now explicitly clears that spy between tests.
No service guards, deadlines or production behavior changed. These focused passes do not replace
a converged pool or strict checkpoint result. The outstanding integration pool starts on two workers
against this committed source; its log is `/private/tmp/apack-service-integration-pool.log`.


## Source-free external flow inspection (2026-10-17)

At source `df1a937a8`, copied the existing real built external fixture into an owned temporary
installed-layout directory, without authored sources. `inspectPack` verifies that build and reads its
compiled content; no build or runtime import is requested. `findContentDependents` finds both
`Memo Flow` and `Memo Reminder Flow` pointing to `actions/Memo: Add`, each `indexed`.
Against a cloned inventory, renaming and then removing that target preserves both incoming edges
with `not-indexed` status. These are inspection-time simulations, not a claim that a renamed pack
was rebuilt or installed. The original fixture/build and user data were unchanged; the temporary
copy was removed after the proof. Log: `/private/tmp/apack-external-flow-offline-acceptance.log`.

This closes the previously missing real external/source-free reader check in combination with the
existing actual compiler, custom/nested/computed-reference, rename and unavailable-analysis cases
recorded under `7196d61d3`. It adds no scanner, runtime dependency or permanent fixture framework.
Missing compiled inventory targets remain distinct from missing user database records. Final strict
acceptance remains required.


## Two-worker integration attempt and scaffold refusal (2026-10-17)

The previously unexecuted integration pool ran once with two workers against source `df1a937a8`
and reached its existing 600s suite deadline. Log: `/private/tmp/apack-service-integration-pool.log`.
The process group was terminated; no complete integration verdict or cache stamp is claimed.
Before stopping, the reported failures were scaffold step/service compilation at 60s, an archive
refusal diagnostic assertion, and the initially empty linked external Tailwind content watcher at 60s.
Other completed file results are retained in that log; unreached cases remain unverified.
The runner's historical 60s healthy estimate is not evidence of a deadlock; workers advanced across
files throughout this run. No deadline was increased and no broad diagnostic rerun was started.

A focused three-case scaffold run (`/private/tmp/apack-scaffold-coherence-focused.log`) passes the
real feature build/archive in 39.36s and step/service build/typecheck in 56.93s. The latter is close
to its unchanged 60s limit; isolated success does not prove concurrent acceptance. The archive
assertion assumed a particular observation order. In the broad run the changed authored-file
inventory refused first; with fewer preceding scaffold operations, the changed `apack.json` bytes
refuse first. Both are the existing correct stale-build rejection.

Source `1ad1c8c12` accepts only those two exact diagnostics and retains the nonzero exit and incumbent
output assertions. The initial valid build plus unresolved-dependency build/archive cases pass in
55.78s: `/private/tmp/apack-scaffold-refusal-fixed.log`. Focused lint and whitespace checks pass.
The first diagnostic adjustment was too specific to the inventory and failed against the individual
manifest observation; the final assertion explicitly accounts for both, rather than depending on
first-observation ordering. No production source or observation validation changed.
The isolated linked Tailwind watcher passes in 57.05s at the original 60s deadline:
`/private/tmp/apack-tailwind-linked-watch-focused.log`. Initial compilation, creation through the
nested directory link and replacement of that link all publish the expected CSS; both watch events
appear in the log. No missed rebuild is demonstrated by this reproducer. Both formerly timed-out
cases finish close to their deadlines, so concurrent acceptance remains unresolved. These results
do not justify a blanket deadline increase or a claim that the broad suite is green. No deadline,
watcher or production compiler changes were made. Next: address the integration acceptance budget
with these measured cases before another required broad run; preserve all remaining goal work.
Integration/converged and final strict acceptance remain open.


## Real cold Monaco worker and editor lifetimes (2026-10-17)

Source `d1c38bc58` adds one real-window case in the existing host-only file, exposing its owned data
directory through the existing fixture. Two actual UnifiedMonacoEditor instances open before their
DSL provider exists. The actual TypeScript worker initially reports missing global `lateMemo`.
A sealed, disabled installed build supplies inline compiled definition text; its authored source does
not exist and its backend entry throws if activated. The normal packs-system refresh publishes that
build's catalog metadata. The worker then supplies `before` completions without reopening the document.

Real keyboard input adds an unsaved draft. A newly sealed accepted definition replaces `before` with
`after`; actual worker completions and property diagnostics follow it while document text, model URI,
model object, selection and update count remain unchanged. Unmounting the first editor leaves the
second editor's worker assistance intact. Removing the provider retires its libraries and restores
missing-global diagnostics. Cleanup affects only the fixture's temporary data directory. This is a
consumer/build-reader acceptance fixture; actual declaration compilation has existing producer checks.

The focused case passes in 8.9s (`/private/tmp/apack-cold-monaco-worker.log`). The affected complete
host-only file passes all five cases in 13.5s (`/private/tmp/apack-host-editor-window-acceptance.log`),
including rendered saved references without the default pack, live Tiptap activation/removal with
preserved draft/selection, host preferences and shortcut editing from a second window. E2E TypeScript
checks (`/private/tmp/apack-cold-monaco-types.log`), focused lint and whitespace checks pass.
No production editor/library changes were necessary. This closes local cold-worker/shared-editor
acceptance, not compiler five-build frontend reuse/removal, all-kind discovery or final strict acceptance.

The subsequent real external app command refused its preflight because default-setup's captured
`tests/content/actions/claude-code/handle-fork-stress.spec.ts` differs after `df1a937a8`.
Log: `/private/tmp/apack-service-external-app-converged.log`. No app cases started. Refresh the affected
producer/fork before retrying; do not bypass its freshness check. The failed documentation write in
`0fd4bd9af` is repaired by restoring all prior evidence from its parent and appending this entry.

## Dependency provenance closure audit (2026-10-17)

Current source still uses `dependency-cache.ts`'s captured producer receipt, immutable build directory
and atomically replaced resolution record. `readCachedDependency` checks pack ID, exact version and
content revision before exposing a coherent build. `fetch-deps.ts` retains the original structured
origin on reuse, distinguishes explicit links from cached delivery and refuses reuse for a changed
GitHub repository. `dependency-inspection.ts` presents declared spec, resolved version, origin,
revision, delivery and executable availability from one read-only resolution frame. Info and doctor
share that frame; neither constructs services or imports executable pack modules.

The current host-pool evidence already passes all 14 dependency-cache cases, 27 installed dependency
resolution cases and 16 info cases (`/private/tmp/apack-service-host-unit-pool.log`). Inspected
assertions cover same-version/different-content publication retaining prior paths, source swaps,
changed/missing/extra files, publication failure, original origin after source removal, changed remote
origins, explicit linked selection, unchanged cache bytes and no fetch during inspection.
The separate host-pool failures repaired in `1f5db11c6` do not invalidate those individual file results.

The real producer/consumer/source-removal case is already implemented in
`packages/apack-cli/tests/commands/info.integration.spec.ts` and passed in the `d6fa2c6dc` checkpoint
(`/private/tmp/apack-inspection-external.log` and its recorded strict run). That case builds both packs,
removes producer sources and then the producer directory, and proves info/doctor retain authentic
compiled IDs and cache provenance without executing the poisoned lifecycle or changing the resolution
record. The cache checkpoint also has recorded receipt/origin/publication/source-swap mutations.
Current code inspection identifies no replacement implementation needed for this provenance contract.

This closes local origin/version/content/inspection acceptance using existing concrete evidence;
it does not claim a new integration pass. Compiler generation/input/output ownership remains under
B1–B6, and final committed-source strict acceptance remains required. No frozen-resolution mode,
cache redesign or additional package-manager scope is introduced.

## Registration and reader closure audit (2026-10-17)

Re-read current SDK `framework/pack-registration.ts` (`PackRegistration`, `PackFeature`) and
`fe/pack-fe-registration.ts` (`PackFERegistration`, `PackFEFeature`), the native declaration in
`framework/pack-catalog.ts`, snapshot parsing, backend catalog projections and frontend admission.
The discovery plan's registration inventory covers every current field. The classification is:

| Current fields / contribution | Static authority and checked execution boundary | Existing acceptance |
|---|---|---|
| IDs, revisions, dependencies, consumes | Snapshot/native declaration, common cache/build receipt and selected service admission | Catalog, declaration-binding, dependency-cache and service-binding cases |
| Feature membership, designation, default, surface presentation and endpoint events | Keyed declaration plus compiled event contracts; machines/components bind separately | Native-declarations, catalog-surfaces, catalog-navigation, backend/frontend declaration-binding |
| Entity/relation identity and optional shape | Shared normalized entity projection and `data.relations`; generated typed EARS and installed schema | Manifest consolidation evidence; snapshot and installed-schema cases |
| Pack/feature settings and custom forms | Inline definitions through catalog; frontend forms and scoped ports are checked execution | Catalog settings, native declarations, frontend admission and five real host-only window cases |
| Service/repository names and ownership | Manifest/native ownership before construction; selected runtime object/method authority remains executable | Native-api-declarations, content-binding and selected lifetime tests |
| Lifecycle/migrations | Explicit static targets/line/version/description; callable bindings checked before execution | Native-declarations, native-migrations, lifecycle and declaration-binding cases |
| Steps, artifacts and blocks | Catalog projections retain static node/style/kind/member metadata; callbacks/components remain bindings | Backend-step-catalog, native-viewers, frontend declaration-binding/viewer-reader cases |
| Content writers/appliers | Owned entity/source declarations and verified compiled index; actual writes/import remain execution | Native-content, content-binding, pack-layout and actual external authoring cases |
| Commands, reference types/categories | Keyed catalog declarations; dispatch/query providers require accepted running bindings | Command-catalog, reference readers/bindings, stored-reference window and external reference navigation |
| Tiptap/app extensions and DSL | Explicit frontend member identities; compiled DSL text is snapshot data, editor objects/components are bindings | Frontend declaration-binding, source-free CLI inspection and real cold-worker/shared-editor case |
| `bindServices`, `bindSettings` | Generated resource acquisition/revocation, not discoverable contributions | Selected service/action lifetime and scoped frontend settings cases |

The normal packs UI (`features/packs/be/system.ts`) iterates the committed catalog for installed
summaries, including problems and disabled owners. It does not construct services to list them.
The offline database schema uses shared verified installed declarations; five current cases cover
feature-owned typed/untyped entities, collisions and unreadable records. CLI info consumes
`readPackBuild` and the same read-only dependency inspection frame. Runtime repository/service
lookups, migration execution, actor readiness and content import eligibility remain execution policy;
they are not duplicate discovery inventories to remove.

Current host-pool results include all 36 native-declaration, 43 frontend binding, 34 backend binding,
20 frontend catalog, 21 backend catalog, 12 native-content, 13 native-viewer, nine native-API,
eight content-binding, 18 backend-step, five installed-schema and 41 snapshot cases passing:
`/private/tmp/apack-service-host-unit-pool.log`. Their inspected assertions include absent source
modules, poisoned runtime inspection, native metadata before binding/after unload, membership
refusal before granting authority and retained incumbent metadata on refusal. The broader pool's
unrelated repaired failures do not constitute a whole-pool green verdict.

This closes the supported registration-field classification against current code. It does not turn
historical producer checks into a final all-kind pass. Required assets, compiler lifetime/input
ownership, frontend reuse/removal, actual external app/fork acceptance and final strict validation
remain owned by the goal. No additional discovery store or runtime-only contribution was introduced.

## Refreshed external app and normal fork acceptance (2026-10-17)

The initial app preflight correctly refused the default pack after captured pack-test edits. Refreshed
only the affected producer chain, leaving captured sources unchanged throughout each build:

- `npm run build:default-setup` passes (`/private/tmp/apack-editor-checkpoint-default-build.log`).
- `APACK_CHAIN_CORES=2 npm run test:external-pack:contract` passes: both actual fixture builds/types,
  all 38 external harness cases and real default-fork build/archive/checksum preparation
  (`/private/tmp/apack-editor-checkpoint-external-contract.log`).
- `npm run test:external-pack:app` passes completely
  (`/private/tmp/apack-editor-checkpoint-external-app.log`): all 27 external fixture cases, one
  bundled-UI editor case, and four additional normal fork launch/lifecycle cases.

The external suite exercises explicit default disable/remove/restore with usable host settings,
two-window fork replacement and actual dev reload, frontend pane/form failures, inactive help,
offline JSON schema assistance, canonical references, frontend loading readiness, settings import,
independent same-named assistant groups, custom forms and cross-window edits. The real dependency
credential case proves shared mutation, owner-only refusal, generated read-only types and retired
runtime credentials after reload. The normal fork runner preserves the selected fork across a new
process, deliberately removes default-setup and its required consumer, proves absence across boot,
then restores the app-owned default and proves another normal boot. Its data directory is explicitly
test-owned and removed after completion; production data is untouched.

These app checks ran on source `031e3a521` plus goal-only ledger updates; no production code changed
throughout the producer/app sequence. Final editor review then added an explicit true assertion for
the original Monaco model before comparing its replacement snapshot (`c221a2437`). That focused
actual worker/window case passes again in 6.4s:
`/private/tmp/apack-cold-monaco-model-identity.log`. Focused lint and whitespace checks pass.

Current local app/fork acceptance is now converged; the earlier 26-pass/one-failure app result is
historical evidence rather than the current verdict. B1/B3 native/platform guarantees, integration
concurrency/suite-budget acceptance, the five-build frontend reuse/removal case, final full-scope
audit and committed-source strict `--all` remain open. No final gate pass or goal completion is claimed.

## DSL reuse identity and measured five-build acceptance (2026-10-17)

Source `3913fe196` repairs the two DSL integration cases' identity assertions after the completed
input-record contract. The source build seals `build-inputs.json`, including actual invocation options.
Building with `[]` then `['--skip-generate']` intentionally changes that source receipt. It must not
change publishable output. Both cases now compare every file/digest through the production
`stagedFileHashes` projection and separately verify both recorded option lists. Snapshot definitions,
failure retention, restored reads/cache bytes, phase reuse, frontend output and removal checks remain.
No production identity algorithm or freshness validation was changed.

The first isolated five-build run reaches its unchanged 60s deadline during build four:
`/private/tmp/apack-staged-dsl-closeout.log`. One diagnostic run with 120s reaches the stale identity
assertion in 78.20s (`/private/tmp/apack-staged-dsl-diagnostic.log`), proving a deeper assertion issue
behind the timeout. A separate source-phase-only inline probe refused stale generated entries before
its comparison (`/private/tmp/apack-dsl-reuse-identity-diff.log`); it is not passing public-CLI evidence
and was not used to justify changing production behavior.

After the identity repair, both actual DSL cases pass together on two workers:
`/private/tmp/apack-dsl-published-identity-focused.log`. The two-build source-free snapshot case takes
45.37s; the five-build publication/refusal/recovery/reuse/removal case takes 93.33s (95.12s total run).
That diagnostic command used a 120s test limit. The source now declares the same 120s limit only for
the five-build scenario, with a measured reason in the existing timeout-exception registry. General
60s test and 600s suite limits are unchanged. All 42 timeout-policy cases pass
(`/private/tmp/apack-dsl-timeout-exception-check.log`); CLI/E2E types and focused lint pass.
This closes local five-build behavior, not integration concurrency or the final strict gate.

Source `9b7d112cf` also strengthens the cold-window case with an activation marker in its poisoned
backend entry. The test asserts the marker never exists after metadata arrival/replacement/removal,
so catching a runtime exception cannot falsely establish discovery without activation. The actual
worker/window case passes in 6.4s (`/private/tmp/apack-cold-monaco-no-activation.log`). Final type logs:
`/private/tmp/apack-dsl-identity-cli-types.log` and `/private/tmp/apack-cold-monaco-final-types.log`.

## Compiler scenario concurrency acceptance (2026-10-17)

Source `545054877` gives only the two demonstrated near-deadline compiler scenarios explicit 120s
budgets through the existing exception registry. The scaffold case includes actual step/service
generation, compiler publication and authored typechecking. The linked Tailwind case includes initial
compilation and two actual watched rebuilds. Previously they passed alone in 56.93s/57.05s but reached
60s in the full two-worker pool. Assertions and both 20s watcher waits are unchanged.

The focused concurrency run explicitly caps both pool kinds at two workers and includes the scaffold's
feature-build prerequisite: all three selected cases pass in 108.70s. Actual scenario times are 59.76s
for step/service and 65.45s for linked Tailwind. Log:
`/private/tmp/apack-compiler-scenario-concurrency.log`. The deadline exceptions address demonstrated
complete-scenario cost; they do not assert a new watcher correctness fix or raise general limits.
All 42 timeout-policy cases, CLI types, focused lint and whitespace checks pass:
`/private/tmp/apack-compiler-scenario-timeout-policy.log`,
`/private/tmp/apack-compiler-scenario-types.log`.

The retained 600s full-pool attempt has only eight completed file reports, totaling 1,028.2 seconds of
file time across two workers; it does not prove a deadlock. Aggregate integration capacity remains an
open B6 issue. Do not start another broad run to diagnose it or raise every suite's budget. A bounded
profile of one ordinary compiler build is the next diagnostic before selecting a cost repair or a
specific aggregate-budget change. Keep native/platform work and the final strict gate open.

## Bounded compiler-cost and early-failure checkpoint (2026-10-17)

Source `858120200` removes exact duplicate namespace facts from each native admission batch before
snapshot materialization. Complete serialized facts are keys; differing bindings/kinds/metadata
remain present. Observation ownership, byte capture and final source/copy validation are unchanged.
No persistent cache or resource framework was added.

One synthetic public build was profiled before/after on the same authored pack. Logs retain the owned
profile directories: `/private/tmp/apack-compiler-cost-profile.log` and
`/private/tmp/apack-compiler-cost-after.log`. Profiled native preparation is 5.708s/3.372s; snapshot
inclusion is 5.284s/2.536s; worker elapsed is 15.217s/14.850s. Whole commands take 22.245s/24.079s;
the latter also rebuilds the edited CLI package. These single observations show a reduced hotspot,
not an end-to-end benchmark or aggregate capacity fix. The synthetic pack/profiles remain retained
outside user data.

All 29 module-input/read-tree cases and 15 actual captured-resolution cases pass, including inherited
aliases, absent originals, hidden package entries, outside globs and transient restored edits.
CLI types, lint and whitespace checks pass. Logs: `/private/tmp/apack-native-admission-focused.log`,
`/private/tmp/apack-native-admission-resolution.log`, `/private/tmp/apack-native-admission-types.log`.

Source `ac964c348` uses existing inherited stdio for live pool output and sets root integration
`bail: 1`. Failed/partial runs still record no passing verdict; deadlines, reporters, project coverage
and cache provenance are unchanged. Successful acceptance still requires the full population.
All 61 pool checks and four bounded-process cases pass. An isolated two-test fixture inherits the
actual integration config: intentional first failure exits 1 and never creates the later-work marker.
Scripts types and lint pass. Logs: `/private/tmp/apack-live-pool-checks.log`,
`/private/tmp/apack-live-pool-process-checks.log`, `/private/tmp/apack-live-pool-types.log`,
`/private/tmp/apack-integration-failfast-proof.log`.

The bounded cost diagnostic is finished; no further profiling loop or broad diagnostic rerun started.
Native external-library support, Windows ownership/runner access, Linux acceptance, aggregate
integration convergence and final strict acceptance remain open. The later compiler source change
also belongs to final producer/app convergence.

## Public contract documentation audit (2026-10-17)

Reviewed current surface selection, generated entry outputs, service consumption, startup, migration
scaffolding and shell harness code against the public guides. Corrected stale registration-order
default selection, runtime DSL registration, external reference restrictions, administrative versus
caller-bound service access, onboarding ownership, reset ordering, migration sidecar examples and
settings delivery status. The generated-output guide now includes settings, runtime service binding,
paths and static destination/event metadata; shell guidance describes verified build reuse.

Manifest decision 12 explicitly records `69860e4be` as a better replacement: catalog selection before
frontend loading removes delivery-order races without dropping per-surface default declarations or
uniqueness. The dated M4 paragraph remains historical and names its successor.

Evidence inspected: `apack-host/src/fe/surface-selection.ts`, `apack-host/src/packs/runtime/start.ts`,
`apack-sdk/src/framework/service-consumption.ts`, `apack-sdk/src/build/generate-entries.ts`,
`apack-cli/src/commands/add/migration.ts`, `api/src/runtime/index.ts` and
`apack-testing/src/harness.ts` (all under `packages/`). This checkpoint changes documentation only;
JSON examples parse, added relative links resolve and whitespace checks pass. No broad builds or
suites were run for prose. Existing runtime evidence is not claimed rerun on this checkpoint.

Native external-library capture, Windows descendant ownership/native runner, Linux acceptance,
integration convergence and final committed strict acceptance remain open. This audit closes the
identified documentation mismatches, not the full goal or its final acceptance register.

## A5 schema and API agreement (2026-10-17)

On committed source `b62da5c72`, the focused public-contract checks pass:

- `npm run api:check`: all 132 API reports current (2 EARS, 28 SDK, 102 UI).
- `npm run schema:check`: generated `apack.schema.json` current.
- `npm run exports:check`: UI export map and component entry modules current.

Logs: `/private/tmp/apack-final-contract-api.log`,
`/private/tmp/apack-final-contract-schema.log`, `/private/tmp/apack-final-contract-exports.log`.
The action template uses generated `Services`; service and migration templates match their current
object-export and behavior-only contracts. Public docs were corrected in `b62da5c72` against inspected
implementation. The consumption plan now incorporates the already recorded complete external app/fork
acceptance instead of leaving it labelled unexecuted.

This closes the named schema/API/export agreement check for A5 on this source, not converged strict
acceptance. Native external-input and Windows lifetime decisions/implementation, Linux evidence,
integration convergence and the final committed-source strict gate remain open. No broad suite,
producer rebuild or additional platform support claim is made by this checkpoint.

## Project fail-fast and publication-test isolation (2026-10-17)

Source `a8531f54d` repairs failures found by one converged two-worker integration attempt on
`1bae3d616`. The run reached its unchanged 600s aggregate limit and exited 1; ten completed file
reports contain 506 tests, including three failures. Other files were unfinished/unexecuted, so this
is neither complete integration acceptance nor a passing verdict. Log:
`/private/tmp/apack-converged-integration-20261017.log`. Reported complete passing files include
scaffolding, add-extensions, captured esbuild configuration, database, release simulation and repo
import checks. Those results do not stand in for the unfinished pool.

The help snapshot test exceeded 60s after performing two unrelated frontend bundles. Its unfinished
promise later restored process-wide cwd into another test's removed temporary directory, producing
two ENOENT failures. The publication file now passes explicit pack roots to every build rather than
changing cwd across awaits. The help-only snapshot/refusal case uses `--skip-fe`, retaining initial
publication, changed article, invalid H1, accepted snapshot and incumbent checks. Its 60s deadline is
unchanged. Frontend help navigation has its dedicated existing external-app case in
`tests/packs/external-pack/tests/e2e/help.spec.ts`; it is not rerun in this focused checkpoint.

The supposed fail-fast setting from `ac964c348` was also ineffective for independent project configs:
Vitest 3.2.4 forwards CLI `bail` overrides, but does not inherit root `test.bail` into those projects.
The earlier single-config proof did not cover that boundary. The integration pool now passes
`--bail=1`; the misleading root-only setting is removed. Coverage and successful-verdict rules are
unchanged. The cancelled work in other already-running projects may still need to settle.

Focused acceptance:

- All 62 pool cases pass: `/private/tmp/apack-project-bail-unit.log`.
- Actual production pool arguments, root integration configuration and an independently configured
  temporary project: first failure exits 1, later-work marker absent. The same fixture without the CLI
  flag creates that marker. `/private/tmp/apack-project-bail-proof.log` records the retained fixture
  path. Vitest labels the cancelled test pending; the proof checks the actual filesystem side effect.
- All 14 affected publication cases pass in 246.34s (247.93s runner); help takes 43.69s under its
  unchanged 60s limit. `/private/tmp/apack-output-swap-root-fix.log`.
- Scripts/repo/publish/E2E and CLI types, correctness lint and whitespace checks pass:
  `/private/tmp/apack-project-bail-types.log`, `/private/tmp/apack-output-root-types.log`,
  `/private/tmp/apack-output-root-lint.log`.

No broad rerun follows this repair. Aggregate integration capacity remains unresolved; the timeout
message's historical healthy-cost estimate does not establish a deadlock. A further full run needs a
resolved aggregate execution/budget decision, not another diagnostic repeat. Native input/platform
requirements, the converged checkpoint and final committed-source strict `--all` remain open.

## Evidence-only timeout and retry diagnostics (2026-10-17)

Source `b366ae4d5` removes the unsupported conclusion that exceeding a generous deadline on the
recorded machine proves a stall. The real progressing integration run contradicts that inference.
Timeout reports retain the enforced class/bound, termination and optional recorded-cost/machine
context, then request inspection of the retained output. They no longer infer machine-speed factors
or instruct recording a killed run as a completed measurement. Isolated retry reports likewise do not
infer absence of outside contention or rule out nondeterministic code from a passing retry.

This is a diagnostic correction, not a timeout or execution-policy change. All class deadlines,
process cleanup, failed exit statuses and stamp/verdict rules are unchanged. Removed helpers and
tests encoded the invalid inference; focused checks now cover known/unknown recorded costs, both
machine contexts, neutral timeout reporting and retention of the original failure after a passing retry.

All 185 affected graph/output/mutation cases pass in 0.88s runner time. Scripts/repo/publish/E2E types,
correctness lint and whitespace checks pass. Logs: `/private/tmp/apack-timeout-diagnostic-checks.log`,
`/private/tmp/apack-timeout-diagnostic-types.log`, `/private/tmp/apack-timeout-diagnostic-lint.log`.
No broad run follows. The goal's native/platform, aggregate acceptance and final strict requirements
remain unchanged and open.


### Live frontend native watch checkpoint (2026-10-17)

Source `ccaa809a8` connects retained frontend input discoveries and failed-candidate repair probes to
the existing watcher. Process-owned native copies are shared with late workers, and freshness IPC has
a bounded refusal. The real recovery case and four backend/Vite native regressions pass, along with
focused checks, CLI/scripts types and lint. The required strict checkpoint stopped at three repository
input/inventory omissions; those are corrected and the complete affected 951-check repository suite
passes. External authoring and external-pack contract checks passed before the stop. No complete strict
or final acceptance is claimed. [Detailed evidence and remaining scope](build-input-snapshot-proof.md#live-frontend-native-watch-and-shared-copies-2026-10-17).


## Current-source manifest audit, first pass (2026-10-18)

Inspected source `9e6901e96` against the consolidation decision table; this is the beginning of Phase 7
review, not completion or a substitute for remaining compiler work or final strict acceptance.

- The single `_packEntities` projection in SDK `framework/data-declaration.ts` supplies shape/type
  generation, module targets, provenance, CLI info/build, host schema/Packs views, native binding and
  catalog navigation. It names both owners for duplicate homes and derives flat unchanged wire names.
  `generate-entries.ts:entityShapeEntries` skips null shapes, checks exported TypeScript types and emits
  `import type`; module targets distinguish shape types from executable bindings. This source audit
  does not re-prove historical generated EARS/content identity or source-free runtime acceptance.
- Relations derive from the same declaration module. Lifecycle has explicit shared hook names and
  checked admission through `lifecycleBindingProblem`. Current authored schema is strict and exposes
  inline checks, feature descriptions, typed/untyped entity maps and direct editor/app extensions.
  A source search finds no old settings-sections, entity-shapes or checks-sidecar reader in owned code.
  Windows XML `manifestVersion` is a separate third-party format and remains intact.
- The canonical writer derives structural ordering from the schema, preserving declaration/data order;
  init, release and all manifest-mutating add commands inspected use it. The schema editor test checks
  offline completion, actual diagnostic ranges, useful descriptions and typed/untyped declarations.
- `selectDefaultSurfaceDeclaration` and public feature/manifest docs agree on enabled native-before-
  installed claims and English lexical feature-ref tie-breaking. The roadmap's first-registered claim
  was stale. Its semver/range and M6 coverage descriptions were stale too; corrected against current
  schema, accepted decision replacements and the live execution ledger, without dropping final gates.

Checks on this source: 68 cases pass across SDK manifest schema (47), JSON editor assistance (11),
module references (7), CLI canonical writing (1) and host surface selection (2), in 2.70s. These are pure
source/inert-data checks; no native fixture, copied runtime, compiler worker or live watcher executes.
`node --import tsx scripts/generate-schema.ts --check` from the SDK passes. The npm `tsx` launcher
first refused its IPC socket under sandbox EPERM; invoking the same script through the standard Node
import hook avoids that launcher-only socket.

`node --import tsx scripts/api-check.ts` refuses before extraction because local published package
inputs are stale (including lockfile and CLI inputs). No report was regenerated or gate bypassed, and
no package/native rebuild was launched locally. Current-source API-report agreement remains required
on matching built output in disposable CI, alongside all remaining final acceptance requirements.


## Settings/API current-source review and callable-service repair (2026-10-18)

Reviewed source `4cc76ef73`: host app defaults, pack/group and qualified feature ownership, the common
JSON Schema validator, sparse overrides, caller-bound settings service, WeakMap transport authority,
client/runtime grants, generated backend/frontend handles and accepted service selection. The review
finds no additional targeted-settings defect. The four pure suites (`settings-definition`,
`settings-handle`, host settings `access`, window `settings-runtime`) pass all 81 cases in 2.18s,
including invalid snapshots, two-window correlation, scoped access, disconnect and stale-runtime cases.
No LMDB/native fixture or real app is run; this does not replace real data/onboarding/final acceptance.

A concrete Phase 6 lifetime defect is reproduced separately: `createPackServiceBinding` returns any
function unchanged, although registration accepts callable service exports. After caller retirement,
a retained callable still executes. The new regression fails against that source in 14ms. The existing
facade owner now wraps functions using a fresh bound proxy target, preserving call versus construction
capability without violating frozen source-property invariants. Invocation helpers retain the facade,
so a function produced by `bind` cannot escape retirement; private method receivers keep their existing
behavior. Calls and construction check the same accepted caller/provider generation as object services.
Already-started results/streams retain the existing settlement contract; this adds no sandbox guarantee.

All 14 service-binding checks pass, including direct/bound/extracted invocation, caller/provider
replacement, constructor preservation, frozen objects, private receivers, draining owners, host
replacement, selected providers, attributed actions and real AI SDK agent receivers. Host typechecking,
focused correctness lint and diff checks accompany this repair. The settings plan's top-level claim
that whole-data API separation remained unimplemented was stale; corrected against A1–A5 and current
binding code, retaining final strict acceptance. Hosted watcher/native controls and API-report/final
strict gates still await authorized execution on matching source; no completion or exclusion is claimed.


### Callable binding construction edge

Current-source follow-up reproduces a wrapper-construction error when an exported callable owns a
custom `bind` method: the facade calls that method to create its proxy target, invoking user code and
potentially obtaining a non-object target. The added pure regression fails in 11ms with that exact
proxy-construction error. Target creation now uses the intrinsic `Function.prototype.bind`, preserving
the callable's custom `bind` as an ordinary guarded service member. All 15 binding checks, host types,
focused correctness lint and diff checks pass. This is a one-line correction to the same lifetime
owner; it adds no service restriction, new public surface or native execution.

### Windows process reader and repeated-build checkpoint (2026-10-18)

Source `11cb737e2` replaces unsafe Windows diagnostic-report queries while retaining native PATH,
actual loaded-DLL ownership and bounded helper lifetime. Short concurrency/native-environment regressions,
57 Windows models and actual Node/Electron application startup controls pass; see the
[reader evidence](build-input-snapshot-proof.md#windows-process-metadata-reader-without-diagnostic-reports--2026-10-18).
Follow-up `9adb9073f` owns both fresh builders in test teardown and records the measured Windows
two-capture budget. The [complete repeated-build case](build-input-snapshot-proof.md#windows-repeated-build-identity-and-owned-teardown--2026-10-18)
passes in 224.648s, retaining cache/output identity, source paths, archive and disposal assertions.
CLI types, focused lint and all 42 timeout-policy checks pass. Evidence is exported off the VM;
no native fixture ran on the daily-use Mac. Remaining policy/platform obligations, B6 and final
committed-source strict acceptance remain open across the full preserved goal.

### Explicit content declarations in schema and resolution (2026-10-18)

Current-source Phase 7 review finds inherited object properties counted as declarations in three
manifest checks. An undeclared `constructor` format/dependency passes validation, while a dataset
named `constructor` is falsely reported as colliding with a source. Three regressions fail on the
baseline in 13ms. The build resolver has the same inherited format lookup for both local and
dependency formats: a source gets the misleading "declares no entity" error, and a dataset can receive
a function as its resolved format. These are declaration-existence defects, not invalid authored names.

Source **`dcf2493e5`** uses the existing own-property helper in schema checks and both resolver paths.
Unknown formats/dependencies now refuse at their actual declarations; explicitly declared
`constructor` formats/dependencies and dataset names remain supported. No naming restriction,
compatibility path, new inventory, schema shape or public API is added. The SDK contributor guide's
stale claim that Settings belongs to default-setup is corrected to host ownership.

All **72** checks across manifest schema, own-key preservation, relation declarations and direct content
resolution pass (460ms runner). The existing dependency-format codegen consumer passes separately in
335ms. SDK typechecking, focused correctness lint, diff checks and schema generation/check pass;
`apack.schema.json` remains unchanged. The schema check uses `node --import tsx scripts/generate-schema.ts --check`
from `packages/apack-sdk`, because the tsx CLI's IPC listener is denied by the local sandbox.
No captured runtime/native fixture or broad suite runs on the daily-use Mac.

Evidence: `/private/tmp/apack-manifest-own-claims-red.log`,
`/private/tmp/apack-manifest-content-own-claims-{green,types,generator}.log` and
`/private/tmp/apack-manifest-own-claims-schema.log`. The converged strict checkpoint remains pending:
automatic approval review rejected the remote push as lacking separate authorization, and the
approval question is pending. Do not claim the focused checks satisfy that gate or retry the denied
push through another route. The full goal, native-policy questions and final committed-source `--all`
remain open.


## External authoring host build dependency (2026-10-18)

The user subsequently authorized pushing. Strict run
[39163655338](https://github.com/spankyed/apack/actions/runs/39163655338) tested committed
source `a74bbd88a` on disposable macOS 26 / Node 23.11.1 with two cores. It stopped after 411.1s
at `test:packaged-authoring:author`: the external pack selected the checkout through `APACK_HOST`,
but `default-setup` had no built snapshot. The step declared only publishable-package inputs and
therefore depended on `packages:ensure`, not `build:default-setup`. This is a missing graph input,
not evidence of a compiler deadline failure or another checkout deleting temporary output.

Source `268533807` adds the existing `PACK_OUTPUTS` to the author's inputs. The common graph now
orders the producer first and fingerprints its output for authoring reuse. No new scheduling rule,
timeout change or dependency fallback is added. A regression against `dependsOn(author)` fails
before the repair, reporting only `packages:ensure`; afterward all 68 tests across authoring output,
chain graph and scheduling pass in 978ms. Repo-checks and scripts typechecks, focused correctness
lint and `git diff --check` pass. Actual hosted authoring/app and converged acceptance remain pending.

Failure log: `/private/tmp/apack-strict-39163655338.log`. The run retains the chain log and per-step
reports in its uploaded validation evidence. No compiler/native test ran on the developer's Mac.


## Read-only facade verification after publication (2026-10-18)

Strict run [39166185325](https://github.com/spankyed/apack/actions/runs/39166185325), source
`31cb54f4d`, stopped after 597.0s. Package builds/checks, API/schema/exports checks and listed typechecks
passed; default-setup built in 291.5s. `facade:check` exceeded its unchanged 60s quick budget (62.0s
wall time). The concurrent external-contract step passed 38 memo-pack cases, then default-fork
preparation correctly refused changed `src/__generated__` directory observations. The retained logs
do not identify the differing entry; do not claim a particular leftover lock or file was proven.

Source `ccf86ad3a` removes the known shared writer from the chain's facade check. Explicit
`facade-report --from-build` verifies the sealed build and replays its common input record, then
normalizes the snapshot facade consumed by dependent packs. The root script and graph select that
read-only mode after `build:default-setup`, declaring built outputs as inputs. It neither regenerates
entries nor substitutes its inspecting compiler's generation stamp. Missing/stale/modified builds
refuse; there is no fallback. `--from-build` cannot combine with `--update` or `--skip-generate`.
Pack-local source derivation and deliberate report updates remain available; temporary bundle/diff
files are now disposed in all command exit paths. No timeout or validation assertion is weakened.

All 115 focused facade/graph/input cases pass in 2.14s, including real sealed filesystem data, throwing
runtime bytes, changed authored/generated inputs, changed generated-directory membership, output
integrity, CLI dispatch and conflicting flags. CLI, scripts and repo-checks typechecks and focused
correctness lint pass. An attempted wider `chain-table` run hits the existing daily-Mac guard when it
imports the compiler integration configuration; this is not bypassed or claimed passing. Existing real
facade integration coverage now also checks the read-only command and poisoned output, but its hosted
execution and converged strict acceptance remain required. No captured compiler/native batch ran locally.

Logs and per-step reports are preserved under `/private/tmp/apack-strict-39166185325/`; console log is
`/private/tmp/apack-strict-39166185325.log`. The exact cause of the facade's derivation cost remains
unprofiled; repeating that compilation is unnecessary for checking an already verified current build.
The next strict run must prove the facade read and dependent fork preparation stay coherent together.


### Hosted facade and author-half acceptance (2026-10-18)

Strict run [39167659691](https://github.com/spankyed/apack/actions/runs/39167659691) tests exact
`fcb037442` on disposable macOS 26 ARM64 / Node 23.11.1, two cores. The repaired facade check passes
in **27.7s**, within its unchanged 60s bound. Default-setup builds in 359.9s; package/API/schema/export,
listed typechecks, tier/specifier checks and lint pass. The full packaged-authoring **author half passes
in 690.1s**, including real installed tarballs, scaffold/build, harness/types, verified archive and isolated
installation. Its archive SHA256 is `cb0ee3449aae2942a7e1e1f60cba8aff3ec7b9e692c93c450c0038f4435be92e`.
The app half has not run in this checkpoint.

Release preparation is not public release readiness: dry-run reports missing GitHub credentials and
conflicting local/workflow publish ownership. Isolated installation reports default-setup not yet
installed and hostVersion not yet recorded before first app startup. These are retained observations,
not instructions to publish or modify credentials/workflows. The local archive and author handoff pass.

The chain stops after 1295.6s because `test:external-pack:contract` exceeds its unchanged 600s suite
bound. Both ordinary fixture builds and 38 memo contract cases pass; it reaches `Building pack:
Acceptance fork` without the earlier freshness refusal. No assertion failure is recorded there, but
this does not prove the fork build was making progress. No timeout is increased and no broad run is
repeated. The next bounded diagnostic profiles one real build through the existing owner on the
Windows VM to identify shared compiler hotspots; that cannot establish macOS timings. Final convergence,
the exact archive/app handoff and all still-open native/platform requirements remain required.

Console and per-step logs: `/private/tmp/apack-strict-39167659691{.log,/}`. Preserve this source/run
identity and the successful facade/author evidence instead of scheduling those as new implementation.

## Independent default-fork producer — 2026-10-18

The preserved strict run `39167659691` charged two fixture builds, their contract checks, and a full
default-pack fork build/archive to one 600s suite step. It timed out during the fork, with no assertion
failure identifying a compiler bug. The incomplete Windows profiles do not establish a hotspot; see
[diagnostic cleanup](build-input-snapshot-proof.md#short-windows-diagnostic-cleanup--2026-10-18).

`test:external-pack:fork` now owns the existing preparation script and its published archive directory
as an independent cached chain producer. Fixture contracts retain their own output; app acceptance
requires both producer edges. The combined manual command still performs contracts, fork preparation
and app checks in that order. Missing-fork guidance names the new producer. Source imports and their
workspace dependency closure are declared alongside the shipped build and compiler package inputs.
The existing archive digest, shipped-revision/current-input verification, isolated build and runtime
checks remain intact. Each producer retains the existing suite class; neither its 600s deadline nor the
build/archive operation limits increased. The new non-gating cost estimate explicitly borrows the
existing shipped-build estimate; it is not a completed fork-duration measurement.

Validation: all 120 focused graph/input/scheduler cases pass (2.37s); scripts, repo-checks and E2E
TypeScript checks pass; affected-file lint, shell syntax, tier checks and diff checks pass. Restoring
the old combined producer call makes the new regression fail; original bytes restored afterward
(`/private/tmp/apack-fork-producer-mutation.log`). The dry chain recognizes the independent producer
and app dependency. The observation-ledger integration expectation includes the new producer because
no per-step compiler dep-file verifies its entire work; that integration case awaits hosted execution.

Remaining evidence: the required hosted strict run must prove the fork completes within its own
unchanged limit and both app halves consume their exact prepared outputs. Splitting producer/cache
ownership does not prove a standalone fork build is fast enough or diagnose the prior worker slowdown.
No further compiler-performance redesign or timeout increase is implied.

Source checkpoint: **`d0ab6dd6b`**, pushed under existing authorization. Hosted strict run
[`39172886664`](https://github.com/spankyed/apack/actions/runs/39172886664) is confirmed in progress
on exactly that commit, with dependency installation active when checked. No passing strict result
is claimed. The private diagnostic SSH observer also terminated with exit 1 and its saved stopped
result; there is no remaining live diagnostic handle.

## Packaged Windows query expectation — 2026-10-18

Source `39352b2c7` fixes one stale pure unit expectation left by `11cb737e2`: the query now invokes
the packaged `compiler-pe-process.ps1` with a JSON request rather than inline PowerShell. The old
expectation fails in isolation; all 67 adjacent PE unit cases pass after correction (496ms), as do
CLI types, focused lint and diff checks. This is a fixture mismatch, not a new runtime defect.
The active strict run remains pinned to `d0ab6dd6b`; it has not been cancelled or restarted.

## Runtime selection inputs reach compiler watches — 2026-10-18

`readCompilerRuntimeInputs` already included selected Windows activation manifests/policies in runtime
identity, but `readCompilerWatchTools` subscribed through its copy callback. OS selectors are intentionally
not copied, so an event on a selected policy file could not invalidate tooling discovery. The existing
helper already reads the selected [assembly policy path](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-activation_context_assembly_detailed_information); no new selector engine is needed.

The runtime reader now accepts the existing `BuildInputObserver` separately from `onFile`. Successful
context inputs and failed-context repair observations feed the same tooling/watch owner, including
uncopied OS files, missing candidates and directory membership. Copy selection, runtime identity,
loader policy, deadlines and activation behavior remain unchanged. No registry watcher or global policy
mutation is introduced.

All **89** relevant pure runtime/watch/PE cases pass in 2.74s; five platform/live cases are deliberately
skipped on the daily Mac. Restoring the previous runtime/watch implementation makes all three new
selector regressions fail (`/private/tmp/apack-runtime-policy-mutation.log`). CLI types, focused
correctness lint and diff checks pass. Inert Windows-path/metadata fixtures prove that OS selectors
reach subscriptions while only executable bytes reach the copy callback.

Real Windows acceptance uses exact base **`39352b2c7` plus the preserved source patch**, Windows Server
2025 x64 / Node 23.11.1, matching package builds and two cores. The existing Node application-context
case passes **22.610s**, one selected/executed test, 23 skipped, exit 0. Added assertions prove actual
manifest/configuration/private-assembly/directory observations; existing ordinary-loader, copied-runtime,
exact-DLL and refusal-before-initialization assertions remain. This is not a live installed publisher-policy
mutation, a registry-notification guarantee or complete native/platform acceptance.

Evidence: `/private/tmp/apack-runtime-selectors-39352b2c7.zip`, ten inspected entries with exact patch,
command, source/platform, package log, test log, JSON report and exit code. VM overlay preserved in
additional scoped stash **`b52b42dcd7013a1e5c36120149d7ef3eb1d808ec`**; prior stashes and the pre-existing
launcher line-ending change are untouched. No compiler/test processes remained before deallocation.
The existing hosted strict run is still pinned to `d0ab6dd6b`; this repair requires the later converged gate.

Source checkpoint: **`2a0e9efc0`**. Azure confirms `VM deallocated`; the focused SSH observer
terminated with exit 0. The hosted strict gate remains live on its earlier pinned source.

## Fork producer core reservation — 2026-10-18

Source **`e24103ebf`** corrects an omission in the `d0ab6dd6b` split: absent entries default to one, while the
full shipped-pack build reserves two. Fork preparation runs that same pack build with fixture edits,
then archives it serially. It now shares the existing `PACK_BUILD_WIDTH` reservation with
`build:default-setup`; this borrows that build's measured reservation, not a new fork CPU measurement.
A regression fails against the previous declaration (one versus two) and confirms the real scheduler
keeps fork preparation separate from another step on a two-core budget. All **84** focused scheduler,
graph and core-budget cases pass in 962ms; scripts/repo-checks types, focused lint, dry scheduling and
diff checks pass. The dry plan reports the fork as two cores. No timeout class or deadline changes.
The in-progress strict run remains pinned to `d0ab6dd6b`; its cause/results remain unproven until
retained output is available. This correction does not attribute that run's elapsed time to contention.

## Independent producers accepted; cold helper imports repaired — 2026-10-18

[Strict run `39172886664`](https://github.com/spankyed/apack/actions/runs/39172886664), exact source
**`d0ab6dd6b`**, finished with a host-unit failure after 1675.0s. Both fixture contracts (**340.6s**)
and the independent fork build/archive (**497.2s**) pass under their unchanged 600s bounds. The fork
archive SHA256 is `f80902ee3ee8464f7fc72984a3562de6aa1b9b8f09635cae4ef0db1ae743d17e`.
Packaged authoring's full author half passes in **431.6s**, archive SHA256
`1ed726ebece2bfd89841c782944195ecd556601b71eab13625b9b9eb2a38704a`. Its local dry-run/install
evidence boundaries still apply; neither app half starts in this failed run. Default-setup build,
facade (33.6s), schema/API/export agreement, all reached typechecks, specifiers, tiers and lint pass.
The former aggregate fork timeout no longer reproduces. No compiler-performance repair or another
profile is justified by this result. The later two-core reservation correction remains separately tested.

Host units report 470 passing files/5586 passing tests, three suite-collection errors and two failed
tests. One is the packaged-query expectation already repaired in `39352b2c7`. Three collection errors
share eager `createTest()` host validation: importing a driver/session helper constructs the default
Playwright fixture and requires app output before any app is requested. Host resolution now occurs
inside `electronApp`, before freshness checks, data setup or launch. All existing host validation and
identity-conflict rules remain. The spawning unit also used the real checkout despite mocking spawn;
it now owns a minimal inert checkout with its required files. Production spawn validation is unchanged.

The new registration regression fails against the eager implementation during collection. After the
repair, **70** affected tests pass in 3.64s with `APACK_HOST_ROOT` deliberately pointing to an unusable
path, exercising source session imports and the freshly rebuilt distribution's `createAppDriver`.
No app launches. Testing/CLI types, focused lint and diff checks pass. This avoids turning pure helper
imports into app-dependent tests or adding app build outputs to the unit pool.

Retained evidence: `/private/tmp/apack-strict-39172886664.log`, cleaned console
`/private/tmp/apack-strict-39172886664-clean.log`, and the complete downloaded per-step logs beneath
`/private/tmp/apack-strict-39172886664/`. The next required committed-source gate must include the
unreached runtime/app/integration legs. The workflow's whole-job cap becomes 60m because this cold
run consumed 28m before those legs; all individual step budgets remain unchanged. No fresh broad run
starts until this focused checkpoint is reviewed and committed. Native/platform closure still follows
the preserved goal register.

Source checkpoint: **`9b056f4ab`**, pushed. The required strict run
[`39175530615`](https://github.com/spankyed/apack/actions/runs/39175530615) is confirmed active
on that exact source. No earlier run remains active, and no passing final gate is claimed.

## Windows Electron build/archive and typecheck admission — 2026-10-18

Source checkpoints `04a876675` and `3827993ba` are pushed. Strict run `39175530615` on
`9b056f4ab` stopped at the quick pack-typecheck bound (62s including teardown), without a type
diagnostic; the preceding run passed in 51.6s. Two ordinary local cold Vue compiler runs measured
24.72s CPU / 14.66s wall and 24.95s / 14.65s wall, approximately 1.7 cores. The second `time -p`
command exited zero; the first had no type diagnostics but `time -l` failed collecting sandboxed
`sysctl` statistics. Reservation now uses two cores; the quick 60s deadline is unchanged. All 86
scheduler/core/graph checks, scripts/repo/publish/E2E types and focused lint pass. This is admission
evidence, not proof of the exact hosted slowdown's cause. Local measurement logs are
`/private/tmp/apack-pack-typecheck-isolated{,-2}{,-time}.log`.

A real public-CLI scaffold/feature/build/archive proof on Windows Server 2025 x64 first exposed an
archive defect after a successful Electron build. The missing filesystem probe
`path.join(root, root)` contains a second Windows drive prefix. `path.relative` shortened it into
a drive-prefixed suffix, which replay resolved as the existing pack root. The native missing query
was correct; its serialized identity was wrong. A focused Windows regression reproduces precisely
that refusal before the fix. `relativeCompilerPath` now preserves the original absolute location
whenever a relative suffix would itself be absolute. No observation, allowance or refusal is relaxed.
All seven adjacent real Windows replay checks pass; 34 local focused checks pass (one Windows-only
case skipped), along with host types and lint.

The existing owned proof was reused against exact committed source `3827993ba9398f570c5cafda9ba25d3ec9f8cbfc`.
It preserves the previous failed dist, uses the same scaffolded source and public `apack pack build`
and `pack archive` paths, and runs sequentially with two cores. Build **passes in 178.554s**; archive
**passes in 13.294s**. Actual worker metadata proves captured **Electron 37.2.4 / Node 22.17.1**,
ABI 136, distinct captured executable and executable retirement. Backend and frontend output are
present. The successful input record retains the complete double-drive missing query rather than
aliasing the real root. All Node/Electron/esbuild/MSVC processes are absent afterward. This closes
the named full Windows Electron compilation gap, not arbitrary native I/O or every runtime/addon
combination.

- Revision: `5e53205bd6393785cc4cfba5d9329267afee07bf862945ba2850c8970cff24d2`.
- Archive SHA-256: `b6190a4f3e7428ba80b8ef222a898be69d892a32ed6cf5ca7607a0218ce5c023`.
- Export: `/private/tmp/apack-electron-cli-3827993ba.zip`, 58 files, checked after download. Includes
  control scripts, runtime/source/OS metadata, accepted and original failed dist, logs, red/green
  regression and archive. The workspace's node_modules junction is excluded.
- VM evidence: `C:\apack-setup\runs\electron-cli-3827993ba`; original retained workspace at
  `C:\apack-setup\runs\electron-cli-e5ffd9468`.
- Scoped validated overlay remains stashed as `01790727e69a9ffb5b2e91e1607076e4fe69c297`; all prior
  saved work is preserved. Only the preexisting CLI-bin line-ending status remains on the VM.

Required strict run [39177912229](https://github.com/spankyed/apack/actions/runs/39177912229)
is dispatched on `3827993ba`, after both demonstrated causes were fixed and focused checks passed.
It must prove the unchanged deadlines, remaining integration/runtime/app stages and exact archive
consumption; dispatch is not acceptance. The finite native closure register and all goal phases
remain required.

The Windows VM is confirmed `PowerState/deallocated` after the export. Strict job
`117824308867` is live on the pinned source; setup succeeded and dependency installation is running.

## Final contract audit continuity — 2026-10-18

Inspected current `3827993ba` against manifest audit `a74bbd88a` and field-classification checkpoint
`031e3a521`. SDK declarations, host catalog/registration readers, entity/shape generation, validation,
authoring and canonical writer retain their audited blobs. The later host service-binding change is
the separately reviewed callable-retirement repair, with its 14 binding and 81 settings checks already
recorded. No dependency provenance or shipped replacement implementation changed. Current entity
normalization uses one Map across pack/feature homes, names both owners, and derives flat identities;
module-reference parsing still separates type declarations from executable binding purpose.

The only later CLI public-doc delta documents the verified read-only facade report path; source review
confirms its incompatible-option refusal and required common input/integrity validation. The final
acceptance register now reflects already accepted editor, discovery and replacement work rather than
rescheduling those migrations from stale labels. This does not re-prove historical EARS/content byte
identity or replace current strict schema/API/external runtime acceptance. Remaining native selection
requirements retain their explicit open disposition; no new counterexample or policy exclusion was
established by this audit. Strict run `39177912229` remains the sole active broad gate.

## Packaged authoring clock exhaustion and producer reservation — 2026-10-19

Strict run [39177912229](https://github.com/spankyed/apack/actions/runs/39177912229), exact
source `3827993ba`, is terminal failure after 1776.0s. The authoring producer reaches its unchanged
900s scenario budget (902s including group cleanup). Its phase reports account for about **898s**
before the archive-install phase: packages 9s, initial install 26s, init/feature authoring 236s,
fixture augmentation 7s, first real build 319s, harness 13s, published types 11s and release dry-run
277s. Both build and release archive/checksum succeeded. The timer fires just after install starts;
it does not demonstrate a stuck install, missing handoff or a compiler error.

The external-contract producer finished at 00:09:32Z after 521.6s, implying start near 00:00:50Z.
Authoring's 902s ends at 00:17:37Z, implying start near 00:02:35Z: the two real pack-building producers
overlap for about seven minutes while each reserves one core. Both execute the existing backend/Vue
compiler pipeline; authoring repeats it for release. They now use the existing `PACK_BUILD_WIDTH`
two-core class, already measured for full pack compilation and reused by fork preparation. This is
not a new direct CPU measurement of either entire producer. It corrects admission without claiming
to explain all hosted latency or increasing the scenario deadline.

All **88** scheduler/core/graph checks pass in 731ms. The actual scheduler refuses co-admission for
each producer on a two-core budget; temporarily restoring their old weights fails both new rows,
with the fork row still passing. Source is restored afterward. Scripts types, focused lint and diff
checks pass. No broad rerun diagnoses this failure; converged hosted acceptance remains required.
Other reached passes include default-setup build (553.4s), external contracts (521.6s), facade/report
and the recorded schema/API/export/typecheck legs. Pack typecheck, fork preparation, host/pack unit
pools, integration/runtime and app halves were not reached; do not claim their acceptance.

Retained evidence:

- `/private/tmp/apack-strict-39177912229{,-clean}.log`.
- `/private/tmp/apack-strict-39177912229/`, including hidden per-step logs and the complete author log.
- `/private/tmp/apack-authoring-core-{reservation,mutation}.log` and
  `/private/tmp/apack-authoring-core-scripts-types.log`.

This repair does not change release scripts, compiler semantics, output integrity, handoff ownership
or any per-step timeout. Keep the separate signed Electron runtime proof and full goal obligations.


## Strict host tests accepted, obsolete annotation removed — 2026-10-19

[Strict run `39182963669`](https://github.com/spankyed/apack/actions/runs/39182963669) is a terminal
failure on exact **`bc0a4e91c379cb4c5edbdb3dfe4a853039617f46`**, after **1748.1s** on two cores.
All 5,654 host tests in 477 files pass, with seven declared skips. The host pool then rejects the LMDB
persistence file's obsolete `@slow` header: the file runs in 1.129s, below its whole-half 1.2s p90 and
the existing absolute floor. There is no failed functional assertion or step timeout in this run.

Source **`31a8e5a24`** removes that seven-line historical performance header. Byte comparison proves
all imports and all 48 test bodies are unchanged; the reader-slot regression still performs 200
transactions and retains its local explanation. Those 48 cases pass in the hosted run. All **70**
scanner/placement checks pass locally, and an actual `markedSpecs` scan confirms that file is no longer
marked. Neither the placement gate nor any test/deadline is weakened. Two unnecessary local LMDB
attempts did not establish acceptance (fork IPC closed; thread process exited 134 without a diagnostic).
They are retained, not claimed as passes or retried as a new native-debugging task. The isolated pure
scanner invocation exits successfully; the hosted unchanged-body result owns LMDB acceptance.

Reached evidence:

| Stage | Outcome |
|---|---|
| Packages, API reports, schema, exports, lint, tiers, specifiers and reached host types | Pass |
| Default pack build | Pass, 287.9s |
| Facade verification | Pass, 32.7s |
| External contract producer | Pass, 400.3s |
| Default-fork producer | Pass, 537.5s |
| Pack typecheck | Pass, 37.9s under unchanged 60s bound |
| Host unit assertions | 5,654 pass; 7 declared skips; pool fails only on stale annotation |
| Packaged-authoring author, pack unit pool, integration, runtime, smoke and app consumers | Not reached; no acceptance claimed |

The scheduler repairs now have real contract/fork/pack-typecheck acceptance. The author producer's
two-core reservation still lacks current real author/app acceptance because that step was not admitted
before failure. Preserve that distinction and the unchanged scenario bounds. No further compiler or
scheduling redesign follows from this annotation failure. Finish the remaining focused requirements,
then run the required converged/final strict gates on committed source.

Evidence: `/private/tmp/apack-strict-39182963669{,-chain}-clean.log`, the retained per-step tree at
`/private/tmp/apack-strict-39182963669/`, and
`/private/tmp/apack-persistence-marker-{39182963669,focused,scanner}.log`. The original failed-run
console is `/private/tmp/apack-strict-39182963669-failed.log`.

## Completion review: manifest and settings source contracts — 2026-10-19

Review baseline `945e80c15`; usable repair checkpoint **`31ed0dcad`**. This is a current-source audit,
not a declaration of whole-goal completion. The complete 17-decision/two-question inventory remains
[manifest consolidation](../../plans/manifest-consolidation.md); no phase, check or unfinished requirement
is removed here.

| Decisions inspected | Current source evidence / result |
|---|---|
| 1, 7, 16 — authoring and canonical writing | `manifest-writer.ts` derives structural ordering from the current schema, preserving declaration/data order. Init, every add writer and release use it. Found and repaired inherited-property collisions in add helpers; the exact defect and acceptance are below. |
| 2, 3, 4 — references, entities and relations | SDK `data-declaration.ts` supplies `_packEntities`, `_packEntityTypes`, `_packRelationTypes`; module targets, generators, provenance, CLI inspection and host binding checks consume those projections. `entityShapeEntries` checks `hasTypeExport` and emits type-only imports; null shapes emit no shape import. Ownership does not qualify entity wires. Source inspection does not replace final typed/untyped/generated/EARS acceptance. |
| 5 — removed pack storage policy | No policy is restored. Found a deleted partition-policy API's prose attached to `getLifecycleHooks`; corrected it to describe the actual registered lifecycle hook list. This changes no storage behavior. |
| 6, 8, 9, 10, 12, 13 — declarations and bindings | Current schema uses required feature descriptions, explicit contribution targets, extensions and lifecycle. Host `declaration-binding.ts` checks entity/relation identities, feature/designation membership, APIs, content, commands, events, migrations and lifecycle against accepted declarations. `lifecycle-binding.ts` checks exact names/callability without invoking hooks. Existing registration tests include nonmatching designation/id and attributed cross-pack collisions. Runtime order/readiness and real external paths still require their final acceptance. |
| 11, 14, 15, 17 — assistance, format, naming and checks | `declaration-schema.ts` declares purpose-specific descriptions, `hostVersion`, direct editor/app extension fields and inline checks; `pack-checks.ts` owns the allowable check vocabulary. Current code search across packages/scripts/tests finds no old settings section APIs, entity-shape map, manifest format key or check sidecar references. Build-format stamps/release metadata are untouched. Schema/API/editor derivation and external authoring remain required gates, not consequences of this search. |
| Both naming questions | Current authored schema uses `extensions.textEditor`, `extensions.appExtensions` and `hostVersion`. No frontend wrapper or alternative range key is introduced. |

Settings source review confirms fixed app/pack/feature ownership in `document.ts`, host-owned app
definitions, pack-scoped service callers and declaration-aware authorization in the store. Transport
access uses host-issued connection/runtime leases rather than event-supplied identities. Backup validation
uses the current declarative catalog without importing an obsolete settings assembly. The prior accepted
three-owner, lifecycle, reset/import, restrictions, forms and window cases remain required; the review
alone does not establish their final runtime acceptance.

### Demonstrated authoring defect and repair

Add helpers used `record[name]` to detect existing declarations. A valid name `constructor` therefore
collided with inherited properties for features, steps, artifacts, blocks, pack services and feature
services. Missing-feature lookup could also select an inherited object. Seven focused regressions fail
on the original implementation; the repaired helpers use the existing shared `hasOwn` operation and
require an owned target feature. They retain real duplicate refusal and schema acceptance of each
new declaration.

An additional real command regression shows `add service --feature constructor` leaves source files
behind even when its now-correct manifest lookup refuses the missing feature. Moving the shared manifest
operation ahead of file creation repairs that refusal boundary and removes duplicated pack/feature
service writing. The manifest stays byte-identical and no source directory appears on refusal. This
is not general filesystem transaction machinery or a new security/isolation claim.

All **nine** focused authoring/writer checks pass after both fixes; CLI TypeScript and correctness lint
pass. Red/green evidence is `/private/tmp/apack-authoring-{ownership-red,ownership-green,refusal-red,ownership-final,ownership-types,ownership-lint}.log`.
No runtime storage, release metadata, schema or public API changes are made.

### Live convergence gate and proof boundary

Required strict run [39191666077](https://github.com/spankyed/apack/actions/runs/39191666077)
is live on exact committed baseline **`945e80c150b63d761ecf45434bc1d1bbe29cc1db`**. It runs the existing
strict `--all --cores 2 --no-classify` command on a disposable macOS runner. It must reach producer,
packaged-authoring and app-consumer stages not reached by the previous host-pool failure; no earlier
partial result is promoted to their acceptance. It does **not** contain `31ed0dcad`, so its result cannot
certify that later repair or serve as the final gate for changed source. Do not cancel/restart it for
that reason; preserve its stage evidence and finish source review before the final committed-source run.
The chain's ordinary smoke/external/authoring app steps are gates; general root E2E remains opt-in.
Preserve the separately recorded affected real-window checks rather than claiming `--all` selects every
browser case. Bound-only PE disposition, any specifically named outstanding native combination and
all final completion/archive obligations remain open.

## Completion review: consumed APIs, provenance and shipped ownership — 2026-10-19

Source **`eb552cf65`** repairs a concrete A3 service-facade defect found during the current-source
Phase 6 review. The review preserves all three workstreams and their final external runtime gates.

`createPackServiceBinding` used a non-array object target for every nested service object, including
arrays. A provider exposing frozen array metadata therefore produced `Array.isArray(...) === false`
and object-shaped JSON. The new regression fails at array detection on the prior source. Reusing the
same facade with an array target preserves array detection, serialization, iteration, keys and length
reflection. Its non-configurable length descriptor remains consistent with the target. Calls/property
access still check the accepted caller/provider generation; this is not a new security membrane or a
promise of transparent behavior for every native JavaScript object.

Two cases cover caller retirement and provider replacement reusing the exact same frozen service and
array. Destructured array methods work while accepted, refuse after retirement, and cannot mutate the
frozen provider metadata. Existing private-receiver, callable/constructor, agent/stream and independent
host binding cases remain intact. All **46** focused cases pass: service binding **17**, dependency
cache **14**, replacement **15**, in 2.58s total. Host TypeScript and correctness lint pass. Evidence:
`/private/tmp/apack-service-array-{red,green}.log` and `/private/tmp/apack-phase6-review-{focused,types,lint}.log`.
No public signature/schema, stored data, release metadata, process owner or platform configuration changes.

The remaining inspected Phase 6 paths show no additional demonstrated defect:

- Consumed providers resolve through accepted declaration selection, with separate caller and provider
  generations. Retained functions validate both before invoking the original receiver; started ordinary
  results/streams retain their explicit settlement behavior. Settings use the caller-scoped writer and
  subscription owner, while administration/onboarding remain distinct declared host APIs.
- Dependency cache publication validates the captured snapshot and producer receipt against the exact
  ID/version/content identity, copies into a private incoming directory, validates the copy, and switches
  its resolution record only under the existing publication lock. Snapshot-only caches admit type data
  without executable files. Existing tests cover same-version/different-content reuse, malformed receipts,
  wrong IDs, poisoned additions and incumbent retention on copy/record failures.
- Shipped installation reads explicit app/user ownership and removal suppression, preserving a user fork
  without hash-based adoption. Restore checks the requested ID/source revision and explicitly enables app
  ownership. Ordinary app refresh retains disablement. Candidate files and installation-record rollback
  use existing publication owners; failure is not represented as rollback of arbitrary activation effects.
  Existing external tests exercise two-window reload, normal boot, removal and restoration.

These source checks and focused tests complement the existing external evidence; they do not replace
current committed-source producer/app/window acceptance. Strict run `39191666077` remains live on
`945e80c15` and contains neither this repair nor `31ed0dcad`. Preserve that run and its evidence; finish
the remaining audit/dispositions before the required final-source strict gate. No additional broad or
native suite was launched for this review, and the Windows VM remains deallocated.


## Strict convergence reaches pack tests; native watch recovery timeout — 2026-10-19

[Run `39191666077`](https://github.com/spankyed/apack/actions/runs/39191666077) is terminal on
exact source **`945e80c150b63d761ecf45434bc1d1bbe29cc1db`**, failing integration after **1877.8s**
with two cores. The old host annotation failure is resolved: all **5,657** host cases (477 files,
7 declared skips) and **889** pack cases (120 passing files, 2 declared test skips) pass. Reached
schema/API/exports/type/lint checks, external contract **225.1s**, fork producer **315.8s**, pack types
**23.2s**, default build **430.6s** and facade reader **30.8s** also pass. No unreached authoring,
app-runtime, smoke or app-consumer stage is accepted.

Integration runs **333.1s**, with 410 passing assertions before fail-fast. Its single failure is
`watches external Vite native changes and repairs a failed generation through newly discovered inputs`
at the unchanged **120-second case deadline**, not the suite deadline. Its checkpoints are watch ready
42.018s, frontend ready 44.295s, unchanged-touch verification 48.587s, expected missing-dependency
refusal 64.743s and new dependency copied 64.757s. Subsequent frontend/backend build output shows the
repair rebuild did start. There is no `repair published` checkpoint before expiry. The specific late
stage and slowdown-versus-stall cause remain unproven; do not assert a missed watch event or raise
deadlines from this log alone. Interleaved raw child stderr from other integration cases must not be
attributed to the watch owner without matching fixture/process evidence.

The same run accepts actual Electron compilation/archive in **111.603s**, retained Vite ESM preload/
loader tracking in **31.059s**, repeated public builds in **101.381s**, content-worker external reads
in **43.867s** and changed loader-input compilation in **95.069s**. Preserve those exact accepted paths;
the later native cases/files stopped by fail-fast remain unaccepted by this run.

Retained per-step evidence is `/private/tmp/apack-strict-39191666077/`, uploaded archive ID
`12161660363`, zip SHA-256 `b0bca4fc2c1283941e90feb939242727c8c2f7fbd0a6b1ddb6cc9f735e49373a`.
Clean extracted logs use `/private/tmp/apack-strict-39191666077-{chain-clean,test-integration,test-unit-host,test-unit-pack}.log`;
full failure output is `/private/tmp/apack-strict-39191666077-failed.log`.

Focused macOS [run `39194487906`](https://github.com/spankyed/apack/actions/runs/39194487906)
is active on **`b51556f8e01fe950e81ad345b823d3607ffd8c54`**, selecting only that exact recovery case
with the unchanged 120s bound. This is the existing disposable macOS route, one Vitest thread and a
two-core budget, with no local native execution or Windows VM start. Inspect its terminal case count,
phase timings and result before choosing the next diagnostic or fix. No new broad run is dispatched.
The completed broad gate does not contain `31ed0dcad` or `eb552cf65`; their focused checks remain
separate. Required final current-source strict acceptance, app handoffs and the pending bound-only
support disposition remain open. The archive-reference audit finds no affected links outside `docs/`,
so the planned documentation moves need not alter captured pack-owned input files.


### Native watch recovery: isolated deadline and bounded completion probe

Focused [39194487906](https://github.com/spankyed/apack/actions/runs/39194487906) is terminal
on `b51556f8e`, selecting exactly the native-watch case. It also fails at the unchanged **120s** limit:
watch ready **72.453s**, frontend ready **78.327s**, unchanged touch **80.872s**, expected refusal
**93.492s**, dependency repair **93.507s**. The final frontend/backend rebuild starts and prints reused
facade output; only 26.5s remains for its completion. Isolation therefore does not establish a pass or
prove cross-file contention caused the broad failure. Log:
`/private/tmp/apack-native-watch-39194487906-failed.log`. No JSON archive was uploaded by this workflow;
use the complete retained job log, not a nonexistent passing report.

Vitest's outer timeout does not throw into the pending async test body, so its `finally` cannot be
relied on to close active owners at that boundary. GitHub's final cleanup terminates Node/esbuild
processes after this isolated failure. This justifies registering the existing watcher/builder teardown
with `onTestFinished`; it does not establish a new product lifetime defect or justify a resource framework.

One isolated diagnostic is committed as **`146bc2b6e`** on
`session/native-watch-recovery-diagnostic`, with its own worktree at
`/private/tmp/apack-native-watch-recovery-diagnostic`. It shares no dependencies, generated output,
staging index or profiles with the main checkout. Main source remains unchanged. The diagnostic
extends only this case's outer envelope to **240s**, retains all assertions and both 20s missing-event
waits, logs rebuild start/completion and closes existing owners through one idempotent teardown used
by both `finally` and `onTestFinished`. Failed fixture files are retained; successful fixtures are
removed after assertions/closure. This is observation source, not approved final timeout policy.

[39195118565](https://github.com/spankyed/apack/actions/runs/39195118565) is the single live
reproducer on that exact diagnostic commit. Its terminal result must establish whether repair actually
finishes and which phase consumes the remaining time. Do not count an eventual longer-envelope pass
as acceptance of the original 120s check or merge the diagnostic blindly. Keep further validation
focused until the demonstrated cause or measured sequential-scenario cost is understood. The pending
bound-only decision, remaining integration cases/app halves and final current-source strict gate remain
required. No local native execution, VM startup, production-data operation or new broad run occurs.


### Native watch completion measured; single-scenario budget repaired

Diagnostic [39195118565](https://github.com/spankyed/apack/actions/runs/39195118565) succeeds
on exact source **`146bc2b6e7695125e9f282ccbb22d68c4a24d3d1`**. Its verifier confirms **one executed
passing case**, not a filter selecting nothing. The entire case takes **239.827s** under its diagnostic
240s envelope, with the following elapsed phase checkpoints:

| Phase | Elapsed |
|---|---|
| Initial watch/backend ready | 103.138s |
| Initial frontend ready | 111.360s |
| Unchanged-touch check | 118.447s |
| Expected missing-dependency refusal | 146.231s |
| New dependency repaired | 146.269s |
| Detected repair rebuild starts | 163.999s |
| Repair rebuild completes | 229.790s |
| Repair published | 236.952s |
| Existing owners close | 238.580s |

All original assertions pass: the incumbent stays usable on refusal, repair outside authored inputs
is detected, one successful publication replaces the old frontend, the old PID retires and actual
native values are exactly `[11, 22]`. Thus this control establishes completed recovery and measured
sequential work; it is not evidence of a missed event or a deadlocked final build. Variation in setup
cost is observed across the three runs; its machine/OS-level cause is not established and no general
compiler/performance redesign is inferred. Log: `/private/tmp/apack-native-watch-39195118565.log`;
clean copy: `/private/tmp/apack-native-watch-39195118565-clean.log`.

Reviewed main checkpoint **`bc53fed70`** keeps every assertion, both **20s missing-event waits** and
the **2s publication observation wait**. Only this complete sequential scenario gets **300s**; the
240s probe had less than one second of outer headroom after fixture construction. The documented
exception now cites this actual control instead of the earlier 98.76s implementation. No suite,
worker, product-operation or unrelated case deadline is increased.

The same checkpoint registers one idempotent cleanup with both `finally` and `onTestFinished`, using
the existing watcher and builder owners. It attempts builder cleanup even if watcher closure fails,
restores the environment/console spy, and retains failed fixtures. Main additionally keeps fixture
files when cleanup fails and reports that failure accurately; successful cleanup deletes them only
after body assertions and both owners finish. The positive control measures successful teardown;
no separate forced-timeout teardown control is claimed.

All **53** timeout-policy/subprocess-inventory checks, CLI TypeScript, correctness lint and whitespace
checks pass. Logs: `/private/tmp/apack-native-watch-budget-{checks,types,lint}.log`. The unmodified
production compiler/watch path remains the one measured by the probe. Diagnostic branch/worktree
`session/native-watch-recovery-diagnostic` / `/private/tmp/apack-native-watch-recovery-diagnostic`
is preserved, with no shared dependencies/generated output or blind merge. Required whole affected
integration/current-source strict acceptance and authoring/app handoffs remain open; the pending
bound-only scope question is not resolved or excluded by this timing repair.

### Current-source strict acceptance dispatched — 2026-10-19

Run [39196299955](https://github.com/spankyed/apack/actions/runs/39196299955) targets exact
committed source **`55c9e1f54f057bbd637e389db619bbba59886871`**. The main tree is clean and the
remote branch matches. No earlier main-branch validation run was active when dispatched.

Command: `gh workflow run ci.yml --ref session/settings-pack-contracts -f strict_chain=true`.
This selects the disposable macOS strict chain with two cores, including the affected integration
suite, packaged-authoring handoffs, runtime build and app checks that earlier fail-fast runs did not
reach. It includes the reviewed authoring/service-array fixes and the scoped native-watch repair.
Dispatch and queued-job metadata prove only that acceptance is scheduled; no passing result is claimed.
The unresolved bound-only disposition remains independently required. No local native process,
Windows VM startup or duplicate diagnostic run is needed for this gate.

### Strict watch recovery accepted; next preload case times out — 2026-10-19

[39196299955](https://github.com/spankyed/apack/actions/runs/39196299955) fails on exact
`55c9e1f54` after **2039.2s**. All **5,667 host** tests pass (478 files, seven declared skips), as do
**889 pack** tests (120 passing files, two declared test skips), schema/API/exports/types/lint,
external contract (229.3s), fork (474.9s) and pack typecheck (37.9s). Native-watch recovery passes in
**113.668s**: repair starts at 77.671s, completes at 108.939s, publishes at 112.408s and existing
owners close at 113.371s. Its demonstrated timeout is resolved on main source `bc53fed70`.

Integration stops after **420 passing assertions** at the next backend native-preload case's
unchanged **60s** outer limit (60.911s reported). The initial build completes, followed by two
package-ensure messages, but the current log has no phase attribution for the remaining control,
refusal and cleanup work. Do not infer a stalled build or raise a deadline from that alone.
The thread variant and later native cases are not executed after fail-fast; most integration files,
authoring halves, runtime build and smoke/app stages remain unreached. The 68-file/463-case totals
are discovered inventory, not executed coverage.

Evidence: `/private/tmp/apack-strict-39196299955-failed.log`, metadata
`/private/tmp/apack-strict-39196299955-status.json`, extracted console and 26 per-step logs under
`/private/tmp/apack-strict-39196299955/`, and cleaned integration output
`/private/tmp/apack-strict-39196299955-integration-clean.log`. Preserve interleaved stderr without
attributing another fixture's collection error to the failing preload case.

Diagnostic source **`9414d4f4e`** is isolated on `session/native-preload-diagnostic` in
`/private/tmp/apack-native-preload-diagnostic`, with no shared dependencies/generated output/profile.
Only the two existing preload/thread refusal cases gain phase checkpoints, idempotent owner closure,
failed-fixture retention and a **240s diagnostic envelope**. All assertions remain unchanged; this is
not a main-branch timeout policy. Run
[39199301017](https://github.com/spankyed/apack/actions/runs/39199301017) selects exactly that
pair through the existing filtered workflow and must prove actual execution/completion before any
deadline disposition. No local native execution, fixture campaign, duplicate broad run or VM startup
occurs. Main bound-only repair `12447893a` still requires final committed-source strict acceptance.

### Sequential preload/thread completion and scoped budget — 2026-10-19

[39199301017](https://github.com/spankyed/apack/actions/runs/39199301017) succeeds on exact
diagnostic **`9414d4f4e`**, with **two executed passing cases** (23 filtered native cases). The workflow
verifies actual passing cases, not just a successful empty selection. Phase timings:

| Phase | Preload | Thread |
|---|---:|---:|
| Initial build completes | 32.435s | 30.846s |
| Freshness/restoration checked | 37.343s | 35.468s |
| First expected refusal completes | 41.692s | 45.451s |
| Second expected refusal completes | 44.022s | 52.700s |
| Owner closes | 44.651s | 53.333s |
| Entire passing case | 44.652s | 53.334s |

Every original assertion passes: actual captured value/path, mutation/restoration, ordinary loading
of each refused candidate, absent initialization markers/proof after refusal and unchanged published
revision. This control proves completion, not the machine-level cause of the broader 60s failure.
Logs: `/private/tmp/apack-native-preload-39199301017{,-clean}.log`.

Main **`24dc840c1`** adopts only the reviewed test changes with a **120s** outer scenario bound,
rather than the diagnostic 240s. This covers the composition of one real build, freshness/replay,
two ordinary-loader controls, two refused compiler attempts and disposal. Phase timings, idempotent
`finally`/`onTestFinished` cleanup and failed-fixture retention remain. No assertion, operation/helper
deadline, suite budget or production compiler code changes. All **53** timeout-policy/inventory cases,
CLI types and correctness lint pass; logs `/private/tmp/apack-native-preload-budget-{checks,types,lint}.log`.

Focused [39199767205](https://github.com/spankyed/apack/actions/runs/39199767205) targets
`24dc840c1` and selects both repaired scenarios plus the native cases fail-fast had not reached.
Its result remains unproven; the exact executed count must be checked. This closes a named coverage
gap before another full gate. Final strict `--all`, remaining integration and authoring/runtime/app
acceptance stay required. No local native execution or Windows VM startup occurs.

### Native tail accepted; complete integration isolated — 2026-10-19

[39199767205](https://github.com/spankyed/apack/actions/runs/39199767205) passes **ten actual
native cases** on `24dc840c1` (15 filtered); the workflow confirms `{ passed: 10 }`. Preload/thread
take **36.625s/45.141s**, launch-environment retention **41.570s**, OS/override admission **24.490s**,
the three changed fallback/framework controls **26.137s/23.837s/24.066s**, versioned library/framework
refusals **7.144s/6.611s**, and suffix selection/transitive refusal **30.912s**. Each retains its value,
freshness, initialization and ownership assertions. No further native implementation defect is found.
Logs: `/private/tmp/apack-native-tail-39199767205{,-clean}.log`.

The remaining coverage gap is the entire 68-file integration pool: earlier broad runs stop before
most files execute. To avoid repeating accepted prerequisite gates for diagnosis, isolated branch
`session/integration-acceptance-probe`, worktree `/private/tmp/apack-integration-acceptance-probe`,
adds only workflow checkpoint **`fffcc1254`** over main `6dcbfdd88`. The exact diff is solely
`.github/workflows/strict-chain.yml`; all product/test code is identical. No dependencies, generated
output, index or profiles are shared with the main checkout.

Probe [39200409842](https://github.com/spankyed/apack/actions/runs/39200409842) runs
`npm run build:default-setup`, then **`APACK_CHAIN_CORES=2 npm run test:integration`**, retaining
the existing suite deadline and console evidence. The isolated workflow is named Integration acceptance
probe and has a 20-minute job envelope. Dispatch uses the existing `ci.yml` `strict_chain=true` route,
but its altered workflow runs **integration only**, so success must not be reported as a strict `--all`
pass. The probe is execution-only and is not intended for merging. Main's required full strict workflow
is unchanged, with final schema/API/unit/authoring/runtime/app gates still required. No broad retry,
local native execution or VM startup occurs during this probe.

### Integration probe prerequisite correction — 2026-10-19

[39200409842](https://github.com/spankyed/apack/actions/runs/39200409842) fails on `fffcc1254`
at `dep-files.integration.spec.ts`: the test requires dependency-read records for the normal typecheck
legs, while the isolated workflow built only packages/default-setup. Missing records correctly fail
its expected coverage assertion. This is a probe-setup omission, not a product regression. The test
itself documents the prerequisite; neither its assertion nor production code changes.

Preparation succeeds in **9m55s** (04:38:38–04:48:33 UTC). The integration attempt ends after
**190.66s** with 368 passing assertions and the one prerequisite failure; most of the pool remains
unexecuted after fail-fast. Evidence is retained in `/private/tmp/apack-integration-39200409842/`,
`/private/tmp/apack-integration-39200409842-failed.log` and the matching `-status.json`.

Isolated workflow-only **`c51408d15`** adds `npm run typecheck -- --cores 2` before pack preparation.
Its job envelope becomes **30m**, accommodating measured preparation plus typecheck and the existing
ten-minute integration-pool limit; all test/suite deadlines stay unchanged. The exact branch diff
against main source `6dcbfdd88` remains solely `.github/workflows/strict-chain.yml`.
[39201821813](https://github.com/spankyed/apack/actions/runs/39201821813) executes that corrected
probe. This retry supplies a demonstrated missing prerequisite, not another unexplained broad rerun.
It is still not a final strict `--all` result. Main source remains unchanged and final strict/app gates
stay required; no local native execution or VM startup occurs.

### Standalone typecheck compiler-context handoff — 2026-10-19

[39201821813](https://github.com/spankyed/apack/actions/runs/39201821813) fails on `c51408d15`
before integration. Package preparation, generation and the reached typecheck legs pass; the source
facade check refuses generated entries as stale. Console: `/private/tmp/apack-integration-39201821813-failed.log`.

Inspection finds a real coordinator handoff problem. Generation runs through `npm run generate:entries`
and the read-only report through `npm run facade:check`; npm changes `npm_lifecycle_event` and
`npm_lifecycle_script`. `compilerExecutionIdentity()` hashes the environment, and those meaningful
inputs are deliberately not excluded. An inert subprocess regression reproduces the exact mismatch:
the reporter receives `facade:check` metadata while generation recorded `generate:entries` metadata.
No pack modules, native libraries or captured executables are needed for that reproduction.

Main **`25a15d3de`** declares both commands with the default-setup working directory and launches the
existing CLI entry directly, inheriting the coordinator's same environment. The runner forwards the
declared working directory through `boundedSpawn`. Generation still precedes readers; the report keeps
`--skip-generate`; every recorded-file check remains. No environment value is ignored, replayed or
stored, no freshness assertion is weakened, and no full build is added to standalone typecheck.

The regression changes from an actual subprocess refusal to success. All **127** typecheck-leg,
chain-graph/input and subprocess-inventory checks pass, as do scripts/repo TypeScript and correctness
lint. Logs: `/private/tmp/apack-typecheck-context-{red,green,types,repo-types,lint}.log`. Only inert
fixture scripts execute locally; the daily-use Mac runs no native/captured-runtime batch.

Probe branch checkpoint **`40a5b8e1f`** incorporates exact main `25a15d3de`; its sole diff against main
is `.github/workflows/strict-chain.yml`. Existing isolated workflow prerequisites and bounds remain.
[39203080601](https://github.com/spankyed/apack/actions/runs/39203080601) must establish actual
standalone coordinator and full integration acceptance. The inert regression is not substituted for
that real control. Final main strict `--all` and app/authoring gates remain required.

### Generation/report handoff accepted; standalone generation classification — 2026-10-19

[39203080601](https://github.com/spankyed/apack/actions/runs/39203080601) stops on
`40a5b8e1f` before the repaired report command executes: generation reaches its existing 60s
`quick` limit and exits after 62.0s including termination. This neither disproves the context repair
nor establishes a stalled compiler. The preceding real generation completed in 58.7s.
Evidence: `/private/tmp/apack-integration-39203080601-failed.log`.

Isolated workflow-only **`b83e7c2c5`**, branch `session/codegen-context-diagnostic`, measures only
actual declared generation and report commands after normal package preparation, inheriting one
parent environment and their explicit workspace. Its observation limits are 180s and 60s; no main
policy changes are part of this control. Run
[39203581047](https://github.com/spankyed/apack/actions/runs/39203581047) passes generation
in **59.688s** and the read-only facade report in **25.191s**. The report accepts the generated receipt
without skipping freshness validation. This proves the real two-process handoff, not the entire
standalone coordinator or integration pool. Console:
`/private/tmp/apack-generation-39203581047.log`; the workflow also retains its generation log.

Source **`8f81806a6`** assigns only standalone generation the existing `suite` compilation class.
The prerequisite captures compiler/dependency installation inputs and compiles pack declarations;
it is distinct from the individual single-tsc reader legs. The existing class, rather than a new
scalar derived from these timings, bounds it. Reader-leg, report, test and full-pool deadlines remain
unchanged. All **127** focused typecheck-leg, graph/input and subprocess-inventory checks pass;
scripts TypeScript, correctness lint and diff checks pass. Logs:
`/private/tmp/apack-generation-budget-{checks,types,lint}.log`. No local native/captured-runtime run
or VM startup occurs.

Isolated integration probe [39203941398](https://github.com/spankyed/apack/actions/runs/39203941398),
source **`28b06add1`**, contains that exact main source and differs solely in
`.github/workflows/strict-chain.yml`. It retains normal standalone typechecking, pack preparation,
the existing two-core full integration command and the 30m job envelope. Real coordinator and
complete integration acceptance remain required before the unchanged main strict `--all` gate.
The diagnostic branches and their committed workflow variants remain preserved separately.

### Standalone source facade budget ownership — 2026-10-19

[39203941398](https://github.com/spankyed/apack/actions/runs/39203941398), source `28b06add1`,
accepts generation in **88.0s**, all 15 reached compiler/lint/schema/export/specifier/tier reader legs,
and package preparation. It stops at `facade:check` after **62.0s** including termination; no stale-input
refusal is reported. API report and integration are not accepted by this run. Console:
`/private/tmp/apack-integration-39203941398-failed.log`.

Current-source inspection identifies a distinct execution-mode mismatch: chain `facade:check` uses
`--from-build` to read a verified published report; standalone typechecking uses `--skip-generate`
to verify generation and **bundle declarations from source**. Borrowing the chain's passive-reader
class for the source bundle misclassifies its work. Source **`ec5943f65`** adds an optional declared
class to standalone command descriptors and assigns this source bundle `suite`. Chain ownership,
inputs, passive-report classification and all freshness assertions remain unchanged. No global budget,
compiler behavior, assertion or integration-test deadline changes.

All **24** affected typecheck-leg/subprocess-inventory tests, scripts TypeScript, correctness lint
and diff checks pass; logs `/private/tmp/apack-source-report-budget-{checks,types,lint}.log`.
The earlier isolated actual source report completed in 25.191s; whether this loaded coordinator would
complete past 60s remains to be verified rather than inferred from its timeout.

Isolated workflow-only **`2bf51ac08`**, branch `session/typecheck-source-diagnostic`, is based on
exact `ec5943f65` and runs only normal `npm run typecheck -- --cores 2` after dependency installation.
[39204669699](https://github.com/spankyed/apack/actions/runs/39204669699) must accept that
complete coordinator before repeating pack preparation or integration. It retains its console with
a 20m job envelope; this envelope changes neither command deadlines nor main workflow. The preceding
integration and generation diagnostic branches remain preserved. No local native run or VM startup occurs.

### Complete standalone coordinator accepted — 2026-10-19

[39204669699](https://github.com/spankyed/apack/actions/runs/39204669699) passes on workflow-only
`2bf51ac08`, exact product source `ec5943f65`. Generation completes in **76.3s**, source facade
bundling in **68.2s**, pack typechecking in **48.4s** and API reports in **21.3s**. Every other declared
leg passes. This establishes actual completed source bundling beyond the old 60s bound, with the real
generation receipt accepted; it is neither a freshness bypass nor a timeout-only inference. Evidence:
`/private/tmp/apack-typecheck-39204669699.log` and the retained workflow console.

The preserved integration branch incorporates exact main `e9f2becbb` as **`4bafbdcad`**; only its
workflow differs. [39205345266](https://github.com/spankyed/apack/actions/runs/39205345266)
resumes complete integration with its normal dependency-read/typecheck and built-pack prerequisites,
two cores and unchanged test/pool deadlines. No further coordinator diagnostic is needed unless a
new failure supplies a cause. Complete integration and final main strict authoring/runtime/app gates
remain open; no local native batch or Windows VM startup occurs.

### Integration reaches two compiler-operation bounds — 2026-10-19

[39205345266](https://github.com/spankyed/apack/actions/runs/39205345266), `4bafbdcad`, accepts
normal typechecking and pack preparation. Integration passes **398** assertions, then fails fast at:

- Real captured Electron pack: init **21.642s**, add **16.495s**, then the build command aborts at its
  **120s** bound. The complete case takes 158.577s; its 300s outer deadline did not fire.
- Repeated captured compiler/build-cache identity: its first build reaches output, then the case hits
  its **120s** outer deadline (121.652s reported). Existing phase checkpoints are Windows-only, so
  the precise later operation is not established by that console.

No value, initialization, identity or publication assertion fails. Neither completion beyond those
bounds nor the source of elapsed-time variation is established. These cases passed earlier controls;
that is not a reason to classify this failure as harmless or retry the broad pool. Evidence:
`/private/tmp/apack-integration-39205345266-{failed,clean}.log`; workflow retains its full pool console.

Observability-only source **`cfa489dc7`** prints the existing repeat-build checkpoints on every platform
and prints captured Electron child output with phase/duration on refusal/abort. It changes no
assertion, compiler behavior or main deadline. CLI TypeScript, correctness lint and diff checks pass:
`/private/tmp/apack-integration-phase-{types,lint}.log`.

Isolated **`5f4bedfd5`**, branch `session/compiler-pair-diagnostic`, runs only these two actual cases
with two workers after normal package preparation. Private observation windows are 420s per case and
240s for the Electron build command; all other inner bounds and assertions remain. A JSON verifier
requires exactly two passing cases. [39206807491](https://github.com/spankyed/apack/actions/runs/39206807491)
must establish completed phase evidence or a specific failure before selecting a correction. Its
15m job envelope and diagnostic limits are not a main policy change. Preserve the diagnostic branch;
do not merge its workflow/bounds wholesale. Full integration and all final gates remain required.

### Two compiler scenarios complete; scoped main budgets — 2026-10-19

[39206807491](https://github.com/spankyed/apack/actions/runs/39206807491) passes exactly **two**
actual cases on `5f4bedfd5` with two workers, confirmed by its JSON verifier. The repeated build's
first completion is **47.055s**, replay **50.034s**, archive **55.714s** and second completion
**111.034s**. Both captured installations retire; exact source paths, cache stamps and build revision
remain correct. The Electron control completes init/add/build/archive in
**28.761/18.270/85.716/8.683s**; the whole case is **142.149s**. Its content compiler runs under
Electron 37.2.4 / Node 22.17.1, owned runtime retires, backend/Vue files exist and Node archive does
not execute content compilation. Console: `/private/tmp/apack-compiler-pair-39206807491.log`.

This establishes completion with all assertions intact; it does **not** attribute the prior full-pool
slowdown or reproduce its elapsed times. The repeated-build composition nearly consumes the old
120s macOS ceiling even in this passing control; the same case's accepted Windows proof already
requires 360s for its two cold builds. Main **`27e9e4109`** uses that existing **360s** scenario bound
across platforms. Only the Electron **build command** changes to **180s**; its overall 300s bound and
60s authoring/archive commands stay unchanged. No other case or aggregate deadline changes. The
private 420s/240s observation windows are not merged.

All **53** timeout-policy/inventory checks, CLI types, correctness lint and diff checks pass; logs
`/private/tmp/apack-compiler-pair-budget-{checks,types,lint}.log`. No local native batch or VM startup
occurs. Workflow-only integration checkpoint **`b552b950a`** contains exact source `27e9e4109`;
[39207375977](https://github.com/spankyed/apack/actions/runs/39207375977) verifies both scoped
repairs and remaining integration under the real pool concurrency. Full integration and final main
strict authoring/runtime/app acceptance remain open. Preserve diagnostic source and prior evidence.

### Repaired controls accepted in pool; worker lifecycle coverage isolated — 2026-10-19

[39207375977](https://github.com/spankyed/apack/actions/runs/39207375977), source `b552b950a`,
passes normal prerequisites and **419** integration assertions before failing the worker exit-handler
candidate-mutation case at its default **60s** (60.078s reported). The pool ends after **422.29s**;
its aggregate limit did not fire. The repaired repeat-build case passes in **90.799s**, and the
complete Electron pack control passes in **106.523s** (build **74.242s**, archive **8.905s**).
Exactly **15** native cases are listed as completed before fail-fast, including watch recovery
**102.177s** and preload refusal/owner closure **91.955s**. The 25-test file header is not proof that
its remaining cases ran. Preserve earlier ten-case tail evidence; complete pool acceptance stays open.
Console: `/private/tmp/apack-integration-39207375977-failed.log`.

Current worker-file inspection shows the failed case deliberately mutates sealed staging output from
the compiler's exit handler, requiring refusal, unchanged incumbent and removed staging. It performs
one actual build; no refusal/value assertion has completed in this attempt. The file also has eight
unreached later lifecycle cases, including frontend read identities, parent loss and four public-command
cancellation states. Do not describe their absence as a product defect or assume a larger bound fixes it.

Isolated **`428014c11`**, branch `session/worker-closeout-diagnostic`, runs the **complete 16-case
worker file** after normal package preparation, with at most two workers and a 20m job envelope.
Only that private project's default observation bound becomes 180s; explicit 360s/180s scenario
bounds, short readiness/termination assertions and all bodies remain unchanged. No main budget is
changed. A verifier requires exactly 16 actual passes. Run
[39209331600](https://github.com/spankyed/apack/actions/runs/39209331600) must establish
refusal/incumbent behavior and later lifecycle evidence before any repair or another broad pool.
Preserve its private workflow/configuration separately; no native execution runs on the daily-use Mac.

### Complete worker lifecycle accepted; finite full-coverage diagnostic — 2026-10-19

[39209331600](https://github.com/spankyed/apack/actions/runs/39209331600), `428014c11`, passes
**all 16 actual worker lifecycle cases** in **333.405s** (335.75s invocation). The exit-handler
candidate mutation is refused, its sealed-state/incumbent/staging assertions pass in **22.030s**.
Frontend read identities pass in **24.361s**; parent loss **12.128s**; the four public-command
cancellation/worker/installation cleanup cases **35.061/14.599/11.224/11.770s**. Startup identity,
observations, loader ordering, background retirement and private-bootstrap refusal also pass. Its
JSON verifier confirms `{passed:16}`. Log: `/private/tmp/apack-worker-closeout-39209331600.log`.

No new runtime defect or completed duration exceeding the main default is demonstrated by this
isolated control. The earlier loaded 60s refusal-case timeout remains unattributed. Main source and
default budgets stay unchanged. This control closes the named later-worker coverage gap; it does
not accept full-pool concurrency or justify a blanket timeout increase.

Repeated fail-fast pools have left most of the 68 files unexecuted. Isolated **`4d4014241`**, branch
`session/integration-coverage-diagnostic`, now performs **one deliberate complete-coverage diagnostic**
on exact committed main `ca021a5bb` after normal typecheck dependency-read and pack-build prerequisites.
It uses exactly two workers, retains every assertion and explicit/inner deadline, and changes only
the private CLI project's default observation window to 180s. Direct Vitest collects additional
failures (`--bail=0`) only in this diagnostic; the existing process-group owner enforces a **20m**
aggregate observation limit, with a 40m workflow envelope for preparation and evidence retention.
JSON/console are retained on failure. The success verifier requires all **68** file results, no
failed assertions/suites, and reports actual pass/pending counts.

[39210359774](https://github.com/spankyed/apack/actions/runs/39210359774) supplies the complete
failure/timing inventory. Next: distinguish failed behavior from exceeded observation bounds, inspect
named failing phases, make only supported focused repairs and validate those cases before normal
committed-source pool/final strict acceptance. Do not merge private collect-all/default/aggregate
limits or report this as a normal strict gate. No source/compiler redesign, local native batch,
Windows VM startup or repeated prerequisite run is authorized by this diagnostic itself. Preserve all
existing source checkpoints and diagnostic branches; the complete active goal and final gates remain.


## Final source audit: default-surface schema guidance — 2026-10-19

The current-source pass rechecks consolidated entities/relations, type-only shape export generation,
lifecycle membership/callability, strict authored fields, canonical writer call sites and deterministic
surface selection. `_packEntities` preserves flat wire names and both collision owners;
`entityShapeEntries` skips null shapes and uses `hasTypeExport` plus generated `import type`.
`lifecycleBindingProblem` checks declared callable membership without invoking hooks. Init, every
manifest-writing add command and release use the schema-derived `writeManifest`. Production/source
searches find no `entityShapes`, `settingsSections`, `typesEntry`, `$manifestVersion` or checks-sidecar
reader. This supplements the [17-decision audit](../../plans/manifest-consolidation.md#current-source-consolidation-review-2026-10-18),
not a replacement for final runtime acceptance.

Compared with that audit's source `a74bbd88a`, the consolidated framework contracts, entry generator,
manifest writer and surface-selection implementation are unchanged through `14de022f8`. The reviewed
service-binding delta retains Array identity/its nonconfigurable length descriptor while preserving
provider/caller generation checks. No production `packages/*/src` or `packages/*/bin` changes occur
between accepted native/worker checkpoint `f17d2e286` and `14de022f8`; later repairs affect test execution
and deadlines. Existing platform/runtime evidence remains relevant, with final gates still required.

One concrete M6/decision-12 omission is found: `SurfaceSchema.default` and generated JSON Schema still
claim the first registered pack wins. Actual `selectDefaultSurfaceDeclaration` filters enabled runtime
owners, prioritizes native claims and sorts qualified feature refs with locale `en`; public feature and
manifest docs already explain this policy. Correct the schema help and regenerate `apack.schema.json`.
Only that description changes; no validation, runtime selection, API type, format stamp or release
metadata changes. No new test duplicates a prose literal.

Validation: **61 existing manifest-schema/editor checks pass**, generated-schema check passes and lint
passes. The npm `tsx` wrapper first refuses its sandbox IPC socket (`EPERM`); running the same generator
with `node --conditions=@apackdev/source --import tsx ...` succeeds, without changing permissions or
executing a pack/compiler/native fixture. This is a tooling invocation refusal, not a schema defect.
Normal integration `39312954386` retains its immutable earlier checkpoint; do not cancel/restart it for
this help-only correction. Final strict `--all` must run on the committed tree including the correction
and prove schema/API report agreement along with every required runtime gate. Acceptance remains open.

## Final requirement and source audit — 2026-10-19

**Source scope:** this dated audit closes the historical `1ba85b976` checkpoint. Later PR review and
repair source commits have separate [verification and acceptance limits](pr-246-repairs.md); the
statements below about unchanged implementation do not extend to those commits.

Normal unfiltered integration **39333769307** is accepted on workflow-only **`06638811d`**, whose only
difference from main **`1ba85b976`** is its acceptance workflow: **831 passes, zero failures, 29
platform skips**, exit 0, 4896.31s, every normal prerequisite passing. The
[complete report](integration-deadline-inventory.md#normal-unfiltered-integration-accepted--2026-10-19)
attributes every skip and preserves raw evidence. The user explicitly waived repeating the entire
strict gate after this pass; **`2c790624d`** records the revised procedure. This audit retains actual
prior/focused coverage, not an invented full strict pass.

| Required outcome | Current source and sufficient evidence |
|---|---|
| Phase 0 and naming | Completed baseline `3d389b9c8` is in the branch; the user promoted the goal to the main checkout. Unrelated Wireit draft, research worktree and saved stashes are preserved. |
| Phase 1 foundation and all manifest decisions | The 17-decision/two-question current-source audit `a74bbd88a`, own-key repair `29f0cc556`, declaration/reader classification `031e3a521`, and final source review above cover the consolidated declaration, shared catalog, native/source/installed readers and ownership. Current normal external/published facade typing and completions pass. No controlled EARS widening or identity migration was introduced to make ownership changes compile. |
| Phase 2 settings | Host/pack/feature JSON Schema, defaults, handles, trusted caller policy, current-document import/reset, orphaned overrides, custom forms and independent windows are implemented. The recorded five host-only window cases and complete external app acceptance exercise same-named assistant groups, restricted credentials, restored data and cross-window edits. Host/default-setup settings implementation is unchanged since that accepted sequence. No automatic historical-data conversion or production-data edits. |
| Phase 3 discovery/editor/content | Explicit keyed declarations, type-only shape references, checked lifecycle/native bindings, static source-free poisoned-entry inspection, inactive metadata, atomic publication and exact freshness are implemented. `d1c38bc58`, `9b7d112cf`, `3913fe196` and `415228f0c` preserve real Monaco/cold-worker, no-activation, DSL replacement and flow dependency proofs. Current normal integration accepts all build/cache/watch/published consumer bodies. |
| B1/B3 compiler/native contract | Preserve the finite platform register, Windows VM exports, Linux ownership/launcher controls, signed macOS and direct Electron build/archive acceptance. Native/worker complete acceptance `39275701481` and current normal runtime cases pass. User-approved package-contained/OS-library and attributed bound-only refusal boundaries are recorded in the native ADR; arbitrary native loading is not a security-isolation guarantee. |
| Phase 4 navigation | `95ff95ab3` closes canonical stored-reference routing, checked destinations, conflicts, disabled/missing/retired delivery, cancellation, actor readiness and the actual Electron reference case. Shell/feature guards and real-window evidence are preserved; no navigation implementation changed in later compiler/test closeout. |
| Phase 5 frontend boundaries | `713a6c1fd` plus real external Electron cases prove pane/form containment, usable host settings and stale-instance retry refusal. Backend process isolation stays deferred. |
| Phase 6 API consumption | A1–A5 through `bb6df4a45`/`b62da5c72` cover declaration granularity, generated/runtime facades, unavailable/undeclared API diagnostics, provider/caller retirement, Database/onboarding/action routes and schema/API/public-doc agreement. The Array identity/length descriptor repair preserves those lifetime checks and is accepted in focused and normal checks. |
| Phase 6 provenance/replacement | `031e3a521` and the recorded complete 27-case external app, bundled editor and normal-fork sequence prove origin/content identity, explicit linked development, restart/reload, update ownership, disable/remove/restore, override retention and failed-publication incumbent retention. This runtime implementation is unchanged in the subsequent compiler/test corrections. |
| External packaged authoring | Existing author/app evidence proves actual local npm tarballs outside the checkout, scaffold/build/type/harness behavior, verified archive installation and exact archive execution without monorepo symlinks. The full author half also passes in strict run `39172886664` (431.6s); later normal scaffold/published-facade/archive checks pass. Public release preflight limitations remain owned by the separate release-readiness plan; no publishing is claimed. |
| Phase 7 public contract and validation | Prior strict `39196299955` passes 5667 host and 889 pack tests, schema/API/exports/types/lint and reached external/fork checks before its historical integration failure. Later source-specific focused checks, 61 schema/editor checks for `5ce394268`, and the current normal prerequisite/typecheck results cover subsequent deltas. Current normal and eight-file repair acceptance both exit 0 without reporting errors. The user waived repeating the complete strict aggregate, not required behavior. |

Source comparison closes the remaining evidence-drift question. From strict source `55c9e1f54`,
production deltas are the standalone compiler-context identity correction (covered by its focused
checks and current normal freshness/consumer cases), the PE bound-only admission ordering correction
(covered by the native/Windows evidence and approved boundary), and schema help text `5ce394268`
(61 editor/schema cases plus regeneration). App settings, shell navigation, frontend boundaries,
manifest normalization, generated API contracts and replacement behavior are unchanged. From
`5ce394268` through accepted main `1ba85b976`, only test execution/deadline helpers and owning
documentation change. This acceptance statement is bounded to source `1ba85b976`; subsequent PR review
and repair commits change production source and are not covered by run `39333769307`. Their focused
verification and remaining native/application/integration acceptance gaps are recorded in
[PR #246 repairs](pr-246-repairs.md). The historical pass and the user's aggregate-gate waiver remain
historical evidence, not a fresh integrated pass over the repaired branch.

The lasting guards remain the strict current schema, shared normalized projections and checked binding
admission, typed generated facades, caller/runtime-generation validation, build input/output seals,
and the retained unit/integration/window/platform cases. No release metadata, production profile,
security database or installed application is changed at closure. Archive only the completed goal and
its six subsystem plans, repair their links, and retain manifest maturity and all deferred work visibly.

Closure document checks resolve 356 moved/updated-document references and 249 heading fragments, including
seven repaired historical evidence anchors. The maintained declarative-contribution reference now
describes implemented discovery rather than its obsolete proposed boundary. All seven archival moves
retain their history; dependent indexes/follow-ups distinguish completed delivery from deferred work.
The unrelated untracked Wireit draft remains untouched. No implementation suite is rerun for these
documentation-only changes.
