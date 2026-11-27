import { given, type Each, type Read, type Value } from '@apackdev/state';
import type { SurfaceChrome, SurfaceLifecycleEvent, TrailClickEvent } from '@apackdev/sdk/fe';
import { Activity, Play, RefreshCw, Power, PlayCircle, Pause } from 'lucide-vue-next';
import type { StepRuntimeError, RunNode, RunTree } from '@apackdev/sdk/steps';
import { state } from '#generated/state.ts';
import type { FlowRunNodeData } from '#generated/types.ts';
import type { BrainStateEvent, OutgoingBrainEvents } from '#features/brain/be/types.ts';
import type { BrainContext } from './contract.ts';
import {
  applyRunNodeSpawn,
  denormalizeRunNodeTree,
  normalizeRunNodeTree,
  type NormalizedRunNodeTree,
} from './run-tree.ts';

export const id = 'brain' as const;

/** Duration (ms) an event pulse highlight stays visible in Watched Events. */
export const PULSE_DURATION_MS = 400;

type SystemEvent =
  | OutgoingBrainEvents
  | { type: 'INSPECT_TOGGLED'; enabled: boolean }
  | { type: 'FEATURE_SETTINGS_UPDATED'; settings: any }
  | { type: 'BRAIN_PAUSED' }
  | { type: 'BRAIN_RESUMED' }
  | { type: 'BRAIN_RUNTIME_ERROR'; error: StepRuntimeError };

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
  | { type: 'CLEAR_PULSE'; seq?: number };

export type BrainEvents = UIEvent | SystemEvent | SurfaceLifecycleEvent | TrailClickEvent;

type BrainData = Omit<
  BrainContext,
  | 'flowRunNodeId'
  | 'runNodeTree'
  | 'normalizedTree'
  | 'pulsingEventType'
  | 'selectedStepNode'
  | 'startError'
  | 'runningRootFlowId'
  | 'latestRuntimeError'
  | 'settings'
> & {
  flowRunNodeId: string | undefined;
  runNodeTree: RunTree[] | undefined;
  normalizedTree: NormalizedRunNodeTree | undefined;
  pulsingEventType: string | undefined;
  selectedStepNode: RunNode | undefined;
  startError: string | undefined;
  runningRootFlowId: string | undefined;
  latestRuntimeError: StepRuntimeError | undefined;
  settings: any;
  /** Current details fetch request; bumping `seq` or changing `runNodeId` cancels any in-flight ask. */
  detailsRequest: { readonly runNodeId: string; readonly seq: number } | null;
  /** Monotonic sequence for details requests and pulse timers. */
  requestSeq: number;
  /** Active pulse timer keyed by sequence number so each new pulse restarts the 400ms window. */
  pulseTimers: Record<string, { readonly seq: number }>;
};

const _feContractCheck: BrainData extends BrainContext ? true : never = true;
void _feContractCheck;

const pulseTimerState = state<
  { data: { seq: number }; reports: { type: 'CLEAR_PULSE'; seq: number } },
  never
>()({
  data: { seq: given },
  run: async ({ data, sleep, report }) => {
    await sleep(PULSE_DURATION_MS);
    report({ type: 'CLEAR_PULSE', seq: data.seq });
  },
  failed: () => {},
});

type BrainShape = {
  data: BrainData;
  starts: {
    pulseTimers: Each<typeof pulseTimerState>;
  };
  states: {
    loading: {
      states: {
        unasked: {};
        reading: {};
      };
    };
    ready: {
      states: {
        shown: {};
        reading: {
          data: { readFlowRunNodeId: string | undefined };
        };
        opening: {
          data: { openRunNodeId: string };
        };
        goingBack: {
          data: { backFromFlowRunNodeId: string | undefined };
        };
      };
    };
  };
};

function brainStateContext({ rootFlowId, startError, paused, inspectEnabled }: Read<BrainStateEvent>) {
  return {
    brainIsDead: !rootFlowId,
    startError,
    runningRootFlowId: rootFlowId,
    brainIsPaused: paused,
    inspectEnabled,
  };
}

