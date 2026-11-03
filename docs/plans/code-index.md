# Code index

Status: stage 1 built; stages 2 to 6 planned, revised 2026-11-03. A graph of a project's code — its files, the definitions
in them, and the calls, references, imports and inheritance between them — kept current as the code changes, so apack can
answer what a change reaches, where a symbol is used and what matters around a file, and say how far each answer can be
trusted. It is a feature of the default-setup pack, in the code feature, with no host service.

## The shape

1. **It lives in the app database.** A pack can't open a database of its own (`APP_ONLY_EXPORTS`). What that costs is under
   Where it lives, and what it buys is that every answer is an ordinary view.
2. **Parsing is cheap, so nothing caches it.** A file is parsed again whenever something needs it. No row holds a position,
   no parse is stored, and no worker exists for the syntax layer.
3. **The graph holds pairs; the sites stay in the source.** One edge per caller and callee, whose weight `rank` reads. A
   line moving writes nothing.
4. **A symbol's identity is its name, not its row.** Ids are derived, a file is diffed rather than replaced, and a save
   leaves other files' edges into it alone.
5. **Every answer says what it couldn't see:** files pending, sites unresolved, event boundaries crossed. "No callers" is
   only ever said with its coverage beside it.
6. **The syntax graph is evaluated before it is built.** Stage 2 starts by measuring the syntax layer against the compiler
   on real code, for precision and recall, and those readings decide what it may claim.

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

**What parsing costs.** Read 2026-11-03 over 2,589 files (15.9 MB), one thread, plain Node, machine not quiet (load 3 to 8),
parse only with no walk over the result:

| Parser | Whole repo, cold / warm | 99th percentile file | Worst file | To load |
|---|---|---|---|---|
| `@babel/parser`, with `@vue/compiler-dom` for `.vue` | 739 / 538 ms | 2 ms | 16 ms | 7 ms, 515 KB |
| `typescript` | 1080 / 612 ms | 3 ms | 11 ms | 96 ms, 8.7 MB |

That is what removes a worker and a parse cache, and why it is Babel in the bundle: a pack's backend is one file loaded at
every start, and tree-sitter needs a WASM file or a native binding a pack build doesn't ship.

## Where it lives

- **`packages/default-setup/src/features/code/be/code-index/`**: entities and repositories declared under `features.code` in
  `apack.json`, the views beside them, and a child system of the code system (`be/features/code-index.ts`). No host, SDK or
  CLI change.
- **On the API's event loop, in slices.** A sync does one file at a time and yields every 8 ms, and a file over 512 KB is
  counted and left out, so no one step can hold the loop past its budget. Git runs in its own processes.
- **What it costs against a database of its own:**
  - *Backups carry code detail.* `databaseBackupStore` copies the whole database, so symbol names, signatures and file paths
    are in every backup. Source text and doc comments are not.
  - *It shares a writer.* A first index or a large branch switch writes between the user's own writes, a file at a time.
  - *Turning it off deletes rows*, in slices, rather than a file. A restored backup brings back an old index, which the next
    sync corrects.
  - *The database console lists its types.*
- **The fallback.** If the budgets below can't be met, the host gains a generic way for a pack to declare a rebuildable
  database, outside backups, and only the storage moves. Nothing else here depends on where the rows are.

## Data

| Entity | Fields |
|---|---|
| `CodeProject` | `root`, `enabled`, `extractorStamp`, `progress` (state, files, symbols, pending, skipped by reason) |
| `CodeFile` | `project`, `path`, `oid`, `language`, `test`, `skipped` |
| `CodeSymbol` | `project`, `file`, `kind`, `name`, `qualifiedName`, `exported`, `signature`, `signatureHash`, `bodyHash` |

- **Ids are derived:** a hash of the root; of the project and path; of the project, path, the definition's name in its file
  and its ordinal among those sharing it. A symbol that still exists keeps its row, which is what will keep other files'
  edges into it, since destroying an entity takes its incoming edges (`remove_all_of`).
- **`signatureHash` and `bodyHash`** are taken over the syntax tree without positions or comments, so a reformat moves
  neither. A class or object's own hashes leave out the members that are definitions themselves.
