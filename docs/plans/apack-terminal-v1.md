# apack-terminal v1: the plan

Status: decided 2026-11-12, not started. Written so an agent with none of the earlier conversation can carry it
out. Read it end to end before starting any task.

## What "v1" means here

v1 is apack-only, near-complete on Windows, and dependable on macOS and Linux. Concretely:

- **Consumer:** apack only. No one outside this repository is promised anything. The protocol may change in the
  same commit as the app that uses it. No compatibility policy and no published packages are needed for v1.
- **Platforms:** macOS, Linux and Windows. Windows must be as complete as the current harness can make it. A
  Windows feature may be labelled "beta" only if it is **proven** too hard to support, with the evidence written
  down (see the rule at the end).
- **Settled decisions:**
  - A session ends when the broker stops, whether by crash or restart. A recording can bring back the screen,
    not the program. This is accepted; no session-handoff work.
  - Remote-target command marks, recording and path links are **not** in v1. See
    `docs/plans/deferred/apack-terminal-remote-targets.md`.
  - The public release is **not** in v1. See `docs/plans/deferred/apack-terminal-public-release.md`.

## Out of scope for v1

- Public release, published packages, a conformance suite for strangers, a compatibility policy.
- Remote-target marks, recording and path links.
- Session handoff across a broker restart.
- A GPU painter. Nothing measured says the canvas is too slow.
- Kitty animation, and file or shared-memory image transfer. Animation has no consumer, and the broker refuses
  file and shared-memory transfer on purpose.
- Windows `signal`. No feature in the app calls it (checked 2026-11-12). Interrupting a program is done by
  sending the Ctrl+C character as input; that path has not been checked on Windows, so it is part of W6. The
  `signal` request itself is a documented limit, not a task.

## Before any task

1. **Merge `spankyed/apack-terminal#14`** (the review fixes). Every broker task below assumes it. Check it is
   merged on `origin/master` before starting.
2. **One owner of the Windows VM at a time.** Read `docs/references/guides/windows-development-vm.md` first. It
   is the approved access path (SSH with a dedicated key, no agent forwarding). Deallocate it when a batch of
   Windows work is done, and confirm it reports `VM deallocated`.
3. **One heavy job at a time on the Mac**: a mutation run, a full suite, a chain, or a benchmark. Two at once
   give false results.
4. Work in worktrees, one per branch. No work on `master` in the main checkouts.
5. Follow the repository rules in both `CLAUDE.md` files. No attribution lines in commits or PRs. Merge
   commits, not squashes, for stacked PRs.

## Phase 1: the parsers that read untrusted bytes

Every byte a program prints reaches a parser in the broker. These tasks make that safer.

### T1. Fuzz the parsers
- **Why:** the broker reads JSON requests, a binary view wire, keyed markers, PNG images and recording files. They
  are checked only with generated round-trips, never with coverage-guided fuzzing. A crash takes every session on
  the broker with it.
- **What:** add `cargo-fuzz` targets, in a new `fuzz/` directory, for: the JSON frame reader
  (`src/frames.rs`), the binary wire decoder (`src/view/wire.rs`), the marker parser (`src/markers.rs`), the PNG
  path (`src/vt/images.rs`), and the recording reader (`src/recording.rs`). Seed each from the existing test
  vectors.
- **Done when:** each target runs one hour clean locally; a nightly CI job runs each target; any crash found is
  either fixed with a regression case or written down as an open bug with a reproducer.
- **Size:** medium.

### T2. Version the recording file
- **Why:** a recording has no version field. Adding one is cheap now and expensive after a user has recordings.
- **What:** add a header to the recording file: a magic string and a format number, starting at `1`. The reader
  refuses a file with an unknown number, with an error that says so. Add a golden file written by the current
  code, and a test that it still reads. Old recordings are not supported: the repository's own rule is that
  stored developer data is not a compatibility requirement (`CLAUDE.md`, "Backward compatibility").