/** The first node of the tree that is not one of its roots */
function firstChildNode(data: Read<BrainData>): string | undefined {
  const byId = data.normalizedTree?.byId;
  if (!byId) return undefined;
  const rootIds = data.normalizedTree?.rootIds || [];
  return Object.keys(byId).find((nodeId) => !rootIds.includes(nodeId));
}

function normalizeFlowRunNodeData(data: Read<FlowRunNodeData>): {
  normalizedTree: NormalizedRunNodeTree | undefined;
  runNodeTree: RunTree[] | undefined;
} {
  if (!data.runNodeTree) {
    return { normalizedTree: undefined, runNodeTree: undefined };
  }

  const normalizedTree = normalizeRunNodeTree(data.runNodeTree as RunTree[]);
  return {
    normalizedTree,
    runNodeTree: denormalizeRunNodeTree(normalizedTree),
  };
}

/** The tree of a flow run, as the state holds it */
function runContext(data: Read<FlowRunNodeData>) {
  const { normalizedTree, runNodeTree } = normalizeFlowRunNodeData(data);
  return {
    flowRunNodeId: data.flowRunNodeId,
    runNodeTree,
    normalizedTree,
    possibleEvents: [...data.possibleEvents],
    flowHierarchy: data.flowHierarchy ? [...data.flowHierarchy] : [],
  };
}

/**
 * What an answered tree puts in the state: the tree, unless the brain is stopped, and then the brain's state it was
 * answered with, which a window just started has not heard yet
 */
function answeredTree(
  { data, state: brainStateVal }: Read<{ data: FlowRunNodeData; state: BrainStateEvent }>,
) {
  return { ...(!brainStateVal.rootFlowId ? {} : runContext(data)), ...brainStateContext(brainStateVal) };
}

/** The flow run a breadcrumb names, where it names one */
const trailFlow = (target: string): string | undefined => (target.startsWith('flow:') ? target.substring(5) : undefined);

function addRuntimeErrorData(data: Read<BrainData>, error: Read<StepRuntimeError>) {
  const runtimeErrors = [error as StepRuntimeError, ...(data.runtimeErrors as StepRuntimeError[])].slice(0, 25);
  return {
    latestRuntimeError: error as StepRuntimeError,
    runtimeErrors,
  };
}

function selectAndAskDetailsData(data: Read<BrainData>, nodeId: string) {
  const seq = data.requestSeq + 1;
  return {
    selectedStepNode: { id: nodeId } as unknown as RunNode,
    requestSeq: seq,
    detailsRequest: { runNodeId: nodeId, seq },
  };
}

function pulseData(data: Read<BrainData>, eventType: string) {
  const seq = data.requestSeq + 1;
  return {
    pulsingEventType: eventType,
    requestSeq: seq,
    pulseTimers: { [String(seq)]: { seq } },
  };
}

function applyRunNodeUpdate(data: Read<BrainData>, runNodeId: string, status: RunNode['status']) {
  if (!data.normalizedTree || !data.normalizedTree.byId[runNodeId]) {
    return {};
  }

  const newTree: NormalizedRunNodeTree = {
    byId: { ...(data.normalizedTree.byId as Record<string, RunNode>) },
    rootIds: [...data.normalizedTree.rootIds],
    childrenById: { ...(data.normalizedTree.childrenById as Record<string, string[]>) },
  };
  newTree.byId[runNodeId] = {
    ...newTree.byId[runNodeId],
    status,
  };

  return {
    normalizedTree: newTree,
    runNodeTree: denormalizeRunNodeTree(newTree),
  };
}

