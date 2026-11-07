# Pack UI components load on demand by default

The component-loading contract now makes plain module paths lazy. `{ "entry": "path", "load": "eager" }`
is the explicit static-import exception. The shipped manifest removes 31 redundant lazy declarations;
no eager exceptions were added without evidence. The old `load: "lazy"` spelling is refused.

The existing compiler component binder is reused for surfaces/routes, feature/group settings forms,
step node/form components, block renderers, artifact viewers, editor popups and app extensions.
Custom component icons follow the same default; bare icon names still name Lucide exports.
Normal component-internal imports, actor machines, predicates and editor extension objects retain
existing behavior. Shared dependencies imported through another eager path can still load eagerly.

The welcome extension rendered outside the existing contribution error boundary. Deferred import
failure would therefore reach the global error handler. Its registry lookup now returns an owned
component binding to the renderer, and the welcome slot uses the existing boundary with a current-binding
identity guard. The modal remains out of document flow. Existing SDK component-only lookups retain
their contracts; no new error/retry framework, module cache or runtime flag was introduced.

Retained data: [final comparison](component-loading-defaults-2026-11-07/comparison.json) and
[raw identities](component-loading-defaults-2026-11-07/sha256.json), plus the
[intermediate comparison](component-loading-defaults-2026-11-07/intermediate-comparison.json) and
[its raw identities](component-loading-defaults-2026-11-07/intermediate-sha256.json).
Full raw trials and diagnostics remain in the linked CI artifacts.

## Qualification

Baseline: previous PR #355 source `418a4ea68ee68741c6a7838a29b094066d1b0312`, which already used
explicit lazy declarations for inactive screens. Final candidate:
`147b5b8be3747828d39dc4114a71a0138e5e64d4`. This comparison evaluates the redesigned default,
not the earlier combined startup stack. The historical 546 ms combined-stack saving does not
establish this candidate's effect.

