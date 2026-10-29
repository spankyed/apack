# Int8 candidate counterfactual

Protocol and first driver were committed before execution at a75f1f3ceff1e66f894a1af6e1ee17413ae887aa. No production or dependency change is included. The first setup omitted package builds; the import checker could not resolve the SDK dist, and no vector measurements ran. Adding that prerequisite passed builds/lint/imports, then the tiny transaction control refused a vec0 rowid bound as a JS number: the virtual table requires an integer SQLite binding. Both outcomes and exact source/archive identity are retained.

The corrected driver binds virtual-table rowids, boolean metadata and k explicitly as BigInt, preserving the fixed 64 candidates and all thresholds. It also records the extension hash while a database is open: collecting loaded libraries only after close can miss a library unloaded by SQLite. This is a diagnostic provenance correction, not an extension failure. Raw failures remain unchanged. No corpus profile has yet run.
