# Managed startup qualification on current master

[Run 41034695900](https://github.com/spankyed/apack/actions/runs/41034695900) passed on exact
source `3cccc4dfa9441b834afc325fddd24f1fb1d06c09`, combining master `5e81dda7c2` and native
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. Downloaded artifacts were independently checked
for exact source, zero failed EARS cases, all 23 model/8 generation/3 kernel ownership cases,
and 555 membership comparisons per host. Linux/macOS pass 652 EARS cases; Windows passes
651 with the existing POSIX omission. Linux executes all 7 managed API startup/shutdown
cases, all 1,320 prepared SQLite SDK cases and the real converted-profile API boot/live
pack update/restart lifecycle. All hosts execute the five current app query cases.

These receipts qualify managed startup and separate logical/native readiness on this
master/native baseline. They do not qualify the subsequent physical refresh changes,
full strict-chain completion, signed installed distributions, arbitrary filesystems,
or the still-failed performance budgets. Checksums identify the copied raw reports.
