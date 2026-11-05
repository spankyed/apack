# Discover every declared contribution without activating a pack

Status: completed 2026-10-19. The shared catalog discovers every supported declaration and static asset without executing pack/dependency entries; binding and build freshness remain checked.
See the [completed goal](../goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19) and
[final requirement/source audit](../references/evidence/settings-and-pack-contracts.md#final-requirement-and-source-audit--2026-10-19).
Dated checkpoint notes below are historical; deferred work keeps its separate owner.

Historical checkpoint status: implementation in progress. Written 2026-10-12 on `AS/feature-settings-rework`.

This is the discovery workstream of [manifest maturity](manifest-maturity.md). It builds on the
[settings extraction](settings-architecture.md) and replaces the older
[declarative contributions plan](declarative-contributions.md) as the target for complete discovery.
The older inventory remains historical evidence. This plan owns the current implementation target;
[manifest maturity](manifest-maturity.md) records decisions transferred from the other archived designs.
The [naming contracts goal](../goals/goal-naming-conventions.md) is complete. Re-audit code
names on that result rather than applying the old naming survey or renaming a surface twice.

## Goal and boundary

Every supported contribution can be listed, described, addressed and checked for declared compatibility
before any executable pack module loads. This applies to installed packs and their dependencies, whether
enabled, disabled or not yet activated.

Complete discovery means discovering the supported declaration contract. Arbitrary JavaScript behavior,
successful execution and current results from dynamic providers cannot be inferred from declarations.
Make those runtime responsibilities explicit rather than hiding a discovery-time import behind them.

Discovery reads validated data files, static assets and host-owned state such as installed versions.
It does not import/require pack or dependency modules, instantiate components or actors, run hooks,
execute migrations/content appliers, query a pack's live provider, or write user data. Build-time compilers
may execute code; their discoverable results must be materialized before installation.

## Current discovery checklist

Current status reconciled 2026-10-17. This checklist owns discovery progress; the execution goal
owns phase ordering and final acceptance. Source checkpoints establish implemented slices, not final
acceptance of this entire plan.

Compiler capture and startup/authored inputs are implemented through `aba660aed`, `37890aa9b` and
`bbf05ec00`. Selected executable/runtime ownership is implemented in `e369d3cb9`; matching backend/Vite
generations and retained frontend lifetimes in `a595246f2` / `d3833f788`. The completed input/output
association and producer output expectations are implemented through `d4e24d4b5`. Archive, prebuilt tests,
default-fork preparation and drive use the common record; see the
[consumer evidence](../references/evidence/build-input-snapshot-proof.md#prebuilt-test-consumer-checkpoint) and
[real handoff](../references/evidence/build-input-snapshot-proof.md#real-default-fork-handoff-acceptance).
`caf57cb0e` repairs compiler-specific generation-cache ownership without weakening generated-byte
validation. These implemented owners must not be scheduled again as new designs.

Compiler identity uses native canonical filesystem paths consistently across roots, package origins,
private captures and passive replay. The common input view normalizes representational root spellings
while retaining a real root link's namespace slot and observable metadata. Authored metadata operations
keep their own semantics; they are not all converted to native-realpath queries. Watch exclusions
recognize both declared and canonical roots. See the [path-policy proof](../references/evidence/build-input-snapshot-proof.md#consistent-native-compiler-path-identity-2026-10-17);
its local acceptance does not close the goal's Windows/native or final strict requirements.

The user approved B1's bounded native contract on 2026-10-17: captured package-contained and OS
libraries, with refusal of identifiable outside dependencies. `cc186a0d0` implements selected macOS
module admission; [native checkpoint evidence](../references/evidence/build-input-snapshot-proof.md#bounded-macos-module-library-admission-2026-10-17)
records its actual addon/refusal proof and remaining startup/thread/Vite, ELF/PE and public-build cases.
B1/B3 completion and platform/resource-lifetime requirements remain open, as does converged B6/final acceptance. The [live ledger](../goals/goal-settings-and-pack-contracts.md#live-execution-ledger-reconciled-2026-10-16)
owns their finite closure register and next actions. Installed/offline discovery continues to require
neither authored sources nor compiler activation. Independent readers may advance without dropping
unfinished producer requirements.

Follow [bounded validation](../../../CLAUDE.md#keep-validation-bounded): diagnose failures from preserved
evidence and focused reproducers; broaden for a named coverage gap or the required converged gate.
No deadline/assertion change or repeated focused pass substitutes for final acceptance.

**How to read the history:** dated audits, designs and checkpoint handoffs in [the evidence record](../references/evidence/discovery-without-activation.md) record what was known
at that time. Their “remaining,” “next” and “not yet implemented” statements are superseded for current
status by this checklist. Preserve their evidence and unresolved acceptance requirements; supersession
does not waive a requirement. The acceptance section remains normative. An old failure log is neither
proof of a current failure nor proof that the failure was subsequently fixed.

| Consumer / contract | Current status and source evidence | Remaining acceptance |
|---|---|---|
| App, pack-group and feature settings | **Implemented, awaiting final acceptance.** `f3416ad2f` connects definitions and runtime settings to the catalog; later settings checkpoints record caller, form and window behavior. | Reconfirm the settings plan's complete three-owner, disabled/failed pack, policy, reset/import and multiple-window checks on final committed source. No new settings extraction is required. |
| Help listing and articles | **Implemented, awaiting final acceptance.** `2169d29f8` moves help into snapshot/catalog data; the help publication/browser-routing checkpoint in the evidence record records disabled-pack navigation and publication checks. | Include poisoned executable entries, invalid replacement retention and disabled help navigation in the final all-kind acceptance. Preserve the separately recorded concurrency failures until current evidence resolves them. |
| Installed-pack information | **Implemented, awaiting final acceptance.** `6c876c9ba` uses accepted declarations plus installation/activation records. | Prove disabled/failed/unreadable installations and refused replacements remain explainable without executable imports. Check offline CLI inspection alongside app information. |
| Reference metadata, parsing and picker categories | **Implemented, awaiting final acceptance.** `20ab75efe` migrates editor consumers/provider scopes; `c776d1c5d` preserves wire identity without metadata. | Reconfirm delayed/missing catalog delivery and source-free discovery; categories must start no providers. Actual queries/navigation still require eligible bindings and disposed provider scopes. Entity destination redesign belongs to Phase 4. |
| Live editor contribution composition | **Implemented, awaiting final acceptance.** `8863043a6` adds accepted-change subscriptions and generation-checked replacement. | Local real-window acceptance passes in `d1c38bc58`: existing Tiptap activation/removal preserves draft/selection/update count, and the cold Monaco case covers typed replacement and shared lifetime. Retain these cases for final all-kind acceptance; compiler frontend reuse/removal remains separate. |
| Step palettes, styles, defaults, layout and backend metadata | **Implemented, awaiting final acceptance.** `76df2f0e5` migrates frontend readers; `71fad4013` backend defaults; `8ec5285ed` trigger/build declarations; `f7d63434c` update eligibility. | Include authored and native steps, inactive metadata, external runtime paths and stale binding refusal in final acceptance. Keep actual flow execution bound to its accepted runtime lifetime. |
| Shell navigation/default selection | **Default/dispatch and navigation metadata implemented.** `cfcbb53f9` moves toolbar/menu/keyboard inventories, labels, order and visibility to declarations and removes backend runtime visibility copies. `69860e4be` selects defaults from declarations, uses checked owner/build/runtime surface bindings for new navigation/delivery, preserves native host availability and reconciles frontend-before-frame ordering. The runtime default selector is removed. | Complete loader coordination cleanup and final real-window navigation acceptance. Preserve saved/popout/explicit precedence, unknown/disabled/loading/failed distinctions, actor-event readiness and stale completion refusal. `wantsDefaultSurface` still records user intent; `pendingSurfaceId` and request queues retain actual readiness work. |
| Declared slash-command listing | **Implemented, awaiting final acceptance.** `ff48438cd` projects native/installed/source commands through the common catalog in stable admission order. SDK execution selection matches enabled declarations to accepted runtime identities; the old command store is removed. Chat subscribes to catalog changes and retains user-content/runtime notifications. | Include this metadata/eligibility split in final all-kind acceptance. Focused checks cover poisoned source-free inspection, inactive/stale/build-replaced owners, collisions, ordering, real pack refresh and actor stop. User-document precedence and user.command flow dispatch remain unchanged. |
| Block and artifact metadata | **Consumer checkpoint implemented.** `3e4e10c8f` publishes native/installed/source metadata; `a278d4116` adds checked frontend bindings and scoped catalog readers, migrating thread icons, input kinds and components together. Mounted views follow independent catalog/binding changes and refuse stale implementations. Backend transcript callbacks remain execution. | Finish the all-kind audit, including backend/native fields and superseded metadata readers. Active low-level registries retain runtime lookup lifetimes; do not count them as static discovery. Keep source-free installed inspection and ownership/readiness checks in final acceptance. |
| DSL/editor assistance | **Implemented, awaiting final acceptance.** `8ed188046` publishes compiled text and `39e48e66e` / `eb7d0995b` migrate SDK/Monaco to static catalog data with shared owned libraries and live replacement/removal. The frontend registration/store, generated raw module and staged-import resolver are removed. `07d544606` supplies offline Monaco. | Real worker/cold-document/window acceptance passes in `d1c38bc58`: source-free disabled metadata arrives after document opening, actual completions/diagnostics follow replacement/removal, typed drafts/models/selections survive, and libraries remain until their final consumer releases them. [Window evidence](../references/evidence/settings-and-pack-contracts.md#real-cold-monaco-worker-and-editor-lifetimes-2026-10-17). Retain the existing producer, prefix-policy and deterministic-build evidence for final all-kind acceptance. Five-build publication/refusal/recovery/reuse/removal is locally accepted in `3913fe196`; it compares publishable bytes separately from invocation metadata and has a measured 120s scenario exception. [DSL evidence](../references/evidence/settings-and-pack-contracts.md#dsl-reuse-identity-and-measured-five-build-acceptance-2026-10-17). Preserve final B6/all-kind acceptance. |
| Compiled-content inventory and dependencies | **Flow-edge local acceptance closed; final inventory audit remains.** `7196d61d3` publishes flow reference fields/targets in the verified content index; build-only codegen, offline inspection and known incoming-edge queries cover nested/custom/computed targets. [Real source-free external inspection](../references/evidence/settings-and-pack-contracts.md#source-free-external-flow-inspection-2026-10-17) verifies incoming edges and rename/removal findings. | Audit every remaining inventory reader and retain the accepted flow cases for the final gate. Preserve explicit unavailable/non-exhaustive analysis and indexed-target semantics; finish all-kind external/installed acceptance. Distinguish declared content from rows created by appliers; no user-data writes during inspection. |
| Services, repositories, events and remaining native contributions | **Partially implemented; field-by-field completion audit outstanding.** `506582b94` adds native service/repository ownership data and common binding-name validation. `774b0844c` publishes compiled endpoint contracts for authored/native discovery and checks runtime event membership; inactive native shell inboxes remain independent of UI panes. | Classify every supported registration field as discoverable data or executable binding, including nested members and static assets. Discover contracts without constructing services. Verify ownership/collision rules and native/authored parity; do not infer completion from schema acceptance. Phase 6 owns consumed-API enforcement. |
| Shared readers and all-kind acceptance | **Partially implemented; final consumer audit outstanding.** Snapshot/catalog admission is shared; individual migrations above have checkpoint coverage. | Recheck lifecycle, offline database schema, CLI inspection and refresh subscriptions for duplicate parsing or active-only inventory. Preserve each consumer's enablement/execution policy. Exercise every supported kind with poisoned executable entries, source files absent, disabled/failed owners, collisions and atomic replacement; remove superseded discovery stores without deleting real runtime machinery. |

The partial rows identify inspected gaps; they are not claims that every caller in that family has
already been audited. Closing a row requires its source commit and acceptance evidence, including deletion
of superseded discovery projections. A passing producer test alone does not establish consumer migration.

### Build freshness has per-consumer dependencies

Archive creation, prebuilt tests, default-pack fork preparation and drive are **build-freshness
consumers**, not additional discovery UIs. Their common input/publication contract and migration remain
required under [content-based source freshness](../references/evidence/discovery-without-activation.md#required-content-based-source-freshness-correction-2026-10-15).
Shared authored inputs landed in `882d2a50b`; compiler capture/session reuse landed in `aba660aed`
after strict checkpoint validation. Captured TypeScript query views and retained read-set validation land
in `e171b3acf`, with full checkpoint evidence in the evidence record. Whole-build input/output association and passive consumers are implemented as recorded above;
B1/B3 native/platform closure and B6 remain open. The Windows build/frontend lifetime owner now uses
a shared suspended-launch Job Object after a successful native IPC/descendant prototype; production
integration, parent-loss/replacement and remaining platform acceptance are still owned by the goal.
Installed/offline discovery must continue to need
neither authored source files nor compiler activation.

The execution goal owns the current order. Only consumers requiring an unfinished producer guarantee
wait for that guarantee; installed-data readers and entity navigation may proceed on their accepted
catalog/binding contracts. Complete the freshness workstream and all-kind acceptance before final
closure. Pane/form containment is locally accepted in `713a6c1fd`; retain its final checks. All three
Phase 6 workstreams remain required.

### Remaining registration audit (2026-10-16)

This inventory follows `PackRegistration`, `PackFeature`, `PackFERegistration` and `PackFEFeature`
as implemented now, not the original survey. Existing declarations are retained; a runtime lookup is
not a discovery defect when its caller needs an executing implementation.

The 2026-10-17 [closure audit](../references/evidence/settings-and-pack-contracts.md#registration-and-reader-closure-audit-2026-10-17)
rechecks every current field in those four interfaces against this table and the native declaration.
No unclassified registration field remains. This closes field classification, not the outstanding
compiler input/lifetime requirements or final all-kind acceptance.

| Registration field | Static authority / binding boundary | Current finding |
|---|---|---|
| `id`, `declarationRevision` | Accepted snapshot/native owner; installed registration ID checks in `declaration-binding.ts` | Implemented. Native composition has no installed revision. |
| `name`, `version`, `dependencies` | Authored manifest; native declarations have dependencies and optional own version | Native version is implemented for pack-line migration caps in `f72cb8756`. Display readers use manifest/origin names or feature labels; none reads `PackRegistration.name`. `123efbd6f` removes that redundant registration field and generated assignment; native name metadata has no demonstrated consumer. |
| `features` membership | Manifest/native keyed features; backend and frontend admission | Both admit against declarations; the native backend nested checks below are implemented. |
| `features.*.designation` | Feature declaration; runtime designation lookup is execution | Native parity repaired in `b268fac86`: changed/added/omitted claims refuse atomically; fixtures retain declarations, including explicit candidate admission before role replacement. Authored backend and shared frontend already compare it. |
| `features.*.system.machine` | Authored `system.entry`; executable machine remains activation | Implemented in `774b0844c`: compiled event contracts declare endpoint presence independently of machine bindings. Native composition may bind only the systems it runs; every bound endpoint must match. No UI pane is invented for the shell inbox. |
| `features.*.system.receives`, `features.*.surface.receives` | Generated contract event names; backend validation maps consume running bindings | Implemented in `774b0844c`: generated JSON feeds the snapshot, source harness and generated entries; native composition supplies the same static contract. Catalog/CLI inspection imports no pack modules. Admission captures effective receive sets instead of rereading mutable registration arrays. Uncompiled source previews explicitly report unavailable contracts. |
| `features.*.services`, top-level `services`, `repositories` | Manifest/native named targets; `apiBindingProblem` checks ownership and membership | Implemented names/owners; constructing objects and calling methods remain execution. Phase 6 owns consumed API enforcement. Verify source-free inspection and collision acceptance rather than replace their runtime stores. |
| `consumes.services` (declarations only) | Qualified provider/service refs, canonical SDK baseline and normalized direct ownership | Declaration/codegen foundation `1a0de64fb`; catalog retains native/source/disabled installed requests without activation. A2 admission/diagnostics `558b42220` and A3 runtime/type filtering/lifetimes `cccc12d5d` are implemented; `bb6df4a45` removes the ambient service value and binds attributed action access. There is no duplicate runtime consumption inventory. |
| `settings`, `features.*.settings` | Inline schema/defaults; shared catalog projection and binding equality | Implemented. Retain disabled/failed-owner definitions and current policy semantics in final acceptance. |
| `bindServices` (backend), `bindSettings` (frontend) | Generated caller authority setup/disposal | Executable resource acquisition, not discoverable contributions. Backend selected/action facades and frontend scoped settings retain their distinct lifetime owners; keep rollback and retirement. |
| `ears.entities`, `ears.relKinds` | Shared normalized `data`/feature entities and `data.relations` | Implemented typed/untyped wire projection; runtime registration checks authored/native equality. Runtime EARS registration remains execution. |
| `lifecycle` | Explicit hook targets, checked callable bindings | Implemented authored/native metadata and membership checks. Running hooks is execution. |
| `migrations` | Authored line/target/description/`up` declarations; checked backend bindings | Implemented in `f72cb8756`: shared keyed declarations and checked callable bindings; admitted native/installed owners feed common runners. Native app-line needs no pack version; pack-line targets require a declared native version. Targets/callbacks/version are captured once. Unaccepted installed origins cannot bind migrations. |
| `steps` (both registrations) | Snapshot/native step declarations and catalog projections | Implemented metadata and checked facets. Keep handlers, compilers, live labels/layout and trigger resources executable; include native and external paths in final acceptance. |
| `artifacts`, `blocks` (both registrations) | Snapshot/native declarations; frontend checked components; backend authored membership/kind/facet checks | Implemented in `be5a9344b`: native and authored backends share identity, block-kind and backend-facet membership checks before authority/publication. Frontend facets are refused on the backend; native metadata remains after unload. Runtime callbacks remain executable bindings. |
| `contentWriters`, `appliers` | Authored `content.writers` and `content.sources`; compiled content index | Implemented in `2e1701fad`: native content declares owned writers and explicit applier sources; native/authored backend admission shares exact binding checks and writer ownership validation. Explicit native import remains executable; automatic application still requires an installed build directory. Keep final all-kind/lifetime acceptance separate from this checkpoint. |
| `commands` | Native/authored keyed metadata and catalog order; runtime selection checks accepted identity | Implemented; preserve document-command precedence and global dispatch behavior. |
| `features.*.surface` (frontend) | Surface declaration plus compiled destination claims; checked binding/catalog eligibility | Implemented. Backend inbox metadata is a separate transport concern; the host application actor has an inbox without a contributed sidebar pane. |
| `features.*.references` | Declared type/category metadata and checked provider/icon bindings | Implemented; no navigation callbacks. Provider results remain executable. |
| `features.*.settingsForm`, `settingsForms` | Declared custom-form targets and owner settings | Implemented checked components and scoped failure boundaries. |
| `features.*.designation`, `features.*.default` (frontend) | Feature designation and surface default annotation | Implemented shared native/authored comparison; do not restore runtime discovery tables. |
| `textEditor` | Named group/member targets and catalog metadata | Implemented checked extension names, popup membership and predicate presence; running editor extensions remains execution. |
| `appExtensions` | Named targets and checked components | Implemented metadata; shared slot selection retains existing composition policy. |

Other authored/static surfaces remain part of the same audit: help's built documents, DSL's compiled
definitions, compiled-content indexes/flow edges, public type facades, source formats, surface component
targets, frontend entry/CSS and lazy chunks. Snapshots carry declarations/compiled data; the installed
asset receipt verifies shipped files. Do not treat module target strings alone as proof that a required
asset is present, or an unavailable source-only projection as an empty compiled inventory. Existing
`readPackBuild`, help/DSL validation and content-index readers are the owners to extend where a
specific missing asset or reader is demonstrated.

The current asset audit distinguishes inline snapshot data from physical outputs. Facade type text,
flow-helper module/type text, help documents and DSL definitions are materialized in the snapshot;
installed discovery must not require their authored modules or duplicate generated files. Runtime
entries, frontend CSS/chunks and compiled content are physical outputs. `verifyPack` proves equality
with the producer's file receipt, but `sealPackBuild` hashes whichever files exist: a file omitted
before sealing is not caught by that proof. Required-entry validation belongs at the current-format
build-reading/admission boundary, including source staging and installation. `b916d0e5e` enforces the
backend entry and the frontend entry when generated bindings require it. Backend-only builds remain
valid; declared frontend contributions cannot silently become frontless. Isolated filesystem cases
prove missing-before-seal refusal, source-free inspection and retention of the incumbent stage; real
builds prove `--skip-fe` refusal retains the incumbent output. Audit content indexes and bundler output graphs
separately for missing media, CSS and lazy chunks; do not substitute authored-source existence or
JavaScript text scanning for compiler output evidence. The latter producer requirements remain part
of B1–B4 and final all-kind acceptance, not an exemption from completeness.

Compiled-content checkpoint `3119205be`: the common current-format build reader owns the validated
index, including pack identity, exact compiled source/dataset membership, written-versus-dataset
semantics and each indexed data file's receipt membership. Staging and installation use the same
check; CLI inspection consumes the captured result instead of maintaining its own weaker validation.
Applier-only sources intentionally contribute no compiled entry; they still produce the pack index.
Missing declared specialty source paths now refuse compilation instead of silently disappearing from
the index. Explicit native imports and source-free installed reads are preserved. Filesystem/compiler
regressions, installation/refusal and real shipped/external output checks pass; see [content admission
evidence](../references/evidence/discovery-without-activation.md#compiled-content-admission-2026-10-17). Producer media-byte and missing-output checks are implemented in the content/media checkpoint
linked below; declared directories alone cannot establish required file membership.

The common source-build association is now `dist/build-inputs.json`, written only after loader/thread
settlement and final validation, and sealed by the existing output receipt. It records completed native
observations, the package scope, compiler/runtime digest, hashed initial execution context and build
flags. Reused phases retain their prior observations. Native verification/replay lives in the host
build layer; it does not import the CLI, TypeScript or Vite. Compiler-copy namespace facts remain under
the installation identity rather than being replayed against originals. Staging omits the source-only
record; installed/offline inspection remains source-free. See
[checkpoint evidence](../references/evidence/build-input-snapshot-proof.md#completed-source-inputoutput-association-checkpoint).
Compiler-created worker reads now join that common record. Their watch probes use the existing
subscription owner, including missing-input recovery after failed builds and nested recursive
directories. Probe transport stays in the build workspace and never certifies output. Static
fingerprints and additional captured native facts retain distinct ownership; private compiler
bookkeeping is excluded from authored reads. See
[worker/watch evidence](../references/evidence/build-input-snapshot-proof.md#worker-watch-continuity-and-repair).
Native-library/platform lifetime and converged acceptance remain open under B1/B3/B6.
Expected emitted/copied output bytes and B5 consumer policies have the separate checkpoints below
and in the consumer evidence; the record alone does not establish those guarantees.

Frontend producer output expectations now use Vite's returned emitted bytes plus copied public bytes
from the existing walk, retained in memory until final sealing. Missing or changed expected output
refuses publication; ordered bundle emissions preserve public-placeholder replacement. CSS, lazy/worker
files and maps are included. See [frontend output evidence](../references/evidence/build-input-snapshot-proof.md#frontend-output-expectations-checkpoint).
Compiled JSON/index and ordinary media now feed the same final expectation check through
`CompilePackOptions.recordOutput`; deletion after actual media compilation refuses publication.
Native bundle writers now report bytes after source-map transformation; declaration writers report
final rendered text. Reused phases validate source bytes against the prior verified receipt before
copying, then retain their destination expectations. Snapshot/cache/input metadata are checked too;
inline flow helpers belong to their actual snapshot output. See
[remaining writer evidence](../references/evidence/build-input-snapshot-proof.md#remaining-writer-output-expectations-checkpoint).
B4 final producer acceptance still includes the remaining B1/B3 lifetime requirements and converged
checks. B5's four consumers are implemented with their recorded distinct freshness policies; preserve
their remaining converged acceptance.

The [asset producer audit](../references/evidence/build-input-snapshot-proof.md#asset-producer-audit-and-bounded-follow-through-2026-10-17)
now enumerates the remaining concrete paths. Vite's output graph includes CSS/lazy/worker emissions
but omits copied public files; media `fs.cpSync` bypasses the injected captured-byte view in a focused
compiler proof. Neither observation alone proves an invalid build can publish. Close input ownership
under B1 and expected emitted/copied bytes under the existing B4 input/output association. Preserve
public-directory copying and explicit media-import behavior; do not add another asset manifest,
JavaScript reference scanner or a second installed-reader authority. `e6ce3f1e4` removes the unused
declaration-only `readPackSnapshot`; current installed readers use `readPackBuild`. The subsequent
[B1/B3 matrix](../references/evidence/build-input-snapshot-proof.md#b1b3-current-compiler-path-matrix-2026-10-17)
locates current owners rather than treating every unverified path as new implementation. Source
`129b541de` closes ordinary media-byte consumption through the existing captured reads and preserves
copy modes/link behavior. Source `d09a7f447` projects Vite public copying onto the same captured owner,
preserving file permissions and emitted-bundle replacement. Native package executable/addon acceptance
`4c126846f` verifies existing capture on the current platform. Source `0e03d4021` scopes the whole frontend
operation to existing captured reads; ordinary Vue, dependency, CSS/SVG, lazy/worker/glob, Sass/Tailwind
and config-global paths plus real pack publication pass. Source `9ecf788fb` extends early startup capture
to declared npm bytes, filtered package membership and missing optional lookups using the same package
reader and observation protocol; native-preload and unchanged repeat-build acceptance pass. Source
`5c5f733fb` captures configured external esbuild executables in the same compiler installation and
verifies identity/reuse, missing fallback and the real worker handoff. Remaining runtime/native and transient dependency/namespace
acceptance, final whole-goal frontend acceptance and expected copied outputs under B4
remain open; these source checkpoints do not certify full producer coverage.

`a595246f2` supplies matching captured backend/Vite generations, private server caches, failed-refresh
retention and awaited retirement through the real watcher. Preserve that implementation; the execution
goal records configuration-derived invalidation and generated-entry browser HMR in `d3833f788`.
Remaining B1/B3 cases and the successful B4 input/output association are still required; do not restart
the locally accepted B2 owner.

Execute the identified gaps in this order:

1. Native designation comparison is repaired in `b268fac86` without expanding its contract. Three
   refusal regressions, positive bind/unload and all 646 pack-registry cases pass; host/SDK types and lint
   pass. Preserve this coverage; do not reimplement it. The prior authoring gate remains open for B6.
2. Compiled endpoint contracts are implemented in `774b0844c`, using the existing TypeScript contract
   reader and checked admission. Preserve static discovery, native partial composition, immutable
   effective receive sets and the shell inbox/UI distinction. Static event names do not authorize a
   sender or validate payloads. See the [checkpoint evidence](../references/evidence/discovery-without-activation.md#static-endpoint-contracts-2026-10-17)
   for passing checks and the incomplete strict gate; do not restart this implementation.
3. Close native backend contribution parity for migrations, content writers/appliers and artifact/block
   facets. Reuse shared binding checks instead of growing a second native validator. Any unsupported
   native slot must be explicitly absent from the supported contract and refused, not silently ignored.
   Viewer checkpoint `be5a9344b` shares authored/native backend checks; 705 affected cases, host/SDK
   types and lint pass. Discovery/unload, atomic refusal before authority, callback identity and existing
   frontend lookup coverage pass. No new public grammar or inventory was introduced. Preserve this
   implementation and its [evidence](../references/evidence/discovery-without-activation.md#native-backend-viewer-parity-2026-10-17);
   the resource-failed strict gate remains incomplete.

   Content checkpoint `2e1701fad` declares native writers/appliers and preserves explicit native
   `importCompiledContent`; 761 affected cases, 46 authored-manifest cases, types, lint, package builds
   and schema/API generation pass. Migration checkpoint `f72cb8756` adds checked native declarations
   and real targeting through the existing runners; 840 affected cases, types, lint, package builds and
   schema/API generation pass. Preserve app/pack version separation and captured accepted bindings. See [content evidence](../references/evidence/discovery-without-activation.md#native-content-declarations-2026-10-17).
4. Display-name cleanup `123efbd6f` and required-entry admission `b916d0e5e` are implemented; preserve
   their [evidence](../references/evidence/discovery-without-activation.md#required-build-entries-and-display-metadata-2026-10-17).
   Compiled index/data admission is implemented in `3119205be`; reader cleanup in `e6ce3f1e4` removes
   the unused weaker reader. Asset classes are classified in the linked producer audit; complete its
   concrete B1/B4 requirements and remaining consumer checks, then all-kind source-free/external
   acceptance. Record which asset classes and entry kinds the checks actually exercise. Keep B1–B6 and
   Phase 6 enforcement in their existing execution slots; this inventory does not reopen them.

No completion is claimed from this table. It identifies inspected implementation, concrete omissions
and the bounded checks needed to close them. Historical checkpoint evidence is not a second backlog.

Native migration checkpoint `f72cb8756` implements this contract; see the
[migration evidence](../references/evidence/discovery-without-activation.md#native-migration-targeting-2026-10-17).

Native migration checkpoint contract: reuse `migrations.app` / `migrations.pack`, with the same
keyed target/description/export grammar and shared checked callable bindings as authored packs.
Native app-line migrations use the app version and do not require a native version. A native declaration
with nonempty pack-line migrations must declare its own valid SemVer `version`; never infer it from
app provenance. Leave existing host/default-setup release metadata and migration inventories unchanged.

Migration runner targets carry `packId`, checked callbacks and, for the pack line, the owner's `version`;
they do not manufacture a manifest or installed directory. Type the two target results by the requested
line. Order admitted native and installed owners together by declared dependencies, then filter caller
subsets; unversioned native owners can participate in ordering without becoming pack-line targets.
Preserve the existing exclusion of synthetic installed origins without accepted manifests. Capture
migration target/description/function membership and owner version at admission so later registration
mutation cannot alter a checked migration. Keep existing app caps, failure/retry/version records and
startup/reset/import ordering. Prove source-free native discovery, app-only operation without a pack
version, per-pack cap/recording, mixed dependency order, atomic refusals, mutation isolation and unload.

Native content checkpoint contract: declare `content.writers` with the authored export-reference
map and `content.sources.<key> = { applier: "path.ts" }` for explicitly composed native appliers.
Native composition supplies the functions; these targets are discoverable data and are never loaded
by discovery. Native sources do not claim authored paths/formats, datasets or build output that native
composition cannot compile. Explicit `importCompiledContent({ compiledDir })` continues to execute
native appliers. Automatic application still targets installed builds with a real directory; do not
invent a native build directory. Share writer entity-ownership validation and backend binding-name
checks with authored packs, before granting runtime authority. Fixtures must declare their actual
entity owners rather than preserve the native bypass. Prove offline metadata, exact/duplicate/missing
membership, ownership refusals, explicit application and cleanup/rollback. Native migrations are implemented in `f72cb8756` with separate app/pack version semantics;
final all-kind and lifetime acceptance remain required.

Endpoint checkpoint contract: compiled `eventContracts` is keyed by local feature ID. A system records
`{ incoming: string[], outgoing: string[] }`; a surface records `{ receives: string[] }` (its own system's
outgoing events plus its declared inbox). Shared SDK lifecycle events remain implicit in the protocol
and are added when deriving effective receive sets. The producer reads declared TypeScript contracts,
never pack modules; manifest `system.events.incoming` remains an explicit routing addition. Generated
`packSystem` receives that declared input list instead of inferring a public inbox from machine handlers.
Internal child events are not published as incoming events. Keep payload types in the checked facades;
an event-name inventory is not runtime payload validation or sender authorization.

An installed snapshot declaring an endpoint must contain its compiled contract; omission is a build
refusal, not an empty inbox. Native composition supplies the same data, independently of bindings, and
may bind only the systems its environment runs. Every bound native endpoint must match its declaration;
its inactive declared peers remain discoverable. Native shell inboxes need no UI pane declaration.
The catalog/CLI expose declarations independently of active event-validation maps. Verify generation,
malformed/missing contracts, source-free inspection, native partial composition and changed runtime
membership before the next checkpoint; migrate all readers, fixtures and reports with this contract.

## Architecture

```text
Author declarations + source/content
                 |
               Build
                 |
Complete descriptor + static data/assets + executable builds
                 |
       Host contribution catalog
                 |
       Activation binds implementations
```

### One generated descriptor, extending the snapshot

Extend the existing snapshot to carry normalized discovery metadata. Resolve local metadata/data files
at build time, qualify owner identities and embed or index the required static files. Use symbolic
icon names or asset references rather than Vue component objects. Publish generated contracts without
requiring readers to execute their source modules.

The author declares a fact once. Codegen derives the descriptor and runtime binding from that declaration;
do not copy labels/defaults into both a surface object and a manifest. Where metadata currently comes from
executable exports, move its authoring location to data rather than try to evaluate arbitrary functions
at discovery time. A typed source definition can remain build input only if its descriptor is generated
before installation and there is no independent runtime account of the same metadata.

Read descriptor/data references within the installed build and verify them under the existing integrity
contract. Reject unsupported formats, missing required assets and inconsistent identity with actionable
diagnostics. Do not fetch or execute missing dependencies just to list what is installed. Source-checkout
inspection may expose unbuilt/incomplete status, rather than activate the source to fill gaps.

### Static help data checkpoint

Materialize help in `PackSnapshot.help` from its Markdown data source during build. It is required when
`extensions.help` is declared; absence means no declared help contribution, not an old-format fallback.
Validate document fields, local IDs, uniqueness and feature ownership before admitting the snapshot.
Remove help from backend registration/codegen and retire its runtime store. The existing contribution
catalog qualifies and sorts articles for installed packs, including disabled or activation-failed ones.
Source declarations supply explicit help data; source tooling may parse Markdown data,
but discovery never imports a pack module to fill it. Native all-kind descriptor ownership remains a
required checkpoint; the host currently declares no native help articles. Source declarations with unmaterialized declared
help report that incompleteness rather than silently pretending the pack has no articles.

Use one general catalog-change subscription for data consumers. The Help system follows that resource,
not PACK_CHANGED activation events; settings follows the same catalog through its existing projection.
Prove readable help with poisoned executable entries, disabled packs and atomic invalid updates, then
verify actual help navigation and source/built authoring. This checkpoint does not replace the required
surface/step/reference/editor/hook metadata and frontend binding work.

### A catalog separate from running implementations

Introduce a host-owned catalog over the validated installed descriptors and resolved dependency graph.
Expose it to the renderer as data. Listing, navigation, settings, help, palette metadata and compatibility
inspection use that catalog, not the executable registration stores.

Keep these facts separate:

- Declared: the descriptor contains the contribution.
- Eligible: host compatibility, dependencies and enablement permit its use; otherwise give a reason.
- Active: its implementation is loaded/running, or failed with an activation problem.

Discovery does not require activation. Opening a custom form or executing a command may require it.
Data-only settings remain inspectable/validated while a pack is disabled; forms follow the settings plan.
Refresh the catalog on install/update/removal and dependency changes without creating runtime actors.
Keep stored overrides and other user data outside the catalog.

### Authoritative declarations and checked binding

The validated backend/content checkpoint checks backend feature identities, designation values, system/surface
presence, surface default visibility, per-feature service names, and the aggregate provided-service and
repository names against the accepted manifest. Both installed loading and direct origin-bearing
registration perform this check before registry mutation, catalog publication or settings authority
binding. A matching declaration stamp alone did not enforce this membership. Installed test builds
must declare the contributions they actually bind; do not infer manifest facts by executing their runtime.

The integration gate confirmed a facet mismatch in the testing harness: content-only runtimes were
adapted into full backend registrations. Settle two explicit operations instead. Backend registration
binds the manifest's systems, surfaces, roles and services. Content registration binds only the generated
content runtime's own entities, relations, repositories and writers, with optional declared appliers;
it activates no actors and claims no backend services. Both retain the same accepted declaration identity,
owner and catalog data, and share registry collision, rollback and teardown machinery. Do not add a
skip-validation flag or manufacture missing actors. Move the producer's `ContentRuntime` contract to
SDK framework ownership, remove the harness's fake backend-registration assembly, and check content
identity/membership through a separate registry operation. Backend integration fixtures must also declare
their hand-written systems/surfaces rather than adding them only in test setup.

The next working extension checks backend entity/relation values, writer/applier identities, step,
artifact and block type membership, command names/placeholders, migration lines/targets, and hook-module
presence. It checks step runtime flags and handler presence and refuses frontend facets in backend
bindings. Missing/extra/duplicate arrays and explicit malformed values are refused before registration.
Help bodies, migration descriptions, hook export availability and other hidden module metadata still
require materialized descriptors; do not infer them by activating a pack during discovery.

The migration producer must bind explicit fields rather than spread the exported object: target comes
from the manifest, description is read from the source object, and calling `up()` retains that receiver.
Spreading allowed an extra target to overwrite the manifest and dropped class prototype methods.
Generated import paths must be relative to the actual generated directory, not computed by stripping an
assumed `src/` prefix. A bundled generated-entry regression exercises a root-level migration instance,
checks the authoritative target and executes its receiver-dependent method.

This is partial binding coverage. Remaining kinds, static metadata/assets, generated event contracts,
frontend membership and the native host declaration inventory still need their own checks and catalog
projections. Do not call a matching key set a proof of an executable object's full contract, or describe
this backend check as complete discovery without activation.

Activation binds implementations to catalog entries. The runtime cannot silently add an undeclared
contribution or redefine static metadata. Check the identity and shape of bindings when loading, retaining
the existing rollback mechanism for failures. A mismatch is an activation error, not a discovery mutation.

Preserve each extension point's actual ownership policy. Some names are exclusive; step facets and other
shared contributions may compose. Discovery must show all owners and the applicable conflict/merge policy,
not flatten them with last-wins provenance. Handle shared transitive dependencies once by identity.

Use generated bindings as the supported registration path; migrate all in-tree manual callers/fixtures.
This is a consistency contract, not proof that in-process pack JavaScript cannot perform unrelated side
effects. Do not claim that a descriptor proves a handler is safe or will run successfully.

## Dynamic behavior remains executable

| Discoverable fact | Runtime result |
|---|---|
| Reference category, provider contract and owner | Current matching items from that provider |
| Step type, static label/defaults and available facets | Label/layout computed for a particular live node |
| Command identity and contract | Its outcome |
| Migration line, target and description | Whether it succeeds and which rows it changes |
| Custom form/pane presence and source binding | The rendered component and state-dependent visibility |
| Content index and compiled entries | User-specific rows produced by an applier |
| Declared API/dependency requirements | Availability of an external service during a call |

Represent provider presence and requirements in the descriptor even when its results require activation.
Static UI eligibility may use host-known data. Arbitrary pack predicates stay executable; discovery must
not call them. Do not add a general expression language merely to disguise runtime behavior as metadata.

## Refactor the consumers, not just the manifest

These migration designs retain their behavioral requirements. Their present-tense code descriptions
were written before subsequent checkpoints; use the [current discovery checklist](#current-discovery-checklist)
to distinguish landed migrations from outstanding ones. In particular, settings, help, pack information,
reference/editor readers and step palettes are no longer wholesale pending migrations.

Audit performed against the current checkout on 2026-10-12. The catalog must replace the machinery
that reconstructs declarations from running code. Adding a catalog alongside that machinery would leave
two accounts of the same facts and retain the startup races this boundary should remove.

### Settings: remove the installed/registered union

`packages/apack-host/src/packs/registry.ts` currently combines `registeredSettingsRefs()` with
`installedSettingsRefs()` for `featuresWithSettings()`. The installed half parses manifests separately
through `manifestSettingsRefs()` and caches against `packsDirStamp()`. It discovers a disabled feature's
identity, but not its executable schema/defaults. A directory timestamp also does not describe changes
inside an existing pack directory.

Replace this union and its filesystem/cache helpers with catalog settings declarations. Remove the
registry's `installedPacksDir` option if no other caller needs it. In `backend-extensions.ts`, retire
`createSettingsDefaultsStore()` as an activation-owned contribution store: compose and validate defaults
from the settings catalog instead. Keep settings revision/subscription behavior, sourced from committed
declaration changes rather than register/unregister. Activation alone must not remove defaults or change
effective settings. Enablement/visibility policy is separate, as specified in the settings plan.

`packages/renderer/src/views/settings/canvas/tabs/FeaturesTab.vue` filters `allSurfaces` by
`surface.settings`. Replace that list with declared settings owners, including features without a surface.
Resolve a custom component through the executable binding only when rendering it; show unavailable forms
without hiding the declaration. Move `application/be/system.ts`'s default visibility read off the runtime
settings store too. Keep the settings service, override storage, write correlation and live change delivery;
those implement behavior beyond discovery.

### Pack information: stop using registration as an inventory

Implemented in `6c876c9ba`: `toInstalledPackSummaries()` reads accepted catalog declarations,
joined to host-owned installation records, activation diagnostics and applied-content offers.
Disabled packs retain features, provided services, extension keys, migrations and hook presence.
Frontend availability comes from the accepted asset receipt. Refused replacements retain accepted
metadata; unreadable installations remain visible with a refusal and no invented version.
Catalog diagnostics publish atomically before listeners, without replacing unchanged settings definitions.

Separate pack information types from the runtime registry module. Keep declared, eligible and active
states explicit; frontend and backend outcomes may differ, including between windows. Do not turn the
catalog into another persisted installed-packs list: directories remain installation evidence and
`installed-packs.json` remains the side table for user choices/update provenance.

There is a runtime caller to migrate before deleting `getPackExtensions()`:
`runtime/lifecycle.ts::teardownPack()` uses its systems list. Use the existing
`getRegisteredPackSystemIds()` for teardown, because stopping systems means stopping actual bindings,
not every declared system. Keep `loadedPacks()` for genuine execution callers where needed; replace only
its use as the source of discoverable metadata.

### Shell: separate known navigation from frontend readiness

Checkpoint `69860e4be` moves default selection and destination eligibility to the catalog. The host
and window share surface projection; local native host declarations are available before a connection.
Checked surface bindings retain the captured declaration and accepted backend build/runtime identity.
The first-registered default table and its SDK lookup are removed. Enabled native default claims
precede installed claims, then fully qualified feature refs sort in English lexical order, independent
of frontend delivery. A saved selection, popout target or explicit navigation wins over the default.
A default is rendered only after its actor exists.

Unknown destinations refuse once the catalog is ready. Disabled, source-only, unavailable and failed
providers have distinct refusal paths. Known providers retain actual actor-readiness waiting and
request correlation. A catalog frame can reconcile an already-admitted frontend; stale completion and
replacement-gap dispatch cannot replace or reach an incumbent actor. Scoped catalog subscriptions
are released on shell stop. Native host Settings remains accessible while external declarations load
or disconnect. These are checked implementation claims; final goal acceptance remains outstanding.

Remaining: move sidebar/menu inventories, labels, declared visibility and navigation order to metadata,
joining readiness for actual rendering. `context.surfaces` remains the active implementation/actor
inventory. Keep `wantsDefaultSurface` while it records unresolved initial user intent, and pending work
while it waits for an actor; remove only superseded discovery responsibilities.

Inspection correction: `features/application/fe/pack-frontends.ts` already emits explicit
`PACK_FRONTENDS_SETTLED.failedPacks`, uses cancellation, and preserves incumbents after failed candidate
loads. It does not report failed imports as a successful empty surface array. Preserve that behavior;
do not reimplement the nonexistent overloaded-result defect. Audit remaining load/retry/unload
coordination for extraction from navigation state, retaining revision, cancellation and readiness
ownership. The shell must not maintain another contribution metadata inventory.

`packages/api/src/transport/packs.ts`, `fe/client.ts` and `packs/layout.ts` currently expose
`packs.loaded` / `LoadedPackEntry` as both an inventory and instructions for loading frontend files.
Expose catalog descriptors separately from activation state. Obtain entry/style references and revision
identity from validated build metadata, eliminating repeated file probing/hashing in list queries.
Preserve revisioned URLs, stylesheet cleanup, `pack://` delivery and the source/HMR loader override.

### Help, commands and editor metadata: retire runtime data stores

`backend-extensions.ts::createHelpStore()` validates, qualifies and sorts static articles on registration.
Move those operations to descriptor validation/catalog projection and remove the runtime help
contribution/undo entries. `features/help/be/system.ts` can remain a delivery adapter; its source becomes
the catalog and its refresh cause becomes catalog change. Help must remain readable after deactivation.

Likewise, move static command metadata and stable ordering out of `createCommandStore()`; keep any
executable command binding separate. `default-setup/src/features/library/be/services/library.ts` combines
`getPackCommands()` with user-content commands: migrate the declared half without treating database
commands as static. Keep updates caused by edited/applied user content. Remove registration-driven
rebroadcasts only where the catalog subscription replaces them. Inspection may list a disabled pack's
commands, but the execution picker must apply eligibility and execution still needs active handlers.
Today's declared slash commands fire `user.command` into flows; discovery must not bypass that path.

`apack-sdk/src/build/generate-entries.ts` builds reference maps/categories/provider arrays by importing
feature modules. `default-setup/src/extensions/tiptap/useReferenceItems.ts` then invokes every provider's
`useItems()` when the picker mounts. Generate data descriptors separately from navigation/provider
bindings; move category/icon readers to the catalog; parse stored targets independently of metadata. Initialize providers only for actual item
queries, with explicit lifetime/disposal, rather than to list categories. Audit `reference-config.ts`,
`ReferenceSuggestionPopup.vue` and `reference-suggestion-surface.ts` together. Dependency-scoped generated
contracts remain useful; do not replace them with an untyped global provider search.

Step/artifact/block palettes and DSL/editor readers need the same split. Preserve execution-facing
lookup APIs, but add explicit descriptor reads rather than making a method sometimes return metadata
and sometimes an implementation. `fe/pack-store.ts`'s `loadComponents()` runs during registration;
catalog readers must never reach it. Moving component loading to first render is a separate activation
optimization, not necessary to complete this refactor.

### Shared readers and refresh: remove duplication without erasing policy

Use one validated build reader in discovery, activation and offline tooling.
`runtime/lifecycle.ts::activatePack()` reparses `apack.json`; `database/schema.ts` independently reads
installed manifests/snapshots and enablement records. Reuse descriptor/identity/ownership validation
there, while preserving the offline database tool's strict refusal policy and its selected schema.
The schema must match what the app would use; including every disabled declaration is not equivalent.
CLI source inspection and dependency fetching keep their separate build/resolution responsibilities.

Publish a committed catalog revision after install/update/remove/declaration rebuild, independently of
runtime readiness. Migrate static consumers from `PACK_CHANGED` and register/unregister subscriptions
to that revision. Keep `PACK_CHANGED`/`SEND_STATE` where systems need to publish live content or state.
Do not publish intermediate filesystem replacement gaps as removal; retain the prior committed view
until the replacement decision completes, with outcomes handled under the installer contract.

### Runtime machinery to retain

Discovery is not delivery or execution. Keep contribution undo logs/owned binding stores, collision
checks at binding, system teardown/shutdown hooks, module-cache cleanup, runtime facet composition,
and migration/content execution order. Move static ownership checks earlier without trusting that
runtime bindings necessarily match the build.

Keep `packClientReady` and the bus's client readiness handshake until an actual replacement guarantees
that startup messages arrive after actors exist. Knowing a surface's contract does not make its actor
ready, and does not authorize a connection to claim that surface. Do not widen event routing from active
bindings to all catalog entries. Catalog initialization itself also needs an explicit ready/error state;
an unread catalog is not an empty inventory.

Give host-owned contributions a data representation too. The host's registration is currently included
in runtime lookups; a catalog containing only installed pack builds would quietly lose host navigation
and settings. Compose trusted host descriptors with installed descriptors through the same ownership
and projection rules, without pretending the host is installed in the packs directory.

### Removal checkpoints

Deliver each consumer migration with deletion of its superseded projection/store/cache and updates to
SDK test doubles, generated contracts and callers. Track remaining runtime reads in the inventory;
avoid compatibility aliases or a permanent parallel catalog/registration API for the same static fact.
For each checkpoint record what was removed, what execution responsibility remains and the regression
test that protects it. Extract the frontend coordinator only when migrating its consumers, so it does
not become a second coordination layer alongside the old shell actions.

## Delivery sequence

1. **Close the inventory on the completed naming baseline.** Map every registration/manifest field and reader to declaration, metadata,
   asset or runtime behavior. Record exact remaining gaps and dependency ownership rules here.
2. **Establish the shared foundation with settings.** Build descriptor validation and the catalog with
   the linked settings plan as the first consumer. Establish checked binding, ownership checks and
   coherent build publication for that projection before switching readers. Complete settings’
   ownership/migration and schema/default/form contract on this foundation, as the roadmap specifies.
   Do not build separate settings and contribution catalogs.
3. **Extend the snapshot descriptor.** Resolve facade terminology and required-facade diagnostics from
   the absorbed [facade goal](../goals/goal-defs-naming.md) in this checkpoint. Add the necessary
   static metadata and asset indexes, deriving them
   from declarations. Start with surface navigation, reference types and anonymous editor contribution lists.
   Materialize help/step metadata and API/lifecycle contracts until the inventory has no executable reads.
4. **Extend checked binding and freshness before switching readers.** Audit watch/codegen/snapshot
   invalidation with [dev-loop freshness](../goals/goal-dev-loop-freshness.md). For each added kind,
   generate metadata and bindings from the same declaration and build revision; reject added, missing
   or inconsistent bindings. Preserve the last valid catalog on a failed rebuild and report it as stale.
   Do not publish new runtime code against stale metadata. Keep owned binding cleanup and reload checks.
5. **Build catalog readers and move consumers.** Validate installed descriptors; expose data to frontend
   and CLI readers. Move each discovery consumer off runtime registries, preserving deliberate ordering
   and ownership behavior. Follow the audited removal checkpoints above: settings/pack details/help,
   then shell navigation and editor/palette readers. Delete superseded glue in each checkpoint. Report
   incomplete/unavailable packs without trying to activate them.
6. **Prove completeness and update contracts.** Exercise every contribution and consumer, update snapshots,
   schema/API reports, public authoring docs, templates and fixtures, and remove obsolete metadata exports.

Each implementation checkpoint remains usable with migrated callers. Apply the existing snapshot-format
rule for contract changes; do not bump package release versions. This work does not require making pack
execution lazy. Link the resulting catalog boundary into the [deferred lazy activation plan](../../plans/deferred/lazy-activation.md)
without changing migration/content execution order here.

## Handoff to subsequent plans

Entity navigation consumes catalog identities and readiness, then adds its build-checked `opens`
contract. Discovery separates reference metadata from executable navigation bindings; it does not delete
`navigate` callbacks before [entity opening](open-entity.md) migrates their callers. Frontend boundaries
contain runtime component failures; API consumption extends the existing caller-bound facade; replacement
uses committed build/catalog revisions. None introduces a second contribution inventory. Lazy
activation is deferred outside the active roadmap; discovery alone does not change when migrations or systems run.

## Acceptance: no discovery gaps

- A fixture covers every supported contribution kind and its nested metadata. After building, replace
  each executable pack/dependency entry with an import-time throw and update test integrity metadata so
  the test does not merely fail the hash check. Descriptor discovery and each catalog consumer still work.
- Instrument pack module loading and side effects: zero executable pack/dependency loads, actors,
  components, hooks, migrations, appliers and user-data writes during discovery. Test both backend and
  frontend discovery paths; an unused loader mock is not sufficient proof.
- Discovery lists metadata, settings, references, palette entries, editor contributions, help, declared
  content, APIs and lifecycle requirements for enabled and disabled packs. Dynamic results are explicitly
  unavailable until execution, rather than silently absent contributions.
- Missing dependencies, incompatible host/format, malformed descriptors and missing assets yield useful
  status. Shared dependency diamonds preserve true ownership and do not duplicate contributions.
- Activation cannot introduce extra contributions or replace static metadata. A binding mismatch fails
  cleanly without removing another pack's contribution or partially mutating the catalog.
- Update/remove/reinstall refresh catalog entries and preserve user data; failed replacement retains the
  previous valid build/catalog for failures before publication. Activation failures report a separate
  outcome; do not promise rollback of arbitrary migration/content side effects. Verify and document the
  installer’s actual commit boundary before extending replacement.
- Add a contract-coverage check requiring each new registration/extension field to identify its discovery
  representation or executable role. New contribution kinds extend the fixture and relevant consumers.
- Disable/deactivate/reactivate without changing the descriptor: settings defaults and help stay intact,
  pack details remain complete, and navigation identities remain known with their availability status.
- Before frontend imports finish, default and saved/explicit navigation follow the declared selection
  policy. An unknown ref is refused without waiting for unrelated packs; a known ref's queued events reach
  its actor once ready, with correlation preserved. A failed import stays failed, not loaded-empty.
- Exercise reconnect, two windows and update/unload during an in-flight frontend load. Stale results
  cannot restore removed bindings; startup data reaches ready actors; failed replacement retains the
  previous committed inventory without transient removal or reordering.
- Listing reference categories/help/settings/palette entries starts no live providers or components.
  Actual reference queries initialize only their required providers and clean them up on disposal.
- Static catalog refresh does not invoke migrations/content appliers or duplicate live-state broadcasts.
  Edited user-content commands still refresh; offline database schema inspection still honors its
  enablement and strict-error policy. Source/HMR loading and revisioned installed assets still work.

Run focused specs per boundary, external-pack contract/app checks, affected schema/API generation and
`npm run chain`. Add targeted UI checks for navigation/help/settings/palette discovery before activation.
Inspect the built build itself; source-level manifest tests cannot prove installed completeness.

## Research and scope

[VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points) and
[activation events](https://code.visualstudio.com/api/references/activation-events) demonstrate the separation
of declarations and executable implementations. They do not imply all extension behavior is statically
discoverable or require apack to copy their field vocabulary.

Keep process isolation, general lazy activation, executing user migrations during discovery, remote
provider queries and prediction of arbitrary code behavior outside this plan. The completion criterion
is full discovery of the supported contract, enforced at contribution boundaries.

The separate [pack security isolation goal](../../goals/goal-pack-security-isolation.md) owns confinement
and resource permission enforcement. Discovery supplies inspectable declarations; it does not grant
access or prove that executable pack code is confined.


## Checkpoint evidence

Build-input investigations, historical foundation surveys and implementation/validation checkpoints
live in [the discovery evidence record](../references/evidence/discovery-without-activation.md).
This plan retains the supported contract, current checklist and acceptance requirements. The
[execution goal](../goals/goal-settings-and-pack-contracts.md) owns the remaining B1–B6 build work
and checkpoint order. Unresolved requirements in the evidence remain in scope; history is not a
second execution sequence. Record new evidence there and update the current checklist here.
