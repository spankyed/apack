# Transactional native repair platform qualification

[Full strict 41056724109](https://github.com/spankyed/apack/actions/runs/41056724109) is terminal success
at `3333361c3cfe65ea2eddadf29d3f5c893e132177`: producers, both integration shards, both native shards,
app-and-rest and all three SQLite platform jobs pass. Optional separately selected jobs are skipped by
configuration. [Run metadata](strict-run.json) retains exact job results.

Independent EARS JSON reports contain 25 passing native audit/repair cases on each host, 691 passing
EARS cases on Linux/macOS and 690 on Windows. Platform verification additionally records 35 model cases,
555 native membership checks per host, 145 selected host cases on Linux/macOS and 132 on Windows.
Linux runs the full selected SQLite SDK contract suite (1320 cases) and seven managed API lifecycle cases.
The one Windows platform omission remains the existing POSIX directory-sync witness; no skip was added.
Raw retained JSON hashes are in [receipts.json](receipts.json).

This qualifies exact repair source and these CI hosts. It is not installed/signing, arbitrary-filesystem,
performance adoption or an independent complete Rust matrix certificate. Subsequent packaging changes
retain their own required qualification.
