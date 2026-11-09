# Three defects a review of #379 found that are not terminal findings

Status: **all three closed.** Found reviewing `session/terminal-ownership` (#379) on 2026-11-08,
confirmed or relayed as noted. They are here rather than in
[the terminal integration review](ISSUE-terminal-integration-review.md) because none of them is a row in it:
that document's subject is the terminal, and these are a tab-group prune, a test-runner's toolchain lookup
and a stale comment. The goal that closed the review's rows is
[archived](../archive/goals/goal-terminal-ownership.md); it did not own these and did not fix them.

**What was fixed instead, in #379:** the three high findings (refusal correlation, a requested exit reading as
a crash, an exit attributed to a replaced shell), the streamed-reply `done` event, an observation's attributes
costing every development run and test a serialisation, and the two that reached review rows — F15's flag
outliving its click and F17's remaining residual, which that row now records.

## 1. A late tab re-arms the prune that drops another late tab's group — **closed**

`features/code/fe/state.ts`, `finalizeRestoreState`. It keeps `pendingPersistedMetadata` and the groups of
tabs that missed the deadline, but sets `pendingTabOrder: undefined` — and the prunes in `addTab` and
`updateState` are keyed on exactly that being absent. So with `/src/a.ts` (no group) and `terminal:t-1`
(group `g-1`) both late, `/src/a.ts` arriving prunes `g-1` and persists `tab-groups: []`; `terminal:t-1` then
hydrates with a `groupId` naming a group that no longer exists, losing its name and colour, and appends at
the end rather than its persisted slot.

**Confirmed and fixed.** Every `pruneEmptyTabGroups` call now takes the tabs a restore is still expecting,
and the parameter is required so no site can forget it — including `persistCodeTabs`, which is what wrote the
loss to storage and made it survive the next launch. `finalizeRestoreState` had the rule right and kept its
own copy of it; it shares this one now. Two firing cases past the settle, where the existing cases stopped.

## 2. `test:linux` refuses to start without a `vendor/` link — **closed**

`scripts/linux-runner.ts`: `rustCheckoutsIn(vendoredCheckouts(REPO_ROOT))` throws when no `vendor/` entry
holds a `Cargo.toml`, and the surrounding IIFE turns that into `process.exit(1)`. The toolchain used to come
from `ELMDB_CHECKOUT`, which honours `APACK_LINUX_ELMDB_ROOT`. On a machine running the documented
frozen-checkout qualification (`tests/performance/README.md`) without a link, the runner now refuses with
"Run `npm run link:elmdb`" although the native source it was pointed at is present.

**Closed** by `41c5631d9e`: `rustCheckoutsForRun(ELMDB_CHECKOUT, VENDOR_ELMDB, vendoredCheckouts(REPO_ROOT))`
derives the toolchain from the checkouts a run actually has, so `ELMDB_CHECKOUT` — which honours
`APACK_LINUX_ELMDB_ROOT` — answers when no `vendor/` entry does. The refusal is kept for the case it was
written for, two checkouts pinning different channels, and names both.

## 3. A comment asserts the opposite of what the code does — **closed**

`features/code/fe/features/explorer/state.ts`: "Pinned tabs are kept by `removeTabs`" was false — the
`|| tab.isPinned` exemption is gone from `utils/tab-management.ts`. The behaviour change reads as intended;
the comment did not.

**Confirmed and fixed.** `removeTabs` exempts nothing on purpose, and says why where it is written: pinning
is about where a tab sits, not about outliving what it shows, and every caller of it is a subject that is
gone — so an exemption left a permanent ghost pointing at nothing. The comment at the call site says that
now instead of the opposite. Nothing else in the repo repeated the claim.
