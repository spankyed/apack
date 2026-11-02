# Current app query integration and timeout diagnostics

2026-10-29. This checkpoint integrates exact committed master `debeddc3a6a26d770163666434cccc6048b7ea0c`
with candidate `fbd3c1c441a02a7a481d788ec9d776b6453affd1` in detached merge
`399c4765f0be8892330f0188f39cde8215b500fc`. `integration-inputs.json` records conflict disposition.
The working agent's checkout and canonical full-green candidate were preserved.

The merge retains SQLite explanations/backend assertions, incoming native reverse-traversal clarification,
and all **five** current thread-query cases, including status-indexed queue relocation. The source archive
is exact merge source. `diagnostic-inputs.json` and `chain-fix-inputs.json` record later implementation overlays.
Documentation/evidence are not runtime qualification. Standalone platform verification now requires five cases.

## Passed qualification

All compilation and tests ran in a private Linux ARM64 container, Node 23.11.1, limited to two CPUs,
6 GiB and zero additional swap, with capabilities dropped. Quiet session-owned dependencies were copied
only after confirming byte-identical lockfiles; source, dependencies and outputs remained private.
See retained runners and JSON command/exit receipts. Native provenance is explicitly **base plus tested
patch**, not an exact native `8ab7088` checkout. `native-receipt.json` identifies that binding; the existing
exact-native CI receipt qualifies the committed native source separately.

- All publishable packages and the actual starter pack build successfully.
- Five current thread-query cases pass on SQLite, and the same five pass on elmdb; no skips.
- Fifteen reporter integration cases pass, including all three invocation shapes. Progress diagnostics
  preserve per-file queued/ended events and timing breakdowns, and cannot be read as completed-run evidence.
- Script and repository-check types, import boundaries and changed-source correctness lint pass.
- The interrupted diagnostic exposes missing chain inputs for owned `native/vectors` source. Adding that
  directory to repository-wide inputs fixes the existing guards; 112 focused chain-input, graph and unused-code
  cases pass with no skips. No source-coverage exception or assertion was relaxed.

The initial query invocation ran no assertions because the copied dependency seed lacked `node-pty`.
A private rebuild first failed because node-gyp's header extraction attempted a forbidden ownership change.
Using the image's matching installed headers (`npm_config_nodedir=/usr/local`, offline rebuild) succeeds
without adding capabilities. Both backend query invocations above are subsequent, fully prepared runs.

## Unresolved host deadline

The diagnostic host pool is **failed acceptance**: its unchanged 600-second deadline kills it after
603.396 seconds of command wall time. The optional progress log survives: 552 module completions,
519 passed, five failed and 28 skipped. This is partial module evidence, not a completed test verdict.
The container grants two CPUs but the normal pool calculation selects **one Vitest worker** there.
Do not treat this as a matched reproduction of macOS CI concurrency or as its diagnosed cause.

The run continues making progress to its deadline. Accumulated completed-module time is about 351.88 s
in tests/hooks, 172.00 s in collection, 24.77 s in prepare and 4.90 s in setup/environment. Those figures
exclude unfinished files, process scheduling and unreported work. They do not establish one bottleneck.
The five failed files are retained in `host-progress-summary.json`:

- Chain-input coverage: genuine candidate omission, fixed and verified as above.
- Unused-code population: missing generated UI API declaration prerequisite in this scratch run;
  generating it clears all affected cases without changing their gate.
- Chain-stamp population: no real chain stamp store in a direct pool diagnostic.
- Installed-app version/open: macOS-specific `plutil` and explicit macOS-only open behavior in Linux.

Strict CI now retains separate `strict-spec-progress.*.jsonl` artifacts. Its completed-run reader,
stamps, step scope and deadline are unchanged. The prior macOS 600-second failure remains unresolved;
obtain its per-file evidence before changing execution or budgets. No broad retry is claimed green.

## Small causal import-cost probe

`import-probe-runner.py` runs the same 62 real SDK assertions in candidate/control/control/candidate order.
The scratch control removes only the SQLite runtime import from the test database factory, keeps the actual
elmdb selection, and explicitly refuses SQLite. It restores original bytes in `finally`; the restoration
receipt is retained. No control change is part of product source.

Across two runs each, candidate mean wall time is 2.780 s versus control 2.426 s; summed per-module
import/setup overhead averages 1,318 ms versus 1,000 ms. Eager SQLite import has a measurable cost here.
Four short Linux runs are insufficient to extrapolate a full-suite or macOS speedup, explain the CI deadline,
or justify changing synchronous loading/Node compatibility. Keep the measurement separate from a selected fix.

`receipts.json` hashes compressed original reports/logs, including the interrupted per-file log. Raw corpus,
models, dependencies and compiler caches are not checked in. Full current Strict/platform acceptance,
query/admission heartbeat budgets and all remaining goal requirements remain open.
