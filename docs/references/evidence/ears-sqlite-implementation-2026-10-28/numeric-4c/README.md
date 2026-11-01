# Existing cosine numeric compatibility at 4c

[Run 41313426805](https://github.com/spankyed/apack/actions/runs/41313426805) passes at `4c721658552c1093de291edfa7dccb56bf4ef06c`. Both generic Scalar and diagnostic AVX2 execute sixteen actual-driver cases with zero failures/skips: the nine existing training/ownership/checkpoint cases and seven cosine compatibility cases at dimensions 1,3,7,8,127,128,1536.

The numeric cases compare public fallback queries and direct vec1 SQL over the same actual persisted canonical/safe projections with independent Float64 cosine. They include opposite/cancellation-heavy directions, scaling ties, tiny/subnormal/huge finite Float32 values, and unchanged canonical bytes/commit identity. Both functions stay within 1e-5 of the reference. Native model and membership controls also pass in this workflow. Source/test typecheck and targeted test lint pass.

This source predates selecting vec1 in the public query implementation. It qualifies the existing kernels over these inputs, not the newly prepared connection-aware scorer, all supported platforms, exact bitwise scores, full-corpus recall or end-to-end responsiveness. The updated public-path SQL witness and complete corpus/platform checks remain required before keeping that optimization. Diagnostic AVX2 is not the ordinary packaged build.

Three explicitly inspected fixture test/runtime reports are retained unchanged through gzip with original byte lengths/hashes. They contain known test outcomes and native/build metadata; no input vectors, databases, binaries or private corpus payload is copied. Remaining logs/provenance and repeated synthetic timing reports stay in CI/private download. No new performance ratio is inferred from this run.
