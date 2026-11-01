# Native signing and cold Preview build checkpoint

Base `ff16d3b9467ee3f0c115ac3bc60d1798651d7c31`, over integrated master `5e81dda7c2` and native pin
`95615ed8d4`. Final changed inputs and commands are hashed in [checks.json](results/checks.json).
Production remains elmdb. Real signed/installed qualification is pending.

## Cold build failure

[Installed run 41066985563](https://github.com/spankyed/apack/actions/runs/41066985563) fails before packaging:
Preview calls `generate:entries` before building the published SDK types, so `SurfaceInbox` resolves to
`any` and the compiler correctly refuses the unresolved threads contract. [Original job log](installed-preview-41066985563.log)
and [raw-log receipt](failed-run-receipt.json) retain that failure. This is not a SQLite query failure.

Preview and production builds now use `build:default-setup` directly. That command prepares matching
packages and the ordinary pack build generates its entries. The redundant early generation was removed;
no compiler check or contract assertion was relaxed. The skipped-pack production path continues to use
its existing prepared output contract. Actual cold packaging must be rerun on macOS.

## Signing order

The pinned electron-builder 26.15.3 exposes `mac.sign` with its fully resolved identity, keychain,
entitlements and ignore policy. Pinned @electron/osx-sign 1.3.3 invokes `optionsForFile` immediately
before each inner signing operation and finally the outer app. The custom hook preserves those options
and the existing three-retry policy (5/10/15 seconds), resolves the actual EARS owner inside the app,
derives architecture from the real executable, and checks unsigned library bytes against their manifest.

Immediately before the outer seal it requires the library to have been processed in this signing pass,
verifies its signature, refuses concurrent manifest changes, and publishes the signed binary hash.
Source/upstream/header provenance remains unchanged. It never changes resources after outer sealing.
Retries handle the previous attempt's own manifest publication and rehash newly signed bytes. Escaping
symlinks and unsupported universal layouts refuse; configured macOS distribution is ARM64.

The `installed-signed` CI suite builds an ordinary unsigned Preview and runs its native smoke, imports the
existing CI Developer ID certificate into a disposable keychain, signs through this same hook, verifies
the complete bundle and hardened runtime/team identity, repeats the native smoke and launches the actual
signed executable with the SQLite process-boundary witness. It does not notarize, publish or release.
Missing signing credentials fail explicitly. The keychain and transient certificate have always-run cleanup.
Actual signed execution is required before this can count as packaging acceptance.

## Isolated checks

Capped disposable Linux (2 CPU, 6 GiB, no swap, dropped capabilities) passes 12 tests: eight signing/order/
fault tests and the four existing Preview tests, plus repo-tooling types, changed lint, production shell
syntax and parsed workflow shell/JavaScript. Three controls remove manifest publication, inner signature
verification or the current-pass library safeguard. Each produces specific failed test assertions, retained
in raw JSON and checked in the harness; command parse failures do not count. No Mac host build was run.

The copied dependency fixture initially omitted elmdb's matching `index.d.ts`; restoring that declaration
from the existing pinned private dependency tree fixed fixture typing without product changes. The first
mutation harness also omitted a CLI argument; it was corrected and all controls rerun with JSON assertion
verification before recording this result. These Linux doubles establish ordering/failure behavior, not
Apple signing validity. Final exact-source strict CI, actual installed/platform execution, performance and
all remaining goal requirements stay open.

Retained text logs normalize trailing whitespace for Git; [receipts](log-receipts.json) preserve original hashes. JSON reports are unchanged.

[Actual signed installed macOS qualification at this checkpoint](installed-41069328528/README.md) now passes. Later host changes retain their own qualification.
