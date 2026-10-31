# Broader source SQLite app delivery failure — 2026-10-30

[Run 41146193993](https://github.com/spankyed/apack/actions/runs/41146193993) at `5b531948f5`, with explicit
`suite=app, storage_format=sqlite/1`, builds and runs the broader source app suite: **32 pass, one fails, one
is skipped**. The failure is the code surface file-read/watch/terminal case at its FILE_CONTENT predicate,
not API reconnect. The single intended installed-only SQLite case is ineligible on a source host. Original
job log, actual failed trace, request excerpt and exact test source are retained. The original reporter has
no per-case JSON, so counts alone are not used to certify each named passing case.

The spec calls the page's raw `__sendToSystem` function from evaluation, outside any surface delivery.
`createSends.answerAddress()` reads the current delivery's receiver; absent one, it supplies no sender.
The code explorer answers file reads only through `reply`, which has no address for these asks. The actual
request log shows repeated READ_FILE requests but no FILE_CONTENT arrives. The same stale test later expects
full terminal data on CREATED; the current contract sends only the terminal ID as creation news and returns
full data through the addressed OPENED reply. No SQLite refusal appears in this path.

The correction drives OPEN_FILE and terminal.CREATE through the shell's existing SEND_TO_SURFACE route,
letting the actual frontend handlers issue addressed backend asks. It checks the addressed terminal.OPENED
result and retains every file-change, terminal-output, title/path assertion and original deadline. No runtime
reply rule, timeout or database behavior changes. The app workflow also retains line/JSON per-case reports,
so subsequent qualification can prove both the new physical SQLite identity witness and settings recovery.

The unchanged-source elmdb counterfactual [41147691838](https://github.com/spankyed/apack/actions/runs/41147691838)
selects only the failing case and was dispatched before publishing the correction. It is now **terminal
failure at the identical FILE_CONTENT predicate and unchanged 15-second deadline** on the same source.
The actual log records `elmdb/1` and one selected case; its original job log/metadata are retained. This
confirms the original test failure is not SQLite-specific. Corrected full SQLite app run
[41148535620](../source-app-qualified/README.md) at `f05eda527c` now passes: downloaded per-case JSON verifies
33 actual passes, no unexpected/flaky cases/retries and one intended installed-only skip. Both original failed
runs remain preserved; the correction changes the test's request path, not database behavior or deadlines. This failure is not erased by earlier
strict or six-case installed successes, nor does it complete the goal's remaining app/performance/operational
requirements. Downloaded screenshots/full logs remain private; no real user profile or dataset is involved.
