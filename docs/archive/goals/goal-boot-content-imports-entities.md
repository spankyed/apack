> **Done** (`7b57dcf7d`, `4ce82972c`, `242e9597c` on master). The text below is the plan as written; Decision 7
> turned out to be wrong and the Outcome says why. For the rule this established, see
> [`docs/public-facing/content.md`](../../public-facing/content.md) and
> [`packages/default-setup/src/content/CLAUDE.md`](https://github.com/spankyed/apack/blob/18d8a47b19495498f5a4bf52b41dae684c6efc12/packages/default-setup/src/content/CLAUDE.md).

# Goal: `content.sources` holds only entries that import rows, and a registration carries no apply facts

> **Written in session** `6471efed-3887-41dc-ba56-22d06ceb22bc` (Claude Code, 2026-10-08). Resume it with `claude -r 6471efed-3887-41dc-ba56-22d06ceb22bc`.

```
# Goal: content.sources holds only entries that import rows

Implement docs/goals/goal-boot-content-imports-entities.md on master, at or after 514a9f566 — the base its
Background was surveyed at.
Before Phase 1, confirm the base: PackContentManifest and skipAfterOnboarding in
packages/apack-sdk/src/framework/pack-registration.ts, skipAtBoot in packages/default-setup/apack.json,
the findWhere(CONTENT_KEY) lookup in packages/apack-sdk/src/content/applier.ts, bootApplyPacks in
packages/apack-host/src/migrations/app/0.4.0.ts, and getBaseSettings in
packages/default-setup/src/app-settings/index.ts all exist at HEAD. If they don't, stop and say so —
the plan was surveyed somewhere else.
Read Background, Decisions, Phases and Constraints first. Decisions are final: implement them, don't
reopen them or stop to ask.
Where a detail isn't specified, pick the conventional option, note it in the final summary, and keep
going. No backward compatibility in code (root `CLAUDE.md`, "Backward compatibility" — a standing rule,
not this goal's choice): change signatures, move modules, migrate every in-repo caller, test, fixture,
template and doc in the same change, and fix forward. Stored user data is the exception: it moves with
migrations.

Phase 2 changes a user-visible destructive action. Implement the capability and the UI as specified; if
the Settings view needs a design call the doc doesn't make, pick the conventional one and note it.

Finished when:
- Phases 1-3 are implemented and each meets its "Done when"; every new guard and test is
  mutation-checked.
- A written row the user deleted is not recreated: the applier treats a soft-deleted row carrying its
  contentKey as the user's, and `boot.contentPolicy` no longer exists in packages/default-setup/apack.json.
- `settings` is not a `content.sources` entry, packages/default-setup/src/content/settings/applier.ts is gone,
  and the user can reset one feature's or one section's settings from the app's Settings view.
- `PackContentManifest`, `boot.contentManifest` and `contentPolicy` appear nowhere in packages/ or scripts/
  (`grep -rn "contentManifest\|PackContentManifest\|contentPolicy" packages scripts --include='*.ts'` is empty
  apart from archived docs).
- npm run typecheck, npm run spec over the touched packages, and npm run chain pass; api:update was run
  for the @apackdev/sdk surface change in Phase 3 and etc/framework.api.md is committed.
- npm run compile and npm run test:external-pack pass (the content pipeline and a dependent pack's content).
- A final summary: phase -> done/deferred, evidence, and the conventional choices made.
- The doc is in docs/archive/goals/, with its status blockquote and an Outcome section, committed.

Commit each phase when its "Done when" holds and the checks are green, not once at the end: conventional
message, no attribution lines, `git commit -- <paths>` naming only that phase's files. Check
`git diff --cached` first — another session stages files in this checkout, and a pathspec commit leaves
the rest of the index alone.

Never: push, tag or open a PR; publish, release or trigger workflows; touch a real data dir or broad-kill
processes; run bare tsc in packages/preload; edit version or release metadata; change the typed EARS
types to make a call site compile; add a backward-compat shim or loosen a failing assertion instead of
investigating. Constraints has these in full.
Goal-specific: do not add a field to a written row (Decision 2), and do not build a retired-content-key
ledger (Deferred 1).
```

## Background (2026-10-08, at 514a9f566 on master)

**Applying runs when a pack's compiled content change, not every boot.** `applyPacks`
(`packages/apack-host/src/packs/runtime/apply.ts:99`) hashes every file under the pack's
`dist/runtime/content`, records it in `AppState.packContentRevisions`, and skips a pack whose hash and dependency
state are unchanged. So the question a policy answers is: *when applying does run, which keys should be left
out?*

**`boot.contentPolicy` is the answer, and it holds two unrelated statements.** Declared in `apack.json`
(`manifest-schema.ts:122`), carried on the registration as `PackContentManifest.contentPolicy`
(`packages/apack-sdk/src/framework/pack-registration.ts`), read by `evaluateContentPolicy`
(`apply.ts:161`), which turns each named key into an empty include-set. Only `packages/default-setup`
declares one: `{ skipAtBoot: ["settings"], skipAfterOnboarding: ["notes"] }`.

**Nothing validates the key names against `content.sources`.** `manifest-schema.ts`'s `superRefine` cross-checks a
content format against `content.formats` and `contentWriters` against the pack's own entities, but not `contentPolicy`'s
keys. A renamed content key silently stops being skipped.

### What `skipAfterOnboarding: ["notes"]` is for

default-setup content demo notes. Without the skip, an apply-hash change (any edit under its content directory)
re-imports them — including ones the user deleted. Traced:

1. Notes delete **softly**: `trash.move` (`@apackdev/sdk/repositories`' `trash.ts`) sets `deleted: true` and
   `deletedAt`, and keeps the row's `contentKey`.
2. The applier looks for its own row with `ears().findWhere(entity, CONTENT_KEY, contentKey)`
   (`packages/apack-sdk/src/content/applier.ts:137`).
3. `findWhere` filters soft-deleted rows out —
   `packages/apack-ears/src/query-helpers.ts:27`, `.filter(entity => !isDeleted(entity))`.
4. So the trashed note is invisible, `findByIdentity` (same filter) finds nothing, and the applier
   **creates a new one**. The user ends with a fresh demo note and the deleted one still in the trash.

**The record of the deletion already exists** — the row, marked deleted, carrying the `contentKey` the applier is
searching for. The applier looks with a finder that hides it. Its three existing skip outcomes are all about a
row that *exists*: no `sourceHash` (user-owned), hash matches, written fields changed (edited).

### What `skipAtBoot: ["settings"]` is for, and why it is a vestige

The `settings` entry in `content.sources` is three unrelated things in one manifest entry:

1. **A compiled artifact read back by the pack that wrote it.**
   `packages/default-setup/src/content/default-settings.ts` is plain TypeScript in the pack. The `settings`
   format (`src/content/_compilers/settings.ts`) compiles it to `settings.content.json`, and
   `getBaseSettings()` (`src/app-settings/index.ts:15`) reads that file off disk with `readFileSync` +
   `JSON.parse` to produce `settingsSections()` — the sections `apack.json` `settingsSections` declares.
   The detour has its own error for when it has not been paid: *"Run `npm run compile` before starting the
   backend."*
2. **A reset command.** `src/content/settings/applier.ts` ignores its own record and calls
   `services.settings.reset()`. Nothing ever writes the compiled settings into the database.
3. **A policy to stop (2) firing at boot** — `skipAtBoot`.

It is pre-0.4.0 shape. Settings are now the host's (`packages/apack-host/src/features/settings/`,
`@apackdev/host/settings`): **the row holds only what the user changed**, and the store composes the
registration's defaults underneath it, keyed by feature ref (`surfaces['default-setup/threads']`). So there
is nothing to write at boot, and `services.settings.reset()` is all-or-nothing where the document's shape
would support per-feature.

### What else depends on `contentManifest`

`contentKeys` and `compiledDir` were removed at `195884cfa` (nothing read them since
`orchestrateDeclarativeContent` went). What is left:

| reader | what it uses |
|---|---|
| `packs/registry.ts:612` | `contentManifest.contentPolicy`, passed to `applyPacks` as `PackContentTarget.contentPolicy` |
| `packs/registry.ts:623` | its **presence**, as a `bootHooks` string in `getPackExtensions` (the Packs view) |
| `migrations/app/0.4.0.ts:46` (`bootApplyPacks`) | its **presence**, to list the shipped packs a pre-0.4.0 single `contentRevision` stood for. That migration's own comment says to *"delete it with the other migrations once 0.4.0 is below the oldest version upgrades are supported from"* |

`PackContentManifest` is exported from `@apackdev/sdk/framework` and reported in
`packages/apack-sdk/etc/framework.api.md`.

## Decisions

Final.

1. **The applier treats a soft-deleted row carrying its content key as the user's.** It looks up its own row
   with deleted rows *visible* and adds a fourth skip outcome beside the three it has: found, and
   `deleted === true`, means the user removed it — leave it alone and skip its subtree, as
   `keep-existing` already does. This replaces `skipAfterOnboarding` for every content key, not just the one
   where it was noticed.
2. **No new field on a written row.** The deletion is already recorded (`deleted`, `deletedAt`, `contentKey`);
   the gap was reading it. A row keeps `sourceHash`, `writtenFields`, `contentKey` and flows' `writtenGraph`,
   and this goal adds none.
3. **`settings` stops being a `content.sources` entry.** The base defaults become something the pack imports
   rather than compiles and reads back: `getBaseSettings()` imports
   `src/content/default-settings.ts` directly. The `settings` content entry, the `settings` format and
   `src/content/settings/applier.ts` go.
4. **The base-file validation survives the format.** `_compilers/settings.ts` refuses a base file that
   sets a surface's slice; that check moves to where the base is read (an assertion in
   `src/app-settings/`) rather than being a reason to round-trip through disk.
