# Actual syscall I/O faults and post-migration preservation — 2026-10-31

The user confirmed OrbStack's move to Seagate complete and verified and resumed work without configuration,
installation or branch changes. A read-only container first verified the preserved native snapshot data.mdb
and exact 2441 binding/CLI digests against pre-migration values. All three match; the checkpoint is not opened
or modified. New performance readings must name this changed storage boundary: older internal-storage
measurements cannot establish a causal post-migration speedup.

At frozen runtime source `1d7a3de090d74028ca36eba574686da8c794609a` (same production behavior through
66e8531079 before the uncommitted prefix prototype), **18 actual syscall-fault observations pass**:
write/bulk-load/outer-unit/schema crossed with sync/write and before/after, plus two read-only open faults.
A half-CPU/768-MiB/no-swap/cap-drop-ALL Linux arm64 container compiles a private interposer, then each case
uses a fresh owned temporary database and normal SQLite/EARS implementation at FULL=2/checkpoint=1000.
The source volume is read-only. No JavaScript SQL or commit method is replaced. strace is absent in the
existing image; no package/configuration/production dependency was added.

The interposer resolves /proc/self/fd and requires one exact owned file path and a one-shot arm marker.
Only the matching fsync/fdatasync, pwrite/pwrite64 or pread/pread64 fails with EIO. Before mode prevents that
one call; after mode performs the actual successful syscall and then reports EIO. The event records which
call ran, its actual result and the injected error. All other operations use their ordinary Linux syscall.
Every case requires exactly one event; an injector-disabled control must fail rather than pass vacuously.
The guard does refuse that control. Exact C/JS/runner sources, digests, compiler command and binary digest
are retained; the compiled library and all temporary database payloads are not checked into Git.

All sixteen mutation failures occur with an ended transaction and report COMMIT_UNKNOWN with the original
SQLITE_IOERR cause. The database refuses further reads/writes/sequence access using the same error, rejects
index readiness and sends no extra watch notification. It closes and reopens cleanly. In **every observed
case**, reopening finds only the incumbent row at the old sequence; a new recovery write increments once,
and read-only reopen retains it. Schema cases retain the incumbent declaration; outer units retain none
of their staged rows. Both actual open/read faults preserve the main-file hash and refuse with IOERR.

These are actual low-level error-return injections, not failing-device/power-loss tests. Even after a
successful sync followed by injected EIO, SQLite rolls back in these observations. They do not prove an
actually committed write survived an acknowledgment loss; that branch still has separate driver-level
fault coverage. Active native-worker/host media/uncertain publication recovery and other physical/resource
conditions remain required. Passing this matrix closes the basic syscall-fault evidence gap, not phase 6
or the complete goal. Total diagnostic duration195.46s is not a storage performance benchmark.

A separate backend sampled-stack attribution attempt stops before API readiness at its unchanged45-second
startup observation bound, with zero activation cases and no API log output. That failure is preserved.
Small subsequent controls pass syntax, tsx-only, old-hook and new-hook imports (0.02/0.39/1.19/0.68seconds).
They exclude a persistent preload syntax/import failure but do not explain the application startup timeout.
The subsequent [old/new application-startup control](../activation-startup-controls-after-migration/README.md)
reaches readiness with both hooks, but pack activation exceeds its unchanged 30-second observation bound.
No timeout was relaxed and no activation/renderer fix is claimed from these controls.