- **Done when:** a recording written now reads back; a file with a bad header is refused with a clear error; the
  golden file test passes on all three platforms.
- **Size:** small.

### T3. Account for every `unsafe` block
- **Why:** about 195 occurrences of `unsafe`, 166 of them in `src/vt/`, the calls into libghostty-vt. Each block
  rests on an invariant that is written nowhere.
- **What:** (a) give every `unsafe` block a `// SAFETY:` comment that names the invariant; (b) add a check
  (`cargo xtask`, in the same style as `check-exclusions`) that fails when a block has none; (c) run the suite
  once under AddressSanitizer on Linux (`RUSTFLAGS=-Zsanitizer=address` on nightly, in a container).
- **Done when:** the check passes; the ASan run is clean or each report is written down with a fix or an
  explanation.
- **Size:** medium.

## Phase 2: Windows, as complete as the harness allows

The Windows status today, in plain terms:

| Area | Status |
|---|---|
| The broker builds and its suite passes on the VM and in CI (339 cases) | done |
| PowerShell hook, marks through the broker, exit codes, the secret out of the environment | done on the VM (2026-11-12) |
| The proxy, including a second proxy joining the broker | done on the VM |
| Pipe access: owner and SYSTEM only | done (read off a live pipe, 2026-11-09) |
| View: drawing, IME composition, third-level keys in headless Chromium | done on the VM (2026-11-12); AltGr is not a real key press |
| Views and the proxy: 15 cases run on Windows; 26 are POSIX only | open: W5 |
| Kept sessions and recordings (the `keeping` suite, 15 cases) | not run on Windows | open: W3 |
| Test brokers started by the proxy are not cleaned up on Windows | open: W4 |
| Hooks inside the app's own code path | not verified: W2 |
| Hooks and terminal inside the app's window | needs the owner's desktop session: W6 |
| ConPTY keeps the order of command markers under load | not tested: W1 |

### W1. ConPTY keeps the order of markers under load
- **Why:** another project's public report says ConPTY has reordered OSC sequences and dropped unknown DCS
  sequences (Warp, unverified here). Vouched marks would then misattribute a command's status on Windows.
- **What:** on the VM, through the broker, run a PowerShell session that prints a few thousand command starts and
  finishes with output between them, as fast as it can. Check that the broker's `commands` answer lists every
  command, in order, with the right status and no duplicates.
- **Done when:** 10,000 commands in one session come back in order, correct, with nothing missing. If ConPTY
  reorders anything, stop and record the exact sequence; the hook design then needs a change, which is a new
  task, not part of this one.
- **Size:** small.

**Result (2026-11-13, met).** On the VM, through the broker (`apack-terminal` 0.1.0 built with Zig 0.17.0), one
PowerShell session with the app's own shell integration (`integrationFor`, the marks key the app gives a keyed shell)
ran 10,000 typed `Write-Output` commands in 156 s, in 50-command chunks. The session's listener saw 10,000
`commandStarted` and 10,000 `commandFinished` events: all in order, none missing or duplicated, every outcome
`exited` with code 0. The broker keeps 256 commands (`COMMANDS_KEPT`), and those 256 match the last 256 written.
Script: `.apack/w1-order.ts` on the VM (run by `tsx`, source condition); result file `C:\apack-setup\w1-result.json`.

### W2. The app's own code path on Windows, without a window
- **Why:** the hooks are arranged by the app (`packages/default-setup/.../shell-integration.ts`), not by the
  broker. On the VM the hook file was generated from the app's code and run through the broker directly. The
  app's own service path, which decides when a hook is used, has not been run on Windows.
- **What:** run the app's API process on the VM (headless, no Electron window), open a PowerShell terminal through
  the app's terminal service, run a few commands, and read back the commands the app records. Use the repository's
  own commands (`npm run ...`); do not hand-assemble the hook.
- **Done when:** the commands the app records match what was typed, with their statuses, from the app's own
  service.
