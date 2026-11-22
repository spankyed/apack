# The apack-state prototype

What [`../../apack-state.md`](../../apack-state.md) describes, as code that runs. The design on one page, with a
complete example, is [`../design.md`](../design.md). It is evidence for a plan, not part of
the app: nothing imports it, and no check covers it.

| File | What it is |
|---|---|
| `state.mts` | The types a state's code is checked against, and the kernel: systems, steps, asks, the link between a backend and its windows |
| `draft.mts` | Data edited in place, from which a new value is made. What the kernel uses for a nested change |
| `append-cost.mts` | What a growing list costs one change at a time and in batches, on the draft and through an ask. Runs, for about 25 seconds |
| `frozen-cost.mts` | What a frozen list costs to read and to copy, beside the same list unfrozen. A measurement: it prints, and refuses nothing |
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
| `store.mts` | Rows as the rule about them is checked: one interface, and rows kept in memory behind it. `transact` is all the kernel is given of it |
| `store-elmdb.mts` | The same interface over the app's engine, elmdb, on a temporary database. Needs the checkout's dependencies |
| `rows-check.mts` | A step as one unit of the database: a handler's rows, data and what it sent kept together, on both stores. Runs, for about 12 seconds |
| `rows-property.mts` | The same rule as a property: runs of handlers made from a seed, held against a model of a few lines, one after another and under way together. Runs, for about 25 seconds, and names the seed of a run that differs |
| `views-check.mts` | A window hears of a step after its views show it: views over the link, and what a step sends windows held until they have been sent its rows. Under every ordering in memory, and on elmdb. Runs, for about 10 seconds |
| `rows-cost.mts` | What a unit around a step and around each handler costs on elmdb, beside the engine alone, and what holding an answer for the views costs a window. A measurement: it prints, and refuses nothing |
| `writes-survey.mts`, `writes-shape.mts` | Where the app writes to the database, and how each function that writes does it, read from syntax trees. Each takes the checkout to read |
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
npx tsx docs/plans/apack-state/prototype/search.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/threads.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/views.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/draft-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/kernel-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/binding-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/vue-check.mts
```

```bash
npx vue-tsc --noEmit -p docs/plans/apack-state/prototype/vue-fixture/tsconfig.json
```

```bash
npx tsx docs/plans/apack-state/prototype/progress-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/leaving-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/failure-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/answer-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/starts-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/commit.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/awaits-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/internal-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/makes-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/follows-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/interleaving-check.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/append-cost.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/graph.mts docs/plans/apack-state/prototype/threads.mts
```

```bash
npx tsx docs/plans/apack-state/prototype/xstate-survey.mts "$PWD"
```

Typecheck, every `.mts` file here. The options are `tsconfig.json`'s, which the fixture's extends, and the files are
whichever are in the directory, so one added is checked without being named:

```bash
npx tsc -p docs/plans/apack-state/prototype
```
