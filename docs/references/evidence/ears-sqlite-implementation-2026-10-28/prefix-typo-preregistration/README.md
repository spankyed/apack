# Prefix and typo usefulness preregistration — 2026-10-30

Recorded before changing implementation at source `423ad1fa57c44c25eb44d2f1cb0337b4a186a9ae`.
The actual threads-panel repository uses `search(text, {prefix:true,recency:...})`. Candidate
`src/sqlite/text.ts` currently suppresses all alternatives for the final prefix term, including explicit
fuzzy:true. A single-word typo therefore cannot benefit from the candidate's default correction on this
app path. The existing candidate-specific test explicitly expects that omission; this is a current design
restriction to reconsider, not a claim that it was an untested accidental code change.

The pinned elmdb source 2441af4658 `text/search.rs:expand` adds literal prefix matches and independently
adds fuzzy whole-word alternatives. This is source inspection, not newly executed differential evidence.
The goal requires useful typo behavior and representative app paths; the new cases strengthen that outcome
without restoring a dictionary scan, two-edit expansion, or exact score/rank compatibility.

Four shared useful-result cases and one lowercase lookalike document are fixed before implementation:

- A prefix-enabled default search for databse must find the existing Database recovery checklist.
- Explicit fuzzy:true plus prefix:true must do the same.
- Explicit fuzzy:false must retain the absence of typo correction.
- The literal prefix datab must still reach the longer single token databaseserver.

The typo cases forbid databaseserver. Typo alternatives should be whole-word matches; appending a wildcard
to every generated alternative would create a different and broader fuzzy-prefix contract. Quotes remain
literal, and the existing 5–32 ASCII/digit one-edit/transposition and query-work limits remain. The original
32 judgments and 28 documents are unchanged, including all ranking/highlight/phrase/language requirements.
The fixture now has 29 documents and 36 judgments. Its digest and structural checks are retained.

No new case has executed yet and no production search code changes in this checkpoint. Next: run the
shared corpus on both pinned implementations, preserve the existing candidate failures, implement native
prefix plus bounded exact alternatives, reconcile the prior candidate-specific expectation and storage
plan, then run affected search/model/recovery/types and growth/latency checks. Do not call a semantic fix
accepted without its cost on the actual prefix-enabled app query. The live native real-vector matrix and
queued I/O diagnostic keep their frozen source inputs; do not mutate their volume to run these checks.
