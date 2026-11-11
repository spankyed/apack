# Dev-loop file watching on macOS: state, evidence and the open path

A handoff. It holds what is proven, what is merged or open, the code involved, and a plan that the user rejected,
with the reasons it is weak. The next owner should propose a better path, not continue that plan.

## The problem

Under `npm run dev`, a saved source file has to reach a rebuild and then the running app. On macOS some saves never
did, or arrived minutes or hours late. The author then looked at code older than what they had saved, and nothing said so.

Two causes were found.

1. **The pack watcher dropped events itself. Fixed in #342.** libuv serves every directory `fs.watch` in a process
   from one FSEvents stream. Opening or closing any directory watch rebuilds that stream "SinceNow", which discards
   undelivered events. The watcher replaced about 27 watches on every pass.
2. **FSEvents itself stalls, for every process at once, and raises no drop flag. Partly addressed by #408.** During one
   stall, `fseventsd` ran at 109% CPU.

## Evidence

All of it is in `docs/archive/references/evidence/dev-loop-freshness-2026-11-04.md`. Its last three sections are the
ones that matter here.

**A 12.2-hour recorder** made a save every 30 s, 1,439 saves in all, and watched them through three routes at once:

| Route | Late or missing, load <10 | Load 10–25 | Load 25+ | Slowest delivered |
|---|---|---|---|---|
| FSEvents, `fs.watch` on a directory | 12 of 479 | 107 of 561 | 174 of 399 | 20,983 s |
| FSEvents, `fsevents` package (chokidar 3, Vite) | 41 of 479 | 149 of 561 | 200 of 399 | 20,984 s |
| kqueue, `fs.watch` on one file | 0 | 0 | 0 | 0.12 s |

- 249 saves never arrived through either FSEvents route, and no `MustScanSubDirs` or drop flag was raised.
- So a library that rescans when it sees a drop flag would not have caught them. Watchman and `@parcel/watcher` both use
  FSEvents on macOS. This is the strongest single fact here.
- The recorder and its report are not in the repo. They were in a session scratchpad and are gone.

**What libuv does on macOS:**
- `fs.watch` on a file uses kqueue. `fs.watch` on a directory, recursive or not, uses FSEvents.
- Node offers no kqueue watch on a directory.

**How kqueue file watches behave, from probes:**
- **Arming:** a watch is armed only when the event loop next polls, both after it opens and after each event.
  - A save made in the same turn as the open is missed: 0 of 50 caught.
  - With one turn through the poll phase in between, 50 of 50 in-place saves and 50 of 50 replacing saves were caught, twice.
- **Replaced files:** a save that replaces the file (write a new file, rename it over the old) leaves the watch on the old inode. The watch has to be reopened on the new file.
- **Replace during a blocked turn:** if a save replaces or deletes a file while the process is blocked, and a `hold` in that same turn closes the old watch, the old watch's event is never delivered. A probe missed 20 of 20. #408 fixes this; see below.
- **Cost:** 1,200 file watches open in 36–38 ms and close in 5–6 ms. The in-process fd limit is 1,048,576, though `launchctl`'s soft limit reads 256.
- **No effect on FSEvents:** opening and closing file watches does not disturb the FSEvents stream. A directory watch beside them lost 0 of 300 saves.

**Soak, `npm run soak:watch`:** each round edits one file to start a pass, then edits a probe at a random moment within it.
- **After #342** (corrected witness): 35 of 40 picked up. All 5 misses were FSEvents never delivering, not the watcher dropping.
- **#408, normal mode,** at load 30–147: 40 of 40 picked up. FSEvents happened not to stall.
- **#408, `--files-only`** (no directory watches), at load 107–237: 40 of 40 picked up, 20 of them replacing saves.
  - This run used `npm run stress -- --busy 10`. The median round took 15 s and the slowest 48 s.
  - The bystander's `fs.watch` saw every save within 125 ms, and a chokidar 3 witness set up like Vite's within 713 ms.
  - FSEvents never stalled in any soak run, so no soak has shown a rescue by kqueue directly. The rescue rests on the recorder.

## Merged work

