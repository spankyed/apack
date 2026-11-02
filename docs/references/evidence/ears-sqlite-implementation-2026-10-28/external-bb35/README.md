# Explicit SQLite external-pack app flow

[Run 41388294349](https://github.com/spankyed/apack/actions/runs/41388294349), source `bb35e86c7f4f8360233e9d40eef9a539993f1a59`, completes successfully with `suite=external` and `storage_format=sqlite/1`. Storage validation and the selected app-suite environment both confirm SQLite selection for isolated test profiles. Fixture contracts and the external default-fork producer pass, followed by all 28 external-pack app cases, with no reported failures, exclusions or flakes. Test filters and budgets are unchanged.

This is the actual external fixture's existing app flow rather than production-default strict app composition. The common boot selection is independently covered by the SQLite app/API witnesses. This run's source precedes `cd8b413fa8` and does not qualify its more precise watch dependencies or remove the separately retained thread-view regression.

The fixture emitted its standard successful `.last-run.json` and job summary, not a per-case JSON aggregate. The minimized receipt records the exact completed step's counts, successful named preparation/storage steps and original job-log/last-run hashes. Raw logs, configuration, synthetic profiles, attachments and database files remain private. It does not claim installed signing, provider/model coverage, general performance or complete candidate acceptance.
