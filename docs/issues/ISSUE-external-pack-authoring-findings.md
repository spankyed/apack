# Unverified external-pack authoring findings

Four findings from the external pack authoring review that nobody has yet confirmed or ruled out. Each is a
suspicion, not a reproduced defect: revalidate against current source before changing code, and close an item
here once it is shown to hold or not.

- **Build-only facets:** whether backend bundling correctly rejects frontend dependencies when `.vue`/`.css`
  imports are stubbed.
- **PATH installation:** how errors other than `EACCES`/`EPERM` are handled in `cli-command.ts` and
  `app-menu.ts`.
- **Test fixtures:** `readPackLastError` failing open, directory removal racing API shutdown, and console
  listeners attached after early renderer logs.
- **Packaged authoring:** the strength of the symlink check in `test-packaged-authoring.sh`.

The review itself is [archived](../archive/plans/external-pack-authoring-followups.md). Release ordering,
recovery and the real GitHub round trip belong to the deferred
[external-pack release readiness](../plans/deferred/external-pack-release-readiness.md) plan; package
publication belongs to the deferred [npm/Homebrew distribution](../plans/deferred/npm-and-homebrew-distribution.md)
plan.
