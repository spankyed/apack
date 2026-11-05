> **Deferred, and partly done.** Phase 1 shipped — taking the write lock is atomic now
> (`openSync(file, 'wx')`), which fixed a live bug in which six processes racing all acquired it, and
> `write-lock.spec.ts` gained the concurrent case the suite never had. Phases 2 and 3 (asking the API and
> the dev server whether they answer, rather than inferring it from a pid) are unstarted and independent
> of the rest. Phases 4 and 5, the advisory lock itself, are deferred **on value, not on a dependency**:
> the spike below settles which package to use, measures it working, and records what it does not cover —
> no musl build, so it would take `apack db` off Alpine, where the current pure-Node acquisition runs.
> Read the Recommendation before picking this up.

> **Written in session** `358d44db-c4f3-4dfe-89d3-40b001a63086` (Claude Code, 2026-09-20). Resume it with `claude -r 358d44db-c4f3-4dfe-89d3-40b001a63086`.

```
# Goal: a lock the kernel releases, and liveness questions asked of the thing itself

Implement docs/goals/goal-write-lock-advisory.md on AS/external-pack-authoring, at or after
b1eaa70f4 — the base its Background was surveyed at.
Before Phase 1, confirm the base: `packages/apack-host/src/database/write-lock.ts` writes a JSON lock
file and resolves it with `lockIsHeld`, and `packages/apack-host/src/process-liveness.ts` exports
`lockIsHeld`, `recordIsStale` and `readApiEndpoint`. If they don't, stop and say so — the plan was
surveyed somewhere else.
Read Background, Decisions, Spike results, Phases, Tradeoffs and Constraints first. Phase 0 is done and
its result is recorded: Phase 3 uses `fs-native-extensions`, directly, for its synchronous `tryLock`.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code: change signatures, move modules, migrate every in-repo caller,
test, fixture, template and doc in the same change, and fix forward. Stored user data is the exception:
it moves with migrations.

Finished when:
- Phases 1–3 are implemented and each meets its "Done when". Phases 4 and 5 are deferred by the
  recommendation below, with the spike kept so the question stays answered. Every new guard, helper or
  test is mutation-checked.
- `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm test`, `npm run test:external-pack`
  all pass; `npm run api:update` run and `etc/` committed if a public entry changed.
- A final summary: phase → done/deferred, evidence, and the conventional choices made.

Commit as you go:
- Commit each phase when its "Done when" holds and the checks are green — not once at the end. A
  phase is landable on its own; a commit is how that stays true. Conventional message, no
  Co-Authored-By or session lines, `git commit -- <paths>` naming only that phase's files.
- Check `git diff --cached` first: something outside the session stages files, and a pathspec commit
  leaves the rest of the index alone.
- Don't push, tag, or open a PR unless the user asks.

Never:
- push, tag or open a PR unless the user asks in this session.
- npm publish, create GitHub releases, or trigger workflows (dry runs only).
- open, copy or modify ~/Library/Application Support/apack* or any real data dir.
- pkill/killall Electron or node; launch the app outside the test env without an isolated
  APACK_USER_DATA_DIR.
- run bare tsc on packages/preload, `npm install` in the example pack, or edit version/release
  metadata.
- change the typed EARS types' behaviour (packages/apack-sdk/TYPED-EARS.md) to make a call site compile.
- add backward-compat shims or loosen a failing assertion instead of investigating.
- use `proper-lockfile` or any heartbeat-based lock. Its heartbeat lapses under the synchronous LMDB
  work the lock protects, producing the exact double-writer it prevents (Decision 5).
- let locking fail open. If the lock cannot be taken or read, a write must be refused (Decision 6).
- remove `lockIsHeld`. The app's own `app.lock` marker is not a lock to take, only a statement that a
  process is using the data dir, and a pid check is what answers that (Decision 1).
```

## Sequencing: read `goal-lmdb-only.md` first

This was surveyed while `db-write.lock` guards every write of `apack db`. It does so because the app keeps
the database in memory, and a tool's change would be overwritten by the app's next write from its stale
copy. `goal-lmdb-only.md` deletes that copy.

After it, the lock guards `import` and `reset` alone — the two commands that close the env and replace its
files, which is the one thing LMDB's own multi-process locking cannot cover (its Decision 8). `app.lock`
narrows the same way. That is a much smaller thing to protect, and the case for adding a cross-platform
native dependency to an app that also ships an npm-installed CLI is correspondingly weaker.

So: **settle `goal-lmdb-only.md`'s open decision on the locks before starting Phase 3 here.** Phases 1 and 2
are unaffected — they replace pid checks with asking the endpoint, which is right either way.

