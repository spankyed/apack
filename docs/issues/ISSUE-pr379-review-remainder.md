# Three defects a review of #379 found that are not terminal findings

Status: open. Found reviewing `session/terminal-ownership` (#379) on 2026-11-08, confirmed or relayed as
noted. They are here rather than in
[the terminal integration review](ISSUE-terminal-integration-review.md) because none of them is a row in it:
that document's subject is the terminal, and these are a tab-group prune, a test-runner's toolchain lookup
and a stale comment. The goal that closed the review's rows is
[archived](../archive/goals/goal-terminal-ownership.md); it did not own these and did not fix them.

**What was fixed instead, in #379:** the three high findings (refusal correlation, a requested exit reading as
a crash, an exit attributed to a replaced shell), the streamed-reply `done` event, an observation's attributes
costing every development run and test a serialisation, and the two that reached review rows — F15's flag
outliving its click and F17's remaining residual, which that row now records.

## 1. A late tab re-arms the prune that drops another late tab's group

`features/code/fe/state.ts`, `finalizeRestoreState`. It keeps `pendingPersistedMetadata` and the groups of
tabs that missed the deadline, but sets `pendingTabOrder: undefined` — and the prunes in `addTab` and
`updateState` are keyed on exactly that being absent. So with `/src/a.ts` (no group) and `terminal:t-1`
(group `g-1`) both late, `/src/a.ts` arriving prunes `g-1` and persists `tab-groups: []`; `terminal:t-1` then
hydrates with a `groupId` naming a group that no longer exists, losing its name and colour, and appends at
the end rather than its persisted slot.

**Relayed, not confirmed.** `tests/.../fe/state.spec.ts` asserts the state right after the settle, which is
before either late arrival.

## 2. `test:linux` refuses to start without a `vendor/` link

`scripts/linux-runner.ts`: `rustCheckoutsIn(vendoredCheckouts(REPO_ROOT))` throws when no `vendor/` entry
holds a `Cargo.toml`, and the surrounding IIFE turns that into `process.exit(1)`. The toolchain used to come
from `ELMDB_CHECKOUT`, which honours `APACK_LINUX_ELMDB_ROOT`. On a machine running the documented
frozen-checkout qualification (`tests/performance/README.md`) without a link, the runner now refuses with
"Run `npm run link:elmdb`" although the native source it was pointed at is present.

**Relayed, not confirmed.**

## 3. A comment asserts the opposite of what the code does

`features/code/fe/features/explorer/state.ts`: "Pinned tabs are kept by `removeTabs`" is false — the
`|| tab.isPinned` exemption is gone from `utils/tab-management.ts`. The behaviour change reads as intended;
the comment does not.

**Relayed, not confirmed.**
