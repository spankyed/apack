# Live pack index admission — 2026-10-28

Final lifecycle source: **51d4e11d2961a342ca0f33e160a779d30d7bbc65**.
Functional implementation cb331a327d; subsequent commits fix async test callers and retain all original cases.
App/native pins remain 98386b36a1 / 6ab2f69. All builds/tests ran in disposable Linux arm64,
2 CPUs / 6 GiB, Node 23.11.1, image apack-linux-test:74d4b8cfe839. No runtime/target trees
were copied to the daily Mac. Logs are byte-preserving gzip; harness scripts are retained.

## Implemented boundary

Installer acceptance/registration remains synchronous. Registry readiness delegates to the owning database
in openAppStore; declaration-only registries have no build work. Boot/reset, activation, accepted install,
update/restore and reload await readiness before onInit, migrations, content or actor startup. Claims stay
held through async startup. A failed accepted build retains published files, removes the failed runtime and
reports a load problem instead of starting actors on incomplete indexes. Backup acceptance waits for both
stores before migrations. Cleanup of obsolete registrations remains separate from candidate refusal.

## Final evidence

- Five normal package builds; host/API types; **127 lifecycle/migration/service cases**; **4 real SQLite API
  profile cases**, including populated 150-row search admission through the actual registry readiness callback.
- Removing lifecycle readiness fails the deferred-init tests. Removing root database delegation fails the
  real populated-index test. Removing the install starter await independently fails BOTH claim cases at
  the claim assertion. Restored lifecycle cases, lint and imports pass.
- Normal shipped-pack build and production Node API build pass. Reset and API/offline reopen parity pass
  **6 cases each on elmdb and SQLite**. Both built-server boots exit normally and exercise authenticated
  SDK entity/settings operations, shipped default-setup loading and persistence across restart. The recorded
  readySeconds include RPC completion and are smoke observations, not app latency qualification.
- Permission tests run with all Linux capabilities dropped. A preflight proves mode denial before the tests;
  CapEff is zero. This avoids a privileged root process bypassing the existing chmod refusal fixture.

## Preserved failed/intermediate attempts

The first typecheck caught a non-async test caller and it was fixed. A privileged Docker run passed 128/129
but defeated an existing permission-refusal fixture; that is not a source failure or a permissions pass.
The next run passed 129 but included duplicate new cases. Its claim-removal control exposed one valid
counterexample followed by test-state contamination. Deduplication and claim-probe cleanup fixed that;
diff review caught two accidentally removed pre-existing parameterized refusal cases and restored them.
The 125-case intermediate is not the final coverage; final 51d4e11d retains those cases and passes 127.
No test contract, assertion or timeout was relaxed to obtain the final result.

## Published CI remains a separate gate

[40775526128](https://github.com/spankyed/apack/actions/runs/40775526128), published **3f4651b009**,
has completed failures in integration-1 and app/rest: the real API bundler probe reads its tsup config and
build/build-metadata.ts without declaring cache inputs. The independent guards are unchanged; local 653c1330
adds the actual inputs and 5e20fb5956 adds owned runtime assets to source-suite fingerprints. Other CI jobs
were still running at this checkpoint. Do not promote this tip or dispatch duplicates while that handle is live.

These cases do not certify full renderer/live-pack workflows, real IO failures, performance/recall budgets,
filesystem support or packaged/signed OS distributions. All remaining goal phases 3–7 retain their acceptance.
