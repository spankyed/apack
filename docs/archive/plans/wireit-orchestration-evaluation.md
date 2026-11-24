# Evaluate Wireit for validation orchestration

Status: preliminary assessment; no adoption or installation approved.
Date: 2026-10-19.

## Purpose and position

Assess Wireit as the smaller alternative to Nx for replacing generic validation infrastructure.
The [fast-validation plan](validation-feedback-budget.md) owns workflow, runtime and coverage goals;
the [Nx evaluation](nx-orchestration-evaluation.md) provides the replacement ledger and protected
apack guarantees. This assessment does not change the current goal's acceptance requirements.

Wireit is a credible fit for incremental npm-script execution. It is not currently the leading
candidate for the full planned workflow: branch-affected selection on cold result caches and explicit
exhaustive execution appear to need additional machinery. Nx remains the first implementation
candidate. Use Wireit as a simplicity benchmark, not a reason to run simultaneous migrations.

The findings below come from upstream documentation, schema, CLI, fingerprint and execution source
inspection. No installation or compatibility pilot was performed. Some inspected files are from
upstream `main`; confirm behavior against an exact released version before any implementation.

## What Wireit could replace

Wireit retains `npm run` entry points and adds declared script dependencies, parallel execution,
freshness checks, caching and watch mode. Cross-package dependencies use explicit script references.

It could plausibly replace generic dependency dispatch, ordinary task fingerprints/verdict stamps
and some producer/consumer or watch-script coordination. Do not count compiler installation capture,
pack freshness records, native admission or sealed publication as removable code.

| Requirement | Initial assessment |
|---|---|
| Keep existing npm commands | Good fit |
| Order shared producers and consumers | Good fit |
| Reuse deterministic ordinary results | Good fit, subject to complete inputs |
| Select branch-affected targets with cold results | Gap: no built-in comparison-base selection found |
| Weighted CPU reservations and writer conflicts | Gap: script-count concurrency and per-script locking are not equivalent |
| Preserve incumbent pack output | Outer cleaning/cache restoration must not bypass apack publication |
| Native and external-workspace freshness | Retain existing apack checks |
| Force exhaustive execution | Needs a supported, demonstrated bypass of freshness as well as cache restoration |

## Findings and boundaries

### Selection and cold-result behavior

The inspected CLI/configuration describes requested script graphs and incremental fingerprints, not
an affected-target calculation against a Git comparison base. Without current fingerprints, asking
for the full graph would still execute unrelated work.

Meeting our cold-result target would therefore require a retained affected selector, explicitly
narrower entry points, or a deliberate change to the planned guarantee. Count this remaining
implementation when comparing maintenance cost; do not claim ordinary warm caching solves selection.

### Resource use and cross-invocation coordination

Wireit limits concurrent scripts; the documented default is twice the logical CPU count. Nested
Vitest/compiler demand still needs explicit control. This is not a replacement for weighted CPU
reservations merely because both systems have a parallelism setting.

The inspected execution source locks by script identity and skips that lock for `output: []`.
Two different scripts writing overlapping paths are not made safe by same-script serialization.
Preserve checkout and shared-output protection unless an equivalent simple execution policy is proved.

### Cleaning and incumbent output

Declared output is cleaned before ordinary execution by default. The inspected source also cleans
output before restoring a cached result, even when ordinary execution uses `clean: false`.

apack retains the accepted pack while preparing a replacement. Wireit must not independently delete
or restore that live output tree in a way that bypasses publication ownership, integrity or incumbent
retention. Start with outer caching disabled at this boundary; verify behavior rather than assuming
a cleaning option preserves our contract. Test any destructive behavior only against private fixtures.

### Fingerprints versus compiler observations

Wireit fingerprints include configured files/environment, command/arguments, dependency fingerprints,
platform, architecture and Node version. These are useful ordinary task inputs.

