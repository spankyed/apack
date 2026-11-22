# Flow Runtime

This document describes how apack executes flows at runtime. It covers the backend brain runtime, flow actors, step actors, trigger routing, schedules, run history, and completion semantics.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Flow blueprint | Persisted flow graph authored in the flows UI or imported from DSL. Contains trigger nodes, step nodes, and edges. |
| Flow actor | Runtime XState actor created for one executing flow instance. Root and spawned subflows each get their own actor. |
| Step actor | Runtime XState actor created for one executing step node. |
| RunNode | A run node: the run history's record (`services.runHistory`) of a flow, trigger event, or step execution, linked to the node it ran under by `parentId`. A kill or restart marks a session's running nodes `stopped` and keeps them; the history keeps 30 days of runs. |
| Event track | One fired trigger plus the downstream step chain spawned from it. |
| Trigger node | A `listener` or `schedule` node. Trigger nodes do not execute as steps. |
| Flow node | A step node whose `nodeType` is `flow`; when executed, it spawns a child flow actor. |

## Main Runtime Pieces

| File | Responsibility |
| --- | --- |
| `packages/default-setup/src/features/brain/be/system.ts` | Owns the brain system, starts/stops the root flow actor, routes incoming events, forwards run node updates to the frontend. |
| `packages/default-setup/src/features/brain/be/flow-system.ts` | Builds one flow actor for a root flow or spawned subflow, registers listeners/schedules, spawns step and child-flow actors, handles completion. |
| `packages/default-setup/src/features/brain/be/step-system.ts` | Builds one step actor, creates the step RunNode, calls the node handler, reports completion/failure to the parent flow actor. |
| `packages/default-setup/src/features/brain/be/execute-step.ts` | `executeStep`: runs the step type's registered runtime handler on the step's `StepInput` (`extensions/steps/<type>/runtime.ts` or its `index.ts`); a type without one completes with `{ executed: true }`. |
| `packages/default-setup/src/features/brain/be/flow-completion.ts` | Centralizes flow completion rules. |
| `packages/default-setup/src/features/brain/be/services/scheduler.ts` | Owns active Croner jobs for schedule nodes. |
| `packages/apack-sdk/src/events/index.ts` (`tell`) | Sends `TRIGGER_BRAIN_EVENT` to the system playing the brain role (`tell({ role: 'brain' }, …)`, and `services.emitter.tell` from actions). |

## Brain Lifecycle

The brain system starts in `running` and creates the root flow actor on entry.

1. On app startup, the brain ensures there is a root flow role if flows exist.
2. `START_BRAIN` or entering `running` calls `startBrain`.
3. `startBrain` calls `createFlowNodeSystem()` with no flow id, which creates the session's root flow RunNode (a new one each start, held as `rootRunId`) and root flow actor.
4. The root flow actor enters `active`, registers itself in the flow actor registry, registers schedule jobs for its schedule nodes, then raises `flow.entry`.
5. `KILL_BRAIN` stops the root actor, marks the session's running RunNodes `stopped`, removes ad-hoc listeners, clears all cron schedules, clears the flow actor registry, and notifies the frontend.
6. `RESTART_BRAIN` does the same cleanup and then starts a fresh root flow actor.

When the root flow actor completes naturally, it sends `CHILD_COMPLETED` to the brain system. The brain treats that as root completion and kills the brain.

## Flow Actor Creation

`createFlowNodeSystem()` has two modes:

| Mode | Input | Behavior |
| --- | --- | --- |
| Root flow | No `flowId` | Uses the configured root flow, creates a root flow RunNode, and starts from that blueprint. |
| Spawned subflow | Flow-step node id | Creates a flow RunNode for that flow-step execution, resolves the referenced `flowRef`, and uses the referenced flow blueprint as the child actor's `actualFlowId`. |

The distinction matters: a flow-step node is the parent graph node that launches a child flow, while `flowRef` is the child blueprint to execute. Runtime schedule/listener lookup must use the referenced child flow id, not the flow-step node id.

