import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface } from '#generated/events.ts';
import { assign, setup, enqueueActions, raise } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import type { BrainContext, FlowRunNodeData, OutgoingBrainEvents } from './types.ts';
import type { RunNodeId } from '@apackdev/sdk/steps';
import { repository } from '#generated/repository.ts';
import { createLogger, reportError, setDebugEnabled, isDebugEnabled } from '@apackdev/sdk/logger';
import { createFlowNodeSystem, getFlowActor, getAllFlowActors, getAllFlowActorIds, clearFlowActorRegistry } from './flow-system.ts';
import { setBrainPausedState } from './utils/brain-pause.ts';
import { notify as notifyAdHocListeners, removeAllListeners as removeAllAdHocListeners } from './services/brain.ts';
import { services } from '#generated/services.ts';

export const brainSpec = defineSystem<Contract>();
export const brainRuntime = 'brain-runtime' as const;

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

/**
 * A start found no flow to run: clears the running root flow and tells clients the brain is stopped, and why when
 * flows exist but none is the root. That error is reported now if a client is connected, else when one connects.
 * Returns the context the brain stays stopped with.
 */
function stopWithoutRootFlow({ clientConnected }: BrainContext): Partial<BrainContext> {
  const startError = noRootFlowError();
  if (!startError) logger.warn('No flow to run; start the brain once a flow exists');
  else if (clientConnected) reportStartError(startError);
  broadcastToSurface('brain', { type: 'BRAIN_KILLED', startError: startError?.message });
  return { brainActor: undefined, runningRootFlowId: undefined, rootRunId: undefined, startError, startErrorReported: clientConnected };
}

/** The brain's state (`BRAIN_STATE`). Inspection is restored from the settings, on by default in development */
function brainState(context: BrainContext, paused: boolean): Extract<OutgoingBrainEvents, { type: 'BRAIN_STATE' }> {
  const inspectEnabled = featureSettings.forFeature('brain').get()?.inspectEnabled ?? (process.env.NODE_ENV !== 'production');
  setDebugEnabled('brain', inspectEnabled);
  return {
    type: 'BRAIN_STATE',
    ...(context.brainActor && context.runningRootFlowId
      ? { rootFlowId: context.runningRootFlowId }
      : { startError: context.startError?.message }),
    paused,
    inspectEnabled,
  };
}