| PR | What | State |
|---|---|---|
| #338 | ears API watch | merged |
| #340 | dev-loop freshness: package builds, early cutoff | merged `3df2840a2b` |
| #342 | `createInputSubscriptions` keeps watches open; one recheck pass when the held set moves | merged `0c9207dbc7` |
| #345 | `npm run soak:watch`, and a macOS native case in `compiler-macos.yml` | merged |
| #408 | kqueue watch on each known input file of the pack watcher, darwin only | merged `149c8786d7` |

#408 is four commits:
1. `3b0a0ae131`: `createFileWatches` and the pack watcher's use of it.
2. `6323523965`: a watch closed by `hold` before it reported its file being replaced or deleted (a `rename` event) reports it then.
3. `34287ae9b4`: `soak:watch --files-only`, backed by `WatchOptions.directoryWatches`, plus the route witnesses.
4. `7f34c331e8`: evidence doc.

Its strict chain (42747373337) and macOS case (42750262764) passed on `34287ae9b4`. The results comments are on the PR.
Its worktree is `../monorepo-worktrees.noindex/watch-kqueue`, on the branch `session/watch-kqueue`.

## Code map

Everything below is on master.

- **`packages/apack-cli/src/build/watch.ts`:** the pack watcher, run by `startPackBuildWatcher`.
  - `refreshInputs` holds the directory subscriptions: the pack root, authored targets and compiler targets.
  - `fileWatches` holds `packInputFiles(root)` plus the `file` entries of `packageInputWatchPaths`.
  - `coalescingRunner` debounces and coalesces requests for a pass.
  - Each pass compares input signatures, so events are hints and the inputs are the truth.
- **`packages/apack-cli/src/build/input-subscriptions.ts`:** `createInputSubscriptions` (directory watches, held open) and `createFileWatches`, which handles kqueue arming, inode keys and replace-on-close.
- **`packages/apack-cli/src/build/compiler-watch.ts`:** `packageInputWatchPaths`, which lists package input files from disk via `inputFiles`, so untracked files are included.
- **`packages/apack-cli/src/build/frontend-watch.ts`:** the frontend watcher. It uses chokidar 3 with default options, so on macOS its events come from FSEvents. Its guard watches go through `createInputSubscriptions`.
- **`packages/apack-cli/src/build/frontend-process.ts:115`:** a directory `fs.watch`, so FSEvents.
- **`packages/dev-mode.js`:** `npm run dev`. One process runs Vite's renderer dev server (`createServer`). It spawns:
  - the default-setup pack build and watcher, `build:dev -w @app/default-setup`;
  - the API's `tsup --watch` (`build:dev:watch` in `packages/api/package.json`).
  - So **three processes** each watch on their own.
