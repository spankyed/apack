# Cross-process native model service ownership

2026-10-30. Base `1efad34246795ee6286d915e47637fe9c55807ef`; tested overlay in `inputs.json`.
The base is all-platform green in [41013324901](https://github.com/spankyed/apack/actions/runs/41013324901).
[Downloaded base receipts](../native-package-distribution/platform-41013324901/README.md) independently
verify the native binary/source hashes and real contracts. They do not qualify this later ownership overlay.

## Implemented

A native model service claims `.native-model-owner.lock` inside its database directory through pinned
`fs-native-extensions` **1.5.2**. The library supplies Linux open-file-description locks, macOS BSD locks
and Windows LockFileEx; [pinned source](https://github.com/holepunchto/fs-native-extensions/tree/v1.5.2/src)
and [API](https://github.com/holepunchto/fs-native-extensions/tree/v1.5.2#api) describe those operations.
Only `tryLock(fd)` is consumed, through a lazy typed CommonJS load. No hand-written OS binding, ambient
module declaration, PID/TTL takeover or signal-time release is added. Normal readers/module imports do
not load the unused addon. The dependency adds six locked package entries including its JS resolvers;
only the EARS workspace dependency map changes, with no unrelated lock updates or release/version edits.

The inode persists across releases; never unlink a live claim. Independent descriptors/processes cannot
construct competing services. File-claim refusal releases the same-handle claim. Construction cleanup
retains both errors if closing the claim also fails. The descriptor remains held until the training worker
actually exits, including when synchronous database close initiates stopping. Idle services release
synchronously so immediate close/reopen needs no extra event-loop turn; cleanup failure remains a rejected
stop promise. The OS releases ownership at process death. New claim files use mode 0600 on POSIX; Windows
ACL certification remains separate. This is model-service ownership, not a general primary-write or
physical replacement lease. Unmanaged inode deletion and arbitrary/network filesystems are not certified.

## Qualification

All **646 SQLite EARS cases pass**, zero skips, on the final lazy-loader source. Ordinary package builds,
EARS/host types, import boundaries, correctness lint and platform-verifier syntax pass. New coverage proves:

- Same-process independent descriptors conflict, release is idempotent, the inode persists and POSIX mode
  is private; filesystem errors are not rewritten as an owner refusal.
- A real child owns the claim. Another descriptor refuses while it lives, including after a handled
  SIGTERM on POSIX. Force-killing the child releases the claim and a new owner succeeds. Windows exercises
  process-death exclusion/recovery without claiming support for a handled POSIX signal.
- Independent database connections cannot create another model service before or during worker drain;
  after actual worker exit a new service can claim it. Refused construction releases its handle claim.
- Existing read/write/watch, model admission, stopped/reopened recovery and canonical-byte contracts remain
  in the complete suite. Two controls fail exactly their intended assertions: omitting the kernel claim
  defeats child-process exclusion, and releasing early defeats worker-drain exclusion. Original bytes are
  restored and hashed; actual failing names/messages are retained.

Dependency resolution/install disables lifecycle scripts. A small real addon probe confirms that two FDs
in one Linux process exclude each other; loaded Linux ARM64 addon SHA is
`03df06b42b52743304f5004f28a4557bbafa036dd791b8324ed3aa78b15baf84`.
Metadata/focused checks use half a CPU and 768 MiB while other agents validate. Compiler/full checks wait
for the local slot to clear, then run offline in one private container with `--cpus 2 --memory 6g
--memory-swap 6g --cap-drop ALL`. Image tag `apack-linux-test:74d4b8cfe839` resolves to inspected ID
`sha256:0146a4490634fe153ec35c63e7075a4b3e31b1d1a2996d29c77506c5d07b6507`.
No working-agent checkout/dependencies, daily profile or Mac compiler is used. The source test environment
retains the older recorded elmdb binding only as an unused backend dependency; it does not freshly qualify
native pin `006d6cec88`.

The first package check exposes an ambient declaration visible only in EARS' own typecheck. An explicit
reference fixes consuming SDK/testing builds but violates the repository lint rule. The final local typed
lazy loader removes that declaration/reference entirely; the final package build and full suite pass.
Both intermediate failures remain retained and provide no acceptance evidence. Historical runners resume
a private dependency/output volume, apply the base archive plus hashed overlay and record exact commands/
limits; they are not self-contained images. Reports have raw/gzip checksums. Dependencies, compiled addons,
compiler targets, corpus and models are not committed.

## Next integration

Normal app model-owner creation/recovery is still unimplemented. Before enabling it, separate logical
index readiness from optional native completion: startup and pack registration currently await a port
that includes model work/failure. Ordinary ready queries must remain usable while optional training runs;
maintenance/benchmarks need an explicit native wait. Compose claimed recovery and existing drain ownership
only after that split. Live replacement suspension, physical refresh, complete native audit/rebuild/restore,
new dependency OS/architecture and signed/installed qualification, faults, relevance/recall/resource budgets
and full Strict/adoption review remain required. No production composition or daily profile is switched;
the latest real 100k heartbeat still fails the unchanged 16 ms budget.
