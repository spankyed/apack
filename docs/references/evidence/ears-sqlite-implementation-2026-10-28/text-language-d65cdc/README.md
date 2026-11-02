# Explicit English stemming evaluation at d65cdc8bd5

[Actual language trial 41241587713](https://github.com/spankyed/apack/actions/runs/41241587713/job/124658453394) executes all 100 combinations: 25 frozen top-five/highlight judgments, two adapters and two language configurations. All four private database removals are witnessed. Fields/weights, queries, expected documents and cutoffs remain unchanged; the original unstemmed gate still fails.

Each configuration passes 24/25. Without stemming, both miss ordinal 6 (the generated-files overview for `generate-entries`). With English stemming, elmdb passes that case but misses ordinal 20 (the transposed identifier `mockInfernece`); SQLite still misses ordinal 6. English stemming therefore does not resolve the complete usefulness target and is not promoted as the production default.

The same job independently rechecks hybrid usefulness with its pinned local English model: all original 25 judgments pass on both adapters. That does not waive the text-only failure or establish production-model/UI acceptance.

`numeric-cases.json` retains inspected ordinal/outcome/timing data and configuration/provenance; `receipt.json` retains independent coverage/count validation. No source text, source document IDs, embedding vectors or model weights are copied. The successful diagnostic job means complete experiment execution and preserved outcomes, not that every configuration meets acceptance. This small English corpus does not certify stemming/segmentation or usefulness in other languages.
