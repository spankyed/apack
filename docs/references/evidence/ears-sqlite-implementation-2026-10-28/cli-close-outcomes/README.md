# CLI command outcomes through database close — 2026-10-30

## Defect and contract

The shared `withDatabase` command wrapper uses `undefined` as its success sentinel. A command throwing
`undefined` is silently treated as successful. If command execution and database close both fail, the wrapper
retains the primary as `cause` but replaces its machine-readable outcome and only formats the close error as
text. `COMMIT_UNKNOWN`, `PUBLICATION_UNKNOWN`, `NOT_DURABLE` and retained recovery/publication paths can be lost
at the outer boundary. This extends the original truthful recovery-outcome requirement; it is not a new API.

The wrapper now tracks failure separately from its value and always attempts close. If both phases fail,
`AggregateError.errors` retains both original values and `cause` retains the command failure. Its existing
human-readable explanation remains. The primary outcome code and supported recovery/publication metadata
(`recoveryPath`, `destinationPath`, `publishedPath`, boolean `dataInstalled`) remain available at the top level.
A lone command or close failure is rethrown unchanged. Ordinary successful values retain their contract.

## Evidence

Nine focused cases cover thrown undefined/null/false/zero/empty string, the three machine-readable outcomes
with simultaneous close failure and an undefined-plus-close double failure. Exact final tests against the
original wrapper reproduce **5 failed, 4 passed**. The runner restores the corrected wrapper in `finally`.
The corrected four-file platform CLI selection passes **41/41**, zero skips, including the full real SQLite
profile/backup/reset suite. Changed-file lint and platform script syntax also pass. The preliminary baseline
is retained, while `baseline-final` and the exact final input hashes own the acceptance claim.

All nine cases join the actual three-platform workflow selection. The verifier requires the five previously
failing invariants by name and rejects any nonpassing selected case. Fourteen extracted actual-report controls
prove each required witness cannot be missing or pending (including replacement by an unrelated passing case),
plus duplicate refusal, additional-passing acceptance and Windows path normalization. The preceding twenty
backup safety controls pass again against this combined report. Controls protect coverage; they do not establish
Windows filesystem behavior or substitute for final integrated CI.

All local execution stayed in the private Linux volume at half a CPU/768 MiB/no swap/dropped capabilities.
CLI types and normal package builds remain pending the larger disposable budget or final CI. Existing platform
run 41130505526 is pinned to earlier `58ae8a7b0e`; it cannot qualify these later changes. Full strict, final
platform/installed and all remaining performance/app/physical-recovery requirements remain open.

`inputs.json`, tracked implementation patch, exact new test/runner/control sources and losslessly compressed
reports preserve inputs and results. `receipts.json` verifies retained original/stored bytes. No assertion,
deadline or original goal requirement was relaxed.
