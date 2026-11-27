import { given, type Each, type Read } from '@apackdev/state';
import { tell } from '#generated/events.ts';
import { untypedQuery } from '@apackdev/sdk/ears';
import { services as appServices, servicesForAction as ownServicesForAction } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { state } from '#generated/state.ts';
import { EARS } from '#generated/ears.ts';
import type { NodeEntity } from '#generated/types.ts';
import { stepRegistry, type ExecutionContext, type RunNodeId, type RunTree, type StepInput } from '@apackdev/sdk/steps';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { isPersistentTriggerFlow, shouldCompleteFlow } from './flow-completion.ts';
import { dedupeTriggerNodes, type FlowTriggerNode, type TriggerDedupeWarning } from './trigger-dedupe.ts';
import { brainLogger } from './utils/brain-inspect.ts';
import { stepState, type StepReport, type StepSpec } from './step-system.ts';
import type { BrainFlowSpec, BrainInternalEvents, OutgoingBrainEvents } from './types.ts';

export type FlowReport = BrainInternalEvents;

export interface TrackContextData {
  readonly flowRunNodeId: RunNodeId;
  readonly event: ExecutionContext['event'];
  readonly steps: ExecutionContext['steps'];
  readonly lastStep?: ExecutionContext['lastStep'];
}

interface DeferredNextStep {
  readonly nextNode: NodeEntity;
  readonly eventRunNodeId: RunNodeId;
  readonly executionContext: TrackContextData;
  readonly parentRunNodeId?: RunNodeId;
}

interface DeferredTrackEvent {
  readonly eventType: string;
  readonly payload?: unknown;
  readonly data?: unknown;
  readonly hasData?: boolean;
  readonly targetFlowId?: string;
}

export type FlowEvent =
  | { type: 'TRACK_EVENT'; eventType: string; payload?: unknown; data?: unknown; hasData?: boolean; targetFlowId?: string }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'KILL_FLOW' }
  | {
      type: 'SUBFLOW_COMPLETED';
      subflowRunNodeId: RunNodeId;
      stepId: EARS.EntityId;
      stepLabel: string;
      eventRunNodeId: RunNodeId;
      result?: unknown;
      failed: boolean;
      final: boolean;
    }
  | (StepReport & { from?: string });

function logTriggerDedupeWarnings(warnings: TriggerDedupeWarning[]): void {
  for (const warning of warnings) {
    brainLogger.warn('Duplicate brain trigger trackKey skipped', warning);
  }
}

