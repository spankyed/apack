# Exclusive Windows backup publication — 2026-10-30

## Failure and corrected boundary

[Three-platform run 41125212261](https://github.com/spankyed/apack/actions/runs/41125212261)
at product source `2a641ce102` is a terminal failure: Linux/macOS pass, Windows job 124301731849 fails
both the competing-file and dangling-file-symlink publication cases. Direct Node directory rename
resolves successfully and replaces those competing entries. The ordinary backup/verify/import case and
both competing-directory cases pass. The first Windows correction therefore fixed EPERM but introduced
unsafe publication; it is not qualified. The original log and metadata are retained losslessly here.

The offline backup boundary now calls `publishBackupDirectory`. POSIX retains the exclusive empty-directory
reservation. Windows invokes the system Windows PowerShell executable without a profile or interaction,
calling `[IO.Directory]::Move` with paths supplied in environment variables. Paths are never interpolated
into PowerShell code. No execution-policy bypass, runtime compilation, added native dependency or unsafe
rename fallback is used. Missing SystemRoot or unavailable/blocked PowerShell refuses publication.

[Microsoft's Directory.Move contract](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.move?view=netframework-4.8.1)
refuses an occupied destination. The actual existing Windows race cases remain required: files, empty and
populated directories, and dangling symlinks must survive. A new end-to-end case verifies a backup path
containing quotes, a semicolon and a dollar sign is literal and produces a verifiable backup.

The helper runs synchronously only during the closed-app offline command, with a 30-second timeout.
An unconfirmed helper outcome reports `PUBLICATION_UNKNOWN` and the destination path; it never removes
that destination. CLI cleanup removes only its private staging directory and releases its write exclusion.
This fixes the exclusive-publication primitive; it does not implement Windows directory flushing or certify
power-loss durability, ACLs or arbitrary filesystems. Those original goal requirements remain open.

## Local evidence and remaining qualification

The exact platform CLI selection passes all 29 cases on isolated Linux (zero skips), with clean changed-file
lint. The focused SQLite CLI suite passes all 12 cases, including four real destination races and the literal-path case. This cannot prove the Windows-only helper executes correctly. Actual Windows
platform acceptance is required before claiming the correction works there.

An initial host typecheck exhausted Node's default approximately 384 MiB heap. At an explicit 512 MiB heap,
host typechecking succeeds, but CLI typechecking also exhausts that heap. These are validation resource
failures, not passing checks. Both original failures are retained. No compiler was run on the daily Mac,
no assertion/deadline was relaxed, and heavier validation must await the shared disposable resource budget
or the required CI gate. All focused containers are capped at half a CPU/768 MiB, no swap, dropped capabilities.

`receipts.json` binds compressed evidence to its original bytes. Product changes are based on `8d1a166c19`,
master `dc67febcce`, native pin `2441af4658`. Final exact-source full acceptance remains outstanding.
