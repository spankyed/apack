# Code index

Status: planned, revised 2026-11-03. Nothing is built. A graph of a project's code — its files, the definitions in them,
and the calls, references, imports and inheritance between them — kept current as the code changes, so apack can answer
what a change reaches, where a symbol is used and what matters around a file, and say how far each answer can be trusted.

## The shape

1. **It is derived, so it has a database of its own.** Everything in it can be rebuilt from git and the working tree. It
   is deleted without loss, is in no backup, and doesn't share a writer with the user's data.
2. **The graph holds pairs; the sites stay with the file.** One edge per caller and callee, whose weight `rank` reads. A
   line moving writes nothing.
3. **A symbol's identity is its name, not its row.** Ids are derived, a file is diffed rather than replaced, and a save
   leaves other files' edges into it alone.
4. **Parsing is content-addressed by git,** and the extractor's version is derived from what it runs.
5. **Every answer says what it couldn't see:** files pending, sites unresolved, event boundaries crossed. "No callers" is
   only ever said with its coverage beside it.
6. **Evaluated before built.** Stage 0 measures the syntax layer against the compiler on real code, for precision and
   recall, and those readings decide what the syntax layer may claim.

## What this repository looks like

Read 2026-11-03, TypeScript's parser over `git ls-files` for `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` and `.vue` script blocks.
Definitions are counted by syntax, so these size the design and aren't the index's own numbers.

| | |
|---|---|
| Files | 2,583: 2,222 `.ts`, 331 `.vue` (2.1 MB of 15.9 MB); 888 are tests |
| Definitions | about 15,400, under 9,432 distinct names |
| Call sites | 158,936: 44% `f()`, 33% `x.f()`, 22% `a.b.f()` or longer |
| Caller → callee-name pairs | at most 65,583 |
| What a site's name matches | exactly one definition 22%, several 31%, none in the project 47% |
| Vue templates | 2,313 event handlers, 1,810 component uses, none visible to a script parse |
| Dynamic dispatch | 1,214 machine references by string, 585 event sends |

What follows from it:

- **Site-level edges would be the largest thing in the database.** A relation is four keys (its row, `d/o`, `d/n`, `d/b`),
  so about 636,000 keys for calls alone, and an `at` in the edge rewrites every edge below a changed line.
- **Name matching can't be trusted on a member call.** Over half the sites have a receiver the syntax can't type. "One
  definition with that name" would link every `array.map()` to a project's own `map`.
- **Control flow here crosses events.** A callers walk stops at each `sendToSystem`, and neither a parser nor a compiler
  sees through it, so an answer has to say so.
- **Tests are a third of the files.** Unfiltered, they dominate any ranking.

## Where it lives

- **`@apackdev/host/code-index`**, a host service beside the run history, with its contract at
  `@apackdev/sdk/services/code-index.ts` and consumers in default-setup's code feature (`services.codeIndex`). A pack can't
  open a database (`APP_ONLY_EXPORTS`), and this is infrastructure rather than a feature.
- **A database of its own**, as `openRunHistory` is: `code-index` in the data dir, with an engine of its own and a schema
  built with `toElmdbSchema`. Outside `databaseBackupStore`, so a backup never carries the user's source; `appData.reset()`
  deletes it.
- **One worker owns it.** A `worker_thread` parses, resolves, writes and answers, so the API's event loop only passes
  messages. elmdb refuses a second open of a path within a process, so the API never opens it.
- **The surface hears results and news.** A view reads the app's engine and nothing else, so an answer is fetched and
  replied, and `CODE_INDEX_CHANGED { project }` is news for a window to fetch again
  (`packages/default-setup/CLAUDE.md`, What a system sends a surface).

## Data

