# Ordinary native package qualification on all CI hosts

2026-10-30. [Run 41013324901](https://github.com/spankyed/apack/actions/runs/41013324901) succeeds
on Linux x64, macOS ARM64 and Windows x64 at exact source
`1efad34246795ee6286d915e47637fe9c55807ef`, with native source pin `006d6cec88`.
Parent check is intentionally skipped; the three actual platform jobs succeed. This qualifies
that committed package/linker checkpoint, not later service-ownership edits or full Strict.

Downloaded artifacts are independently inspected: each host executes all 555 membership comparisons,
five ordinary package-loading/integrity cases, eight native generation cases, five worker cases,
sixteen model cases, both SDK backend fixtures and all five current thread queries. Canonical C
hashes to `5d49d5ea17fbeaa1f22141305a81a5aeac8feb1af652a0d8229ea906bd5c973b` on every host.
Independent native binaries hash to their recorded package hashes:

- Linux x64: `90b3a13bcaa70413d6f87c325355a8400a0823b92256d2eef6ec28e6b9add8c8`.
- macOS ARM64: `3bf657a9adea0584351a29232690f8b3a1e909a7439d0c6aaafdab7e594cc4ba`.
- Windows x64: `73913aa7da6d2da340b4d0335e22c13b9bcd94ce97fb5276501c40439444c7c7`.

Linux/macOS pass 642 EARS and 135 host cases each. Windows passes 641 EARS and 122 host
cases, retaining the existing explicit POSIX/directory-durability omissions. Linux additionally
passes all 1,320 prepared SDK cases with zero skips, 78 build-coverage cases and package/host/script
types. Its real native/converted API boot/update/restart retains history/settings/media and primary
source, with optional Codex executable absence recorded. Maintenance, logical archives, explicit
copied-profile conversion and five process-kill publication/ingestion cases execute on all hosts.
Raw verifier/test reports and native provenance are compressed with original/gzip hashes; compiled
libraries, full source C and dependencies are not committed as evidence.

The prior source `38aecfe554` passes Linux/macOS but fails Windows before package production
because bash resolves Git's unrelated linker. The corrected exact run above demonstrates the
absolute Microsoft linker fix and reproducible Windows package/independent library bytes.
This is CI-host qualification, not filesystem certification, signed/installed app acceptance,
model-owner app activation, full Strict or performance/relevance/recall acceptance. The latest
real 100k heartbeat remains failed, and the earlier full host-pool timeout still needs resolution.
