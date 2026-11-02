# Managed publication ownership and backend refusal policy

Base `098d479157aaf9c7cfa363f01a8a8a371c1473d5`, integrated master `5e81dda7c2`, native pin
`95615ed8d4`. [Final source hashes and commands](results/matched-final.json) identify the exact overlay.
Production remains elmdb; this is a candidate checkpoint, not an adoption or filesystem certificate.

## Implemented behavior

Every managed host open, including writable opens, publishes a private directory-lifetime claim before
entering the backend. Recovery publishes exclusion before checking claims. Full-profile recovery refuses
held handles; corrupt-history replacement scopes that check to the affected store, allowing the primary
to remain open. Claims use device/inode identity and the leaf name. Different spellings cannot conceal
the same directory; unknown identities refuse conservatively. Directory creation occurs only after the
claim and exclusion check. Managed database-leaf symlinks refuse before opening; ancestor aliases keep
working. A newer directory installed between the failed open and exclusion cannot be quarantined using
the stale corruption diagnosis.

SQLite constructor cleanup failure preserves the original error/cause and reports an unclosed connection.
The managed claim then stays until process exit. Ordinary failed opens release only their own claim;
a failed close retains it. Background owners continue to use `closeDatabases` for actual worker drain.

The storage descriptor owns unreadable-open classification. SQLite history quarantine accepts only
`SQLITE_NOTADB` and generic `SQLITE_CORRUPT`, with other guards satisfied. Aggregate or unclosed-connection
errors, known derived-index corruption, I/O, permission, full-disk, busy and native-library failures refuse.
The policy uses [SQLite's documented result-code distinctions](https://www.sqlite.org/rescode.html);
it does not infer that every error means a file is corrupt. Corrupt files remain in the retained directory.
The original LMDB refusal policy stays in its own descriptor.

## Qualification

Disposable Linux ARM64, Node 23.11.1, driver 13.0.3 / SQLite 3.53.4, image
`apack-linux-test:74d4b8cfe839`, two CPU / six GiB / no additional swap / dropped capabilities:

- **1,927 complete host cases pass**, with one existing Windows-only embedded-drive probe skipped.
- **All 691 EARS cases pass with zero skips**, explicitly enabling the matching native extension.
- **129 focused storage/recovery/history cases pass**, including both real backends and actual stale
  filesystem publication. Complete host coverage also tests a separate writable process, refusal while
  it lives, forced SIGKILL and recovery after its claim becomes stale.
- **78 source-coverage/repro cases**, host/EARS types and changed lint pass. Actual platform-verifier code
  accepts all **27 publication witnesses** and refuses a missing or skipped witness.
- **16 signing/Preview/boundary cases** and the exact scripts/E2E/repo/publish typecheck chain pass after
  adding JSDoc types to the moved checked-JavaScript helper. The absent per-file callback preserves signer defaults.
- Normal `packages:build` rebuilds all five publishable packages; EARS reports **three API reports up to date**.
  Complete host/EARS contracts and the scripts chain are rerun against those matching outputs.

[Raw reports](results/matched-host.json), [native-enabled EARS](results/matched-ears.json),
[runtime/native provenance](results/runtime.json), [seven independent controls](results/controls.json) and
[verifier controls](results/publication-gate.json) retain exact evidence. Controls remove writable claims,
quarantine exclusion, correct I/O classification, uncertain-open retention, physical identity comparison,
stale-publication refusal or the native unclosed-connection report. Each produces the intended failed
assertions; command parse failures are insufficient.

## Harness corrections and limits

The first focused run exposes the real missing SQLite corruption classification. Subsequent fixture corrections
use the mutable Node fs export for fault injection and capture a bound cleanup function without disabling lint.
The first complete host run has two obsolete directory-list assertions (now explicitly checking the metadata
registry and retained claim) and a copied fixture missing generated shipped-pack entries. Normal code generation
repairs the fixture. No discovery assertion is weakened. An initial API report command refuses unbuilt copied
packages; normal matching-package rebuild closes that guard without `APACK_ALLOW_UNBUILT`.

An early EARS pass skips 75 optional native cases because the harness lacks `EARS_VEC1_EXTENSION`. The final
native-enabled runs close this gap: all 691 execute. Local heavy work is paused when the other agent builds.
One partial run exceeds its unchanged outer deadline during a pause and is not qualification. The final matching
functional host pass includes a recorded resource pause; its wall time is not a performance measurement. All
original deadlines/assertions remain unchanged. [Receipts](receipts.json) retain original report/log hashes;
only trailing whitespace in text logs is normalized, and JSON is unchanged.

All-platform publication cases and a new actual signed installed run must qualify the published checkpoint.
No arbitrary filesystem, native-upgrade or performance acceptance follows from these Linux tests. Positive
persisted SQLite format identity, unaliased data-file ownership, destructive CLI deletion authority, quarantine
parent durability and the remaining goal gates still need closure before adoption. Direct raw constructors
and arbitrary external namespace changes are outside managed profile ownership.
