# Windows development VM

Use this machine for interactive Windows development, compiler/native debugging and focused Windows
validation. Do not dispatch a new GitHub Actions job for each hypothesis when the same failing case
can be inspected here. Fresh runners remain useful for clean reproduction and the goal's required
final acceptance; this guide does not remove those gates.

This is a development environment, not a production machine or a permanent CI runner. Guidance is
current as of **2026-10-18**. Read [CLAUDE.md](../../../CLAUDE.md) and the active task before running
checks. The [completed settings and pack contracts goal](../../archive/goals/goal-settings-and-pack-contracts.md#outcome-2026-10-19)
is historical evidence, not an instruction to resume its checks. A guide supplies procedures, not authorization to resume unrelated work, change subscription
permissions, push commits or run releases.

## Why this machine exists

Windows debugging was taking a commit, push, workflow dispatch and fresh environment setup for each
small experiment. That obscured failures and discarded useful process state. An owned Windows VM
allows immediate reruns, process inspection and retention of a failing workspace without changing
the developer's Mac.

The developer's daily-use Mac also suffered a system-wide launch incident during sustained native
compiler testing. Unrelated apps stopped launching; restarting recovered the machine. The cause is
**not established**. Repeated executable/native-library assessments were observed, but correlation
does not prove that our tests caused the incident or explain its mechanism. Preserve that distinction;
see the [incident evidence](../evidence/build-input-snapshot-proof.md#macos-launch-policy-investigation-2026-10-17).

Keep real Windows compiler/native execution here. macOS-specific execution still needs a disposable
macOS runner, and Linux-specific execution needs Linux. A Windows VM cannot establish either platform's
loader behavior. Never bypass the macOS test guard with fabricated GitHub runner variables, change
Gatekeeper settings, or resume captured-runtime/native batches on the daily-use Mac.

## Environment and ownership

| Item | Initial configuration |
|---|---|
| Azure subscription | `Azure subscription 1`, Free Trial; spending limit verified **On** |
| Resource group / VM resource name | `apack-windows-dev` |
| Region | `eastus2` |
| Windows computer name | `apack-win-dev` (Windows names have a 15-character limit) |
| VM size | `Standard_D4as_v7`: 4 x64 vCPU, 16 GiB RAM |
| OS | Windows Server 2025 Datacenter Azure Edition, generation 2, Trusted Launch |
| Initial image | `MicrosoftWindowsServer:WindowsServer:2025-datacenter-azure-edition:26100.33650.261013` |
| OS disk | 128 GiB, Standard SSD LRS |
| Windows development account | `apackdev`, local administrator |
| Source checkout | `C:\src\apack` |
| Initial source | `session/settings-pack-contracts` at `167722d1fa227800e92a2c2fd897ee7d67b2b8fa` |
| Node | `23.11.1`, matching the compiler workflow at provisioning |
| Git | `2.56.0.windows.2` at provisioning |
| C++ tools | Visual Studio Build Tools 2026, `18.11.12306.390`, installed at `C:\BuildTools` |
| Dependencies | `npm ci` succeeded after configuring npm's script shell to Git Bash |
| Setup logs | `C:\apack-setup` |
| Recovery snapshot | `apack-windows-dev-setup-20261018`, incremental Standard LRS; creation succeeded |
| Daily automatic shutdown | `07:00 UTC`; 03:00 New York daylight time / 02:00 standard time |
| Budget | $50/month for this resource group, email alerts at 50%, 80%, 100% |

Windows, tools and the checkout can change. These are initial facts, not proof of the machine's current
state. Record versions and the actual source commit with each accepted result. `windows-latest` also
moves: the VM matches the current CI OS family, not GitHub's entire software inventory or patch level.

Treat this as a shared machine. Before running a build or test, establish who owns it and whether another
agent has active work. One agent owns expensive execution at a time. Separate checkouts alone do not
isolate CPU, memory, native processes, OS loader state or shutdown. Do not start parallel compiler
suites, deallocate, restore a snapshot, reinstall tools, or remove another agent's retained directories
while that agent is working.

## Access from the developer's Mac

The dedicated local SSH configuration is:

```text
~/.ssh/apack-windows-dev.conf
```

It references a private key at `~/.ssh/apack-windows-dev` and a dedicated known-hosts file at
`~/.ssh/apack-windows-dev-known-hosts`. Existing general SSH configuration was not changed. Local
operational notes are at `~/.ssh/apack-windows-dev.README`.

Connect from the Mac:

```sh
ssh -F ~/.ssh/apack-windows-dev.conf apack-windows-dev
```

The shell is Windows PowerShell. Use Windows paths after connecting. A command typed in the Mac's
ordinary terminal still runs on the Mac unless it is explicitly sent through SSH.

For example, this executes on Windows:

```sh
ssh -F ~/.ssh/apack-windows-dev.conf apack-windows-dev 'whoami; $env:COMPUTERNAME'
```

Keep PowerShell expressions in single quotes when sending them from the Mac's shell, so macOS does not
expand `$env`, `$PID` or other PowerShell variables. Prefer copying a script and invoking its file over
stacking multiple layers of quoting.

### Network and credential boundaries

- The VM has a Standard public IPv4 address for connectivity. Its network security group permits
  inbound TCP **22 only from the developer's approved public IPv4 `/32`**. It does not allow public RDP.
- SSH uses the dedicated key; password authentication is disabled. Its initial host key was obtained
  through Azure's authenticated management channel and compared with the SSH endpoint before trusting it.
- A changed home/network public IP will make SSH stop working. This is expected. Confirm the new source
  address and obtain authorization before replacing the `/32`; never widen it to `0.0.0.0/0` to save time.
- Host-key mismatch is a reason to investigate an intentional rebuild/restore, not a reason to disable
  `StrictHostKeyChecking`. Verify replacement keys through Azure before updating the known-hosts file.
- No personal Azure or GitHub credentials were copied into Windows. Do not copy `~/.azure`, `~/.ssh`,
  `gh` credentials, agent sockets or production app profiles to the VM. Do not enable SSH agent forwarding.
- SSH grants substantial control **inside this VM**. It is separate from permission to provision or resize
  Azure resources. Avoid giving agents subscription Owner access merely to run a test.

The initial Windows administrator password was generated for provisioning and was not retained as an
access method. Desktop/RDP use needs an owner-controlled password reset and a deliberately configured
private connection. It does not require exposing port 3389 publicly. A browser-only Bastion session
does not itself give an agent terminal access. Use the existing SSH path for agent work.

If desktop interaction is needed, ask the owner to arrange it. SSH execution does not prove that an
Electron window works in an interactive desktop session. Do not silently substitute a service/session
launch for an app UI check.

## Power management and spending

Use the Azure portal to start or stop the VM if the agent has only SSH credentials. Azure CLI on the
Mac is another option **when management access and the specific operation are authorized**. Verify the
selected subscription before changing resources:

```sh
az account show --query '{name:name,id:id,state:state}' -o table
```

The directory/tenant ID and subscription ID are different identifiers. During initial signup the same
Microsoft account opened two portal directories, and untargeted CLI login initially found no
subscription. The portal's **Subscriptions** page subsequently showed the active subscription and
Owner access. If that recurs, verify the account and directory there and use
`az login --tenant <VM-tenant-id> --use-device-code`. The correct identifiers are in the private local
handoff notes. Do not create another account, buy a subscription, or use `--allow-no-subscriptions`
to work around a VM-access problem.

Start the existing VM:

```sh
az vm start --resource-group apack-windows-dev --name apack-windows-dev
```

Stop compute billing after saving work:

```sh
az vm deallocate --resource-group apack-windows-dev --name apack-windows-dev
```

Confirm it actually deallocated:

```sh
az vm get-instance-view --resource-group apack-windows-dev --name apack-windows-dev \
  --query 'instanceView.statuses[].displayStatus' -o tsv
```

Look for `VM deallocated`. Closing SSH, signing out of Windows, or seeing an ordinary stopped guest is
not sufficient evidence that compute billing stopped. The portal's Stop action should finish as
**Stopped (deallocated)**. Booting next time takes longer than reconnecting to a running machine.

Daily shutdown is a backstop, not a workload-aware scheduler. Check the time before a long operation.
Keep logs on disk, commit useful source when authorized, and leave enough time to stop cleanly. Do not
disable or postpone the schedule without agreement. Do not deallocate another agent's active machine.

### What it costs

Planning estimates in USD, before tax, based on a Windows four-core VM at approximately **$0.37/hour**:

| Monthly running time | Approximate total, including a small disk/IP/snapshot allowance |
|---|---:|
| 40 hours | $30–40 |
| 100 hours | $50–65 |
| Left running continuously | $280–310 |

These are estimates, not an Azure quote or a spending guarantee. Region, SKU, disk transactions,
snapshot usage and outbound transfer affect the bill. Review [Windows VM pricing](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/windows/),
[managed disk/snapshot pricing](https://azure.microsoft.com/en-us/pricing/details/managed-disks/)
and [IP address pricing](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/).

Deallocation stops VM compute charges. The OS disk, Standard public IP and retained snapshots continue
billing. Allow roughly **$15–25/month** for those persistent resources with a small number of snapshots;
check actual Cost Management usage rather than accumulating snapshots indefinitely. Disk snapshots
are not a reason to keep the VM running.

The verified Free Trial starts with $200 credit and a limited validity period. **Keep its spending limit
on.** Do not upgrade to Pay-As-You-Go, remove that limit, request more quota, resize the VM, add paid
Bastion/NAT services or create additional VMs without explicit owner authorization.

The $50 budget sends notifications; it is **not a hard cap**, and cost reporting/alerts can lag.
Ordinary Pay-As-You-Go has no equivalent configurable hard spending limit. Do not describe shutdown
automation or budget-triggered automation as a guaranteed dollar cap. See Microsoft's
[spending-limit contract](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit)
and [budget behavior](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

After provisioning, agents can work over SSH without Azure login credentials. The owner can sign out
of Azure CLI on the Mac (`az logout`) and handle VM power through the portal if that stronger access
boundary is preferred. Do not sign out another session or change account permissions on your own.

## Source, dependencies and reproducibility

Start each session by inspecting the actual checkout, not assuming the initial snapshot is current:

```powershell
Set-Location C:\src\apack
git status --short --branch
git rev-parse HEAD
node --version
npm.cmd --version
git --version
```

The initial checkout was cloned from a Git bundle of the Mac's committed branch, including commits
that had not been pushed. Its origin is a **local bundle**, not a credentialed GitHub remote. Do not
assume `git pull` will update it from GitHub. Check `git remote -v` first. Do not push a branch merely
to make it accessible to this VM.

Use a bundle to bring committed work over without distributing account credentials. Example on the
Mac, substituting the branch that actually owns the work:

```sh
git bundle create /private/tmp/apack-windows-update.bundle session/settings-pack-contracts
scp -F ~/.ssh/apack-windows-dev.conf /private/tmp/apack-windows-update.bundle \
  apack-windows-dev:apack-windows-update.bundle
```

Then on Windows:

```powershell
Set-Location C:\src\apack
git status --short --branch
git fetch C:\Users\apackdev\apack-windows-update.bundle refs/heads/session/settings-pack-contracts
git show --no-patch --oneline FETCH_HEAD
```

Review local changes before switching to the fetched commit. A separate task branch/checkout can
preserve existing Windows work; follow the repository's session rules. Do not `reset --hard`, clean
untracked files, overwrite a checkout or silently merge another session's branch. If agents edit code
on Windows, bring the resulting authorized commits back in a bundle and review them on the Mac;
otherwise retain a precise patch including useful untracked files. Do not leave the only useful fix
inside a VM that someone may restore or delete.

Never copy macOS `node_modules`, generated native binaries or compiler caches to Windows. Install
dependencies there with the committed lockfile. Do not edit the lockfile or change the Node version
to silence warnings during environment setup.

This repo's current `preinstall` hook uses POSIX shell syntax. npm's default Windows `cmd.exe`
cannot execute it (`'[' is not recognized`, followed by `'true' is not recognized`). The VM's
development account therefore configures **Git Bash as npm's script shell**. This changes npm lifecycle
execution, not the SSH shell, which remains PowerShell. Verify it after rebuilding/restoring the VM;
configure it once if missing:

```powershell
npm.cmd config get script-shell
npm.cmd config set script-shell 'C:\Program Files\Git\bin\bash.exe' --location=user
```

Do not switch the native Windows Node installation to WSL to fix this shell mismatch. That would test
Linux processes and loader behavior instead of Windows. The initial failed npm install retained its
log at `C:\apack-setup\npm-ci.log`; the retry uses `npm-ci-git-bash.log` so the failure is not overwritten.

```powershell
Set-Location C:\src\apack
$env:APACK_CHAIN_CORES = '2'
cmd.exe /d /c 'npm ci --no-audit --no-fund > C:\apack-setup\npm-ci.log 2>&1'
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; inspect C:\apack-setup\npm-ci.log' }
```

Windows PowerShell 5.1 can display native stderr as `NativeCommandError` records even for npm warnings.
Preserve the real exit code and npm log. Do not infer failure from warning formatting or infer success
from a quiet terminal. The existing Node pin can produce dependency engine warnings; assess the actual
failure rather than upgrading unrelated dependencies. If a postinstall needs authenticated GitHub
downloads, diagnose that request and obtain narrowly scoped access; do not copy the developer's entire
credential store or blindly rerun `npm ci`.

Installing dependencies does not build every workspace. Inspect the current package scripts and use
the existing `npm run packages:ensure` when the selected test needs matching package output. Build only
what the task requires. Do not copy CI's whole workflow into the VM as an unexamined setup command.

## Native compiler setup

The installed C++ tools are discoverable through `vswhere.exe`; they are not necessarily on PATH in an
ordinary SSH shell. The repository already owns the matching Node headers/import-library and MSVC
environment setup in [setup-node-native-sdk.ps1](../../../.github/scripts/setup-node-native-sdk.ps1).
Reuse it rather than writing a second native-fixture toolchain setup.

That helper emits variables to a `GITHUB_ENV` file. For an interactive Windows shell, give it a local
output file and import those values into the same shell that will run the selected test:

```powershell
Set-Location C:\src\apack
$env:RUNNER_TEMP = 'C:\apack-setup\native-sdk'
New-Item -ItemType Directory -Force $env:RUNNER_TEMP | Out-Null
$env:GITHUB_ENV = Join-Path $env:RUNNER_TEMP ('environment-' + [guid]::NewGuid().ToString('N') + '.txt')
& .\.github\scripts\setup-node-native-sdk.ps1
foreach ($line in Get-Content $env:GITHUB_ENV) {
  $name, $value = $line -split '=', 2
  Set-Item -Path ('Env:' + $name) -Value $value
}
```

These two paths adapt the helper's file interface; they do **not** make this a GitHub runner. Do not
set `GITHUB_ACTIONS`, `RUNNER_ENVIRONMENT` or other identity flags to bypass a platform guard. Keep
`APACK_TEST_NODE_HEADERS`, `APACK_TEST_NODE_IMPORT_LIBRARY`, PATH, INCLUDE, LIB and LIBPATH in the test
shell; a different SSH connection does not inherit that shell's variables. Helpers and workflows can
change, so read the current helper before using the example.

Keep useful source paths intact. Run native cases from the real Windows checkout rather than an
unrecorded copied file tree. Do not move a source into a package boundary, delete a dependency, or
alter loader environment just to make a refusal/pass easier to obtain.

Use the test harness's owned fixture, profile, cache and temporary-directory interfaces. Do not share
generated output or dependencies between different source checkouts, change machine-wide TEMP/TMP,
or sweep all directories matching a global prefix. A dead or reused PID alone does not establish
ownership of a retained directory. Coordinate retained external outputs with their consumer before
removing them; keep useful failed work until it is captured or explicitly disposable.

## Debugging and validation workflow

1. **State the question.** Identify the failing case, source commit, expected behavior, relevant owner
   and evidence that will distinguish a missed rebuild, incorrect loading, or actual slowness.
2. **Prepare once.** Confirm source/toolchain/dependency state and ownership of the VM. Set the two-core
   budget. Build matching packages only if their inputs changed or required output is absent/stale.
3. **Run one case.** Preserve its stdout/stderr, runner report, exit code and retained fixture paths.
   Use the existing test's cleanup and deadline contract. Do not raise timeouts before diagnosing why
   the case failed or what work is still active.
4. **Inspect the actual process.** Use its owned PID, exact loaded DLL paths, file operations, relevant
   environment and compiler observations. Preserve the failing workspace when necessary; do not run
   a cleanup sweep before capturing evidence.
5. **Fix the demonstrated cause.** Run the reproducer, then the affected suite. Broaden only for a
   named coverage gap, not because another large run might provide a clue.
6. **Checkpoint and hand off.** Record the source and result, return useful fixes to their owning
   branch, and keep required broader/final acceptance explicit. Save work, then deallocate when idle.

Example of a focused native integration invocation **on Windows**, after preparing its dependencies
and native environment; replace the pattern with one existing test name:

```powershell
$env:APACK_CHAIN_CORES = '2'
$case = '<one existing test name>'
$runRoot = Join-Path 'C:\apack-setup\runs' ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $runRoot | Out-Null
$report = Join-Path $runRoot 'native-result.json'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts `
  --project @apackdev/cli packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts `
  --testNamePattern "$case" --bail=1 `
  --maxWorkers=1 --no-file-parallelism `
  --reporter=default --reporter=json --outputFile="$report"
if ($LASTEXITCODE -ne 0) { throw 'Focused native case failed' }
```

Confirm the report contains the intended executed case; a matching command with zero selected tests
does not pass acceptance. Other suites may require source-resolution conditions; copy the relevant
current workflow step's conditions, not unrelated global environment. Do not leave `NODE_OPTIONS`
pointing at a diagnostic preload for later tests.

Launch Electron compiler probes through the existing Node process harness with explicit pipes and
an awaited exit code. Shell success alone does not establish that the probe ran; retain its actual
stdout/stderr, owned PID or launch receipt and runtime versions. See the
[CommonJS control evidence](../evidence/build-input-snapshot-proof.md#commonjs-native-lookup-observation-checkpoint--2026-10-18).

Windows module inspection can help attribute DLL loading:

```powershell
Get-Process -Id <owned-process-id> -Module | Select-Object ModuleName, FileName
```

Use a shell with the correct architecture and privileges, and inspect the actual child process, not
just the harness. Basename presence does not prove which file was loaded; correlate full paths with
the compiler owner's receipts and lifetime. A failed enumeration is an observation failure, not proof
that a DLL is absent. Process Monitor and Process Explorer are useful additional Microsoft tools when
needed; scope capture to owned processes and stop it afterward rather than collecting the whole VM
indefinitely.

### Evidence and final acceptance

For a result that will be cited, retain:

- Commit SHA and any uncommitted patch, exact command/filter and selected/executed case count.
- Windows build, architecture, Node/toolchain versions and relevant changed environment.
- Exit code, assertion failure or pass, JSON report/log paths, and useful fixture/owner receipts.
- Whether the run used a clean baseline or a retained development environment.
- What remains unproven: other platforms, concurrency/lifetime paths, or the broad/final gate.

VM execution is real Windows evidence and is the preferred investigation path. A long-lived machine
can still accumulate state that masks undeclared dependencies. Use a clean snapshot or a fresh runner
to verify that concern once the fix converges. The existing goal still requires its final committed-source
strict `--all` acceptance on the approved disposable environment. Do not relabel a focused VM pass as
that final gate or automatically rerun every previously accepted platform case after each edit.

## Common problems

| Symptom | First check / response |
|---|---|
| SSH times out | Confirm the VM is running, then check the approved source IP against the current network. Do not create another VM or open SSH to everyone. |
| SSH host key changed | Establish whether the owner rebuilt/restored the machine; verify the key through Azure before trusting it. |
| Azure says no subscriptions | Confirm the active subscription and tenant in the portal; target CLI login to that tenant. This is not a reason to upgrade the trial. |
| `cl.exe`, headers or `node.lib` missing | Use the existing native SDK/MSVC helper and import its output in the same test shell. Check the completed Build Tools installation before reinstalling it. |
| npm prints warnings or `NativeCommandError` | Inspect its actual exit code and full log. Keep the workflow's Node pin; do not update dependencies to conceal setup warnings. |
| npm fails with `'['` / `'true' is not recognized` | Verify npm's script shell is the installed Git Bash; the current root lifecycle hook uses POSIX syntax. Keep Windows Node, not WSL. |
| An SSH session ends during a long operation | Reconnect and inspect that operation's log, completion marker and owned processes. Do not assume failure or start a duplicate installer/build. |
| Tests time out | Preserve the selected case's evidence. Check whether it is still compiling, awaiting an event, or blocked on I/O before changing any deadline. |

First dependency installation has an empty cache and can take minutes. Initial npm logs on this VM
showed successful registry downloads with long elapsed fetch times; that is not evidence of a compiler
or watcher defect. For persistent slowness, inspect actual CPU, available memory, disk activity and
network work on Windows. Standard SSD throughput and scanning can be investigated as hypotheses;
do not assert either is the cause without evidence. A disk/VM upgrade costs more and needs owner
approval. Do not disable Defender or other security services to obtain a faster test result.

## Snapshots, recovery and cleanup

The setup snapshot `apack-windows-dev-setup-20261018` was created successfully after dependency
installation and VM deallocation. It preserves the installed environment, initial checkout, logs and
bundles transferred by the other agent. No goal tests were launched by the setup session. This is a
recoverable development checkpoint, not evidence of a sterile CI environment or passing product checks.
The VM was left **deallocated** at handoff; verify its current state before using it.

At handoff, Windows Git reported `packages/apack-cli/bin/apack.mjs` modified while its normalized
`git diff` was empty and emitted an LF/CRLF warning. It was left untouched. Inspect actual content
before attributing a change or resetting anything. The other agent's bundles were preserved, not
applied or deleted by setup. Current source remains something the next agent must explicitly verify.

Snapshot only after installers/builds are stopped and the guest has shut down/deallocated. Name each
snapshot by its purpose/date and record the source and installed tool versions. Keep a small deliberate
set. OS-disk snapshots do not capture the entire Azure configuration: NICs, firewall rules, public IP,
shutdown schedule and budgets need their own configuration/verification when reconstructing a VM.

Before restoring, export all useful commits, patches, untracked fixtures and evidence. Obtain agreement
from other users; restore discards newer disk work. Prefer an isolated replacement VM when investigating
recovery, but creating an additional VM requires authorization and incurs additional cost. Do not change
the existing key trust to match an unknown replacement or delete the only baseline snapshot.

If the VM misbehaves, stop new tests, preserve narrowly scoped evidence, identify owned processes and
stop them through their actual lifetime owners. Do not kill every `node`, compiler or PowerShell process
on a shared VM. An agent without SSH access can ask the owner to inspect through Azure management;
do not open broader inbound rules to recover convenience.

At handoff, state which process/workspace owns unfinished work, where logs live, what source was
tested, and whether the VM is running or deallocated. Snapshot restoration, VM deletion, subscription
upgrades and production-data imports are separate owner-authorized operations, not routine cleanup.