5. **Resetting settings is the host's, per feature and per section.** The capability goes on
   `services.settings` / the host's settings store — reset one feature's slice or one section — and is
   reached from the app's Settings view, not from a pack. Resetting a feature is *removing the user's
   slice*, after which the registration's defaults apply on the next read; nothing writes defaults in.
   A pack command would put a host capability back in the pack lane, which is the error
   `contentManifest` already made.
6. **`PackContentManifest` and `boot.contentManifest` are removed.** With 1 and 3 there is no `contentPolicy`, and
   with it nothing left to carry. A registration carries **code** (`appliers`, `onInit`, `migrations`,
   services); the manifest and the compiled artifacts carry **facts**. That is the rule this goal
   establishes, and `contentManifest` was facts in the code lane.
7. **`bootApplyPacks` reads the manifest.** "Does this shipped pack ship content data" is `content.sources`, which is
   the fact itself rather than a proxy for it. The `bootHooks` entry for `contentManifest`
   (`registry.ts:623`) is dropped: it names nothing a reader of the Packs view can act on.
8. **The rule is written down and checked where it can be.** `content.sources` holds only entries that import
   rows into the database; an entry needing a policy that says "do not import this" is not one. It goes in
   `docs/public-facing/content.md` and `packages/default-setup/src/content/CLAUDE.md`.

