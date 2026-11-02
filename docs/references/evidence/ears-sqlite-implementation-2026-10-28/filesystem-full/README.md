# Real filesystem exhaustion — 2026-10-30

Runtime source `e29a9b1cced1e9e2e2fafe2d0ebc328e299a0735` (same production/native inputs as `63c8267994`).
The new tracked harness and verifier are qualified by their separate source hashes/receipts, not a claim
that those uncommitted-at-execution files were already in that runtime commit. The initial protocol-1
probe and promoted protocol-2 observations are both retained. Input metadata's earlier staged verifier
hash was not executed by the fault runner; the actual qualified verifier hash is in `summary.json`.

Four actual filesystem-exhaustion cases pass on Linux arm64 in an isolated 8-MiB tmpfs with verified
0.5-CPU/768-MiB/no-swap limits. No page-count limit is imposed; the default max-page-count is 4294967294.
Every case observes FULL synchronous=2/default checkpoint=1000. The explicit COMMIT case fills a separate
file until the kernel returns ENOSPC and reports zero free blocks. Ordinary write, bulk load and an outer
unit with an earlier staged write also exhaust actual space. All four enter COMMIT and return SQLITE_FULL.
This is specifically COMMIT-time exhaustion, not independent evidence of a statement-spill I/O fault.

For every refusal, the active transaction ends, logical sequence and incumbent rows remain unchanged,
and watches deliver no refused write. After freeing space, a new write advances exactly once and emits
one new watch result. Close/read-only reopen retains exactly the incumbent and recovered rows. No error
is relabeled COMMIT_UNKNOWN or success, and no durability/checkpoint policy is weakened.

The tracked harness is wired into Linux SQLite-platform CI using a fresh owned tmpfs and unconditional
unmount cleanup. The platform verifier requires all four distinct actual cases, source identity, observed
policy/sequence/free-space/error/reopen/watch outcomes and a genuine ENOSPC filler. Its actual local report
passes, while 42 missing/duplicate/incomplete/substituted-policy/outcome controls refuse. Node syntax,
focused repository oxlint (zero warnings/errors) and workflow parsing pass in a small read-only container.
The new privileged-mount CI wiring still needs an actual Ubuntu run; local Docker qualification does not
claim that unexecuted workflow passes. Source snapshots, guard controls, raw failures/successes and receipts
remain lossless; database/filler payloads are discarded with the isolated mount.

This strengthens real Linux ENOSPC evidence beyond earlier max_page_count tests. It does not qualify
device power loss, arbitrary filesystems, Windows directory durability, other I/O faults, ambiguous commits,
long-lived readers/writers or full app/load/performance acceptance. The full goal remains active.