/** Queries, deduplicates, and classifies all registered trigger nodes for a flow blueprint. */
export function loadFlowTriggers(
  flowId: EARS.EntityId,
  flowRunNodeId: RunNodeId,
): { nodes: FlowTriggerNode[]; hasPersistentTriggers: boolean } {
  const rawTriggerNodes: FlowTriggerNode[] = [];
  for (const def of stepRegistry.triggers()) {
    const fields = ['id', 'nodeType', 'label', 'trackKey', ...(def.trigger?.queryFields || [])] as const;
    // Untyped: each trigger names its own fields, which only some step node types have
    const triggerNodes = untypedQuery.ids(flowId)
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
  const dedupedTriggers = dedupeTriggerNodes(rawTriggerNodes, { flowId, flowRunNodeId });
  logTriggerDedupeWarnings(dedupedTriggers.warnings);
  return {
    nodes: dedupedTriggers.nodes,
    hasPersistentTriggers: isPersistentTriggerFlow(dedupedTriggers.nodes),
  };
}

/**
 * What a subflow's `flow.entry` track starts with. Its event data holds the subflow step's mapped fields; when the
 * step inherits (`inherit`, stored as `propagateCtx`, default true) they sit over the parent track's event data, and
 * the track starts with the parent track's steps and last step.
 */
function subflowEntry(
  input: StepInput,
  parent: Read<TrackContextData> | undefined,
): { data: Record<string, unknown>; steps: Pick<ExecutionContext, 'steps' | 'lastStep'> } {
  const mapped = input.params;
  if (!parent || input.settings.propagateCtx === false) {
    return { data: { ...mapped }, steps: { steps: [], lastStep: undefined } };
  }
  const parentData = parent.event?.data;
  const inherited = parentData !== null && typeof parentData === 'object' && !Array.isArray(parentData) ? parentData : {};
  return {
    data: { ...inherited, ...mapped },
    steps: {
      steps: [...(parent.steps as ExecutionContext['steps'])],
      lastStep: parent.lastStep as ExecutionContext['lastStep'],
    },
  };
}

function toExecutionContext(ctx: Read<TrackContextData>): ExecutionContext {
  return {
    flowRunNodeId: ctx.flowRunNodeId,
    event: ctx.event as ExecutionContext['event'],
    steps: [...(ctx.steps as ExecutionContext['steps'])],
    lastStep: ctx.lastStep as ExecutionContext['lastStep'],
    runtime: {
      killFlow: () => {},
      servicesForAction: ownServicesForAction,
    },
  };
}

/** Guarded update: never mutates a `'stopped'` or already-finished `RunNode`. */
function updateIfActive(id: RunNodeId, patch: { result?: unknown }): boolean {
  const current = appServices.runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  appServices.runHistory.update(id, patch);
  return true;
}

/** Guarded finish: never overwrites a `'stopped'` or already-finished `RunNode`. */
function finishIfActive(id: RunNodeId, status: 'completed' | 'failed'): boolean {
  const current = appServices.runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  appServices.runHistory.finish(id, status);
  return true;
}

/** Guarded stop: marks a still-`'active'` RunNode as `'stopped'` without touching finished nodes. */
function stopIfActive(id: RunNodeId): boolean {
  const current = appServices.runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  appServices.runHistory.finish(id, 'stopped' as 'completed');
  return true;
}

type BrainBroadcast = (to: 'brain', event: Read<OutgoingBrainEvents>) => void;
type FlowReporter = (event: Read<FlowReport>) => void;

/**
 * Marks every still-`'active'` child step, non-drained event, and descendant subflow under `rootId`
 * (and `rootId` itself when `includeSelf` is true) as `'stopped'` in `runHistory` and broadcasts
 * `RUN_NODE_UPDATED` for each stopped node.
 */
export function stopActiveSubtree(
  rootId: RunNodeId,
  broadcast: BrainBroadcast,
  options: { includeSelf?: boolean; parentEventRunNodeId?: RunNodeId } = {},
): void {
  const tree = appServices.runHistory.tree(rootId);
  if (!tree) return;

  const visit = (node: RunTree, currentEventId: RunNodeId | undefined, isRoot: boolean): void => {
    const nextEventId = node.kind === 'event' ? node.id : currentEventId;
    for (const child of node.children) {
      visit(child, nextEventId, false);
    }
    if (!isRoot || options.includeSelf) {
      if (stopIfActive(node.id)) {
        broadcast('brain', {
          type: 'RUN_NODE_UPDATED',
          data: {
            runNodeId: node.id,
            status: 'stopped',
            ...(nextEventId ? { eventRunNodeId: nextEventId } : {}),
          },
        });
      }
    }
  };

  visit(tree, options.parentEventRunNodeId, true);
}

function spawnChildNode(
  stepOrFlowNode: NodeEntity,
  flowRunNodeId: RunNodeId,
  eventRunNodeId: RunNodeId,
  trackCtx: Read<TrackContextData>,
  parentRunNodeId: RunNodeId | undefined,
  nextSteps: Record<string, StepSpec>,
  broadcast: BrainBroadcast,
  report: FlowReporter,
): void {
  if (!stepOrFlowNode?.id) {
    throw new Error(`Invalid node passed to spawnChildNode: ${JSON.stringify(stepOrFlowNode)}`);
  }

  const spawnParent = parentRunNodeId ?? eventRunNodeId;
  const stepDef = stepRegistry.get(stepOrFlowNode.nodeType);
  const spawnsSubflow = stepDef?.runtime?.spawnsSubflow ?? false;
  const execCtx = toExecutionContext(trackCtx);

  if (spawnsSubflow) {
    const { flowRunNode, flowId: referencedFlowId, input } = repository.brainCommands.createFlowRunNode(
      stepOrFlowNode.id,
      spawnParent,
      execCtx,
    );
    const entry = subflowEntry(input, trackCtx);
    const { nodes: eventNodes, hasPersistentTriggers } = loadFlowTriggers(referencedFlowId, flowRunNode.id);

    broadcast('brain', {
      type: 'RUN_NODE_SPAWNED',
      runNode: flowRunNode,
      parentId: spawnParent,
      eventRunNodeId,
      flowRunNodeId,
    });

    report({
      type: 'SPAWN_SUBFLOW',
      spec: {
        flowRunNodeId: flowRunNode.id,
        flowId: referencedFlowId,
        flowLabel: flowRunNode.label || 'Unknown Flow',
        isRootFlow: false,
        parentFlowRunNodeId: flowRunNodeId,
        parentEventRunNodeId: eventRunNodeId,
        flowStepNodeId: flowRunNode.nodeId,
        flowStepLabel: flowRunNode.label,
        isFinalStep: Boolean(flowRunNode.final),
        entryData: entry.data,
        entrySteps: entry.steps,
        eventNodes,
        hasPersistentTriggers,
        startPaused: false,
      },
    });
    return;
  }

  const { runNode, step, input } = repository.brainCommands.createStepRunNode(
    stepOrFlowNode.id,
    spawnParent,
    execCtx,
  );

  broadcast('brain', {
    type: 'RUN_NODE_SPAWNED',
    runNode,
    parentId: spawnParent,
    eventRunNodeId,
    flowRunNodeId,
  });

  nextSteps[runNode.id] = {
    runNodeId: runNode.id,
    flowRunNodeId,
    step,
    input,
    eventRunNodeId,
    event: trackCtx.event as ExecutionContext['event'],
    steps: [...(trackCtx.steps as ExecutionContext['steps'])],
    lastStep: trackCtx.lastStep as ExecutionContext['lastStep'],
  };
}

function completeFlow(
  spec: Read<BrainFlowSpec>,
  finalResult: unknown,
  broadcast: BrainBroadcast,
  report: FlowReporter,
): void {
  brainLogger.debug(`Flow ${spec.flowRunNodeId} completed (isFinalStep: ${spec.isFinalStep})`);
  stopActiveSubtree(spec.flowRunNodeId, broadcast, {
    includeSelf: false,
    parentEventRunNodeId: spec.parentEventRunNodeId,
  });
  if (finalResult !== undefined) {
    updateIfActive(spec.flowRunNodeId, { result: finalResult });
  }
  if (finishIfActive(spec.flowRunNodeId, 'completed')) {
    broadcast('brain', {
      type: 'RUN_NODE_UPDATED',
      data: {
        runNodeId: spec.flowRunNodeId,
        status: 'completed',
        eventRunNodeId: spec.parentEventRunNodeId,
      },
    });
  }
  report({
    type: 'FLOW_COMPLETED',
    flowRunNodeId: spec.flowRunNodeId,
    isRootFlow: spec.isRootFlow,
    parentFlowRunNodeId: spec.parentFlowRunNodeId,
    parentEventRunNodeId: spec.parentEventRunNodeId,
    flowStepNodeId: spec.flowStepNodeId,
    flowStepLabel: spec.flowStepLabel,
    result: finalResult,
    final: spec.isFinalStep,
  });
}

type FlowData = {
  spec: BrainFlowSpec;
  paused: boolean;
  steps: Record<string, StepSpec>;
  eventTrackContexts: Record<string, TrackContextData>;
  eventTrackChildCounts: Record<string, number>;
  pendingNextSteps: DeferredNextStep[];
  pendingEvents: DeferredTrackEvent[];
  finalResult: unknown;
};

type FlowShape = {
  data: FlowData;
  reports: FlowReport;
  states: {
    active: {
      starts: { step: Each<typeof stepState> };
    };
    completed: {};
  };
};

function handleChildCompletion(
  ev: {
    readonly runNodeId: RunNodeId;
    readonly stepId: EARS.EntityId;
    readonly stepLabel: string;
    readonly eventRunNodeId: RunNodeId;
    readonly result?: unknown;
    readonly failed: boolean;
    readonly final: boolean;
    readonly killFlowId?: RunNodeId;
  },
  isStep: boolean,
  data: Read<FlowData>,
  broadcast: BrainBroadcast,
  report: FlowReporter,
) {
  const flowRunNodeId = data.spec.flowRunNodeId;
  const nextSteps: Record<string, StepSpec> = { ...(data.steps as Record<string, StepSpec>) };
  if (isStep) {
    delete nextSteps[ev.runNodeId];
  }

  if (ev.killFlowId) {
    if (ev.killFlowId === flowRunNodeId) {
      const prevTrackCount = data.eventTrackChildCounts[ev.eventRunNodeId] ?? 0;
      const newTrackCount = Math.max(0, prevTrackCount - 1);
      const nextTrackCounts = {
        ...data.eventTrackChildCounts,
        [ev.eventRunNodeId]: newTrackCount,
      };
      if (newTrackCount === 0 && finishIfActive(ev.eventRunNodeId, 'completed')) {
        broadcast('brain', {
          type: 'RUN_NODE_UPDATED',
          data: {
            runNodeId: ev.eventRunNodeId,
            status: 'completed',
            eventRunNodeId: ev.eventRunNodeId,
          },
        });
      }
      completeFlow(data.spec, data.finalResult, broadcast, report);
      return {
        at: 'completed' as const,
        data: {
          steps: nextSteps,
          eventTrackChildCounts: nextTrackCounts,
        },
      };
    }
    report({ type: 'KILL_FLOW', flowRunNodeId: ev.killFlowId });
  }

  if (ev.final) {
    brainLogger.debug(`Flow ${flowRunNodeId} received child completion with final=true from ${ev.stepId || ev.runNodeId}`);
  }

  const resultObj = ev.result !== null && typeof ev.result === 'object'
    ? (ev.result as { error?: unknown; sourceHandle?: string; noMatch?: boolean })
    : undefined;
  const childFailed = ev.failed === true || resultObj?.error !== undefined;

  if (!ev.eventRunNodeId) {
    brainLogger.warn(`Child completed in flow - ${data.spec.flowLabel}: But missing event RunNode ID`, { completion: ev });
    return { data: { steps: nextSteps } };
  }

  const sourceHandle = resultObj?.sourceHandle;
  const noMatch = resultObj?.noMatch === true;
  const nextNode = ev.stepId && !noMatch && !childFailed
    ? sourceHandle
      ? repository.brainQueries.nextNodeForBranch(ev.stepId, sourceHandle)
      : repository.brainQueries.nextNodeInFlowTrack(ev.stepId)
    : null;

  const trackExecutionContext = data.eventTrackContexts[ev.eventRunNodeId];
  if (!trackExecutionContext) {
    brainLogger.warn(
      `Child completed in flow - ${data.spec.flowLabel}: But no execution context found for event RunNode ID ${ev.eventRunNodeId}`,
      { completion: ev },
    );
    return { data: { steps: nextSteps } };
  }

  const lastStep = {
    id: ev.runNodeId,
    label: ev.stepLabel || '',
    result: ev.result,
    timestamp: Date.now(),
  };

  const updatedContext: TrackContextData = {
    flowRunNodeId: trackExecutionContext.flowRunNodeId,
    event: trackExecutionContext.event as ExecutionContext['event'],
    steps: [...(trackExecutionContext.steps as ExecutionContext['steps']), lastStep],
    lastStep,
  };

  const prevTrackCount = data.eventTrackChildCounts[ev.eventRunNodeId] ?? 0;
  const newTrackCount = Math.max(0, prevTrackCount - 1) + (nextNode ? 1 : 0);
  const eventTrackCompleted = newTrackCount === 0;

  const nextTrackCounts: Record<string, number> = {
    ...data.eventTrackChildCounts,
    [ev.eventRunNodeId]: newTrackCount,
  };
  const nextTrackContexts: Record<string, TrackContextData> = {
    ...(data.eventTrackContexts as Record<string, TrackContextData>),
    [ev.eventRunNodeId]: updatedContext,
  };

  const allTracksDrained = Object.values(nextTrackCounts).every((c) => c === 0);
  const shouldComplete = !childFailed && shouldCompleteFlow({
    final: ev.final,
    allTracksDrained,
    hasPersistentTriggers: data.spec.hasPersistentTriggers,
  });

  if (eventTrackCompleted && finishIfActive(ev.eventRunNodeId, 'completed')) {
    broadcast('brain', {
      type: 'RUN_NODE_UPDATED',
      data: {
        runNodeId: ev.eventRunNodeId,
        status: 'completed',
        eventRunNodeId: ev.eventRunNodeId,
      },
    });
  }

  if (shouldComplete) {
    const nextFinalResult = ev.result !== undefined ? ev.result : data.finalResult;
    completeFlow(data.spec, nextFinalResult, broadcast, report);
    return {
      at: 'completed' as const,
      data: {
        steps: nextSteps,
        eventTrackContexts: nextTrackContexts,
        eventTrackChildCounts: nextTrackCounts,
        finalResult: nextFinalResult,
      },
    };
  }

  if (nextNode && data.paused) {
    brainLogger.debug(`Flow ${flowRunNodeId} deferring next step (brain paused)`, { nextNodeId: nextNode.id });
    return {
      data: {
        steps: nextSteps,
        eventTrackContexts: nextTrackContexts,
        eventTrackChildCounts: nextTrackCounts,
        pendingNextSteps: [
          ...(data.pendingNextSteps as DeferredNextStep[]),
          {
            nextNode,
            eventRunNodeId: ev.eventRunNodeId,
            executionContext: updatedContext,
            parentRunNodeId: ev.runNodeId,
          },
        ],
      },
    };
  }

  if (nextNode) {
    try {
      spawnChildNode(
        nextNode,
        flowRunNodeId,
        ev.eventRunNodeId,
        updatedContext,
        ev.runNodeId,
        nextSteps,
        broadcast,
        report,
      );
    } catch (err) {
      reportError({
        error: err,
        source: 'brain-flow',
        step: {
          phase: 'child.spawn-next',
          flowRunNodeId,
          eventRunNodeId: ev.eventRunNodeId,
          runNodeId: ev.runNodeId,
          nodeId: nextNode.id,
          nodeLabel: nextNode.label,
          nodeType: nextNode.nodeType,
          eventType: trackExecutionContext.event?.type,
        },
      });
    }
  }

  return {
    data: {
      steps: nextSteps,
      eventTrackContexts: nextTrackContexts,
      eventTrackChildCounts: nextTrackCounts,
    },
  };
}

export const flowState = state<FlowShape, FlowEvent>()({
  data: {
    spec: given,
    paused: given,
    steps: {},
    eventTrackContexts: {},
    eventTrackChildCounts: {},
    pendingNextSteps: [],
    pendingEvents: [],
    finalResult: undefined,
  },
  initial: 'active',
  states: {
    active: {
      starts: (start) => ({
        step: start(stepState, {
          each: 'steps',
          given: (key, data) => ({ spec: data.steps[key]! }),
        }),
      }),
      run: ({ data, send, onExit }) => {
        const flowRunNodeId = data.spec.flowRunNodeId;
        onExit(() => {
          appServices.scheduler.unregisterByPrefix(flowRunNodeId);
        });

        // Register runtime hooks for registered trigger types (skip nodes with no downstream steps)
        for (const sn of data.spec.eventNodes) {
          const triggerFacet = stepRegistry.getTrigger(sn.triggerType);
          if (!triggerFacet?.register) continue;
          const hasSteps = repository.brainQueries.eventAllSteps(sn.id as EARS.EntityId).length > 0;
          if (!hasSteps) continue;
          triggerFacet.register(sn as any, { flowRunNodeId, tell });
        }

        // Raise flow.entry track
        send({
          type: 'TRACK_EVENT',
          eventType: 'flow.entry',
          ...(data.spec.entryData !== undefined ? { hasData: true, data: data.spec.entryData } : {}),
        });
      },
      on: {
        KILL_FLOW: (ev, { data, broadcast, report }) => {
          const target = 'flowRunNodeId' in ev ? ev.flowRunNodeId : data.spec.flowRunNodeId;
          if (target !== data.spec.flowRunNodeId) {
            report({ type: 'KILL_FLOW', flowRunNodeId: target });
            return;
          }
          completeFlow(data.spec, data.finalResult, broadcast, report);
          return { at: 'completed', data: { steps: {} } };
        },
        SET_PAUSED: ({ paused }, { data, send, broadcast, report }) => {
          if (paused) {
            return { data: { paused: true } };
          }

          const flowRunNodeId = data.spec.flowRunNodeId;
          brainLogger.debug(
            `Flow ${flowRunNodeId} resuming ${data.pendingNextSteps.length} deferred steps, ${data.pendingEvents.length} deferred events`,
          );

          const nextSteps: Record<string, StepSpec> = { ...(data.steps as Record<string, StepSpec>) };
          for (const pending of data.pendingNextSteps) {
            try {
              spawnChildNode(
                pending.nextNode as NodeEntity,
                flowRunNodeId,
                pending.eventRunNodeId,
                pending.executionContext,
                pending.parentRunNodeId,
                nextSteps,
                broadcast,
                report,
              );
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

          for (const pendingEvent of data.pendingEvents) {
            send({
              type: 'TRACK_EVENT',
              eventType: pendingEvent.eventType,
              payload: pendingEvent.payload,
              data: pendingEvent.data,
              hasData: pendingEvent.hasData,
              targetFlowId: pendingEvent.targetFlowId,
            });
          }

          return {
            data: {
              paused: false,
              steps: nextSteps,
              pendingNextSteps: [],
              pendingEvents: [],
            },
          };
        },
        TRACK_EVENT: (ev, { data, broadcast, report }) => {
          const flowRunNodeId = data.spec.flowRunNodeId;
          const eventType = ev.eventType;

          if (data.paused) {
            brainLogger.debug(`Flow ${flowRunNodeId} deferring event "${eventType}" (brain paused)`);
            return {
              data: {
                pendingEvents: [
                  ...(data.pendingEvents as DeferredTrackEvent[]),
                  {
                    eventType,
                    payload: ev.payload,
                    data: ev.data,
                    hasData: ev.hasData,
                    targetFlowId: ev.targetFlowId,
                  },
                ],
              },
            };
          }

          const matchingEventNodes = data.spec.eventNodes.filter((n) => n.eventType === eventType);
          if (matchingEventNodes.length === 0) return;

          const nextSteps: Record<string, StepSpec> = { ...(data.steps as Record<string, StepSpec>) };
          const nextTrackContexts: Record<string, TrackContextData> = {
            ...(data.eventTrackContexts as Record<string, TrackContextData>),
          };
          const nextTrackCounts: Record<string, number> = { ...data.eventTrackChildCounts };

          const eventData: Record<string, unknown> = ev.hasData
            ? ((ev.data ?? {}) as Record<string, unknown>)
            : {
                ...(ev.payload !== undefined ? { payload: ev.payload } : {}),
                ...(ev.targetFlowId !== undefined ? { targetFlowId: ev.targetFlowId } : {}),
              };
          const payloadToStore =
            eventData !== null && typeof eventData === 'object' && 'payload' in eventData && eventData.payload !== undefined
              ? eventData.payload
              : eventData;

          for (const eventNode of matchingEventNodes) {
            const allSteps = repository.brainQueries.eventAllSteps(eventNode.id as EARS.EntityId);
            if (allSteps.length === 0) {
              createLogger('brain').debug(`No steps found for event ${eventType} on node ${eventNode.id}, skipping`);
              continue;
            }

            const eventRunNode = repository.brainCommands.createEventRunNode(eventNode, flowRunNodeId, payloadToStore);

            broadcast('brain', {
              type: 'RUN_NODE_SPAWNED',
              runNode: eventRunNode,
              parentId: flowRunNodeId,
              eventRunNodeId: eventRunNode.id,
              flowRunNodeId,
            });

            const eventTrackContext: TrackContextData = {
              flowRunNodeId,
              event: {
                type: eventType,
                data: eventData,
                timestamp: Date.now(),
              },
              ...(eventType === 'flow.entry'
                ? {
                    steps: [...(data.spec.entrySteps.steps as ExecutionContext['steps'])],
                    lastStep: data.spec.entrySteps.lastStep as ExecutionContext['lastStep'],
                  }
                : { steps: [], lastStep: undefined }),
            };

            let spawnedCount = 0;
            for (const step of allSteps) {
              try {
                spawnChildNode(
                  step,
                  flowRunNodeId,
                  eventRunNode.id,
                  eventTrackContext,
                  undefined,
                  nextSteps,
                  broadcast,
                  report,
                );
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

            nextTrackContexts[eventRunNode.id] = eventTrackContext;
            nextTrackCounts[eventRunNode.id] = spawnedCount;
          }

          return {
            data: {
              steps: nextSteps,
              eventTrackContexts: nextTrackContexts,
              eventTrackChildCounts: nextTrackCounts,
            },
          };
        },
        STEP_COMPLETED: (ev, { data, broadcast, report }) =>
          handleChildCompletion(ev, true, data, broadcast, report),
        SUBFLOW_COMPLETED: (ev, { data, broadcast, report }) =>
          handleChildCompletion(
            {
              runNodeId: ev.subflowRunNodeId,
              stepId: ev.stepId,
              stepLabel: ev.stepLabel,
              eventRunNodeId: ev.eventRunNodeId,
              result: ev.result,
              failed: ev.failed,
              final: ev.final,
            },
            false,
            data,
            broadcast,
            report,
          ),
      },
    },
    completed: {},
  },
});