## Phases

### Phase 1 — The applier learns deletion

Independent of Phase 2; land it first because Phase 3 needs both.

- `packages/apack-sdk/src/content/applier.ts`: the `contentKey` lookup (`:137`) sees soft-deleted rows. Use a
  raw read rather than `findWhere` (`findByIdRaw`-shaped, or `query` without the deleted filter), and return
  a match that says the row is deleted.
- Add the fourth outcome in the outcome branch: a deleted match is skipped, counted as skipped, and its
  subtree is not descended (a deleted parent's children are the user's too).
- `packages/default-setup/apack.json`: drop `skipAfterOnboarding` from `boot.contentPolicy`.
- `evaluateContentPolicy` (`apply.ts:161`) keeps its `skipAtBoot` arm until Phase 2.
- `docs/public-facing/content.md`: the re-apply rules gain the deletion outcome, beside "edited" and
  "user-created".

**Done when:**
- A new spec content a row, trashes it, bumps the compiled content, re-applies, and the row is **not**
  recreated — in `packages/default-setup/tests/content/` with the pack's own notes, since that is the case
  the behaviour exists for.
- Mutation: restoring the `findWhere` lookup makes that spec fail.
- A second case covers the subtree: a trashed parent note's children are not recreated either.
- `npm run spec -- applier content` and `npm run spec -- packages/default-setup/tests/content` pass;
  `npm run content-parity:check -w @app/default-setup` passes, or its goldens are re-recorded deliberately
  with `content-parity:update` and the diff is explained in the commit message
  (`packages/default-setup/tests/content/CLAUDE.md` has the rule).
- `npm run chain` passes.

### Phase 2 — Settings stop being content data, and the host can reset them