- **No row holds a position.** A line moving must write nothing, so a position is read by parsing the file when it is asked
  for.
- **`extractorStamp`** is a hash of what the extractor answers over a fixture of every form it reads, taken again at each
  sync. When it moves, every file is extracted again. Nothing has to remember to raise it.
- **Indexes:** values on `CodeFile` `project`, and on `CodeSymbol` `project` and `file`. Text (`search`) on `CodeSymbol` over
  `name`.

From stage 2:

| Relation kind | From → to | Rules | Info |
|---|---|---|---|
| `code_defines` | `CodeFile` → `CodeSymbol` | | |
| `code_member_of` | method → class | | |
| `code_calls` | `CodeSymbol` → `CodeSymbol` | `weighted` | `{ layer, sites }` |
| `code_references` | `CodeSymbol` → `CodeSymbol` | `weighted` | `{ layer, sites }` |
| `code_imports` | `CodeFile` → `CodeFile` | | `{ layer }` |
| `code_inherits` | `CodeSymbol` → `CodeSymbol` | | `{ layer, how }` |

- **The prefix is needed.** `references` is already the notes' kind, and declaring it weighted would change how notes rank.
- **One edge per pair**, which is elmdb's default identity, with no `key`. `link` merges, so a pair's edge is written from
  its sites and a repeat costs nothing. Its weight is the sum of its sites' confidence, and its `layer` the strongest.
- **No per-site row.** Showing an edge's evidence parses the caller's file and resolves its sites again.
- **`layer`** is `compiler`, `extracted` (the far end in the same file) or `inferred` (resolved across files).
- **`CodeFile` gains `names`** (every name its sites write) and **`dirty`**, both value-indexed. `names` answers "whose
  resolution could this change", and `dirty`, written in the unit that makes a file stale, is the work queue, so a crash
  loses nothing and an answer can count what's pending.

## The syntax layer

**Which files.** Git's view by blob id: `git ls-files --stage` for tracked and unchanged, skipping symlinks and submodules
by their mode; `git hash-object --stdin-paths` for modified and untracked-but-not-ignored, so the index holds what is on
disk. Skipped and counted by reason: over 512 KB, not UTF-8, not parsable. A directory that isn't a git repository isn't
indexed, and the surface says so. Off until a project is turned on.

**One graph per checkout turned on.** A second worktree is its own project, off until turned on, so what the index holds is
what the user asked for. Only the code surface's current directory is kept current; another catches up when it is opened.

**Parsing.** `@babel/parser` with error recovery, for TypeScript, JavaScript and JSX. More languages (stage 6) bring back the
question of how a pack ships a grammar.

**Vue.** `@vue/compiler-dom` in SFC mode finds the blocks. `<script>` and `<script setup>` go through Babel with positions
kept, and the component is a definition whose body is its template. From stage 2, a template tag is a use of the component
it names, and a handler or binding expression is a site in the component. Without this every handler and component reads as
unused.

**Resolution (stage 2).** First that answers wins, with no fuzzy matching:

| # | Strategy | Applies to |
|---|---|---|
| 1 | Import map: the prefix through the file's imports, then an exact `qualifiedName` | any site whose head is imported |
| 2 | Same module | a bare name, `this.x` |
| 3 | Unique name in the project | a bare name only |
| 4 | Nearest by module path, ties broken by path order | a bare name only |

A member call on a receiver none of these reach makes no edge, and counts as unresolved on every definition it names.
Whether 3 and 4 stay is decided by their evaluated precision. Each strategy's confidence is a table in the source, recorded
from the evaluation with its date.

**Keeping current.**

1. The code system's git watcher reports a change in the working tree or in git's `HEAD` and index, and a sync takes a new
   view. That watcher ignores paths such as `build/`, `dist/` and `tmp/`, anywhere in the absolute path, so a save under one is
   picked up by the next change it does see. A request while one runs cancels it, and what it finished is already stored.
2. A file whose blob id moved is read, extracted and diffed against its rows, and its blob id and symbols are written in one
   unit. A file gone from the view loses its rows.
3. From stage 2, the same unit resolves the file's sites, rewrites its edges and sets `dirty` on its dependents: files whose
   `names` hold a name added or removed, and files importing this one. Dirty files drain a slice at a time.

