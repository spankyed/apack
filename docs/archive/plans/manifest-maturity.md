# Make pack manifests dependable contracts

Status: archived 2026-10-21. The settings/discovery/manifest contract delivery completed 2026-10-19; see the
[completed execution goal](../goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19). Every row of the
remaining-work ledger below is implemented, decided or rejected, and each track it lists has its own goal or plan.
The numbered sequence and dated handoffs describe the delivered architecture, not a backlog.
Originally written 2026-10-12 on `AS/feature-settings-rework`.

## Goal and sequence

The host and authoring tools should explain what a pack provides, what it needs, whether it can run,
and why it failed. Authors should discover mistakes before installation or activation, and a dependency
resolved on one machine should be explainable on another.

apack already has generated schemas and accessors, snapshots, build integrity checks, migrations and
host-version checks. Build on these mechanisms. The priority is completing their contracts rather than
adding fields because another ecosystem has them.

Completed prerequisite: [naming contracts](../goals/goal-naming-conventions.md), closed in
`3d389b9c8`. Build on that result; no ongoing naming synchronization is required.
The [execution goal](../goals/goal-settings-and-pack-contracts.md) owns checkpoints and completion.

The list below records architectural dependencies, not a serial execution barrier. The execution
goal’s live ledger owns current status and order, including independent entity navigation before
remaining compiler work. Preserve each consumer’s actual prerequisites.

1. Close the contribution inventory and establish the common descriptor/catalog foundation, using
   [settings architecture](settings-architecture.md) as the first consumer. Include shared validation, diagnostics, checked binding and build freshness for each migrated kind. Do not create a temporary settings-only catalog.
2. Complete settings ownership, current-format stored data, typed access, shared/owner mutation policy,
   custom forms and the independent window runtime.
3. Preserve the completed authored [manifest consolidation](manifest-consolidation.md), checkpoints
   M1–M6 through `0994ae787`. Its remaining full-kind discovery, frontend naming and facade obligations
   continue in the next step. Preserve generated EARS/content identities and the shared declarations.
4. Complete [discovery without activation](discovery-without-activation.md) and delete superseded glue.
   Extend the foundation’s descriptor/codegen freshness and checked binding to every supported kind.
5. Deliver [entity navigation](open-entity.md) and frontend error boundaries from
   [fault isolation](../../plans/pack-fault-isolation.md), using catalog destinations and explicit readiness.
6. Finish consumed-API contracts, dependency provenance and
   [shipped-pack replacement](replaceable-shipped-packs.md) as separate workstreams. Replacement depends
   on validated build publication and committed catalog updates; consumed APIs need not wait for replacement.

Treat each item as a separately scoped change with its own evidence and validation. This plan is the
roadmap; the linked plans hold subsystem design. Do not implement all of them as one manifest rewrite.

## Checkpoint handoffs

| Checkpoint | Required result for dependent work |
|---|---|
| Naming — complete | Use the completed contracts as the starting baseline; do not repeat their refactors |
| Shared foundation | Contribution inventory, common descriptor reader/validator and catalog; settings definitions are the first projection. Migrated kinds have checked bindings and coherent build publication |
| Settings | Host/pack/feature ownership, current-format stored data, schema-backed handles and policy, custom forms and window runtime work on that foundation |
| Manifest consolidation | Entity/shape ownership, relations, lifecycle, checks, descriptions, format-key removal and canonical writing satisfy M1–M6 with preserved EARS/content behavior |
| Complete discovery | Every supported kind and static consumer uses descriptors; activation outcomes remain separate, stale loads are rejected and obsolete discovery glue is deleted |
| Navigation and boundaries | Catalog destinations drive entity opening; failing panes/forms leave the shell usable |
| API consumption, provenance, replacement | Independent follow-ups reuse catalog identities and caller binding; replacement distinguishes update ownership, disable and removal |

The settings and discovery delivery lists are parts of these checkpoints, not competing roadmaps.
Inventory all contribution kinds up front; migrate one kind at a time with its validation, binding and
freshness checks in place before switching its readers. Future contribution kinds extend that same
contract and coverage fixture. Discovery completeness is about supported declarations, not live query results.

## Plan ownership and supersession

This document owns architectural dependencies and remaining manifest decisions; the execution goal
owns the current checkpoint order. Settings and discovery own their detailed
contracts. The following older designs are archived as absorbed/superseded, not marked implemented:

| Historical document | Current owner / disposition |
|---|---|
| [Convention-first manifest](manifest-convention-first.md) and its example | Discovery keeps the complete generated descriptor; implicit contribution existence is rejected |
| [Declarative contributions](declarative-contributions.md) | Discovery owns its inventory, data boundary and checked binding |
| [Manifest redesign goal](../goals/goal-manifest-redesign.md) and its example | Remaining-work ledger below; the example is not a target schema |
| [Facade naming goal](../goals/goal-defs-naming.md) | Descriptor work owns facade terminology and missing-contract diagnostics |

The [naming contracts goal](../goals/goal-naming-conventions.md) is complete; its contracts are the baseline for this work.
Do not duplicate its renames in the settings/discovery implementation. Settings-specific names stay in
the settings plan, as that goal already specifies.

### Remaining-work ledger from the archived designs