Every active flow actor is registered by runtime flow RunNode id. The registry is used for event routing:

- global events broadcast to all registered flow actors.
- local events target one specific flow actor by flow RunNode id.
- schedule callbacks target the owning flow actor by flow RunNode id.

## Trigger Nodes

Flow actors gather trigger nodes from the active flow blueprint:

- `listener` nodes come from `flowEventNodes(actualFlowId)`.
- `schedule` nodes come from `flowScheduleNodes(actualFlowId)`.

Both are normalized into runtime trigger handlers. Listener event types are their configured `eventType`. Schedule event types are synthetic: `schedule.${scheduleNodeId}`.

Trigger nodes are not executable step nodes. When a trigger fires, the flow actor creates an event RunNode and spawns the first downstream steps connected to that trigger.

## Listener Scopes

Listener scope controls how events can reach the flow actor.

| Scope | Runtime meaning |
| --- | --- |
| `entry` | Handles the internally raised `flow.entry` event when a flow actor starts. |
| `global` | Handles matching global events broadcast to every registered flow actor. |
| `local` | Handles matching events sent directly to this flow actor's runtime flow RunNode id. |

Important subflow behavior:

- A spawned subflow with only a `global` or `local` listener starts and waits.
- It does not complete immediately just because there is no entry track.
- When the listener receives one matching event, the listener track runs.
- After that track drains, the subflow completes and the parent flow continues.

So listener-only subflows are one-shot waits. They are not persistent subscriptions.

`local` listener-only subflows are easy to misuse. A local fire targets the current execution context's flow actor. If a parent flow fires a local event, it targets the parent actor, not a child subflow actor. A local listener inside a waiting child subflow needs an event targeted to that child flow RunNode id.

## Schedule Triggers

Schedule nodes register Croner jobs when their owning flow actor enters `active`.

The scheduler key is `${flowRunNodeId}:${scheduleNodeId}`. On each tick, the cron callback sends a synthetic event to the brain system:

```ts
tell({ role: 'brain' }, {
  type: 'TRIGGER_BRAIN_EVENT',
  eventType: `schedule.${scheduleNodeId}`,
  targetFlowId: flowRunNodeId,
})
```

That means schedule ticks are routed as local events to the owning flow actor. They then use the same event-track execution path as listener triggers.

Schedules are actor-scoped, not global blueprint subscriptions. A schedule exists only while its flow actor is running. Root flow schedules are active while the brain is running. Subflow schedules are active only after a parent flow spawns that subflow actor.

## Event Routing

The brain receives `TRIGGER_BRAIN_EVENT` and converts it into `HANDLE_BRAIN_EVENT`.

If the event has `targetFlowId`, the brain looks up that specific flow actor and sends the event only there. This is local routing.

If the event has no `targetFlowId`, the brain broadcasts it to every registered flow actor. This is global routing.

The frontend also gets an `EVENT_PULSE` for routed events. Ad-hoc listeners are notified after normal flow routing.

## Event Track Execution

When a flow actor receives an event matching one or more trigger nodes:

1. If the brain is paused, the raw event is stored in `pendingEvents`.
2. The actor finds all trigger nodes in that flow with the matching event type.
3. For each matching trigger, it queries all downstream first steps.
4. It creates an event RunNode under the flow RunNode.
5. It stores the event payload on the event RunNode.
6. It creates an execution context for that event track.
7. It spawns all connected downstream first steps in parallel.
8. It records the event track's live child count.

Each spawned child is either:

- a step actor for normal step nodes, or
- a flow actor for `flow` step nodes.

## Step Execution

A step actor:

1. Creates a step RunNode under the event RunNode or previous step RunNode.
2. Calls `executeStep()`.
3. The node handler performs the work and sends `COMPLETE` or `ERROR` to its actor.
4. On completion, the step actor stores the result, marks the RunNode completed, emits `RUN_NODE_UPDATED`, and sends `CHILD_COMPLETED` to the parent flow actor.
5. On failure, the step actor marks the RunNode failed and still sends `CHILD_COMPLETED` with an error result.

