# Master rebase — 2026-10-31

At the user's request, the candidate is rebased from master dc67febcce onto
master e3d1a37d5c. The pre-rebase checkpoint is 353eb42255, retained by
refs/checkpoints/ears-sqlite-before-master-rebase-20261031. Result 45180293a3
preserves the complete checkpoint runtime, tests, evidence and native pin.

The final tree differs only by master's root CLAUDE.md, docs/README.md and
new Docker storage guide. Identical packages subtree IDs independently prove
runtime/test identity. Replaying historical merges required restoring the
reviewed edge-direction resolutions and their native evidence; those restorations
are committed, and the final comparison verifies no runtime change from the checkpoint.

The checkpoint includes an untested prefix prototype. Rebase identity does not
qualify it. A guarded prefix run is queued separately against 45180293a3; its
baseline runtime and committed prototype inputs are separately identified. The
existing frozen source volume differs from current production inputs only in
text.ts, whose pre-fix behavior is deliberately retained for the negative control.
No existing failure is relabeled passing and no native/corpus/model payload is
copied into Git. Historical evidence retains its original commit identifiers.
