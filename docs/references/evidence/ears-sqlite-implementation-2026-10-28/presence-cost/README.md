# Presence-pruned default typo growth — 2026-10-29

The follow-up protocol was committed before execution in a2de2944a1. Source pins are scan e452d67ae1,
presence a2de2944a1 and unpruned 9beb23ebc9. Fixed order is **scan / presence / unpruned / unpruned /
presence / scan**, six fresh processes, each running fresh 1k/10k/100k profiles. The identical committed
0ba7b955b8 fixture runs through normal built entries with default fuzzy enabled and OFF commits. All
2340 timed requests pass their fixed answer/highlight checks. No sample/trial is discarded or retried;
every process completes within its unchanged 180-second bound. Source/fixture/archive hashes, actual
loaded-JS hashes, native hashes, raw stdout/stderr, plans/binding observations and all samples remain.

One owned disposable Linux arm64 container uses two CPUs/6 GiB and dropped capabilities. Three source
trees have independent dependencies/output and byte-identical checked-in lockfiles after acquisition.
Syntax/lint pass. Paired actual text.js and native identities match for each strategy; all strategies
load the same SQLite addon and MessagePack extractor. This compares SQLite revisions, not elmdb.

## Costs, including native presence probes

Warm median ranges across each strategy's two processes, milliseconds at **100k**:

| Path | Original scan | Rejected unpruned | Presence correction |
|---|---:|---:|---:|
| Exact word | 143–144 | 13.9–14.6 | 3.3–3.5 |
| Deletion typo | 138 | 12.5–12.8 | 3.1 |
| Maximum eligible token | 43–44 | 47 | 9.9–10.3 |
| Literal phrase | 42.8–43.2 | 0.12 | 0.14–0.16 |
| Broad word | 294–299 | 1279–1280 | 164–166 |
| Selective highlights | 144 | 26.8–27.4 | 3.5–3.6 |

The correction resolves the empty-branch regression and keeps selective request work largely independent
of unrelated vocabulary size. It does not eliminate posting/ranking work: broad 100k p99 is still
**167–168 ms**, and at 10k broad medians are **18.8–19.3 ms**. Original first-invocation and warm samples
remain separate; backfill/prior reads warm the OS/database cache, so these are not cold-storage results.

Small profiles regress against the original scan: at 1k, exact words **1.8–2.0 → 2.6–3.0 ms**, broad words
**3.0 → 4.7–5.2 ms**, maximum-length tokens **0.53–0.55 → 7.6 ms**. At 10k, maximum-length tokens
**4.2–4.5 → 9.7 ms**. This is the bounded generation/probe cost; do not present large-corpus gains as a
universal win. Its impact needs the representative app, multiple-type, language and real-corpus budgets.
The implemented architecture removes full vocabulary enumeration; whole performance acceptance is open.

At 100k, main-file bytes are roughly **76.5 MB** for all three strategies. Presence's process maxRSS is
**232 MiB**, original scan **297–302 MiB**, unpruned **233 MiB**; these are observed cumulative process
peaks across all three profile sizes, not proven memory bounds or independent per-profile peaks. WAL
endpoints differ across paired runs and every file observation is retained; no causal explanation is
inferred. These diagnostics do not close phase 3's failed 100k admission/FULL gate, real search/vector
usefulness/recall, cold-store/durability or complete app/packaging acceptance.
