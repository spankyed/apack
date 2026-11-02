# Reset interruption subprocess inventory — 2026-10-30

Strict job 124288948979 in run 41120604961 fails its subprocess inventory at runtime source `a95039a8c7`.
The real reset SIGKILL/retry test adds a fourth spawn site to `db.integration.spec.ts`, while its inventory
still records three. The same host pool reports 6,274 other passing tests, 445 skips and this one failure;
that is not a green full strict result. The original job log is retained losslessly.

The inventory now records exactly four sites and explains why the new process is necessary: killing reset
after primary clear/before history deletion must prove real dead-process lock reclamation without killing
the test worker. The inventory's detector, assertions and population/mutation controls remain unchanged.
All 14 inventory cases pass on the actual source population in the private Linux container (half a CPU,
768 MiB, no swap, dropped capabilities). `source.json` records the edited file hash and exact focused command.
This correction changes validation metadata only, not the product runtime or the killed-process test.
