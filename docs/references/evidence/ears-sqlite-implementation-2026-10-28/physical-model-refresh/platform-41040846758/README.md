# Physical refresh platform qualification

[Full strict run 41040846758](https://github.com/spankyed/apack/actions/runs/41040846758)
completed successfully at exact source `95515e64637878681a33bea300ab4a0dae2b2e4c`, with native
pin `95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. Every required strict job passed.

Downloaded platform JSON reports are retained byte-for-byte with SHA-256 receipts. Linux and macOS
passed 657 EARS cases; Windows passed 656 with the existing POSIX-only omission. Each executes
26 model-admission cases, 10 generation cases, five worker cases, three ownership cases, five package
cases and 555 independent membership comparisons. Linux also passes all 1320 SDK cases and seven
managed API startup/shutdown cases. The verification reports identify host and platform omissions.

This qualifies physical refresh on these CI hosts, before subsequent live-maintenance changes.
It does not certify arbitrary filesystems, signed installed builds, performance or production adoption.
