import { assign, enqueueActions, setup, type ActorRefFrom } from 'xstate';
import { makes, safeEvents, type MadeEvent, type Making } from '@apackdev/sdk/fe';
import type { SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { breadcrumbList } from '@apackdev/sdk/fe';
import { contextMenuFn } from '@apackdev/sdk/fe';
import { Activity, Play, RefreshCw, Power, PlayCircle, Pause } from 'lucide-vue-next';
import { targetIs, type TrailClickEvent } from '@apackdev/sdk/fe';
import type { BrainContext } from './contract.ts';
import type { BrainStateEvent, OutgoingBrainEvents } from '#features/brain/be/types.ts'
import type { FlowRunNodeData } from '#generated/types.ts';
import { fromAsk, tell } from '#generated/events.ts';
import type { StepRuntimeError, RunTree } from '@apackdev/sdk/steps';
import {
  applyRunNodeSpawn,
  denormalizeRunNodeTree,
  normalizeRunNodeTree,
  type NormalizedRunNodeTree,
} from './run-tree.ts';

export const id = 'brain' as const;
export type BrainState = ActorRefFrom<typeof brainState>


type SystemEvent = OutgoingBrainEvents
  | { type: 'INSPECT_TOGGLED'; enabled: boolean }
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: any }
  | { type: 'BRAIN_PAUSED' }
  | { type: 'BRAIN_RESUMED' }
  | { type: 'BRAIN_RUNTIME_ERROR'; error: StepRuntimeError }

type UIEvent =
  | { type: 'NODE.CLICK'; nodeId: string }
  | { type: 'SELECT_AND_SHOW_FIRST_NODE' }
  | { type: 'FLOW.NAVIGATE'; runNodeId: string }
  | { type: 'BACK.CLICK' }
  | { type: 'EVENT.CLICK'; eventType: string }
  | { type: 'TOGGLE_LEFT_PANEL' }
  | { type: 'CLOSE_DETAILS' }
  | { type: 'TOGGLE_INSPECT' }
  | { type: 'TOGGLE_ANIMATIONS' }
  | { type: 'RESTART_BRAIN' }
  | { type: 'KILL_BRAIN' }
  | { type: 'PAUSE_BRAIN' }
  | { type: 'RESUME_BRAIN' }
  | { type: 'DISMISS_RUNTIME_ERROR' }
  // The event pulse's animation ended
  | { type: 'CLEAR_PULSE' }

type SurfaceEvent = SurfaceLifecycleEvent

/** The asks the machine makes beside the ones a state invokes: the selected node's details, one at a time */
const made = makes(({ one }) => ({ details: one(fromAsk('brain', 'GET_RUN_NODE_DETAILS')) }))

/** The surface's state as its machine holds it: what it publishes, and which of its asks are under way */
type MachineContext = BrainContext & { making: Making<typeof made> }

export type BrainEvents = UIEvent | SystemEvent | SurfaceEvent | TrailClickEvent | MadeEvent<typeof made>

const typeOf = safeEvents<BrainEvents>()

function brainStateContext({ rootFlowId, startError, paused, inspectEnabled }: BrainStateEvent) {
  return { brainIsDead: !rootFlowId, startError, runningRootFlowId: rootFlowId, brainIsPaused: paused, inspectEnabled }
}

/** The first node of the tree that is not one of its roots */
function firstChildNode(context: BrainContext): string | undefined {
  const byId = context.normalizedTree?.byId;
  if (!byId) return undefined;
  const rootIds = context.normalizedTree?.rootIds || [];
  return Object.keys(byId).find((nodeId) => !rootIds.includes(nodeId));
}

function normalizeFlowRunNodeData(data: FlowRunNodeData): {
  normalizedTree?: NormalizedRunNodeTree;
  runNodeTree?: RunTree[];
} {
  if (!data.runNodeTree) {
    return { normalizedTree: undefined, runNodeTree: undefined };
  }

  const normalizedTree = normalizeRunNodeTree(data.runNodeTree);
  return {
    normalizedTree,
    runNodeTree: denormalizeRunNodeTree(normalizedTree),
  };
}