export const brainSystem = setup({
  types: brainSpec.types,
  actions: brainSpec.actions({
    logError: ({ event }) => {
      logger.error('Brain system error', { error: (event as any).error });
    },
    startBrain: enqueueActions(({ context, enqueue }) => {
      // Defensive: clear stale flow actor references before starting new brain.
      // restartBrain/killBrain already do this, but startBrain must also guard
      // against leaks from lifecycle paths that bypass those actions.
      clearFlowActorRegistry();

      // Stop existing brain if any using enqueue.stopChild
      if (context.brainActor) {
        enqueue.stopChild(context.brainActor);
      }

      // Starts unpaused (a pause from an earlier run doesn't carry over)
      setBrainPausedState(false);

      const currentRootFlowId = rootFlowToRun();
      // Nothing to run: `running` leaves for `stopped` without a brain actor
      if (!currentRootFlowId) {
        enqueue.assign(stopWithoutRootFlow(context));
        return;
      }

      // Start new brain and assign to context
      enqueue.assign(({ spawn, self }) => {
        const { machine, runNodeId } = createFlowNodeSystem(self)
        const actor = spawn(machine, {
          input: {}
        });

        logger.info('Started brain root flow', { flowId: currentRootFlowId });

        // Return the updated context with the actor reference
        return {
          brainActor: actor,
          runningRootFlowId: currentRootFlowId,
          rootRunId: runNodeId,
          startError: undefined,
        };
      });

      // News for every window, each of which asks for the new run's tree
      enqueue(({ context }) => {
        if (context.brainActor && context.runningRootFlowId) {
          broadcastToSurface('brain', {
            type: 'BRAIN_STARTED',
            rootFlowId: context.runningRootFlowId,
          });
        }
      });
      enqueue('notifyClientReady');
    }),

    // A root run receives readiness once: on the first client, or when restarted after that client.
    notifyClientReady: enqueueActions(({ context, enqueue }) => {
      if (!context.clientConnected || !context.brainActor) return;
      // Address this actor instance, so delayed or paused delivery cannot reach a replacement root.
      enqueue.sendTo(context.brainActor, { type: 'client.ready' }, { delay: 0 });
    }),
    setClientConnected: enqueueActions(({ context, enqueue }) => {
      if (context.clientConnected) return;
      enqueue.assign({ clientConnected: true });
      enqueue('notifyClientReady');
    }),

    /** A client connected while the brain is stopped: it stays stopped with its start error unless a root flow exists by now */
    refreshStartError: assign({
      startError: ({ context }) => context.startError && noRootFlowError(),
    }),

    /** Report why the brain couldn't start, if no client was told yet: a start before any client connected */
    reportStartError: enqueueActions(({ context, enqueue }) => {
      if (!context.startError || context.startErrorReported) return;
      reportStartError(context.startError);
      enqueue.assign({ startErrorReported: true });
    }),

    killBrain: enqueueActions(({ context, enqueue }) => {
      if (context.brainActor) {
        setBrainPausedState(false);
        enqueue.stopChild(context.brainActor);
        enqueue.assign({ brainActor: undefined, runningRootFlowId: undefined, rootRunId: undefined, eventQueue: [] });

        // The runs it ended stay in the run history, stopped
        services.runHistory.stopActive();

        // Clear all ad-hoc brain event listeners
        removeAllAdHocListeners();

        // Clear all cron schedules
        services.scheduler.clearAllSchedules();

        // Defensive: drop any lingering flow actor references. Exit actions
        // on the stopped actor should unregister themselves, but if pending
        // async work interrupted that path, stale entries would leak here.
        clearFlowActorRegistry();

        // Send BRAIN_KILLED event
        broadcastToSurface('brain', {
            type: 'BRAIN_KILLED'
        });

        logger.info('Brain flow machine killed and its runs stopped');
      }
    }),

    restartBrain: enqueueActions(({ context, enqueue }) => {
      logger.info('Restarting brain flow machine');

      setBrainPausedState(false);

      // Clear event queue
      enqueue.assign({ eventQueue: [] });

      // Kill existing brain using enqueue.stopChild
      if (context.brainActor) {
        enqueue.stopChild(context.brainActor);
      }

      // The runs it ends stay in the run history, stopped
      services.runHistory.stopActive();

      // Clear all ad-hoc brain event listeners
      removeAllAdHocListeners();

      // Clear all cron schedules
      services.scheduler.clearAllSchedules();

      // Defensive: drop any lingering flow actor references. Exit actions
      // on the stopped actor should unregister themselves, but if pending
      // async work interrupted that path, stale entries would leak here.
      clearFlowActorRegistry();

      const currentRootFlowId = rootFlowToRun();
      // Nothing to run: `running` leaves for `stopped` without a brain actor
      if (!currentRootFlowId) {
        enqueue.assign(stopWithoutRootFlow(context));
        return;
      }


      // Start new brain and assign to context
      enqueue.assign(({ spawn, self }) => {
        const { machine, runNodeId } = createFlowNodeSystem(self)
        const actor = spawn(machine, {
          input: {}
        });

        // News for every window, each of which asks for the new run's tree
        broadcastToSurface('brain', {
          type: 'BRAIN_STARTED',
          rootFlowId: currentRootFlowId,
        });

        logger.info('Restarted brain with root flow', { flowId: currentRootFlowId });

        return {
          brainActor: actor,
          runningRootFlowId: currentRootFlowId,
          rootRunId: runNodeId,
          startError: undefined,
        };
      });
      enqueue('notifyClientReady');
    }),
    /**
     * A window's ask for a run's tree — the root run's, or the flow it shows — answered to it alone with the tree and
     * the brain's state, which a window just started has not heard yet
     */
    sendSurfaceData: ({ context, event, self, reply }) => {
      if (!reply) return;
      // Use provided flowRunNodeId or fall back to root
      const flowId = event.type === 'REQUEST_SURFACE_DATA' && event.flowRunNodeId
        ? event.flowRunNodeId as RunNodeId
        : undefined;

      let data: FlowRunNodeData;
      try {
        data = flowId
          ? repository.brainQueries.extendedRunNodeData(flowId)
          : repository.brainQueries.rootData(context.rootRunId);
      } catch {
        // A run the history no longer holds (pruned, or the data replaced)
        data = { flowRunNodeId: '' as EARS.EntityId, runNodeTree: [], possibleEvents: [], flowHierarchy: [] };
      }

      reply({ type: 'RECEIVE_SURFACE_DATA', data });
      reply(brainState(context, self.getSnapshot().matches({ running: 'paused' })));
    },
    /** The brain's state, for every window whenever it is asked to publish: none of it is a row */
    publishBrainState: ({ context, self }) => {
      broadcastToSurface('brain', brainState(context, self.getSnapshot().matches({ running: 'paused' })));
    },
    openRunNode: ({ event, reply }) => {
      const ev = brainSpec.typeOf('OPEN_RUN_NODE', event);
      const runNodeId = ev.runNodeId as RunNodeId;

      // Check if this is a flow RunNode before trying to get extended data
      const runNode = repository.brainQueries.runNodeById(runNodeId);
      if (!runNode || runNode.kind !== 'flow') {
        // Silently ignore non-flow RunNodes
        return;
      }

      const data = repository.brainQueries.extendedRunNodeData(runNodeId);

      reply?.({
        type: 'RUN_NODE_OPENED',
        runNodeId,
        data
      });
    },
    goBackRunNode: ({ context, event, reply }) => {
      const currentFlowRunNodeId = brainSpec.typeOf('GO_BACK_RUN_NODE', event).currentFlowRunNodeId as RunNodeId | undefined;
      const parentFlow = currentFlowRunNodeId ? repository.brainQueries.parentFlowOf(currentFlowRunNodeId) : undefined;

      const data = parentFlow
        ? repository.brainQueries.extendedRunNodeData(parentFlow.id)
        : repository.brainQueries.rootData(context.rootRunId);

      reply?.({
        type: 'RUN_NODE_OPENED',
        runNodeId: data.flowRunNodeId,
        data
      });
    },
    getRunNodeDetails: ({ event, reply }) => {
      const ev = brainSpec.typeOf('GET_RUN_NODE_DETAILS', event);
      const runNodeId = ev.runNodeId as RunNodeId;

      const runNode = repository.brainQueries.runNodeById(runNodeId);
      const revealIn = repository.brainQueries.revealIn(runNodeId);

      reply?.({
        type: 'RUN_NODE_DETAILS',
        runNodeId,
        // An event is JSON, where a missing RunNode has to be said: null
        details: runNode ? { ...runNode, ...(revealIn && { revealIn }) } : null
      });
    },
    toggleInspect: () => {
      const currentState = isDebugEnabled('brain');
      const newState = !currentState;
      setDebugEnabled('brain', newState);

      // Persist to settings DB
      featureSettings.forFeature('brain').set({ path: ['inspectEnabled'], value: newState });

      // Send confirmation back to frontend
      broadcastToSurface('brain', {
        type: 'INSPECT_TOGGLED',
        enabled: newState
      });
    },
    queueBrainEvent: assign(({ context, event }) => {
      const ev = brainSpec.typeOf(['TRIGGER_BRAIN_EVENT', 'HANDLE_BRAIN_EVENT'], event);
      return {
        eventQueue: [...context.eventQueue, { eventType: ev.eventType, payload: ev.payload, targetFlowId: ev.targetFlowId }]
      };
    }),
    replayQueuedEvents: enqueueActions(({ context, enqueue }) => {
      for (const queuedEvent of context.eventQueue) {
        enqueue.raise({
          type: 'HANDLE_BRAIN_EVENT',
          eventType: queuedEvent.eventType,
          payload: queuedEvent.payload,
          targetFlowId: queuedEvent.targetFlowId,
        }, { delay: 0 });
      }
      enqueue.assign({ eventQueue: [] });
    }),
    triggerBrainEvent: ({ event }) => {
      const ev = brainSpec.typeOf(['TRIGGER_BRAIN_EVENT', 'HANDLE_BRAIN_EVENT'], event);
      const { eventType, payload, targetFlowId } = ev;

      // Pulse the event in UI
      broadcastToSurface('brain', {
        type: 'EVENT_PULSE',
        eventType: eventType
      });

      // Handle local vs global events
      if (targetFlowId) {
        // LOCAL EVENT: Send to specific flow only
        const targetActor = getFlowActor(targetFlowId as EARS.EntityId);

        if (targetActor?.send) {
          targetActor.send({
            type: eventType,
            payload,
            targetFlowId
          });
        } else {
          logger.error(`Target flow actor not found: ${eventType}`, { targetFlowId });
        }
      } else {
        // GLOBAL EVENT: Broadcast to ALL registered flow actors
        const allFlowActors = getAllFlowActors();
        const allFlowActorIds = getAllFlowActorIds();

        if (allFlowActors.length === 0) {
          logger.warn(`No flow actors registered to receive global event: ${eventType}`);
        } else {
          logger.info(`Broadcasting global event "${eventType}" to ${allFlowActors.length} flow actors`, {
            eventType,
            actorCount: allFlowActors.length,
            flowActorIds: allFlowActorIds
          });

          // Send to all flow actors (including root and all children)
          allFlowActors.forEach(actor => {
            if (actor?.send) {
              actor.send({
                type: eventType,
                payload,
                // No targetFlowId for global events
              });
            }
          });
        }
      }

      // Notify ad-hoc listeners (after normal flow routing)
      notifyAdHocListeners(eventType, payload, targetFlowId);
    },
  }),
}).createMachine(
  {
    id: 'brain',
    initial: 'running',
    context: () => ({
      brainActor: undefined,
      eventQueue: [],
      startErrorReported: false,
      clientConnected: false,
    }),
    on: {
      SEND_STATE: {
        actions: 'publishBrainState',
      },
      // Kept as a fact: whether a client is attached is not something publishing can say
      CLIENT_CONNECTED: {
        actions: 'setClientConnected',
      },
      REQUEST_SURFACE_DATA: {
        actions: 'sendSurfaceData',
      },
      ERROR: {
        actions: 'logError',
      },
    },
    states: {
      stopped: {
        on: {
          // Stopped, describing itself means working out why it will not start and saying so once. The
          // root's CLIENT_CONNECTED still runs: only the ask is shadowed here
          SEND_STATE: {
            actions: ['refreshStartError', 'publishBrainState', 'reportStartError'],
          },
          START_BRAIN: {
            target: 'running',
          },
          RESTART_BRAIN: {
            target: 'running',
          },
        }
      },
      running: {
        entry: ['startBrain'],
        // Started (or restarted) with no flow to run
        always: { guard: ({ context }) => context.brainActor === undefined, target: 'stopped' },
        initial: 'active',
        on: {
          OPEN_RUN_NODE: {
            actions: 'openRunNode',
          },
          GO_BACK_RUN_NODE: {
            actions: 'goBackRunNode',
          },
          GET_RUN_NODE_DETAILS: {
            actions: 'getRunNodeDetails',
          },
          TOGGLE_INSPECT: {
            actions: 'toggleInspect',
          },
          KILL_BRAIN: {
            actions: 'killBrain',
            target: 'stopped',
          },
          // The rows the running flow is part way through are gone. It stops and does not restart: whether
          // there is a flow worth running afterwards is the caller's to know — a reset makes a root flow and
          // asks, a restored backup may hold anything and tells the user to start it themselves
          DATA_REPLACED: {
            actions: 'killBrain',
            target: 'stopped',
          },
          RESTART_BRAIN: {
            actions: 'restartBrain',
            target: '.active',
          },
          CHILD_COMPLETED: {
            actions: 'killBrain',
            target: 'stopped',
          },
          RUN_NODE_SPAWNED: {
            actions: ({ event }) => {
              // Forward to frontend
              broadcastToSurface('brain', event);
            }
          },
          RUN_NODE_UPDATED: {
            actions: ({ event }) => {
              // Forward to frontend
              broadcastToSurface('brain', event);
            }
          },
        },
        states: {
          active: {
            on: {
              TRIGGER_BRAIN_EVENT: {
                actions: raise(({ event }) => ({
                  ...brainSpec.typeOf('TRIGGER_BRAIN_EVENT', event),
                  type: 'HANDLE_BRAIN_EVENT',
                }), { delay: 0 }),
              },
              HANDLE_BRAIN_EVENT: {
                actions: 'triggerBrainEvent',
              },
              PAUSE_BRAIN: {
                target: 'paused',
                actions: () => {
                  setBrainPausedState(true);
                  broadcastToSurface('brain', { type: 'BRAIN_PAUSED' });
                },
              },
            },
          },
          paused: {
            on: {
              TRIGGER_BRAIN_EVENT: {
                actions: 'queueBrainEvent',
              },
              HANDLE_BRAIN_EVENT: {
                actions: 'queueBrainEvent',
              },
              RESUME_BRAIN: {
                target: 'active',
                actions: [
                  () => {
                    setBrainPausedState(false);
                    // Resume deferred steps in all active flows
                    for (const actor of getAllFlowActors()) {
                      actor.send({ type: 'RESUME_FLOW' });
                    }
                  },
                  'replayQueuedEvents',
                  () => {
                    broadcastToSurface('brain', { type: 'BRAIN_RESUMED' });
                  },
                ],
              },
            },
          },
        },
      }
    },
  }
);

const brainEntry = { spec: brainSpec, machine: brainSystem };

export default brainEntry;
