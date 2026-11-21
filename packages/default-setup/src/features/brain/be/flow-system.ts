import { tell } from '#generated/events.ts';
import { untypedQuery } from '@apackdev/sdk/ears';
import { services as appServices, servicesForAction as ownServicesForAction } from '#generated/services.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, sendParent, enqueueActions, raise, type AnyActorRef, type AnyStateMachine } from 'xstate';
import type { NodeEntity } from '#generated/types.ts';
import { repository } from '#generated/repository.ts';

import { stepRegistry } from '@apackdev/sdk/steps';
import { createStepNodeSystem } from './step-system.ts';
import { EARS } from '#generated/ears.ts';
import type { ExecutionContext, RunNodeId, StepInput } from '@apackdev/sdk/steps';
import { safeEvents } from '@apackdev/sdk/helpers';
import { brainRuntime } from './system.ts';
import { brainLogger } from './utils/brain-inspect.ts';
import { isBrainPaused } from './utils/brain-pause.ts';
import { isPersistentTriggerFlow, shouldCompleteFlow } from './flow-completion.ts';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { dedupeTriggerNodes, type FlowTriggerNode, type TriggerDedupeWarning } from './trigger-dedupe.ts';

/**
 * Hands each handler the answer for the message it is handling — see `defineHandlers`.
 *
 * The event union is this machine's own and open-ended (a flow's children send it whatever their step
 * declares), so it is named loosely here; what the wrapper needs is the context and an event shape.
 */
const handlers = defineHandlers<RunNodeFlowMachineContext, { type: string; [key: string]: unknown }>();

/**
 * Flow Actor Registry
 * Maps flowRunNodeId (instance ID) to actor reference for event routing
 */
const flowActorRegistry = new Map<EARS.EntityId, any>();

/**
 * Get flow actor from registry by flowRunNodeId
 */
export function getFlowActor(flowRunNodeId: EARS.EntityId): any | undefined {
  return flowActorRegistry.get(flowRunNodeId);
}

/**
 * Get all registered flow actors for global event broadcasting
 */
export function getAllFlowActors(): any[] {
  return Array.from(flowActorRegistry.values());
}

/**
 * Get all registered flow actor IDs for debugging/logging
 */
export function getAllFlowActorIds(): EARS.EntityId[] {
  return Array.from(flowActorRegistry.keys());
}

/**
 * Clear the entire flow actor registry. Called defensively during brain
 * restart/kill so no stale references survive an `enqueue.stopChild` whose
 * exit action may have been interrupted (e.g. forcibly stopped actor with
 * pending async work).
 */
export function clearFlowActorRegistry(): void {
  flowActorRegistry.clear();
}

function logTriggerDedupeWarnings(warnings: TriggerDedupeWarning[]): void {
  for (const warning of warnings) {
    brainLogger.warn(
      'Duplicate brain trigger trackKey skipped',
      warning,
    );
  }
}

type RunNodeFlowMachineContext = {
  flowId: EARS.EntityId;
  flowLabel: string;
  flowStepNodeId?: EARS.EntityId;  // The original flow step node ID (for completion tracking)
  flowStepLabel?: string;  // The flow step node label (for $.steps[label] references)
  eventRunNodeId?: RunNodeId;
  eventNodes: FlowTriggerNode[];
  // Map of event track execution contexts by eventRunNodeId
  eventTrackContexts: Record<EARS.EntityId, ExecutionContext>;
  // Per-event-track live child counter, keyed by eventRunNodeId.
  // Decrements as children in the track complete; when a track reaches 0
  // the event RunNode itself is marked completed. Finite entry-only flows complete
  // once all active tracks drain; persistent trigger flows stay alive.
  eventTrackChildCounts: Record<EARS.EntityId, number>;
  // Final result when a step completes with final flag
  finalResult?: any;
  // Entry data for nested flows (resolved from field mappings)
  entryData?: any;
  // The steps a subflow's entry track starts with: its parent's, when the subflow inherits its context
  entrySteps: Pick<ExecutionContext, 'steps' | 'lastStep'>;
  // Whether this flow node itself is marked as final
  isFinalStep?: boolean;
  // Whether this flow should wait for future schedule events after a track drains
  hasPersistentTriggers: boolean;
  // Flow hierarchy tracking
  hasParent: boolean; // Whether this flow has a parent flow
  isRootFlow: boolean; // Flag to identify root flow
  // Deferred next-steps when brain is paused
  pendingNextSteps: Array<{
    nextNode: NodeEntity;
    eventRunNodeId: RunNodeId;
    executionContext: ExecutionContext;
    parentRunNodeId?: RunNodeId;
  }>;
  // Deferred events when brain is paused (replayed on resume)
  pendingEvents: Array<Record<string, any>>;
};

