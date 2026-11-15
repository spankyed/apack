# Goal: apack-terminal v1 (apack-only, near-complete on Windows)

**Status: the agent's work is done; the goal closes on the owner's three decisions below ("Owner decisions") and
the pin's merge (R14).** Owners: the broker (`spankyed/apack-terminal`, including its `view/`
package) and the app's pin and docs (`spankyed/apack`). The detailed tasks are in
[the v1 plan](../plans/apack-terminal-v1.md); this document holds scope, decisions, phases and completion.
Deferred work is in [the public release plan](../plans/deferred/apack-terminal-public-release.md) and
[the remote-targets plan](../plans/deferred/apack-terminal-remote-targets.md).

## Prompt

````text
# Goal: apack-terminal v1 (apack-only, near-complete on Windows)

Implement docs/goals/goal-apack-terminal-v1.md. Follow CLAUDE.md and docs/AGENTS.md in both repositories.
Read Scope, Decisions, Phases and Current handoff before continuing. Task detail is in
docs/plans/apack-terminal-v1.md.
The survey was made at apack-terminal origin/master 54c1f1d and apack origin/master 7265731c6b; inspect
current code before relying on either.
The Windows VM is shared: one owner at a time, deallocated when a batch ends.
Work phases in order unless the plan's dependency order allows overlap. A phase is finished when its
Done-when conditions hold on current source. Windows beta requires a written, failed attempt.
Commit validated checkpoints. Do not merge or push without the authority recorded in Decisions.
Do not expand or reduce scope without user authorization.
````

## Why

apack-terminal is the component that owns the app's terminals. It works and is well tested, but several
things stand between it and a v1 that the app can depend on without caveats:

- The parsers that read untrusted program output have never been fuzzed.
- The recording file has no version, so a format change would silently break old recordings.
- Windows is proven only in parts: the app's own code path, the kept-session suite and test cleanup are
  not proven there.
- The echo path waits up to 16 ms for every burst.

## Scope