/** The tree of a flow run, as the context holds it */
function runContext(data: FlowRunNodeData) {
  const { normalizedTree, runNodeTree } = normalizeFlowRunNodeData(data);
  return {
    flowRunNodeId: data.flowRunNodeId,
    runNodeTree,
    normalizedTree,
    possibleEvents: data.possibleEvents,
    flowHierarchy: data.flowHierarchy || [],
  };
}

/**
 * What an answered tree puts in the context: the tree, unless the brain is stopped, and then the brain's state it was
 * answered with, which a window just started has not heard yet
 */
function answeredTree(context: BrainContext, { data, state }: { data: FlowRunNodeData; state: BrainStateEvent }) {
  return { ...(context.brainIsDead ? {} : runContext(data)), ...brainStateContext(state) };
}

/** The flow run a breadcrumb names, where it names one */
const trailFlow = (target: string): string | undefined => (target.startsWith('flow:') ? target.substring(5) : undefined);

const brainState = setup({
  types: {
    context: {} as MachineContext,
    events: {} as BrainEvents,
  },
  actors: {
    /** The tree of the flow this window shows, or the root run's; the system answers this window alone */
    surfaceData: fromAsk('brain', 'REQUEST_SURFACE_DATA'),
    openRun: fromAsk('brain', 'OPEN_RUN_NODE'),
    goBack: fromAsk('brain', 'GO_BACK_RUN_NODE'),
    ...made.actors,
  },
  actions: {
    addRunNodeToTree: assign(({ context, event }) => {
      if (event.type !== 'RUN_NODE_SPAWNED') return {};

      const { runNode, parentId, flowRunNodeId } = event;

      // Filter: Only accept RunNode spawns for the currently viewed flow
      // This prevents subflow internal events from appearing in parent flow view
      if (flowRunNodeId !== context.flowRunNodeId) {
        return {};
      }

      const newTree = applyRunNodeSpawn(context.normalizedTree, runNode, parentId, context.flowRunNodeId);

      // Update denormalized tree as well
      const denormalizedTree = denormalizeRunNodeTree(newTree);

      return {
        normalizedTree: newTree,
        runNodeTree: denormalizedTree
      };
    }),
    updateRunNodeInTree: assign(({ context, event }) => {
      if (event.type !== 'RUN_NODE_UPDATED') return {};

      const { data } = event;
      const { runNodeId, status } = data;

      if (!context.normalizedTree || !context.normalizedTree.byId[runNodeId]) {
        return {};
      }

      // Clone the normalized tree
      const newTree = {
        byId: { ...context.normalizedTree.byId },
        rootIds: [...context.normalizedTree.rootIds],
        childrenById: { ...context.normalizedTree.childrenById }
      };

      // Update the node status
      newTree.byId[runNodeId] = {
        ...newTree.byId[runNodeId],
        status
      };

      // Update denormalized tree
      const denormalizedTree = denormalizeRunNodeTree(newTree);

      return {
        normalizedTree: newTree,
        runNodeTree: denormalizedTree
      };
    }),
    pulseEvent: assign(({ event }) => {
      if (event.type !== 'EVENT_PULSE') return {};
      return {
        pulsingEventType: event.eventType
      };
    }),
    clearPulse: assign({
      pulsingEventType: undefined
    }),
    /** Clears the pulse once its animation has had its time */
    schedulePulseEnd: ({ self }) => {
      setTimeout(() => {
        self.send({ type: 'CLEAR_PULSE' });
      }, 400);
    },
    toggleLeftPanel: assign({
      showLeftPanel: ({ context }) => !context.showLeftPanel
    }),
    /**
     * Selects the node whose details are about to be asked for, by its id alone, so the panel and the canvas
     * highlight show it at once: a click's, the first node of the tree, or the node a step's error names.
     * `readingDetails` asks about whatever is selected, so every transition into it selects first.
     */
    selectNode: assign(({ context, event }) => {
      const nodeId = event.type === 'NODE.CLICK' ? event.nodeId
        : event.type === 'BRAIN_RUNTIME_ERROR' ? event.error.runNodeId
        : firstChildNode(context);
      return nodeId ? { selectedStepNode: { id: nodeId } as any } : {};
    }),
    /** Gives up the ask for details, where one is under way */
    forgetDetails: enqueueActions(({ context, enqueue }) => made.drop(enqueue, context, 'details')),
    /** Asks for the selected node's details, in place of any ask for them under way */
    askDetails: enqueueActions(({ context, enqueue }) => {
      if (context.selectedStepNode) made.make(enqueue, 'details', { runNodeId: context.selectedStepNode.id })
      else made.drop(enqueue, context, 'details')
    }),
    closeDetails: assign({
      selectedStepNode: undefined
    }),
    toggleInspect: () => {
      tell(id, {
        type: 'TOGGLE_INSPECT',
      });
    },
    setInspectEnabled: assign(({ event }) => {
      if (event.type !== 'INSPECT_TOGGLED') return {};
      return {
        inspectEnabled: event.enabled
      };
    }),
    toggleAnimations: assign({
      animationsEnabled: ({ context }) => !context.animationsEnabled
    }),
    updateSettings: assign(({ event }) => {
      const typedEv = typeOf('FEATURE_SETTINGS_UPDATED', event);
      return {
        settings: typedEv.settings
      };
    }),
    setBrainKilled: assign({
      brainIsDead: true,
      startError: ({ event }) => typeOf('BRAIN_KILLED', event).startError,
      runningRootFlowId: undefined,
      brainIsPaused: false,
      possibleEvents: [],
      flowHierarchy: [],
      selectedStepNode: undefined,
    }),
    setBrainState: assign(({ event }) => {
      return brainStateContext(typeOf('BRAIN_STATE', event));
    }),
    setBrainStarted: assign({
      brainIsDead: false,
      startError: undefined,
      runningRootFlowId: ({ event }) => typeOf('BRAIN_STARTED', event).rootFlowId,
      brainIsPaused: false,
    }),
    setBrainPaused: assign({
      brainIsPaused: true,
    }),
    setBrainResumed: assign({
      brainIsPaused: false,
    }),
    addRuntimeError: assign(({ context, event }) => {
      if (event.type !== 'BRAIN_RUNTIME_ERROR') return {};
      const runtimeErrors = [event.error, ...context.runtimeErrors].slice(0, 25);
      return {
        latestRuntimeError: event.error,
        runtimeErrors,
      };
    }),
    dismissRuntimeError: assign({
      latestRuntimeError: undefined,
    }),
    pauseBrain: () => {
      tell(id, {
        type: 'PAUSE_BRAIN',
      });
    },
    resumeBrain: () => {
      tell(id, {
        type: 'RESUME_BRAIN',
      });
    },
    restartBrain: ({ context }) => {
      if (context.brainIsDead) tell(id, { type: 'START_BRAIN' });
      else tell(id, { type: 'RESTART_BRAIN' });
    },
    killBrain: () => {
      tell(id, {
        type: 'KILL_BRAIN',
      });
    },
  },
  guards: {
    targetIs,
    /** A breadcrumb back to the root run */
    trailToRoot: ({ event }) => typeOf('TRAIL_CLICK', event).target === 'root',
    /** A breadcrumb to a flow run other than the one shown */
    trailToAnotherFlow: ({ context, event }) => {
      const flowRunNodeId = trailFlow(typeOf('TRAIL_CLICK', event).target);
      return flowRunNodeId !== undefined && flowRunNodeId !== context.flowRunNodeId;
    },
    hasChildNode: ({ context }) => {
      if (firstChildNode(context) !== undefined) return true;
      console.warn('No child nodes available in brain');
      return false;
    },
    errorNamesNode: ({ event }) => Boolean(typeOf('BRAIN_RUNTIME_ERROR', event).error.runNodeId),
    updatesSelectedNode: ({ context, event }) => context.selectedStepNode?.id === typeOf('RUN_NODE_UPDATED', event).data.runNodeId,
  },
}).createMachine({
  id,
  context: {
    making: made.none(),
    possibleEvents: [],
    flowHierarchy: [],
    showLeftPanel: false,
    inspectEnabled: false,
    animationsEnabled: true,
    selectedStepNode: undefined,
    brainIsDead: false, // Start as running to prevent flash of dead UI
    brainIsPaused: false,
    latestRuntimeError: undefined,
    runtimeErrors: [],
  },
  initial: 'loading',
  on: {
    [made.done]: { actions: made.settle() },
    BRAIN_STATE: { actions: 'setBrainState' },
    // Inspect mode is the feature's rather than a run's, and a panel beside another surface shows by it, so a toggle
    // and what it became are taken before this surface's first tree as after it
    TOGGLE_INSPECT: { actions: 'toggleInspect' },
    INSPECT_TOGGLED: { actions: 'setInspectEnabled' },
  },
  states: {
    // No tree yet. The first is asked for where a delivery names the surface: as the shell starts it
    loading: {
      initial: 'unasked',
      on: {
        SURFACE_STARTED: { target: '.reading', reenter: true },
        BRAIN_RUNTIME_ERROR: {
          actions: 'addRuntimeError'
        },
        DISMISS_RUNTIME_ERROR: {
          actions: 'dismissRuntimeError'
        }
      },
      states: {
        unasked: {},
        reading: {
          invoke: {
            src: 'surfaceData',
            input: {},
            onDone: [
              {
                guard: ({ event }) => event.output.ok,
                target: '#brain.ready',
                actions: assign(({ context, event }) => (event.output.ok ? answeredTree(context, event.output.value) : {})),
              },
              // A tree that could not be read is asked for again when the surface is next started
              { target: 'unasked' },
            ],
          },
        },
      },
    },
    ready: {
      initial: 'shown',
      meta: {
        ...breadcrumbList<BrainContext>((ctx) =>
          !ctx.flowHierarchy?.length
            ? [{ label: 'Brain', target: 'root' }]
            : ctx.flowHierarchy.map((flow, i) => ({
                label: i === 0 ? 'Brain' : flow.label,
                target: `flow:${flow.flowRunNodeId}`
              }))
        ),
        ...contextMenuFn<BrainContext>((ctx) => [
          { label: 'Watched Events', icon: Activity, event: { type: 'TOGGLE_LEFT_PANEL' }, isActive: ctx.showLeftPanel, iconColor: 'text-primary-400' },
          { label: 'Auto-focus Animations', icon: Play, event: { type: 'TOGGLE_ANIMATIONS' }, isActive: ctx.animationsEnabled, iconColor: 'text-blue-400' },
          ...(ctx.brainIsDead
            ? [{ separator: true, label: 'Start Brain', icon: PlayCircle, event: { type: 'RESTART_BRAIN' as const }, iconColor: 'text-green-400' }]
            : [
                ...(ctx.brainIsPaused
                  ? [{ separator: true, label: 'Resume Brain', icon: PlayCircle, event: { type: 'RESUME_BRAIN' as const }, iconColor: 'text-green-400' }]
                  : [{ separator: true, label: 'Pause Brain', icon: Pause, event: { type: 'PAUSE_BRAIN' as const }, iconColor: 'text-yellow-400' }]
                ),
                { label: 'Restart Brain', icon: RefreshCw, event: { type: 'RESTART_BRAIN' as const }, iconColor: 'text-amber-400' },
                { label: 'Kill Brain', icon: Power, event: { type: 'KILL_BRAIN' as const }, iconColor: 'text-red-400' },
              ]
          ),
        ]),
      },
      on: {
        'EVENT.CLICK': {
        },
        TOGGLE_LEFT_PANEL: {
          actions: 'toggleLeftPanel'
        },
        TOGGLE_ANIMATIONS: {
          actions: 'toggleAnimations'
        },
        SURFACE_DEACTIVATED: {
          // No action needed for deactivation
        },
        RUN_NODE_SPAWNED: {
          actions: 'addRunNodeToTree'
        },
        CLEAR_PULSE: {
          actions: 'clearPulse'
        },
        FEATURE_SETTINGS_UPDATED: {
          actions: 'updateSettings'
        },
        RESTART_BRAIN: {
          actions: 'restartBrain'
        },
        KILL_BRAIN: {
          actions: 'killBrain'
        },
        PAUSE_BRAIN: {
          actions: 'pauseBrain'
        },
        RESUME_BRAIN: {
          actions: 'resumeBrain'
        },
        BRAIN_PAUSED: {
          actions: 'setBrainPaused'
        },
        BRAIN_RESUMED: {
          actions: 'setBrainResumed'
        },
        DISMISS_RUNTIME_ERROR: {
          actions: 'dismissRuntimeError'
        },
        // The tree this window shows. One ask for it at a time: a newer one gives up the one under way, and each is
        // made in the delivery of the event that wants it, since an ask from a timer could not be answered
        SURFACE_STARTED: { target: '.reading', reenter: true },
        SURFACE_ACTIVATED: { target: '.reading', reenter: true },
        // The event's runs arrive as the run's feed (RUN_NODE_SPAWNED); the tree is asked for again as well
        EVENT_PULSE: { target: '.reading', reenter: true, actions: ['pulseEvent', 'schedulePulseEnd'] },
        // News of a start: the new run's tree is the root's
        BRAIN_STARTED: { target: '.reading', reenter: true, actions: 'setBrainStarted' },
        'FLOW.NAVIGATE': { target: '.opening', reenter: true },
        'BACK.CLICK': { target: '.goingBack', reenter: true },
        TRAIL_CLICK: [
          { guard: 'trailToRoot', target: '.goingBack', reenter: true },
          { guard: 'trailToAnotherFlow', target: '.opening', reenter: true },
        ],
        // The selected node's details are asked for by a spawned ask. Selecting another node stops the one under way,
        // and a stopped ask ends in no event, so an answer is always for the node the view is on
        'NODE.CLICK': { actions: ['selectNode', 'askDetails'] },
        SELECT_AND_SHOW_FIRST_NODE: { guard: 'hasChildNode', actions: ['selectNode', 'askDetails'] },
        // A step's error opens the failing node's details; one that names no node leaves the selection alone
        BRAIN_RUNTIME_ERROR: [
          { guard: 'errorNamesNode', actions: ['addRuntimeError', 'selectNode', 'askDetails'] },
          { actions: 'addRuntimeError' },
        ],
        // The selected node changed, so its details are read again
        RUN_NODE_UPDATED: [
          { guard: 'updatesSelectedNode', actions: ['updateRunNodeInTree', 'askDetails'] },
          { actions: 'updateRunNodeInTree' },
        ],
        CLOSE_DETAILS: { actions: ['forgetDetails', 'closeDetails'] },
        BRAIN_KILLED: { actions: ['forgetDetails', 'setBrainKilled'] },
        'made.details': {
          // Details that could not be read leave the node selected by its id
          actions: assign(({ event }) => (event.outcome.ok ? { selectedStepNode: event.outcome.value.details || undefined } : {})),
        },
      },
      states: {
        shown: {},
        reading: {
          invoke: {
            src: 'surfaceData',
            // The flow shown, or the root run's for a run that just started
            input: ({ context, event }) => (event.type !== 'BRAIN_STARTED' && context.flowRunNodeId ? { flowRunNodeId: context.flowRunNodeId } : {}),
            onDone: {
              target: 'shown',
              actions: assign(({ context, event }) => (event.output.ok ? answeredTree(context, event.output.value) : {})),
            },
          },
        },
        // Going into a flow run. The run it opens is the tree to show, so the tree is not asked for again meanwhile
        opening: {
          invoke: {
            src: 'openRun',
            input: ({ event }) => ({
              runNodeId: event.type === 'FLOW.NAVIGATE' ? event.runNodeId : trailFlow(typeOf('TRAIL_CLICK', event).target)!,
            }),
            onDone: {
              target: 'shown',
              actions: assign(({ event }) => (event.output.ok ? runContext(event.output.value.data) : {})),
            },
          },
          on: {
            SURFACE_ACTIVATED: {},
            EVENT_PULSE: { actions: ['pulseEvent', 'schedulePulseEnd'] },
          },
        },
        // Going back out to the flow that ran the one shown, or to the root run from a breadcrumb
        goingBack: {
          invoke: {
            src: 'goBack',
            input: ({ context, event }) => (event.type === 'BACK.CLICK' ? { currentFlowRunNodeId: context.flowRunNodeId } : {}),
            onDone: {
              target: 'shown',
              actions: assign(({ event }) => (event.output.ok ? runContext(event.output.value.data) : {})),
            },
          },
          on: {
            SURFACE_ACTIVATED: {},
            EVENT_PULSE: { actions: ['pulseEvent', 'schedulePulseEnd'] },
          },
        },
      },
    }
  },
});

export default brainState;