[Final comparison 42380041598](https://github.com/spankyed/apack/actions/runs/42380041598) passed,
artifact `startup-revision-comparison-42380041598` (13577953035).

| Recording-disabled populated startup | Previous explicit-lazy source | Lazy-default candidate |
| --- | ---: | ---: |
| Median | 4,810.22 ms | 4,908.06 ms |
| Range | 3,765.68–7,758.98 ms | 4,199.62–8,270.15 ms |
| Measured passing | 20/20 | 20/20 |
| Warmups passing | 5/5 | 5/5 |

The candidate's pooled median was 97.84 ms (2.03%) higher. Only three of ten observed balanced ABBA
blocks favored it when comparing each block's two-sample means. First-/second-half medians were
5,177/4,036 ms for baseline and 4,624/5,622 ms for candidate. Drift and variability are substantial.
This run does not establish a startup improvement, tight non-inferiority, tail bounds or cold-disk
behavior. It also does not identify a particular eager exception that would improve the initial view.

The earlier [intermediate comparison 42376534582](https://github.com/spankyed/apack/actions/runs/42376534582)
on source `bed1ee0ac7cf6a89eb534e60a57060118a343da7` passed all fifty launches with medians
3,130.41 → 2,965.80 ms (-164.61 ms / -5.26%), but only five of ten block means favored the candidate.
That source's strict run subsequently found an unintended widening of component-reference grammar,
which was corrected before the final comparison. Both intermediate and final scalar records and raw
identities are retained. Their different runners/sources prevent pooling samples or combining effects.
The combined evidence supports no reliable latency-saving claim for the redesigned default.

Independent admission of each comparison with `readPerformanceRevisionComparison(..., 20)` verified
raw hashes, observed order, lifecycle and matching native output, fixture, runtime, machine and cache
policy within that comparison. All four separate detailed diagnostic stores passed
`readPerformanceRun(..., 1)`; their instrumented single trials are excluded from the timing comparisons.
The unchanged completion boundary requires the correct fifty full restored-chat message bodies and
matching revision, with successful process teardown. All fifty scheduled launches passed in each run.

Each comparison owned a disposable macOS arm64 VM with private revision dependencies, builds and profiles:
three CPUs, 7 GiB RAM, Node 24.22.2 and Electron 44.9.3. Processes were fresh over a warm filesystem.
Both source trees were clean. App output hashes may differ and are retained. No result certifies the
developer's external drive.

## Correctness and validation

- Four SDK compiler/schema/editor files passed 76 focused cases with one worker. Existing cases cover
  plain-string lazy emission, explicit eager surface/settings bindings, actor/predicate static imports,
  source-free backend separation and named component exports. The reference case additionally passed
  its final 13-case file after checking both default-lazy and explicit-eager custom icons.
- All 34 settings-definition cases passed, including native metadata refusal for obsolete loading mode
  and undeclared form fields. The schema and runtime metadata validator accept the new component target.
- Twelve renderer cases passed, including deferred import rejection/retry in both a generic contribution
  boundary and the actual welcome slot over the real frontend registry. Registration alone does not
  call the welcome loader; a failed load preserves the app and Retry reaches the accepted component.
- Eleven frontend-admission cases passed; an existing capture case checks the component's owned binding.
  Host and SDK source typechecks and targeted correctness lint passed. No local app/native build ran.
- Public API reports were regenerated from built packages in
  [CI 42375669728](https://github.com/spankyed/apack/actions/runs/42375669728), artifact 13575528434.
  The generated patch changed only SDK build/framework reports; established CRLF was preserved.
  Its temporary generation workflow was never added to PR #355 and the completed temporary ref was removed.

[Final application/rest validation 42384463677](https://github.com/spankyed/apack/actions/runs/42384463677)
passed all eleven standard chain steps in 1,256.6 s on two cores, including API freshness, both unit
pools, runtime build, external-pack app, smoke and packaged authoring. The official final regeneration
changed only the order of `entry` and `load` in the SDK build API report; the exact generated result was
imported, preserving established line endings. Its artifact `component-loading-final-validation`
(13579129121) retains the generated patch and full chain logs. The temporary validation source
`b755876f35` differs from runtime source `147b5b8be3` only in the dispatch workflow; that workflow is
not part of PR #355. The implementation's producer/integration/native coverage is retained from the
full run below, with its one remaining watcher assertion fixed and qualified by the focused run.
No required gate remains unverified. This does not turn the earlier failed runs into passing runs.

The initial [strict run 42376535282](https://github.com/spankyed/apack/actions/runs/42376535282)
passed its producer, both integration shards and native 1. Application/rest found three module-reference
grammar/diagnostic failures: broadening default-export-only component fields had removed existing
module-path restrictions and their early conventional-export checks. The correction preserves those
restrictions while allowing the eager loading option; surface/step targets keep their existing named
export support. All 56 targeted parser/codegen/editor cases passed after correction.

Native 2 found that the generation watcher test searched the root frontend bundle for its component's
marker. With lazy loading the component lives in a referenced chunk. The test now parses the entry's
literal import using the existing TypeScript parser, requires exactly one view in this fixture, checks
that referenced asset against the verified receipt and asserts its generation marker. Live HMR,
incumbent preservation and process retirement checks are unchanged. The exact corrected case passed
in [focused CI 42380006988](https://github.com/spankyed/apack/actions/runs/42380006988), one test,
before final broad acceptance was dispatched. No deadlines, assertions or input coverage were weakened.

The corrected-source [strict run 42381129209](https://github.com/spankyed/apack/actions/runs/42381129209)
passed its producer, both integration shards and native 1. Its application/rest shard stopped before tests
because the schema correction changed generated SDK API member order. Its native 2 shard passed the
corrected generation test and 60 other cases, but found the same root-bundle assumption in the Vue
package-input watcher (one failed, 28 skipped). That assertion now follows the same verified referenced
view chunk; the TypeScript-state variant still checks the root entry. The chunk reader is shared by the
two fixture tests. Both TypeScript-state and Vue-canvas watcher cases passed in
[focused CI 42384557764](https://github.com/spankyed/apack/actions/runs/42384557764) on test-only
commit `368feeb19aa9a5d9bd1c68defd8357d7f799b64b` (63.5 s and 54.2 s respectively).
Neither runtime code nor timing measurements changed after source `147b5b8be3`.

The report regeneration/application run reuses that exact strict producer artifact (13578435138),
through the normal unpacking and freshness checks, before running the official report generator and
unchanged application/rest chain. This avoids rebuilding and repeating successful shards. Validation
coverage below combines source-qualified runs; the failed full run is retained as failed, not relabeled green.

## Retained development failures and limits

Initial focused failures identified old codegen expectations and the native settings validator's
string-only form check; both were corrected before final qualification. The initial schema CLI could
not open an IPC socket in the local sandbox; direct Node/tsx import with the source condition generated
it successfully. API declarations could not build locally without this checkout's missing published
EARS output, so the maintained report generator ran in CI. A native-dependent lookup suite could not
collect without the private binding; this was not treated as a passing result or worked around with a
local native build. Initial renderer test invocations needed package-root execution and the normal
source condition for the PostCSS preset. Corrected focused commands passed.

The contract avoids importing unused pack UI implementations by default; it does not guarantee that
every shared dependency disappears from startup or that first opening a deferred screen is free.