- **Size:** medium. It may need a headless harness; if the API cannot run headless on the VM, record why and say
  so before moving on.

**Result (2026-11-13, partly met).** The API runs headless on the VM (`packages/api` dist, `SHIPPED_PACKS_DIR`
set to `packages`, `APACK_ENV=development`, own data dir), loads the default-setup pack, and the app's
terminal service opens a PowerShell through the broker over the named pipe (`terminal.CREATED`, `TITLED`).
Typed input reaches the shell: a command typed through `terminal.TERMINAL_INPUT` wrote a marker file
(`Set-Content`) that the VM then holds with the expected text. The app lists each terminal as `recorded: true`
(`terminal.TERMINALS_LISTED`). **Not met:** the app's recorded command list with statuses cannot be read back
on Windows. The rewind answers with a session (`terminal.REWOUND`) but no frames arrive, and no recording file
is written under the data dir; the design says recordings and kept sessions run nowhere on Windows. That is W3.
The broker's exe was built on the VM with Zig 0.17.0 (the version the repo's Windows CI installs), staged by
`cargo xtask package`. Shells left by a run were gone once the API stopped.

### W3. Kept sessions and recordings on Windows
- **Why:** the `keeping` suite (15 cases) runs only on POSIX. Each case ends by closing a connection that a reader
  thread is blocked reading. A named pipe cannot be shut down one way, so the usual method does not apply.
- **What, in order:**
  1. **Time-boxed spike, one day at most:** find a way to end a blocked read on a named pipe from another thread.
     Candidates: `CancelSynchronousIo` on the reader's thread handle; overlapped I/O; or closing the server end
     the reader is waiting on. Write the result, whichever way it goes.
  2. If a route is found, port the suite and run it on the VM.
  3. If no route is found within the spike, **stop**, write the evidence (what was tried, what each attempt
     showed), and label the kept-session behaviour on Windows as beta. This is the only accepted way to beta a
     Windows feature.
- **Done when:** the suite passes on the VM, or the beta label and its evidence are written.
- **Size:** medium to large, depending on the spike.

### W4. Clean up test brokers that the proxy starts, on Windows
- **Why:** on Windows the cleanup for brokers a proxy starts is a no-op (`tests/reaper.rs`). A killed or failing
  test can leave a broker running.
- **What:** in the test, put the proxy process in a Job Object created with kill-on-close, so the broker the
  proxy starts is in the same job (children inherit it unless they break away, and the production broker does
  not break away from the test). Start the proxy suspended, assign it to the job, then resume it, so there is no
  window where the broker exists outside the job. Use `windows-sys` (already a Windows dependency).
- **Done when:** a test that kills its proxy leaves no broker on the VM (checked with the process list before and
  after); the existing proxy cases still pass.
- **Size:** small to medium.

### W5. Port the remaining POSIX-only cases
- **Why:** 26 view and proxy cases are POSIX only: they type `sh` syntax (`printf` escapes, loops, `$((...))`) or
  close one direction of a connection. They are the gap between "Windows runs the suite" and "Windows runs the
  behaviour".
- **What:** for each case, either write the Windows equivalent (cmd or PowerShell typing, with the same
  observable check) or, if the case tests something only POSIX has, write down why it cannot be ported and what
  Windows tests instead. The list is every `#[cfg(unix)]` test in `tests/view_broker.rs` (16) and `tests/proxy.rs` (10).
- **Done when:** every case is either running on Windows, or has a written reason and a Windows test covering the
  same behaviour.
- **Size:** medium.

