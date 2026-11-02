# Empty-branch native FTS cost — 2026-10-29

The full default-fuzzy growth cohort rejects unpruned alternatives at 9beb23ebc9. These follow-up
diagnostics keep that production runtime unchanged, reuse the committed growth fixture with explicit
temporary patches, and run only one fresh 10k profile. Every actual native row **and score** must equal
the original result. Syntax/lint, original useful-answer cases and counterfactual equality pass. Each run
uses one disposable Linux arm64 container, two CPUs/6 GiB, the same read-only dependency seed/native pin
and the unchanged 180-second process limit. All source/fixture hashes, patches, reports and logs remain.

## Isolated effect

For the broad word, the captured MATCH expression has 756 alternatives; native presence finds one.
Across full/pruned/pruned/full order and ten samples per leg, unscored native match-count median changes
**26.9 → 0.58 ms** and the actual scored limited facade SQL **137.3 → 15.4 ms**, preserving exact native
rows/scores and the same 10k match count. For the maximum eligible token, 2340 alternatives reduce to one;
unscored count **23.1 → 0.013 ms**, scored SQL **40.0 → 0.062 ms**. This isolates redundant native MATCH
branches as a major cost. Both unscored traversal and scoring are affected; do not attribute all of it
to BM25 alone, primary-row hydration, GC or host scheduling.

The first native presence oracle binds the generated expressions through json_each and a correlated
FTS MATCH EXISTS. Its actual plan is a virtual MATCH index (`M6`), not vocabulary enumeration. One oracle
invocation costs about 7 ms for the broad term and 18 for the maximum token, so pruning itself must be
included in subsequent end-to-end measurement; the counterfactual timings above exclude that setup.

## Alternative checked, not selected

[SQLite's FTS5 vocabulary interface](https://sqlite.org/fts5.html#the_fts5vocab_virtual_table_module)
reads the existing native index. A temporary col view permits bounded term-equality probes without
copying a dictionary. On this nonstemmed fixture, both correlated EXISTS and a term-IN batch agree with
the native MATCH oracle. Median point lookup is about **3.6 / 8.1 ms** (broad/max token) for correlated
EXISTS and **3.6 / 9.0 ms** for IN. There is no demonstrated speedup from the IN rewrite. Retained VM
bytecode confirms its single vocabulary cursor; pinned installed SQLite 3.53.4 source identifies the
term-equality planner flag seen in the actual plan (259 includes 0x100). This is evidence for a constrained
lookup, not permission to enumerate vocabulary or access FTS shadow storage directly.

Raw-word membership is not equivalent to native MATCH when Porter stemming is active. Rather than
add a persistent vocabulary view and a second tokenizer-dependent pruning path now, the chosen next
correction uses one native MATCH-presence path for all indexes, with a column-set phrase over body/aliases.
Generated alternatives are ASCII words; native tokenization/stemming decides whether they match. Empty
branches are removed in the same request snapshot, retaining original alternative order. No exact-first
fallback or scope-dependent spelling decision is introduced. A new full growth cohort must include
the pruning cost before any improvement or resource acceptance is claimed.
