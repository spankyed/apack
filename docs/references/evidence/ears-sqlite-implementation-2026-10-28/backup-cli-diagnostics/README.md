# Printable backup failures and CLI type correction — 2026-10-30

The CLI entry prints only `Error.message`. Although the preceding cleanup fix preserved structured causes,
its aggregate message omitted the underlying failures and the destination. Three added message assertions
fail against `a8e12b1cd1` without changing the prior metadata/cause checks. The corrected message names the
backup destination, all collected failure messages and, after successful publication, the retained backup.
No error path deletes the destination. The complete four-file platform CLI selection passes 41/41 on Linux.

Full strict run 41132219406 at `a8e12b1cd1` additionally exposes a real TypeScript error in producer job
124325710284: TS2698 on the conditional object spread of `published`. TypeScript does not track its assignment
inside the awaited callback and narrows the local flag to false. An explicit object ternary fixes the type
without a cast, changed deadline, suppressed diagnostic or changed runtime outcome. The original completed
producer log is retained. Other platform jobs from that original strict run remain independent and must be
polled through the same run; it is not a green full gate and is not restarted to diagnose the error.

After the named fix, one private heavy container waits for 30 seconds of quiet and uses two CPUs/6 GiB/no
swap/dropped capabilities, pausing only itself when other agents run. CLI and testing typechecks pass with
incremental caching disabled and an explicit 4096-MiB Node heap. This replaces neither the earlier 384/512-MiB
heap failures nor the original strict type error with a supposed pass: all failures remain in their evidence.
Matching normal package builds, changed-file lint and all 41 platform CLI cases also pass. Any inherited
package-build warnings remain in the original log. The preceding lightweight message-control run uses half
a CPU/768 MiB and retains its three baseline failures and first corrected 41-case report.

Final exact-source strict/platform/installed acceptance remains required after this checkpoint; the currently
running strict source predates it. `qualified-inputs.json.gz` binds every changed/runtime boundary file and
the lockfile to the actual bytes checked. Exact commands, caps, results, runner sources, primary failure and
implementation patch are retained. `receipts.json` verifies original/stored bytes. No compiler/full suite
ran on the daily Mac, no other agent's checkout or container was changed, and no assertion was relaxed.
