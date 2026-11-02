# Mixed-type scalar sort plan regression

Source `7d86697741` plus the accompanying query-cost regression passes full EARS typechecking, 29 shared native query cases and 59 SQLite query/cost/storage-port cases, without deselection. Read-only source overlays use frozen `a9` dependencies and fresh temporary fixture databases; original benchmark database payloads are not touched.

The new regression interleaves 512 entities across two different physical field layouts. It verifies cross-type numeric ordering, a pushed limit, a keyed `SEARCH f USING` plan and absence of the repeated `SCAN f LEFT-JOIN` responsible for the earlier single-type quadratic path. The existing composite multi-type query passes without a runtime rewrite. This is a plan/correctness regression, not a universal large multi-type performance qualification or a new application latency result.

The first baseline launch refuses before testing because its expected manifest incorrectly used current host-source hashes for frozen files. The corrected baseline has one actual passing regression and 26 explicitly filtered cases; the final qualification runs all 59 SQLite cases. Failed launch and both later runs are retained. Compression receipts hash uncompressed bytes; scripts record the resource guard and exact commands.
