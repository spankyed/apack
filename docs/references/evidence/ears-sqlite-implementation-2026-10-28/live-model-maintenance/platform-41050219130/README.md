# Live-maintenance platform qualification

The three SQLite platform jobs in [41050219130](https://github.com/spankyed/apack/actions/runs/41050219130)
pass at exact source `4903c50a4a39bba91c8dff495d54764e1472ff18` and native
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. JSON receipts are copied byte-for-byte with SHA-256 hashes.

Linux/macOS pass 665 EARS cases; Windows passes 664 with the existing POSIX-only omission. Each passes
34 model cases and 555 native membership comparisons, plus ownership, worker, generation and artifact checks.
Selected host contracts pass 145 on Linux/macOS and 132 on Windows with documented platform omissions.
Linux also passes 1320 SDK cases and seven managed API cases. These qualify live maintenance on the CI
hosts, before later native audit/rebuild/repair changes; they do not certify arbitrary filesystems or signing.

The full strict chain is **not green**: app-and-rest failed its bundled editor editing assertion after the
27 external-pack cases passed. At retention time integration-1/native-1/native-2 were still running and
integration-2/producers passed. The original run is kept to completion; a queued later source does not
replace its evidence. The app failure is retained separately and remains unresolved.
