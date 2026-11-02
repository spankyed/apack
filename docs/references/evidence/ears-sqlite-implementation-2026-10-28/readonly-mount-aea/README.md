# Actual Linux read-only mount boundary — 2026-10-30

At candidate source `aea408425154c52f46de5b5abd8de6ba181c9922` (same production EARS subtree as
5569), a private Linux arm64 fixture creates one durable row and a published `VACUUM INTO` backup, then
closes the writer. A separate half-CPU/768-MiB/no-swap/cap-drop-ALL container mounts the entire owned
volume read-only. The other agent's container is untouched. Opening the backup file read/write fails with
kernel EROFS; this is actual mount enforcement, not chmod under a privileged user. Both main-file SHA-256
hashes and directory inventories match before and after inspection; no SQLite payload is checked into Git.

The published backup has SQLite header read/write versions 1/1 (rollback journal). A low-level
`SqliteDatabase({readOnly:true})` queries the original row/title and commit sequence, refuses a logical write
with READ_ONLY, closes and leaves the backup unchanged. The ordinary closed live file retains header 2/2
(WAL), but has no -wal/-shm files after clean close. Its read-only open refuses with SQLITE_CANTOPEN
because the mount cannot create sidecars. This refusal is safe and retained; it is not a successful live-WAL
reader or a license to enable SQLite's immutable mode on a changing store.

The first probe assumes both forms open and stops at the live WAL refusal, so its backup case never runs.
The corrected observer records that refusal explicitly and independently checks the published backup.
Both attempts and exact recipes/logs are retained. The unexecuted first observer's row projection assumption
is also corrected to actual query IDs/getRow API checks; no production API or storage policy changes.

SQLite documents the required existing readable sidecars, writable directory or explicit immutable database
for WAL on read-only media, and recommends rollback journal images for such media:
[Read-only databases](https://sqlite.org/wal.html#read_only_databases).
Managed host/profile opens additionally require writable lifetime-claim metadata; this lower-level probe
does not qualify a fully read-only app profile. Live WAL with a continuing writer, readable existing sidecars,
network/FUSE mounts, Windows ACLs, arbitrary filesystems and device power loss remain unqualified here.
