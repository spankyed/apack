# The Contract-Leaf Rule: What It Guards, And The Gap In It

Surveyed 2026-09-27 at `565319d91` on `AS/alias-simplification`. `findContractLeafImports`
(`scripts/check-import-specifiers.ts:706-787`) reports nothing over this repo and has no live subject outside its
spec's fixtures. Two separate investigations concluded it should be deleted. **Both were wrong**, and this doc
exists mostly so the third does not repeat them.

**Done, 2026-09-27.** The gap below is closed (`27a532ed5`: the walk resolves a pack's own `#` subpaths through
`mappedPathFor`), the rule reads the shared AST reader rather than a regex, and the division of labour with codegen's
own refusal is recorded on the rule and measured by `apack-sdk/tests/build/declared-type-of.spec.ts`. What is worth
keeping here is the background: the two refuted arguments for deleting the rule, and the position table below.

---

## What the rule is for

From the origin commit, `3d79fed34` (2026-09-23, *"a surface declares one contract — its state and its inbox"*):

> Codegen reads it with `declaredTypeOf` over `checker.getDeclaredTypeOfSymbol` rather than resolving a value,
> which is what lets it live outside `fe/surface.ts`: reading it there pulls in the machine, whose imports cycle
> back through `#generated/events`.

Two properties, not one:

1. **The cycle.** `#generated/events` is generated *from* the contracts, and both actors import it. Reading a
   contract anywhere its actor is reachable closes the loop.
2. **The cost.** `generate-entries.ts:433`: *"putting the machines in the program would parse and bind every one
   of them — and their whole closure, XState and Vue included — for nothing."* Nothing else measures this.

**Of those two, the cost is the one with evidence, and the cycle is not what anyone thought.** See *"What the
cycle actually does"* below: three separate statements of this rule's harm have now been wrong, and the measured
one is the published facade.

Three places assert the invariant to readers and pack authors: `packages/apack-sdk/CLAUDE.md:61` (which names
this rule as the guard), and `manifest-schema.ts:130` and `:138` (the `.describe()` strings a pack author sees).
`docs/goals/README.md:218-230` is the repo's own policy that an invariant with a criterion has a guard.

## The five claims, and what else covers each

| # | Line | Forbids | Covered elsewhere? |
|---|---|---|---|
| 1 | `:764` (`viaLeaf`) | the leaf importing any `#generated/*` but `types` and `ears` | **nothing**, in a warm tree |
| 2 | `:764` (closure) | any module the leaf reaches importing one of the five generated modules a contract is behind (`GENERATED_BEHIND_A_CONTRACT`, derived by `internal-repo-checks/tests/generated-behind-contract.spec.ts`) | the reader, **only where the collapse lands in a position it reads** — see below |
| 3 | `:771` | the leaf importing *any* other feature, `be/` included | **nothing** |
| 4 | `:775` | anything in the closure reaching a declared `surface.entry`/`system.entry` | **nothing** |
| 5 | `:780` | the leaf importing a file named `state`/`system` | **nothing** outside the rule |

Claim 3 is intended, not an artefact: the origin commit records hitting it for real — *"seven inboxes were
`Extract<>` over their machine's union and flows' reached another feature's be/. All are respelled
structurally"* — and chose to eliminate the reach rather than allow it.

## Why deleting it is wrong

**The argument was: codegen now refuses the failure itself,** at `module-exports.ts:158` — *"a type it names
didn't resolve … Read as it stands, it would contribute no events at all"*. So the shape rule is a proxy whose
authority has arrived, like `packages:ensure`'s second cache or the electron-builder string-offset check, both
retired this week.

**It is false, for three reasons, each measured:**

- `checkResolved` (`module-exports.ts:153-159`) tests `type.flags & (Any | Unknown)` on the **whole** type. A
  contract with one collapsed member is an anonymous object type, not `any`, and passes. Three narrower guards
  exist (`:184` `outgoing`, `:196` `inbox`, `:213` each event member) — a collapsed `context`/`state` is caught
  by none.
- It only fires in a **cold tree**. With `src/__generated__/` present from an earlier run — every tree
  `apack build` sees after the first — the imports resolve and nothing throws.
- A **value** import of `#generated/events` never affects the declared type, so it never collapses one. That is
  the rule's own fixture shape (`import { untypedBroadcastToSurface } from '#generated/events'`).

**And that is why the mutations looked harmless.** On 2026-09-26 two mutations of
`tests/fixtures/external-pack/src/features/memos/be/contract.ts` — a value import of `#generated/events`, then a
hard value cycle importing `memosSpec` back from `./system.ts` — each built from a cold tree with exit 0 and
byte-identical `src/__generated__/events.ts` and `dist/types/pack-types.d.ts`. That was read as *"the authority
catches the harmful case"*. It actually meant *"a value import is harmless in that state"*. Different claims, and
the deletion argument rested on conflating them.

