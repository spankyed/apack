# Independent-reference fallback corpus checkpoint

[Run 41322494663](https://github.com/spankyed/apack/actions/runs/41322494663) completed successfully on source `a9027400bf051cd301304dc46471c0a2fb8979c9`. Workflow success is diagnostic completion, not full acceptance.

The original numeric matrix is retained unchanged as `hybrid-matrix.json.gz`; its decompressed SHA-256 is `cd521fa5b7b9533f4e3ca88a122807b04a9522baa29e69bcfd666655cbf712cd`. No corpus payload, per-document judgments, credentials, profiles or database files are included.

All 1,800 queries used independent Float64 canonical-f32 reference rankings. Mean recall at the tested depths is at least 0.97390625 (target 0.95); all measured query p95 targets pass (100 ms at 10k, 200 ms at 99.9k). Eight groups exceed the unchanged 16 ms heartbeat target. At 99.9k, all-live lexical/held-out query p95 is 131.44/116.83 ms and heartbeat p99 is 153.15/143.91 ms. These are warm diagnostic timings, not app responsiveness certification. The producer reports Intel Xeon Platinum 8573C under 2 CPU/6 GiB/no-swap limits; this is not a matched causal comparison with earlier AMD managed-model runs.

The separate `qualification.json` describes source pairing only. The actual hybrid matrix explicitly retains `qualification: false`. Managed-model, app/resource and relevance requirements remain separate.
