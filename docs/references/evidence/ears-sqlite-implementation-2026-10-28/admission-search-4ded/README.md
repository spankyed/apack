# Search admission under foreground load

Both search jobs in [run 41249885343](https://github.com/spankyed/apack/actions/runs/41249885343), source `4ded696f7996df36d40486b61bedc34461d972ba`, pass all six 10k/100k fresh-process trials under OFF and FULL durability at 2 CPU/6 GiB/no swap. The matrix keeps three trials, alternating size order and all 56 watches, foreground writes, scalar/substring reads, schema admission/build and retirement. Every recorded admission/operation/read/turn/heartbeat/WAL/file budget passes.

OFF heartbeat p99 is 8.67–12.39ms and foreground operation p99 1.62–1.84ms. FULL is 9.54–11.36ms and 1.86–2.11ms, respectively. Search lookup p99 is 0.25–0.51ms across both cohorts, including explicit building/ready states. Outcome, sequence and settled-watch assertions execute; primary values are not hydrated during admission. These are separate hosted jobs, not a controlled same-host durability speed comparison.

The fixture uses short slug strings, text/trigram admission and three-dimensional pending embedding chunks. It does not provide managed native model training, populated-vector search, semantic usefulness, realistic long-document typing/streaming or full app qualification. The FULL value-job heartbeat failures remain required; search success does not waive them. No fsync policy or budget changed.

The matrices and summaries retain actual numeric outcomes and original report digests. They predate the FTS advisory count optimization. The later runtime diagnostic mode is deliberately one instrumented 100k FULL value trial with CPU profile, GC and cgroup counters, separate from these ordinary three-trial results.
