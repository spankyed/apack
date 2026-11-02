# Strict app/rest failure at 6cfdf32dad

[Actual app/rest job 124650366905](https://github.com/spankyed/apack/actions/runs/41236766386/job/124650366905) completes host unit execution in 528.52s within its unchanged deadline. It passes 6,893 tests, fails one and skips 84 (6,978 total); 599 files pass, one fails and four skip. The job chain fails at `test:unit:host` after 830.8s on its two-core budget.

The only failed test is the unchanged text-only `generate-entries` overview judgment. The prior built-EARS dependency declaration defect no longer appears. This is not a green broad gate: skipped cases are not passes, later chain steps are not established, and this source predates the latest production correctness/performance changes. Final acceptance must audit required skips and qualify final source.

`summary.json` retains inspected counts, timing, source/job identity, exact failed test name and the original log digest. The complete log remains in CI and private local evidence; no broad test output or fixture payload is copied here.
