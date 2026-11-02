# Three-platform history-policy qualification

[Run 41371206316](https://github.com/spankyed/apack/actions/runs/41371206316), source `81e8ab4fe5be727872e36de5853fc49fe5a9e70e`, completes all Linux/macOS/Windows candidate jobs. This source includes the host policy correction refusing automatic history replacement after generic SQLITE_CORRUPT. All three jobs remain failure because complete EARS still fails the frozen keyword judgment; no gate or requirement was relaxed.

| Platform | EARS pass / fail / exclude | Host pass / fail / exclude | Recovery pass / fail / exclude |
| --- | --- | --- | --- |
| Linux x64 | 930 / 1 / 0 | 313 / 0 / 0 | 12 / 0 / 0 |
| macOS arm64 | 930 / 1 / 0 | 313 / 0 / 0 | 12 / 0 / 0 |
| Windows x64 | 926 / 1 / 4 | 310 / 0 / 6 | 2 / 0 / 10 |

The new named generic-CORRUPT refusal case passes on every platform. Existing eligible NOTADB quarantine and managed-reader exclusion cases also pass; the exclusion test now injects the remaining eligible NOTADB diagnosis rather than an ambiguous CORRUPT diagnosis. All eight native-readiness regressions pass on each OS. The actual main-thread EIO/preservation regression is a separate focused run; these host routing cases do not replace that physical syscall witness.

Original EARS, host, recovery and numeric verification reports are gzip-preserved with decompressed SHA-256. The receipt explicitly checks the new refusal/remaining eligible path and actual source; verification reports preserve each platform's named native/membership/CLI/conversion/publication coverage. The verifier writes its numeric report before rejecting the unchanged relevance failure. A completed verification report is not evidence that complete acceptance passed.

The strict producer passes at this same source; its consumers are still live/queued at this checkpoint, so no complete strict result is inferred. Earlier source-app/installed/signing evidence predates this host-policy repair and remains insufficient for final-source adoption. The later cold-reopen recipe and additional named platform guard are test/CI changes; this run does not execute that cold recipe or prove a cold-cache performance result. Normal production composition remains elmdb.
