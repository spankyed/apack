# Dev-loop freshness readings (2026-11-04)

Owner: [the dev-loop freshness goal](../../goals/goal-dev-loop-freshness.md). All readings are from one busy
developer Mac with other sessions running, so they show what changed and don't state a quiet-machine cost. Each
row is one `npm run dev` observation in a linked worktree with its own data dir. An edit appended an export to
the named source file, and its revert is recorded as a second edit.

## One edit in a running session

Before is `930a521847`. After is `45a23d292e`, except the UI and testing rows, explained below. Time is seconds
from save to publication; a second number is the second build's publication.

| Edit | Before: builds | Before: published | After: builds | After: published | Load after | Stamps moved |
|---|---|---|---|---|---|---|
| `apack-ui/src` | 2 | 170, 328 | 1 | 176 | 10 | ui |
| its revert | 2 | 163, 307 | 1 | 158 | 7 | ui |
| `apack-sdk/src` | 2 | 201, 351 | 1 | 230 | 7 | cli, sdk, testing |
| its revert | 3 | 193, 350, 474 | 1 | 224 | 10 | cli, sdk, testing |
| `apack-ears/src` | 2 | 173, 319 | 1 | 220 | 9 | cli, ears, testing |
| its revert | 2 | 164, 290 | 1 | 257 | 17 | cli, ears, testing |
| `apack-testing/src` | not seen by the watcher | none | 1 | 151 | 11 | testing |
| its revert | not seen by the watcher | none | 1 | 312 (event 174 late) | 8 | testing |
| `apack-cli/src` | not seen by the watcher | none | 0 | none | 55 | cli |
| its revert | not seen by the watcher | none | 0 | none | 23 | cli |
| A broken SDK build | 0, with the ensure failing 9 times in 7 min and no edits | none | 0, failed once at 19 s and stayed quiet | none | 15 | none |
| Its repair | 2 | 144, 280 | 1 | 249 | 32 | sdk |
| Build lock held by another process | 2 | 170, 319 | 1 | 343 | 9 | all five |
| Its revert | 2 | 201, 356 | 1 | 276 | 14 | cli, sdk, testing |

Before-column load was 4 to 16. Startup ran no extra build in either version.

**The UI and testing rows come from a separate run of the same code.** In the full session at `45a23d292e`, those
four edits produced no pass at all. A rerun with logging, beside an independent `fs.watch` process, showed one
build each, and both watchers received each event at the same moment, including the 174 s late one. The missing
events in the full session had no independent watcher beside them, so their cause is not proven; a lost macOS
file event is the likely one. An earlier session at `19448b9956` also lost two edits at load 12 to 19. A lost
event leaves `dist` stale until the next edit, which this goal does not change.

## What the time goes on

- **`dist` current:** the refresh took 6 to 10 s for one unit in the logged run, and about 19 s for an SDK edit's
  three units.
- **Pack build start:** 46 to 120 s after the save at load 7 to 17. Most of that follows the refresh, before the build.
- **Pack build alone:** `npm run build -w @app/default-setup` took 84 s at load 11, and 99 s at load 5 to 7.
- **Publication:** a further 105 to 175 s after the build starts, including its input re-read and the app's reload.

## Package builds

Taken in the worktree at load 8 to 12, one sample each.

| Command | Time |
|---|---|
| Cold `npm run packages:ensure`, all five units | 23.2 s |
| No-op `npm run packages:ensure` | 0.4 to 0.5 s here; 0.8 to 1.6 s during sessions |
| `npm run build:package -w @apackdev/ears` | 1.9 s |
| `-w @apackdev/sdk` | 4.8 s |
| `-w @apackdev/ui` | 7.7 s |
| `-w @apackdev/testing` | 5.3 s |
| `-w @apackdev/cli` | 0.9 s |

## Why SDK and ears edits still built twice after the first fix

Running the ensure before reading inputs removed the second build for UI edits. SDK and ears edits kept it,
because a logged run showed `beforeFrontend.current()` false with the compiler signature unchanged. Their package
directories are under the frontend watcher's chokidar roots, and the ensure blocks the event loop. So the edit's
own `change` event and the package build's writes under `.temp`, `dist` and `publish` arrived up to 58 s late,
after the snapshot, and each one bumped the watcher's namespace counter. Ignoring those events for files the build
never read took both edits to one build. The mutation of the `change` rule fails
`frontend-watch.native.spec.ts`.

## `watch-publication` in the container

The spec's 120 s setup hook timed out in three consecutive runs just after that fix, at load 11 to 44. A direct
comparison at load 10 to 14 then ran it twice with the fix and twice without. All four passed, with setup at 20 to
34 s either way, so the fix did not slow setup. The timed-out runs each began after a CLI source change or a
timed-out run; a cold compiler capture is the likely reason, not proven. One of them also ran out a 20 s wait for
publication after a build.

## Early cutoff

Of the last 298 commits (2026-10-14 to 2026-11-04) that edited non-test source in `apack-sdk`, `apack-ears` or
`apack-ui`, 13 (4.4%) changed only comments or blank lines, the edits most likely to leave `dist` byte-identical.
Commits are a proxy for saves, and the count comes from a line filter over `git log -p`.
