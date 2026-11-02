# Native 2441 protocol integration — 2026-10-30

Candidate parent `9fbea37d0d`; merged master `dc67febcce3f3a28e8b2bc75b867f0374d4f4610`.
Native pin `2441af4658d961f547c7094cd041c2ac246668c5` changes edge terminals from
`outward` to `direction`. The structured port and SQLite executor now agree with that wire contract.
Both incoming and outgoing public terminals retain their behavior. The merged master regression assertions
for function filtering and NaN traversal depth run against both backends.

The isolated Linux ARM64 run passes typechecking, 56 query/relation tests on each backend (zero skips),
five normal package builds, API reports and 720 SQLite-selected EARS tests (zero skips).
No deadlines or assertions changed. Private Docker resources: two CPUs, six GiB, no swap, dropped capabilities,
a 30-second idle admission window and automatic pause of only our container on competing builds.
The binding and CLI were built from the exact committed native source; `build.json` records their hashes.
The initial loader smoke mistakenly expected top-level `open`; it failed after successful compilation.
The corrected probe confirms the declared `Database.open` API using those same artifacts, without rebuilding.

`qualification.json` binds the tested overlay to file hashes. `receipts.json` verifies raw and stored
bytes; larger reports are losslessly gzip-compressed. Compiled artifacts and dependencies remain private.
This checkpoint does not resolve the existing CLI build-output-swap integration timeout, qualify a final
signed application on this native pin, or complete filesystem, responsiveness, relevance and adoption gates.
