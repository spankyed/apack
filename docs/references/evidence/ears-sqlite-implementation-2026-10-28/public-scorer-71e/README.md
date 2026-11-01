# Public cosine selection at 71e

[Run 41314880633](https://github.com/spankyed/apack/actions/runs/41314880633) passes at `71ef19b1eedb70a6c17cc71516e9208abaa95056`. Generic Scalar and diagnostic AVX2 each execute sixteen actual-driver cases with zero failures/skips, including the updated seven numeric cases and nine worker cases. Source/test typecheck and targeted test lint pass. Existing membership and persisted-model controls also pass in the workflow.

Unlike the earlier 4c cases, these observe actual public SQL selection: fallback queries execute sqlite-vec, then the same connection loads the trusted vec1 artifact and public queries execute vec1. Both public results and direct native scores stay within 1e-5 of independent Float64 cosine across dimensions 1,3,7,8,127,128,1536, subnormal/huge magnitudes, opposite/cancellation-heavy directions and scaling ties. Canonical bytes and logical commit remain unchanged.

This qualifies the conditional selection on this Linux runner, not final-source macOS/Windows, full-corpus recall, query latency, total app responsiveness or all durability/resource/fault conditions. Ordinary artifacts remain generic. Three explicitly inspected fixture/runtime reports are retained unchanged through gzip with original hashes/lengths; no vectors/databases/binaries/private corpus payload is copied.