**In:** fuzzing, a recording format header, `unsafe` accounting, Windows completeness (the items in the
plan's Phase 2), native benchmarks, the quiet-gap output flush, and the v1 documentation.

**Out, by decision:** public release; remote-target marks, recording and path links; session handoff across a
broker restart; a GPU painter; Kitty animation; file and shared-memory image transfer; the `signal` request on
Windows; accessibility, which [goal-terminal-parity.md](../archive/goals/goal-terminal-parity.md) Phase 6 owns. See Decisions.

## Decisions

Settled with the user on 2026-11-12 unless marked.

- **D1 — apack only.** No compatibility policy, no published packages. The protocol may change in the same
  commit as the app that uses it. `PROTOCOL_VERSION` stays 1 (`CLAUDE.md`).
- **D2 — Windows near-complete.** A Windows feature may be labelled beta only under the beta rule in the
  plan, with the attempt and its failure written down and the owner told.
- **D3 — remote-target marks, recording and path links are not in v1.** Deferred; see the remote-targets plan.
- **D4 — a session ends when the broker stops.** Accepted for v1. No session handoff.
- **D5 — Windows `signal` is a documented limit.** No feature in the app calls it. Ctrl+C as input is checked
  on the VM as part of the desktop check (W6), not assumed.
- **D6 — a recording file carries a format version, starting at 1.** Recordings written before the header
  are not supported (stored developer data is not a compatibility requirement, `CLAUDE.md`).
- **D7 — the echo path flushes on a quiet gap.** The 16 ms window still bounds sustained output. Measured
  2026-11-12: back-to-back echoes median 19.8 ms; spaced keystrokes 0.2 ms.
- **D8 — accessibility is not in this goal.** The screen-reader pass belongs to
  [goal-terminal-parity.md](../archive/goals/goal-terminal-parity.md) Phase 6, decided 2026-11-12. Nothing here depends on it.
- **D9 — merge authority.** The agent may merge the broker and app pull requests it opens, once each named check
  has passed. Before merging it brings the branch up to date with `master`, re-runs the checks on that result,
  and confirms the merge changes nothing it has not tested. Merges are merge commits, not squashes, because the
  app's pin names a broker commit. It does not edit `goal-apack-terminal-v1.md` or the v1 plan without first
  checking that no other agent is editing them.

**Open decisions:** none.

## Phases

Each phase ends in finite conditions. Task IDs are the plan's.

| Phase | Tasks | Done when |
|---|---|---|
| **0. Start** | none | Pull request #14 is merged (done: `54c1f1d`). The VM is reachable (checked 2026-11-12; reached over SSH again 2026-11-14). Merge authority is settled (D9). |
| **1. Parsers and format** | T1 fuzz targets, T2 recording header, T3 `unsafe` accounting | Every fuzz target runs one clean hour locally and runs nightly in CI. A recording written now reads back; a bad header is refused; the golden file passes on all three platforms. The `SAFETY` check passes; the ASan run is clean or each report is written down. |
| **2. Windows** | W1 ConPTY marks under load, W2 app code path, W3 kept sessions (spike, then port or beta), W4 proxy test cleanup, W5 POSIX-only cases, W6 desktop check (owner) | W1: 10,000 commands in one session come back in order. W2: commands recorded by the app's own service match what was typed. W3: the `keeping` suite passes on the VM, or the beta label and its evidence exist. W4: a killed test leaves no broker. W5: each POSIX-only case runs on Windows or has a written reason and a Windows test. W6: the owner reports the desktop check. |
| **3. Speed** | P1 native benchmarks, P2 quiet-gap flush | P1: baseline recorded in `docs/architecture/testing.md`. P2: back-to-back echo median under 3 ms; `seq 1 1000000` throughput within 10% of P1's baseline; existing output and credit cases pass; the new behaviour has a case. |
| **4. Finish** | F1 documentation | The README and design doc state the v1 scope, platforms, Windows status and the crash decision. |

**Dependencies:** Phase 2 runs on the VM and Phase 1 runs on the Mac, so their work may overlap. Within a
machine, one heavy job at a time. P2 is measured against P1's baseline, so P1 comes first.

## Current handoff

- **Broker:** the v1 commit is `50080ee` on `master` (PRs #28 and #31 to #35 since the last pin). CI on all three
  platforms, the mutation jobs and the fuzz jobs pass there (R13).
- **App:** the pin moves to `50080ee` in apack PR #493 (R14), whose chain result is recorded on the pull request.
- **Proven:** R1 to R5, R7 and R10 to R13, each row below with its evidence; R6 and R8 are met with the exceptions
  the owner is asked to accept. The plan's tasks T1 to T3, W1 to W5, P1,
  P2 and F1 have their results recorded in the plan.
- **Left:** the owner's three decisions (below) and the pin's merge. Nothing else is open.
- **The VM** is idle; its daily shutdown at 07:00 UTC deallocates it, and deallocating sooner is the owner's
  (`az vm deallocate`, `windows-development-vm.md`).

## Owner decisions

The agent cannot make these. Each has what to decide and what follows from either answer.

1. **R6: accept the two kept-session cases left POSIX-only.** The ignore-hangup case (a Windows console has no
   hangup signal a program can ignore) and the half-close case (a named pipe cannot close one direction). Accept:
   R6 is met. Reject: name the case, and porting it is a new task, since neither has a Windows mechanism to test.
2. **R8: accept the 18 view and proxy cases left POSIX-only**, each gated with its reason on the case: three image
   cases and the mouse-mode case (ConPTY strips graphics APC and the DECSET 1002/1006 request, probed
   2026-11-14), four half-close cases (a named pipe), three `stty`/`od` cases (POSIX tty modes), and seven proxy
   cases over POSIX socket files, paths and permission bits. Accept: R8 is met. Reject: as for R6.
3. **R9: the desktop check (plan W6), about ten minutes over RDP:** open the app, open a terminal, run a
   PowerShell command and see it drawn, type `@` and `{` on a German layout, check the command marks in the gutter,
   and stop `ping -t localhost` with Ctrl+C. Done: R9 is met. Waived: R9 closes as a known limit, written in the
   broker README's Windows status as "the app's window on Windows is not checked by hand".

## Acceptance

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| R1 Parsers fuzzed in CI | Met: five targets (`frames`, `view_wire`, `markers`, `png`, `recording`) run every night on Linux under nightly (`fuzz.yml`, 20 minutes each, or a dispatch's budget), starting from tracked seeds (`fuzz/seeds/`, PR #34, merged as `05749ca`); a crash fails the job and uploads its input. Each run uploads the corpus it grew as an artifact (kept 14 days), and the next run starts from the newest one `master` uploaded (PR #35, merged as `50080ee`); the corpus used to live in the Actions cache, where the Rust build caches evicted it, and only `master` saves those now | Nightly runs 2026-11-13 and 2026-11-14, success; dispatch 43628218606 on `05749ca`, 120 s a target, success, each target loading its tracked seeds; on the Mac, one hour a target on the seeded tree, 2026-11-14, no crash (`frames` 32.1M runs, `markers` 218M, `png` 0.45M, `recording` 267M, `view_wire` 148M); two dispatches on `50080ee`, the second starting from the first's corpus (43647623289 from the seeds, then 43647644829 from 1992 `frames` inputs, 830 `view_wire`, 264 `markers`, 292 `png`, 233 `recording`) | none |
| R2 Recording format versioned | Met: a recording begins with the magic `APKREC` and format 1; a file without the header, or of another format, is refused and says why (`be263dc`). The golden file `tests/fixtures/recording-format-1.apkrec` reads back | Recording suite on the Mac, 34 passed, 2026-11-14; CI's tests on macOS, Linux and Windows pass on `master` | none |
| R3 `unsafe` blocks accounted for | Met: every `unsafe` site has a `SAFETY` comment, and `cargo xtask check-safety` fails on one without and on finding none; it passes on `master`. The suite runs clean under AddressSanitizer on x86_64 Linux (`asan.yml`) | `check-safety` on the Mac, 2026-11-14; ASan run 43601063124 on `436a8ae`, 2026-11-14, success (and on `63d78cd`, 2026-11-12) | none |
| R4 Command marks correct under ConPTY load | Met: one PowerShell session with the app's shell integration ran 10,000 typed commands through the broker on the VM; the listener saw 10,000 starts and 10,000 finishes, all in order, none missing or duplicated, every outcome `exited` 0, and the 256 the broker keeps match the last 256 written | 2026-11-13 VM run (`.apack/w1-order.ts`, `C:\apack-setup\w1-result.json`); plan W1 | none |
| R5 App code path works on Windows | Met: the headless API on the VM opened a PowerShell terminal through the app's terminal service (`terminal.CREATE_TERMINAL`), three lines were typed through `terminal.TERMINAL_INPUT`, and the broker's record of that session lists the three commands in order, each `exited` with the status the app's own shell integration reported: `Write-Output "w2-one"` 0, `Get-Item C:\w2-does-not-exist` 1, `Write-Output "w2-three"` 0. The app keeps no command list of its own; a status is `exited` only when a mark carrying the app's key said so | 2026-11-15 VM run (`.apack/w2-readback.ts`, `C:\apack-setup\w2-readback.json`), app at `3d5f18867`, broker at `6e9c953`; plan W2 | none |
| R6 Kept-session suite on Windows, or beta with evidence | Met with two justified exceptions: 13 of the 15 `keeping` cases pass on the VM (`keeping::`, 2026-11-14), including the job-group case ported this round. The other two are POSIX-only and gated with their reasons: the ignore-hangup case (a Windows console has no hangup a program can ignore) and the half-close case (a named pipe cannot close one direction) | 2026-11-14 VM run; PR #32 | Owner decision 1 |
| R7 Killed test leaves no broker on Windows | Met: the proxy-ending case passes on the VM and the broker process count is 0 once the run ends | 2026-11-14 VM run (`proxy::a_broker_a_proxy_started`) | none |
| R8 POSIX-only cases ported or justified | Met with justifications. The view and proxy suites run 402 cases on the VM, with no failures. 18 POSIX-only cases stay gated, each with its reason on the case: ConPTY does not pass graphics APC or the mouse-mode request (probed 2026-11-14), POSIX tty mode (`stty`, `od`), one direction of a connection, and POSIX socket files, paths and permission bits. The title, clipboard and unread-answer cases are now ported, and the disconnect fix (PR #33) is what made the last one pass | 2026-11-14 VM run (full suite, 402 passed); PR #33 | Owner decision 2 |
| R9 Desktop check of the app's window on Windows | Not done; the agent cannot perform it (plan W6) | none | Owner decision 3 |
| R10 Native benchmarks with a recorded baseline | Met: the broker's native baseline is recorded in `docs/architecture/testing.md` ("Native numbers: the baseline"), from `cargo bench --bench broker` on the Mac, 2026-11-12, load about 8 during the run | `docs/architecture/testing.md`, 2026-11-12 | none required; a quiet-machine re-run would tighten the figures |
| R11 Quiet-gap flush | Met: held output is sent after a 1 ms quiet gap (`e2069c7`), and a case states it. Back-to-back echo median 1.17 ms on a Linux runner and 1.97 ms on the developer's Mac (16.1 and 18.1 ms before); `seq 1 1000000` throughput ×1.02 on Linux and ×1.25 on macOS against the commit before the change on the same machine | Bench run 43714875496 (7e570e3 against 50080ee, alternated eight times on ubuntu-24.04 and macos-15), 2026-11-15; six alternated rounds on the Mac, 2026-11-15; plan P2 | none |
| R12 v1 scope in README and design doc | Met: the README status table states the v1 scope, platforms, Windows status and crash behaviour, and design.md has a v1 scope section and its known limits (PR #31, merged as `39fb58c`) | PR #31; `docs/architecture/design.md`, README | none |
| R13 Broker suite green on macOS, Linux, Windows | Met at the v1 commit `50080ee`: CI (the suite on all three platforms, the checks, the view), the mutation jobs and the fuzz jobs pass on `master` | Broker runs on `50080ee`, 2026-11-15: CI 43647602884 (its Windows job's first attempt failed installing nextest, a certificate revocation check offline on the runner, and passed on re-run), mutants on push, fuzz nightly | none |
| R14 App chain green with the pin at the v1 commit | The pin moves to `50080ee` in apack PR #493 | The chain run recorded on PR #493 | Met when PR #493 merges with its chain green (D9) |

## Constraints

- Mutation-test nothing that signals or kills processes (`CLAUDE.md`, the broker's `mutants.toml`).
- The VM is shared: one owner at a time, and deallocate it when a batch ends. Check it reports
  `VM deallocated` after stopping. See `docs/references/guides/windows-development-vm.md`.
- Use the process rules in both `CLAUDE.md` files: no pattern-based kills, and containers named by the
  work's prefix.
- No attribution lines in commits or pull requests.
- No Windows feature is labelled beta without the written attempt. "It is hard" is not an attempt.

## Outcome

Not yet: every requirement the agent can meet is met, and closure waits on the owner's decisions and the pin's
merge. No Windows feature is labelled beta: each Windows gap is either ported or gated with a reason the owner is
asked to accept, and none was a failed attempt.