`executeStep()` dispatches by node type. `schedule` nodes are safety-net completed if accidentally executed as steps, but schedules should only act as triggers.

## Continuing A Track

When a child completes, the parent flow actor decides whether to spawn a next node in the same event track:

- If the child result has `sourceHandle`, the next node is resolved from that branch handle.
- If the child result has `noMatch: true`, the branch terminates.
- Otherwise, the actor follows the normal next edge in the track.

The actor decrements the live child count for the completed child and increments it if a next node is spawned. When a track's count reaches zero, its event RunNode is marked completed.

## Flow Completion

Flow completion has two paths:

| Completion path | Behavior |
| --- | --- |
| Explicit final | If a child completes with `final: true`, the flow completes even if it has persistent triggers. |
| Natural completion | If all active event tracks drain and the flow has no persistent triggers, the flow completes. |

Schedule-triggered flows are persistent. They do not complete just because a scheduled track drains; they stay active for future ticks. They still complete on explicit final completion or kill.

Listener-only flows are finite. A `global` or `local` listener-only subflow waits for one matching event, runs that track, completes, and then notifies its parent.

Entry-only flows are also finite. They run from `flow.entry` and complete when active tracks drain.

When a flow completes, it:

1. Marks the flow RunNode completed.
2. Stores the final result if one exists.
3. Emits `RUN_NODE_UPDATED`.
4. Sends `CHILD_COMPLETED` to its parent.
5. Unregisters its flow actor.
6. Unregisters schedules for that flow actor.

For the root flow, parent notification goes to the brain system, which kills the brain.

## Pause And Resume

Pause is a global runtime flag set by the brain system.

While paused:

- incoming trigger events are appended to the flow actor's `pendingEvents`.
- next-step spawning after a child completion is appended to `pendingNextSteps`.

On resume, the flow actor:

1. Spawns deferred next steps.
2. Replays deferred events into itself.
3. Clears pending queues.

Brain kill and restart clear the event queue, pending runtime actors, schedules, and actor registry, and mark what the session was running as `stopped` in the run history (`services.runHistory`), which keeps it.

## Run Data

The runtime tells every window about run nodes as a feed:

- `RUN_NODE_SPAWNED` when flow, event, or step run nodes are created in the run history.
- `RUN_NODE_UPDATED` when RunNodes complete or fail.

A window asks for the rest, and the brain answers it alone (the brain's `asks`): `REQUEST_SURFACE_DATA` for a run's
tree with the brain's state, `OPEN_RUN_NODE` and `GO_BACK_RUN_NODE` for a flow run's, and `GET_RUN_NODE_DETAILS` for
the details panel.

Run hierarchy:

```text
flow RunNode
  event RunNode
    step RunNode
    child flow RunNode
      event RunNode
        step RunNode
```

Event RunNodes represent fired listener or schedule triggers. Schedule event RunNodes use `triggerType: 'schedule'` and carry the schedule cron expression for UI rendering.

## DSL Runtime Mapping

The flow DSL compiles tracks into trigger nodes and step chains.

- `track.event` creates a listener node.
- `track.schedule` creates a schedule node.
- If the first DSL track is an event track, its listener is marked as the entry listener.
- If the first DSL track is a schedule track, no entry listener is assigned for that track.
- Non-first DSL event tracks compile as `global` listeners.
- Schedule tracks do not get the entry role.
- Each `exits` array creates independent downstream chains from the trigger.

At runtime, the compiled graph is executed through the same flow actor machinery as UI-authored graphs.

## Operational Rules

- A flow actor must be running for its listeners and schedules to be active.
- Root schedules are active while the brain is running.
- Subflow schedules are active only while the spawned subflow actor is running.
- Schedule flows remain alive across ticks.
- Listener-only subflows are one-shot waits.
- Local events target a runtime flow RunNode id, not a blueprint flow id.
- Global events broadcast to all registered runtime flow actors.
- Completing the root flow kills the brain.
- Killing or restarting the brain marks the session's running nodes `stopped` and clears schedules, ad-hoc listeners, and actor registry entries.
