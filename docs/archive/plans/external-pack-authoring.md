# Deferred external pack authoring review

Status: archived 2026-10-21. Its release and distribution items are owned by the deferred
[release readiness](../../plans/deferred/external-pack-release-readiness.md) and
[npm/Homebrew distribution](../../plans/deferred/npm-and-homebrew-distribution.md) plans, and its unverified findings
by [an issue](../issues/ISSUE-external-pack-authoring-findings.md). Retained from the
[archived review](external-pack-authoring-followups.md).

## Work with an existing goal

- Facade/DSL terminology: completed in the descriptor checkpoint in [discovery](discovery-without-activation.md); the original goal is archived.
- Advisory storage locks: [goal-write-lock-advisory.md](../../goals/goal-write-lock-advisory.md).

## Release and platform follow-ups

- [External-pack release readiness](../../plans/deferred/external-pack-release-readiness.md) now owns draft/upload/publish
  ordering and partial-upload recovery, Windows release-command invocation, fresh scaffold/workflow
  prerequisites and the authorized real GitHub release round trip. These remain unfinished requirements,
  not work completed by moving this list. Offline beta-cache/rate-limit cases do not prove that round trip.
- [npm/Homebrew distribution](../../plans/deferred/npm-and-homebrew-distribution.md) owns reviewing branch restrictions and
  pre-publish typecheck/test gates in `.github/workflows/publish-packages.yml`, followed by authorized
  workflow verification. Publishing remains manual and requires an explicit decision.

## Findings still requiring inspection

- Build-only facets: whether backend bundling correctly rejects frontend dependencies when `.vue`/`.css` imports are stubbed.
- PATH installation: handling errors other than `EACCES`/`EPERM` in `cli-command.ts` and `MacOSAppMenu.ts`.
- Test fixtures: `readPackLastError` failing open, directory removal racing API shutdown, and console listeners attached after early renderer logs.
- Packaged authoring: strength of the symlink check in `test-packaged-authoring.sh`.

The original request to delete `packages/api/scripts/db/fix-prod-upgrade.ts` is closed: that file is absent.
The saved-beta-choice concern is obsolete, and cache-first resolution is already fixed. Neither remains a task.
