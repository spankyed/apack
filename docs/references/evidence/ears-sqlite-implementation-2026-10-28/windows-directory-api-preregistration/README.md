# Windows directory API observation protocol — 2026-10-31

Phase6 still requires Windows namespace durability. The current shared directory-sync helper returns
without flushing, and backup publication uses Directory.Move. These observations do not establish
power-loss durability. Investigate the OS boundary before selecting a production implementation.

Microsoft's [directory move example](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)
uses MoveFileEx with WRITE_THROUGH on a same-drive directory and requires an absent destination.
The [MoveFileEx reference](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
describes the write-through flag and occupied-directory refusal. Separately,
[opening a directory handle](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)
requires BACKUP_SEMANTICS; the [FlushFileBuffers reference](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
requires GENERIC_WRITE and does not state a local directory-entry persistence contract. A successful
call alone cannot supply an undocumented durability guarantee.

The manual `windows-durability` suite in the existing App acceptance dispatcher calls a small hosted
Windows probe. It uses only a new owned temporary tree and in-memory C# interop with the system API;
no production dependency, native addon or system configuration is changed. The normal writable-file
open/flush control must pass. It records read/write/read-write/write-attributes directory handles,
flush results before/after an owned file removal and actual Win32 error codes. A separate same-volume
WRITE_THROUGH move must publish the candidate to an absent Unicode destination, and refuse occupied
file/directory targets while preserving both candidate and incumbent contents.

Closing checks: retain exact source, OS, filesystem, administrator status, every API result and the
normal-file/move controls, or retain failure. The job is bounded to five minutes. Its report remains
qualification:false; API success does not prove power-loss persistence, non-administrator behavior,
arbitrary filesystems, ACL assumptions or a portable directory-sync contract. No production behavior
or acceptance criterion is changed. Use the results and authoritative API contracts to choose the
next implementation/protocol step; do not turn an observed success into a filesystem certification.

The script has been reviewed and whitespace checked. PowerShell is absent on the daily Mac and is
not installed for this work. Hosted execution supplies the actual parser/API checks; no result is
claimed before its report is inspected.