Adding a second `parse` anywhere changes what every file naming `parse` resolves to, which is why step 3 reads `names`.

## The semantic layer (stage 3)

- **The compiler itself for TypeScript and Vue:** TypeScript's API over `@vue/language-core`'s virtual files, under
  Electron's Node at low priority with its heap capped, loading no project plugins. `scip-typescript`'s README covers
  TypeScript, JavaScript and Svelte, doesn't mention Vue or npm workspaces, and suggests a 16 GB heap. The evaluation runs
  both on this repository and this choice stands or falls on those readings.
- **This can't be purely in the pack as things are.** It needs a separate process and `typescript` and Volar on disk, and a
  pack build emits one backend entry and ships only `dist/{runtime,build,types}`. The choice to take at this stage is a small
  generic pack-build option for a second entry and its files, or a host feature.
- **Mapping:** an occurrence is matched to the site at its range and to the `CodeSymbol` holding its declaration. The pair's
  edge takes `layer: 'compiler'`. Where the compiler names another target, the syntax layer's pair loses that site, and its
  edge goes with its last one.
- **When it runs:** when asked, and when the machine is idle on power, one run per project, cancelled by a newer one. A
  whole-program run is a type-check, about 70 s for one of this repository's legs (2026-11-01, under load), so it doesn't
  follow every commit. A failed run leaves the syntax layer in charge and says why.
- **Staleness is per file:** a run records each file's blob. A file whose blob has moved falls back to its syntax
  resolution. A compiler edge to a symbol that has been removed goes with the symbol; one to a symbol whose signature changed
  is kept, and counted as unverified until the next run.
- **Other languages** come through a SCIP importer (stage 6), since SCIP is the one format they share. Indexers that drive
  a project's build run its code, so each is enabled per project, with that stated.

## Answers

A read of the index is a view of the code feature, read with `useView`, so a window follows it live. What reads files or git
is fetched and replied (`packages/default-setup/CLAUDE.md`, What a system sends a surface). From stage 2 each carries its
coverage:

```ts
{ results, coverage: { pendingFiles, compilerShare, unresolvedSites, eventBoundaries } }
```

Nothing is added to a prompt unasked.

- **Status:** whether a checkout is indexed and how far along (`indexStatus`, a view).
- **Find a symbol** by name (`symbols`, a view), tests last; opening one parses its file for its position
  (`codeIndex.LOCATE`).
- **Semantic diff:** what a range or staged change did per definition (added, removed, signature, body), from the two versions
  alone (`codeIndex.SEMANTIC_DIFF`). It reads no row, so it works with the index off. A reformat is no change.
- **Callers, callees and uses**, each with its layer and evidence.
- **Code map:** the definitions most relevant to the open file, by `rank` seeded from its symbols, over `code_calls`,
  `code_references` and `code_inherits`, leaving out test files by default.
- **Attach to a message:** a symbol with its callers and callees, or a code map, within a size the user sees. It adds to an
  agent browsing files rather than replacing it: Codebase-Memory's paper measures an agent on a graph alone at 0.83 against
  0.92 browsing, for a tenth of the tokens.
- **Impact:** from a symbol or a change, what reaches it, following `code_calls`, `code_references` and `code_inherits` `in`,
  tests named apart. A signature change follows every caller; a body change, only the tests behind it.
- **Event edges** (`code_emits`, `code_handles`): `sendToSystem` and `broadcastToSurface` with a literal `type`, and a
  machine's `on` keys and string `actions`, so a walk crosses the app's real boundaries and says where one was dynamic.
- **Modules:** `communities` over `code_calls`.
- **Unused definitions:** only where coverage is complete: no pending files, the compiler layer current, no unresolved site
  naming it, not exported, not an event handler.

`rank` is computed per request on the event loop, since a seeded rank has nothing to store ahead of its seeds (elmdb
`docs/roadmap/rank-index.md`). It read 11.3 ms over 10,000 documents and 50,000 edges (2026-10-31), so at this graph's size it
should fit; stage 2 measures it. No rank index is declared here, since a save changes edges and each change would cost a
drain.

## Budgets