export const brainChrome: SurfaceChrome<Value<BrainShape>> = {
  breadcrumb: { label: 'Brain', target: 'root' },
  states: {
    ready: {
      breadcrumb: ({ data }) =>
        !data.flowHierarchy?.length
          ? [{ label: 'Brain', target: 'root' }]
          : data.flowHierarchy.map((flow, i) => ({
              label: i === 0 ? 'Brain' : flow.label,
              target: `flow:${flow.flowRunNodeId}`,
            })),
      menu: ({ data }) => [
        { label: 'Watched Events', icon: Activity, event: { type: 'TOGGLE_LEFT_PANEL' }, isActive: data.showLeftPanel, iconColor: 'text-primary-400' },
        { label: 'Auto-focus Animations', icon: Play, event: { type: 'TOGGLE_ANIMATIONS' }, isActive: data.animationsEnabled, iconColor: 'text-blue-400' },
        ...(data.brainIsDead
          ? [{ separator: true, label: 'Start Brain', icon: PlayCircle, event: { type: 'RESTART_BRAIN' as const }, iconColor: 'text-green-400' }]
          : [
              ...(data.brainIsPaused
                ? [{ separator: true, label: 'Resume Brain', icon: PlayCircle, event: { type: 'RESUME_BRAIN' as const }, iconColor: 'text-green-400' }]
                : [{ separator: true, label: 'Pause Brain', icon: Pause, event: { type: 'PAUSE_BRAIN' as const }, iconColor: 'text-yellow-400' }]
              ),
              { label: 'Restart Brain', icon: RefreshCw, event: { type: 'RESTART_BRAIN' as const }, iconColor: 'text-amber-400' },
              { label: 'Kill Brain', icon: Power, event: { type: 'KILL_BRAIN' as const }, iconColor: 'text-red-400' },
            ]
        ),
      ],
    },
  },
};

