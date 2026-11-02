# Complete source app and retained window-discovery qualification

[Run 41380838479](https://github.com/spankyed/apack/actions/runs/41380838479), source `3ec277e39374976d6cc9fd14079387c034ed8ddb`, succeeds. The testing workspace typecheck, all ten main-window discovery cases, app test types/settings lint and complete source SQLite app suite pass. All 33 eligible app cases pass once with one packaged-only exclusion, zero failures/flakes/retries and no timeout/assertion relaxation.

The unit report is actually retained under `.apack/qualification/window-discovery.json`, outside Playwright's output cleanup. This qualifies report retention as well as the explicit renderer role, both window orders, navigation during a readiness probe, deadline/listener cleanup and main-window selection queries. It includes the latest database runtime/history refusal, but precedes the test-only terminal.CLOSED wait at `1d25cbf2af`; that changed cleanup has its own full app replay queued.

The minimized receipt retains original report hashes, public case outcomes and named check results. Full app configuration, logs, profiles and trace attachments are omitted. Previous failed app outcomes remain separate historical evidence; this run does not turn them into successes or establish corpus/performance/adoption acceptance.
