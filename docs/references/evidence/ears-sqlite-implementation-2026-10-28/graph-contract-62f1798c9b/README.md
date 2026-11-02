# Current graph contract on master 62f1798c9b

The isolated candidate combines managed publication checkpoint `82b36eca5b` with committed master
`62f1798c9b`, retaining native pin `95615ed8d4`. Production remains elmdb. This is source qualification,
not adoption, filesystem certification, installed-platform acceptance or graph performance evidence.

The structured port and SQLite execution now implement both-direction adjacency, bounded hierarchy walks,
shortest paths and degrees. Paths preserve seed/kind/direction/insertion tie order. Native SQL batches one
frontier at a time; a driver iterator closes on early discovery. Degrees include parallel edges and count
self-edges twice for both directions. Membership dependencies include intermediate and unchecked types.

Final checks in the private Linux ARM64 volume pass **701 EARS cases with zero skips**, **1,927 host cases
with one existing Windows-only skip**, EARS/host types, the exact scripts/repo/publish/E2E type chain, changed
lint and all three EARS API reports. All five normal package builds passed before this final run; their
runtime input hashes match the final source. Normal API generation corrected the merged export ordering.
Focused shared graph/vocabulary checks pass 38 SQLite and 36 elmdb cases; four independently reverted
safeguards fail their intended cases, with the restored affected files passing all 20 focused cases.

The first focused run found an invalid SQL `ORDER BY 0`; it was fixed. The first full EARS run passed 700
cases and failed the independent statement observer because it counted array reads but not streaming reads.
The observer now counts both, retaining exact equality, the greater-than-256 witness and the capture cap.
A test-only native `busy` property assertion did not typecheck against the private interface; it was removed.
The independent negative control already proves that omitting cursor release makes the actual synchronous
query fail with a busy connection and prevents cleanup. No production interface was enlarged for the test.
The initial control verifier expected assertion failures only; cursor leakage instead fails during actual
query execution. Its acceptance now requires that specific busy-query failure and the selected case names.

Broad validation uses one private two-CPU/six-GiB/no-swap container with dropped capabilities. Focused controls
use half a CPU/768 MiB. Resource logs record pauses/resumes around the other agent's containers. Source gates
are functional evidence; their wall times are not performance samples. No compiler or full suite ran on the
Mac, no shared dependency/output/target was used, and no assertion or deadline was relaxed. Raw hashes and
whitespace-normalized log hashes are retained in `receipts.json`; JSON reports remain unchanged.

Final exact-source full strict CI, signed installed checks and the remaining goal acceptance are required.