type ChildCompletedEvent =
  | {
    type: 'CHILD_COMPLETED';
    stepId?: EARS.EntityId;
    runNodeId?: RunNodeId;
    stepLabel?: string;
    result?: any;
    failed?: boolean;
    final?: boolean;
    eventRunNodeId?: RunNodeId;
    isFlow?: boolean; // Simple flag to indicate if completing child was a flow
  }
  | { type: 'KILL_FLOW' }
  | { type: 'RESUME_FLOW' }
  | { type: 'RUN_NODE_UPDATED'; data: { runNodeId: RunNodeId; status: string; eventRunNodeId?: RunNodeId } }
  | { type: 'FIRE_LOCAL_EVENT'; eventType: string; payload?: any };

type RunNodeFlowMachineInput = {};

/** What a flow's machine handles: its own events, and whatever event one of its tracks listens for */
type FlowMachineEvent =
  | ChildCompletedEvent
  | { type: 'FLOW_COMPLETE' }
  | {
    type: string;
    [key: string]: any;
  };

const typeOf = safeEvents<FlowMachineEvent>();

/**
 * Creates a child node (flow or step) and returns the machine, system ID, and runNode
 * @param stepOrFlowNode - The node entity to create
 * @param eventRunNodeId - The event track node ID that spawned this node
 * @param executionContext - The execution context for the step
 * @returns Tuple of [machine, childId, runNode]
 */
function createChildNode(
  brain: AnyActorRef,
  stepOrFlowNode: NodeEntity,
  eventRunNodeId: RunNodeId,
  executionContext?: ExecutionContext,
  parentRunNodeId?: RunNodeId,
) {
  if (!stepOrFlowNode?.id) {
    throw new Error(`Invalid node passed to createChildNode: ${JSON.stringify(stepOrFlowNode)}`);
  }

  const spawnParent = parentRunNodeId ?? eventRunNodeId;
  const stepDef = stepRegistry.get(stepOrFlowNode.nodeType);
  const spawnsSubflow = stepDef?.runtime?.spawnsSubflow ?? false;
  const { machine, runNodeId, runNode } = spawnsSubflow
    ? createFlowNodeSystem(brain, stepOrFlowNode.id, eventRunNodeId, executionContext, true, spawnParent)
    : createStepNodeSystem(brain, stepOrFlowNode.id, eventRunNodeId, executionContext, spawnParent);

  const childId = `${spawnsSubflow ? 'flow' : 'step'}-run-node-${runNodeId}`;

  return [machine, childId, runNode] as const;
}

/**
 * Spawns a flow's child (a step or a subflow) under its own id, the key the parent tracks it by: without one
 * every child shares a key, so stopping this flow stops only the last one spawned and the rest keep running.
 * The child is the flow's own, so it has no system id.
 *
 * XState types `id` from a machine's declared children, and a flow's are dynamic — one per run node —
 * so the id is passed through this one cast rather than at each call site.
 */
function spawnFlowChild(
  enqueue: unknown,
  machine: AnyStateMachine,
  childId: string,
): void {
  const spawner = enqueue as { spawnChild(logic: AnyStateMachine, options: { id: string; input: object }): void };
  spawner.spawnChild(machine, { id: childId, input: {} });
}

