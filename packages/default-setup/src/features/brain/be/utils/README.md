# Brain backend

How the brain runs flows. Files are relative to `features/brain/be/`.

## Layout

```
be/
├── system.ts               # The brain system: starts/stops the root flow, routes TRIGGER_BRAIN_EVENT, pause and inspect toggles
├── flow-system.ts          # createFlowNodeSystem(): one `@apackdev/state` machine per running flow (root or subflow), and the flow registry
├── step-system.ts          # createStepNodeSystem(): one machine per step run, which calls executeStep and stores the result
├── flow-completion.ts      # When a flow completes (isPersistentTriggerFlow, shouldCompleteFlow)
├── trigger-dedupe.ts       # Keeps one trigger node per track key when a flow machine is created, warning about the rest
├── execute-step.ts         # executeStep(): runs a step's registered runtime handler on its StepInput
├── step-input.ts           # prepareStepInput(): a step's settings and params, with its field mappings resolved from the event and earlier steps
├── repository/
│   └── index.ts            # brainQueries/brainCommands: each run's flow, event and step nodes and their results, in `services.runHistory` (which caps values with `truncateResult`)
├── services/
│   ├── brain.ts            # services.brain: ad-hoc event listeners (listen/unlisten); notify, removeAllListeners for the pack
│   └── scheduler.ts        # services.scheduler: cron jobs for schedule triggers
├── types.ts
└── utils/
    ├── brain-inspect.ts    # brainLogger; its debug messages follow the `brain` debug toggle the brain system sets
    └── brain-pause.ts      # The paused flag (setBrainPausedState, isBrainPaused)
```

`utils/prompt-context-example.md` is a separate note on prompts that call other prompts.

## How a flow runs

1. The brain system runs the flow with the root role (`repository.flowsQueries.rootFlow()`). With flows but no root flow it stays stopped and reports why.
2. `createFlowNodeSystem()` creates the flow's RunNode and a machine that listens for the event types of the flow's trigger nodes. Running flow actors are kept by flow RunNode id (`getFlowActor`, `clearFlowActorRegistry`, which the pack's `onShutdown` calls).
3. An event spawns a track: `createStepNodeSystem()` for each step, and a nested flow machine for a subflow. The brain sends `RUN_NODE_SPAWNED` and `RUN_NODE_UPDATED` to the brain surface as RunNodes start and change status.
4. A step machine calls `executeStep()`, which looks up `stepRegistry.get(node.nodeType).runtime.handler`. Trigger nodes and types without a handler complete with no work. An async handler's rejection is reported with `reportError` (with `step` context) and fails the step.
5. Step results and run node attributes pass through `truncateResult` as the run history stores them (`services.runHistory`'s `start` and `update`).

## Adding a node type

Node types are steps, not brain code. Declare a step under `extensions.steps` in `apack.json`: inline node and frontend data, explicit build/runtime bindings and a types module. See the "Flow steps" section of `packages/default-setup/CLAUDE.md`.
