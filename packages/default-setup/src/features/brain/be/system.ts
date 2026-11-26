import { within, type Each, type Read } from '@apackdev/state';
import { featureSettings } from '#generated/settings.ts';
import { repository } from '#generated/repository.ts';
import { services } from '#generated/services.ts';
import { state } from '#generated/state.ts';
import type { EARS } from '#generated/ears.ts';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { HostLifecycleEvents, StateMatchesContract } from '@apackdev/sdk/framework';
import type { RunNodeId } from '@apackdev/sdk/steps';
import { createLogger, reportError, setDebugEnabled, isDebugEnabled } from '@apackdev/sdk/logger';

import type { Contract } from './contract.ts';
import type { BrainFlowSpec, BrainInternalEvents, FlowRunNodeData, OutgoingBrainEvents } from './types.ts';
import { flowState, loadFlowTriggers, type FlowEvent } from './flow-system.ts';
import { notify as notifyAdHocListeners, removeAllListeners as removeAllAdHocListeners } from './services/brain.ts';

const logger = createLogger('brain');

/**
 * The flow the brain runs: the flow with the root role. Undefined when there's nothing to run, and the brain stops:
 * no flows yet, or flows without a root flow (`noRootFlowError`; the brain never picks one).
 */
const rootFlowToRun = (): EARS.EntityId | undefined => repository.flowsQueries.rootFlow();

/** The error the brain can't start with: flows exist but none has the root role. Undefined with a root flow or no flows */
function noRootFlowError(): Error | undefined {
  if (repository.flowsQueries.rootFlow()) return undefined;
  const flowCount = repository.flowsQueries.list().flows.length;
  if (flowCount === 0) return undefined;
  return new Error(`No flow has the root role (${flowCount} flows exist): mark one \`root: true\` in its flow source, or make one the root flow in Flows`);
}

function reportStartError(error: Error) {
  reportError({ error, title: 'Could not start the brain', source: 'brain', operation: 'start' });
}

/** The brain's state (`BRAIN_STATE`). Inspection is restored from the settings, on by default in development */
function buildBrainState(
  runningRootFlowId: EARS.EntityId | undefined,
  startError: Error | undefined,
  paused: boolean,
): Extract<OutgoingBrainEvents, { type: 'BRAIN_STATE' }> {
  const inspectEnabled = featureSettings.forFeature('brain').get()?.inspectEnabled ?? (process.env.NODE_ENV !== 'production');
  setDebugEnabled('brain', inspectEnabled);
  return {
    type: 'BRAIN_STATE',
    ...(runningRootFlowId
      ? { rootFlowId: runningRootFlowId }
      : { startError: startError?.message }),
    paused,
    inspectEnabled,
  };
}

/** A flow run's tree, as a window opens it */
const openedRun = (runNodeId: RunNodeId) => ({ runNodeId, data: repository.brainQueries.extendedRunNodeData(runNodeId) });

/** Collects `flowRunNodeId` and every active descendant subflow spawned under it. */
function collectDescendantFlowIds(
  flows: Readonly<Record<string, Read<BrainFlowSpec>>>,
  rootId: string,
): Set<string> {
  const toRemove = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const [id, spec] of Object.entries(flows)) {
      if (!toRemove.has(id) && spec.parentFlowRunNodeId && toRemove.has(spec.parentFlowRunNodeId)) {
        toRemove.add(id);
        added = true;
      }
    }
  }
  return toRemove;
}

type QueuedBrainEvent = {
  readonly eventType: string;
  readonly payload?: unknown;
  readonly targetFlowId?: string;
};

type BrainShape = {
  data: {
    startError: Error | undefined;
    startErrorReported: boolean;
    clientConnected: boolean;
  };
  states: {
    booting: {};
    stopped: {};
    running: {
      data: {
        runningRootFlowId: EARS.EntityId | undefined;
        rootRunId: RunNodeId | undefined;
        flows: Record<string, BrainFlowSpec>;
        eventQueue: QueuedBrainEvent[];
      };
      starts: { flow: Each<typeof flowState> };
      states: {
        active: {};
        paused: {};
      };
    };
  };
};

const emptyRunningData = () => ({
  runningRootFlowId: undefined,
  rootRunId: undefined,
  flows: {} as Record<string, BrainFlowSpec>,
  eventQueue: [] as QueuedBrainEvent[],
});

type BrainEvent =
  | IncomingOnlyEventsOf<Contract>
  | BrainInternalEvents
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' | 'CLIENT_CONNECTED' | 'DATA_REPLACED' }>;

