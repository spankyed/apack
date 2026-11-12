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
Windows. See Decisions.

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
- **D8 — accessibility is optional for v1 and not started.** *Open:* it overlaps
  [goal-terminal-parity.md](goal-terminal-parity.md) Phase 6 (screen reader). Which goal owns it is an open
  decision (O2); until it is answered, F2 is not started.

**Open decisions**

- **O1 — merge authority.** May the agent merge the broker and app pull requests it opens once each named
  check passes? Until answered, the agent opens them and stops before merging.
- **O2 — who owns the screen-reader pass.** This goal (F2) or the parity goal (Phase 6). Blocks F2 only.

## Phases

Each phase ends in finite conditions. Task IDs are the plan's.

| Phase | Tasks | Done when |
|---|---|---|
| **0. Start** | none | Pull request #14 is merged (done: `54c1f1d`). The VM is reachable (checked 2026-11-12). O1 and O2 are answered or left open with their tasks not started. |
| **1. Parsers and format** | T1 fuzz targets, T2 recording header, T3 `unsafe` accounting | Every fuzz target runs one clean hour locally and runs nightly in CI. A recording written now reads back; a bad header is refused; the golden file passes on all three platforms. The `SAFETY` check passes; the ASan run is clean or each report is written down. |
| **2. Windows** | W1 ConPTY marks under load, W2 app code path, W3 kept sessions (spike, then port or beta), W4 proxy test cleanup, W5 POSIX-only cases, W6 desktop check (owner) | W1: 10,000 commands in one session come back in order. W2: commands recorded by the app's own service match what was typed. W3: the `keeping` suite passes on the VM, or the beta label and its evidence exist. W4: a killed test leaves no broker. W5: each POSIX-only case runs on Windows or has a written reason and a Windows test. W6: the owner reports the desktop check. |
| **3. Speed** | P1 native benchmarks, P2 quiet-gap flush | P1: baseline recorded in `docs/architecture/testing.md`. P2: back-to-back echo median under 3 ms; `seq 1 1000000` throughput within 10% of P1's baseline; existing output and credit cases pass; the new behaviour has a case. |
| **4. Finish** | F1 documentation, F2 accessibility (optional, see O2) | The README and design doc state the v1 scope, platforms, Windows status and the crash decision. F2 is done or explicitly not started. |

**Dependencies:** Phase 2 runs on the VM and Phase 1 runs on the Mac, so their work may overlap. Within a
machine, one heavy job at a time. P2 is measured against P1's baseline, so P1 comes first.

## Current handoff

- **Broker source:** `origin/master` 54c1f1d. #10 to #14 are merged, including the proxy `done` request, the
  recording-list pruning, the deadline heap and the blink fixes.
- **App source:** `origin/master` 7265731c6b, which includes the plan documents. The app pins the broker at
  `efe5d84`, behind `54c1f1d`. Moving the pin is part of acceptance (below), with the app chain.
- **Red on the broker's `master` since `54c1f1d`.** Two failures on the merged commit. The Linux suite failed
  on `recording::a_recording_whose_session_ended_is_no_longer_named`, a test added with #14, which killed
  sessions it had not waited for. Fixed on local branch `fix/recording-test-waits-for-exit` (`204d712`, not
  pushed): the sessions end by their own exit. The mutation job's unmutated baseline failed on
  `keeping::a_session_begins_with_the_screen_its_recording_holds` with a 15 s timeout waiting for a frame.
  Not reproduced in three local runs of the kept-session cases. Unexplained; a CI rerun after the fix is the
  next check, and a recurrence needs its log read before anything is changed.
- **Proven:** the broker suite passes on macOS (440 cases, local, including the fix) and on Windows (the
  affected suites on the VM, 46 cases, after #14). The PowerShell hook was driven through the broker on the VM in
  2026-11-12 (`docs/goals/evidence/terminal-view.md`, "On Windows, and a picture in the real app").
- **Not proven:** the app's own code path on Windows (W2); the kept-session suite on Windows (W3); test
  cleanup of proxy-started brokers on Windows (W4); ConPTY marks under load (W1); the desktop check (W6).
- **Next:** push `fix/recording-test-waits-for-exit` and confirm the broker's CI and mutation jobs are green.
  Then T1, T2 and W1 can start at once, on different machines.
- **Evidence file:** `docs/references/evidence/apack-terminal-v1.md`, to be created with the first checkpoint.

## Acceptance

| Requirement | Implementation / source | Evidence | Remaining work |
|---|---|---|---|
| R1 Parsers fuzzed in CI | Not started | none | T1 |
| R2 Recording format versioned | Not started | none | T2 |
| R3 `unsafe` blocks accounted for | Not started | none | T3 |
| R4 Command marks correct under ConPTY load | Not tested | 2026-11-12 VM run of the hook, 3 commands only | W1 |
| R5 App code path works on Windows | Not run | none | W2 |
| R6 Kept-session suite on Windows, or beta with evidence | Not run; suite is POSIX-only | none | W3 |
| R7 Killed test leaves no broker on Windows | No-op on Windows | none | W4 |
| R8 POSIX-only cases ported or justified | 26 POSIX-only cases | none | W5 |
| R9 Desktop check of the app's window on Windows | Not done; needs owner | none | W6 (owner) |
| R10 Native benchmarks with a recorded baseline | Not started; the Node figure is not the broker's | 2026-11-12 Node measurement, not comparable | P1 |
| R11 Quiet-gap flush | Not started; echo median 19.8 ms | 2026-11-12 measurement | P2 |
| R12 v1 scope in README and design doc | Not started | none | F1 |
| R13 Accessibility pass (optional) | Not started; owner open (O2) | none | F2 |
| R14 Broker suite green on macOS, Linux, Windows | Red on `master` (`54c1f1d`): one Linux test, one baseline timeout (see handoff) | CI runs `43172600064` and `43172600048` | Push `204d712`, confirm CI green, read any recurrence of the timeout |
| R15 App chain green with the pin at the v1 commit | Pin at `efe5d84` | none | Pin move and `npm run chain -- --no-native`, after R14 |

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