/**
 * What a subflow's `flow.entry` track starts with. Its event data holds the subflow step's mapped fields; when the
 * step inherits (`inherit`, stored as `propagateCtx`, default true) they sit over the parent track's event data, and
 * the track starts with the parent track's steps and last step.
 */
function subflowEntry(
  input: StepInput,
  parent: ExecutionContext | undefined,
): { data: Record<string, unknown>; steps: RunNodeFlowMachineContext['entrySteps'] } {
  const mapped = input.params;
  if (!parent || input.settings.propagateCtx === false) {
    return { data: { ...mapped }, steps: { steps: [], lastStep: undefined } };
  }
  const parentData = parent.event?.data;
  const inherited = parentData !== null && typeof parentData === 'object' && !Array.isArray(parentData) ? parentData : {};
  return {
    data: { ...inherited, ...mapped },
    steps: { steps: parent.steps, lastStep: parent.lastStep },
  };
}

/**
 * Create a dynamic state machine for a flow that listens to its events. `brain` is the brain system that runs it,
 * which its steps and subflows report to directly: a parent flow finishing on a child's report stops before a
 * report routed through the bus would reach it.
 */
export function createFlowNodeSystem(
  brain: AnyActorRef,
  flowId?: EARS.EntityId,
  eventRunNodeId?: RunNodeId,
  executionContext?: ExecutionContext,
  hasParent: boolean = false,
  parentRunNodeId?: RunNodeId,
) {
  const servicesForAction = executionContext ? executionContext.runtime.servicesForAction : ownServicesForAction;
  const isRootFlow = !flowId;

  // Use ternary to determine which creation function to call
  const result = isRootFlow
    ? (() => {
      const { rootFlow, rootFlowRunNode } = repository.brainCommands.createRootFlowRunNode();
      return {
        actualFlowId: rootFlow.id,
        flowRunNodeId: rootFlowRunNode.id,
        flowRunNode: rootFlowRunNode,
        input: undefined,
      };
    })()
    : (() => {
      const { flowRunNode, flowId: referencedFlowId, input } = repository.brainCommands.createFlowRunNode(
        flowId,
        parentRunNodeId ?? eventRunNodeId,
        executionContext
      );
      return {
        actualFlowId: referencedFlowId,
        flowRunNodeId: flowRunNode.id,
        flowRunNode,
        input,
      };
    })();

  const { actualFlowId, flowRunNodeId, flowRunNode } = result;
  // The root flow starts with no data; a subflow with its step's input, whole
  const entry = result.input
    ? subflowEntry(result.input, executionContext)
    : { data: undefined, steps: { steps: [], lastStep: undefined } };

  // Query all registered trigger nodes (listeners, schedules, etc.)
  const rawTriggerNodes: FlowTriggerNode[] = [];
  for (const def of stepRegistry.triggers()) {
    const fields = ['id', 'nodeType', 'label', 'trackKey', ...(def.trigger?.queryFields || [])] as const;
    // Untyped: each trigger names its own fields, which only some step node types have
    const triggerNodes = untypedQuery.ids(actualFlowId)
      .out(EARS.RelKind.CONTAINS, [EARS.Entity.Node]).pick(fields)
      .filter((n: any) => n.nodeType === def.type);
    for (const n of triggerNodes as any[]) {
      rawTriggerNodes.push({
        id: n.id,
        label: n.label,
        eventType: `${def.type}.${n.id}`,
        triggerType: def.type,
        trackKey: n.trackKey,
        ...n,
      });
    }
  }
  const dedupedTriggers = dedupeTriggerNodes(
    rawTriggerNodes,
    { flowId: actualFlowId, flowRunNodeId },
  );
  logTriggerDedupeWarnings(dedupedTriggers.warnings);
  const allTriggerNodes = dedupedTriggers.nodes;

  const eventHandlers: Record<string, any> = {};
  allTriggerNodes.forEach((node) => {
    if (!node.eventType) return;
    eventHandlers[node.eventType] = {
      actions: ['handleTrackEvent'],
    };
  });
  const hasPersistentTriggers = isPersistentTriggerFlow(allTriggerNodes);

  return {
    runNodeId: flowRunNodeId,
    runNode: flowRunNode,
    machine: setup({
      types: {
        context: {} as RunNodeFlowMachineContext,
        events: {} as FlowMachineEvent,
        input: {} as RunNodeFlowMachineInput,
      },
      actions: handlers.actions({
        registerFlowActor: ({ self }) => {
          // Register this flow actor in the registry for event routing
          flowActorRegistry.set(flowRunNodeId, self);
          brainLogger.debug(`Registered flow actor: ${flowRunNodeId} (registry size: ${flowActorRegistry.size})`);

          // Register runtime hooks for registered trigger types (skip nodes with no downstream steps)
          for (const sn of allTriggerNodes) {
            const triggerFacet = stepRegistry.getTrigger(sn.triggerType);
            if (!triggerFacet?.register) continue;
            const hasSteps = repository.brainQueries.eventAllSteps(sn.id as EARS.EntityId).length > 0;
            if (!hasSteps) continue;
            triggerFacet.register(sn as any, { flowRunNodeId, tell });
          }
        },
        unregisterFlowActor: () => {
          // Clean up this flow actor from the registry
          flowActorRegistry.delete(flowRunNodeId);
          // Clean up all cron jobs for this flow actor
          appServices.scheduler.unregisterByPrefix(flowRunNodeId);
          brainLogger.debug(`Unregistered flow actor: ${flowRunNodeId}`);
        },
        handleTrackEvent: enqueueActions(({ context, event, enqueue }) => {
          const typedEv: { type: string; [key: string]: any } = event;
          const eventType = typedEv.type;

          // Brain is paused — defer the raw event for replay on resume
          if (isBrainPaused()) {
            enqueue.assign({
              pendingEvents: ({ context }) => [...context.pendingEvents, { ...typedEv }],
            });
            brainLogger.debug(`Flow ${flowRunNodeId} deferring event "${eventType}" (brain paused)`);
            return;
          }

          const matchingEventNodes = context.eventNodes.filter((n) => n.eventType === eventType);

          if (matchingEventNodes.length === 0) return;

          for (const eventNode of matchingEventNodes) {
            const allSteps = repository.brainQueries.eventAllSteps(eventNode.id as EARS.EntityId);

            if (allSteps.length === 0) {
              createLogger('brain').debug(`No steps found for event ${eventType} on node ${eventNode.id}, skipping`);
              continue; // Skip this event node but process others
            }

            // Handle flow.entry events specially - they have a 'data' property we need to unwrap
            const { type: _type, ...eventPayload } = typedEv;
            const eventData = 'data' in eventPayload ? eventPayload.data : eventPayload;

            // The event node keeps the payload as its attributes: the event's own, or the whole event without one
            const payloadToStore = eventData.payload !== undefined ? eventData.payload : eventData;
            const eventRunNode = repository.brainCommands.createEventRunNode(eventNode, flowRunNodeId, payloadToStore);

            // Emit RUN_NODE_SPAWNED event for UI to display event RunNode
            brain.send({
              type: 'RUN_NODE_SPAWNED',
              runNode: eventRunNode,
              parentId: flowRunNodeId,
              eventRunNodeId: eventRunNode.id,
              flowRunNodeId: flowRunNodeId
            });

            const eventTrackContext: ExecutionContext = {
              flowRunNodeId: flowRunNodeId,
              event: {
                type: eventType,
                data: eventData,
                timestamp: Date.now(),
              },
              ...(eventType === 'flow.entry' ? context.entrySteps : { steps: [], lastStep: undefined }),
              runtime: {
                getFlowActor,
                servicesForAction,
              },
            };

            // Spawn ALL connected downstream steps in parallel
            let spawnedCount = 0;
            for (const step of allSteps) {
              try {
                const [machine, childId, childRunNode] = createChildNode(
                  brain,
                  step,
                  eventRunNode.id,
                  eventTrackContext
                );

                // Spawn child (both flows and steps)
                spawnFlowChild(enqueue, machine, childId);

                // Emit RUN_NODE_SPAWNED event for the UI to display child node
                brain.send({
                  type: 'RUN_NODE_SPAWNED',
                  runNode: childRunNode,
                  parentId: eventRunNode.id,
                  eventRunNodeId: eventRunNode.id,
                  flowRunNodeId: flowRunNodeId
                });

                spawnedCount++;
              } catch (err) {
                reportError({
                  error: err,
                  source: 'brain-flow',
                  step: {
                    phase: 'child.spawn',
                    flowRunNodeId,
                    eventRunNodeId: eventRunNode.id,
                    nodeId: step.id,
                    nodeLabel: step.label,
                    nodeType: step.nodeType,
                    eventType,
                  },
                });
              }
            }

            // Store the execution context and initial live-child count for this event track
            enqueue.assign({
              eventTrackContexts: ({ context }) => ({
                ...context.eventTrackContexts,
                [eventRunNode.id]: eventTrackContext,
              }),
              eventTrackChildCounts: ({ context }) => ({
                ...context.eventTrackChildCounts,
                [eventRunNode.id]: spawnedCount,
              }),
            });

          }
        }),
        handleChildCompletion: enqueueActions(({ context, event, enqueue }) => {
          brainLogger.debug(`Child completed in flow - ${context.flowLabel}:`, { completion: event });
          const typedEv = typeOf('CHILD_COMPLETED', event);

          if (typedEv.final) {
            brainLogger.debug(`Flow ${flowRunNodeId} received child completion with final=true from ${typedEv.stepId || typedEv.runNodeId}`);
          }
          const childFailed = typedEv.failed === true || typedEv.result?.error !== undefined;

          if (!typedEv.eventRunNodeId) {
            brainLogger.warn(`Child completed in flow - ${context.flowLabel}: But missing event RunNode ID`, { completion: event });
            return;
          }

          // Resolve the next node in this track (if any):
          // - sourceHandle → specific branch (switch nodes)
          // - noMatch → terminate this branch here
          // - otherwise → straight-line next step
          const sourceHandle = typedEv.result?.sourceHandle;
          const noMatch = (typedEv.result as { noMatch?: boolean } | undefined)?.noMatch === true;
          const nextNode = typedEv.stepId && !noMatch && !childFailed
            ? sourceHandle
              ? repository.brainQueries.nextNodeForBranch(typedEv.stepId, sourceHandle)
              : repository.brainQueries.nextNodeInFlowTrack(typedEv.stepId)
            : null;

          const trackExecutionContext = context.eventTrackContexts[typedEv.eventRunNodeId];
          if (!trackExecutionContext) {
            brainLogger.warn(`Child completed in flow - ${context.flowLabel}: But no execution context found for event RunNode ID ${typedEv.eventRunNodeId}`, { completion: event });
            return;
          }

          const lastStep = {
            id: typedEv.runNodeId,          // Its run node's id (always present)
            label: typedEv.stepLabel || '',
            result: typedEv.result,
            timestamp: Date.now(),
          };

          const updatedContext: ExecutionContext = {
            ...trackExecutionContext,
            steps: [...trackExecutionContext.steps, lastStep],
            lastStep,
          };

          // Per-track live-child bookkeeping (single source of truth):
          //   -1 for the child that just finished, +1 if a nextNode takes its place.
          // When a track reaches 0 the event RunNode is completed. Finite entry-only
          // flows complete once all active tracks drain; schedule-triggered flows
          // stay active for future ticks unless an explicit final step completes.
          const prevTrackCount = context.eventTrackChildCounts[typedEv.eventRunNodeId] ?? 0;
          const newTrackCount = Math.max(0, prevTrackCount - 1) + (nextNode ? 1 : 0);
          const eventTrackCompleted = newTrackCount === 0;

          const nextTrackCounts = {
            ...context.eventTrackChildCounts,
            [typedEv.eventRunNodeId]: newTrackCount,
          };
          const allTracksDrained = Object.values(nextTrackCounts).every(c => c === 0);
          const shouldComplete = !childFailed && shouldCompleteFlow({
            final: !!typedEv.final,
            allTracksDrained,
            hasPersistentTriggers: context.hasPersistentTriggers,
          });

          enqueue.assign({
            eventTrackContexts: {
              ...context.eventTrackContexts,
              [typedEv.eventRunNodeId]: updatedContext,
            },
            eventTrackChildCounts: nextTrackCounts,
            finalResult: shouldComplete && typedEv.result !== undefined
              ? typedEv.result
              : context.finalResult,
          });

          // Mark listener RunNode completed once its track drains. This reuses the
          // same RUN_NODE_UPDATED pipeline that step/flow completions flow through.
          if (eventTrackCompleted) {
            appServices.runHistory.finish(typedEv.eventRunNodeId, 'completed');
            brain.send({
              type: 'RUN_NODE_UPDATED',
              data: {
                runNodeId: typedEv.eventRunNodeId,
                status: 'completed',
                eventRunNodeId: typedEv.eventRunNodeId,
              },
            });
          }

          if (shouldComplete) {
            enqueue.raise({ type: 'FLOW_COMPLETE' });
          } else if (nextNode && isBrainPaused()) {
            // Brain is paused — defer spawning the next step
            brainLogger.debug(`Flow ${flowRunNodeId} deferring next step (brain paused)`, { nextNodeId: nextNode.id });
            enqueue.assign({
              pendingNextSteps: ({ context }) => [
                ...context.pendingNextSteps,
                {
                  nextNode,
                  eventRunNodeId: typedEv.eventRunNodeId!,
                  executionContext: updatedContext,
                  parentRunNodeId: typedEv.runNodeId,
                },
              ],
            });
          } else if (nextNode) {
            // Spawn next node - already computed above, no duplicate query needed
            try {
              const [nextMachine, nextSystemId, nextRunNode] = createChildNode(
                brain,
                nextNode,
                typedEv.eventRunNodeId,
                updatedContext,
                typedEv.runNodeId
              );

              // Spawn next child (both flows and steps)
              spawnFlowChild(enqueue, nextMachine, nextSystemId);

              // Emit RUN_NODE_SPAWNED event for the next node
              brain.send({
                type: 'RUN_NODE_SPAWNED',
                runNode: nextRunNode,
                parentId: typedEv.runNodeId,
                eventRunNodeId: typedEv.eventRunNodeId,
                flowRunNodeId: flowRunNodeId
              });
            } catch (err) {
              reportError({
                error: err,
                source: 'brain-flow',
                step: {
                  phase: 'child.spawn-next',
                  flowRunNodeId,
                  eventRunNodeId: typedEv.eventRunNodeId,
                  runNodeId: typedEv.runNodeId,
                  nodeId: nextNode.id,
                  nodeLabel: nextNode.label,
                  nodeType: nextNode.nodeType,
                  eventType: trackExecutionContext.event?.type,
                },
              });
            }
          }
        }),
        markFlowCompleted: ({ context }) => {
          brainLogger.debug(`Flow ${flowRunNodeId} completed (isFinalStep: ${context.isFinalStep})`);
          // The flow's result goes on its node, where the details panel shows it
          if (context.finalResult !== undefined) appServices.runHistory.update(flowRunNodeId, { result: context.finalResult });
          appServices.runHistory.finish(flowRunNodeId, 'completed');

          // Emit RUN_NODE_UPDATED event
          brain.send({
            type: 'RUN_NODE_UPDATED',
            data: {
              runNodeId: flowRunNodeId,
              status: 'completed',
              eventRunNodeId: eventRunNodeId
            }
          });
        },
        notifyParentOfCompletion: sendParent(({ context }) => ({
          type: 'CHILD_COMPLETED',
          stepId: context.flowStepNodeId,  // Blueprint Node ID (undefined for root flow)
          runNodeId: flowRunNodeId,             // Its run node's id (always defined)
          stepLabel: context.flowStepLabel,
          eventRunNodeId: context.eventRunNodeId,
          result: context.finalResult,
          final: context.isFinalStep,
          isFlow: true,  // Indicate this is a flow completion
        })),
        raiseEntryEvent: raise(({ context }) => ({
          type: 'flow.entry',
          ...(context.entryData !== undefined && { data: context.entryData })
        })),
        forwardRunNodeUpdate: sendParent(({ event }) => event),
        resumeFlowSteps: enqueueActions(({ context, enqueue }) => {
          brainLogger.debug(`Flow ${flowRunNodeId} resuming ${context.pendingNextSteps.length} deferred steps, ${context.pendingEvents.length} deferred events`);

          // Resume deferred next-steps
          for (const pending of context.pendingNextSteps) {
            try {
              const [machine, childId, runNode] = createChildNode(
                brain,
                pending.nextNode,
                pending.eventRunNodeId,
                pending.executionContext,
                pending.parentRunNodeId
              );

              spawnFlowChild(enqueue, machine, childId);

              brain.send({
                type: 'RUN_NODE_SPAWNED',
                runNode,
                parentId: pending.parentRunNodeId ?? pending.eventRunNodeId,
                eventRunNodeId: pending.eventRunNodeId,
                flowRunNodeId: flowRunNodeId
              });
            } catch (err) {
              reportError({
                error: err,
                source: 'brain-flow',
                step: {
                  phase: 'child.resume',
                  flowRunNodeId,
                  eventRunNodeId: pending.eventRunNodeId,
                  runNodeId: pending.parentRunNodeId,
                  nodeId: pending.nextNode.id,
                  nodeLabel: pending.nextNode.label,
                  nodeType: pending.nextNode.nodeType,
                  eventType: pending.executionContext.event?.type,
                },
              });
            }
          }

          // Replay deferred events — handleTrackEvent processes them normally since brain is unpaused
          for (const pendingEvent of context.pendingEvents) {
            enqueue.raise(pendingEvent as any);
          }

          enqueue.assign({ pendingNextSteps: [], pendingEvents: [] });
        }),
      }),
      guards: {},
    }).createMachine({
      id: isRootFlow ? brainRuntime : `run-node-${flowRunNodeId}`,
      initial: 'active',
      context: () => ({
        flowId: actualFlowId,
        flowLabel: flowRunNode?.label || 'Unknown Flow',
        flowStepNodeId: flowRunNode?.nodeId,  // Store the original flow step node ID
        flowStepLabel: flowRunNode?.label,  // Store the flow step node label for references
        eventRunNodeId: eventRunNodeId,
        eventNodes: allTriggerNodes,
        eventTrackContexts: {},
        eventTrackChildCounts: {},
        finalResult: undefined,
        entryData: entry.data,
        entrySteps: entry.steps,
        isFinalStep: flowRunNode?.final || false,
        hasPersistentTriggers,
        hasParent: hasParent,
        isRootFlow: isRootFlow,
        pendingNextSteps: [],
        pendingEvents: [],
      }),
      on: {
        ...eventHandlers,
        CHILD_COMPLETED: {
          actions: ['handleChildCompletion'],
        },
        RUN_NODE_UPDATED: {
          actions: ['forwardRunNodeUpdate'],
        },
        FLOW_COMPLETE: {
          target: '.completed',
        },
        RESUME_FLOW: {
          actions: ['resumeFlowSteps'],
        },
        // Handle local events that are fired within this flow
        FIRE_LOCAL_EVENT: {
          actions: [({ event, self }) => {
            const typedEvent = typeOf('FIRE_LOCAL_EVENT', event);
            // Re-raise the event locally for handling
            if (typedEvent.eventType) {
              self.send({
                type: typedEvent.eventType,
                ...typedEvent.payload
              });
            }
          }]
        },
      },
      states: {
        active: {
          entry: ['registerFlowActor', 'raiseEntryEvent'],
          on: {
            KILL_FLOW: 'completed',
          },
        },
        completed: {
          entry: ['markFlowCompleted', 'notifyParentOfCompletion', 'unregisterFlowActor'],
          type: 'final',
        },
      },
    })
  }
}