- **`packages/main/src/modules/api-server/dev-reloader.ts:90`:** `fs.watch` on the API bundle file, so kqueue.
- **`packages/default-setup/src/features/code/be/services/gitwatcher.ts`:** watches the *user's* repositories. This is a product feature, not the dev loop, and a separate question.
  - It watches the working tree and the git directories through `services/directory-watch.ts`: Node's recursive `fs.watch` on macOS and Windows, so FSEvents on macOS, and `@parcel/watcher` on Linux, which has no watch over a tree.
  - **Why `@parcel/watcher` is not loaded on macOS or Windows** (measured 2026-11-10: darwin arm64, Node 24.16.0, `@parcel/watcher` 2.5.6, load 5 to 8):
    - **Its macOS backend frees its event stream twice.** When the watched directory is deleted, `FSEventsCallback` stops and releases the stream on its own thread without the lock, while `unsubscribe` does the same on a worker thread (`src/macos/FSEventsBackend.cc`). Upstream has it open as #271; the file is the same on its main branch and in 2.6.0.
    - With the library alone in the process, 8 processes of 200 rounds each:

      | Sequence | Died of heap corruption |
      |---|---|
      | close one watch, delete its directory in the same turn | 7 of 8 |
      | start closing, one event-loop turn, delete | 8 of 8 |
      | close two watches (tree and `.git`), delete | 4 of 8 |
      | delete, one turn, close and wait | 1 of 8 |
      | close and wait, then delete | 0 of 8 |
      | create and delete subdirectories, then close | 0 of 8 |

    - Node's `fs.watch` over the third, fourth and sixth sequences: 0 of 8 each.
    - In this repo it killed a spec worker about one run in three, since a spec stops the code system and deletes its directory. macOS filed five reports that day, each `memory corruption of free block` in a process with the binding loaded, three of them caught inside elmdb's allocations: the watcher shares its process with the database.
    - **Its Windows backend** frees a subscription whose `OVERLAPPED` the kernel still holds, on every `unsubscribe` (upstream #262, open). Read against the shipped source, not run.
    - **Its Linux backend** handles a deleted directory under the lock `unsubscribe` takes. Read, not run.
    - **Cost on macOS**, same day. One write reached JavaScript in 9 to 11 ms through `fs.watch` and 63 to 65 ms through the library (median of 20). A 20,000-file flood written by another process cost the watching process 80 ms of CPU through `fs.watch` and 635 ms through the library. The same flood inside an ignored directory cost 63 ms through `fs.watch`, which drops its 20,401 callbacks in JavaScript, and 3 ms through the library, which never hears of them.
    - **A directory deleted and made again at the same path:** `fs.watch` on macOS reports on the new one. The library reports nothing more, so its subscriber says the watch ended.
    - **What `fs.watch` gives up:** libuv skips FSEvents' dropped-event flags (`kFSEventsSystem`, `src/unix/fsevents.c`), so a drop is not an error here. The recorder above saw FSEvents raise none for 249 lost saves, and reading again is what covers a loss either way.
    - **Why not Node's watch on Linux too:** it opens a watch on every file as well as every directory, and reads the whole tree before it returns (`lib/internal/fs/recursive_watch.js`, v24.16.0).
    - The scripts were in a session scratchpad and are not in the repo.
  - It treats an event as a hint: git is asked whether the status or a ref changed, and only a difference is announced.
  - What no event reported is found by reading again when a window gains focus, a terminal command finishes or an agent's turn ends (`CHECK_FOR_EXTERNAL_CHANGES`).
  - `services/open-file-watcher.ts` beside it watches each file open in an editor with chokidar's per-file `fs.watch` mode (`useFsEvents: false, usePolling: false`), so kqueue.
- **Soak:** `packages/apack-cli/scripts/soak-watch.ts`, `soak-bystander.mjs`, `soak-rounds.ts`, with `tests/build/soak-rounds.spec.ts`.
- **Tests:**
  - `tests/build/input-subscriptions.spec.ts` and `tests/build/watch-retry.spec.ts`: unit tests, with `fs.watch` faked.
  - `tests/build/input-subscriptions.native.spec.ts`: macOS only, run by `compiler-macos.yml`.

**Library versions in this tree:**
- Vite 7.3.7 bundles chokidar 3.6.0, which uses the `fsevents` package on macOS.
- tsup 9.0.0 depends on chokidar ^5, which has no `fsevents`. **Unverified:** chokidar 4 and 5 watch each file with `fs.watch`, which would be kqueue. If so, the API's `tsup --watch` may already be on kqueue for existing files.
- The frontend watcher uses chokidar 3.6.0.

## Open items

1. **Hot reload.**
   - **What's covered:** with #408, a save reaches the pack watcher.
   - **What isn't:** the renderer's Vite server, the API's `tsup --watch` and the frontend watcher each learn of it on their own. Any of them can serve or run code older than what was saved.
   - **Not measured:** how often this happens in real use.
2. **New files that nothing imports.**
   - **Why it matters:** default-setup's content sources are picked up by folder (`apack.json` `content.sources`). A new prompt or action file is therefore a real case, not only a code file waiting for its import.
   - **What we have:** Node has no kqueue watch on a directory, so new files still arrive only through FSEvents, and that is subject to the same stalls.
3. **Window-focus check.** Not built.
4. **Linux and Windows.** Not examined. The stall has not been observed there.

## The rejected plan, and why it is weak

Proposed:
1. A "dev-session file-change hub" in `@apackdev/host/build` owning every kqueue watch.
2. A Vite plugin registering module-graph files with it and calling `server.watcher.emit('change')`, deduped by file identity.
3. Replacing `tsup --watch` with a script on tsup's build API, driven by the hub.
4. Moving the frontend watcher onto the hub.
5. For new files, re-scanning input folders on pass, window focus and git events.

Estimate: about 3 days for the hub and its consumers, plus about 1 day for the re-scan.

**Why it is weak:**
- **It builds infrastructure before checking configuration.** chokidar has a non-FSEvents mode that watches each file with `fs.watch`, which is kqueue.
  - In chokidar 3, `useFsEvents: false` alone switches macOS to *polling*: `usePolling` defaults to `isMacos` when `useFsEvents` is false. `usePolling: false` must be set too.
  - Vite exposes chokidar options as `server.watch`.
  - So Vite and the frontend watcher may get kqueue per file from two options. tsup 9 (chokidar 5) may already have it.
  - None of this was tested before proposing a new subsystem.
- **The "hub" spans three processes** (`dev-mode.js`, the pack build, `tsup`). "One owner" then means an IPC channel and a lifecycle that does not exist today, which is a bigger change than it sounds.
- **It hand-rolls a second watcher inside Vite** by reaching into `server.watcher`. That is version-coupled, and duplicating events is the main risk.
- **It treats "events are hints" as solved only for the pack watcher.** It doesn't ask whether the dev session could assert freshness end to end, so that a missed event is detected wherever it happened. An example would be the app or each server reporting the identity of the inputs it built from, compared on focus against disk.
- **The new-file re-scan triggers were chosen by hand** (focus, git) rather than derived from what actually adds files.
- **There was no plan to measure first.** The recorder is gone, and nothing in the dev session counts stale serves today.

## Leads for a better path (each a hypothesis to verify)

- **Configuration first.**
  - Set Vite's `server.watch` to `{ useFsEvents: false, usePolling: false }`, and the same for the frontend watcher's chokidar. Then confirm with the existing soak witnesses, or a native case, that file events now arrive by kqueue.
  - Measure the fd count, since chokidar's node-fs mode opens one watch per file and per directory.
  - Check chokidar's handling of replaced files in that mode; it has an `atomic` option.
  - Verify whether tsup 9's chokidar 5 already watches files one by one.
- **New files under chokidar's node-fs mode:** directories are still watched with `fs.watch`, which is FSEvents, so new files remain on FSEvents. This item still needs its own answer.
- **End-to-end freshness, if per-route fixes are not enough.**
  - Each producer (the pack build, the API bundle, Vite's served modules) records the identities of the inputs it last built from.
  - The dev session checks them against disk on a meaningful trigger and rebuilds what is stale.
  - This is the Bazel and Buck stance ("events are hints, verify with content"), and it covers new files and every route at once. The cost is defining the identity per producer.
- **Measure before building.**
  - Restore a recorder, or add a dev-session counter of "built from stale inputs" detections, so any fix can show what it rescued.
  - The `soak:watch` witnesses already time `fs.watch` and Vite's chokidar route per round.

## Constraints from the user (standing)

- No attribution lines in commits or PRs. Never `git stash`. Never kill processes by pattern, only by a captured PID.
- Never launch the app without an isolated `APACK_USER_DATA_DIR`.
  - Never read or write `~/Library/Application Support/apack` or `~/Library/Logs/abuddy`.
  - Never touch `main.jsonl`.
- Don't edit version or release metadata. Don't merge unless asked. No draft PRs. Remote branch deletes need an explicit ask.
- No mutation testing of process-control code on this machine.
- Use Node 24.12 or later (`$HOME/.nvm/versions/node/v24.16.0/bin`); the shell defaults to 23.11.1.
- New tests add no wall-clock deadline (`spec-waits.spec.ts`). Use `settles()` from `@apackdev/sdk/testing/waiting`.
- No polling or timer-driven workarounds; prefer event-driven designs.
  - The user wants options with real trade-offs, not an elaborate refactor by default.
  - The user wants plain, succinct writing.
- Native and watcher cases go in `*.native.spec.ts`.
  - macOS-only cases run in CI: `gh workflow run ci.yml --ref <branch> -f compiler_macos=true -f compiler_macos_test='<test-name regex>'`. This takes test names, not file names.
  - Strict acceptance: `-f strict_chain=true`.
- Prove timing work under load: `npm run stress -- --runs 1 --busy 10 <command>`, with the command unquoted.

## Remaining housekeeping

- #408 is merged. Its remote branch `session/watch-kqueue` and its worktree `../monorepo-worktrees.noindex/watch-kqueue` still exist, waiting on the user to delete them.