| Item | Decision and destination |
|---|---|
| Complete generated inventory, event contracts and static assets | Adopt in discovery; declarations determine supported contributions, build materializes their complete descriptor. Step node labels/defaults are inline and checked in `324816421`; authored frontend metadata/bindings and explicit type/helper sources land in `cda9fa00e`. Native step grammar/catalog projections, captured data and active ownership land in `fdd967ec5`; mandatory frontend admission and accepted binding rows land in `e5dcdec63`; keyed-declaration preservation lands in `29f0cc556`; frontend live readers/caches land in `76df2f0e5`; backend defaults/obsolete lookup cleanup land in `71fad4013`; complete backend facet declarations and source-free trigger helpers land in `8ec5285ed`; node-update write eligibility lands in `f7d63434c`; generated run-output isolation lands in `ecbb2c6af`; content-based source freshness and the common input/output record are implemented (B2/B4/B5); the execution goal owns remaining B1/B3 native/platform closure, B6 and final all-kind/asset acceptance |
| Conventional implementation paths | M4 completed in `11bdc7faa`: one scaffold path definition, declared-target validation/doctor and real external authoring agreement. No implicit existence or forced file renaming. M6 authored documentation/schema coverage is implemented through `0994ae787`; preserve it through final acceptance |
| `provides` lists and filesystem-inferred existence | Reject as a second authority beside existing keyed declarations; do not implement the old feature grammar |
| Entity names/shapes and feature ownership | M1 lands in `2fff8bb76`: owned feature/pack declarations, explicit null for untyped and one projection. Required [own-key preservation correction](manifest-consolidation.md#required-own-key-preservation-correction-2026-10-15) completed in `29f0cc556`: accepted own keys survive parsing, compiled bindings and source-free discovery; preserve this contract through reader migrations |
| Relation identity maps | M2 implemented in `3ff590240`: `data.relations` wire lists, unchanged generated EARS/content, validated names/uniqueness/reservations, native bindings and collision/provenance behavior |
| `volatile` declarations | Do not resurrect removed partition policy without a real requirement; track storage semantics with the LMDB work |
| `boot`/`lifecycle` metadata | M3 implemented in `e063ec1a5`: explicit lifecycle targets, shared native/installed checked hook bindings, preserved order and byte-identical compiled content |
| Module-reference syntax | M1 uses one shape-reference parser; M4 type authoring implemented in `0e65ece42` uses explicit module paths with type-only export-star semantics. Shared named/default parsing and contained file resolution implemented in `4285d748c`. M4 grammar/inventory/conventional-export and authoring checks are complete through `11bdc7faa`; richer component/loading declarations remain intact. Full contribution-kind discovery and M6 coverage remain required |
| Schema descriptions, current-schema diagnostics, semver/ranges | Adopt in validation/diagnostics and every surface-changing checkpoint |
| Default navigation and feature descriptions | Feature descriptions implemented in `ae7a995bd` through schema, scaffold, native/catalog and inspection. M4 target/layout and native/frontend default-claim checks completed in `11bdc7faa`; `69860e4be` replaces registration-order selection with enabled native claims before installed claims, then English lexical feature-ref order. Current selector and public docs agree; final discovery/navigation acceptance remains required |
| `builtIn` and shipped provenance | Replacement owns behavior changes; provenance is host-established, never author-declared trust |
| Build/check configuration and sidecars | Preserve build options; M5 inline allowances implemented in `24bd9f116`, with one policy/schema, no sidecar reader and unknown/non-switchable refusals. M5 format cleanup completed in `9374189e5`: no authored version key, exact build stamps, retained facade-capability acceptance. M6 writing/order implemented in `4bd88f6c9`; schema/editor/docs coverage remains required |
| `extensions.fe` and `hostVersion` questions | Settled in consolidation: direct `extensions.textEditor` and `extensions.appExtensions` during their declarative migration (no frontend wrapper); keep `hostVersion` for one host range. No blanket fe/be rename |
| Snapshot `defs` versus DSL definitions | Required `facades`, `PACK_TYPES_FACADE`, complete cached build types with no separate extracted facade inventory, named required-facade refusals and unchanged capability-based acceptance; keep actual DSL defs |
| Format/version assumptions | Required M5 removes `$manifestVersion` and audits exact layout-stamp acceptance; preserve current snapshot/layout constants and release metadata, separately from facade capability acceptance |

The [complete reconciliation](manifest-consolidation.md) accounts for every original decision, both
naming questions, phase checks, flow/action dependency edges, CLI contribution inventory, authoring
tool agreement and unchanged-content identity. Each active requirement needs implementation evidence;
this ledger is not permission to downgrade an outcome to a survey.

### Other tracks and documents to revisit

- [Lazy activation](../../plans/deferred/lazy-activation.md) is deferred by request, outside the active sequence.
  Revisit only when boot attribution justifies it; discovery completion does not trigger this work.
- [Dev-loop freshness](../../goals/goal-dev-loop-freshness.md) remains a scoped follow-up; descriptor freshness
  needed by discovery belongs in discovery's checkpoints, not in an unrelated package watcher redesign.
- [Pack security isolation](../../goals/goal-pack-security-isolation.md) remains a separate design-first goal.
  Reconcile its frontend isolation input there; security confinement is not required to discover data.
- [LMDB-only](../goals/goal-lmdb-only.md), console transactions and advisory locks remain a separate storage
  track. Settle their overlapping transaction/lock decisions together before changing persistence.
- Surfaces-to-surfaces, logs extraction and distribution remain deferred. Re-audit their APIs after the
  earlier contract changes; none is a prerequisite here. [Stretch-projection removal](drop-the-stretch-projection.md)
  is independent tooling cleanup, not part of the manifest workstream.

Update affected active docs at each checkpoint; archive a completed plan with evidence then. Preserve
historical text in the archive, with status and successor links. Public docs describe shipped/current
behavior until the corresponding implementation lands, not merely because a plan changed.

## 1. Complete discovery without activation

The complete scope and acceptance criteria live in
[discovery without activation](discovery-without-activation.md).

Settings is the immediate example: app, pack and feature definitions become data that the host can read
without importing an executable settings module. Follow the dedicated settings plan for that work.

Next, inventory labels, icons, commands and other contributions. For each, distinguish the facts needed
to list or validate it from the implementation needed to execute it. Move metadata still hidden in
runtime exports into declarations only where a real consumer needs discovery before activation.

The manifest declares the contribution once; codegen derives runtime registration and snapshot metadata
from it. Avoid a second handwritten contribution inventory. Reuse the existing build pipeline and
provenance machinery instead of building a generic extension framework.

Targets: SDK manifest schema, snapshot model, `generate-entries.ts`, host registration and frontend
contribution loading. The [reference inventory](../../references/declarative-contributions.md) explains the
current gap; the discovery plan is the implementation contract, not the archived contribution plan.

Evidence: a pack with a runtime that throws on import can still be described from its built declarations.
The declared names, generated registration and discovery result agree. Existing pack behavior survives.

## 2. Share precise validation and diagnostics

The first implementation checkpoint introduces shared `PackDiagnostic` / `PackValidation` records.
Manifest and feature checks carry codes, severity, owner and paths; `apack pack validate --json` renders
one report. Exit codes are 0 valid, 1 invalid and 2 incomplete. Dependency failure names skipped checks
instead of claiming validity. Validation resolves existing builds without downloads or cache writes,
including a selected beta host; malformed manifests skip checks that require their shape. Build and
installation keep their strict refusals. Preserve the shared records as contributions change. Complete semver and nonempty range validation
are implemented in the current declaration schema; retain their current-contract checks at final acceptance.

Introduce a shared diagnostic record with a stable code, severity, owning pack, manifest path and human
message. Include a source location or actionable suggestion when available; do not require every checker
to manufacture one. CLI text and machine-readable output are renderings of the same result. Use the
same semantic checks in validation, build and install where their inputs are available.

Report valid, invalid or incompletely checked, including which checks were skipped and why. An incomplete
authoring check should remain useful offline; strict build/install gates must not mistake it for successful
validation. Decide exit-code behavior explicitly when adding machine-readable output.

Preserve the implemented value contracts before adding more fields:

- `version` validates the complete SemVer string, including optional prerelease and build metadata.
- `hostVersion` uses the shared nonempty semver-range validator at the manifest boundary.
- Export/source references use several conventions. Preserve intentional differences (component default
  exports versus named runtime exports), document them, and share resolution/checking where they overlap.
- Check dependency/reference errors at the earliest phase that has enough information; the host remains
  responsible for conflicts involving unrelated installed packs.

Targets: `manifest-schema.ts`, `build/validate.ts`, codegen export checks, CLI validate/build and installer
diagnostics. Use current-schema errors; do not retain obsolete-key inventories or migration hints.

Evidence: invalid semver/ranges fail at the manifest path; missing dependencies produce an incomplete
result; text and machine output report the same underlying issue; install refuses an invalid build
without partially changing the installed pack.

## 3. Declare consumed APIs

The manifest describes provided services, but consumed host and dependency APIs remain implicit.
`permissions` is presently displayed metadata; it does not govern service access. Resolve that mismatch
before presenting it as a permission guarantee.

Inventory actual consumption first. Define required host APIs and dependency-provided APIs, then generate
owner-bound handles exposing the intended surface. Runtime binding and generated types must agree;
ambient SDK imports must not silently bypass an authoring contract. Reuse the existing generated services
facade and module checks. Start with the APIs actually consumed by default-setup.

Follow the [consumed-API plan](declared-capabilities.md), beginning with its inventory and granularity decision. EARS/repositories and direct Node access are separate surfaces; withholding a
service object does not contain an in-process JavaScript pack. Call the feature an API dependency contract
unless there is an enforcement boundary supporting a stronger claim.

The stronger permission/security boundary is a separate
[pack security isolation goal](../../goals/goal-pack-security-isolation.md). It covers both backend and
frontend ambient access and requires a design/prototype before choosing an isolation mechanism.
This workstream establishes API dependency contracts; it does not implement that sandbox.

Evidence: an undeclared API is unavailable through normal generated access, required unavailable APIs
produce an actionable failure, and tests can provide only the declared dependencies. An explicit shared
API remains usable by dependent packs. Document the actual trust model.

Optional dependencies should wait for a concrete integration that can operate without its provider.
When needed, distinguish absent optional integration from a broken required dependency and load only
the associated contributions; do not scatter provider-presence checks through feature code.

## 4. Preserve dependency provenance and reproducibility

Resolution currently considers workspace, linked checkout, installed app, cache and network sources.
Ranges and downloaded build integrity are already checked. The pre-provenance audit found that cache
entries lost their source, so the same cached version cannot explain where it came from.

Record exact version, source and content identity with the existing cached dependency build. Show that
information through existing inspection/doctor tooling. Distinguish declared range from resolved version,
and source location from identity; a local directory can change without moving.

When distribution requires repeatable resolution, add a frozen mode that uses recorded identities and
refuses a changed/unavailable dependency instead of selecting another machine-local candidate. Design its
lock metadata around the existing resolution pipeline, after provenance is reliable. Do not add a package
manager, registry, or redundant checksum system as part of this step.

Evidence: a cache hit retains origin; two resolutions expose why their builds differ; development
can intentionally use a linked build; frozen resolution cannot silently substitute that build for the
recorded build.

### Cache implementation contract (audit, 2026-10-14)

The identity checkpoint `439883713` closes requested-ID and release-version substitution. It does
not close receipt verification or provenance. Current `cacheDep` writes the snapshot directly into
the final directory, copies only selected executable files, drops the producer receipt, and discards
origin on reuse. `withBuildAndRuntime` admits executable paths by stamp and existence alone; the
testing harness independently reads that incomplete cache. Migrate both readers together.

Use the existing verified pack layout and content identity; do not invent another executable checksum
inventory. Each dependency cache contains immutable builds under
`.apack/deps/<id>/builds/<content-revision>/` and one `resolution.json` selecting a build.
The record stores the declared dependency spec, exact pack/version, content revision, output kind
and structured origin. Origins name the actual local root and selection route (workspace, explicit
file, selected host or installed app), or GitHub repository, release tag and selected archive/checksum
assets. A cached hit preserves this record; the cache is a delivery location, not the origin.

A complete executable build retains the producer manifest, snapshot, receipt and all recorded
files, including frontend/assets. Verify it before copying, verify copied bytes against the captured
receipt, and verify again on cache admission. Receipt/version/ID and snapshot declarations must agree.
Never seal copied bytes to manufacture trust in changed output. Current type data lacking a supported
executable build remains inspectable: store only its validated snapshot at `types/snapshot.json`,
record a snapshot-byte identity, and expose no executable paths. This is one current data contract,
not old-format conversion or a second grammar. A present malformed receipt is an error, not a reason
to downgrade a broken executable build into type-only data.

Stage on the cache filesystem and publish a complete immutable build before atomically replacing
the resolution record. Coordinate competing publication through the existing exclusive-lock mechanism;
readers capture one record and its immutable build directory. Existing resolved paths survive a later
resolution because publication does not overwrite or delete their build. Failed copying, verification
or record publication leaves the prior record/build usable. Do not claim a two-directory rename
protects long-lived returned paths. Automatic eviction/garbage collection is outside this checkpoint.

One shared host cache reader owns record validation, safe paths, pack/version/revision agreement and
receipt admission. CLI/codegen/build, offline inspection and the testing harness consume it rather
than independently merging snapshots and executable paths. Replace the former cache layout outright:
no dual reads, converters, aliases or special obsolete-layout detection. Missing current cache data
gets ordinary fetch/build guidance. Linked source development remains authoritative and explicit;
resolve a coherent build into an immutable cached build before executing it.

Execution checkpoints:

1. Implement the shared cache contract, producer-copy verification and coherent publication; migrate
   CLI, harness, fixtures and public documentation in the same source checkpoint.
2. Expose retained structured provenance through current inspection/doctor output. Exercise cache reuse,
   identical version with different bytes/origins, linked source edits and read-only discovery.
3. Complete dependency/build-tool import-graph identity and deliberate generation-skip checks. Audit
   build-output identity too: source restoration after an out-of-band build must not leave altered
   renderer output hidden behind a previously successful source-input key.

Acceptance includes poisoned executable entries never imported during discovery, tampered/missing/extra
files refused before execution, failed/raced publication preserving the incumbent, concurrent readers
seeing one coherent resolution, and a real external authoring/build/harness path. Guard mutations must
prove receipt, identity and publication assertions; focused and strict checkpoint evidence belongs in
the active goal. All remaining discovery kinds and Phase 6 workstreams remain required.

## 5. Make lifecycle and failure behavior explicit

Registration, replacement, disable, reload and uninstall checks belong to each discovery migration,
not a later hardening pass. Audit them for each contribution kind. Identify its
owner, collision/replacement policy, cleanup and observable notifications. Preserve intentional merging
of facets; exclusive ownership and multi-owner folding are different contracts.

Use the existing undo log and stores. Add shared implementation only when multiple contribution kinds
actually need the same behavior. Test that a failed registration does not remove another owner's data,
that replacement drops stale contributions, and that disposal removes listeners/resources.

Add frontend error boundaries around pack panes and forms with the pack named in the failure, a useful
recovery path and error reporting. The shell should remain usable when a contributed component throws.
Follow the frontend workstream of [pack fault isolation](../../plans/pack-fault-isolation.md), checking what already landed.

Lazy activation is deferred, outside the active sequence: attribute boot cost before changing when
packs run. Derive activation from existing contributions where possible instead of making authors repeat
command/view declarations in an activation list. Preserve migration/content ordering and event delivery.
If resumed, use the [deferred lazy activation plan](../../plans/deferred/lazy-activation.md) for the measured design.

Out-of-process backend packs are deferred. Synchronous EARS access makes this a data-contract redesign,
not simply a process-spawning task.

## Contract maintenance alongside every step

Make schema descriptions, public docs, templates and actual runtime behavior agree. Recent corrections
and their remaining acceptance illustrate the boundary:

- `builtIn` has been removed. App-source provenance and explicit update ownership replace the inert
  author-declared shipping privilege; pack authors cannot assert trusted origin.
- Reference metadata is now inline and validated for every pack. Its generated frontend aggregate
  remains pack-local; finish app-wide external binding/consumer integration before claiming full support.

Regenerate schemas/API reports when the public surface changes. Apply the repository's snapshot-format
rule when a reader would misinterpret a changed contract; do not bump package release versions. Update
existing plans if new evidence invalidates their assumptions, rather than leaving contradictory roadmaps.

## Research informing the direction

- [VS Code extension manifests](https://code.visualstudio.com/api/references/extension-manifest) distinguish
  contribution metadata, executable entry points, compatibility and dependencies. Adopt those meanings,
  not every marketplace field.
- [VS Code activation events](https://code.visualstudio.com/api/references/activation-events) document
  activation inferred from contributed commands/views. This supports deriving repeated facts.
- [JetBrains surface dependencies](https://plugins.jetbrains.com/docs/intellij/plugin-configuration-file.html#depends)
  distinguish required providers from conditional integrations. Add that distinction when apack needs it.
- The Chrome permission comparison and stronger enforcement target are extracted into the
  [pack security isolation goal](../../goals/goal-pack-security-isolation.md).

## Validation and scope

For each implemented item, use focused specs at the affected boundary, extend the external-pack fixture
when authoring behavior changes, regenerate changed contracts, and run `npm run chain`. Add targeted app
checks for lifecycle/error presentation. Check complete behavior, not just schema acceptance.

Keep marketplace categories, optional integrations, a new activation language and process isolation out
of the immediate work unless their named product or measurement trigger exists. Start with the shared
foundation and settings checkpoints; use the handoffs above to scope subsequent changes.


## Consolidation handoff (2026-10-14)

Authored consolidation M1–M6 is complete through `0994ae787`, including canonical writing, shared
semantic validation, full field help, real editor assistance and current public build documentation.
The [consolidation audit](manifest-consolidation.md#current-consolidation-acceptance-audit-2026-10-14)
accounts for all original decisions and both naming questions, separating implemented replacements
from required remaining discovery work. The execution goal records source commits and strict evidence.

Next is full discovery: remaining contribution kinds/native declarations/freshness, the selected
direct editor/app contributions, facade naming/capability checks, static content edges and meaningful CLI inventory.
Then navigation and frontend boundaries, followed by API consumption, dependency provenance and shipped
replacement as separate required workstreams. Lazy activation/security isolation/storage remain deferred.
Nothing is archived and final committed-source strict `--all` remains due.


### Dependency cache implementation checkpoint (2026-10-14)

Source `ff4358588` implements the shared verified-build cache contract above and migrates CLI, harness,
fixtures and public documentation together. The execution goal records receipt/origin/publication/
captured-byte mutations and strict evidence. “Artifact” is reserved for app contributions; pack bytes
and their accepted revisions use build terminology throughout the current contract.

Execution checkpoint 1 is implemented. Checkpoint 2's inspection/doctor presentation and checkpoint 3's
complete dependency/tool/output freshness remain due. Do not mark provenance or the broader roadmap
complete from storage/admission evidence alone.


### Inspection checkpoint execution (2026-10-14)

The next audit found `pack info` reporting source `.ts` counts as content items and `dist/` presence
as build success. Correct those claims while presenting provenance; inspection must not activate packs,
create caches or fetch network data.

- Resolve dependency data once for each validation frame. Preserve each declared spec and report exact
  version, structured origin, delivery directory, content revision and executable availability. Keep
  missing data distinct from invalid data and from inspectable types with unavailable execution.
- Reuse the resolved snapshots for codegen validation and the same metadata for `pack doctor` text/JSON.
  `pack info --json` presents the same inspection data as text; source-only declarations and unavailable
  builds remain explicit. Do not manufacture a successful build from directory presence.
- Read compiled content IDs/descriptions/counts from the verified content index, using one current
  index validator shared with existing preview/import/harness readers. Source filenames are not items.
  Keep preview/import provider requirements intact; discovery reads data independently of those providers.
- Prove offline installed/source inspection with poisoned executable modules, cache reuse retaining
  origin, read-only filesystem/network behavior, malformed/missing builds and honest unbuilt content.
  Update CLI help/public docs and affected SDK reports together; no old-format fallback or version bump.

This closes the inspection portion of provenance and improves the current compiled-content inventory.
It does not claim complete contribution discovery or static flow/action dependency edges; those and the
remaining tool/dependency/output freshness checkpoint retain their existing acceptance criteria.


### Inspection implementation outcome (2026-10-14)

`d6fa2c6dc` implements the inspection checkpoint above: one read-only dependency frame, retained
provenance in text/JSON, honest verified/unbuilt/invalid/stale build metadata and receipt-checked
compiled content identities/counts. The current index validator is shared across writer and readers,
with fixtures migrated outright. The execution goal owns focused/mutation/external/strict evidence.

Cache execution checkpoints 1 and 2 are implemented. Checkpoint 3 (complete dependency/tool/output
freshness) remains required, as do the rest of the discovery inventory and broader roadmap.


### Freshness implementation audit and execution (2026-10-14)

Current code confirms the recorded renderer defect: `unitStaleReason` compares an input fingerprint
and output-path existence only. `stampedRunAll` captures inputs before running and records no output
bytes. Restoring source after an out-of-band build therefore leaves a matching success stamp over
different output. Atomic multi-output publication has the same gap after interruption between swaps.

Implement shared output evidence first. Record the complete output file set/digests after successful
work, separately from the pre-run input fingerprint. Source filtering (prose, dotfiles, installed
modules, compiled-config exclusions) must not silently remove produced files. The tree reader must
name input/output walks distinctly and the shared sweep must forget both after a declared write.
A missing/malformed current success record is cold; add no stamp-version adapter or legacy reader.
Do not change authored pack/layout format stamps or release metadata. Failures during output capture
or record publication drop success records; retained atomic stamps are valid only while their bytes
still match.

Acceptance: changed/missing/extra outputs, source restoration after a different manual build, partial
atomic output replacement, output additions under hidden/shipped directories, and shared-sweep
forgetting all become stale; unchanged bytes reuse correctly. Exercise the real chain/drive freshness
consumer in addition to temporary build units. Check cost on the actual graph without weakening
byte evidence. This fixes output identity, not imported implementation coverage.

Then close implementation/import scope: `generate-entries.ts` hashes its own module and SDK tree,
while phase-cache `bundlerSource` hashes one bundler file or falls back to CLI version. Imported CLI/
host helpers are missing in workspace mode and the published phase key can miss changed bundle bytes.
Use current source/tool roots and packaged code bytes, including their shared implementation closure;
do not infer contribution existence from imports or use diagnostic build-read logs as cache keys.
Keep dependent executable content identity, helper chunks, deliberately skipped generation and staged
phase reuse in the audit. The current build already verifies previous sealed output before phase reuse;
preserve that guard rather than inventing a second receipt grammar.

Commit validated output and tool/dependency checkpoints separately, with mutation checks, actual
external authoring and strict evidence in the goal. Remaining contribution discovery, native metadata,
static content edges, navigation/boundaries/API consumption/replacement and final strict `--all` retain
their full existing scope.


### Output evidence outcome (2026-10-14)

`a667b161a` implements the shared successful-output evidence checkpoint above. Complete output file
membership/bytes are checked independently of pre-run input identity, including after partial atomic
replacement. The actual runtime build stamp rejects compiled renderer drift and accepts exact
restoration. Focused guards, full strict and a 1.0s unchanged warm strict run are recorded in the goal.

Tool implementation/import identity, dependency executable/helper keys, deliberate skips and launch
freshness remain required. The drive preflight still uses a separate mtime nudge because manually
invoked runtime builds do not currently write the chain’s success record; do not silently conflate its
purpose or claim it solved from the chain probe. Preserve the full remaining roadmap.

### Tool implementation identity checkpoint design (2026-10-14)

Generation and cached FE/types/DSL phases now share one complete implementation scope. Workspace
identity covers the CLI's source/bin/package metadata and host/SDK/EARS source/package metadata;
published identity covers every CLI chunk/bin/package metadata plus the installed SDK declarations
that generation still reads. Resolve SDK/EARS ownership through their exported package.json, avoiding nested published metadata
inside workspace dist. Resolve the host through an existing source export; it does not export package.json.
Published SDK data may live in a workspace dist directory or directly at an installed package root;
hash the resolved compiled package scope, without requiring authored source in an installed package. Hash paths relative to their owning package and bytes, not checkout locations,
mtimes or version-only guesses. Missing/empty implementation trees refuse. No memoization hides
mid-build changes. Keep phase options, existing bundler versions, authored inputs, generated entries,
staged DSL definitions and dependent snapshot keys in addition to this shared identity.

Acceptance includes source/helper changes, same-version published chunk changes/additions/removals,
installed SDK declaration changes, unchanged-path/mtime reuse, missing evidence and every cached phase
consuming the shared key. Exercise the real published bin/project handoff and --skip-generate refusal,
then normal regeneration. Separate tool-scope, phase-consumption and generation-consumption mutations
must fail their corresponding regressions. Do not claim this closes external package/dependency
executable/type-import identity, deliberate skips or manual-build launch freshness; those remain the
next required audit/checkpoint, followed by the full existing contribution-discovery roadmap.

### Tool implementation identity outcome (2026-10-14)

`8fab41528` implements the shared owned-implementation key above. It also corrects nested workspace
SDK output ownership and supports the current installed SDK package-root layout. Focused, mutation,
actual watcher/published-bin and required strict evidence are recorded in the owning goal; committed
unchanged strict reuse remains 1.1s. This closes one-module/version-only implementation coverage,
not every external compiler/type/dependency input. The next checkpoint audits those actual resolution
paths, verified executable/helper/content identity, deliberate skips and publication, then the separate
manual-build/drive launch contract. All remaining discovery and downstream goal scope stays required.

### Verified dependency frame audit and checkpoint (2026-10-14)

Current resolution already captures each dependency's validated snapshot, kind, complete build revision
and retained directory. Generation and facade caching reduce that to snapshot maps; frontend/DSL
keys omit the dependency frame. Build publication rechecks authored files and generated bytes but not
the accepted dependency bytes after executable content compilers run. Thus helper changes with
identical snapshots are invisible to those keys, and a changed dependency can be published against
its earlier accepted declarations.

Retain files with the existing type/snapshot projection in one resolved frame. Pass that frame through
generation, deliberate skips and facade reporting; keep the verified file map in every cached phase.
Hash id/kind/full revision/snapshot independently of delivery paths. Re-read the captured directories
through the common data-only verifier before reuse and publication, comparing their accepted identity
and declarations; a newer resolution may coexist without invalidating still-valid pinned bytes.
Recheck generation after its async compiler completes, before deleting/writing generated files.
Migrate all internal callers/fixtures outright, without aliases or snapshot-only alternate paths.

Acceptance: identical-snapshot same-version helper changes invalidate generation and every cached
phase; corrupt/missing/extra files refuse; selecting a newer cache resolution retains an earlier
accepted frame; data reads activate no code. Prove a real content compiler changing dependency bytes
refuses consumer publication and retains the previous complete build, including --skip-generate.
Guard-removal mutations and strict validation are required. This closes pack build-frame freshness;
external npm compiler/type import coverage and manual-build/drive launch freshness remain required
before the broader freshness checkpoint is certified, alongside all existing discovery/downstream work.

### Verified dependency frame outcome and next audit (2026-10-14)

`ce503269b` implements the checkpoint above. The execution goal records focused, four guard mutations,
actual compiler/publication and all-gate strict evidence; unchanged committed-source strict remains
1.0s. Pack build revisions now survive the type/snapshot projection, all cached phases consume them,
and pinned dependency bytes are verified through publication.

Remaining freshness is concrete, not an optional deferral: generation's resolved TypeScript/schema
compiler/validator implementations and consumer npm type/bundle imports are outside the owned source
key; the phase tool list omits rollup-plugin-dts. Actual resolution evidence is
`/private/tmp/apack-external-tool-resolution-audit.log`. Package-local overrides and blocked package.json
exports require resolution against the correct owner/entry, without importing code. Cover normalized
resolved byte scopes/transitive helpers/conditional exports and revalidation, then complete the
frozen-input/publication audit and manual-build/drive launch contract. Retain the complete existing
discovery and downstream execution goal, including every Phase 6 workstream and final strict --all.

### Installed package scope checkpoint design (2026-10-14)

Read npm ownership/resolution as data from each compilation owner: the executing CLI and the authored
pack. Walk declared dependencies/peers/optional dependencies, plus the pack's development dependencies;
resolve from each package owner so package-local overrides remain distinct. Metadata exports may block
package.json: lookup ownership through Node's package search paths, without importing an entry.
Record absent dependencies explicitly, retain graph edges and sharing, and hash relative filenames and
bytes. Installed packages include shipped declarations, scripts, data, styles and native binaries.
Workspace packages use declared source export roots and published file roots, including globbed data
roots; scratch/dependency/git trees are separate. Pre-register compilation roots so dependency cycles
cannot hash the consumer's own output as an input. No previous-read log or version-only fallback.

Capture one compilation scope combining owned implementation bytes, npm graph bytes and Node/platform/
loader-condition context. Share its immutable key across generation and cached phases; re-read the
scope at generated-file and build publication boundaries. Do not cache it across commands/builds.
Initial measurement was 2.3s for CLI scope and 5.0s for default-setup scope; this cost must be paid per
boundary, not per cached phase. Focused generation tests may inject a stable external scope; dedicated
package/scope tests and actual imported-type integration must exercise real byte scanning.

Acceptance: blocked metadata exports, local overrides, transitive helpers, optional availability,
conditional exports/context, cycles, root-output exclusion, workspace published/source/data roots,
relative path/mtime independence and same-version byte edits. Real TypeScript declaration edits must
reject old generated files and regenerate changed event metadata without activating the provider.
Guard-removal mutations and required strict validation precede source commit. Remaining frozen-input/
module-load coherence, consumer configuration/import paths outside declared package scopes and the
manual-build/drive contract still require audit; do not certify all freshness or the full goal here.

### Declared installed-package scope outcome (2026-10-14)

`169f8ec8a` implements data-only declared package graph/byte coverage and shared captured compilation
keys above. The goal records local-override/byte/publication mutations, real changed-type metadata and
async refusal, launch-context corrections and required strict/app evidence. Instrumentation is not a
compiler selector; development export conditions remain meaningful. Committed-source unchanged chain
reuse is 1.0s, but changed builds are slower: the accepted default pack build is 46.7s.

Do not certify complete compiler closure yet. Next inspect inherited configuration and path mapping,
imports outside declared roots, and already-loaded implementation versus captured disk bytes. Set a
coherent frozen execution/publication scope and refine repeated byte-scan cost without weakening the
proof. Current default-setup's tsconfig has local generated/feature/extension mappings and no shared
parent config; inspect external authoring contracts rather than assuming a nonexistent repo base
config. Then settle manual runtime build/drive freshness. All remaining contribution discovery and
downstream Phases 0–7, including every Phase 6 workstream and final strict --all, retain their scope.

### Compiler configuration audit and checkpoint design (2026-10-14)

The installed-package key does not capture inherited tsconfig files outside the authored pack.
Current DSL compilation and facade checking also turn some malformed/missing-parent configurations
into empty/partial options; pack resolution already reports those errors. Resolve inheritance using
TypeScript's current parser, collect the actual configuration bytes during that traversal (not a
previous build-read log), and key normalized pack-relative filenames/bytes. Relative/package/array
inheritance, JSON comments and current resolution metadata must be covered without importing code.

Share one CLI reader across configuration keys, DSL option selection, facade checking and source-
resolution rules. Preserve existing absent-config defaults at each caller. Malformed/circular/missing
inheritance and invalid options are explicit failures; only no-source-input diagnostics may be ignored
for entry-driven inspection. The SDK's separate compiler-version-bound module reader must reject the
same nonfatal configuration errors instead of validating exports with partial options; do not expose
TypeScript internals as new pack API merely to share that private reader across package boundaries.

Prove same authored config and package versions with changed external parent mappings produce stale
generation and changed registration event metadata, and that malformed parents retain generated files.
Focused reader/SDK and actual external-generation paths, guard-removal mutations and strict validation
precede commit. This closes configuration-file coverage and refusal semantics, not imported file bytes
at external path targets or immutable already-loaded implementation. Those and scope cost/frozen
execution remain required, followed by manual-build/drive and every discovery/downstream goal phase.

### Compiler configuration outcome (2026-10-14)

`8261e98c8` implements inherited configuration byte coverage and explicit CLI/SDK refusal above.
Generation/cached keys now follow parent files outside the authored pack; valid absent/empty
entry-driven cases retain their established semantics. The goal records reader/SDK, actual parent
mapping, DSL/facade, four guard mutations and required strict evidence. Real-build publication tests
move unchanged into integration after the unit budget exposed incorrect placement; no budgets or
assertions are relaxed. Committed-source unchanged strict reuse is 1.1s.

Next: external path/import file closure and undeclared resolution, already-loaded code/disk identity
and complete frozen execution/publication, with measured scope cost. Configuration discovery alone
does not prove those inputs covered. Then manual runtime build/drive freshness and all remaining
discovery/native/static-content/navigation/frontend/API/provenance/replacement requirements. The
full goal, every Phase 6 workstream and final committed-source strict --all remain active.

### External TypeScript input outcome (2026-10-14)

`f8c17e99c` follows fresh resolved TypeScript source/metadata beyond declared package roots, with
external/transitive/ambient/undeclared resolution regressions and generated-output exclusion. The
owning goal records actual generation before/after evidence, focused/mutation checks, scope timings
and strict validation on committed source. This advances external type-input coverage; it does not
certify runtime, Vue/dynamic imports, distinct compiler readers or external watch coverage.

Next finish that execution/reader audit and loaded-code versus disk identity, coherent frozen
publication and measured scope cost, then manual-build/drive freshness. Preserve all remaining
discovery/native/static-content work, navigation, frontend boundaries and all Phase 6 workstreams.
Final committed-source strict --all and full completion audit remain required.

### Fresh watcher and reconnect outcome (2026-10-14)

`01eec3309` gives each watched build fresh executable module caches; an actual ordinary-flow-import
regression and its in-process mutation prove the need. `82bca6529` removes a restore-to-selection
echo that wrote preferences during Code reconnect. The real app now passes the unchanged refused-
write revision assertion. The execution goal owns source, focused/mutation, strict and committed-source
evidence. Publication scenarios are split by concern with unchanged budgets and assertions.

Continue external watch/input and compiler-consumer coverage, immutable/coherent execution and
publication, scope costs and manual-build/drive freshness. All remaining discovery, native/static
content, navigation, frontend boundaries and Phase 6 workstreams retain their acceptance requirements.

### External compiler watch and declaration consumption outcome (2026-10-14)

`ba3d8df85` fixes facade consumption of authored aliases/baseUrl modules without flattening genuine
package or Node imports. `b956785fe` watches fresh compiler configuration/resolution paths, including
missing targets and physical aliases, preserves repair subscriptions on failure and shares bounded
watch scopes. Configuration/source byte identity now has one compiler projection rather than two
separate hash passes. The owning goal records actual authoring/recovery, mutation, cost and strict
evidence; EARS/content parity is unchanged.

Next complete exact compiler consumers and runtime/Vue/dynamic/dependency inputs, coherent frozen
execution/publication and scope cost, then manual-build/drive freshness. Every unfinished discovery,
native/static-content, navigation, frontend boundary and Phase 6 requirement remains in the goal.

### Compiler-discovered runtime package outcome (2026-10-14)

`61d882b7d` adds compiler-discovered npm owners to the existing dependency byte graph and watcher.
Real builds previously reused stale frontend JavaScript behind unchanged declarations; both explicit
build and automatic-watch regressions now update it. The goal records ownership, refusal/repair,
performance correction and full/committed-source strict evidence. Generated EARS/content are unchanged.

This completes that specific undeclared-package byte gap. Vue/script/style/asset and dynamic inputs,
exact compiler consumers, coherent frozen execution/publication, measured cost and manual-build/drive
freshness remain required. All unfinished discovery/native/static-content, navigation, frontend
boundaries, Phase 6 API consumption/provenance/replacement and final audit requirements remain active.

### Vue script input outcome (2026-10-15)

`94ab5f834` fixes stale frontend reuse for Vue-only imports, covering inline/external scripts and linked
nested components through the common compiler projection. It preserves pack-local manifest entries,
generated-output exclusion, checkout-independent identities and activation-free input reading. The
goal records actual before/after builds and watching, compiler-suite correction, cost, strict failures
and accepted strict verification on committed source; EARS/content parity is unchanged.

Continue style/template/asset and dynamic/runtime input closure, exact compiler consumers, coherent
frozen execution/publication, scope cost and manual-build/drive freshness. All remaining discovery,
native/static-content, navigation, frontend boundaries, Phase 6 API consumption/provenance/replacement
and final completion audit remain active. This completes script traversal only.

### Frontend compiler authority source checkpoint (2026-10-15)

`7c97e8553` replaces unsound frontend reuse with actual compilation and private current-compiler
resource/directory reports for ready watch subscriptions. Repair scopes, directory-link identities,
rename matching and package traversal are covered; the user's shared integration feedback cap is 60s.
The goal records real CLI behavior, mutation evidence, type checks and 98 passing committed-source
checks. Aggregate strict integration validation remains unresolved and is required before completion;
this source checkpoint is not phase acceptance. Continue the remaining input/frozen-execution and
manual-build/drive work, every remaining discovery/native/static-content requirement, navigation,
frontend boundaries and all three Phase 6 workstreams. Nothing is archived or excluded.

### Nested content-directory link checkpoint (2026-10-15)

`7ad1f0396` and `01aaa18ab` close reported content-directory link watching, including initially empty/dangling targets,
cycle bounds and authored-output exclusions without hiding authored-source retargeting. The goal records failing baselines, focused/type checks
and an actual Tailwind CLI rebuild. Glob/worker/dynamic closure, frozen execution, bulk strict validation
and all remaining discovery/navigation/frontend/Phase 6 work remain required; this is not phase completion.


### Declarative frontend step checkpoint (2026-10-15)

`cda9fa00e` completes discovery step checkpoint 2A: authored editor metadata and explicit bindings,
step type/custom-helper modules, checked installed frontend admission, migrated scaffolds/docs/reports,
and removal of component factories and directory inference. Strict validation passes, including the full
739-test integration suite, real external/source-free authoring/admission/unload and isolated app checks;
committed-source strict validation also passes. The owning goal records source, parity, mutations and runs.

Required next: native step declaration/admission and common catalog/window parity (2B), then live
palette/style/default/layout readers and cache removal (3). All other discovery/static-content, frozen
execution/freshness, navigation, boundaries and Phase 6 requirements remain active. This checkpoint does
not complete discovery or replace the final committed-source strict `--all` requirement.


### Native step/catalog foundation checkpoint (2026-10-15)

`fdd967ec5` completes discovery checkpoint 2B.1: shared native step grammar, native/disabled-installed/
unbuilt-source catalog/window projection, active wire ownership, captured metadata and backend/native
step slot checks. Reproduced JSON-key loss and pre-validation class normalization are fixed without
changing declared types or output identities. Strict and committed-source strict checks pass; the owning
goal records the source, eight mutations, preserved EARS/content/facade output and real app/authoring runs.

Complete native frontend grammar and mandatory admission authority (2B.2), then live step readers/cache
removal (3). The existing unknown-native-owner frontend bypass is required unfinished work, not a waiver.
Every other discovery/freshness/compiler-scope, navigation, boundary and Phase 6 requirement remains active;
final committed-source strict `--all` and the completion audit are still required.


### Shared native declaration grammar checkpoint (2026-10-15)

`92b2804ae` supplies discovery 2B.2's browser-safe authored/native grammar foundation, native artifact/
block/DSL/designation data and shared JSON-purity checker. Runtime native comparison uses those fields;
public reports and source links are updated. Focused/mutation checks and strict validation pass, including
real authoring/app checks; generated EARS/content/facade identity is preserved. The owning goal records
source and evidence. Mandatory frontend admission authority, complete capture/cleanup, fixture/shell
migration and binding owner/revision data remain required before live readers. All remaining phases and
final committed-source strict `--all` stay in scope.


### Mandatory frontend admission and preservation audit (2026-10-15)

`e5dcdec63` completes discovery 2B.2: checked native/loaded authority for every frontend write, owned
metadata and accepted backend identities, transactional capture/cleanup, and source-delivery input
pinning. Public frontend testing stays separate from backend tooling. Ten mutations and strict validation
pass, including external/app/authoring checks; the goal records source and evidence.

A read-only audit independently proves keyed `__proto__` entity declarations disappearing during schema
decoding. Correct that required M1 preservation gap in manifest consolidation before checkpoint 3 migrates
live readers. The prior opaque-default correction is insufficient for keyed declarations. The complete
remaining discovery, compiler/freshness, navigation, boundary and Phase 6 scope remains required; this is
not goal completion or final committed-source strict `--all` validation.
