# Native canonical signed-zero diagnosis — 2026-10-31

The read-only diagnostic completes at exact native2441 on the preserved private clone.
All72000 retained1536-dimensional vectors are checked component-by-component against
original corpus bytes. Exactly three vectors differ in one component each:Row-002260[1404],
Row-018320[1437],Row-065821[788]. Expected bits80000000 (-0) became00000000 (+0).
There are no other component differences. Both main-file hashes match the original
preserved snapshot digest before/after the diagnostic. No data is normalized or repaired.

An independent control with the adapter's actual msgpackr settings encodes[-0] as9100
and decodes+0. The pinned dependency ismsgpackr1.11.9. Source inspection of the native
adapter shows that encoder on its request boundary; native vector storage retains the
received Float32 bytes. The finding is a pre-existing transport signed-zero loss, not
an unexplained value change attributed to migration. First mismatch ordinal2260 also
explains why the earlier1000-row preflight could pass. Raw frames are decoded through
the same installed MessagePack library, and exact before/after hashes rule out this
diagnostic mutating the store. Physical failing-device/power-loss proof is not claimed.

The original strict canonical-byte gate remains failed. Candidate SQLite canonical
byte qualification and every original goal requirement remain required. No dependency,
production adapter, native pin, corpus, tolerance or acceptance assertion is changed here.
The source snapshot contains99900 rows and72000 embeddings:27900 remain to be produced.
The original fresh-ingestion timing remains incomplete.
