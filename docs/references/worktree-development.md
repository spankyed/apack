# Isolated development sessions

Use the current checkout by default. When requested, or when isolation is clearly needed (for example,
concurrent editing sessions), start a separate branch and worktree:

```sh
npm run session:new -- settings-help
```

The command creates `session/settings-help` at the current HEAD in a sibling
`<repository>-worktrees.noindex/settings-help` directory, runs `npm ci` and builds the pack and app there. The `.noindex`
suffix keeps Spotlight from indexing each fresh `node_modules`, which on macOS slowed a new worktree's runs severalfold
and held Electron's shutdown past Playwright's teardown deadline. An optional second argument
selects another base ref. Continue the agent or terminal session **in the printed directory**.
The command does not transfer uncommitted changes from the original checkout.
If setup fails, the new checkout is retained. Retry the failed command there.
Setup commands have a five-minute deadline; combined validation has a fifteen-minute deadline.
Interrupting the command stops its child process groups and retains the checkout for inspection.

Each checkout owns its dependencies, build output, watcher processes and validation caches.
Do not symlink `node_modules` to another checkout: workspace package links would resolve its source.
Worktrees live outside the main repository so missing build output cannot resolve through its parent.

## App and driver isolation

In a linked worktree, `npm run dev`, `dev:inspect`, `dev:open`, `dev:drive`, `dev:eval`,
`dev:query`, `dev:state` and `db:*` default to the same stable `worktree-<hash>` profile.
The hash comes from the canonical checkout path. The CLI owns its profile directory, and secrets
use that profile's file vault. The main checkout continues to use the existing development profile.

The renderer, API, Chromium debugging and Node inspector select available loopback ports.
Drivers find the app through its profile's session record, rather than assuming a port.
Explicit `--profile`, `--fresh` or `APACK_USER_DATA_DIR` overrides take precedence.
Choosing the same override in two worktrees intentionally shares app storage.
Raw `apack` commands keep their existing defaults; use the repository scripts for checkout isolation.

## Validate the combined result

Commit the feature work, then from a clean target checkout:

```sh
npm run session:check -- session/settings-help session/lifecycle
```

This pins the current HEAD and each named branch to exact commits, creates a detached integration
worktree, merges them and installs and builds its own dependencies and app. It runs `npm run chain -- --strict --all
--cores 2`. Your source branches, files and staging index remain unchanged.

A merge conflict or failed check leaves the candidate available for inspection. A successful check
prints the validated candidate commit and evidence location. Changed input refs or a changed candidate
fail the check; rerun before merging. This is a validation command, not a merge or publishing command.
Merge the tested inputs in the same order; advancing branches require another combined check.

## Cleanup

Stop each worktree's watchers before removing it. Remove a reviewed, clean worktree with
`git worktree remove <path>`. Its persistent app profile remains available through
`apack profiles list`; stop and remove that profile separately when no longer needed.
