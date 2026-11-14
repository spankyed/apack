# Goal: apack-terminal v1 (apack-only, near-complete on Windows)

**Status: planned, ready to start.** Owners: the broker (`spankyed/apack-terminal`, including its `view/`
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

- **Broker source:** `origin/master` 54c1f1d. #10 to #14 are merged, including the proxy `done` request, the
  recording-list pruning, the deadline heap and the blink fixes.
- **App source:** `origin/master` 7265731c6b, which includes the plan documents. The app pins the broker at
  `efe5d84`, behind `54c1f1d`. Moving the pin is part of acceptance (below), with the app chain.
- **Green on the broker's `master` at `f385161`.** That is #15, which fixed the red baseline left by #14: a
  test that killed sessions it had not waited for, rewritten to let them end on their own. The broker's CI and
  mutation jobs pass on `f385161`. One earlier mutation-baseline timeout, in
  `keeping::a_session_begins_with_the_screen_its_recording_holds`, was not reproduced in three local runs. If it
  recurs, read its log before changing anything.
- **Proven:** the broker suite passes on macOS (440 cases, local, including the fix) and on Windows (the
  affected suites on the VM, 46 cases, after #14). The PowerShell hook was driven through the broker on the VM in
  2026-11-12 (`docs/goals/evidence/terminal-view.md`, "On Windows, and a picture in the real app").
- **Not proven:** the app's own code path on Windows (W2); the kept-session suite on Windows (W3); test
  cleanup of proxy-started brokers on Windows (W4); ConPTY marks under load (W1); the desktop check (W6).
- **2026-11-14:** broker PR #28 (`fix/windows-hang-up`) is open and not merged. It carries the named-pipe hang-up, the Windows kill fix (through the wezterm git commit `8afe0ad307`, with an upstream issue asking for a release), the ported keeping, proxy and view suites, and the design doc's Windows limits. Its CI fails in three places: `cargo fmt` (fixed in `cdb2cbd`), a Windows timing failure in one keeping case (fixed in `cdb2cbd`), and a Linux mutant in the Windows-only arm of `hang_up`. The Linux mutation job cannot kill that mutant, because it is compiled out on Linux, and the workflow answers mixed files with a Windows dispatch. Choosing how to gate it is open. The app pin is not moved.
- **Next:** T1, T2 and W1 can start at once, on different machines.
- **Evidence file:** `docs/references/evidence/apack-terminal-v1.md`, to be created with the first checkpoint.

## Acceptance

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| R1 Parsers fuzzed in CI | Not started | none | T1 |
| R2 Recording format versioned | Not started | none | T2 |
| R3 `unsafe` blocks accounted for | Not started | none | T3 |
| R4 Command marks correct under ConPTY load | Not tested | 2026-11-12 VM run of the hook, 3 commands only | W1 |
| R5 App code path works on Windows | Partly: the app's terminal service opens PowerShell through the broker on the VM, and typed input reaches the shell. The recorded commands with statuses are not read back on Windows | 2026-11-12 VM run (headless API, marker file) | W2 |
| R6 Kept-session suite on Windows, or beta with evidence | Partly: 12 of the 15 `keeping` cases pass on the VM. The other 3 are POSIX-only (trap HUP, process groups, one-direction close) and gated with reasons, which is not yet accepted as met | 2026-11-14 VM run (`keeping::`, 12 passed) | W3: accept or port the 3 |
| R7 Killed test leaves no broker on Windows | Met: the proxy-ending case passes on the VM and the broker process count is 0 once the run ends | 2026-11-14 VM run (`proxy::a_broker_a_proxy_started`) | none |
| R8 POSIX-only cases ported or justified | Partly: 25 of 30 view and proxy cases pass on the VM. 13 stay gated with a POSIX reason. 5 fail on Windows and are gated without a diagnosis (2 image placements, OSC title and clipboard, mouse-mode report, hang-up on unread answers) | 2026-11-14 VM run (`proxy::`, `view_broker::`: 25 passed) | W5: diagnose and port the 5 |
| R9 Desktop check of the app's window on Windows | Not done; needs owner | none | W6 (owner) |
| R10 Native benchmarks with a recorded baseline | Met: the broker's native baseline is recorded in `docs/architecture/testing.md` ("Native numbers: the baseline"), from `cargo bench --bench broker` on the Mac, 2026-11-12, load about 8 during the run | `docs/architecture/testing.md`, 2026-11-12 | none required; a quiet-machine re-run would tighten the figures |
| R11 Quiet-gap flush | Not started; echo median 19.8 ms | 2026-11-12 measurement | P2 |
| R12 v1 scope in README and design doc | Partly: the broker's design doc states the Windows limits and the session-ends-with-broker decision (PR #28). The broker repository has no README to update | PR #28 | F1: finish once W2 and R8 are settled |
| R13 Broker suite green on macOS, Linux, Windows | Green on `master` at `f385161` (CI and mutation jobs) | Broker runs on `f385161`, checked 2026-11-12 | Re-confirm after each phase |
| R14 App chain green with the pin at the v1 commit | Pin at `efe5d84` | none | Pin move and `npm run chain -- --no-native`, after R13 |

## Constraints

- Mutation-test nothing that signals or kills processes (`CLAUDE.md`, the broker's `mutants.toml`).
- The VM is shared: one owner at a time, and deallocate it when a batch ends. Check it reports
  `VM deallocated` after stopping. See `docs/references/guides/windows-development-vm.md`.
- Use the process rules in both `CLAUDE.md` files: no pattern-based kills, and containers named by the
  work's prefix.
- No attribution lines in commits or pull requests.
- No Windows feature is labelled beta without the written attempt. "It is hard" is not an attempt.

## Outcome

Not yet. Closure is recorded here, with the phases' results, the acceptance table and the evidence, when every
requirement is done or labelled beta under the rule.
