# Platform and focused diamond qualification — 2026-10-30

At source `5569fdd656bf8e8f44a6e93988f9598860752b09`, platform run
[41159890572](https://github.com/spankyed/apack/actions/runs/41159890572) succeeds on Ubuntu x64,
Windows x64 and macOS arm64; the alternate check job is skipped as expected. Actual downloaded platform
reports and verification records are retained. All hosts pass 735 native membership checks. Linux/macOS
pass 762 EARS cases with zero skips; Windows retains its named platform skips rather than counting them
as passes. Windows logical-host directory-flush coverage remains skipped. This does not certify arbitrary
filesystems, Windows physical directory durability or device power-loss behavior.

The new Ubuntu real-filesystem-full step succeeds with four actual ENOSPC cases at FULL=2 and default
checkpoint=1000, closing the new CI wiring gap. Its report verifies prior rows/sequence, refused-commit
silence, successful reuse and read-only reopen; this is not a simulation via database page quota.

Focused macOS run [41160571827](https://github.com/spankyed/apack/actions/runs/41160571827) passes all five
original diamond integration assertions, with the original 240000-ms setup deadline. Raw completed job
logs record setup phases 25066/26093/26086/26321 ms, about 103.6 seconds total, and the real collision case
72994 ms. The complete selected file takes 180.15 seconds. The uploaded suites artifact contains fixture
build inputs only, so the actual five-pass claim is supported by the completed test/job log, not an invented
per-case JSON artifact. Linux's independent five-case observation is retained separately.

Neither focused pass explains the earlier full strict shard's four-minute setup failure under concurrent
files. The full strict run remains failed and source-app activation remains unresolved; no causal correction
or full-branch qualification is claimed. No assertion, fixture build or deadline was removed or weakened.
