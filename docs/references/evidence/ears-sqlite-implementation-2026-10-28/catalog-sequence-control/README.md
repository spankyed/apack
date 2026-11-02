# Stable sequence as catalog rowid: unpromoted control

The current runtime stores entity ID as a text primary key, keeps an implicit rowid and indexes the unique insertion sequence separately. This disposable Python SQLite 3.51.0 control compares it with `seq INTEGER PRIMARY KEY NOT NULL`, retaining column order and `id TEXT NOT NULL UNIQUE`. Both variants keep short-code uniqueness and the existing type/admission indexes. Ten thousand rows use sparse sequence values (`3*i+1`), two ID shapes and identical logical data. No application DDL changes.

From the repository root:

```sh
python3 docs/references/evidence/ears-sqlite-implementation-2026-10-28/catalog-sequence-control/control.py
```

The script writes its numeric receipt to `/private/tmp/ears-catalog-sequence-results.json`. It compares exact answers, query plans, VM instruction counts, three alternating timing samples and page-count bytes, then closes its in-memory databases. Timing is diagnostic Python-binding work, not Node/EARS or corpus qualification.

- Catalog bytes: 1,032,192 → 897,024 for numeric IDs; 1,372,160 → 1,236,992 for hash-suffixed IDs (about 13%/10% less).
- Mapping 1,000 owner sequences to IDs: 13,021 → 12,020 VM instructions; sampled medians about 671–679µs → 555–559µs.
- Scoped 1,000-owner lookup: 23,481 → 22,571 instructions; sampled medians improve about 13–15%.
- Point catalog reads stay at 32 instructions and roughly 3.8µs. Fifty-row page reads stay at 310 instructions but sampled medians worsen about 12µs → 18µs. No variance or end-to-end explanation is established for that regression.

Unlike the earlier WITHOUT ROWID control, this removes the separate sequence index without making text IDs the key carried by secondary indexes. It still does not establish an overall win. Before any promotion, qualify ordinary conflict/update behavior, stable ordering and sparse/interleaved sequence restoration, logical/physical copy/recovery, native owner identity, actual query plans, read-only opens and matched app/corpus resources. Format-one layout policy applies; no implicit old-data compatibility would be introduced. Leave runtime unchanged while the text-prefix corpus run is active.
