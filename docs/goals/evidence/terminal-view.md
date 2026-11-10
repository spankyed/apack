# Evidence: one interpreter, and a view over the rows it sends

Results for [the goal](../goal-terminal-view.md), by phase. Each reading carries its date and conditions.

## Phase 0 — owed checks and baselines, on `master`'s code

Monorepo `6a5b677019`, broker `102ca53`, 2026-11-10, this Mac (load average 6–14 while these ran: a busy
machine, so every duration below is an upper reading).

### The broker's mutation gate over the earlier change

`cargo xtask pre-push --base facc376`, 96 mutants: 79 caught, 8 unviable, 7 timed out, **2 survived — and the
gate passed**. cargo-mutants exits 3 for a timeout and 2 for a survivor, and 3 wins when a run has both; the
gate and the CI job both accepted 3.

- The gate and `.github/workflows/mutants.yml` now read the survivors from the list the run writes (broker
  `8d31d88`).
- The two survivors are closed (broker `0fef59f`): the overflow path of a cell read has a case, and its
  filter for a null code point is gone, being unreachable there; refusing images no longer tolerates a core
  built without the protocol, which `tests/core_features.rs` rules out.
- Re-run over those two commits: 3 mutants, 3 caught.

The seven timeouts are all in `Screen::read`'s loop bound and are the suite's deadline ending a loop that
no longer ends.

### The chain

`npm run chain` in this worktree: 28 of 29 steps passed, `test:smoke` among them. `test:integration` failed
on `packages/apack-cli/tests/commands/add-extensions.integration.spec.ts` ("declares each migration under its
version line"): *stalled: its worker's process tree used no CPU for 120s*, while the broker's mutation run
held the machine. Alone, the spec passes (18 of 18, 182 s). It is not terminal code and is not this goal's
to fix; it is a test that fails on a busy machine, which the repository counts as a defect in the test.

### The window's fixes, in the real app

`tests/e2e/app-integration/terminal-window-fixes.spec.ts`, against the built app with the real emulator, the
broker and a shell. Each case was also run with the window's four terminal files at `5bc0ba224e`, the commit
before the fixes:

| Case | Before the fixes | `master` |
|---|---|---|
| A program asking where the cursor is reads one answer | read `ESC[11;1R` twice | once |
| A paste holding the marker that ends a bracketed paste runs nothing | the text after it ran (`INJ-42` printed) | held as one paste |

**Not reproduced in the app:** a terminal opened after another was closed starting with the closed one's
cells. A case for it passed on both versions, so it proved nothing and was removed. The defect was
reproduced against the emulator's module alone (`ISSUE-ghostty-integration-review.md`), and the fix — a
module instance per terminal — is what `master` has.

### Baselines against the current emulator

`npm run test:e2e -- --config tests/performance/playwright.config.ts`, lightweight recording, five warmups.

| Scenario | Trials | Reading |
|---|---|---|
| `terminal-echo`: a typed character to the frame that painted it, 40 a trial | 20 | median 16.7 ms, p90 24.9 ms, max 25.8 ms |
| `terminal-output`, 64 KiB | 20 | 1,092 ms to the shell's exit; 7 output messages; renderer tasks 57 ms |
| `terminal-output`, 16 MiB (`APACK_PERFORMANCE_TERMINAL_BYTES=16777216`) | 5 | 2,312 ms; 263 output messages; renderer tasks 647 ms, script 442 ms |

The echo is quantized by the display: the emulator paints on the next frame, so 16.7 ms is one frame at
60 Hz. The 64 KiB reading is mostly the shell exiting, which is what ends the measurement.
