# First paired real hybrid execution

[Run 41229505453](https://github.com/spankyed/apack/actions/runs/41229505453) succeeds at b95b0ed195. SQLite 3.53.4, FULL=2, first 1,000 real paired documents, all 100 held-out title/vector queries: all fusion membership/order/score checks pass. Warm p50 5.84ms, p95 8.08ms, p99 9.02ms, max 10.78ms. These are uncapped disposable-runner samples after reference reads, not cold or resource-budget qualification.

Only three titles produce lexical matches in this prefix, so most cases do not exercise both rankings. Corpus-derived lexical coverage controls were added subsequently and need actual qualification. Later bounded-input, candidate-scope and heartbeat changes are also absent from this source. This is neither semantic relevance evidence nor full-corpus qualification.

The report contains numeric samples and source/manifest metadata only. Actual private scratch removal passes; no source text, dataset IDs, vectors or database files are published.