The inspected file hashing omits empty directories and follows input symlinks for content. It does
not replace missing-candidate, directory-membership, link-sensitive or runtime-native observations.
Retain the compiler input record and freshness checks. Conservative outer caching must not prevent
those checks from running when external state changes.

### Exhaustive execution and diagnostic results

The inspected source checks prior fingerprint/output freshness before attempting cache restoration.
Consequently, `WIREIT_CACHE=none` must not be treated as proof that all tasks execute. No dedicated
force-execution option was found in the inspected CLI.

Require a supported, tested way to execute every required validation target and bypass retained inner
test-verdict caches. State deletion or duplicate always-run scripts would be additional machinery,
not free adoption benefits. Also establish that diagnostic passes cannot satisfy normal acceptance.

### External authoring handoff

Declared output paths are package-contained; output symlinks are cached as links. Restoring our
repository handoff references does not recreate their external temporary work tree or archive.

Keep checkout-owned temporary directories, readiness/archive validity and exact archive/app checks.
Either leave the workflow uncached externally or demonstrate the integration, including loss of
external output while repository metadata survives. Do not replace handoff validation with a generic
task-cache hit.

### Dependency propagation

Default dependency cascading can rerun a consumer when a dependency's fingerprint changes even if
relevant produced bytes do not. Wireit supports disabling that cascade while declaring the consumed
output as an input. Evaluate this against our unchanged-byte reuse behavior. Disabling propagation
without complete consumer inputs would narrow coverage unsafely.

## Bounded follow-up, if justified

Schedule any implementation evaluation after the current goal. First confirm the documented gaps
against a pinned release. Proceed only if Wireit could remove enough generic machinery or an Nx
pilot identifies a reason to prefer the smaller tool. Do not create a parallel orchestration project.

1. Model one ordinary check and one private producer/consumer pair using existing commands.
2. Compare cold and warm execution, changed inputs, missing output and unchanged produced bytes.
3. Establish affected selection, exhaustive-force and diagnostic-result policy explicitly. Count all
   adapters or retained infrastructure required to supply missing behavior.
4. Exercise cancellation, awaited cleanup, conflicting writers and nested resource demand using
   existing approved Windows/Unix resources. Preserve daily-use Mac native-execution restrictions.
5. Compare named deletions, retained code, configuration burden and measured runtime against the
   same replacement ledger used for Nx. Stop after answering the decision questions.

Do not weaken dependency checks, native guarantees or cleanup assertions to make adoption fit.
Toolchain upgrades, cloud services, new VM provisioning and broad repeated suites are not implied.

## Decision criteria

Wireit remains viable if it replaces substantial incremental execution machinery while required
selection, resource and exhaustive-execution behavior stays small and understandable. A narrower
workflow guarantee requires an explicit decision; it cannot be silently substituted for the
fast-validation plan's affected-change contract.

Reject it as the full replacement if meeting that contract retains most of our custom selector,
scheduler and verdict infrastructure or requires intrusive state-clearing workarounds. Preserve
useful evaluation evidence in a commit or stash; do not leave a permanent second orchestrator.

The current recommendation is **Nx first, Wireit as the minimum-complexity comparison**. This is a
source-based assessment, not a measured adoption result or proof of the runtime target.

## Primary sources

- [Wireit documentation](https://github.com/google/wireit#readme): dependencies, concurrency, cleaning,
  paths, cascading and caching.
- [Configuration schema](https://github.com/google/wireit/blob/main/schema.json).
- [CLI options](https://github.com/google/wireit/blob/main/src/cli-options.ts).
- [Fingerprint implementation](https://github.com/google/wireit/blob/main/src/fingerprint.ts).
- [Execution, locking and output handling](https://github.com/google/wireit/blob/main/src/execution/standard.ts).

These upstream links move. Record the selected release/source revision and exact test evidence if a
pilot proceeds; documentation or source inspection alone does not establish compatibility with apack.
