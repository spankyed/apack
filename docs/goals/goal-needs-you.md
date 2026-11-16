# Goal: one list of what needs the person

**Status: planned, 2026-11-16.** Nothing is started. **Start after Phases 1 to 3 of
[the terminal program status goal](goal-terminal-program-status.md) are merged**: Phase 4 here feeds from
what that goal makes the Code feature hold. Phases 1 to 3 here do not depend on it and may start sooner.
Owners: a new host service (`packages/apack-sdk`, `packages/apack-host`), the shell
(`packages/apack-host/src/features/application`, `packages/renderer/src/views/layout`), Electron main and
preload, and two feeders in `packages/default-setup` (the Code feature and the Threads feature).

Written so that an implementer who did not write it can finish it. Seams were read at monorepo
`c7d4ec6ce5`; re-read each before editing.

## Prompt

````text
# Goal: one list, in the app's shell, of every agent and terminal waiting on the person

Implement docs/goals/goal-needs-you.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Phases, Constraints and Current handoff before continuing.
The survey was made at monorepo c7d4ec6ce5; inspect current code before relying on it.
Phase 4 needs docs/goals/goal-terminal-program-status.md Phases 1 to 3 merged; confirm that first.
Follow the current checkout arrangement and preserve unrelated work.

Work the phases in order. A phase is finished when its Done-when conditions hold on current source.
Each phase ends with evidence written to docs/references/evidence/needs-you.md.

Finished when:
- Every phase's Done-when holds on current source, with source commits and evidence recorded.
- The final validation under Closing passes.
- Reference and public docs describe services.attention and the list.
- Outcome is written, the goal is archived, links are repaired and the closure is committed.

Commit usable checkpoints as you go. Do not expand or reduce scope without user authorization.
````

## Why

Agents run in two places: a thread, where a flow runs one, and a terminal tab, where a person starts one.
Each place marks its own. A person with several of both has to visit each to learn which is waiting on
them, and an agent that asked for permission an hour ago in a tab nobody opened is an hour lost.

The outcome is that the person never opens a tab to find out whether something needs them. One list in
the shell holds everything that does, the dock shows how many, a notification leads to the exact place,
and a key jumps to the next one.

## Scope

In:

- A host service, `services.attention`, that any pack tells what needs the person.
- The shell showing those items as one list, with a count, an order, and a way to go to each.
- A system notification per item when the app is not in front, which opens the item when clicked.
- The dock badge.
- A hotkey that goes to the next item.
- Two feeders: terminals, from their program status, and thread agents, from an unanswered request.

Out:

- **Answering from the list.** The list takes the person to the item; it does not approve, deny or type.
  Approving a thread agent's request in place needs that request's block drawn outside its thread, which
  is its own design. Reopen once the list is in daily use.
- **A finished thread turn as an item.** Threads keep their own marks for that. Whether a thread also
  needs a "finished" item is the owner's call after using the list.
- **History.** The list is what needs the person now. Nothing is kept of what was settled.
- **A badge on Windows.** `app.setBadgeCount` covers macOS and Linux; a taskbar overlay is separate work.
- **A notification with no window open.** A window raises it (Decision D5).

## Verified seams

At monorepo `c7d4ec6ce5`:

- **Host services, the contract side:** `packages/apack-sdk/src/services/index.ts:61` `HostServices`.
  `packages/apack-sdk/src/framework/service-consumption.ts:10` `_HOST_SERVICE_NAMES`, with a type check
  beside it that fails when a service is missing from the list. A pack names the host services it uses
  in `apack.json` `consumes.services` (`packages/default-setup/apack.json:9`).
- **Host services, the implementation side:** `packages/apack-host/src/services/`, one file per service;
  `createHostRuntime` in `services/index.ts` assembles them. `services/settings.ts:6` `forPack` is the
  model for a service that knows which pack is calling. `packages/apack-host/tests/boundaries.spec.ts`
  holds that directory to services and the index.
