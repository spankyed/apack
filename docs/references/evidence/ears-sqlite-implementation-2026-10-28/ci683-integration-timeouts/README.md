# Pinned integration timeout investigation — 2026-10-28

Strict run [40688661462](https://github.com/spankyed/apack/actions/runs/40688661462), attempt 1 at `683e1d5912`,
passes producers, both native shards, integration-2 and app-and-rest. Integration-1 fails three CLI targets on
existing deadlines: scaffold's init beforeAll (60 s operation), facade-report's verified build case (80 s), and
help-snapshot replacement (200 s). No functional mismatch is shown by these failures. This remains a failed
integration attempt, not a qualified gate or permission to increase its budgets.

The exact three targets reproduce unchanged in the candidate's owned Linux runner: **36 cases pass**. The help
replacement case takes 56.47 s within the same 200 s limit. Full compiler/runtime preparation and tests remain
inside Docker. The raw log retains preparation and every case; no native target/captured runtime was copied to
the Mac. The evidence does not establish the Mac-specific cause.

With that new evidence, only the terminal failed shard is retried once, on the same source and existing budgets;
the five successful jobs are retained. Poll attempt 2 of this exact run. If the same deadlines fail again,
investigate Mac timing/process completion instead of repeated retries or weakening the checks.

The new Node toolchain cache works on the consumer: a ~36 MiB restore completes in about 4.7 s, and setup-node
reports Node 23.11.1 found in the restored tool cache. The retained log excerpt proves actual warm restoration,
not only YAML validity. This removes the earlier direct-download delay; it does not explain or excuse the later
compiler-test deadlines.

The single identical-source retry completed successfully on 2026-10-28: all six jobs are green at exact
`683e1d5912f802fcd715a10bb8d1271dc11c1ea1`. `attempt2-success.json` retains the authoritative run/job state.
That permits the private canonical fast-forward; it does not establish the root cause of attempt 1's Mac timeouts.
