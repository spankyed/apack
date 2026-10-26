import { assign, setup, type ActorRefFrom } from 'xstate';
import { safeEvents } from '@apackdev/sdk/fe';
import type { SurfaceLifecycleEvent } from '@apackdev/sdk/fe'
import { breadcrumbList } from '@apackdev/sdk/fe';
import { contextMenuFn } from '@apackdev/sdk/fe';
import { Activity, Play, RefreshCw, Power, PlayCircle, Pause } from 'lucide-vue-next';
import { targetIs, type TrailClickEvent } from '@apackdev/sdk/fe';
import type { BrainContext } from './contract.ts';
import type { OutgoingBrainEvents } from '#features/brain/be/types.ts'
import type { FlowRunNodeData } from '#generated/types.ts';
import { sendToSystem } from '#generated/events.ts';
import type { StepRuntimeError, RunNode, RunTree } from '@apackdev/sdk/steps';
import {
  applyRunNodeSpawn,
  denormalizeRunNodeTree,
  normalizeRunNodeTree,
  type NormalizedRunNodeTree,
} from './run-tree.ts';

export const id = 'brain' as const;
export type BrainState = ActorRefFrom<typeof brainState>


type SystemEvent = OutgoingBrainEvents
  | { type: 'RUN_NODE_DETAILS'; runNodeId: string; details: RunNode | null }
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

export type BrainEvents = UIEvent | SystemEvent | SurfaceEvent | TrailClickEvent
const typeOf = safeEvents<BrainEvents>()

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

