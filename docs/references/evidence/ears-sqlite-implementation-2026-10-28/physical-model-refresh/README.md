# Incumbent-preserving physical model refresh

Linux qualification over exact source `3cccc4dfa9441b834afc325fddd24f1fb1d06c09` and native
`95615ed8d493f9a7c2789eaf1f4c847ae375eb32`. `final-source.json` records changed input hashes,
Git archive identities/checksums, both native binary hashes and the disposable image. Native compilation
used a private Cargo target. Broad checks used 2 CPU / 6 GiB with zero swap; focused tests/controls used
0.5 CPU / 768 MiB. No Mac compiler or working-agent outputs were used.

**657 EARS cases pass with zero skips**, plus **18 host cases**, **7 API cases**, EARS/host/API types,
matching ordinary packages, regenerated/checked API reports, boundaries and changed-file correctness lint.
The final normalized report was rechecked and final inputs verified against the validated volume.
The index test was then strengthened to update an existing embedding behind the refresh cursor and
check its current distance before/after publication. All 10 native index cases, EARS types and changed-test
lint pass afterward (`index-followup.*`, `ears-types-followup.log`). The metadata records both test-input
hashes. Other post-test changes are report line endings and CI expected counts; runtime inputs stay identical.

Five new cases cover incumbent access through training/private projection/failure; foreground writes and
rollback; atomic publication; bounded physical retirement; old read snapshots across publication/DROP;
independent peer queries while training is pending/failed; interrupted projection/reopen; unchanged logical
generations/sequence; and public admission releasing write exclusion before training. Training rejection
is recorded through the service's result path. Explicit retry publishes a distinct physical identity.

Three controls each fail one selected case when the incumbent is retired at admission, peer candidates
are gated on the newest training attempt, or native cleanup deletes the entire group. `controls.py`
restores source after each mutation. All five positive focused cases precede the controls; the full suite
subsequently checks the restored implementation.

The initial package build caught a TypeScript narrowing error, fixed before the 657-case run
(`initial-build/`). API generation correctly refused stale SDK/testing/CLI prerequisites after integration;
ordinary matching package production resolved that guard (`package-prerequisite/`, `finish-results.json`).
Original failures are retained and do not count as successful checks. The three orchestration scripts
preserve the command sequence; native acquisition used networking, resumed validation did not.

This is current-pin Linux qualification, not all-platform/installed refresh qualification, a full strict
result, or performance acceptance. FULL commits and cleanup DROP still need responsiveness/WAL/resource
measurements. Live replacement suspension/epoch invalidation and complete native audit/rebuild/restore
ownership remain required. Pre-release format-one derived catalogs change in place: recreate developer
SQLite profiles instead of adding compatibility migration. Production remains elmdb.

Retained log files normalize trailing whitespace and blank EOF lines for review; JSON reports are preserved.