### W6. Desktop check of the app's window (needs the owner)
- **Why:** the VM guide is explicit: SSH cannot show that an Electron window works in an interactive desktop
  session. Also not yet checked on a real keyboard: a German or similar layout typing `@`, `{`, `\` on Windows.
- **What:** the owner arranges an interactive session on the VM (`windows-development-vm.md`, "Desktop/RDP use").
  Then: open the app, open a terminal, run a PowerShell command, see the output drawn, type `@` and `{` on a
  German layout, and check the command markers appear in the gutter. Start a long-running command (for
  example `ping -t localhost`) and send Ctrl+C from the terminal; check it stops and the next prompt appears.
- **Done when:** the owner has done the check and reported it. The agent does not perform this step.
- **Size:** small, but blocked on the owner.

## Phase 3: speed and measurement

### P1. Native benchmarks
- **Why:** the throughput figure from the evaluation (about 7.7 MB/s) was limited by Node, not the broker. There is
  no measurement of memory with many sessions.
- **What:** a small Rust benchmark binary (in `xtask/` or `benches/`) that drives the broker as a client: output
  throughput for `seq 1 1000000`; keystroke round trip into `cat`, both back to back and spaced 60 ms apart; and
  resident memory with 1, 10 and 50 idle sessions.
- **Gate:** the repository's rule for timings is to fail only when a measurement is faster than the declared
  figure; slower is reported, never failed (`CLAUDE.md`, "Load inflates a duration and cannot deflate it"). Record
  the first numbers in `docs/architecture/testing.md` with the date and the machine.
- **Done when:** the benchmark runs in one command and the baseline is recorded.
- **Size:** medium.

### P2. Flush output on a quiet gap, not on a fixed window
- **Why:** measured 2026-11-12: a keystroke echo sent back to back waits for the full 16 ms output window
  (median 19.8 ms round trip). Spaced keystrokes do not wait (0.2 ms). The window is measured from the last flush,
  so any burst pays it.
- **What:** in `src/output.rs`, flush when the reader has seen no new bytes for 1 ms, as well as when the window
  ends or the size cap is reached. Under sustained output the window still bounds the rate; an echo after a quiet
  moment is sent at once. Keep the credit and the cap as they are.
- **Done when:** (a) the back-to-back echo round trip median is under 3 ms; (b) throughput for `seq 1 1000000`
  does not fall by more than 10% against the baseline from P1; (c) the existing output and credit cases pass; (d)
  a case states the new behaviour: after a quiet moment, one byte is sent without waiting for the window.
- **Size:** small to medium. Mutation-gate the new branch.

## Phase 4: finish

### F1. Document what v1 is
- Update `docs/architecture/design.md` "Known limits": Windows status as above; the crash decision (sessions end
  with the broker); no animation; no file or shared-memory transfer.
- Update `README.md` "Status": v1 scope, platforms, and what is not included.
- Fix stale numbers in `docs/architecture/testing.md` (test counts, timings) with the date.
- Done when: a reader can tell from the README what v1 does and does not do, without reading the code.

Accessibility is not in v1. The screen-reader pass belongs to `docs/archive/goals/goal-terminal-parity.md`, Phase 6.

## Order and dependencies

```
merge #14
  -> T1, T2, T3          (Mac; parallel-safe; one heavy job at a time)
  -> W1 -> W2 -> W4      (VM; one owner)
  -> W3 spike -> W3      (VM)
  -> W5                  (VM and Mac)
  -> W6                  (owner, when available)
  -> P1 -> P2            (Mac; P2 measured against P1's baseline)
  -> F1                  (docs)
```

Stop after each phase, run the affected suites, and write one line per task (done, the check and its result,
anything left).

## Definition of done for v1

- Every task above is done, or is labelled beta with the evidence written down.
- The broker suite passes on macOS, Linux and Windows, in CI and on the VM.
- The app's chain passes on `master` with the broker pinned at the v1 commit.
- The README and design doc describe exactly what v1 does.

## The beta rule

A Windows feature may be labelled beta only when all of these are true:

1. The task was attempted, with a time box.
2. The attempt and its result are written down: what was tried, what each try showed, and where it stopped.
3. The owner has been told, and the beta label appears in the README.

"It is hard" is not enough. "It is hard, and here is the attempt that failed" is.