**The second wrong turn** was reading claim 3 as an artefact because `CLAUDE.md:442` documents the cross-feature
boundary as another feature's *frontend* only, and 0 of 26 contracts in the tree reach another feature. The origin
commit settles it the other way, above.

## The live defect this turned up

**Claim 3 barely works.** `resolveFrom` (`:738-742`) resolves `@/…` and `./ ../` and returns `undefined` for
anything else, which is silently skipped. Measured in `packages/default-setup/src`:

```
#features/   188 occurrences
@/features/    0
```

So a contract written `import type { T } from '#features/threads/be/types.ts'` violates claim 3 **and is not
reported** — and the closure walk stops there too, so claims 2, 4 and 5 are bypassed for everything beyond that
hop. No contract leaf uses `#features/` today, so nothing is missed *now*; the rule is one ordinary import away
from being silent about the thing it exists for.

`readSubpathImports` (`@apackdev/host/build/subpath-imports.ts:25`) is the resolver for a pack's own `imports` map,
and `pack-rules.ts:272` already uses it for exactly this. That is the fix, not a new resolver.

---

## Phase 1 — resolve the pack's own `imports` map

`resolveFrom` takes the pack's `imports` map through `readSubpathImports(path.dirname(src))`, so `#features/…`,
`#generated/…` and any other subpath a pack declares resolve to files. Note the rule already string-matches
`#generated/` before resolution (`:762`), and that branch must keep precedence — it distinguishes `types`/`ears`
from `events`/`fe`, which a resolved path cannot.

**Done when:** a fixture contract importing `#features/<other>/be/types.ts` is reported by claim 3; a fixture
whose leaf reaches `#generated/events` through a `#features/` hop is reported by claim 2; both fail before the
change and pass after; `npx tsx scripts/check-import-specifiers.ts --rule findContractLeafImports` still reports
nothing over this repo.

## What the reader refuses, and what it cannot

`checkResolved` guards the four positions a reader reads: the whole contract (`module-exports.ts:131`), `outgoing`
(`:184`), `inbox` (`:196`) and each member of an event union (`:213`). A collapse that arrives through a hop is
refused like a direct one — aliases are followed — so the indirect route is covered *where it lands in one of those
four*.

A collapse in `state`, `context` or an event's payload field is read as data, and **must be**. `src/__generated__/`
is untracked and `generatePackFiles` computes every generated file's contents before its caller writes any of them,
so on a pack's first build nothing under `#generated/` resolves: `actions/fe/contract.ts` has `categories: Category`
from `#generated/types.ts` in its state and `actionId: EARS.EntityId` in its events, both `any` at that moment, and
codegen is right to carry on — it needs each member's literal `type` and nothing else. Refusing those would make the
first build of a fresh checkout impossible.

That is the whole overlap, and it is why four of the five claims have no second guard anywhere.

`apack-sdk/tests/build/declared-type-of.spec.ts` holds both halves: a case for the collapse through a hop, and two
for the positions nothing reads. Two earlier notes in this doc were wrong and are corrected here — the spec's header
said *"the four shapes that reach the readers"* over five cases, which was the four refusal shapes plus a control and
so already right; and the reader's refusal is not "a slice of claim 2 in a cold tree" but the position table above.

## Phase 3 — read a syntax tree

The rule still matches `ANY_SPECIFIER` over file text, so it inherits the shapes demonstrated for
`findCrossFeatureImports` on 2026-09-27 (`c6f88f31e`): a commented-out import, one in a template literal, one in a
`.vue` `<template>` or `<style>`, all reported; a module path in a `vi.mock` missed. Contract leaves are `.ts`, so
the `.vue` shapes do not apply, but the comment and template-literal ones do.

The reader is `apack-cli/src/build/pack-sources.ts`; `readSource(file).specifiers` gives every specifier with its
line, and the script already imports it. The closure walk needs no byte offsets — `goal-one-rule-set.md:305`
claims it does, which is wrong twice: it also says this rule *"takes `view.code` from the reader"*, where the code
calls `fs.readFileSync` directly.

**Done when:** the 9 existing cases in `import-specifiers.integration.spec.ts:682-803` pass untouched (they assert
exact `file:line: specifier` strings, so a changed line or order fails), plus a case per false-positive shape.

## Phase 4 — record the division of labour

In the rule's doc comment: the reader catches a whole-type collapse in a cold tree; this rule catches the shape in
every tree, and claims 1, 3, 4 and 5 have no other guard. State the cost property (`generate-entries.ts:433`)
as the second reason the rule exists, since the cycle is the only one currently written down.

---


## What the cycle actually does — measured 2026-09-27

Two mutations of `tests/fixtures/external-pack`'s surface contract, each from a cold tree, each a shape a pack
author writes: the contract deriving its `state` from the machine (`SnapshotFrom<typeof memosState>['context']`),
and deriving its inbox as `Extract<>` over the machine's event union — the shape the origin commit records finding
seven times. **Both built with exit 0 and a byte-identical `src/__generated__/events.ts`.** No collapse, no wrong
event types. So the harm is not a wrong read, and the earlier framing of claim 2 as "the cycle returns" describes a
module-graph fact rather than a consequence.

