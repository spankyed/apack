# Windows fresh-backup publication — 2026-10-30

Actual Windows job 124285964888 in strict run 41120604961 fails at source `a95039a8c7`:
`apack db backup` creates an empty destination reservation, then renames the verified backup onto it.
Windows rejects that directory rename with EPERM. The job passes EARS and host recovery/storage before
failing the existing SQLite profile backup/verify/import case; the later conversion/verifier steps do not run.
Linux/macOS SQLite jobs pass and the signed installed Preview passes at that source. This is not a green
whole strict run; the signed job log additionally verifies six actual executable cases with no skips/retries,
the mandatory two-store/model-ownership witness, pre/post-sign native smoke and strict Developer ID sealing.
Those receipts apply to `a95039a8c7`, not the CLI correction. Other strict shards remain independent and must be inspected through their original handle.

The corrected publication reserves an empty destination only on POSIX, where rename could replace an empty
directory. Windows renames the verified directory directly and relies on directory rename refusing occupied
destinations. It does not remove an existing destination to manufacture success. Four real filesystem races
create a file, empty directory, populated directory or dangling symlink after snapshot export but before
publication; refusal must preserve the competing entry and clean only owned staging. The existing complete
backup/verify/history/import case remains required on Windows rather than being skipped.

On isolated Linux, all 28 cases in the exact platform CLI selection pass (11 SQLite profile, including the
four new destination races); CLI types, lint and its normal package build pass. Caps remain two CPUs/six GiB,
no swap/dropped capabilities and a quiet admission window. The earlier focused 11-case run uses half a CPU/
768 MiB. This establishes Linux behavior and source correctness, not actual Windows success. Updated
three-platform acceptance must verify this branch, including every destination race, before qualification.

The Windows development VM's read-only SSH probe timed out; no VM lifecycle, network rule, credential or
subscription change was made. This concrete corrected production path is therefore sent to the required
platform acceptance rather than removing the Windows witness. `receipts.json` verifies original/stored
bytes, and the original Windows job log is retained losslessly.