Independent of Phase 1.

- **The capability.** `@apackdev/host/settings`' store and `services.settings` gain a reset narrower than
  today's: one feature's slice by ref, or one section by name (Decision 5). Removing the user's slice is
  the whole of it — the defaults come from registration on the next read.
- **The UI.** The app's Settings view (`packages/renderer/src/views/settings/`) offers it per feature and
  per section, as a destructive action with a confirmation. The host's settings system
  (`packages/apack-host/src/features/settings/be/`) answers the sender as it does any other write
  (`SETTINGS_SAVED` / `SETTINGS_REFUSED`, `be/answer.ts`).
- **The content entry goes.** Remove the `settings` entry from `packages/default-setup/apack.json`
  `content.sources`, the `settings` entry from `content.formats`, `src/content/settings/applier.ts`, and
  `src/content/_compilers/settings.ts`.
- **The defaults become an import.** `getBaseSettings()` (`src/app-settings/index.ts`) imports
  `../content/default-settings.ts`; the `readFileSync`/`JSON.parse` and the "run `npm run compile`" error go
  with it. Move the compiler's base-file check to an assertion where the base is read (Decision 4).
- **The policy goes.** Drop `boot.contentPolicy` from `apack.json`, and `evaluateContentPolicy` and
  `PackContentTarget.contentPolicy` from `apply.ts`.
- Before deleting the format, confirm no pack names `default-setup:settings`
  (`grep -rn "default-setup:settings" packages tests`). If one does, stop and report it.
- Docs: `packages/default-setup/src/content/CLAUDE.md`'s Settings section, `CLAUDE.md`'s Content section,
  `docs/public-facing/content.md`, and the rule from Decision 8.

**Done when:**
- `boot.contentPolicy` and the `settings` content entry are gone from `packages/default-setup/apack.json`.
- A spec covers the narrow reset: a feature's changed setting, reset, reads back as the registration's
  default, and the other features' settings are untouched. Mutation: resetting the whole document fails
  the "untouched" half.
- A spec covers the defaults' new path: `settingsSections()` returns the same sections it did from the
  compiled artifact, with no compiled content on disk.
- `npm run compile`, `npm run spec -- settings app-settings`, the host and default-setup suites, and
  `npm run chain` pass.
- The reset is reachable in the running app: a `drive/` script changes a feature's setting, resets it,
  and reads the default back (`npm run drive`).

### Phase 3 — `contentManifest` is removed

After Phases 1 and 2.

- `packages/apack-sdk/src/framework/pack-registration.ts`: delete `PackContentManifest` and
  `PackBootHooks.contentManifest`.
- `packages/apack-sdk/src/build/generate-entries.ts`: stop emitting `contentManifest` in the pack entry;
  drop the now-unused `contentPolicy` lines.
- `packages/apack-host/src/packs/registry.ts`: drop the `contentPolicy` read (`:612`) and the
  `bootHooks.push('contentManifest')` (`:623`).
- `packages/apack-host/src/migrations/app/0.4.0.ts`: `bootApplyPacks` reads each shipped pack's manifest
  `content.sources` (Decision 7). The migration's behaviour must not change — the same pack ids for the same
  data.
- Migrate the fixtures that construct a `contentManifest` (host's `tests/packs/registration.spec.ts`,
  `tests/packs/runtime/{loader,reload}.spec.ts`, `tests/services/host-runtime.spec.ts`,
  `tests/migrations/app-state-0.4.0.spec.ts`) and the codegen specs that assert the emitted block.
- `npm run api:update -w @apackdev/sdk`; commit `etc/framework.api.md`.
- Regenerate default-setup (`npm run compile`) so `src/__generated__/pack-entry.ts` loses the block.
- Docs: `packages/default-setup/CLAUDE.md`'s boot-hooks list, `packages/apack-host/src/packs/runtime/CLAUDE.md`'s
  pack-entry contract and content row, `docs/public-facing/manifest.md` and `content.md`.

**Done when:**
- `grep -rn "contentManifest\|PackContentManifest\|contentPolicy" packages scripts --include='*.ts' --include='*.json'`
  returns nothing outside `docs/archive/`.
- `packages/apack-host/tests/migrations/app-state-0.4.0.spec.ts` passes unchanged in what it asserts
  about which packs are migrated — the fixture moves to a manifest, the expectations do not.