Measured 2026-09-20, in case it looks like a shortcut: `lmdb-js`'s `tryLock`/`hasLock` are **not** a
cross-process lock — two processes both take one on the same env — so the dependency Phase 0 settled on is
not already in the tree.

## Background

Surveyed at `b1eaa70f4` on `AS/external-pack-authoring`.

**A correction first.** This work was recorded as "it would delete the `lockIsHeld`/`recordIsStale` split
entirely". That is wrong, and the survey is where it shows. Four call sites use the predicates, and an
advisory lock can replace exactly one:

| Record | Written by | Can an advisory lock replace the liveness check? |
|---|---|---|
| `db-write.lock` (`write-lock.ts:57`) | our tools | **Yes.** A mutual-exclusion lock held for a duration is what `flock` is |
| `app.lock` (`running.ts`) | the Electron main process | **No.** Not a mutual-exclusion lock: `requestSingleInstanceLock()` is what keeps one app per data dir, and this only publishes that it is using one. Since 2026-09-20; this row read Chromium's `SingletonLock`, which we did not write |
| staging dirs (`staging.ts:30`) | our installer | No. A record of an install that was in progress, read once at boot, not a lock |
| dev-server marker (`dev-server.ts:75`) | `apack pack dev` | Not by a lock — but the question has a better answer (Decision 2) |

**Acquisition was not atomic, and that is the bug that mattered.** `holdDatabaseWriteLock` called
`findDatabaseWriter` and then wrote the file with `writeFileSync` + `renameSync`, which overwrites. Check,
then act. Six processes released at the same instant all reported acquiring it:

```
results: ["ACQUIRED","ACQUIRED","ACQUIRED","ACQUIRED","ACQUIRED","ACQUIRED"]
holders at once: 6   <-- MUTUAL EXCLUSION FAILED
```

Not a staleness problem and not a kernel-release problem: the mechanism whose only job is mutual exclusion
provided none under concurrency, in shipped code. `openSync(file, 'wx')` makes the create the acquisition,
and the same race then yields one holder. **This reorders the whole goal** — the deferred note pointed at
staleness, and the thing actually broken was underneath it.

**What the write lock's residual failure actually is.** The handlers are registered *before* the file is
written, so `SIGINT`/`SIGTERM`/`SIGHUP` and normal exit all release it; `write-lock.spec.ts` pins that.
What is left is `SIGKILL` and power loss, and the recovery is one `rm` behind an error that names the
file. That is the whole of what an advisory lock buys here.

**Where a native module would land.** `holdDatabaseWriteLock` is called from
`apack-cli/src/commands/db/target.ts:90` — the **published** CLI. A native dependency in this path
becomes a dependency of every pack author's `npm i @apackdev/cli`, on every platform they use, not just the
`mac-arm64` the app ships as.

**The ABI constraint.** The packaged app is Electron. `@napi-rs/keyring` works there because N-API is
ABI-stable across Node and Electron. A `node-gyp`/NAN module (`fs-ext` and its relatives) needs
`electron-rebuild` and a binary per Electron version — a build chain this repo does not have.

**Two of the four questions have exact answers that need no lock at all.** `readApiEndpoint` and the
dev-server marker both exist so a caller can decide whether to talk to an endpoint. Asking the endpoint is
both exact and cheaper than inferring it from a pid and an mtime — and it catches a process that is alive
but no longer serving, which no pid check can. The pack watcher already works this way: `findAppApi` reads the port and lets the request fail
(`apack-cli/src/app/app-api.ts`).

## Decisions

1. **`lockIsHeld` stays.** Its other caller is the app's own marker, `app.lock`, which the main process
   publishes while it runs. A pid check is what is available there — the marker says a process is using the
   data dir, not that it holds a lock we could try to take — and the `held`-shaped bias is still right:
   missing a live app lets a tool write under it. The marker names itself in the refusal, so a leftover
   whose pid the OS has reused is recoverable rather than permanent.

   *(This read "Chromium's instance lock is not ours to change" until 2026-09-20. We write the marker now,
   which changes the reason but not the decision.)*

2. **The API port file and the dev-server marker ask the endpoint, not the pid.** `readApiEndpoint`
   becomes "the API that answers on this data dir", and the `pack://` handler's marker check becomes
   "the dev server that answers". Both are exact where the pid check was an estimate.

3. **`recordIsStale` stays for staging recovery.** It runs once at boot over directories nothing is
   listening on; there is no endpoint to ask, and the cost of being wrong is a directory restored that
   did not need it.

