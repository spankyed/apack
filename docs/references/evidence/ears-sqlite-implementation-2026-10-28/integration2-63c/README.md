# Exact-source integration shard failure — 2026-10-30

The integration-2 job (124393532944) in [strict run 41151679157](https://github.com/spankyed/apack/actions/runs/41151679157)
fails at source `63c8267994c611bdbf9dbe30e161ba18c949513c`. The final run is terminal failure: the other eight required jobs pass and six alternate jobs skip. This is not
full strict acceptance. Its actual integration summary has 540 passed tests, six skipped and one failed suite.
Five skipped tests belong to the failed setup hook and are **not** intentional platform acceptance.

`packages/apack-cli/tests/build/dependency-graph.integration.spec.ts` exceeds its existing 240000-ms
beforeAll budget, which builds the four diamond packs before its five assertions run. The remaining
29 files pass. The raw job, original chain output and per-spec progress events are preserved. The current
helper captures console output inside each build, so the failure does not identify which build/stage was
still active. No SQLite/native cause is established by this timeout.

A diagnostic-only source change emits start/end boundaries directly to stdout for the same four builds,
retaining their order, all assertions and the original hook deadline. The next check is a focused Linux
observation in the owned bounded container, then affected Mac qualification/causal correction. This is
observability, not a product fix or permission to raise a deadline. Earlier unexplained compiler timing
failures remain separate evidence; do not retroactively mark them fixed.

The phase-marker change passes focused repository oxlint (zero warnings/errors) in a read-only container
requested at 0.5 CPU and 768 MiB. This is a static check, not a reproduced or fixed build-timeout claim.
