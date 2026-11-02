# Corpus preflight refusal and repeated hybrid usefulness

[Run 41292503955](https://github.com/spankyed/apack/actions/runs/41292503955), source `ed7a3cb3fccb685091dd9c457ba32fe943e5634a`, is terminal failure. Corpus preflight passes 20 of 21 actual-driver cases with no skips; all three text-scope and all thirteen replacement-outcome cases pass. The vector streaming test expects 4,098 scope visits after excluding a randomly generated owner, but observes 4,097. It assumed that owner appeared inside an unordered early-exit prefix. No private real-corpus acquisition, timing or new resource measurements execute after that failure.

The corrected test counts whether the excluded owner was actually visited: the exact bound remains 4,097 eligible chunks plus at most that one excluded owner. It also checks actual exclusion answers in the ordered 20-owner prefix. No runtime vector policy, query answer or resource budget changes. New actual-driver execution is required; do not claim this test correction is already qualified.

The independent relevance job succeeds. Both engines pass all 25 original hybrid judgments/highlights against the frozen 214-section fixture and pinned English MiniLM model. All four keyword-only configurations (two engines × none/English stemming) still pass 24/25. The keyword requirement remains unmet; hybrid success does not waive it. That job verifies private scratch removal. This is model-specific usefulness, not production-provider, actual UI or large-corpus resource acceptance.

Compressed original numeric reports/logs/source and decompressed SHA256 hashes are preserved. Reopen harness additions made after this source are not exercised here.