What moved is the published artifact. `dist/types/pack-types.d.ts` went 6374 → 6415 lines (198236 → 199263 bytes)
and gained `import * as xstate from 'xstate'` plus `declare const memosState: xstate.StateMachine<…>` — every
event, every action name, `NonReducibleUnknown` — where the unmutated contract contributes one `interface
MemosContext`. Because a dependent's facade inlines its dependencies' verbatim (`src/__generated__/deps/<id>.d.ts`,
6135 lines of default-setup in the fixture's tree), it travels one hop further than the pack that caused it.

**And the third wrong harm, for the record.** The first was "codegen refuses it anyway" (refuted above); the second
"a contract that reads as `any`" (refuted by the two mutations); the third was mine — *"the facade gains a
third-party import its dependents may not have."* `apack-cli/src/build/facade-gate.ts:14-25` already allows a
facade to import `@apackdev/*`, Node built-ins and `@apackdev/sdk`'s peers, which include **`xstate`** and `zod`,
under *"Packages a facade may import: every dependent has them"* — with a passing gate case whose facade imports
both. `zod` travels that route today into a fixture that uses no zod. The leak is size and coupling, not
resolution.

**This does not reopen the decision below.** The rule stays: four of its five claims still have no other guard, it
costs nothing to run, and a narrower harm is still a harm — keeping the machine's internals out of a pack's public
types is worth one shape rule. What changes is that the rule now says what it actually prevents, so a fourth
investigation starts from the measurement instead of re-deriving it.

**Weighed and not built:** extending `facade:check` past default-setup, so a fixture or external pack would notice
its own facade growing. It guards a diff in a gitignored artifact nothing consumes, at the cost of a tracked
~6000-line `etc/pack-types.api.md` per pack that churns on every codegen change. The audience that needs the
signal is an external pack author, and no check here runs for them — that is the pack-rule question, not this one.

## Decisions — settled, do not reopen

- **The rule stays.** Four of its five claims have no other guard in a warm tree, and two documented invariants
  plus a pack-facing schema description name it.
- **Claim 3 stays in this rule.** Not folded into `findCrossFeatureImports`: that rule's subject is another
  feature's *frontend*, which `CLAUDE.md:442` documents as the boundary. Widening it to `be/` would codify a
  stricter architecture as a side effect of a cleanup, which is a decision for the user, not a refactor.
- **No claim is deleted for having no live subject.** `DECLARES_SOURCE_BY_DESIGN` is empty on purpose and kept;
  absence of a subject is not absence of a guard's value.

## Verification

Per phase above, plus: `npm run typecheck`; `npm run test:integration -w @app/internal-repo-checks` (the 61-case
`import-specifiers.integration.spec.ts`, 9 of them this rule's); `npx vitest run --root packages/apack-sdk
tests/build/declared-type-of.spec.ts`; `npm run test:external-pack:contract`; `npm run chain`.

`spec-cost` bookkeeping if a spec's cost crosses 1.5s/2.5s: `npm run spec-cost:update -- --suite internal-repo-checks` or
`-- --suite apack-sdk`, on an idle machine.

## What was verified, and what was not

**Verified:** all 26 contract modules' imports in `default-setup` and the fixtures (none reaches another feature);
`#features/` 188 against `@/features/` 0; `resolveFrom`'s two branches; that `readSubpathImports` exists and
`pack-rules.ts` uses it; that the rule reports nothing today; `checkResolved`'s condition and the three narrower
guards; the origin commit's account of claim 3.

**Since verified:** the indirect route *is* refused where the collapse reaches one of the four read positions, and
is not refused anywhere else — measured through the reader, with a mutation per direction (deleting the member check
fails the hop case; adding a `state` check fails the case that says a collapsed state is read as data).

**Claim 2's list was short by three.** It named `events` and `fe`; read through `readSource(file).specifiers` over
both packs' generated trees, the generated modules that import a contract are `events`, `fe` **and `system-specs`** —
the module in the middle of the cycle the origin commit documents. `pack-entry` and `pack-entry-fe` belong with them
for the rule's other reason: they import the machines. All five are now `GENERATED_BEHIND_A_CONTRACT`
(`check-import-specifiers.ts`), with a case in `import-specifiers.integration.spec.ts` for the three that were
missing. None has a live subject in either pack, so this closes a gap rather than a bug.

**And not transitive reach**, which the same measurement settles the other way: twelve of default-setup's sixteen
generated modules reach a contract through some hop, `repository` among them — and a module the leaf reaches is meant
to use the repository facade, which one of the rule's own cases asserts. What sets the five apart is that codegen
derives them from the thing it is reading, or from the thing it is reading around.
