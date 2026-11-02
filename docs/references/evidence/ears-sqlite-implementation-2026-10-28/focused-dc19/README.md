# Focused shared contracts at dc19e4ecd2

[Actual run 41236449413](https://github.com/spankyed/apack/actions/runs/41236449413) failed only the unchanged `generate-entries` top-five overview relevance judgment on both backends. SQLite passed 182 cases with one failure and no skips; elmdb passed 149 with one failure and 33 SQLite-only skips.

The SQLite text-scope binding guard passed on the actual adapter: a five-result page over 256 eligible rows never returned more than five rows in a statement. The selected shared search/vector, graph, observation and SQLite index-build cases also ran. These results predate the mixed-type scope correction and do not establish full app, performance or platform acceptance.

`summary.json` retains inspected counts, failed test names, the page-size guard outcome and original report SHA-256 values. Raw reports remain in the CI artifact and the private local evidence directory; compiled outputs and payloads are not copied into this folder.
