param([Parameter(Mandatory = $true)][string]$Output)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable hosted Windows only' }
$outputPath = [IO.Path]::GetFullPath($Output)
if ([IO.File]::Exists($outputPath)) { throw 'Refuse an existing report' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class EarsRestrictedDirectoryProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags,
        uint disabledCount, ref SidAndAttributes disabled, uint deletedCount, IntPtr deleted,
        uint restrictedCount, IntPtr restricted, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind, IntPtr info, uint length, out uint needed);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool LookupPrivilegeNameW(string system, IntPtr luid, StringBuilder name, ref uint length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool FlushFileBuffers(SafeFileHandle handle);
    static void Require(bool value, string operation) {
        if (!value) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    static string[] EnabledPrivileges(SafeAccessTokenHandle token) {
        uint needed; GetTokenInformation(token,3,IntPtr.Zero,0,out needed);
        if(needed<4) throw new InvalidOperationException("Token privileges size missing");
        IntPtr info=Marshal.AllocHGlobal((int)needed);
        try {
            Require(GetTokenInformation(token,3,info,needed,out needed),"Read restricted privileges");
            int count=Marshal.ReadInt32(info); var enabled=new List<string>();
            for(int i=0;i<count;i++) {
                IntPtr luid=IntPtr.Add(info,4+12*i);
                if((Marshal.ReadInt32(luid,8)&2)==0) continue;
                uint length=256; var name=new StringBuilder((int)length);
                Require(LookupPrivilegeNameW(null,luid,name,ref length),"Name enabled privilege");
                enabled.Add(name.ToString());
            }
            return enabled.ToArray();
        } finally {Marshal.FreeHGlobal(info);}
    }
    public static Dictionary<string,object> Run(string root,string denied) {
        using(var original=WindowsIdentity.GetCurrent()) {
            var admin=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
            byte[] sidBytes=new byte[admin.BinaryLength]; admin.GetBinaryForm(sidBytes,0);
            IntPtr sid=Marshal.AllocHGlobal(sidBytes.Length);
            try {
                Marshal.Copy(sidBytes,0,sid,sidBytes.Length);
                var disabled=new SidAndAttributes {Sid=sid,Attributes=0}; SafeAccessTokenHandle token;
                // DISABLE_MAX_PRIVILEGE preserves only SeChangeNotifyPrivilege; admin SID becomes deny-only.
                Require(CreateRestrictedToken(original.AccessToken,1,1,ref disabled,0,IntPtr.Zero,0,IntPtr.Zero,out token),"Create restricted copy");
                using(token) {
                    var enabled=EnabledPrivileges(token);
                    foreach(var name in enabled) if(name!="SeChangeNotifyPrivilege") throw new InvalidOperationException("Unexpected enabled privilege: "+name);
                    return WindowsIdentity.RunImpersonated(token,()=> {
                        using(var effective=WindowsIdentity.GetCurrent()) {
                            bool administrator=new WindowsPrincipal(effective).IsInRole(WindowsBuiltInRole.Administrator);
                            if(administrator || effective.User.Value!=original.User.Value) throw new InvalidOperationException("Restricted identity control failed");
                            var report=new Dictionary<string,object> {{"administrator",administrator},{"sameUser",true},{"enabledPrivileges",enabled},{"adminSidDenyOnlyRequested",true}};
                            using(var blocked=CreateFileW(denied,3221225472u,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
                                int error=Marshal.GetLastWin32Error();
                                if(!blocked.IsInvalid || error!=5) throw new InvalidOperationException("Read-only directory did not deny writable handle: "+error);
                                report["readOnlyWriteRefused"]=true;report["readOnlyError"]=error;
                            }
                            string file=Path.Combine(root,"restricted-owned-file");
                            using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read)) {
                                stream.WriteByte(42);stream.Flush(true);report["fileFlushControl"]=true;
                            }
                            using(var directory=CreateFileW(root,3221225472u,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
                                Require(!directory.IsInvalid,"Open user-owned writable directory");report["opened"]=true;
                                Require(FlushFileBuffers(directory),"Flush before delete");report["flushBefore"]=true;
                                File.Delete(file);if(File.Exists(file))throw new IOException("Owned file removal missing");report["removalObserved"]=true;
                                Require(FlushFileBuffers(directory),"Flush after delete");report["flushAfterRemoval"]=true;
                            }
                            report["completed"]=true;return report;
                        }
                    });
                }
            } finally {Marshal.FreeHGlobal(sid);}
        }
    }
}
'@
$root = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ears-restricted-directory-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$report = [ordered]@{ source = (git rev-parse HEAD); qualification = $false
    scope = 'Restricted same-user thread with admin SID deny-only and privileges removed; raw Win32 API on owned NTFS tree, not installed Node/Electron or physical power loss'
    os = [Environment]::OSVersion.VersionString
    filesystem = ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))).DriveFormat }
try {
    $user = ([Security.Principal.WindowsIdentity]::GetCurrent()).User
    function Set-OwnedAccess([string]$Directory, [Security.AccessControl.FileSystemRights]$Rights) {
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner($user)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($user, $Rights,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $Directory -AclObject $acl
    }
    Set-OwnedAccess $root ([Security.AccessControl.FileSystemRights]::FullControl)
    $denied = [IO.Path]::Combine($root, 'read-only')
    [IO.Directory]::CreateDirectory($denied) | Out-Null
    Set-OwnedAccess $denied ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
    $report.ownerOnlyAcl = $true
    $report.restricted = [EarsRestrictedDirectoryProbe]::Run($root, $denied)
    $report.completed = $true
} catch { $report.failure = $_.Exception.ToString(); throw }
finally {
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding utf8
    [IO.Directory]::Delete($root, $true)
}
