# Recovery and global fusion regressions executed

[Run 41231033451](https://github.com/spankyed/apack/actions/runs/41231033451) at 7347dbdfc0 passes the new recovery and fusion regressions. SQLite passes 154/155 tests with no skips; elmdb passes 135/136 applicable cases, with 19 intentionally SQLite-only archive cases skipped. Both fail only the unchanged generated-files overview relevance judgment.

Actual SQLite cases cover orphan-heavy spool refusal, duplicate/invalid relation sequences, physical-store collision audit, export collision refusal and scratch cleanup. Both backends pass global vector K/RRF scores and hybrid lexical-highlight preservation. Later cross-type like and bounded-window changes are absent from this run and remain unqualified. Production/API/core, syscall acknowledgement-loss and inventory checks also pass. This is focused evidence, not full app/strict/platform or performance acceptance.

The numeric summary identifies every file's actual executed/skipped counts and raw report digests. Original reports remain in the workflow artifacts and private local download; no unreviewed raw subtree or private corpus is published.
