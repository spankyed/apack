# Reset exclusion and quarantine publication — 2026-10-30

Candidate parent `862b5af400`, committed master `dc67febcce`, native pin `2441af4658`.
Forced reset now excludes history readers/writers before primary clear or secrets mutation, including an
absent history directory. Only a distinct sibling whose name and physical identity still agree is unrelated;
unknown/stale/same-store claims refuse. New managed opens stay excluded until deletion ends. Dry runs remain
read-only. Errors release exclusion, and a reset interrupted between its separate stores can be retried.

Unreadable history moves to a unique timestamped quarantine. Parent synchronization precedes replacement
open and follows replacement creation. A failed synchronization reports `PUBLICATION_NOT_DURABLE`, retains
the original refusal and sync failure, and names the quarantine. Failed cleanup retains its error and directory
claim. On Windows the existing directory-sync helper is a no-op: the new ordering/fault tests do not establish
physical Windows durability. Windows durability and filesystem/power-loss qualification remain open.

Local qualification in one private Linux ARM64 container (two CPUs, six GiB, no swap, dropped capabilities,
30-second idle admission and pause on competing builds) passes host/CLI types, changed-file lint, platform
script syntax, 106 focused host cases, seven real SQLite CLI cases, all five package builds, the shipped-pack
build, nine actual reset integration cases and 1953 full host cases
(1 existing platform skip). The reset suite intentionally selects nine of its file's
77 cases; the other 68 are unselected. It covers held readers/writers before primary/secrets mutation,
missing history, exclusion during deletion, cleanup after deletion failure, and an actual child killed after
primary clear/before history deletion. The killed child's two history records survive and a fresh reset
reclaims its stale locks and completes. No existing deadline or assertion changed.

Before the fix, four new missing-target store-exclusion cases and all six initial quarantine synchronization
cases fail. Removing the reset guard from the private copy makes both actual SQLite held-history refusals fail
because reset incorrectly resolves; the original source is restored in a `finally` block. The platform workflow
now executes the new namespace and SQLite CLI cases, requiring 24 named namespace witnesses plus four named
reset invariants (seven selected SQLite profile cases). Nine actual-report verifier controls cover omissions,
skips, duplicates, extra passing cases and Windows separators. The eight preceding publication/identity
controls also pass again against the current reports and verifier.

Initial test-development failures are retained: a nullable-pipe type error and two attempts to spy on immutable
Node ESM namespace exports. Corrected tests patch/restore the builtin backing object and synchronize ESM
bindings; the final real reset suite passes. `qualification.json` and `inputs.json` bind commands/results to
actual inputs, and `receipts.json` verifies original/stored bytes; larger reports are losslessly compressed.
Compiled files, dependencies, captures and native binaries stay private.

Earlier three-platform run 41112243866 is terminal success on `9fbea37d0d`, before the new native pin, ownership
and reset changes. It does not qualify this checkpoint. Final exact-source strict/platform and signed-installed
acceptance, Windows durability, physical fault/recovery, responsiveness, representative search/vector relevance
and all remaining goal phases are required. Production remains elmdb.
