# apack-spec: the design on one page

This is the design as it stands, with no history. How it got here, what was tried first and what is not built are in
[the plan](../apack-spec.md). Everything shown here runs in [`prototype/`](prototype/).

## A state

There is one primitive, a **state**. A state has its own data, and is at exactly one of the states inside it. What you
read is where it is and the data there:

```ts
{ at: 'thread.sending', data: { titles, threadId, text } }
```

Data exists only while the state that declares it is the case. `threadId` is there while the state is somewhere inside
`thread`, and reading it anywhere else does not compile.

## What a state declares

Its shape is a type. Its definition has the same keys at every depth.

| Key | What it says |
|---|---|
| `data` | Its own fields and their starting values. `given` marks one that whoever enters it has to give |
| `start`, `states` | The states inside it, and which it is at when entered |
| `on` | The events others may send it. A handler is synchronous and returns what happens next: `{ at, data }` |
| `internal` | The events it sends itself, which nothing else may send it |
| `asks` | The asks it answers. A handler returns the answer, or `answered(answer, next)` to change something as it answers |
| `run`, `failed` | Work it does while it is the case, and where it goes if that work fails |
| `starts` | Other states it runs |
| `follows` | Views of the database it keeps up to date |
| `awaits` | Reads it is waiting on |
| `makes` | Writes it makes when told to |

## Standing things follow the data

`starts`, `follows` and `awaits` are all **standing**: while the data says so, they go on. You never start, follow or
read by hand. A state declares each and says which fields of its data it depends on, and the kernel keeps what is
live matching the data, looking again only when one of those fields changes.

Each entry depends on the data in one of two ways:

- **`from: ['id']`**: there is one, and it reads these fields. It is asked again when one of them changes.
- **`each: 'titles'`**: there is one for each key of this field, or each item of a list. A key that appears starts
  one, and a key that goes stops it.

So changing data is how they start and stop:

| To do this | Change the data like this |
|---|---|
| Open a thread's state | Add its id to `titles` |
| Follow another thread's detail | Set `id` |
| Read the status again | Count `revision` up |

## A write is said once

A write is not standing. Nothing in the data stands for it: it is made once, because a handler said `make`. The
kernel makes it when the step commits, and keeps the record of which are under way. A component reads that record
beside `at` and `data`, as `making`.

| To do this | Say this |
|---|---|
| Stage a file | `make('stage', path)` |
| Push | `make('push')` |
| Stop a push | `drop('push')` |

Keeping the two apart is what Elm does with subscriptions and commands, and TanStack Query with queries and
mutations. It matters for three reasons: the kernel never changes a state's data, one thing owns the record of what
is under way, and restoring a state reads again but does not write again.

## A complete example

A slice of the app's commit surface: its status, the diff of the selected file, staging, and a push. The real one is
1,778 lines, declares 54 asks, and keeps a hand-written list of which are under way. This has no ids, no list, and no
event for how an ask ended.

```ts
type Commit = {
  data: {
    gitStatus: GitStatus | null
    revision: number                                    // counts each change to the repository
    selectedGitFile: { path: string; staged: boolean } | null
    gitDiff: string | null
    pushPhase: string | null
    gitError: string | null
  }
  makes: { stage: 'each'; push: 'one' }                 // staging for each of many paths, one push at a time
}

const commit = state<Commit, CommitEvent>()({
  data: { gitStatus: null, revision: 0, selectedGitFile: null, gitDiff: null, pushPhase: null, gitError: null },

  // Reads. Each is there because the data says so.
  awaits: (asking) => ({
    // Asked as the surface starts, and again whenever the repository changes.
    status: asking('code', 'commit.GET_GIT_STATUS', {
      from: ['revision'],
      args: () => ({}),
      ended: (outcome) => (outcome.ok ? { data: { gitStatus: outcome.value } } : { data: { gitError: outcome.failure.message } }),
    }),

    // The diff of whichever file is selected. Selecting another gives up the read of the first.
    diff: asking('code', 'commit.GET_GIT_DIFF', {
      from: ['selectedGitFile'],
      args: ({ selectedGitFile }) => selectedGitFile,
      ended: (outcome) => (outcome.ok ? { data: { gitDiff: outcome.value.text } } : { data: { gitError: outcome.failure.message } }),
    }),
  }),

  // Writes. Each is made when a handler says so.
  makes: ({ one, each }) => ({
    stage: each('code', 'commit.STAGE_FILES', {
      args: (path) => ({ paths: [path] }),
      ended: (outcome, { key }) => (outcome.ok ? undefined : { data: { gitError: `Could not stage ${key}: ${outcome.failure.message}` } }),
    }),

    push: one('code', 'commit.PUBLISH_BRANCH', {
      args: () => ({}),
      heard: (updates) => ({ data: { pushPhase: updates.at(-1)!.phase } }),
      ended: (outcome) => ({ data: { pushPhase: null, ...(outcome.ok ? {} : { gitError: outcome.failure.message }) } }),
    }),
  }),

  on: {
    'commit.STAGE_FILE':  ({ path }, { make }) => { make('stage', path) },
    'commit.VIEW_DIFF':   ({ path, staged }) => ({ data: { selectedGitFile: { path, staged }, gitDiff: null } }),
    'commit.PUSH_BRANCH': (_, { make }) => { make('push') },          // a second while one is made is the same push
    'commit.STOP_PUSH':   (_, { drop }) => { drop('push'); return { data: { pushPhase: null } } },
    'REPOSITORY_CHANGED': (_, { data }) => ({ data: { revision: data.revision + 1 } }),
  },
})
```