4. **The lock file keeps the information; the lock carries the authority.** `db-write.lock` still holds
   `{ pid, machine, what, since }`, so `findDatabaseWriter` can still say *"apack db import (pid 1234)"*.
   What changes is that "is it held" is answered by the advisory lock rather than by reasoning about the
   pid. A file with no lock behind it is a leftover, not a holder.

5. **No heartbeat locks.** `proper-lockfile` and anything else that renews an mtime lapses under the
   synchronous LMDB work the lock protects, producing the double-writer it exists to prevent.

6. **Locking fails closed.** If the addon will not load, or the filesystem will not honour the lock, a
   write is refused with an error saying why. The current scheme degrades to a pid guess; the new one
   must not degrade silently to nothing.

## Spike results (Phase 0, run 2026-09-20)

**Settled: `fs-native-extensions` (1.5.1), used directly.** Every bar item in the former Open decision 1
holds, and the two that were risks turned out not to be.

| Candidate | Verdict |
|---|---|
| `fs-ext` 2.1.1 | **Rejected** — depends on `nan`, so it needs `electron-rebuild` and a binary per Electron version |
| `flock` 0.3.10 | **Rejected** — not a file lock; an evented key-value cache with the name |
| `proper-lockfile` 4.1.2 | **Rejected** by Decision 5 — heartbeat |
| `fd-lock` 2.2.0 | Works, but pulls 20 packages and wraps the lock in an async `ReadyResource` class |
| **`fs-native-extensions` 1.5.1** | **Accepted** |

What was measured, not assumed:

- **N-API.** Built with `cmake-napi`, loaded by `require-addon`, no install or build script. The same
  camp as `lmdb`, which `electron-builder.mjs:115` already relies on ("lmdb uses NAPI prebuilds, only
  node-pty needs rebuild").
- **Prebuilds** for 13 platforms, covering all four the bar named: `darwin-arm64`, `darwin-x64`,
  `linux-x64`, `win32-x64`.
- **Loads under Electron 37.2.4 (ABI 136) with no rebuild.**
- **Mutual exclusion across runtimes, both directions.** Electron holds → Node's `tryLock` returns
  false; Node holds → Electron's returns false. This was the case the Constraints said to test first.
- **`SIGKILL` releases it, both directions.** The killed holder's lock is takeable immediately after,
  which is the single thing this whole change is for and the one failure the current scheme cannot fix.
- **The lock file survives the kill as a leftover** — which is Decision 4 arriving for free: the file is
  information, the lock is authority.
- **The primitive is the right one on each platform**, read from the shipped C source: macOS
  `flock(LOCK_EX|LOCK_NB)` (`src/apple.c`), Linux `fcntl(F_OFD_SETLK)` (`src/linux.c`), Windows
  `LockFileEx` (`src/win32.c`). Linux using **OFD** locks rather than classic `F_SETLK` is the detail worth
  checking before depending on anything like this: `F_SETLK` drops every lock a process holds on a file as
  soon as *any* descriptor to it closes, so the naive implementation is one whose locks silently evaporate.
  OFD locks are tied to the descriptor and don't. Needs Linux 3.15+ (2014).
- **Weight:** 6 packages, 1.7 MB installed across all prebuilds, 76 KB for the `darwin-arm64` binary.
  Each platform directory carries a `.node` and a `.bare` (the Bare runtime's), so about half of the
  1.5 MB is weight this app would never load. Nothing compiles at install.
  `fd-lock`'s 20 packages and async wrapper buy nothing: the lower layer's `tryLock`/`unlock` are
  **synchronous**, which is the shape `holdDatabaseWriteLock` already has.

**What it does not cover, which is the finding that decided this.**

- **No musl prebuild, and no build fallback.** `prebuilds/` has `linux-x64` and `linux-arm64`, both glibc;
  there is no `linuxmusl-*`, and the package has no install script to fall back to. On Alpine,
  `require-addon` finds no binary and throws at require time. `holdDatabaseWriteLock` is called from
  `apack-cli/src/commands/db/target.ts`, so this is a hard failure in the **published** CLI, on a
  platform Docker users reach by default — not a degradation. 32-bit Linux ARM is missing for the same
  reason.
- **Advisory on POSIX, mandatory on Windows.** `LockFileEx` is enforced by the OS, so a held range can
  raise sharing violations on other handles; `flock`/OFD do not. The platforms do not behave alike, and a
  leftover lock is a different kind of problem on each.
- **macOS locks whole files only** — BSD `flock` has no ranges, so `offset`/`length` are ignored there.
  Harmless here, since a whole-file lock is what this wants.
- **Only `darwin-arm64` was run.** Load, exclusion both ways and the `SIGKILL` release were measured on
  this machine; the other twelve prebuilds were inspected, not executed.

**Windows, for both schemes.** `openSync(file, 'wx')` is atomic there (`CREATE_NEW`), and
`process.kill(pid, 0)` answers existence there, so acquisition and take-over work. What is weaker is
release on interruption: Windows has no real `SIGTERM`/`SIGHUP`, and `taskkill /F` ends a process with no
handler at all. `SIGBREAK` was added to `INTERRUPTS` to cover Ctrl-Break — it registers harmlessly on
POSIX and `process.kill` refuses the name there, so the suite exercises the three it can send and the
fourth is covered by code alone. The unconditional-end route stays, and is the same class as `SIGKILL`:
the case an advisory lock would close.

**What the current scheme covers that this doesn't.** `openSync(file, 'wx')` is plain Node with no native
code, so it works wherever Node does — Alpine and 32-bit ARM included. The trade is not "native lock is
better": it exchanges a loud, recoverable failure on *every* platform for no failure on *most* and a
require-time crash on the rest. Decision 6 (fail closed) is what keeps that crash from becoming a silent
loss of exclusion, and it is why Decision 6 is not optional.

Two risks closed rather than mitigated:

- **The asar question is moot.** `electron-builder.mjs:163` sets `asar: false`, so there is no archive to
  unpack from.
- **The synchronous-API worry is moot.** `tryLock(fd)` and `unlock(fd)` are sync, so `holdDatabaseWriteLock`
  keeps its signature and its callers don't become async.

## Open decisions

None. Open decision 1 is settled above.

The bar, all of which must hold:

- **N-API / ABI-stable**, so the same binary serves Node and Electron with no `electron-rebuild` step.
- **Prebuilt binaries** for at least `darwin-arm64` (the app), plus `darwin-x64`, `linux-x64` and
  `win32-x64` (pack authors running the published CLI) — or a pure-JS fallback that satisfies Decision 6.
- **Works from an asar-unpacked app bundle**, as `@napi-rs/keyring` does.
- **Maintained**, with the lock released by the kernel on process death — the property this is all for.

If nothing clears it, the options are: write a small napi-rs addon in-repo (adds Rust and
cross-compilation to the release chain, for one function), or **reject Phase 3** and keep the pid-based
write lock. Rejecting is an acceptable outcome; Phases 1 and 2 stand on their own and are where most of
the value is.

## Phases

### Phase 0 — the spike

**Done.** See Spike results.

### Phase 1 — acquisition is atomic

**Done.** `takeLock` opens with `wx`, so the create is the acquisition. A lock a killed tool left is still
taken over, but only after re-reading it, so the removal cannot take a lock someone else has since taken.
`write-lock.spec.ts` gains six real processes racing for it.

**Done when:** one of six racers acquires. **Mutation:** `w` in place of `wx` fails that test.

### Phase 2 — `readApiEndpoint` asks the API

It connects to the port it read rather than checking the publisher's pid. A file naming a port nothing
answers on reports no API, as it does today; a file naming a port something *else* now holds stops being
reported as ours, which the pid check could not tell.

**Done when:** `findRunningApp` and `apack pack dev` still report a running app, `process-liveness.spec.ts`
covers a port nothing listens on and one a different process holds, and no caller passes a pid to decide
this. `running-app.spec.ts` keeps its case for a wedged API, which `app.lock` answers and the port alone
would not. **Mutation:** removing the connect check makes the "port nothing answers on" case report an API.

### Phase 3 — the dev-server marker asks the dev server

`devServerUrl` returns the URL when the server answers. The diagnosis this preserves is the one
`c74ef2f56` added it for: a marker a crashed `apack run` left behind must not be served from, and the
reason must name the marker.

**Done when:** `dev-server.spec.ts` covers a marker whose server answers and one whose server is gone,
and the failure names the marker file. **Mutation:** serving from a dead marker fails the second.

### Phase 4 — the advisory lock — **deferred, not blocked**

`holdDatabaseWriteLock` takes an exclusive non-blocking lock on `db-write.lock` and holds it for the
tool's life; `findDatabaseWriter` reads the file for *who* and tries the lock for *whether*.
`assertNoDatabaseWriter` is a lock attempt, not a pid check. The interrupt handlers and the `exit`
listener stay — they remove the file, which the kernel does not — but they stop being what makes the
lock correct.

**Done when:** a child killed with `SIGKILL` while holding the lock leaves a data dir the next tool can
lock, which `write-lock.spec.ts` currently documents as impossible. **Mutation:** not holding the lock
past acquisition lets a second holder in.

### Phase 5 — the filesystem the lock is on (only with Phase 4)

A data dir on a network or synced filesystem is where advisory locks are least reliable. Detect at
acquisition whether the lock is honoured (take it, attempt to take it again from a child, expect
failure) and refuse the write with an error naming the directory when it is not (Decision 6).

**Done when:** a directory whose locks are not honoured refuses a write rather than proceeding.

## Recommendation

**Phase 1 was the work. Phase 4 is deferred — because Phase 1 took most of its value, not because it is
blocked.**

Once the create is the acquisition, the pid heuristic no longer decides exclusion. It decides only whether
a leftover may be taken over, and `lockIsHeld` is pid-only, so its single failure is a **false held**: a
refusal naming the file, recoverable with one `rm`. There is no silent path left.

What an advisory lock would still buy, exactly:

- the false-held case — a leftover whose pid this boot reassigned, which needs a manual `rm` today;
- the take-over window Phase 1 could not close: removing a leftover and creating your own are two steps,
  because a file's existence carries no liveness;
- about 50 lines — the interrupt and exit handlers, `pid`/`machine`, the take-over branch, the hint.

Against: a permanent native dependency in the **published** CLI, which reaches fewer platforms than the
code it would replace. The spike shows the dependency is cheaper than it was thought to be — prebuilt, no
build tools, the right primitive on each platform, and `apack db` already pulls `lmdb`, a native module
distributed the same way. But it has no musl build, so `apack db` would stop working on Alpine, where
`openSync(file, 'wx')` works today. That is the decisive point: the trade is not a better lock for a worse
one, it is a loud recoverable failure on every platform exchanged for no failure on most and a hard failure
on the rest.

So this is a judgement about value, not a blocker, and on today's evidence the value is thin. Revisit if
the take-over window is ever observed, if a second writer path appears, or if the package gains a musl
build — that last one would remove the only objection that isn't about size.

## Tradeoffs recorded

- **A native dependency in the published CLI, narrowing which platforms it runs on.** Every pack author
  running `apack db` gains 6 packages and 1.7 MB — and loses Alpine and 32-bit Linux ARM, which the
  current pure-Node acquisition supports. Decision 6 keeps that a refusal rather than a silent loss of
  exclusion. The spike measured this rather than assuming it, and it is why the Recommendation defers.
- **The `rm` escape hatch narrows.** Today any stuck lock is fixable by deleting a file, and the error
  says so. With a kernel-held lock, a stuck lock means a live process — so a leaked descriptor in a
  long-lived process would be unfixable without killing it. Mitigated by keeping the file and its message,
  and by the lock being held only for the duration of a `apack db` command.
- **A new silent-failure mode on network filesystems**, where today the scheme merely degrades to a
  guess. Phase 4 exists only because of this, and Decision 6 makes the failure loud.
- **Phase 2 changes what "an API is running" means** — from "the process that wrote this is alive" to
  "something answers on this port". A different process that has taken the port now reads as *not* our
  API, which is more correct; but an API that is alive and wedged reads as not running, where the pid
  check called it running, and for `findRunningApp` — whose job is to stop a tool writing under a live
  app — that is the wrong direction. It must therefore treat *anything answering* as an app, and only a
  refused connection as none.

  **`app.lock` has since softened this.** `findRunningApp` asks the app's own marker first, and the main
  process publishes that for as long as it runs, so a wedged API no longer takes the answer to "no app"
  on its own. The direction still matters for `apack pack dev`, which reads the endpoint alone.

## Deferred

- **Staging dirs and `packages-built`'s lock.** Both could hold an advisory lock. Neither has a failure
  worth the change: staging recovery runs once at boot, and the build lock is the one place that
  deliberately keeps its own copy of the rule.
- **Whether `assertNoDatabaseWriter` should wait rather than refuse.** A blocking lock with a timeout
  would let the app start once a tool finishes instead of telling the user to try again. A behaviour
  change with its own UX question.

## Constraints

- `write-lock.spec.ts`'s existing tests are the contract: the signal cases, the take-over case, the
  another-machine case, and "a release only removes this process's own". A phase that makes one fail has
  the design wrong, except the take-over case, which Phase 3 changes on purpose — a lock nobody holds is
  takeable because the kernel says so, not because a pid is gone.
- The lock must work between a **Node** process (`apack db`) and an **Electron** process (the app's API
  boot). Same file, two runtimes: this is the case to test first in the spike.
- `@apackdev/testing`'s harness and the CLI bundle both inline host; a native dependency must not break
  `npm run packages:check`.
