# Current committed platform qualification

2026-10-29. Exact source `2d0a0e7d4885b47c3d330870e75ff74666f81fdd`, matched native
`8ab7088f9a583202f9ccc766381a31e39d19851f`. [Run 40996488761](https://github.com/spankyed/apack/actions/runs/40996488761)
is terminal success on Linux x64, macOS ARM64 and Windows x64. The unused parent `check` job is skipped by
its explicit SQLite-suite condition; all three actual platform jobs pass.

Inspected and retained actual artifacts, not workflow status alone. Every host verifies both SDK fixture
stores, **five** current built-pack thread-query cases, 555 native membership comparisons, all seventeen
then-current native generation/training/model cases, maintenance/logical archive commands, copied-profile
conversion and five publication/ingestion process-kill boundaries. Compiled source is byte-identical to
required LF SHA-256 `5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b`
on every host, including Windows. The retained source C file was independently hashed after artifact download;
its digest, tested extension digest and per-host membership provenance match verification receipts.

Linux additionally passes all 1,320 prepared SQLite SDK cases, zero skips, and the native/converted API
boot-update-restart lifecycle. POSIX EARS/host counts are 625/135; Windows 624/122, with the explicit
POSIX and directory-sync omissions preserved in reports. Current-query and SDK backend reports are retained
as compressed originals, alongside EARS/host reports and native/runtime provenance. `receipts.json` hashes them.

This closes platform qualification of this committed checkpoint and the Windows canonical-source fix.
It does not establish full Strict, arbitrary-filesystem or installed/signed Electron acceptance, performance
budgets, or qualification of later source edits. Canonical remains at its last exact full Strict green.
