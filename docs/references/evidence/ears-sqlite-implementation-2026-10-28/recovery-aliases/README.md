# Recovery profile aliases — 2026-10-29

Published 7cba75f431 strict run [40814018368](https://github.com/spankyed/apack/actions/runs/40814018368)
completed FAILURE: producers, both integration shards and both native shards pass; app/rest fails two elmdb
recovery crash cases. elmdb records its canonical database path while the selected macOS profile may use
/var instead of /private/var. String equality rejects the same physical destination. The failed log remains
in the adjacent text-prefixes evidence. Canonical stays on 585dcafccf; this failure is not promoted.

The correction compares absolute destination leaf names and realpath-resolved parents. It does not follow
an arbitrary database-leaf symlink as an approved destination. Publication uses the selected profile's own
paths after validation. Foreign parent/leaf/relative records refuse, and ordinary-directory publication
checks still reject leaf symlinks. Writer/recovery locks and managed reader claims already live in the
physical profile parent and therefore exclude access across ancestor aliases.

Exact final tested source is 76b1aa2765 plus recovery-aliases.patch (manifest retained). In one disposable
Linux arm64 container, two CPUs/6 GiB, dropped capabilities and real permission-denial preflight: five
package builds, host types, **95 recovery/import/storage cases**, lint and imports pass. Twelve permanent
unit cases cover both backends, both alias directions and complete/move/publish paths; two reader cases
prove aliases do not bypass managed-reader exclusion; four unsafe-path cases preserve refusal and data.
Reverting precisely the three production path comparisons/destination changes makes all twelve alias
cases fail at preparation validation. No deadline or expectation is loosened.

The real process harness additionally SIGKILLs after import COMMIT and at each restore rename, for each
backend with both ordinary and symlinked profiles. It verifies the mixed state, blocked writable startup,
retained incumbent and candidate files, then resumes through the physical profile spelling. Eight crash
combinations plus the independent live-reader kill/reclaim case pass. These are process-death tests, not
power-loss/filesystem certification; POSIX-only crash cases remain skipped on Windows.

Retained attempts: first alias checkpoint passes 91 cases and all checks; strengthened crash checkpoint
passes 95 cases/types/builds but fails lint on a redundant test-table spread. Removing that spread preserves
the same cases; final exact source passes all checks. Raw archives retain each result separately. The
results.json files record setup subprocesses; later check outcomes are in their individual logs and the
fail-fast runner. New exact strict CI is still required before canonical promotion.
