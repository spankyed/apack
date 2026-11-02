# Explicit SQLite platform lane — 2026-10-29

The default strict EARS unit selector is elmdb. Add a candidate-only reusable workflow to the existing
manual Strict chain, running SQLite-selected EARS and host recovery/storage commands on declared macOS
arm64, Windows x64 and Linux x64 runners. Ordinary CI triggers remain disabled. Each platform builds its
pinned native dependency and matching packages, runs the normal built-package probe, emits JSON/logs,
verifies selected cases actually ran, and always retains hidden .temp evidence. Fail-fast is disabled so
one platform failure preserves the others. This is functional/runtime qualification, not performance.

The built probe asserts dist resolution and the declared native architecture, exercises finite numeric/Date
recency with highlights, regex/WASM, substring and sqlite-vec loading, then verifies a physical backup read-only.
It retains exact source/engine pin, runtime versions, loaded native hashes, vec extension and regex asset hashes.
The 3D vector is loader-only evidence, not recall. Complete Electron/installed/signed distributions, filesystem
support and durability remain separate goal requirements; no platform beyond the actual host is certified.

## Local validation and safeguards

The full disposable Linux arm64 run uses two CPUs/6 GiB, dropped capabilities and real permission-denial
preflight. Workflow YAML, script syntax/lint, five package builds, built probe, **492 SQLite / 95 host cases**,
and the genuine **289-case native control** pass. Reporter paths match the workflow commands. Reports come
from a synthetic Git repository made from the exact source archive for tracked-file guards: their source
field is that synthetic commit, not a published candidate. The source manifests identify actual base/patch
inputs. Hosted CI will record its real checkout commit and declared release architecture instead.

The initial verification incorrectly accepts the native control: twelve SQLite-directory cases run even
under elmdb. Validation stops rather than treating that as a useful negative proof. The corrected verifier
requires every case in the conditionally selected native-text-prefix suite to pass, plus real recovery cases.
The first corrected attempt fails lint on a redundant suffix regex; endsWith fixes only that expression.
Final syntax/lint and real-report checks pass: the 492-case report has 16/16 selected text cases; the 289-case
native report has 0/16 and is refused, despite twelve other SQLite-folder cases passing. Restoring the real
SQLite report passes again. Both previous failures and all raw reports remain retained.

Only the verifier branch changes after full suite/probe execution; source-comparison.json proves the runtime
probe branch and all production/test/workflow files are unchanged. Final verifier checks reuse those actual
reports rather than rerun unchanged suites. Each runner is fail-fast, and results.json in the full runner
records setup subprocesses only; later outcomes live in individual logs. No hosted platform run is claimed yet.

Before canonical promotion, publish the converged source and run one new exact Strict chain; it now includes
the three-platform candidate lane. The prior six-job source 60d4283f68 remains the last exact green. All
performance failures and remaining phase 3–7 requirements stay required.