- **The test runtime's services:** `packages/apack-sdk/src/testing/host.ts:217`.
- **Packs coming and going:** `packages/apack-host/src/packs/registry.ts`: `unregisterPack` `:731`,
  `onRegistrationChanged` `:853`.
- **What the shell publishes to windows:** `packages/apack-host/src/features/application/be/system.ts`
  broadcasts each piece of shell state to the `application` surface (`:74-90`) and sends all of them on
  `SEND_STATE` (`:111`).
- **What a window holds:** `packages/apack-sdk/src/fe/shell.ts`: `HostShellState` `:28`, `Shell` `:98`,
  which `useShell()` gives a component.
- **Where the shell is drawn:** `packages/renderer/src/views/layout/Toolbar.vue`.
- **Global hotkeys:** `packages/apack-host/src/features/application/fe/input.ts:87` sends each key press
  as `PROCESS_GLOBAL_HOTKEY`; `fe/machine.ts:532` and `:819` handle it.
  `packages/apack-sdk/src/types/app-settings.ts:7` `ApplicationHotkeys` declares the app's own.
- **Notifications:** `packages/preload/src/index.ts:62` `notify.show(title, body, tag)`.
  `packages/main/src/modules/notify-access.ts`: `showNotification` `:31` shows one with no click handler,
  and the handler at `:54` shows a tag once per `TAG_MEMORY_MS`.
- **Windows and focus in main:** `packages/main/src/modules/window-manager/WindowManager.ts` uses
  `BrowserWindow.getFocusedWindow()` (`:128`). Nothing sets a dock badge today.
- **Opening a surface from data:** `untypedOpenSurface(ref, event?)`, `@apackdev/sdk/fe`.
- **Terminal feeder:** what [the first goal](goal-terminal-program-status.md) adds to
  `packages/default-setup/src/features/code/be/services/terminal.ts` and `be/features/terminal.ts`: each
  terminal's status set, its seen mark, and the notification its frontend raises. The Code surface's
  inbox is `fe/contract.ts:143`; it has no event that shows one terminal by id.
- **Thread feeder:** an agent's request is a message with an input block, written by
  `sendBlockMessage` (`packages/default-setup/src/features/threads/be/services/chat.ts:80`). It is
  unanswered while the message has no `blockResponse`, which `updateMessageState` (`:228`) writes. The
  two agents post their requests from `src/content/actions/claude-code/_helpers/stream-consumer.ts`
  (`:450-501`) and `src/content/actions/codex/_helpers/stream-consumer.ts` (`:365-458`). Codex keeps the
  request it is waiting on in its thread state (`codex/_helpers/thread-context.ts:55` `pendingApproval`)
  and cancels it at `:144-164`. The Threads surface opens a thread on `SELECT_THREAD { id }`
  (`fe/contract.ts:116`).

## Decisions

- **D1. A host service, held in memory.** `services.attention` is a member of `HostRuntime.services`. Its
  items live in the API process and are not stored: each feeder says again what still holds when it
  starts. It is a host service because it has one identity per running app and every pack may feed it.
- **D2. Three operations, and what an item is.**

  ```ts
  export interface AttentionItem {
    /** Names the thing that needs the person; unique within the pack that raised it */
    readonly key: string
    readonly reason: 'permission' | 'question' | 'auth' | 'waiting' | 'done' | 'error'
    /** Who it is: "Terminal 2 — codex", "THR-12 — Fix the login bug" */
    readonly title: string
    /** One line of plain text saying what it needs, where the source gave one */
    readonly detail?: string
    /** When it began, in ms. Shown and sorted on; decides nothing */
    readonly since: number
    /** Differs each time the same key needs the person anew. One notification per key and occurrence */
    readonly occurrence: string
    /** Where it is: a surface the pack can name, and the event to hand it */
    readonly target: { readonly surface: string; readonly event?: { readonly type: string } & Record<string, unknown> }
  }

  export interface AttentionService {
    raise(item: AttentionItem): void
    settle(key: string): void
    /** Everything this pack holds under `prefix` becomes exactly `items` */
    replace(prefix: string, items: readonly AttentionItem[]): void
  }
  ```

  The service knows the calling pack, as `services.settings` does, and holds each item under
  `<packId>/<key>` with its target resolved to a ref. A pack cannot read or settle another's items.
  The three operations are one pure function in the SDK, which the host's service and the test
  runtime's both call, so they cannot drift.
