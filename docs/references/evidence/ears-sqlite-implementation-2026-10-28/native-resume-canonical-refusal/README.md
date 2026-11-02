# Native resumed-copy canonical refusal — 2026-10-31

Session9516 is terminal failure. At sourcea9c9340df7 with exact native2441 artifacts,
the protocol verifies the preserved snapshot hash, creates a new private compacted CLI
backup and opens only that copy. Before adding embeddings or changing rows, the initial
framed-dump canonical-byte check refuses a vector mismatch. It never reaches pending
embedding completion, canonical initial/update acceptance or the7200-query matrix.

The original snapshot's main-file hash is unchanged after refusal:
0fe282f82d18121c62f2828867099dedac26be67d30327b65f30b851ab5a1d00.
The private copy remains at/electron/.temp/ears-native-resumed-a2D0Vp/database for diagnosis.
No corpus, database payload or native binary is committed. The failed check is not
relabeled passing, and the interrupted fresh-ingestion matrix remains incomplete.

The [completed read-only diagnostic](../native-zero-sign-diagnostic/README.md) checks all72000
retained embeddings and finds exactly three signed-zero changes, no other component
differences, with unchanged main-file hashes. The actual transport codec independently
reproduces that loss. This explains the failed check without passing its byte-identity
gate or repairing data. See the exact report and samples before continuing comparisons.
