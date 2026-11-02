# Corrected small-graph SQL diagnostic

Actual emitted SQL passes 864 seeded graph/direction/scope/measure comparisons using host Python SQLite 3.51.0. Repeated/overlapping kinds deduplicate neighbours; trash-only starts restrict candidates while later steps reach both live and trashed entities. Candidate sets and 12-decimal scores match the independent set reference; actual ordering and exact-tie order are checked. Captured SQL, seeded recipe and result are retained. This is not pinned better-sqlite3/Electron execution, full watch/app qualification or a performance result.
