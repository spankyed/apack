# Terminal session ownership — evidence

Checkpoint history and the acceptance table for
[goal-terminal-ownership](../../goals/goal-terminal-ownership.md). Findings keep their authoritative home in
[the terminal integration review](../../issues/ISSUE-terminal-integration-review.md); this record owns their
**disposition** and the evidence that closed each one.

## Acceptance table

One row per finding, added when the finding is touched rather than pre-seeded — the review document is the
list, and a copy of it here would drift from it.

A row closes only as the goal's decision D6 allows: a test that fails before the change and passes after, or
an explicit `driven: <what was done>` with the reason no test fits. `dissolved` records that the destination
removes the finding rather than fixing it, and names the construction that does.

| Finding | Disposition | Implementation | Evidence | Remaining |
|---|---|---|---|---|
| T4 | test | correlation work, pre-goal | `tests/features/code/fe/terminal-opens-for-the-asker.spec.ts` | — |
| M3 | test | correlation work, pre-goal | `tests/features/code/be/terminal-answers-the-asker.spec.ts` | — |

Disposition values: `test`, `dissolved`, `driven`, `open`.

## Checkpoints

None yet. Each entry carries its date, source commit, the exact commands run and their results, and any
limitation the run did not cover. A failed check stays visible until it is resolved.

### Baseline (Phase G) — not taken

The goal's Phase G baseline is unrepeatable once Phase B moves state, and the
[ghostty-web migration](../../deferred/xterm-to-ghostty-web.md) requires the same measurement for its own
cutover. It is recorded here when taken, with the machine, the output corpus and the conditions
`npm run measure` prints, so both can cite one reading rather than two.
