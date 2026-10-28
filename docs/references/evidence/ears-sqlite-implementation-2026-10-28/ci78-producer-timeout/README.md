# Strict 78eff95202 producer timeout

Strict run 40728583374, attempt 1, is terminal failure at exact source
78eff952020f813d7a25642aa4740a394ed71a5e. Producers completed package preparation, shipped-pack build,
external-pack contract and the preceding typecheck legs. `typecheck:scripts` timed out at 62 seconds under
its existing 60-second quick budget. Its captured output has the command header and no TypeScript diagnostic.
The downstream consumer jobs were skipped. This is not a successful gate.

The retained chain artifact and full producer log preserve actual output. The exact failed command is
`npm run typecheck:scripts`, which runs tsc over scripts, tests, repo-checks and publish-checks sequentially.
A clean git archive of the exact failing source was copied into disposable Linux, with the same Node 23.11.1,
private dependencies/native engine and two-core limit used for this session's validation. Normal five-package
build preparation passes. The unmodified command then passes in 38.599 seconds with the original 60-second
timeout. `result.json` and the successful command log retain that evidence; it is not a macOS reproduction
and does not establish the host timeout's cause. No timeout, node version or typecheck scope was changed.

The verified recovery continuation dc058cbada is newer than this failed gate. Publish that continuation with
this diagnosis and dispatch one strict run on the new exact tip rather than spending a rerun on the superseded
source. Do not promote canonical until that exact tip succeeds. A later recurrence needs fresh diagnosis;
this result is not permission to retry until green or relax the budget.
