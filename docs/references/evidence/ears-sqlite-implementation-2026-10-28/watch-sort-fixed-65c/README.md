# Actual watch settlement after keyed scalar sorting

The 20k-task/five-second SQLite watch pilot was repeated with numeric ordering from `65caaa962d`, over otherwise verified frozen `a9` source inputs. The benchmark uses source imports via tsx here; the earlier pilot used built imports. This is a post-fix diagnostic, not an exact compiled-runtime performance qualification or repeated variance study. Its raw runner retains an inherited "built frozen runtime" description; input hashes, mounted numeric source and source-import benchmark provide the actual provenance.

Both durable and default cases converge. The ordered view averages 46.87 / 45.67 ms per read, and final settlement takes 45.1 / 3.9 ms respectively. The earlier built-runtime pilot averaged about 4.1 seconds per ordered read with about 15 seconds of settlement. This supports the diagnosed join fix, while the ordered read is still longer than a 16-ms frame budget. No original acceptance gate is declared passed.

Synchronous durable writes remain costly on this external Docker storage: event-loop maximum 327 / 1017 ms for these two cases. Default SQLite remains FULL per commit; this change does not relax durability. Fresh temporary databases only; original benchmark data is untouched. Compressed raw reports/logs/scripts and hashes accompany this note.