function dispatchBrainEvent(
  ev: QueuedBrainEvent,
  flows: Readonly<Record<string, Read<BrainFlowSpec>>>,
  tell: (to: ReturnType<typeof Object>, event: Read<FlowEvent>) => void,
  child: (name: 'flow', key: string) => unknown,
  broadcast: (to: 'brain', event: Read<OutgoingBrainEvents>) => void,
): void {
  const { eventType, payload, targetFlowId } = ev;

  broadcast('brain', {
    type: 'EVENT_PULSE',
    eventType,
  });

  if (targetFlowId) {
    if (targetFlowId in flows) {
      tell(child('flow', targetFlowId) as never, {
        type: 'TRACK_EVENT',
        eventType,
        payload,
        targetFlowId,
      });
    } else {
      logger.error(`Target flow actor not found: ${eventType}`, { targetFlowId });
    }
  } else {
    const flowIds = Object.keys(flows);
    if (flowIds.length === 0) {
      logger.warn(`No flow actors registered to receive global event: ${eventType}`);
    } else {
      logger.info(`Broadcasting global event "${eventType}" to ${flowIds.length} flow actors`, {
        eventType,
        actorCount: flowIds.length,
        flowActorIds: flowIds,
      });
      for (const flowRunNodeId of flowIds) {
        tell(child('flow', flowRunNodeId) as never, {
          type: 'TRACK_EVENT',
          eventType,
          payload,
        });
      }
    }
  }

  notifyAdHocListeners(eventType, payload, targetFlowId);
}

export const brainSystem = state<
  BrainShape,
  BrainEvent,
  NormalizeAsks<ContractAsks<Contract>>
