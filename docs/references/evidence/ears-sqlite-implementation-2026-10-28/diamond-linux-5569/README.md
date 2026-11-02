# Focused Linux diamond-build observation — 2026-10-30

At source `5569fdd656bf8e8f44a6e93988f9598860752b09`, all five actual assertions in the diamond
integration fixture pass with no skips/failures under the original 240000-ms setup deadline. The normal
package build takes 37.1 seconds; the selected spec takes 94.8 seconds including its additional rival/
collision case. Visible setup phases are deep 13584 ms, left 10578 ms, right 30717 ms and app 15704 ms
(about 70.6 seconds total). All original builds, output assertions and the real collision subprocess remain.

The initial focused attempt refuses before collecting tests because the testing/CLI package stamps predate
the EARS native-loader change. This is a setup refusal, not a pass or explanation for CI. The corrected
observation rebuilds normal package outputs, then enables the prebuilt guard again; no guard is bypassed.
735 production source files are hash-verified, the packaged vector binary remains the selected b16f digest,
and the independent actual report verifies all five passes. Both attempts and their recipes/logs are retained.

One owned two-CPU/6-GiB/no-swap container executes the corrected observation after a quiet admission period;
no protective pause occurs. It runs one selected file/worker. The original Mac strict shard had two workers
and other files; this does not reproduce or fix that 240-second failure. Focused Mac observation
41160571827 preserves the same phase markers and deadlines; inspect its actual terminal result before
claiming a causal correction or dispatching another full strict run solely for reassurance.
