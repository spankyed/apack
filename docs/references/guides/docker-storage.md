# Docker storage on the development host

OrbStack's shared data location is `/Volumes/Seagate Portable Media/Development/OrbStack` on the
APFS Seagate drive. Keep that drive mounted while OrbStack is running. This is a machine setting:
all worktrees use it without a repository environment variable or dependency change. Keep the backing
storage and recovery-record directories restricted to their owner, as the former home-directory
location was. `~/OrbStack`
is a view of running Linux files, not the backing storage location.

The repository's Linux runner still uses Docker named volumes and its existing CPU, memory and
free-space admission limits. Coordinate one expensive execution owner across worktrees. Preserve
other sessions' containers and volumes; an unused volume is not evidence that its data is disposable.
See [worktree development](../worktree-development.md) and the root
[validation rules](../../../CLAUDE.md#keep-validation-bounded).

## Native test scratch

The maintained `npm run test:linux -- npm run test:native` invocation mounts executable `/tmp` as
3 GiB tmpfs. Its memory is charged inside the existing 6 GiB container limit; CPU and swap limits and
all test deadlines remain unchanged. Fixtures and temporary databases use RAM, while the immutable
compiler copies remain in this checkout's disk-backed `.temp/apack-test-run-*` directories. Normal
teardown removes those copies; the next exclusive Linux source sync removes interrupted runs.

For a focused native Vitest invocation, put `--native-scratch` before the command passed to
`test:linux`. Generic Linux commands and performance experiments retain disk-backed `/tmp` unless
that flag is explicitly selected. This separates disposable correctness fixtures from persistent image
and compiler writes; it does not certify physical-disk durability or speed.

## Before relocating storage

1. Arrange a quiet window with every session using Docker. Check `docker ps` again immediately before
   stopping OrbStack; an earlier clearance does not prevent another session launching a container.
2. Save the image identities, volume names and volume metadata, plus configuration and any recovery
   notes. Record critical checkpoint sizes and content hashes before opening their databases.
3. Stop OrbStack gracefully with `orb stop`. `orb status` prints `Stopped` and returns a nonzero status
   in that state. Keep the old storage intact until the new location is verified.

## Existing data needs an offline transfer

In OrbStack 2.0.5, choosing a new location in Settings → Storage creates a new empty Docker disk;
it does not transfer existing images or volumes. An empty inventory after changing the setting is
not evidence that the original disk was deleted. Inspect the original location before doing anything
else. See the [OrbStack storage discussion](https://github.com/orgs/orbstack/discussions/1003).

The former default on this host is
`~/Library/Group Containers/HUAQ24HBR6.dev.orbstack/data`. Its disk image has an approximately 8 TiB
logical size and a much smaller allocated size. A transfer must preserve sparse holes and run while
OrbStack is stopped. Check the installed copy tool's sparse-file behavior; progress through a large
logical file is not proof that all allocated contents were copied. Preserve the newly created empty
image separately when replacing it, and retain the original disk for rollback.

Verify equal logical sizes and contents before starting OrbStack on the copy. A sparse-aware verifier
must check the union of allocated data ranges from both files, including a destination write in what
was a source hole. Checking source ranges alone can miss destination corruption. Regions outside both
maps are filesystem holes; do not scan terabytes of known zeros to verify them. Preserve verification
receipts and detect source/destination modification during the check. Handle the swap image separately.

## Verify the running destination

After publishing verified images and starting OrbStack with `orb start`:

- Confirm `~/.orbstack/vmconfig.json` names the intended external `data_dir` and the backing image is
  present there. Keep configuration backups private, outside Git.
- Compare Docker image identities and volume names/metadata with the saved inventory. Confirm there
  are no unexpected running workloads before starting a verification container.
- Recheck preserved database files against their original sizes and hashes before opening them.
  A database lock file may change when opened, so verify untouched checkpoints first.
- Start a small container from an existing image, read the intended volumes without modifying them,
  and verify usable free space inside Docker. Run the repository's real Linux validation afterward;
  a successful container startup alone does not establish that acceptance passed.

Migration records for this host are kept under
`/Volumes/Seagate Portable Media/Development/MigrationRecords/`. Keep rollback data until verification
succeeds. Coordinate resumption with other sessions rather than automatically restarting their jobs.

## Performance evidence

The external drive changes the storage conditions. `APACK_PERFORMANCE_MACHINE_ID`, when supplied,
is an assertion of matched conditions: choose a new value when storage or scratch configuration changes.
The default hostname/CPU identity does not discover the physical disk behind a virtual machine. Existing performance reports retain their original
machine/storage provenance. Run correctness validation on the new location, and identify the new storage
in subsequent measurements; do not pool old and new timing samples as matched conditions.
