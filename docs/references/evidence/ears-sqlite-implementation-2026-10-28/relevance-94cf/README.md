# Independent relevance replay on the final candidate runtime

The relevance job in [run 41413055256](https://github.com/spankyed/apack/actions/runs/41413055256), source `94cf2eeac6208c6022865b5d7e5bf513935a6080`, succeeds. Both backends again pass all 25 frozen hybrid usefulness/highlight judgments. All four keyword groups (elmdb/SQLite, none/English Porter stemming) remain 24/25, without exclusions or a waiver. Workflow success is diagnostic completion; it is not passing keyword acceptance.

Fixture, embedding-vector and pinned English MiniLM revision hashes match the earlier b989 relevance evidence exactly. The independent inference replay still truncates 141 of 239 inputs at 256 tokens. This supports repeatability of this one model/fixture, not model/provider/language generalization or performance. Private fixture/model-cache cleanup is verified. Both maintained validators reproduce the original summary receipts byte-for-byte on the downloaded reports.

Seven original numeric reports are gzip-preserved with decompressed SHA-256. No text, vectors, source IDs, models, profiles, database files or installation/acquisition logs are published. The separate corpus job in the same workflow is not covered by this relevance receipt.
