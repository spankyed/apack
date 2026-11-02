# Original keyword miss: exact ranking diagnostics

[Run 41460757710](https://github.com/spankyed/apack/actions/runs/41460757710), source `4566270bf78e8d9290c92ff46f197e4fbdbeca25`, retains the unchanged frozen fixture and original thresholds. All four backend/stemming configurations remain 24/25. Unlimited ranking agrees with each limited prefix, ruling out a pagination-only failure for these misses.

The missing generated-metadata overview (case 6) is rank 13 on unstemmed elmdb, rank 9 on unstemmed SQLite and rank 11 on English-stemmed SQLite. It is retrieved, not absent; its command mention starts at UTF-16 offset 21 in a 4,183-character body. Both unstemmed backends return 13 matches. The SQLite query compiler treats an unquoted punctuation-separated compound as one FTS phrase, so it cannot combine its component matches across title/body fields. Explicit quotes should own adjacency; a regression fix and old-source controls are being qualified separately.

Crucially, English-stemmed elmdb passes the generated-metadata judgment. Its one failure is case 20, the transposed test API identifier, which returns no hits. Aggregate 24/25 counts alone hid this distinct analyzer/fuzzy failure. No claim is made that all four configurations fail the same case, or that fixing the SQLite compound bug alone fixes every original judgment.

Two original numeric reports are gzip-preserved with decompressed SHA-256. Their diagnostics contain ranks, scores, string lengths and offsets; no source bodies, document identities or query payloads are published. This receipt diagnoses the old runtime, not a passing relevance fix.