| Entity | Fields |
|---|---|
| `CodeBlob` | `oid`, `extractor`, `parsed`: definitions (local name, kind, range, signature and body hashes, doc), imports, and sites (kind, name as written, range), in file order |
| `CodeFile` | `project`, `path`, `oid`, `language`, `test`, `names` (every name its sites write), `resolved` (per site: the target symbol, layer, strategy), `dirty` |
| `CodeSymbol` | `project`, `file`, `local` (its index in the blob's definitions), `kind`, `name`, `qualifiedName`, `exported`, `signature`, `doc`, `signatureHash`, `bodyHash` |

- **A symbol's id** is a hash of `project`, `qualifiedName` and, for a repeated name, its ordinal among them. A file is
  diffed against its symbols: a definition whose hashes didn't move writes nothing, and its range is read through `local`
  from the blob. Destroying a symbol takes its incoming edges with it (`remove_all_of`), which is why a save never replaces
  one that still exists.
- **`extractor`** is a hash, taken at build, of the grammars, the query files and the extraction and hashing source. A
  blob parsed by another is parsed again. Nothing has to remember to raise it.
- **`names`** has a value index, as a note's `linkTargets` does. It answers "whose resolution could this change", which
  incremental updates depend on.
- **`dirty`** is written in the unit that makes a file stale, and has a value index. It is the work queue, so a crash loses
  nothing and an answer can count what's pending.
- **Blobs are kept to a bound,** least recently used first, among those no file points at.

| Relation kind | From → to | Rules | Info |
|---|---|---|---|
| `defines` | `CodeFile` → `CodeSymbol` | | |
| `member_of` | method → class | | |
| `calls` | `CodeSymbol` → `CodeSymbol` | `weighted` | `{ layer, sites }` |
| `references` | `CodeSymbol` → `CodeSymbol` | `weighted` | `{ layer, sites }` |
| `imports` | `CodeFile` → `CodeFile` | | `{ layer }` |
| `inherits` | `CodeSymbol` → `CodeSymbol` | | `{ layer, how }` |

- **One edge per pair**, which is elmdb's default identity, with no `key`. `link` merges, so a pair's edge is written from
  its sites and a repeat costs nothing. Its weight is the sum of its sites' confidence, and its `layer` the strongest.
- **The evidence** for an edge is read from `CodeFile.resolved` joined to the blob's sites, so showing it costs a read and
  storing it costs no edge.
- **`layer`** is `compiler`, `extracted` (the far end in the same file) or `inferred` (resolved across files).
- **Indexes:** values on `CodeFile` `[project, path]` (unique), `oid`, `names`, `dirty`; `CodeBlob` `oid` (unique);
  `CodeSymbol` `[project, qualifiedName]`, `[project, name]`. Text (`search`) on `CodeSymbol` over `name`, `signature`, `doc`.

## The syntax layer

**Which files.** Git's view by blob id: `git ls-files --stage` for tracked and unchanged, skipping symlinks and submodules
by their mode; `git hash-object --stdin-paths` for modified and untracked-but-not-ignored, so the index holds what is on
disk. Skipped and counted by reason: over 1 MB, not UTF-8, no grammar, and paths the project excludes (a setting, for
committed generated code). A directory that isn't a git repository isn't indexed, and the surface says so. Off until a
project is turned on.

**One graph per checkout turned on.** Blobs are shared, so a second worktree parses nothing, but its symbols and edges are
its own. Graphs beyond a bound are evicted, least recently opened first, keeping their blobs, so reopening one costs
materializing and no parsing.

**Parsing.** tree-sitter, one query file per language and one capture convention for all, so the extractor knows no
language. `web-tree-sitter` or the native binding is decided by a stage 0 reading.

**Vue.** `<script>` and `<script setup>` through the TypeScript grammar with ranges mapped back. `<template>` through
`@vue/compiler-dom`: a tag is a use of the component it names, and a handler or binding expression is a site in the
component's module symbol. Without this every handler and component reads as unused.

**Resolution.** First that answers wins, with no fuzzy matching:

| # | Strategy | Applies to |
|---|---|---|
| 1 | Import map: the prefix through the file's imports, then an exact `qualifiedName` | any site whose head is imported |
| 2 | Same module | a bare name, `this.x` |
| 3 | Unique name in the project | a bare name only |
| 4 | Nearest by module path, ties broken by path order | a bare name only |

A member call on a receiver none of these reach makes no edge, and counts as unresolved on every definition it names.
Whether 3 and 4 stay is decided by their stage 0 precision. Each strategy's confidence is a table in the source, recorded
from the evaluation with its date.

**Keeping current.**

1. A change arrives as paths whose blob ids moved (chokidar per project, git's `HEAD` and index for switches and stages,
   batched), and at start from reconciling against git's view.
2. Unparsed blobs are parsed; the rest are read.
3. In one unit: the file's symbols diffed, its sites resolved and its edges rewritten; and `dirty` set on the dependents,
   meaning files whose `names` hold a name added or removed, and files importing this one.
4. Dirty files drain in chunks from their blobs, without parsing.

Adding a second `parse` anywhere changes what every file naming `parse` resolves to, which is why step 3 reads `names`.

## The semantic layer

- **The compiler itself for TypeScript and Vue:** TypeScript's API over `@vue/language-core`'s virtual files, under
  Electron's Node at low priority with its heap capped, loading no project plugins. `scip-typescript`'s README covers
  TypeScript, JavaScript and Svelte, doesn't mention Vue or npm workspaces, and suggests a 16 GB heap. Stage 0 runs both on
  this repository and this choice stands or falls on those readings.
- **Mapping:** an occurrence is matched to the site at its range and to the `CodeSymbol` holding its declaration. A site's
  `resolved` entry takes `layer: 'compiler'` and confidence 1, and the pair's edge is rewritten. Where the compiler names
  another target, the syntax layer's pair loses that site, and its edge goes with its last one.
- **When it runs:** when asked, and when the machine is idle on power, one run per project, cancelled by a newer one. A
  whole-program run is a type-check, about 70 s for one of this repository's legs (2026-11-01, under load), so it doesn't
  follow every commit. A failed run leaves the syntax layer in charge and says why.
- **Staleness is per file:** a run records each file's blob. A file whose blob has moved falls back to its syntax
  resolution. A compiler entry pointing at a symbol that has been removed goes with the symbol; one pointing at a symbol
  whose signature changed is kept, and counted as unverified until the next run.
- **Other languages** come through a SCIP importer (stage 6), since SCIP is the one format they share. Indexers that drive
  a project's build run its code, so each is enabled per project, with that stated.

## Answers

Each is a `services.codeIndex` method, reaches the surface as a fetched result, and carries its coverage:

```ts
{ results, coverage: { pendingFiles, compilerShare, unresolvedSites, eventBoundaries } }
```

Nothing is added to a prompt unasked.

- **Find a symbol** by name, signature or doc.
- **Semantic diff:** what a branch range or staged change did per definition (added, removed, signature, body), from the
  base and head blobs alone, with no graph of the base. A reformat is no change.
- **Callers, callees and uses**, each with its layer and evidence.
- **Code map:** the definitions most relevant to the open file, by `rank` seeded from its symbols, over `calls`,
  `references` and `inherits`, leaving out test files by default.
- **Attach to a message:** a symbol with its callers and callees, or a code map, within a size the user sees. It adds to an
  agent browsing files rather than replacing it: Codebase-Memory's paper measures an agent on a graph alone at 0.83 against
  0.92 browsing, for a tenth of the tokens.
- **Impact:** from a symbol or a change, what reaches it, following `calls`, `references` and `inherits` `in`, tests named
  apart. A signature change follows every caller; a body change, only the tests behind it.
- **Event edges** (`emits`, `handles`): `sendToSystem` and `broadcastToSurface` with a literal `type`, and a machine's
  `on` keys and string `actions`, so a walk crosses the app's real boundaries and says where one was dynamic.
- **Modules:** `communities` over `calls`.
- **Unused definitions:** only where coverage is complete: no pending files, the compiler layer current, no unresolved site
  naming it, not exported, not an event handler.

`rank` is computed per request, since a seeded rank has nothing to store ahead of its seeds (elmdb `docs/roadmap/rank-index.md`).
At this graph's size it should meet its budget: `rank` read 11.3 ms over 10,000 documents and 50,000 edges (2026-10-31). No
rank index is declared here, since a save changes edges and each change would cost a drain.

## Budgets

Accepted on readings of this repository with `npm run measure` and `npm run measure:loop`, quiet machine, date and
conditions recorded. Acceptance criteria, not test assertions. A reading that misses is a finding to resolve; a budget
changed to fit says why.

| Stage | What | Budget |
|---|---|---|
| 1 | first symbol index | 30 s |
| 1 | the API's event loop during it | never held over 50 ms |
| 1 | one saved file | 100 ms at the 95th percentile |
| 1 | a branch switch changing 500 files, blobs parsed | 2 s |
| 1 | a semantic diff of a 100-file range | 500 ms |
| 2 | one saved file, with its dependents | 200 ms at the 95th percentile |
| 2 | a code map; callers of a symbol | 50 ms; 20 ms |
| 2 | the database on disk; the worker's memory | 500 MB; 1 GB |
| 3 | a compiler run | its heap under its cap; the API's event loop as above |
| 4 | impact from a staged change | 200 ms |

## Verification

- **Extraction:** per-language fixtures, Vue templates included, against goldens.
- **Resolution:** a fixture per strategy, including two `map`s told apart by an import, and `array.map()` making no edge.
- **Evaluation:** the stage 0 harness stays, as a command reporting precision and recall per strategy against the compiler,
  run when the resolver changes.
- **Identity:** a save leaves incoming edges and their ids in place; a reformat writes no row; a renamed parameter moves
  only the signature hash; a changed statement only the body hash.
- **Content addressing:** switching branches and back parses no blob twice; a second worktree parses nothing; an extractor
  source changed reparses without anyone raising a number.
- **Incremental equals full:** a property test applies random edits, adds, removes, renames and branch switches through the
  watcher path, including a second definition of a name others resolved uniquely, and compares the graph with a fresh index.
- **Crash:** a worker killed mid-drain finishes from `dirty`, and the graph equals a fresh index.
- **Coverage:** an answer with files pending, unresolved sites or a dynamic send says so; "unused" refuses without coverage.
- **Isolation:** a backup holds no code index; a reset removes it; a project turned off is never read.
- Mutation-checked on a copy, per the repository's rules.

## Stages and PRs

0. **Evaluation, no app code.** A script over this repository and two others: tree-sitter extraction with resolution against
   the compiler, for precision and recall per strategy and call form; TypeScript with Volar against `scip-typescript`, for
   coverage, time and heap; WebAssembly against native parsing; the pair and key counts. Its findings edit this plan.
1. **Symbols and semantic diff:** the worker, its database, git's view, content addressing, identity and diffing, the
   watcher, Vue extraction, status and the setting; find a symbol; semantic diff in the commit panel. The first PR a user
   can use, with no resolution in it.
2. **The syntax graph:** resolution, dependents, `dirty`, incremental-equals-full, coverage; callers, callees and uses; code
   map; attach to a message.
3. **The semantic layer** for TypeScript and Vue.
4. **Impact,** in the commit panel and pull request review, once edges are worth trusting for it.
5. **Event edges, modules, unused definitions,** and the graph view's overlays.
6. **More languages:** a grammar and a query file each, and the SCIP importer where an indexer exists.

One PR each.

## Deferred

Named so they aren't mistaken for gaps:

- **Per-project calibration stored and fed live into weights.** Confidence starts as the evaluated table. Storing it per
  project is worth doing when a project's numbers are shown to differ from the table's by enough to change an answer.
- **Fuzzy or embedding-based resolution.** A guess by similarity is an edge nobody can check.
- **A rank index over code,** for the reason under Answers.

## Prior art

Read 2026-10-31.

- **Codebase-Memory** ([repository](https://github.com/DeusData/codebase-memory-mcp), [paper](https://arxiv.org/html/2603.27277v1)):
  a tree-sitter graph, a resolution cascade with confidences set by hand, re-indexing by content hash.
- **glyphtrail** ([repository](https://github.com/glyphtrail/glyphtrail)): edges tagged extracted or inferred; one capture
  convention for every language; impact seeded from a git change set.
- **codegraph-rs** ([repository](https://github.com/Cleboost/codegraph-rs)): search over names, signatures and docs; a
  symbol, its callers and callees as one block.
- **CodeGraphContext** ([repository](https://github.com/CodeGraphContext/CodeGraphContext)): SCIP where tree-sitter is
  weakest, falling back where a project lacks what it needs.
- **SCIP** ([repository](https://github.com/sourcegraph/scip)): one format for compiler-accurate occurrences.
- **Aider's repo map:** files ranked by PageRank over tree-sitter tags, rebuilt per request, linked by name alone.
