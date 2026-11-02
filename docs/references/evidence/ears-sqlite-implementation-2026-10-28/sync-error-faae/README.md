# Error-returned committed state before connection close at faae1545e2

[Actual recovery run 41243483379](https://github.com/spankyed/apack/actions/runs/41243483379) passes both the original lost-success-acknowledgement mode and the new error-returned mode across ordinary writes, outer units, bulk load and schema changes. Each mode's disabled injector is rejected by the same witness checker. The overall workflow still fails the unrelated retained text-only relevance judgment; this is recovery-slice evidence.

The Linux interposer performs a real successful sync of the exact owned WAL, writes a durable witness and returns synthetic EIO. Actual SQLite COMMIT throws `SQLITE_IOERR_FSYNC`; the adapter reports `COMMIT_UNKNOWN`, and a read through the old handle throws that same fenced outcome. Application code records the error and stops without closing. The parent verifies stopped state and both witnesses, then SIGKILLs the process. No SQL/COMMIT method is mocked.

Fresh processes observe the complete committed state in all four cases: one sequence increment, complete unit membership/schema declaration, preserved negative zero and a usable next write advancing once more. This directly observes persisted data after an error returned to application code. It closes the earlier observation gap where error probes closed the connection before reopening; it does not certify physical power loss, real failing devices or arbitrary filesystem behavior.

The original mode still verifies successful WAL sync followed by kill before a success acknowledgement. Its default behavior survived the helper extension. Private database/build scratch is scoped by the driver's completed TemporaryDirectory lifecycle; no compiled shim or database is copied here.

`summary.json` contains inspected synthetic-operation labels, numeric sequences, syscall/error/quarantine outcomes, disabled-control results, source-helper hashes and original report digests. Full reports remain in CI and private local evidence. This does not replace final-source app backup/import/lifecycle and operational gates.