Accepted on readings of this repository with `npm run measure` and `npm run measure:loop`, an isolated profile, date and
conditions recorded. Acceptance criteria, not test assertions. A reading that misses is a finding to resolve; a budget
changed to fit says why.

| Stage | What | Budget |
|---|---|---|
| 1 | first symbol index | 30 s |
| 1 | the API's event loop during it | never held over 50 ms |
| 1 | one saved file | 100 ms at the 95th percentile |
| 1 | a branch switch changing 500 files | 2 s |
| 1 | a semantic diff of a 100-file range | 500 ms |
| 1 | the app database and a backup, grown by this repository | 50 MB |
| 2 | one saved file, with its dependents | 200 ms at the 95th percentile |
| 2 | a code map; callers of a symbol | 50 ms; 20 ms |
| 2 | the app database and a backup, grown by this repository | 200 MB |
| 3 | a compiler run | its heap under its cap; the API's event loop as above |
| 4 | impact from a staged change | 200 ms |

**Stage 1's readings**, 2026-11-03, the built app on an isolated profile, MacBookPro18,1, load average 4 to 6 (not quiet, so these
can only read high), over a clone of this repository (2,591 files, 16,508 symbols):

| What | Read | Budget |
|---|---|---|
| first symbol index | 4.4 s | 30 s |
| longest delay to the API's event loop in any sync (`monitorEventLoopDelay`, logged with each sync) | 28 ms | 50 ms |
| one saved file, git's view included, 10 saves | 75 to 88 ms | 100 ms |
| a branch switch changing 500 files, 4 switches | 613 to 767 ms | 2 s |
| a semantic diff of a staged 100-file change, click to first row | 240 ms | 500 ms |
| a backup, with the index against the same data without it | 43.8 MB against 1.3 MB | 50 MB |

A debounce in the watcher (500 ms) comes before a save's sync. Searching signatures as well read 9 MB more, which went over
budget, and is why `search` covers names alone. `measure:loop`'s sampler doesn't reach the API process, since Electron starts it,
which is why the loop figure is read from inside the sync.

## Verification

- **Extraction:** fixtures per file type, Vue included; what moves each hash and what doesn't.
- **Resolution:** a fixture per strategy, including two `map`s told apart by an import, and `array.map()` making no edge.
- **Evaluation:** the stage 2 harness stays, as a command reporting precision and recall per strategy against the compiler,
  run when the resolver changes.
- **Identity:** a save leaves incoming edges and their ids in place; a reformat writes no row.
- **Incremental equals full:** a seeded random history of edits, adds, removes, renames and branch switches, compared with a
  fresh index. From stage 2 it includes a second definition of a name others resolved uniquely.
- **Interruption:** a sync cut short finishes on the next run, and the result equals a fresh index.
- **Coverage:** an answer with files pending, unresolved sites or a dynamic send says so; "unused" refuses without coverage.
- **Off:** turning a project off removes its rows and no other project's; a project never turned on is never read.
- Mutation-checked on a copy, per the repository's rules.

## Stages and PRs

1. **Symbols and semantic diff** (built): git's view, identity and diffing, sync, Vue extraction, status and the toggle; find
   a symbol; semantic diff in the commit panel.
2. **The syntax graph:** first the evaluation, a command over this repository and two others for precision and recall per
   strategy and call form against the compiler, whose findings edit this plan. Then resolution, dependents, `dirty`, coverage;
   callers, callees and uses; code map; attach to a message.
3. **The semantic layer** for TypeScript and Vue, with the packaging choice above.
4. **Impact,** in the commit panel and pull request review, once edges are worth trusting for it.
5. **Event edges, modules, unused definitions,** and the graph view's overlays, which need the graph view built.
6. **More languages:** a grammar and a query file each, and the SCIP importer where an indexer exists.

One PR each.

## Deferred

Named so they aren't mistaken for gaps:

- **Paths a project excludes**, for committed generated code. A setting, once a project is shown to need it.
- **Signatures and doc comments in search.** A signature index read 9 MB over this repository, and doc comments would add more
  of the user's text to every backup. A file search finds both today.
- **A bound on how many checkouts stay indexed.** Each is turned on by hand. It matters if worktrees that are gone are shown
  to leave much behind.
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
