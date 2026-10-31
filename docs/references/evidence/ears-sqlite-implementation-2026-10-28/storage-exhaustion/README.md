# Storage exhaustion and automatic transaction rollback — 2026-10-28

Pre-fix source **5e20fb5956cb0543d8934f34232d088d108818b1**. Fixed source
**479e6bc333c82020ceb66a61dd84882aab396a5f** (functional fix 4338ba3699).
App/native pins 98386b36a1 / 6ab2f69. Disposable Linux arm64, Node 23.11.1, 2 CPUs / 6 GiB,
all capabilities dropped; a separate **4 MiB tmpfs** contains only synthetic fault databases.
Source archives and runtime/target trees remain outside the daily Mac; retained files are logs/scripts/hashes.

## Original bug and physical evidence

Three controls exercise a SQLite allocator page limit, actual tmpfs exhaustion during dirty-page spilling,
and actual tmpfs exhaustion at COMMIT (large cache avoids earlier spilling). SQLite reports SQLITE_FULL and
ends the transaction itself. Old cleanup then tries ROLLBACK TO a vanished savepoint and/or ROLLBACK with no
transaction, replacing the original refusal with SQLITE_ERROR. The SQL-stage observations retain that chain.
Incumbent rows, logical sequence and watch deliveries remain unchanged in these observed refusals; a subsequent
write succeeds after capacity is restored. No data-loss or successful-commit claim is inferred from the error.

## Implemented behavior and independent proof

Cleanup checks SQLite's actual transaction state. It preserves the operation's original storage error and clears
rolled-back layout state. A unit SQLite has automatically aborted is terminal; catching its error cannot silently
start a fresh transaction inside that unit. Ordinary savepoint refusals still preserve an otherwise live unit.
If rollback itself fails, the error retains both causes, background work stops and the connection refuses reuse;
explicit close remains available, and reopen verifies the incumbent. This rollback-failure control injects errors,
whereas tmpfs capacity failures above are actual SQLite/VFS failures.

All three capacity controls now return SQLITE_FULL without redundant rollback errors. They verify unchanged
sequence, incumbent rows, watch delivery count and successful post-reclamation writes. Four permanent regression
cases pass and fail against the exact pre-fix backend; the full suites pass **418 SQLite / 251 native tests**.
EARS types, API reports, plain-Node source loading, lint and imports pass. Five normal package builds pass.
The first fixed-source attempt had a test type error from using a driver-specific pragma method; tests now use
the existing narrow SQL boundary. That failed attempt is retained. In the final harness, source.json contains an
environment placeholder; exact-source.json pins the actual original Git archive SHA-256 and full source commit.
The placeholder is not used as source evidence, and no rerun was made merely to improve a label.

## Limits retained by the full goal

Tmpfs allocation exhaustion does not model delayed filesystem writeback, failed device flushes, power loss,
all disk-full conditions, corruption or arbitrary COMMIT IOERR outcomes. Ambiguous COMMIT errors still need
explicit qualification and truthful outcome handling; NOT_DURABLE is not asserted by these tests. No filesystem,
production durability or performance certification is claimed. Platform/package, search/relevance/recall and
latency/resource acceptance remain required.
