# Hosted Windows directory API observations atc707dabb1a — 2026-10-31

Run41184537719 completes on Windowsbuild26100, NTFS, with administrator:true. A normal
writable-file flush succeeds. All four directory handle opens succeed. Read and write-
attributes handles refuse FlushFileBuffers with error5 both before/after an owned removal;
write and read-write handles report success in both positions. The observed removal is
visible before the subsequent flush. The write-through directory move publishes to an
absent Unicode path; occupied file/directory targets refuse with183 and retain both sides.

These are actual API outcomes under this account and filesystem, not proof of physical
power-loss persistence, ordinary non-administrator behavior or arbitrary filesystems. The
[preregistered protocol and API references](../windows-directory-api-preregistration/README.md)
remain the contract boundary; qualification:false is intentional. No production helper
changes are selected from this result alone. Next verify the application's Node/libuv
open/fsync path and ordinary-user rights before adding an addon or subprocess protocol.
The existing directory-sync no-op still has to be resolved, not relabeled accepted.