- **D3. A feeder settles; the list never does.** An item leaves when its source says it no longer needs
  the person. Opening an item only takes the person there. A `done` or `error` item is settled by its
  feeder when the person arrives, and a waiting one when the source stops waiting.
- **D4. The shell shows the whole set.** The application system broadcasts every item on each change and
  on `SEND_STATE`, as it does its other state. A window keeps them in `HostShellState.attention`, and
  `useShell()` gives `attention`, `openAttention(key)` and `openNextAttention()`.
  Order: the waiting reasons first (`permission`, `question`, `auth`, `waiting`), longest-waiting first;
  then `error`; then `done`.
- **D5. One notifier, in main, for every source.** A window asks main for a notification for each key
  and occurrence it has not asked for. Main shows it only while no window of the app is focused, once
  per tag, and on a click focuses the window that asked and tells it to open the item. The first goal's
  notification in the Code feature's frontend is removed in the same change, with its setting; a bell's
  notification is not an item and stays as it is.
- **D6. The dock badge counts what is waiting.** The number of items with a waiting reason, set through
  main whenever the set changes. `done` and `error` are not counted.
- **D7. One hotkey.** `ApplicationHotkeys` gains `openNextAttention`, which opens the first item in D4's
  order. Default: `u` with the platform's command key and shift, unless the host's defaults already use
  it, in which case the next free letter, recorded in the evidence.
- **D8. Two settings, the app's.** `attention.notifications` and `attention.dockBadge`, both default on,
  in `AppSettings`, with the host's defaults and validation.
- **D9. The terminal feeder.** The Code feature's backend calls
  `replace('terminal/<terminalId>/', items)` whenever a terminal's status set or seen mark changes, and
  with nothing when the terminal closes:
  - a `blocked` record that is not `Mismatched` is an item whose reason is its kind, or `waiting`
    without one;
  - an unseen `done` or `error` record that is not `Mismatched` is an item;
  - `occurrence` is the record's `changed`; `since` is its `since_ms`; `detail` is its message;
  - the target is the Code surface with a new inbox event that shows that terminal.
- **D10. The thread feeder.** Raised where the message is written and settled where it is answered, in
  the Threads feature's chat service, so no action carries it:
  - a message holding an input block, written by an agent's turn, raises an item for its thread;
  - a response written to it, its cancellation, or its thread's deletion settles it;
  - reason: `permission` for an `approval` block, `question` for any other input block;
  - the target is the Threads surface with `SELECT_THREAD`;
  - nothing is raised while onboarding is not complete;
  - at start, items are raised again for the requests each agent's stored thread state still holds. If
    one agent's pending request cannot be read back at start, its items exist only for requests made in
    this run, and the evidence says so.
- **D11. Text is plain.** `title` and `detail` are drawn as text and never as markup.
- **D12. A pack that leaves takes its items.** When a pack is unregistered or its registration changes,
  the service drops what it raised. A feeder owns its items across a data replacement: it calls
  `replace` with what still holds.

## Phases

### Phase 1. The service

- `packages/apack-sdk/src/services/attention.ts`: the contract and the pure function.
  `HostServices.attention`, and the name in `_HOST_SERVICE_NAMES`.
- `packages/apack-host/src/services/attention.ts`: the app's, bound to its caller, with a host-only way
  to read every item and to hear a change. Assembled in `createHostRuntime`.
- The test runtime's, over the same function.
- D12's drop when a pack leaves.
- `npm run api:update`, and read the diff.

