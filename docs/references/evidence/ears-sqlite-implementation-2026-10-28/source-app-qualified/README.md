# Broader source SQLite app qualification — 2026-10-30

[App acceptance 41148535620](https://github.com/spankyed/apack/actions/runs/41148535620) passes at
`f05eda527ce471e975e480e469a3b33d30e2c580`, selecting `suite=app, storage_format=sqlite/1`. The downloaded
per-case Playwright JSON proves **33 expected passes, zero unexpected/flaky cases, zero retries**, and exactly
one skipped case: the installed-only SQLite witness, which requires a packaged executable. Its independent
[signed installed qualification](../installed-49d/README.md) passes on identical production inputs.

Every passing case has one passed attempt. Required named witnesses actually execute:

- the real source app's primary/history stores have persisted EARS SQLite header identities and no elmdb file;
- invalid saved settings are repaired, the app reopens and packs start;
- file-read replies, external file changes and terminal output reach the code surface;
- a killed API process restarts and the same window resubscribes;
- the offline CLI reads the running app and refuses mutation/reset against its profile.

The retained JSON lists all 34 cases and their actual statuses, including app/UI/navigation/API/secrets/content/
reload/attach/settings coverage. This is the existing source app suite on macOS arm64, not every possible app,
SDK/executable-pack, inference or OS/architecture flow. External model-provider executables are not certified
by graceful missing-provider handling. Screenshots and process logs remain in the original downloadable CI
artifact; raw report, original job log and metadata are losslessly retained here with integrity receipts.

The [original SQLite failure and elmdb control](../source-app-delivery/README.md) remain failed at the same
unaddressed FILE_CONTENT assertion on the same source. The corrected test enters the real surface request
handlers and checks the current addressed terminal.OPENED response, preserving all file-change/output/title/
path assertions and original deadlines. No database/runtime behavior changed to make it pass. Per-case JSON
now prevents aggregate passing counts from standing in for a missing named witness.

Production defaults remain elmdb and all profiles are isolated disposable fixtures. The native prototype is
still private; this app run uses the unchanged packaged vector library. Future relevant native/runtime changes
require affected qualification again. Performance/recall/resource, physical I/O/recovery, remaining platform/
pack/architecture coverage and the full requirement-by-requirement adoption decision remain required.
