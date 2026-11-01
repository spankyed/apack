# SQLite identity, safe refusal and signing path ownership

This checkpoint follows `836d3d1d1f` on master snapshot `62f1798c9b` and native pin `95615ed8d4`.
Production stays elmdb. Existing draft PR #286 remains a candidate; no cutover or release is implied.

## Implemented behavior

SQLite files carry EARS application ID `0x45415253` and `user_version=1`. A valid foreign file or mismatched
identity refuses before EARS initialization. New empty files publish identity and foundational primary tables
in one transaction before WAL activation. A refused initializer rolls back both and preserves the original
failure. Existing missing primary catalogs or admitted per-type tables refuse instead of being recreated empty.
The driver has zero busy timeout from the first metadata read. Unmarked earlier candidates require recreation
or explicit export with their original code; no compatibility fallback or migration was added.

Existing writable targets receive a read-only format inspection before obtaining a writable connection.
A real killed-writer fixture showed why: closing even a refused writable connection checkpoints a foreign
committed WAL, changes the main file and removes the WAL. Read-only inspection preserves both byte streams.
Probe close failure preserves the original error and the managed unclosed-connection claim flag. The host
refuses foreign run history without initialization or quarantine; its reader claim is released on clean refusal.

The published parent's strict app shard failed a signing-unit fixture: macOS temporary aliases made its exact
codesign argument assertion expect an uncanonical path. Retries then surfaced the already-updated manifest.
The fixture now starts at its canonical root and retains every assertion. A new alias regression independently
reproduces a real helper defect: a canonical outer-app callback did not match an aliased caller path. Both
library and outer-app identity now compare real paths, preserving owner options, retries and pre-seal checks.
The installed witness additionally requires both real stores' persisted application/version header fields;
that new witness has been typechecked, not yet executed in a packaged app at this source.

## Qualification and limitations

Capped private Linux qualification passes **720 native-enabled EARS cases with zero skips**, **1,929 host
cases with the one existing Windows-only skip**, 38 storage cases, EARS/host types, all five normal package
builds, all three EARS API reports, exact scripts/repo/publish/E2E types and changed lint. The signing helper
is consumed by electron-builder, not those five package producers; its 10 focused cases pass, including the
new alias regression, after the helper change. Final tooling types include the added installed witness.

Original evidence is retained: all seven initial identity cases fail at the parent; the first implementation
still fails the writable foreign-WAL case while its read-only counterpart passes. Three independently reverted
safeguards fail the atomic-bootstrap, foreign-WAL and missing-primary assertions; restored identity passes 19/19.
The injected SQLITE_FULL refusal is a method fault, not certification of a full physical device.

The first full host run failed two elmdb process deadlines and a module fetch during recorded resource pauses.
It is retained under `resource-interruption/` and is not qualification. The unchanged source then passes the
complete host suite under the original deadlines with no pause. A 30-second quiet admission window avoids
starting between other-agent build bursts. Heavy checks use one two-CPU/six-GiB/no-swap container with dropped
capabilities; focused checks use half a CPU/768 MiB. No compiler/full suite ran on the Mac, and no shared target,
dependency tree, assertion or deadline was changed. Log whitespace normalization retains raw/stored hashes. Large reports/logs use lossless gzip archives;
receipts additionally record their decoded hashes, preserving the exact JSON and normalized text.

The parent's real signed installed macOS ARM64 run **41095894244 passes**: cold build, unsigned/signed native
smoke, strict Developer ID bundle verification and all six executable cases. Its actual job log and metadata
are retained. This qualifies `836d3d1d1f`, before these identity/alias changes. Parent strict **41095887025** is terminal failure with only the app shard failing the diagnosed signing unit.
Producers, both integration shards, both native shards and all three SQLite platforms pass. Never infer
whole-run success or qualification of these later changes.

Exact-source strict/platform and signed-installed qualification remain required for this checkpoint. Ordinary
data-file aliases, reset/history deletion exclusion, durable namespace publication, final filesystem/resource
faults, original performance/relevance/recall budgets and the full goal's adoption review remain open.
