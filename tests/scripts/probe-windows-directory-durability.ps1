param([Parameter(Mandatory = $true)][string]$Output)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') {
    throw 'Run only on disposable hosted Windows; never against a user profile'
}
$outputPath = [IO.Path]::GetFullPath($Output)
if ([IO.File]::Exists($outputPath)) { throw 'Refuse an existing output report' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EarsDirectoryProbe {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    public static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FlushFileBuffers(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool MoveFileExW(string source, string target, uint flags);
}
'@

$root = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ears-directory-probe-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$report = [ordered]@{
    source = (git rev-parse HEAD)
    qualification = $false
    scope = 'Actual API observations only; no persistence after power loss or supported directory-flush contract is inferred'
    os = [Environment]::OSVersion.VersionString
    filesystem = ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))).DriveFormat
    administrator = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    directoryHandles = @()
    moves = @()
}

function Write-FlushedFile([string]$Path, [string]$Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    try { $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) }
    finally { $file.Dispose() }
}

try {
    $control = [IO.Path]::Combine($root, 'control')
    Write-FlushedFile $control 'file-control'
    $fileHandle = [EarsDirectoryProbe]::CreateFileW($control, [uint32]0x40000000, 7, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
    try {
        if ($fileHandle.IsInvalid) { throw 'Normal writable-file control failed to open' }
        $report.fileFlushControl = [EarsDirectoryProbe]::FlushFileBuffers($fileHandle)
        if (-not $report.fileFlushControl) { throw 'Normal writable-file flush control failed' }
    } finally { $fileHandle.Dispose() }

    $accesses = [ordered]@{ read = [uint32]2147483648; write = [uint32]1073741824; readWrite = [uint32]3221225472; writeAttributes = [uint32]256 }
    foreach ($access in $accesses.GetEnumerator()) {
        $handle = [EarsDirectoryProbe]::CreateFileW($root, $access.Value, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
        $entry = [ordered]@{ name = $access.Key; access = $access.Value; backupSemantics = $true; opened = -not $handle.IsInvalid }
        try {
            if ($handle.IsInvalid) { $entry.openError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
            else {
                $entry.flushBefore = [EarsDirectoryProbe]::FlushFileBuffers($handle)
                if (-not $entry.flushBefore) { $entry.flushBeforeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
                $removed = [IO.Path]::Combine($root, 'removed-' + $access.Key)
                Write-FlushedFile $removed 'owned-file'
                [IO.File]::Delete($removed)
                $entry.removalObserved = -not [IO.File]::Exists($removed)
                $entry.flushAfterRemoval = [EarsDirectoryProbe]::FlushFileBuffers($handle)
                if (-not $entry.flushAfterRemoval) { $entry.flushAfterRemovalError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
            }
        } finally { $handle.Dispose() }
        $report.directoryHandles += $entry
    }

    foreach ($kind in @('absent', 'file', 'directory')) {
        $source = [IO.Path]::Combine($root, 'source-' + $kind)
        $target = [IO.Path]::Combine($root, 'target-' + $kind + '-é')
        [IO.Directory]::CreateDirectory($source) | Out-Null
        Write-FlushedFile ([IO.Path]::Combine($source, 'marker')) 'candidate'
        if ($kind -eq 'file') { Write-FlushedFile $target 'incumbent' }
        if ($kind -eq 'directory') {
            [IO.Directory]::CreateDirectory($target) | Out-Null
            Write-FlushedFile ([IO.Path]::Combine($target, 'marker')) 'incumbent'
        }
        $moved = [EarsDirectoryProbe]::MoveFileExW($source, $target, 8)
        $entry = [ordered]@{ targetKind = $kind; flags = 8; moved = $moved }
        if (-not $moved) { $entry.error = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
        if ($kind -eq 'absent') {
            if (-not $moved -or [IO.Directory]::Exists($source) -or [IO.File]::ReadAllText([IO.Path]::Combine($target, 'marker')) -ne 'candidate') { throw 'Write-through move control failed' }
        } else {
            if ($moved -or [IO.File]::ReadAllText([IO.Path]::Combine($source, 'marker')) -ne 'candidate') { throw 'Occupied-target move failed to refuse safely' }
            $incumbent = if ($kind -eq 'file') { $target } else { [IO.Path]::Combine($target, 'marker') }
            if ([IO.File]::ReadAllText($incumbent) -ne 'incumbent') { throw 'Incumbent changed' }
        }
        $report.moves += $entry
    }
    $report.completed = $true
} catch {
    $report.failure = $_.Exception.ToString()
    throw
} finally {
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding utf8
    [IO.Directory]::Delete($root, $true)
}
