# CI lifecycle wait correction — 2026-10-28

Strict run [40676231748](https://github.com/spankyed/apack/actions/runs/40676231748), at implementation
`6c29f083f3`, is terminal **failure**. Producers, both native shards and integration-2 pass. App-and-rest passes
5,960 host tests but fails the repository's unaccounted-bare-wait guard on the new lifecycle test's 80 ms sleep.
Integration-1 is canceled at its 60-minute limit; GitHub's check annotation explicitly says the job exceeded
1h0m0s. Neither result is a green integration gate; the obsolete source will not be retried as acceptance.

The lifecycle test now awaits `watchesSettled()` after close. All four lifecycle cases pass in private Linux;
this replaces a guessed delay with the completion signal the assertion needs. The repository wait guard's four
cases also pass through its normal npm pretest, which rebuilds the five published packages in that disposable
checkout. The first private dependency copy omitted workspace-local modules and selected the root Ajv version,
so SDK preparation failed before the guard ran. A complete private copy including each workspace's node_modules
resolves that preparation error without an SDK source change. Both logs are retained.

## Exact Node toolchain caching

The integration shard's setup-node log spends approximately 30 minutes downloading Node 23.11.1 directly from
Node, after the version is absent from setup-node's manifest. App-and-rest also spends about 31 minutes there.
The timeout happened after this setup consumed half the job budget; no compiler/test timeout was increased.

Strict-chain now uses the local `node-runtime` composite action: restore the exact version directory with a key
including OS/architecture/version, run the existing setup-node with the same version and npm cache, then retain
the downloaded toolchain immediately. The entire version directory includes its architecture's `.complete`
marker. Saving before tests lets consumer jobs reuse a producer's completed download even if a later step fails.
There are no prefix restore keys, and the Node version remains 23.11.1. The cache does not contain test outputs.

The workflow/action YAML parses and both workflow call sites retain the original version. Cache restore/save
inputs were checked against the [official restore](https://github.com/actions/cache/tree/v4/restore) and
[save](https://github.com/actions/cache/tree/v4/save) actions. Actual cold-save/warm-restore behavior remains to be
verified by the fresh exact-source gate. Do not report this metadata check as an operational cache pass.

Remote and local master still pin `98386b36a1`; native source remains isolated at `6ab2f69`. The next gate must
cover the new candidate, including the watch wait fix, measurement correction and batched ordering. Canonical
promotion remains conditional on that gate.
