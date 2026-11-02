# Paired vector receipt protocol controls

Run `PYTHONDONTWRITEBYTECODE=1 python3 docs/references/evidence/ears-sqlite-implementation-2026-10-28/vector-pair-protocol/control.py` from the repository. These pure controls reuse historical cd4 numeric samples and add explicitly synthetic runtime/artifact/run metadata. They execute no native library and provide no new timing, recall or backend-compatibility measurements.

All 17 cases pass: a complete synthetic pair retains the historical heartbeat failures; fifteen metadata/sample/policy mismatches refuse; low recall makes the CLI fail while retaining its numeric receipt. Checks cover different CPU/run/source/limits/oracle, artifact identity/hash/baseline/provenance, actual backend, worker/source artifact, omitted samples and changed candidate policy. Temporary reports are owned and removed. Actual paired corpus execution remains required.
