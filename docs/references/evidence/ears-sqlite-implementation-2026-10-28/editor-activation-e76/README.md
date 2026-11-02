# Focused editor activation observation — 2026-10-30

[Run 41155440320](https://github.com/spankyed/apack/actions/runs/41155440320) at
`e76d83c412f919fa1a03951c566b8a05eef8096e` repeats the same real-app SQLite activation case three
times on separate isolated workers. Actual reports show one failure, two passes, zero skips/flaky results
and no retry. The first fails the unchanged five-second `referenceSuggestion` predicate; two subsequent
repetitions pass all activation/deactivation/draft/selection/update assertions.

The failure attachment records eight observations with an intact host-only editor and no suggestion
extension. At capture the accepted frontend registry contains only `host/references`, and the shell exposes
only host surfaces. Thus it does **not** show a rejected editor replacement with an already accepted pack
binding. The backend receives the toggle at 01:44:58.846 UTC, registers at 01:45:00.935 and applies content
at 01:45:02.024; frontend client-ready is absent before shutdown. The other workers publish frontend-ready
about 4.35 and 3.37 seconds after their toggles. Cold activation latency or delivery remains to be distinguished;
this observation does not prove whether readiness would arrive after the deadline.

The unchanged-source/runtime elmdb control uses run 41157076346, three repetitions and the same original
deadline. Inspect its terminal report before attributing the failure to SQLite or changing product behavior.
Original app reports, decoded attachment, trace, worker logs and job metadata/log are retained losslessly.
The failure is not relabeled as flaky success, and no deadline or predicate is relaxed. Production remains
elmdb; full source-app and operational/performance acceptance remain open.