const brainState = state<BrainShape, BrainEvents>()({
  initial: 'loading',
  data: {
    flowRunNodeId: undefined,
    runNodeTree: undefined,
    normalizedTree: undefined,
    possibleEvents: [],
    flowHierarchy: [],
    pulsingEventType: undefined,
    showLeftPanel: false,
    selectedStepNode: undefined,
    inspectEnabled: false,
    animationsEnabled: true,
    brainIsDead: false, // Start as running to prevent flash of dead UI
    startError: undefined,
    runningRootFlowId: undefined,
    brainIsPaused: false,
    latestRuntimeError: undefined,
    runtimeErrors: [],
    settings: undefined,
    detailsRequest: null,
    requestSeq: 0,
    pulseTimers: {},
  },
  starts: (start) => ({
    pulseTimers: start(pulseTimerState, {
      each: 'pulseTimers',
      given: (key, data) => ({ seq: data.pulseTimers[key]!.seq }),
    }),
  }),
  on: {
    BRAIN_STATE: (event) => ({ data: brainStateContext(event) }),
    // Inspect mode is the feature's rather than a run's, and a panel beside another surface shows by it, so a toggle
    // and what it became are taken before this surface's first tree as after it
    TOGGLE_INSPECT: (_event, { tell }) => {
      tell('brain', { type: 'TOGGLE_INSPECT' });
    },
    INSPECT_TOGGLED: (event) => ({ data: { inspectEnabled: event.enabled } }),
  },
  states: {
    // No tree yet. The first is asked for where a delivery names the surface: as the shell starts it
    loading: {
      initial: 'unasked',
      on: {
        SURFACE_STARTED: () => ({ at: 'loading.reading' }),
        BRAIN_RUNTIME_ERROR: (event, { data }) => ({ data: addRuntimeErrorData(data, event.error) }),
        DISMISS_RUNTIME_ERROR: () => ({ data: { latestRuntimeError: undefined } }),
      },
      states: {
        unasked: {},
        reading: {
          loads: (load) => ({
            surfaceData: load('brain', 'REQUEST_SURFACE_DATA', {
              done: (outcome) => {
                if (outcome.ok) {
                  return { at: 'ready', data: answeredTree(outcome.value) };
                }
                // A tree that could not be read is asked for again when the surface is next started
                return { at: 'loading.unasked' };
              },
            }),
          }),
        },
      },
    },
    ready: {
      initial: 'shown',
      loads: (load) => ({
        // The selected node's details. Changing `detailsRequest` cancels the ask under way,
        // so an answer is always for the node the view is on.
        details: load('brain', 'GET_RUN_NODE_DETAILS', {
          from: ['detailsRequest'],
          args: ({ detailsRequest }) => (detailsRequest ? { runNodeId: detailsRequest.runNodeId } : null),
          done: (outcome) => (
            outcome.ok
              ? { data: { selectedStepNode: (outcome.value.details || undefined) as RunNode | undefined } }
              : undefined
          ),
        }),
      }),
      on: {
        'EVENT.CLICK': () => {},
        TOGGLE_LEFT_PANEL: (_event, { data }) => ({ data: { showLeftPanel: !data.showLeftPanel } }),
        TOGGLE_ANIMATIONS: (_event, { data }) => ({ data: { animationsEnabled: !data.animationsEnabled } }),
        SURFACE_DEACTIVATED: () => {},
        RUN_NODE_SPAWNED: (event, { data }) => {
          // Only accept RunNode spawns for the currently viewed flow
          if (event.flowRunNodeId !== data.flowRunNodeId) return;
          const newTree = applyRunNodeSpawn(
            data.normalizedTree as NormalizedRunNodeTree | undefined,
            event.runNode as RunNode,
            event.parentId,
            data.flowRunNodeId,
          );
          return {
            data: {
              normalizedTree: newTree,
              runNodeTree: denormalizeRunNodeTree(newTree),
            },
          };
        },
        CLEAR_PULSE: (event, { data }) => {
          if (event.seq !== undefined && !data.pulseTimers[String(event.seq)]) return;
          return { data: { pulsingEventType: undefined, pulseTimers: {} } };
        },
        FEATURE_SETTINGS_UPDATED: (event) => ({ data: { settings: event.settings } }),
        RESTART_BRAIN: (_event, { data, tell }) => {
          if (data.brainIsDead) tell('brain', { type: 'START_BRAIN' });
          else tell('brain', { type: 'RESTART_BRAIN' });
        },
        KILL_BRAIN: (_event, { tell }) => {
          tell('brain', { type: 'KILL_BRAIN' });
        },
        PAUSE_BRAIN: (_event, { tell }) => {
          tell('brain', { type: 'PAUSE_BRAIN' });
        },
        RESUME_BRAIN: (_event, { tell }) => {
          tell('brain', { type: 'RESUME_BRAIN' });
        },
        BRAIN_PAUSED: () => ({ data: { brainIsPaused: true } }),
        BRAIN_RESUMED: () => ({ data: { brainIsPaused: false } }),
        DISMISS_RUNTIME_ERROR: () => ({ data: { latestRuntimeError: undefined } }),
        // The tree this window shows. One ask for it at a time: a newer one gives up the one under way
        SURFACE_STARTED: (_event, { data }) => ({
          at: 'ready.reading',
          data: { readFlowRunNodeId: data.flowRunNodeId },
        }),
        SURFACE_ACTIVATED: (_event, { data }) => ({
          at: 'ready.reading',
          data: { readFlowRunNodeId: data.flowRunNodeId },
        }),
        // The event's runs arrive as the run's feed (RUN_NODE_SPAWNED); the tree is asked for again as well
        EVENT_PULSE: (event, { data }) => ({
          at: 'ready.reading',
          data: {
            readFlowRunNodeId: data.flowRunNodeId,
            ...pulseData(data, event.eventType),
          },
        }),
        // News of a start: the new run's tree is the root's
        BRAIN_STARTED: (event) => ({
          at: 'ready.reading',
          data: {
            readFlowRunNodeId: undefined,
            brainIsDead: false,
            startError: undefined,
            runningRootFlowId: event.rootFlowId,
            brainIsPaused: false,
          },
        }),
        'FLOW.NAVIGATE': (event) => ({
          at: 'ready.opening',
          data: { openRunNodeId: event.runNodeId },
        }),
        'BACK.CLICK': (_event, { data }) => ({
          at: 'ready.goingBack',
          data: { backFromFlowRunNodeId: data.flowRunNodeId },
        }),
        TRAIL_CLICK: (event, { data }) => {
          if (event.target === 'root') {
            return { at: 'ready.goingBack', data: { backFromFlowRunNodeId: undefined } };
          }
          const flowRunNodeId = trailFlow(event.target);
          if (flowRunNodeId !== undefined && flowRunNodeId !== data.flowRunNodeId) {
            return { at: 'ready.opening', data: { openRunNodeId: flowRunNodeId } };
          }
        },
        'NODE.CLICK': (event, { data }) => ({
          data: selectAndAskDetailsData(data, event.nodeId),
        }),
        SELECT_AND_SHOW_FIRST_NODE: (_event, { data }) => {
          const nodeId = firstChildNode(data);
          if (!nodeId) {
            console.warn('No child nodes available in brain');
            return;
          }
          return { data: selectAndAskDetailsData(data, nodeId) };
        },
        // A step's error opens the failing node's details; one that names no node leaves the selection alone
        BRAIN_RUNTIME_ERROR: (event, { data }) => ({
          data: {
            ...addRuntimeErrorData(data, event.error),
            ...(event.error.runNodeId ? selectAndAskDetailsData(data, event.error.runNodeId) : {}),
          },
        }),
        // The selected node changed, so its details are read again
        RUN_NODE_UPDATED: (event, { data }) => {
          const treePatch = applyRunNodeUpdate(data, event.data.runNodeId, event.data.status);
          if (data.selectedStepNode?.id === event.data.runNodeId) {
            const seq = data.requestSeq + 1;
            return {
              data: {
                ...treePatch,
                requestSeq: seq,
                detailsRequest: { runNodeId: event.data.runNodeId, seq },
              },
            };
          }
          if (Object.keys(treePatch).length > 0) {
            return { data: treePatch };
          }
        },
        CLOSE_DETAILS: () => ({
          data: { selectedStepNode: undefined, detailsRequest: null },
        }),
        BRAIN_KILLED: (event) => ({
          data: {
            brainIsDead: true,
            startError: event.startError,
            runningRootFlowId: undefined,
            brainIsPaused: false,
            possibleEvents: [],
            flowHierarchy: [],
            selectedStepNode: undefined,
            detailsRequest: null,
          },
        }),
      },
      states: {
        shown: {},
        reading: {
          data: { readFlowRunNodeId: given },
          loads: (load) => ({
            surfaceData: load('brain', 'REQUEST_SURFACE_DATA', {
              from: ['readFlowRunNodeId'],
              args: ({ readFlowRunNodeId }) => (readFlowRunNodeId ? { flowRunNodeId: readFlowRunNodeId } : {}),
              done: (outcome) => ({
                at: 'ready.shown',
                ...(outcome.ok ? { data: answeredTree(outcome.value) } : {}),
              }),
            }),
          }),
        },
        // Going into a flow run. The run it opens is the tree to show, so the tree is not asked for again meanwhile
        opening: {
          data: { openRunNodeId: given },
          loads: (load) => ({
            openRun: load('brain', 'OPEN_RUN_NODE', {
              from: ['openRunNodeId'],
              args: ({ openRunNodeId }) => ({ runNodeId: openRunNodeId }),
              done: (outcome) => ({
                at: 'ready.shown',
                ...(outcome.ok ? { data: runContext(outcome.value.data) } : {}),
              }),
            }),
          }),
          on: {
            SURFACE_ACTIVATED: () => {},
            EVENT_PULSE: (event, { data }) => ({ data: pulseData(data, event.eventType) }),
          },
        },
        // Going back out to the flow that ran the one shown, or to the root run from a breadcrumb
        goingBack: {
          data: { backFromFlowRunNodeId: given },
          loads: (load) => ({
            goBack: load('brain', 'GO_BACK_RUN_NODE', {
              from: ['backFromFlowRunNodeId'],
              args: ({ backFromFlowRunNodeId }) => (backFromFlowRunNodeId ? { currentFlowRunNodeId: backFromFlowRunNodeId } : {}),
              done: (outcome) => ({
                at: 'ready.shown',
                ...(outcome.ok ? { data: runContext(outcome.value.data) } : {}),
              }),
            }),
          }),
          on: {
            SURFACE_ACTIVATED: () => {},
            EVENT_PULSE: (event, { data }) => ({ data: pulseData(data, event.eventType) }),
          },
        },
      },
    },
  },
});

export default brainState;