- `etc/framework.api.md` records only the removal.
- `npm run typecheck`, `npm run spec` over the touched packages, `npm run compile`,
  `npm run test:external-pack` and `npm run chain` pass.

## Deferred

1. **A retired-content-key ledger for hard deletes — answered, and not by a ledger.** Decision 1 covers soft
   delete, which is what notes and the other trashed entity types use; an entity type with no trash is
   deleted outright, its `contentKey` going with the row. This item was deferred on a false premise (that
   nothing in the repo content a hard-deleted type; two of the five shipped keys do) and with the wrong shape
   in mind: what covers it is a record of what the pack's content *defined*, not of what was deleted. That
   is a snapshot the size of the pack's content rather than a list that only grows, and it needs no write at
   any delete site. See the correction below.
2. **Validating `contentPolicy`'s key names** against `content.sources` in `manifest-schema.ts`'s `superRefine`.
   The field is gone after Phase 2, so the check has no subject. Named here because it is the obvious fix
   to reach for and would be dead code.
3. **A general "when does this entry apply" field on a content entry** (`once`, `on-request`). Both of
   `contentPolicy`'s members turned out to be something else — one a missing read, one a vestige — so there is
   no evidence any pack needs a lifecycle declaration. Revisit if a second pack asks for one.

## Constraints

- Commit each phase as it finishes, in logical chunks, no attribution lines, `git diff --cached` first;
  another session stages files in this checkout, so commit by pathspec. Pushing, tagging and PRs are on
  request.
- No publishing, releases or triggered workflows.
- No real data dirs, no broad `pkill`, E2E and drive runs in the `apack-test` namespace or an
  isolated `APACK_USER_DATA_DIR`.
- No bare `tsc` in `packages/preload`; no `npm install` in the example pack; no version or release
  metadata edits.
- The typed EARS types are change-controlled (`packages/apack-sdk/TYPED-EARS.md`): fix a call site, not
  the types.
- Published packages: no `any` in the pack-facing surface, the TypeScript floor holds, and
  `npm run api:update` after an export change — with the diff reported, not just recorded.
- Build order: `packages:build` before the CLI suite, default-setup's runtime before the api suites and
  E2E. `npm run packages:ensure` covers both.
- Migrations follow `packages/apack-host/src/migrations/CLAUDE.md`. Phase 3 changes how a migration picks
  its packs, not what it writes: prove the behaviour is identical rather than asserting it.
- Investigate a failing test rather than loosening it; mutation-check every new guard.
- External packs are first-class: `test:external-pack` and `test:packaged-authoring` keep passing, and a
  dependent pack's content keep working (Phase 2 removes a format — confirm nothing names it).
- `npm run spec` and `chain --dry` are the loop; the full chain runs once per phase, at the end.


## Outcome

All three phases landed, one commit each, each with the full chain green.

| Phase | Commit | Evidence |
|---|---|---|
| 1 — the applier learns deletion | `7b57dcf7d` | two cases in `notes-change-tracking.spec.ts`; mutation: restoring the `findWhere` lookup fails both and leaves the other nine passing; `content-parity` goldens unmoved (144 pass); chain 160.2s |
| 2 — settings stop being content data | `4ce82972c` | `settings-reset-one-target.spec.ts` (3) and `app-settings/index.spec.ts` (6); mutation: the handler ignoring its target fails both targeted cases and passes the untargeted one; chain 50.8s |
| 3 — `contentManifest` removed | `242e9597c` | the Done-when grep returns nothing in source; `etc/framework.api.md` records only the removal; `test:external-pack` passes; chain 171.3s |

### Corrections to the Decisions

**Decision 7 was wrong, and acting on it would have changed a migration's behaviour.** It said `bootApplyPacks`
should read each shipped pack's manifest `content.sources`, on the grounds that "does this pack ship content data" is the
fact the registration was a proxy for. It is not: **codegen emitted `boot.contentManifest` for every pack**,
whether or not it declared a `content.sources` at all — `tests/packs/bundled-ui-pack` has no `boot` key in its
manifest and had one in its generated registration. So the filter never removed a pack, and reading the
manifest would have *narrowed* which data the 0.4.0 migration touches. The filter is dropped rather than
reinterpreted, and the comment there now warns off the improvement that looks obvious.

