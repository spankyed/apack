# Read-only updated-copy query attribution

Session88658 completes48normal queries and24explained queries across the two retained updated copies. Every normal id/score matches the completed matrix's final pass; explained ids match normal ids. Both main hashes are identical before/after. Driver readOnly flags, source/input/native hashes and2CPU/6GiB/no-swap bounds are checked. Volume access permits reader locks/sidecars; no trainer, model, primary-data or ANN-parameter change is made. Scripts, raw reports and hash receipts are retained. Vector BLOB parameters are hashed, not copied into evidence.

These are small diagnostic observations after hashing/reading the retained files, not a replacement benchmark, first-access test, p95 estimate or acceptance gate. Each second-pass mean contains only three fixed queries. CPU is process CPU including all threads; explained SQL times include preparation, binding, execution and marshalling. EXPLAIN planning occurs after execution and is excluded from the returned execution time. Normal hits and explained ids are different terminals, so do not subtract their timings to invent transport overhead.

| Updated cohort | SQLite wall/CPU ms | Native wall/CPU ms |
| --- | ---: | ---: |
|1k/10%|9.24/9.71|1.43/2.38|
|10k/1%|3.71/4.48|8.52/8.54|
|99.9k/all|24.86/24.88|12.89/12.92|
|99.9k/10%|57.63/57.64|37.84/39.42|

The warmed observations support substantial CPU-side cost, not exclusively filesystem stalls. For query0 at99.9k/all, SQLite's eligibility probe takes3.12ms, native virtual-table candidate SELECT17.54ms and exact rerank3.67ms. At10% they take11.34/30.32/11.58ms. These are whole SELECT timings, not a native-kernel profile. Metadata checks are individually small. The earlier1002s admission remains dominated by its separately measured990scommit calls; this read-only probe cannot fix or reclassify that result.

For1k/10%, the eligibility/exact statement takes7.34ms;10k/1% takes2.80ms. Their scopes contain nested catalog/field-index CROSS JOIN chains, with the final equality filter driving the generated order. SQLite documents that[CROSS JOIN constrains join reordering](https://www.sqlite.org/optoverview.html#manual_control_of_query_plans_using_cross_join). That is a plausible plan/selectivity issue, not proof that removing the fences is safe or faster. The next scoped test should compare planner-led joins and statistics on an owned copy, preserving every answer and other execution fences, before changing production code.

Native query0 at10k/1% spends4.54ms in its first indexed filter (10000visited),3.58ms in its next filter (9886visited) and.36ms in near. This explains a selective-query win without claiming a generally better ANN. Native stage counters are not HNSW internal distance-evaluation counts; SQLite returnedRows are not rows visited. Both original full-matrix failures remain. No parameter sweep or adoption disposition is selected by this diagnostic.