const brainState = setup({
  types: {
    context: {} as BrainContext,
    events: {} as BrainEvents,
  },
  actors: {},
  actions: {
    setBrainData: assign(({ context, event }) => {
      if (context.brainIsDead) return {};
      const typedEv = typeOf('RECEIVE_SURFACE_DATA', event);
      const { normalizedTree, runNodeTree } = normalizeFlowRunNodeData(typedEv.data);
      return {
        flowRunNodeId: typedEv.data.flowRunNodeId,
        runNodeTree,
        normalizedTree,
        possibleEvents: typedEv.data.possibleEvents,
        flowHierarchy: typedEv.data.flowHierarchy || [],
      };
    }),
    setRunNodeData: assign(({ event }) => {
      const typedEv = typeOf('RUN_NODE_OPENED', event);
      const { normalizedTree, runNodeTree } = normalizeFlowRunNodeData(typedEv.data);
      return {
        flowRunNodeId: typedEv.data.flowRunNodeId,
        runNodeTree,
        normalizedTree,
        possibleEvents: typedEv.data.possibleEvents,
        flowHierarchy: typedEv.data.flowHierarchy || [],
      };
    }),
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
    refreshNodeDetailsIfSelected: ({ context, event }) => {
      if (event.type !== 'RUN_NODE_UPDATED') return;

      const { runNodeId } = event.data;

      // If this is the currently selected step node, refresh its details
      if (context.selectedStepNode?.id === runNodeId) {
        sendToSystem(id, {
          type: 'GET_RUN_NODE_DETAILS',
          runNodeId,
        });
      }
    },
    pulseEvent: assign(({ event }) => {
      if (event.type !== 'EVENT_PULSE') return {};
      return {
        pulsingEventType: event.eventType
      };
    }),
    clearPulse: assign({
      pulsingEventType: undefined
    }),
    navigateToFlow: ({ event }) => {
      if (event.type !== 'FLOW.NAVIGATE') return;

      sendToSystem(id, {
        type: 'OPEN_RUN_NODE',
        runNodeId: event.runNodeId,
      });
    },
    goBack: ({ context }) => {
      sendToSystem(id, {
        type: 'GO_BACK_RUN_NODE',
        currentFlowRunNodeId: context.flowRunNodeId,
      });
    },
    /** The tree of the flow this window shows, or the root run's; the system answers this window alone */
    requestSurfaceData: ({ context }) => {
      sendToSystem(id, {
        type: 'REQUEST_SURFACE_DATA',
        ...(context.flowRunNodeId && { flowRunNodeId: context.flowRunNodeId }),
      });
    },
    requestRootData: () => {
      sendToSystem(id, { type: 'REQUEST_SURFACE_DATA' });
    },
    toggleLeftPanel: assign({
      showLeftPanel: ({ context }) => !context.showLeftPanel
    }),
    requestNodeDetails: assign(({ event }) => {
      if (event.type !== 'NODE.CLICK') return {};

      sendToSystem(id, {
        type: 'GET_RUN_NODE_DETAILS',
        runNodeId: event.nodeId,
      });

      // Set the selected node ID immediately
      return {
        selectedStepNode: {
          id: event.nodeId
        } as any
      };
    }),

    selectAndShowFirstNode: assign(({ context }) => {
      // Get all nodes from the normalized tree
      const byId = context.normalizedTree?.byId;
      const rootIds = context.normalizedTree?.rootIds || [];

      if (!byId) {
        console.warn('No nodes available in brain');
        return {};
      }

      // Find the first node that is not a root node
      const firstNodeId = Object.keys(byId).find(id => !rootIds.includes(id));

      if (!firstNodeId) {
        console.warn('No child nodes available in brain');
        return {};
      }

      // Request details for this node
      sendToSystem(id, {
        type: 'GET_RUN_NODE_DETAILS',
        runNodeId: firstNodeId,
      });

      // Set the selected node ID immediately
      return {
        selectedStepNode: {
          id: firstNodeId
        } as any
      };
    }),
    /**
     * Opens the failing node's details when a step errors, which is what asking for them is for: the panel
     * and the canvas highlight both read `selectedStepNode`, so there is nowhere else the answer can land.
     *
     * It selects the node *before* asking, as the other two asking actions do, because `answersSelectedNode`
     * admits a reply only for the node being waited on. Asking without selecting is an answer the guard drops.
     */
    selectAndShowFailingNode: assign(({ event }) => {
      if (event.type !== 'BRAIN_RUNTIME_ERROR' || !event.error.runNodeId) return {};
      const runNodeId = event.error.runNodeId;

      sendToSystem(id, {
        type: 'GET_RUN_NODE_DETAILS',
        runNodeId,
      });

      return {
        selectedStepNode: {
          id: runNodeId
        } as any
      };
    }),
    setStepNodeDetails: assign(({ event }) => {
      if (event.type !== 'RUN_NODE_DETAILS') return {};
      return {
        selectedStepNode: event.details || undefined
      };
    }),
    closeDetails: assign({
      selectedStepNode: undefined
    }),
    toggleInspect: () => {
      sendToSystem(id, {
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
      const { rootFlowId, startError, paused, inspectEnabled } = typeOf('BRAIN_STATE', event);
      return { brainIsDead: !rootFlowId, startError, runningRootFlowId: rootFlowId, brainIsPaused: paused, inspectEnabled };
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
      sendToSystem(id, {
        type: 'PAUSE_BRAIN',
      });
    },
    resumeBrain: () => {
      sendToSystem(id, {
        type: 'RESUME_BRAIN',
      });
    },
    restartBrain: ({ context }) => {
      if (context.brainIsDead) sendToSystem(id, { type: 'START_BRAIN' });
      else sendToSystem(id, { type: 'RESTART_BRAIN' });
    },
    killBrain: () => {
      sendToSystem(id, {
        type: 'KILL_BRAIN',
      });
    },
    handleBreadcrumbClick: ({ event, context }) => {
      const target = (event as TrailClickEvent).target;

      if (target === 'root') {
        sendToSystem(id, { type: 'GO_BACK_RUN_NODE' });
      } else if (target.startsWith('flow:')) {
        const flowRunNodeId = target.substring(5);
        if (flowRunNodeId !== context.flowRunNodeId) {
          sendToSystem(id, { type: 'OPEN_RUN_NODE', runNodeId: flowRunNodeId });
        }
      }
    },
  },
  guards: {
    canGoBack: () => {
      return true;
    },
    targetIs,
    /**
     * Whether these details describe the node still being waited on.
     *
     * **The invariant it rests on: every action that asks assigns `selectedStepNode` first.** Three set the
     * id and then send (a click, the first node shown, a step's error) and the fourth only asks about the
     * node already selected. So the reply's own `runNodeId` tells it from an answer for a node the view has
     * since moved off, and no request id is needed.
     *
     * An action that asks without selecting gets its answer dropped here, silently — which is what the
     * error path did, so the failing node's details never reached the panel. `run-node-correlation.spec.ts`
     * holds each asking action to it, rather than this comment enumerating them.
     */
    answersSelectedNode: ({ context, event }) =>
      (event as { runNodeId?: string }).runNodeId === context.selectedStepNode?.id,
  },
}).createMachine({
  id,
  context: {
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
    // Where the surface asks for what it starts from: the shell hands it this in a delivery naming the surface
    SURFACE_STARTED: { actions: 'requestSurfaceData' },
    BRAIN_STATE: { actions: 'setBrainState' },
  },
  states: {
    loading: {
      on: {
        RECEIVE_SURFACE_DATA: {
          target: 'ready',
          actions: 'setBrainData'
        },
        BRAIN_RUNTIME_ERROR: {
          actions: 'addRuntimeError'
        },
        DISMISS_RUNTIME_ERROR: {
          actions: 'dismissRuntimeError'
        }
      }
    },
    ready: {
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
        RECEIVE_SURFACE_DATA: {
          actions: 'setBrainData'
        },
        'NODE.CLICK': {
          actions: 'requestNodeDetails'
        },
        'SELECT_AND_SHOW_FIRST_NODE': {
          actions: 'selectAndShowFirstNode'
        },
        'FLOW.NAVIGATE': {
          actions: 'navigateToFlow'
        },
        'BACK.CLICK': {
          guard: 'canGoBack',
          actions: 'goBack'
        },
        'EVENT.CLICK': {
        },
        TOGGLE_LEFT_PANEL: {
          actions: 'toggleLeftPanel'
        },
        TOGGLE_INSPECT: {
          actions: 'toggleInspect'
        },
        INSPECT_TOGGLED: {
          actions: 'setInspectEnabled'
        },
        TOGGLE_ANIMATIONS: {
          actions: 'toggleAnimations'
        },
        CLOSE_DETAILS: {
          actions: 'closeDetails'
        },
        RUN_NODE_DETAILS: {
          guard: 'answersSelectedNode',
          actions: 'setStepNodeDetails'
        },
        SURFACE_ACTIVATED: {
          actions: 'requestSurfaceData'
        },
        SURFACE_DEACTIVATED: {
          // No action needed for deactivation
        },
        RUN_NODE_OPENED: {
          actions: 'setRunNodeData'
        },
        RUN_NODE_SPAWNED: {
          actions: 'addRunNodeToTree'
        },
        RUN_NODE_UPDATED: {
          actions: ['updateRunNodeInTree', 'refreshNodeDetailsIfSelected']
        },
        EVENT_PULSE: {
          // The event's runs arrive as the run's feed (RUN_NODE_SPAWNED); the tree is asked for again here, in the
          // delivery of the pulse, since an ask from a timer carries no sender and could not be answered
          actions: ['pulseEvent', 'requestSurfaceData', ({ self }) => {
            // Clear pulse after animation
            setTimeout(() => {
              self.send({ type: 'CLEAR_PULSE' });
            }, 400);
          }]
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
        BRAIN_KILLED: {
          actions: 'setBrainKilled'
        },
        // News of a start: the new run's tree is the root's, asked for again in this window
        BRAIN_STARTED: {
          actions: ['setBrainStarted', 'requestRootData']
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
        BRAIN_RUNTIME_ERROR: {
          actions: ['addRuntimeError', 'selectAndShowFailingNode']
        },
        DISMISS_RUNTIME_ERROR: {
          actions: 'dismissRuntimeError'
        },
        TRAIL_CLICK: {
          actions: 'handleBreadcrumbClick'
        }
      }
    }
  },
});

export default brainState;
