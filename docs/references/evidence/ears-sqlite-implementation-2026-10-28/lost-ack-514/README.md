# Actual persisted WAL commits before application acknowledgement

The durability step in [41226498992](https://github.com/spankyed/apack/actions/runs/41226498992) succeeds at exact source `5142047f773da652deaafc6612aece288e822262`, Linux x64, Node 23.11.1, SQLite 3.53.4, WAL/FULL=2. The complete workflow remains red only for the unchanged shared relevance judgment; no overall green claim is made.

For ordinary writes, outer units and bulk load, the interposer performs the **real WAL fsync successfully**, records its zero result and stops before returning to SQLite. The parent verifies SIGSTOP and absent application acknowledgement, then SIGKILLs the child. A fresh process recovers the incumbent and complete candidate, with exactly one logical sequence increment (2→3), negative zero preserved and an explicit next write reaching sequence 4. Both outer-unit rows recover together. No JavaScript SQL/COMMIT method is replaced. The disabled injector returns normally, produces its acknowledgement, and is rejected by the missing-acknowledgement check.

This adds real process-death persistence evidence beyond earlier actual EIO-return cases that all rolled back. It does **not** prove an ambiguous COMMIT error response retained a commit, physical power loss, device/cache failure, arbitrary filesystems, active-worker faults or complete phase-6 qualification. The next harness revision adds schema change and makes the disabled control call the same witness function as positive cases; those changes require their own actual execution.

Raw reports, helper/source digests, compile/runtime/reopen logs and the remaining relevance failures are retained with uncompressed-byte receipts. Temporary libraries and database payloads are not committed.