And the component that shows it:

```vue
<script setup lang="ts">
const { state: commit, send } = useState('commit')
</script>

<template>
  <Spinner v-if="commit.making.push" :label="commit.data.pushPhase" />
  <li v-for="file in commit.data.gitStatus?.unstaged" :key="file">
    {{ file }}
    <Spinner v-if="commit.making.stage[file]" />
    <button v-else @click="send({ type: 'commit.STAGE_FILE', path: file })">Stage</button>
  </li>
</template>
```

Whether a write is under way is `making`, which the kernel keeps and the component reads. It imports nothing but the
state.

## The other two standing things, in the same grammar

```ts
// States it runs: a thread for each title, told which it is.
starts: (start) => ({
  thread: start(thread, { each: 'titles', given: (threadId) => ({ threadId }) }),
}),

// Views it follows: the detail of the open thread, and one for each open tab.
follows: (follow) => ({
  detail: follow('threads', 'detail', { from: ['id'], args: ({ id }) => ({ id }), heard: (update) => … }),
  tab:    follow('threads', 'tab',    { each: 'openTabs', args: (threadId) => ({ threadId }), heard: (update, { key }) => … }),
}),
```

## When to use which

| What it is | Use |
|---|---|
| A value fetched for some arguments | `awaits`, with `from` |
| A value fetched for each of many things | `awaits`, with `each` |
| A write to make, several at once | `makes`, with `each`, and `make(name, key)` |
| A write to make, one at a time | `makes`, with `one`, and `make(name)` |
| Something the surface is *in*, where what it accepts changes | A state with `run`, like `searching` |
| A thing with a life of its own, one for each id | `starts`, with `each` |
| Data from the database that keeps changing | `follows` |

## Talking to other states

| Verb | From | To |
|---|---|---|
| `send(event)` | A state | Itself: an event only it sends, or one others may send it |
| `tell(name, event)` | A state | A backend system. Nobody waits |
| `tell({ surface }, event)` | A state in a window | Another surface in that window |
| `ask(name, ask, args)` | A state's `run`, or an ask's handler | A backend system. One answer comes back |
| `progress(update)` | An ask's handler | Whoever asked, and only them |
| `broadcast(name, event)` | The backend | That surface in every window |
| `report(event)` | A state that was started | The state that started it |
| `make(name, key?)`, `drop(name, key?)` | A state | The kernel: have a write it declares made, or given up |

A component reads and sends. It does not ask.

A write is told when losing it does not matter, and asked when it does. There is no third way to make one.

## What holds, always

- **Only a handler changes data.** The kernel never does. What is under way is its own record, beside the data.
- **What a state holds is a value, and it is frozen.** A write to it throws on the line that tried, and most do not
  compile: what is read is typed so that no field can be assigned, at any depth, and a list a
  field holds cannot be changed in place. One that runs is reported with what to write. A component is
  handed these same objects, a field at a time, and runs again at least when a field it read was replaced. To be
  exact inside a field, give each of many a state of its own, or read the part through a `computed`.
- **A change is all of it or none.** What the compiler refuses, the kernel refuses too, whole, where it is tried.
- **One message and everything it causes is one step.** Nothing leaves until the step commits, so nobody sees a
  half-made change, and what runs is matched to the data once, as the step ends.
- **A step is one database transaction.** A handler's rows, its data and what it sends change together or not at
  all, and a write outside a step is refused. Nothing outside the database is part of it: git, files and models are
  done first, and the row that records one is written in the step its result arrives in.
- **Work has one owner and stops when its owner does.** A state's `run` is the state's. An ask is the asker's. What a
  state starts, follows, awaits or makes is that state's.
- **An answer and the change it makes are one thing.** Whoever asked is never told of a change that was not made.
- **An ask whose asker has gone throws `Left` where it is awaited**, so `finally` runs and what was held is let go.
- **Nothing depends on itself in a circle.** What a view delivers, or how a read ended, may not change a field it is
  itself asked from.
- **Every ordering is checked, not the one that happened.** A schedule stands in for the event loop and runs a
  scenario under every ordering its messages allow.
