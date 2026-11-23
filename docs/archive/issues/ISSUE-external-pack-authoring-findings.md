# Unverified external-pack authoring findings

Status: closed, 2026-11-23. Each finding was checked against the source; three held and are fixed, and one part of
the fixture finding was already handled. The resolution follows each item.

Four findings from the external pack authoring review that nobody had confirmed or ruled out.

- **Build-only facets:** whether backend bundling correctly rejects frontend dependencies when `.vue`/`.css`
  imports are stubbed. **Held.** A component or style imported by path became an empty module, but a package the host
  shares with frontends only (`SHARED_DEPS` `target: 'fe'`: Vue, Tiptap, the icon set) was left external, so backend
  code importing one built and then failed as the backend loader, which provides none of them, loaded the pack. The
  backend bundler refuses those imports now (`rejectFrontendPackagesPlugin`, `be-bundler.ts`;
  `host-import-guard.spec.ts`).
- **PATH installation:** how errors other than `EACCES`/`EPERM` are handled in `cli-command.ts` and
  `app-menu.ts`. **Held.** Any other error was rethrown out of a menu handler that called it as
  `void installCliCommand()`, an unhandled rejection with nothing shown. Every failure now shows the error dialog; only a
  permission refusal asks for an administrator's password.
- **Test fixtures:** `readPackLastError` failing open, directory removal racing API shutdown, and console
  listeners attached after early renderer logs. **Two of three held.** The console listener was attached only once the
  main window was found and sized, so a pack frontend that failed to load during boot was never heard and the fixture
  waited instead of failing fast; console errors are recorded from the launch and handed to the first listener
  (`recordConsoleErrors`). `readPackLastError` read an unreadable registry as "no error"; it says so in the log now and
  still fails nothing. The removal race was **already handled**: `closeApp` fails when the API outlives the app, and
  the removal retries.
- **Packaged authoring:** the strength of the symlink check in `test-packaged-authoring.sh`. **Held.** It matched
  absolute link text starting with the checkout's path, two levels deep, so a relative link, one through a symlinked
  checkout path or one nested in a package's own `node_modules` passed. It resolves every link at any depth now
  (`test-packaged-authoring-app.sh`).

The review itself is [archived](../plans/external-pack-authoring-followups.md). Release ordering,
recovery and the real GitHub round trip belong to the deferred
[external-pack release readiness](../../plans/deferred/external-pack-release-readiness.md) plan; package
publication belongs to the deferred [npm/Homebrew distribution](../../plans/deferred/npm-and-homebrew-distribution.md)
plan.
