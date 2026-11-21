# The apack-spec prototype

What [`../../apack-spec.md`](../../apack-spec.md) describes, as code that runs. The design on one page, with a
complete example, is [`../design.md`](../design.md). It is evidence for a plan, not part of
the app: nothing imports it, and no check covers it.

| File | What it is |
|---|---|
| `state.mts` | The types a state's code is checked against, and the kernel: systems, steps, asks, the link between a backend and its windows |
| `draft.mts` | Data edited in place, from which a new value is made. What the kernel uses for a nested change |
| `append-cost.mts` | What a growing list costs one change at a time and in batches, on the draft and through an ask. Runs, for about 25 seconds |
| `mirror.mts` | A running state as a value a component reads: each field is the state's own object, never copied or wrapped, written when the state replaces it. One mirror for each state, shared by all that read it |
| `vue.mts` | `useState`: what a Vue component uses to read a running state and tell it things |
| `vue-check.mts` | `useState` checked by rendering real components with Vue's runtime and counting what rendered, as render functions and as compiled templates. Runs |
| `vue-fixture/` | A component file with a template, and the states it reads, for `vue-tsc` to check: what a template may read, and six lines that have to be errors |
| `window-frame.mts` | What a frame is in a window: the next paint while it shows, the next turn while it is hidden |
| `progress-check.mts` | That progress is gathered and nothing else is, and that what a state hears keeps the order it was sent in. Runs |
| `schedule.mts` | A schedule given to the kernel in place of the event loop: runs a scenario under every ordering, or a seed's worth, and replays one |
| `interleaving-check.mts` | Scenarios run under every ordering: a search over a search, a cancel, a click among progress, a window closing. Runs, for about 7 seconds |
| `commit.mts` | A slice of the app's commit surface ported: its status and a diff as reads it awaits, staging and a push as writes it makes. Runs, and checks what each step leaves |
| `internal-check.mts` | Who may send a state what: the events it sends itself reach it from nowhere else, and one surface tells another in its window. Runs |
| `awaits-check.mts` | The reads a state awaits: from the fields it names, or one for each key of a field. Runs |
| `makes-check.mts` | The writes a state makes: said once with `make`, with which are under way kept by the kernel. Runs, for about 10 seconds |
| `checks.mts` | What every check file runs its checks with: each system a check makes is stopped however it ends and given a limit on its steps, and `rest()` waits until what the check started has come to rest |
| `starts-check.mts` | The states a state starts: declared, and which of them run follows from its data. Runs |
| `follows-check.mts` | The views a state follows: declared, and which are followed, and what each is asked for, follow from its data. Runs |
| `answer-check.mts` | An ask that changes something as it answers: the change is there with the answer, a refused change fails the ask, nothing is lost across a wait. Runs |
| `failure-check.mts` | What happens when a state's work or a handler throws: where the state goes, and that the kernel goes on. Runs |
| `leaving-check.mts` | What happens to an ask when whoever made it goes: it throws `Left` where awaited, `finally` runs, the answerer is told, nothing hangs. Runs |
| `binding-check.mts` | That a reader is handed the state's own values and runs when a field it read is replaced, that none of it can be written, and that a hidden window still hears. Runs |
| `kernel-check.mts` | What the kernel does with a change to data, a move that edits a draft and the refused edits included. Runs |
| `draft-check.mts` | The checks a hand-built draft has to pass. Runs |
| `search.mts` | The app's code search, backend and surface, ported. Runs, and checks what each step leaves |
| `library.mts` | The app's library system ported handler for handler. Typechecks against stand-ins for its imports; not run |
| `threads.mts` | Three backend systems, a state per thread, and two windows: asks, tells, a reply the thread writes and broadcasts, windows that leave part-way, and a refusal that carries data. Runs, and checks what each step leaves |
| `views.mts` | A surface following views, modelled on the threads surface: one always, one while a thread is open, one per tab. Runs, and checks what is followed after each step |
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
npx tsx docs/plans/apack-spec/prototype/views.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/draft-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/kernel-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/binding-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/vue-check.mts
```

```bash
npx vue-tsc --noEmit -p docs/plans/apack-spec/prototype/vue-fixture/tsconfig.json
```

```bash
npx tsx docs/plans/apack-spec/prototype/progress-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/leaving-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/failure-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/answer-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/starts-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/commit.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/awaits-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/internal-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/makes-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/follows-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/interleaving-check.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/append-cost.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/graph.mts docs/plans/apack-spec/prototype/threads.mts
```

```bash
npx tsx docs/plans/apack-spec/prototype/xstate-survey.mts "$PWD"
```

Typecheck:

```bash
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --noUncheckedIndexedAccess --skipLibCheck --types node docs/plans/apack-spec/prototype/draft.mts docs/plans/apack-spec/prototype/draft-check.mts docs/plans/apack-spec/prototype/kernel-check.mts docs/plans/apack-spec/prototype/mirror.mts docs/plans/apack-spec/prototype/vue.mts docs/plans/apack-spec/prototype/vue-check.mts docs/plans/apack-spec/prototype/window-frame.mts docs/plans/apack-spec/prototype/binding-check.mts docs/plans/apack-spec/prototype/progress-check.mts docs/plans/apack-spec/prototype/leaving-check.mts docs/plans/apack-spec/prototype/failure-check.mts docs/plans/apack-spec/prototype/answer-check.mts docs/plans/apack-spec/prototype/starts-check.mts docs/plans/apack-spec/prototype/commit.mts docs/plans/apack-spec/prototype/awaits-check.mts docs/plans/apack-spec/prototype/internal-check.mts docs/plans/apack-spec/prototype/makes-check.mts docs/plans/apack-spec/prototype/checks.mts docs/plans/apack-spec/prototype/follows-check.mts docs/plans/apack-spec/prototype/schedule.mts docs/plans/apack-spec/prototype/interleaving-check.mts docs/plans/apack-spec/prototype/append-cost.mts docs/plans/apack-spec/prototype/state.mts docs/plans/apack-spec/prototype/search.mts docs/plans/apack-spec/prototype/library.mts docs/plans/apack-spec/prototype/threads.mts docs/plans/apack-spec/prototype/views.mts
```
