# Compact-IN candidate qualification — 2026-10-30

Source `63c8267994c611bdbf9dbe30e161ba18c949513c` promotes the exact allocation-free compact-IN
implementation from the [full equivalence matrix](../direct-in-full-matrix/README.md).
Runtime, build and platform pins agree on generated C `04043ede29b2998b2cd0e7735cc696dba2158554a0bf9036e2a77849dec0425a`
and patch `d76fba22be9c09fe5c7d865999e608b5896f051c19811d41fd0e547ce6efb3f5`.

The three completed SQLite platform jobs in [strict run 41151679157](https://github.com/spankyed/apack/actions/runs/41151679157)
pass at this exact source. Downloaded reports independently verify 735 membership comparisons each,
15 groups of 49, matching packaged binary provenance and complete EARS results: Linux x64 and macOS arm64
762 passes with no skips; Windows x64 757 passes with five explicitly named platform skips. These skips
are listed in `summary.json`, not counted as passes. Original reports also preserve host, logical CLI,
conversion, process-kill and Linux SDK/API lifecycle evidence with their actual coverage boundaries.
This evidence does not claim that the five downstream strict consumer shards have completed.

[Signed installed run 41151681981](https://github.com/spankyed/apack/actions/runs/41151681981) passes
at the same source on macOS arm64: six actual cases, no skipped/unexpected/flaky results or retries,
including both SQLite stores and process model claims through the installed API. Before/after-signing
smoke verifies the new source/patch pins, worker training, native queries and read-only reopen. Signing
records the changed library hash and refreshed provenance, with Developer ID authority and sealed app
verification in the original log. This qualifies these six cases, not every app flow or architecture.

The capped Linux arm64 local package run separately builds the ordinary package, reproduces the tested
candidate binary, passes all 735 membership controls and a fresh public-API owner/train/query/read-only
reopen probe with default FULL/checkpoint policy. Its subsequent EARS suite **fails**: 761 pass, one
30-second text-prefix timeout and one worker RPC timeout. The protective guard records a roughly
1053.7-second pause during that suite. This explains the overlap, not proof of a product fix; preserve
the failure and unchanged deadlines. Typecheck/lint later in that pipeline were not reached. Independent
platform EARS passes are separate evidence and do not relabel this local run. No automatic retry occurs.

Lossless reports/logs and hash receipts are retained without database, model, corpus or binary payloads.
The broader source-app run and strict consumer shards must be inspected independently. All original
responsiveness, representative relevance, sustained-load/recovery/durability and adoption requirements
remain open. Production stays elmdb; this is candidate qualification, not backend adoption or a release.
