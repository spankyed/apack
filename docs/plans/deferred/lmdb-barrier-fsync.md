# An ordering-only sync for LMDB commits on macOS

Status: deferred, 2026-10-24. An option for the cut-over's durability ([ears-storage-layout.md](../../archive/plans/ears-storage-layout.md));
nothing measured or built yet.

## The cost it targets

On disk, a write commits before it returns. What a commit costs is decided by how hard it asks the hardware to
guarantee durability, not by LMDB or its binding. Measured on lmdb-js 3.5.3, macOS, Node 23.11
([goal-lmdb-only.md](../../archive/goals/goal-lmdb-only.md), "Write path"):

| How a commit syncs | Per commit |
|---|---|
| default: a full sync | 3.5–8 ms |
| no sync (`transactionSync` with `NO_SYNC_FLUSH`, `overlappingSync: false`) | 0.015–0.026 ms |

The full sync is LMDB's own choice on Apple. The LMDB that lmdb-js vendors defines its data sync as
`fcntl(fd, F_FULLFSYNC)`, falling back to `F_BARRIERFSYNC` and then `fsync` only when that call fails
(`node_modules/lmdb/dependencies/lmdb/libraries/liblmdb/mdb.c`, the `__APPLE__` definition of `MDB_FDATASYNC`).
`F_FULLFSYNC` makes the drive write its whole cache to the medium before returning. That flush is the 3.5–8 ms, and
it runs on the API's main thread.

the cut-over's current answer is not to sync per commit, syncing in the background instead, which loses up to the
background interval on an OS crash or power loss. This plan is the middle option between that and a full sync per
commit.

## The option

Build LMDB so that on Apple a commit syncs with `F_BARRIERFSYNC` rather than `F_FULLFSYNC`. A barrier sync
guarantees that writes issued before it reach the medium before writes issued after it, without forcing the cache
out.

| | Process crash | OS crash | Power loss | Corruption |
|---|---|---|---|---|
| no sync per commit | safe | loses commits since the last sync | same | none |
| **barrier sync per commit** | safe | **to be measured** | may lose the latest commits | **none expected**: LMDB's copy-on-write commit depends on ordering |
| full sync per commit | safe | safe | safe | none |

What it would buy: every commit ordered on disk at a cost expected well under a full sync, and with it no
background-sync window for the common case. A full sync (`F_FULLFSYNC`) stays available for the writes that must
survive power loss. the cut-over's explicit durable point (`durable()`, or a unit marked durable) would issue it.

## What has to be found out first

1. **The cost.** Build lmdb-js from source with Apple's `MDB_FDATASYNC` defined as `fcntl(fd, F_BARRIERFSYNC)`, and
   run the spike's cases (`goal-lmdb-only.md`'s table: 1,000 creates with a commit per write, a commit per write
   chain and one commit; 1,000 updates in one commit) beside the full sync and no sync, on this machine, with
   `npm run measure`'s conditions. The option is worth taking only if a commit costs well under the full sync. As
   a working line, under ~0.5 ms, at which a commit per write stays affordable.
2. **The guarantee.** What a barrier sync promises on Apple's file systems and drives, from Apple's documentation
   for `fcntl` and `fsync`, written down here with the source. Then checked: a child process writing in a loop,
   killed with `SIGKILL`, reopens intact. An OS crash and a power loss can't be produced in a spec, so for those the
   documented guarantee is what the decision rests on, and this plan says so.
3. **The other platforms.** Linux syncs with `fdatasync` and Windows with `FlushFileBuffers`. Neither has an
   ordering-only equivalent in LMDB's code. Measure what a commit costs on each (the Linux test container, the
   Windows VM), so the durability design doesn't assume macOS's numbers everywhere.

## How it would be built

- **A patched build of lmdb-js.** The change is one definition in the vendored `mdb.c`, so either a maintained
  patch applied before building from source, or a small fork published under our scope. lmdb-js ships prebuilt
  binaries, so either way the app has to build or ship its own: the packaged app's native files, the CI platforms
  and the `build:production` path all change.
- **Or a define, if lmdb-js exposes one.** Check whether its build reads a compile-time define for the sync call.
  If it does, no source patch is needed.
- **Not a Rust adapter.** A commit without a sync already costs ~0.02 ms through lmdb-js. The binding isn't where
  the time goes, so rewriting it would not move this number. Where native work could help is write
  amplification (2–6 keys and a JavaScript-to-native crossing per key for each put), which is a separate question
  answered by profiling the format 4 layout.

## Decision

Take it if the measured cost per commit is low enough to sync every commit, and Apple's guarantee is what is
written above. Then the cut-over's default becomes a barrier sync per commit, with a full sync at explicit durable
points. Otherwise the cut-over keeps commits without a sync, group-committed by a background sync, with the same
explicit durable points. That is the fallback, and it needs no native work.

## Risks

- **Owning a native build.** Every lmdb-js upgrade carries the patch, and every platform the app ships on builds it.
- **A guarantee only documentation can establish.** Power loss and OS crashes can't be exercised in tests, so the
  ordering promise is taken from Apple's documentation rather than proven here.
- **macOS only.** The option changes nothing on Linux or Windows. Their commit costs decide whether the default
  there is the same.
