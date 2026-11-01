# Prefix validation on the rebased candidate — 2026-10-31

Runtime source 45180293a3 (unchanged through published documentation checkpoint487011c484).
All five ordinary package builds, cache-disabled EARS types and targeted oxlint pass.
Pinned native2441 passes all36 shared relevance judgments. The frozen pre-fix SQLite
runtime passes34 and fails exactly the two new prefix/typo judgments. Applying the
committed prototype makes all36 pass. All seven affected search files pass, including
field/candidate/phrase scope, opt-out, transactional/watch/reopen and physical recovery.
The exact counts by file are in summary.json. No new gold judgment was weakened.

The complete local run is **failure:684 passed,7 failed,75 skipped out of766**. Seven
assertions exceed their unchanged30-second limits across the native model-based harness,
explicit dump conversion, logical ingestion and logical snapshot API. Raw JSON/logs are
retained. The native model-based file directly opens elmdb regardless of backend selection;
its timeouts cannot by themselves implicate the changed SQLite prefix execution.
A single owned-container sample shows both workers in filesystem/page-related waits,
371765248 bytes of memory and zero memory-limit/OOM events. This is not a causal syscall
profile or a proof that every timeout has the same cause. No timeout was raised.

The private runner omitted EARS_VEC1_EXTENSION, so75 native vector cases were skipped.
This is a harness omission, not accepted coverage. A separate corrective run88910 verifies
the packaged extension manifest, supplies the setting and selects only those four files;
it also performs the pending prefix growth diagnostic. It reuses the seven passed search
files rather than rerunning them. That run is still pending; its results must be retained
separately. The original failed suite is not replaced or called green. Growth did not run
in this failed first pipeline. The final goal and original budgets remain open.

Three-platform CI41181673785 targets published source487011c484. Check its terminal result;
a dispatch is not a pass. The local storage is now OrbStack on external Seagate, so old
internal-storage timings are not matched performance controls.
