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

| Finding | Disposition | Implementation | Evidence | Guard | Remaining |
|---|---|---|---|---|---|
| T4 | test | correlation work, pre-goal | `tests/features/code/fe/terminal-opens-for-the-asker.spec.ts` | the spec itself | — |
| M3 | test | correlation work, pre-goal | `tests/features/code/be/terminal-answers-the-asker.spec.ts` | the spec itself | — |
| S2 | test | `apack-host/src/bus/client-events.ts` — payload out of the log, `summarizeEventForLog` deleted | `apack-host/tests/bus/client-events.spec.ts` "lets no part of a payload reach a log, by any field" | the sentinel search over the serialized record: re-adding a payload under any key fails it. Mutation-checked — restoring `event` to the log fails 3 cases | — |
| S1 | test | the token captured and deleted at boot (`api/src/boot/config.ts`, called from `server.ts`); the shell's environment derived from `APP_PROCESS_ENV_VARS` (`apack-sdk/src/env/index.ts`, `default-setup/src/features/code/be/services/shell-environment.ts`) | `api/tests/transport/api-access.spec.ts` "is gone from the environment once captured"; `default-setup/tests/features/code/be/services/shell-environment.spec.ts` "keeps none of the variables the app set on its own process" | both specs, plus the typecheck: `getEnvironment`'s record is typed `AppProcessEnv`, so a variable added there and not named in the list, or named and not set, fails to compile. Mutation-checked three ways — dropping the `delete`, writing the strip list out by hand, and both directions of the record | closes G2 and G4 |
| F9 | test | every failure goes through one `failTerminal` (`features/code/be/features/terminal.ts`), which calls `reportError` and answers the asker; the surface's write-only `terminalError` field and its three `clearTerminalError` wirings deleted, the settle kept as `settleFailedAsk` | `default-setup/tests/features/code/be/terminal-failures-reach-the-user.spec.ts`, three cases | the spec: removing the `reportError` call fails all three. `terminal.ERROR` is also out of `TerminalNewsType`, so broadcasting one no longer type-checks | — |
| X3 | test | `main/src/modules/app-menu.ts` — renamed from `MacOSAppMenu.ts`, since it is no longer one platform's; `appMenuTemplate(platform, env)` is pure, and off macOS returns devtools and fullscreen alone so Electron's default is never what stands | `main/tests/app-menu.spec.ts`, six cases | the spec: an empty off-macOS template fails it (Electron's default would stand), and so does any accelerator or role carrying a key a shell needs. Mutation-checked both ways |
| X10 | test | `apack-sdk/src/fe/hotkeys.ts` — `cmd` resolves to the platform's accelerator, Meta on a Mac and Control elsewhere; `ctrl` unchanged, which is what the two `Ctrl+\`` defaults want | `apack-sdk/tests/fe/hotkeys.spec.ts`, seven cases over the shipped defaults | the spec, with the platform as an argument so both are checked from either. Mutation-checked: restoring the `=== event.metaKey` comparison fails four, and the three it leaves are the Mac and `ctrl` cases that must not move |
| G3 | open | fixed on `session/claude-code-integration` (#372), not on master | `hooks.ts` calls `killAllHandles()` there | — | closes when #372 lands; confirm it survives the cleanup pass |

Disposition values: `test`, `dissolved`, `driven`, `open`.

**Guard** is required for `dissolved` and is what makes that disposition mean anything: the check that fails
if the construction which removed the finding is undone. A `dissolved` row with no guard is **not** closed —
it is unverified and stays `open`. For a `test` row the spec is its own guard. The goal's acceptance section
lists the guards its sixteen dissolved findings are expected to carry. A fix that exists only on an unmerged branch is
`open` with its branch named: the goal runs against master, and a row that reads closed because another
branch closed it is how a regression gets shipped.

## Checkpoints

None yet. Each entry carries its date, source commit, the exact commands run and their results, and any
limitation the run did not cover. A failed check stays visible until it is resolved.

### VT parsing cost (Phase G) — not taken

The reading that sizes the broker's parsing worker and its history cap, with its corpus and conditions. It
is not a decision input: D11 settles the broker's language on native process ownership and ABI
independence, neither of which a parsing reading speaks to. An earlier revision of the goal made this
reading the premise that chose the language, which would have answered a question whose real support lies
elsewhere — `worker_threads` is already how this repo keeps compiler work off a loop, so off-loop parsing
was never the discriminator.

### Baseline (Phase G) — not taken

The goal's Phase G baseline is unrepeatable once Phase B moves state, and the
[ghostty-web migration](../../deferred/xterm-to-ghostty-web.md) requires the same measurement for its own
cutover. It is recorded here when taken, with the machine, the output corpus and the conditions
`npm run measure` prints, so both can cite one reading rather than two.