>()({
  data: {
    startError: undefined,
    startErrorReported: false,
    clientConnected: false,
  },
  initial: 'booting',
  on: {
    SEND_STATE: (_ev, { snapshot, broadcast }) => {
      const isRunning = within(snapshot, 'running');
      broadcast(
        'brain',
        buildBrainState(
          isRunning ? snapshot.data.runningRootFlowId : undefined,
          snapshot.data.startError,
          snapshot.at === 'running.paused',
        ),
      );
    },
    // Kept as a fact: whether a client is attached is not something publishing can say
    CLIENT_CONNECTED: (_ev, { data }) => {
      if (data.clientConnected) return;
      return { data: { clientConnected: true } };
    },
    // A setting of the feature rather than of a run, so it toggles whether a flow runs or not
    TOGGLE_INSPECT: (_ev, { broadcast }) => {
      const currentState = isDebugEnabled('brain');
      const newState = !currentState;
      setDebugEnabled('brain', newState);

      featureSettings.forFeature('brain').set({ path: ['inspectEnabled'], value: newState });

      broadcast('brain', {
        type: 'INSPECT_TOGGLED',
        enabled: newState,
      });
    },
  },
  answers: {
    REQUEST_SURFACE_DATA: (args, { snapshot }) => {
      const flowId = args.flowRunNodeId ? (args.flowRunNodeId as RunNodeId) : undefined;
      const isRunning = within(snapshot, 'running');
      const rootRunId = isRunning ? snapshot.data.rootRunId : undefined;
      let flowData: FlowRunNodeData;
      try {
        flowData = flowId
          ? repository.brainQueries.extendedRunNodeData(flowId)
          : repository.brainQueries.rootData(rootRunId);
      } catch {
        // A run the history no longer holds (pruned, or the data replaced)
        flowData = { flowRunNodeId: '' as EARS.EntityId, runNodeTree: [], possibleEvents: [], flowHierarchy: [] };
      }
      return {
        data: flowData,
        state: buildBrainState(
          isRunning ? snapshot.data.runningRootFlowId : undefined,
          snapshot.data.startError,
          snapshot.at === 'running.paused',
        ),
      };
    },
  },
  states: {
    booting: {
      run: () => ({ at: 'running', data: emptyRunningData() }),
    },
    stopped: {
      on: {
        // Stopped, describing itself means working out why it will not start and saying so once.
        SEND_STATE: (_ev, { data, broadcast }) => {
          const startError = data.startError && noRootFlowError();
          broadcast('brain', buildBrainState(undefined, startError, false));
          if (startError && !data.startErrorReported) {
            reportStartError(startError);
            return { data: { startError, startErrorReported: true } };
          }
          if (startError !== data.startError) {
            return { data: { startError } };
          }
        },
        START_BRAIN: () => ({ at: 'running', data: emptyRunningData() }),
        RESTART_BRAIN: () => ({ at: 'running', data: emptyRunningData() }),
      },
    },
    running: {
      data: {
        runningRootFlowId: undefined,
        rootRunId: undefined,
        flows: {},
        eventQueue: [],
      },
      initial: 'active',
      starts: (start) => ({
        flow: start(flowState, {
          each: 'flows',
          given: (key, data) => ({
            spec: data.flows[key]!,
            paused: data.flows[key]!.startPaused,
          }),
        }),
      }),
      run: ({ data, onExit, tell, child, broadcast }) => {
        // Register `onExit` first so every leave from `running` (KILL_BRAIN, DATA_REPLACED, RESTART_BRAIN, root
        // completion, or stop) runs after child flows/steps exit: marks still-active RunNodes `'stopped'`, removes
        // ad-hoc listeners, and clears schedules.
        onExit(() => {
          services.runHistory.stopActive();
          removeAllAdHocListeners();
          services.scheduler.clearAllSchedules();
        });

        const currentRootFlowId = rootFlowToRun();
        if (!currentRootFlowId) {
          const startError = noRootFlowError();
          if (!startError) logger.warn('No flow to run; start the brain once a flow exists');
          else if (data.clientConnected) reportStartError(startError);
          broadcast('brain', { type: 'BRAIN_KILLED', startError: startError?.message });
          return {
            at: 'stopped',
            data: { startError, startErrorReported: data.clientConnected },
          };
        }

        const { rootFlow, rootFlowRunNode } = repository.brainCommands.createRootFlowRunNode();
        const { nodes: eventNodes, hasPersistentTriggers } = loadFlowTriggers(rootFlow.id, rootFlowRunNode.id);
        const rootSpec: BrainFlowSpec = {
          flowRunNodeId: rootFlowRunNode.id,
          flowId: rootFlow.id,
          flowLabel: rootFlowRunNode.label || 'Unknown Flow',
          isRootFlow: true,
          isFinalStep: Boolean(rootFlowRunNode.final),
          entrySteps: { steps: [], lastStep: undefined },
          eventNodes,
          hasPersistentTriggers,
          startPaused: false,
        };

        logger.info('Started brain root flow', { flowId: currentRootFlowId });
        broadcast('brain', {
          type: 'BRAIN_STARTED',
          rootFlowId: currentRootFlowId,
        });

        // A root run receives readiness once: on the first client, or when started after that client connected.
        if (data.clientConnected) {
          tell(child('flow', rootFlowRunNode.id), { type: 'TRACK_EVENT', eventType: 'client.ready' });
        }

        return {
          data: {
            runningRootFlowId: currentRootFlowId,
            rootRunId: rootFlowRunNode.id,
            startError: undefined,
            startErrorReported: false,
            flows: { [rootFlowRunNode.id]: rootSpec },
            eventQueue: [],
          },
        };
      },
      answers: {
        // A run is opened while the brain runs; stopped, the bus answers that nothing took the ask
        OPEN_RUN_NODE: ({ runNodeId }, { refuse }) => {
          const id = runNodeId as RunNodeId;
          if (repository.brainQueries.runNodeById(id)?.kind !== 'flow') {
            throw refuse('not-a-flow', 'Only a flow run opens');
          }
          return openedRun(id);
        },
        GO_BACK_RUN_NODE: ({ currentFlowRunNodeId }, { data }) => {
          const current = currentFlowRunNodeId as RunNodeId | undefined;
          const parentFlow = current ? repository.brainQueries.parentFlowOf(current) : undefined;
          const flowData = parentFlow
            ? repository.brainQueries.extendedRunNodeData(parentFlow.id)
            : repository.brainQueries.rootData(data.rootRunId);
          return { runNodeId: flowData.flowRunNodeId, data: flowData };
        },
        GET_RUN_NODE_DETAILS: ({ runNodeId }) => {
          const id = runNodeId as RunNodeId;
          const runNode = repository.brainQueries.runNodeById(id);
          const revealIn = repository.brainQueries.revealIn(id);
          // Said as JSON, where a missing run node has to be: null
          return { runNodeId: id, details: runNode ? { ...runNode, ...(revealIn && { revealIn }) } : null };
        },
      },
      on: {
        CLIENT_CONNECTED: (_ev, { data, tell, child }) => {
          if (data.clientConnected) return;
          if (data.rootRunId && data.rootRunId in data.flows) {
            tell(child('flow', data.rootRunId), { type: 'TRACK_EVENT', eventType: 'client.ready' });
          }
          return { data: { clientConnected: true } };
        },
        KILL_BRAIN: (_ev, { broadcast }) => {
          broadcast('brain', { type: 'BRAIN_KILLED' });
          logger.info('Brain flow machine killed and its runs stopped');
          return { at: 'stopped' };
        },
        // The rows the running flow is part way through are gone. It stops and does not restart: whether
        // there is a flow worth running afterwards is the caller's to know — a reset makes a root flow and
        // asks, a restored backup may hold anything and tells the user to start it themselves
        DATA_REPLACED: (_ev, { broadcast }) => {
          broadcast('brain', { type: 'BRAIN_KILLED' });
          logger.info('Brain flow machine killed and its runs stopped');
          return { at: 'stopped' };
        },
        RESTART_BRAIN: () => {
          logger.info('Restarting brain flow machine');
          return { at: 'running', data: emptyRunningData() };
        },
        SPAWN_SUBFLOW: (ev, { snapshot }) => ({
          data: (d) => {
            d.flows[ev.spec.flowRunNodeId] = {
              ...ev.spec,
              startPaused: snapshot.at === 'running.paused',
            };
          },
        }),
        FLOW_COMPLETED: (ev, { data, tell, child, broadcast }) => {
          if (ev.isRootFlow) {
            broadcast('brain', { type: 'BRAIN_KILLED' });
            logger.info('Brain flow machine killed and its runs stopped');
            return { at: 'stopped' };
          }
          if (
            ev.parentFlowRunNodeId &&
            ev.parentFlowRunNodeId in data.flows &&
            ev.flowStepNodeId &&
            ev.parentEventRunNodeId
          ) {
            tell(child('flow', ev.parentFlowRunNodeId), {
              type: 'SUBFLOW_COMPLETED',
              subflowRunNodeId: ev.flowRunNodeId,
              stepId: ev.flowStepNodeId,
              stepLabel: ev.flowStepLabel ?? '',
              eventRunNodeId: ev.parentEventRunNodeId,
              result: ev.result,
              failed: false,
              final: ev.final,
            });
          }
          const toRemove = collectDescendantFlowIds(data.flows, ev.flowRunNodeId);
          return {
            data: (d) => {
              for (const id of toRemove) {
                delete d.flows[id];
              }
            },
          };
        },
        KILL_FLOW: (ev, { data, tell, child }) => {
          if (ev.flowRunNodeId in data.flows) {
            tell(child('flow', ev.flowRunNodeId), { type: 'KILL_FLOW' });
          }
        },
      },
      states: {
        active: {
          on: {
            TRIGGER_BRAIN_EVENT: (ev, { data, tell, child, broadcast }) => {
              dispatchBrainEvent(ev, data.flows, tell as never, child, broadcast);
            },
            HANDLE_BRAIN_EVENT: (ev, { data, tell, child, broadcast }) => {
              dispatchBrainEvent(ev, data.flows, tell as never, child, broadcast);
            },
            PAUSE_BRAIN: (_ev, { data, tell, child, broadcast }) => {
              for (const flowRunNodeId of Object.keys(data.flows)) {
                tell(child('flow', flowRunNodeId), { type: 'SET_PAUSED', paused: true });
              }
              broadcast('brain', { type: 'BRAIN_PAUSED' });
              return { at: 'running.paused' };
            },
          },
        },
        paused: {
          on: {
            TRIGGER_BRAIN_EVENT: (ev, { data }) => ({
              data: {
                eventQueue: [
                  ...data.eventQueue,
                  { eventType: ev.eventType, payload: ev.payload, targetFlowId: ev.targetFlowId },
                ],
              },
            }),
            HANDLE_BRAIN_EVENT: (ev, { data }) => ({
              data: {
                eventQueue: [
                  ...data.eventQueue,
                  { eventType: ev.eventType, payload: ev.payload, targetFlowId: ev.targetFlowId },
                ],
              },
            }),
            RESUME_BRAIN: (_ev, { data, tell, child, send, broadcast }) => {
              for (const flowRunNodeId of Object.keys(data.flows)) {
                tell(child('flow', flowRunNodeId), { type: 'SET_PAUSED', paused: false });
              }
              for (const queued of data.eventQueue) {
                send({
                  type: 'HANDLE_BRAIN_EVENT',
                  eventType: queued.eventType,
                  payload: queued.payload,
                  targetFlowId: queued.targetFlowId,
                });
              }
              broadcast('brain', { type: 'BRAIN_RESUMED' });
              return { at: 'running.active', data: { eventQueue: [] } };
            },
          },
        },
      },
    },
  },
});

const _contractMatches: StateMatchesContract<typeof brainSystem, Contract> = true;
void _contractMatches;

export default brainSystem;
