# Repository tests

Package tests live beside their owner under `packages/<package>/tests/`. This directory holds checks
that need a built application, external pack projects, or controlled performance execution.

| Location | Owns | Run |
| --- | --- | --- |
| `e2e/smoke/` | Application boot and isolation; the ordinary app gate | `npm run test:e2e -- smoke` |
| `e2e/ui/` | Rendered behavior that needs Electron | `npm run test:e2e -- ui/<spec>` |
| `e2e/app-integration/` | Real process, API, filesystem and transport boundaries | `npm run test:e2e -- app-integration/<spec>` |
| `acceptance/external-pack/` | External fixture contracts, fork preparation and application consumption | `npm run test:external-pack` |
| `acceptance/packaged-authoring/` | Authoring from published tarballs, then consuming the released pack | `npm run test:packaged-authoring` |
| `acceptance/pack-dev/` | CLI supervisor, watcher and frontend integration | The app-acceptance workflow |
| `packs/` | Executable fixture pack projects, including their own tests | Through the acceptance commands |
| `performance/scenarios/` | Latency measurements and startup seeding | The [performance guide](performance/README.md) |
| `performance/checks/` | Recorder fault/correctness checks and query diagnostics | Explicit scenario selection in the performance guide |
| `_support/` | Pure data builders shared by multiple suites | Imported by their consumers |

Use the cheapest boundary that proves the behavior. Package logic belongs in its package suite;
repository tooling checks belong in `packages/repo-checks/tests/`. Neither needs Electron merely to
assert state. One-off driving belongs in `drive/`, outside test discovery.

Keep helpers with their suite unless there is a real second consumer. Shared data builders have no
browser lifecycle, recording or application dependencies. Performance helpers stay in
`performance/_support/`; reusable testing APIs stay in `@apackdev/testing`.

The smoke and acceptance steps run through the chain. Other E2E specs are opt-in (`--e2e`); performance
measurements are manual. These execution policies are unchanged by directory placement. Run one
affected spec during development and the required chain at a stable checkpoint; see
[repository validation](../CLAUDE.md#what-to-run-after-a-change).

Generated reports, profiles and producer/consumer handoffs belong under `.apack/`, never beside source.
Packaged authoring publishes `.apack/tests/authoring-handoff`; its author and app steps declare that
same output/input. Keep source inputs and output declarations current when moving test code.
