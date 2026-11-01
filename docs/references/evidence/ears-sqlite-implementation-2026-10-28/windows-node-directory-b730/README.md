# Standard Node directory flush on Windows atb7300724a0 — 2026-10-31

Run41185908325 completes the raw Win32 controls and ordinary Node path on NTFS,
Windowsbuild26100, Node23.11.1/libuv1.50.0. An r descriptor opens the directory but
fsync fails withEPERM before/after an owned removal; r+ opens and both flushes succeed.
The normal writable-file control passes. The raw API report records administrator:true.
No native addon or runtime subprocess is needed for this Node operation.

[Libuv's Windows filesystem implementation](https://github.com/libuv/libuv/blob/v1.50.0/src/win/fs.c)
opens with BACKUP_SEMANTICS and routes fsync through FlushFileBuffers. The actual probe
confirms the relevant pinned runtime behavior. This is an OS flush request/acknowledgment,
not physical power-loss proof or certification of arbitrary filesystems or ACLs. Ordinary
non-administrator and installed-Electron qualification remain open.

The next implementation removes the Windows no-op in recovery and private-file directory
barriers, using r+ and preserving errors. A private-file postpublication sync failure
must retain the installed file and report NOT_DURABLE/publishedPath/original cause; a
prepublication refusal must keep the incumbent and preserve any cleanup error too.
Six private-file cases are required in the three-platform host verifier, including real
barrier refusal, published-outcome and cleanup-error witnesses. That implementation is
not accepted until its actual affected checks pass; this probe is not a production test.
