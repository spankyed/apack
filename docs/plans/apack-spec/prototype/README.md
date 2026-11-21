# The apack-spec prototype

What [`../../apack-spec.md`](../../apack-spec.md) describes, as code that runs. It is evidence for a plan, not part of
the app: nothing imports it, and no check covers it.

| File | What it is |
|---|---|
| `state.mts` | The types a state's code is checked against, and the kernel: systems, steps, asks, the link between a backend and its windows |
| `search.mts` | The app's code search, backend and surface, ported. Runs |
| `library.mts` | The app's library system ported handler for handler. Typechecks against stand-ins for its imports; not run |
| `threads.mts` | Three backend systems and two windows: asks, tells, a streamed reply, a broadcast, a disconnect, and a refusal that carries data. Runs |
| `graph.mts` | Derives each state's graph from its types, running nothing |
| `xstate-survey.mts` | The survey of how the app uses XState that the plan's figures come from |

Run from the repo root.

```bash
npx tsx docs/plans/apack-spec/prototype/search.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/threads.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/graph.mts docs/plans/apack-spec/prototype/threads.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/xstate-survey.mts "$PWD"
```

Typecheck:

```bash
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --noUncheckedIndexedAccess --skipLibCheck --types node docs/plans/apack-spec/prototype/state.mts docs/plans/apack-spec/prototype/search.mts docs/plans/apack-spec/prototype/library.mts docs/plans/apack-spec/prototype/threads.mts
```
