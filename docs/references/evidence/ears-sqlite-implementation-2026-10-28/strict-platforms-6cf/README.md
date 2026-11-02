# Three-platform SQLite EARS failures at 6cfdf32dad

[Strict run 41236766386](https://github.com/spankyed/apack/actions/runs/41236766386) has completed its three SQLite platform jobs. Linux and macOS each pass 846 of 848 EARS cases with two failures and no skips. Windows passes 842, fails two and skips four POSIX FIFO-only cases.

Both failures are the retained text-only `generate-entries` overview usefulness judgment and the stale assertion that K=33 must remain exact after the deliberate K=64 routing extension. The latter is corrected in later source to require native K=64 and exact K=65; these failed jobs do not prove that correction. The relevance judgment is unchanged and unwaived.

The formerly skipped killed-process search-cursor case actually runs and passes on Windows, Linux and macOS. Its child commits a cursor, is killed before readiness, and the parent reopens and finishes indexing. This closes the Windows execution gap for that recorded revision; it is neither physical power-loss nor arbitrary filesystem certification.

`summary.json` contains inspected terminal counts, exact failed test names, individual cursor-witness disposition and raw log digests. Original logs remain in CI and private local evidence. Platform job failure prevents subsequent host/CLI/operational steps from qualifying, and this source predates the latest reference/subscriber/type-discovery changes. Producer success and live consumer shards are separate checks; no final broad pass is inferred.