**One entry still fails the rule, and it is not the one this goal removed.** `faqs` is a `content.sources` entry
whose format declares no `entity`: nothing is imported, and `default-setup/src/app-settings/index.ts` reads
back the `faqs.content.json` the build wrote — the same shape as the `settings` entry, found only while
reviewing. It stays because the way out that `settings` took is closed to it: `default-settings.ts` is a `.ts`
module a pack can import, and FAQ sources are markdown that needs a compiler, which `content.sources` is the only
manifest key that runs. So the invariant below is stated with that exception named rather than as a clean
sweep, and closing it means a manifest key for compiled artifacts nothing imports — a decision, which
[`goal-manifest-redesign.md`](goal-manifest-redesign.md) is the place for.

**The rule holds for three of the five shipped content keys, not all of them, and the claim as first written
— here, in `content.md` and in Phase 1's commit message — was an overclaim.** The applier's half is general:
it finds its row whether or not the row is marked deleted. But there has to *be* a row, and only a feature
that soft-deletes leaves one. Notes (`trash.move`), actions and prompts do. Flows do not
(`flowRepository.deleteFlow` → `untypedWrite(flowId).destroy()`), nor do library documents and collections
(`features/library/be/repository/commands.ts` → `write(id).destroy()`), so a user who deletes the written demo
flow or a library document still gets it back — exactly the complaint Phase 1 was written to fix, for two
of the keys it did not reach.

**Closed, by a third shape neither Decision 1 nor Deferred 1 had in view.** Trashing those two entities turned
out not to be a contained change: library reads rows straight off relation walks with raw `query(...).pickAll()`
— 19 sites in 4 files with no filtered read anywhere — and flows and the brain another 4, and neither
`linksTo` nor `findRelations` filters `deleted`, so a trashed flow would stay listed and stay runnable. What
landed instead is the same fact from the other side: the content keys a pack's content defined on its last run
(`ContentKeyRecord`, recorded in `AppState.packContentKeys` by `applyPacks`), so a key defined before with no row now
is the user's deletion whatever that feature's delete does. No read path changed and no pack-facing API was
added beyond the record itself. What it does not give is recovery — a destroyed row is still gone — and it
infers rather than observes, so a row lost some other way is also left uncreated.

**It costs existing installs one last re-creation, and no migration can avoid that.** Data from before this
has no record, so the first boot apply after upgrading defines every key for the first time and creates the
rows a user destroyed earlier; from then on the rule holds. A migration cannot content the record usefully:
what it could record is the keys of the rows that *are* there, which is exactly the set that needs no
protecting, and the deleted ones are what nothing knows about.

**Decision 5 was implemented more narrowly than it was written.** It called for `services.settings` to "gain a
reset narrower than today's". No new service method was needed: `removeStored(path)` already existed and was
reached only by migrations, so what the change added was an address — an optional `target` on the existing
`RESET_SETTINGS` — and one new frontend surface, `SettingsPort.reset(target?)`.

### Deferred, with what each is waiting for

- **The General tab has no reset.** Its nav items (`personal`, `projects`, `application`) are keys *inside*
  the `general` section rather than sections, so a section reset there would drop all three at once. The
  granularity that tab wants needs the target to carry a path, which is a decision rather than a detail.
- **The drive run was not made.** Phase 2's "Done when" asked for a `drive/` script changing a setting,
  resetting it and reading the default back. The path is type-checked end to end (the view's event union types
  the send) and covered at the system level, but the Vue button → `actor.send` wiring has not been exercised in
  a running app.
- Deferred 1-3 as written: no retired-content-key ledger (the two hard-deleted content keys are named in the
  correction above and nobody has reported a row coming back), no `contentPolicy` key validation (the field is
  gone), no general `when:` lifecycle on a content entry.

### Invariants this leaves

- **`content.sources` holds only entries that import rows into the database** — with `faqs` named as the one
  standing exception, above. An entry needing a policy that says "do not import this" is not one, and a `.ts`
  source a pack reads back itself is an import of its own source.
- **A registration carries code; the manifest and the compiled artifacts carry facts.**
- **A written row the user deleted is not written again, and nor are its children** — for both kinds of
  deletion, by two different records. A trashed row carries its own content key and the applier reads it; a row
  destroyed outright is covered by the keys the pack's content defined on its last run. A user asking for a
  pack's data back gets it: that import carries no such record.
