# Real schema refusal exposes published replacement authority

[Run 41330788889](https://github.com/spankyed/apack/actions/runs/41330788889), source `ae9c004158d552fa3a0c11dc1bb38ee0786e7f0a`, reproduces the defect before changing admission ordering. A real independent SQLite connection commits another declaration; the incumbent handle correctly refuses replacement with SCHEMA_CHANGED. Installer rollback restores and verifies the old files/build. The test then fails because `getPackRegistration` still returns the replacement instead of the incumbent. The source publishes registration/binding state before calling the database declaration listener; retirement may already have been scheduled.

The other 97 host cases pass, with no exclusions. Package/API preparation and EARS/host typechecks complete. Shared EARS execution skips after the host failure; the always-run model gate then reports missing shared reports, and its dependent resource work skips. These are downstream effects of the reproduced host defect, not new runtime passes or independent model defects.

The one original test report is compressed unchanged with its decompressed SHA-256. No database/profile payload or traces are retained. The proposed pre-publication owner repair is a later source and is not qualified by this failure receipt.
