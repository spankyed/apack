# Signing helper routing and editor repetition

Base `2558de0d9d8910c611fcaa179c5dadf666b4fbff`. The signing helper moves from `build/prod/sign-mac.mjs`
to `scripts/lib/native-signing.mjs` without changing its bytes, so changes are routed to the owning tooling
suite. Product configuration, test imports and the signed workflow follow the new path. No boundary rule
or exception list is weakened. [Input hashes and commands](routing-checks.json) pin the moved source.

The old placement fails the actual `repo-check-boundary` converse assertion, naming the new signing test.
After moving the helper, all 15 cases pass (eight signing, four Preview, three boundary), as do tooling
types, changed lint and workflow parsing. The private copied fixture needed its own Git index before
running a Git-based tree check; no shared checkout metadata was borrowed. The harness checks the old
failure's actual assertion and named path, not merely a nonzero exit code. Reports retain both states.

[Editor run 41067062738](https://github.com/spankyed/apack/actions/runs/41067062738) at `ff16d3b946` executes
ten selected cases with one worker; all ten pass in 2.5 minutes. Its artifact download returned HTTP 503
account egress limit, so the independently retrieved job log is retained instead. This is stronger than
one pass, but does not diagnose or fix the original intermittent editor failure. No assertion or timeout
was changed. Raw text log hashes are retained; trailing whitespace is normalized. JSON reports are unchanged.

Real signed installed run `41069328528` and full strict `41069599413` remain on preceding `2558de0d9d`.
Preserve their handles; this routing change requires its own source qualification after publication.
