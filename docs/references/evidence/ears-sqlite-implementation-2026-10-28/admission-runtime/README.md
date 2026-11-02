# Full-watch admission runtime trace — 2026-10-28

Exactly one preregistered diagnostic ran source `ebf86401a2120c406eba47253b35bddb3b4484c4`:
`node --import tsx packages/apack-ears/bench/sqlite/admission.ts 100000 --search --progress --diagnostic`,
with `EARS_ADMISSION_TRACE` enabling CPU samples, GC observation and 64 ms cgroup counters. The Linux arm64
container retained two CPUs, 6 GiB and the original 300-second deadline. Dependency setup left the lockfile
unchanged; EARS build/types, heartbeat checks and lint passed. The runner, source archive hash, raw output,
CPU profile, runtime trace and analysis are retained here. No production code or workload constants changed.

The diagnostic completed in 94.733 seconds. Admission was 3.869 ms; operation/lookup/turn p99 were
0.999/2.726/2.650 ms, search lookup p99 0.339 ms and independent heartbeat p99 7.076 ms. WAL peaked at
5,434,312 bytes and total files at 163,863,496 bytes, within the original limits. These instrumented results
are diagnostic, not a replacement for the earlier failed qualification cohort or permission to proceed to FULL.

Of 8,632 heartbeats, ten delays exceeded 16 ms: six during build and four during cleanup. There were 445 GC
events totaling 327.968 ms; none overlapped those ten overdue windows. Own-group throttling counters did not
increase. Wider counter intervals and nested operation spans do not establish exclusive attribution or exclude
ancestor/host scheduling effects. The largest delay was 178.769 ms, overlapping a 171.225 ms foreground write;
another overlapped a 20.292 ms watch query. There is no demonstrated cause for those individual long calls.

CPU samples are concentrated around database reads; native leaf frames often have no useful location, so the
nearest located caller is not exclusive SQL execution time. Scalar query dependency tracking already records
membership and queried fields. The benchmark changes `slug` every fourth foreground write, legitimately
invalidating its scalar watch; this is not evidence of unrelated counter writes invalidating that watch.
No new dependency framework or batch/query rewrite is justified by this observation alone.

The better-sqlite3 native SHA is `8ba771f284dfd9430e3ef8e2ffc373ed7cc5a92fc7c4c0c7baf39dd672863485`,
identical to the retained scalar CPU control and full-watch cleanup diagnostic. A changed SQLite binary does
not explain the difference. Profiling, execution conditions and run-to-run behavior remain relevant differences;
this run does not isolate them. The original phase 3 latency acceptance remains open, as do all phase 4–7 gates.