Tests: the three operations over the pure function, including `replace` leaving another prefix and
another pack alone; two packs using one key; a pack unregistered losing its items; a target naming a
surface the pack cannot name refused with a message that says which.

Done when: those pass and `npm run typecheck` passes.

### Phase 2. The list

- The application system hears the service change and broadcasts the set, and sends it on `SEND_STATE`.
- The shell machine holds it; `Shell` gains D4's three members.
- A control in the toolbar: the count of waiting items, and a popover listing every item in D4's order
  with its reason, title, detail and how long it has waited. Choosing one opens it.
- `openNextAttention` and its hotkey, by D7.

Tests: a shell-machine case for the set arriving and for the order; a component case for the control
with no items, with waiting items and with only `done` items; choosing an item sends its target; the
hotkey opens the first.

Done when: those pass.

### Phase 3. The notification and the badge

- Preload and main gain `attention.notify(title, body, tag, key)` and `attention.badge(count)`.
- Main: D5's rule and D6's count. A click focuses the asking window and sends it the key.
- The shell asks for a notification once per key and occurrence, and sets the badge on each change.
- D8's settings, in the app's Settings view.

Tests, in `packages/main/tests` beside `notify-access.spec.ts`: shown when no window is focused, not
shown when one is, once for one tag from two windows, a click focusing the asker and handing it the key,
the badge following the count. A shell case for one ask per occurrence and a second ask for a new one.

Done when: those pass.

### Phase 4. The feeders

First confirm [the first goal](goal-terminal-program-status.md)'s Phases 1 to 3 are merged.

- Add the Code surface inbox event that shows one terminal by id, and use it as the target.
- The terminal feeder, by D9. Remove the first goal's frontend notification and its
  `terminalStatusNotification` setting.
- Survey every place a thread agent's request is written, answered and cancelled, starting from the
  seams above, and record the list in the evidence. Then the thread feeder, by D10.
- `default-setup` names `attention` in `consumes.services`.

Tests: a terminal whose record becomes `blocked` raises one item and settles it when the record leaves
`blocked`; a `Mismatched` record raises none; an unseen `done` item settles when the terminal is looked
at; a closed terminal leaves none. An approval posted in a thread raises an item whose target selects
that thread; answering it settles it; cancelling it settles it; nothing is raised during onboarding.

Done when: those pass and `npm run spec` passes for the change.

### Phase 5. The real app

A script under `drive/`, with screenshots from `.apack/drive/screenshots/`.

Done when, recorded in the evidence:

- a terminal whose shell prints a blocked report appears in the list and in the count;
- a thread agent's approval appears beside it, and the two are ordered by how long they have waited;
- choosing each lands on that terminal and on that thread;
- the hotkey goes to the first;
- with the app not in front, one notification is raised for a new item, and clicking it lands on the
  item;
- the dock badge shows the count of waiting items and returns to none;
- a second window shows the same list, and settling in one empties both;
- restarting the API brings the same items back.

## Closing

- `npm run chain` passes on the final source, and one strict run is dispatched for it:
  `gh workflow run ci.yml --ref <branch> -f strict_chain=true`.
- The root `CLAUDE.md`'s list of host services names `attention`, and the pack-facing docs under
  `docs/public-facing/` say how a pack raises and settles an item.
- The pull request is opened ready for review.

## Constraints

- Standing rules are the repository's CLAUDE.md; this list adds only what is particular here.
- Nothing here types into a terminal or answers a request.
- No timer decides when an item is raised, shown or settled. `since` is shown and sorted on only.
- The service holds no knowledge of terminals or threads. A third feeder needs no change to it.

## Current handoff

- **Source:** nothing started. Monorepo `master` at `c7d4ec6ce5`.
- **Next:** Phase 1, which does not wait on the first goal.
- **Blocked:** Phase 4, until the first goal's Phases 1 to 3 are merged.
- **Proven:** nothing yet.
