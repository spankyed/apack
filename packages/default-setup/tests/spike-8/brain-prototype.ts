import { given, type Each } from '@apackdev/state';
import type { RunHistory, RunNodeId } from '@apackdev/sdk/services';
import type { EARS } from '#generated/ears.ts';
import { state } from '#generated/state.ts';

/**
 * Phase 2 #8 Spike — Flattened 3-level DAG prototype for `brain/be` (`brain` -> `flow` (each) -> `step` (each))
 * bound against real `PackNet` (`#generated/state.ts`), with:
 * - Zero module-level globals (`BRAIN_PAUSED` and `flowActorRegistry` eliminated)
 * - Single static `flowState` with `TRACK_EVENT` envelope (zero runtime-built `on` tables)
 * - Strict non-EARS `runHistory` invariants:
 *   1. Zero `runHistory` writes after `await` in `run` or `answers`
 *   2. Exact `stopActive()` + `clearAllSchedules()` ordering via `brain.states.running` `onExit`
 *   3. Read-before-write discipline + guarded `finishIfActive` (never overwrites `'stopped'`)
 */

export interface StepBlueprint {
  readonly id: EARS.EntityId;
  readonly label: string;
  readonly nodeType: 'action' | 'subflow' | 'keep-alive' | 'fire';
  readonly final?: boolean;
  /** Target flow blueprint id when `nodeType === 'subflow'`. */
  readonly subflowId?: EARS.EntityId;
  /** Event to emit when `nodeType === 'fire'`. */
  readonly fireEvent?: { readonly eventType: string; readonly scope: 'local' | 'global'; readonly payload?: unknown };
  /** Next step in straight-line track, if any. */
  readonly nextStepId?: EARS.EntityId;
  /** Simulated async execution latency in ms (0 = synchronous completion). */
  readonly delayMs?: number;
  /** If true, simulates a step whose underlying async promise resolves even after abort/kill. */
  readonly ignoreAbort?: boolean;
  /** If true, step throws an error when executed. */
  readonly shouldFail?: boolean;
}

export interface TriggerBlueprint {
  readonly id: EARS.EntityId;
  readonly label: string;
  readonly triggerType: 'listener' | 'schedule';
  readonly eventType: string;
  readonly cronExpression?: string;
  readonly stepIds: readonly EARS.EntityId[];
}

export interface FlowBlueprint {
  readonly id: EARS.EntityId;
  readonly label: string;
  readonly root?: boolean;
  readonly triggers: readonly TriggerBlueprint[];
  readonly steps: Readonly<Record<string, StepBlueprint>>;
}

export interface BrainScheduler {
  registerSchedule(key: string, cron: string, tick: () => void): void;
  unregisterByPrefix(prefix: string): void;
  clearAllSchedules(): void;
}

export interface BrainRuntimeDeps {
  readonly runHistory: RunHistory;
  readonly scheduler: BrainScheduler;
  readonly getRootFlow: () => FlowBlueprint | undefined;
  readonly getFlowById: (flowId: EARS.EntityId) => FlowBlueprint | undefined;
  /**
   * Executes a step's work asynchronously. Uses the provided clock/sleep or external promise;
   * importantly, `stepState.executing.run` NEVER writes to `runHistory` after `await` — it sends
   * an internal event so synchronous `internal` handlers perform all `runHistory` mutations.
   */
  readonly runStepWork: (
    step: StepBlueprint,
    signal: AbortSignal,
    sleep: (ms: number) => Promise<void>,
  ) => Promise<unknown>;
  /** Called by schedule triggers to emit a `TRIGGER_BRAIN_EVENT` into the running brain system. */
  readonly emitBrainEvent: (event: {
    type: 'TRIGGER_BRAIN_EVENT';
    eventType: string;
    payload?: unknown;
    targetFlowId?: string;
  }) => void;
}

/** Guarded finish: never overwrites a `'stopped'` (or already finished) `RunNode`. */
function finishIfActive(runHistory: RunHistory, id: RunNodeId, status: 'completed' | 'failed'): boolean {
  const current = runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  runHistory.finish(id, status);
  return true;
}

/** Guarded update: never mutates a `'stopped'` `RunNode`. */
function updateIfActive(runHistory: RunHistory, id: RunNodeId, patch: { result?: unknown }): boolean {
  const current = runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  runHistory.update(id, patch);
  return true;
}

// ── Level 3: `stepState` ──────────────────────────────────────────────────────────────────────────

export interface StepSpec {
  readonly runNodeId: RunNodeId;
  readonly flowId: EARS.EntityId;
  readonly stepId: EARS.EntityId;
  readonly stepLabel: string;
  readonly eventRunNodeId: RunNodeId;
  readonly final: boolean;
}

export type StepReport = {
  readonly type: 'STEP_COMPLETED';
  readonly runNodeId: RunNodeId;
  readonly stepId: EARS.EntityId;
  readonly stepLabel: string;
  readonly eventRunNodeId: RunNodeId;
  readonly result?: unknown;
  readonly failed: boolean;
  readonly final: boolean;
};

// ── Level 2: `flowState` ──────────────────────────────────────────────────────────────────────────

export interface FlowSpec {
  readonly flowRunNodeId: RunNodeId;
  readonly flowId: EARS.EntityId;
  readonly flowLabel: string;
  readonly isRootFlow: boolean;
  readonly parentFlowRunNodeId?: RunNodeId;
  readonly parentEventRunNodeId?: RunNodeId;
  readonly flowStepNodeId?: EARS.EntityId;
  readonly flowStepLabel?: string;
  readonly isFinalStep: boolean;
  readonly entryData?: unknown;
  readonly startPaused: boolean;
}

export type FlowEvent =
  | { type: 'TRACK_EVENT'; eventType: string; payload?: unknown; data?: unknown; targetFlowId?: string }
  | { type: 'SET_PAUSED'; paused: boolean }
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

export type FlowReport =
  | {
      type: 'SPAWN_SUBFLOW';
      parentFlowRunNodeId: RunNodeId;
      parentEventRunNodeId: RunNodeId;
      parentRunNodeId: RunNodeId;
      stepId: EARS.EntityId;
      stepLabel: string;
      subflowId: EARS.EntityId;
      isFinalStep: boolean;
      entryData?: unknown;
    }
  | {
      type: 'FLOW_COMPLETED';
      flowRunNodeId: RunNodeId;
      isRootFlow: boolean;
      parentFlowRunNodeId?: RunNodeId;
      parentEventRunNodeId?: RunNodeId;
      flowStepNodeId?: EARS.EntityId;
      flowStepLabel?: string;
      result?: unknown;
      final: boolean;
    }
  | {
      type: 'FLOW_FIRE_EVENT';
      eventType: string;
      payload?: unknown;
      targetFlowId?: string;
    };

// ── Level 1: `brainState` ─────────────────────────────────────────────────────────────────────────

export type BrainEvent =
  | { type: 'START_BRAIN' }
  | { type: 'KILL_BRAIN' }
  | { type: 'DATA_REPLACED' }
  | { type: 'RESTART_BRAIN' }
  | { type: 'PAUSE_BRAIN' }
  | { type: 'RESUME_BRAIN' }
  | { type: 'TRIGGER_BRAIN_EVENT'; eventType: string; payload?: unknown; targetFlowId?: string }
  | { type: 'HANDLE_BRAIN_EVENT'; eventType: string; payload?: unknown; targetFlowId?: string }
  | (FlowReport & { from?: string });

export function createBrainMachines(deps: BrainRuntimeDeps) {
  const { runHistory, scheduler, getRootFlow, getFlowById, runStepWork, emitBrainEvent } = deps;

  // ── Level 3: Step machine ──────────────────────────────────────────────────────────────────────
  const stepState = state<
    {
      data: { spec: StepSpec };
      reports: StepReport;
      internal:
        | { type: 'STEP_SUCCEEDED'; result: unknown }
        | { type: 'STEP_FAILED'; error: string };
      states: {
        executing: {};
        done: {};
      };
    },
    never
  >()({
    data: { spec: given },
    initial: 'executing',
    states: {
      executing: {
        run: async ({ data, signal, sleep, send }) => {
          const flow = getFlowById(data.spec.flowId);
          const step = flow?.steps[data.spec.stepId];
          if (!step) {
            send({ type: 'STEP_FAILED', error: `Missing step blueprint ${data.spec.stepId}` });
            return;
          }
          if (step.nodeType === 'keep-alive') {
            // Keep-alive waits until state exit cancels it
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
            return;
          }
          try {
            // Zero `runHistory` writes here! Only compute/await, then send an internal event.
            // If this state exited while `runStepWork` was pending (e.g. KILL_BRAIN / RESTART_BRAIN),
            // `@apackdev/state` guarantees the internal handler will NEVER execute.
            const result = await runStepWork(step, signal, sleep);
            send({ type: 'STEP_SUCCEEDED', result });
          } catch (err) {
            if (signal.aborted) return;
            const message = err instanceof Error ? err.message : String(err);
            send({ type: 'STEP_FAILED', error: message });
          }
        },
        failed: (error, { data, report }) => {
          const message = error instanceof Error ? error.message : String(error);
          updateIfActive(runHistory, data.spec.runNodeId, { result: { error: message } });
          if (finishIfActive(runHistory, data.spec.runNodeId, 'failed')) {
            report({
              type: 'STEP_COMPLETED',
              runNodeId: data.spec.runNodeId,
              stepId: data.spec.stepId,
              stepLabel: data.spec.stepLabel,
              eventRunNodeId: data.spec.eventRunNodeId,
              result: { error: message },
              failed: true,
              final: false,
            });
          }
          return { at: 'done' };
        },
        internal: {
          STEP_SUCCEEDED: ({ result }, { data, report }) => {
            if (result !== undefined) {
              updateIfActive(runHistory, data.spec.runNodeId, { result });
            }
            if (finishIfActive(runHistory, data.spec.runNodeId, 'completed')) {
              report({
                type: 'STEP_COMPLETED',
                runNodeId: data.spec.runNodeId,
                stepId: data.spec.stepId,
                stepLabel: data.spec.stepLabel,
                eventRunNodeId: data.spec.eventRunNodeId,
                result,
                failed: false,
                final: data.spec.final,
              });
            }
            return { at: 'done' };
          },
          STEP_FAILED: ({ error }, { data, report }) => {
            updateIfActive(runHistory, data.spec.runNodeId, { result: { error } });
            if (finishIfActive(runHistory, data.spec.runNodeId, 'failed')) {
              report({
                type: 'STEP_COMPLETED',
                runNodeId: data.spec.runNodeId,
                stepId: data.spec.stepId,
                stepLabel: data.spec.stepLabel,
                eventRunNodeId: data.spec.eventRunNodeId,
                result: { error },
                failed: true,
                final: false,
              });
            }
            return { at: 'done' };
          },
        },
      },
      done: {},
    },
  });

  // ── Level 2: Static Flow machine (starts only its own `steps`, reports subflow spawns up) ──────
  type DeferredStep = {
    readonly stepId: EARS.EntityId;
    readonly eventRunNodeId: RunNodeId;
    readonly parentRunNodeId: RunNodeId;
  };
  type DeferredEvent = {
    readonly eventType: string;
    readonly payload?: unknown;
    readonly data?: unknown;
  };

  const flowState = state<
    {
      data: {
        spec: FlowSpec;
        paused: boolean;
        hasPersistentTriggers: boolean;
        steps: Record<string, StepSpec>;
        eventTrackChildCounts: Record<string, number>;
        pendingNextSteps: DeferredStep[];
        pendingEvents: DeferredEvent[];
        finalResult: unknown;
      };
      reports: FlowReport;
      starts: { step: Each<typeof stepState> };
      states: {
        active: {};
        completed: {};
      };
    },
    FlowEvent
  >()({
    data: {
      spec: given,
      paused: given,
      hasPersistentTriggers: given,
      steps: {},
      eventTrackChildCounts: {},
      pendingNextSteps: [],
      pendingEvents: [],
      finalResult: undefined,
    },
    initial: 'active',
    starts: (start) => ({
      step: start(stepState, {
        each: 'steps',
        given: (key, data) => ({ spec: data.steps[key]! }),
      }),
    }),
    states: {
      active: {
        run: ({ data, send, onExit }) => {
          const flow = getFlowById(data.spec.flowId);
          if (flow) {
            for (const trigger of flow.triggers) {
              if (trigger.triggerType === 'schedule' && trigger.stepIds.length > 0 && trigger.cronExpression) {
                const scheduleKey = `${data.spec.flowRunNodeId}:${trigger.id}`;
                scheduler.registerSchedule(scheduleKey, trigger.cronExpression, () => {
                  emitBrainEvent({
                    type: 'TRIGGER_BRAIN_EVENT',
                    eventType: trigger.eventType,
                    targetFlowId: data.spec.flowRunNodeId,
                  });
                });
              }
            }
          }
          onExit(() => {
            scheduler.unregisterByPrefix(data.spec.flowRunNodeId);
          });
          // Trigger `flow.entry` track if present on this flow blueprint
          send({ type: 'TRACK_EVENT', eventType: 'flow.entry', data: data.spec.entryData });
        },
        on: {
          SET_PAUSED: ({ paused }, { data, send, report }) => {
            if (paused) {
              return { data: { paused: true } };
            }
            // Resuming: spawn deferred next steps & replay deferred track events
            const flow = getFlowById(data.spec.flowId);
            const nextSteps: Record<string, StepSpec> = { ...data.steps };
            if (flow) {
              for (const deferred of data.pendingNextSteps) {
                const stepBp = flow.steps[deferred.stepId];
                if (!stepBp) continue;
                if (stepBp.nodeType === 'subflow' && stepBp.subflowId) {
                  report({
                    type: 'SPAWN_SUBFLOW',
                    parentFlowRunNodeId: data.spec.flowRunNodeId,
                    parentEventRunNodeId: deferred.eventRunNodeId,
                    parentRunNodeId: deferred.parentRunNodeId,
                    stepId: stepBp.id,
                    stepLabel: stepBp.label,
                    subflowId: stepBp.subflowId,
                    isFinalStep: stepBp.final === true,
                  });
                } else {
                  const runNode = runHistory.start({
                    kind: 'step',
                    label: stepBp.label,
                    stepNodeType: stepBp.nodeType,
                    parentId: deferred.parentRunNodeId,
                    flowId: flow.id,
                    nodeId: stepBp.id,
                    final: stepBp.final,
                  });
                  nextSteps[runNode.id] = {
                    runNodeId: runNode.id,
                    flowId: flow.id,
                    stepId: stepBp.id,
                    stepLabel: stepBp.label,
                    eventRunNodeId: deferred.eventRunNodeId,
                    final: stepBp.final === true,
                  };
                }
              }
            }
            for (const ev of data.pendingEvents) {
              send({ type: 'TRACK_EVENT', eventType: ev.eventType, payload: ev.payload, data: ev.data });
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
          TRACK_EVENT: ({ eventType, payload, data: eventData }, { data, report }) => {
            if (data.paused) {
              return {
                data: {
                  pendingEvents: [...data.pendingEvents, { eventType, payload, data: eventData }],
                },
              };
            }
            // Read-before-write discipline: resolve blueprint & triggers BEFORE calling `runHistory.start`
            const flow = getFlowById(data.spec.flowId);
            if (!flow) return;
            const matchingTriggers = flow.triggers.filter((t) => t.eventType === eventType && t.stepIds.length > 0);
            if (matchingTriggers.length === 0) return;

            const nextSteps: Record<string, StepSpec> = { ...data.steps };
            const nextCounts: Record<string, number> = { ...data.eventTrackChildCounts };

            for (const trigger of matchingTriggers) {
              const resolvedSteps = trigger.stepIds
                .map((id) => flow.steps[id])
                .filter((s): s is StepBlueprint => s !== undefined);
              if (resolvedSteps.length === 0) continue;

              const eventNode = runHistory.start({
                kind: 'event',
                label: trigger.label,
                eventType,
                triggerType: trigger.triggerType,
                ...(trigger.cronExpression ? { cronExpression: trigger.cronExpression } : {}),
                ...(payload !== undefined ? { payload } : {}),
                parentId: data.spec.flowRunNodeId,
                flowId: flow.id,
                nodeId: trigger.id,
              });

              let spawned = 0;
              for (const stepBp of resolvedSteps) {
                if (stepBp.nodeType === 'subflow' && stepBp.subflowId) {
                  report({
                    type: 'SPAWN_SUBFLOW',
                    parentFlowRunNodeId: data.spec.flowRunNodeId,
                    parentEventRunNodeId: eventNode.id,
                    parentRunNodeId: eventNode.id,
                    stepId: stepBp.id,
                    stepLabel: stepBp.label,
                    subflowId: stepBp.subflowId,
                    isFinalStep: stepBp.final === true,
                    entryData: payload ?? eventData,
                  });
                  spawned++;
                } else {
                  const stepRunNode = runHistory.start({
                    kind: 'step',
                    label: stepBp.label,
                    stepNodeType: stepBp.nodeType,
                    parentId: eventNode.id,
                    flowId: flow.id,
                    nodeId: stepBp.id,
                    final: stepBp.final,
                  });
                  nextSteps[stepRunNode.id] = {
                    runNodeId: stepRunNode.id,
                    flowId: flow.id,
                    stepId: stepBp.id,
                    stepLabel: stepBp.label,
                    eventRunNodeId: eventNode.id,
                    final: stepBp.final === true,
                  };
                  spawned++;
                }
              }
              nextCounts[eventNode.id] = spawned;
            }

            return { data: { steps: nextSteps, eventTrackChildCounts: nextCounts } };
          },
          STEP_COMPLETED: (ev, { data, report }) => {
            const flow = getFlowById(data.spec.flowId);
            const completedStepBp = flow?.steps[ev.stepId];
            if (completedStepBp?.nodeType === 'fire' && completedStepBp.fireEvent && !ev.failed) {
              report({
                type: 'FLOW_FIRE_EVENT',
                eventType: completedStepBp.fireEvent.eventType,
                payload: completedStepBp.fireEvent.payload,
                ...(completedStepBp.fireEvent.scope === 'local'
                  ? { targetFlowId: data.spec.flowRunNodeId }
                  : {}),
              });
            }

            const nextStepBp =
              !ev.failed && completedStepBp?.nextStepId && flow
                ? flow.steps[completedStepBp.nextStepId]
                : undefined;

            const prevCount = data.eventTrackChildCounts[ev.eventRunNodeId] ?? 0;
            const newCount = Math.max(0, prevCount - 1) + (nextStepBp ? 1 : 0);
            const nextCounts: Record<string, number> = {
              ...data.eventTrackChildCounts,
              [ev.eventRunNodeId]: newCount,
            };

            // Remove completed step from `steps` map so its child state stops cleanly
            const nextSteps: Record<string, StepSpec> = { ...data.steps };
            delete nextSteps[ev.runNodeId];

            if (newCount === 0) {
              finishIfActive(runHistory, ev.eventRunNodeId, 'completed');
            }

            const allTracksDrained = Object.values(nextCounts).every((c) => c === 0);
            const shouldComplete =
              !ev.failed && (ev.final || (allTracksDrained && !data.hasPersistentTriggers));

            if (shouldComplete) {
              if (ev.result !== undefined) {
                updateIfActive(runHistory, data.spec.flowRunNodeId, { result: ev.result });
              }
              finishIfActive(runHistory, data.spec.flowRunNodeId, 'completed');
              report({
                type: 'FLOW_COMPLETED',
                flowRunNodeId: data.spec.flowRunNodeId,
                isRootFlow: data.spec.isRootFlow,
                parentFlowRunNodeId: data.spec.parentFlowRunNodeId,
                parentEventRunNodeId: data.spec.parentEventRunNodeId,
                flowStepNodeId: data.spec.flowStepNodeId,
                flowStepLabel: data.spec.flowStepLabel,
                result: ev.result,
                final: data.spec.isFinalStep,
              });
              return {
                at: 'completed',
                data: {
                  steps: nextSteps,
                  eventTrackChildCounts: nextCounts,
                  finalResult: ev.result ?? data.finalResult,
                },
              };
            }

            if (nextStepBp && data.paused) {
              return {
                data: {
                  steps: nextSteps,
                  eventTrackChildCounts: nextCounts,
                  pendingNextSteps: [
                    ...data.pendingNextSteps,
                    {
                      stepId: nextStepBp.id,
                      eventRunNodeId: ev.eventRunNodeId,
                      parentRunNodeId: ev.runNodeId,
                    },
                  ],
                },
              };
            }

            if (nextStepBp && flow) {
              if (nextStepBp.nodeType === 'subflow' && nextStepBp.subflowId) {
                report({
                  type: 'SPAWN_SUBFLOW',
                  parentFlowRunNodeId: data.spec.flowRunNodeId,
                  parentEventRunNodeId: ev.eventRunNodeId,
                  parentRunNodeId: ev.runNodeId,
                  stepId: nextStepBp.id,
                  stepLabel: nextStepBp.label,
                  subflowId: nextStepBp.subflowId,
                  isFinalStep: nextStepBp.final === true,
                });
              } else {
                const nextRunNode = runHistory.start({
                  kind: 'step',
                  label: nextStepBp.label,
                  stepNodeType: nextStepBp.nodeType,
                  parentId: ev.runNodeId,
                  flowId: flow.id,
                  nodeId: nextStepBp.id,
                  final: nextStepBp.final,
                });
                nextSteps[nextRunNode.id] = {
                  runNodeId: nextRunNode.id,
                  flowId: flow.id,
                  stepId: nextStepBp.id,
                  stepLabel: nextStepBp.label,
                  eventRunNodeId: ev.eventRunNodeId,
                  final: nextStepBp.final === true,
                };
              }
            }

            return { data: { steps: nextSteps, eventTrackChildCounts: nextCounts } };
          },
          SUBFLOW_COMPLETED: (ev, { data, report }) => {
            const flow = getFlowById(data.spec.flowId);
            const completedStepBp = flow?.steps[ev.stepId];
            const nextStepBp =
              !ev.failed && completedStepBp?.nextStepId && flow
                ? flow.steps[completedStepBp.nextStepId]
                : undefined;

            const prevCount = data.eventTrackChildCounts[ev.eventRunNodeId] ?? 0;
            const newCount = Math.max(0, prevCount - 1) + (nextStepBp ? 1 : 0);
            const nextCounts: Record<string, number> = {
              ...data.eventTrackChildCounts,
              [ev.eventRunNodeId]: newCount,
            };

            if (newCount === 0) {
              finishIfActive(runHistory, ev.eventRunNodeId, 'completed');
            }

            const allTracksDrained = Object.values(nextCounts).every((c) => c === 0);
            const shouldComplete =
              !ev.failed && (ev.final || (allTracksDrained && !data.hasPersistentTriggers));

            if (shouldComplete) {
              if (ev.result !== undefined) {
                updateIfActive(runHistory, data.spec.flowRunNodeId, { result: ev.result });
              }
              finishIfActive(runHistory, data.spec.flowRunNodeId, 'completed');
              report({
                type: 'FLOW_COMPLETED',
                flowRunNodeId: data.spec.flowRunNodeId,
                isRootFlow: data.spec.isRootFlow,
                parentFlowRunNodeId: data.spec.parentFlowRunNodeId,
                parentEventRunNodeId: data.spec.parentEventRunNodeId,
                flowStepNodeId: data.spec.flowStepNodeId,
                flowStepLabel: data.spec.flowStepLabel,
                result: ev.result,
                final: data.spec.isFinalStep,
              });
              return {
                at: 'completed',
                data: {
                  eventTrackChildCounts: nextCounts,
                  finalResult: ev.result ?? data.finalResult,
                },
              };
            }

            const nextSteps: Record<string, StepSpec> = { ...data.steps };
            if (nextStepBp && data.paused) {
              return {
                data: {
                  eventTrackChildCounts: nextCounts,
                  pendingNextSteps: [
                    ...data.pendingNextSteps,
                    {
                      stepId: nextStepBp.id,
                      eventRunNodeId: ev.eventRunNodeId,
                      parentRunNodeId: ev.subflowRunNodeId,
                    },
                  ],
                },
              };
            }
            if (nextStepBp && flow) {
              const nextRunNode = runHistory.start({
                kind: 'step',
                label: nextStepBp.label,
                stepNodeType: nextStepBp.nodeType,
                parentId: ev.subflowRunNodeId,
                flowId: flow.id,
                nodeId: nextStepBp.id,
                final: nextStepBp.final,
              });
              nextSteps[nextRunNode.id] = {
                runNodeId: nextRunNode.id,
                flowId: flow.id,
                stepId: nextStepBp.id,
                stepLabel: nextStepBp.label,
                eventRunNodeId: ev.eventRunNodeId,
                final: nextStepBp.final === true,
              };
            }
            return { data: { steps: nextSteps, eventTrackChildCounts: nextCounts } };
          },
        },
      },
      completed: {},
    },
  });

  // ── Level 1: Brain root machine ────────────────────────────────────────────────────────────────
  type QueuedBrainEvent = { readonly eventType: string; readonly payload?: unknown; readonly targetFlowId?: string };

  const routeToFlows = (
    flows: Readonly<Record<string, FlowSpec>>,
    ev: QueuedBrainEvent,
    tell: (to: ReturnType<typeof Object>, event: FlowEvent) => void,
    child: (name: 'flow', key: string) => unknown,
  ) => {
    if (ev.targetFlowId) {
      if (ev.targetFlowId in flows) {
        tell(child('flow', ev.targetFlowId) as never, {
          type: 'TRACK_EVENT',
          eventType: ev.eventType,
          payload: ev.payload,
          targetFlowId: ev.targetFlowId,
        });
      }
      return;
    }
    for (const flowRunNodeId of Object.keys(flows)) {
      tell(child('flow', flowRunNodeId) as never, {
        type: 'TRACK_EVENT',
        eventType: ev.eventType,
        payload: ev.payload,
      });
    }
  };

  const brainState = state<
    {
      data: {
        lastRootRunId: RunNodeId | null;
      };
      states: {
        booting: {};
        stopped: {};
        running: {
          data: {
            rootFlowId: EARS.EntityId | null;
            rootRunId: RunNodeId | null;
            flows: Record<string, FlowSpec>;
            eventQueue: QueuedBrainEvent[];
            generation: number;
          };
          starts: { flow: Each<typeof flowState> };
          states: {
            active: {};
            paused: {};
          };
        };
      };
    },
    BrainEvent
  >()({
    data: {
      lastRootRunId: null,
    },
    initial: 'booting',
    states: {
      booting: {
        run: () => ({
          at: 'running',
          data: { rootFlowId: null, rootRunId: null, flows: {}, eventQueue: [], generation: 1 },
        }),
      },
      stopped: {
        on: {
          START_BRAIN: () => ({
            at: 'running',
            data: { rootFlowId: null, rootRunId: null, flows: {}, eventQueue: [], generation: 1 },
          }),
          RESTART_BRAIN: () => ({
            at: 'running',
            data: { rootFlowId: null, rootRunId: null, flows: {}, eventQueue: [], generation: 1 },
          }),
        },
      },
      running: {
        data: {
          rootFlowId: null,
          rootRunId: null,
          flows: {},
          eventQueue: [],
          generation: 1,
        },
        initial: 'active',
        starts: (start) => ({
          flow: start(flowState, {
            each: 'flows',
            given: (key, data) => {
              const spec = data.flows[key]!;
              const bp = getFlowById(spec.flowId);
              const hasPersistentTriggers = bp?.triggers.some((t) => t.triggerType === 'schedule') ?? false;
              return { spec, paused: spec.startPaused, hasPersistentTriggers };
            },
          }),
        }),
        run: ({ onExit, broadcast }) => {
          // Register `onExit` FIRST so even if we stop immediately, cleanup is guaranteed.
          // Kernel ordering invariant (verified in Probe 2):
          //   1. All child flows & steps exit first (cancelling in-flight async step work)
          //   2. This `onExit` runs second: marks every still-active RunNode `'stopped'` + clears all crons
          //   3. On `RESTART_BRAIN` self-target re-entry, fresh `running.run` executes third and creates the NEW root!
          onExit(() => {
            runHistory.stopActive();
            scheduler.clearAllSchedules();
          });

          // Read-before-write discipline: query root flow blueprint BEFORE calling `runHistory.start`
          const rootFlow = getRootFlow();
          if (!rootFlow) {
            broadcast('brain', { type: 'BRAIN_KILLED' });
            return { at: 'stopped' };
          }

          const rootNode = runHistory.start({
            kind: 'flow',
            label: rootFlow.label,
            flowId: rootFlow.id,
          });
          const rootSpec: FlowSpec = {
            flowRunNodeId: rootNode.id,
            flowId: rootFlow.id,
            flowLabel: rootFlow.label,
            isRootFlow: true,
            isFinalStep: false,
            startPaused: false,
          };

          broadcast('brain', { type: 'BRAIN_STARTED', rootFlowId: rootFlow.id });

          return {
            data: {
              rootFlowId: rootFlow.id,
              rootRunId: rootNode.id,
              lastRootRunId: rootNode.id,
              flows: { [rootNode.id]: rootSpec },
              eventQueue: [],
            },
          };
        },
        on: {
          KILL_BRAIN: (_, { broadcast }) => {
            broadcast('brain', { type: 'BRAIN_KILLED' });
            return { at: 'stopped' };
          },
          DATA_REPLACED: (_, { broadcast }) => {
            broadcast('brain', { type: 'BRAIN_KILLED' });
            return { at: 'stopped' };
          },
          RESTART_BRAIN: (_, { data }) => ({
            // Self-target re-entry triggers:
            // children exit -> running.onExit (stopActive + clearAllSchedules) -> fresh running.run (new rootRunId!)
            at: 'running',
            data: {
              rootFlowId: null,
              rootRunId: null,
              flows: {},
              eventQueue: [],
              generation: data.generation + 1,
            },
          }),
          SPAWN_SUBFLOW: (ev, { snapshot }) => {
            // Read-before-write discipline
            const subflowBp = getFlowById(ev.subflowId);
            if (!subflowBp) return;
            const subflowNode = runHistory.start({
              kind: 'flow',
              label: ev.stepLabel,
              stepNodeType: 'subflow',
              parentId: ev.parentRunNodeId,
              flowId: subflowBp.id,
              nodeId: ev.stepId,
              final: ev.isFinalStep,
            });
            const spec: FlowSpec = {
              flowRunNodeId: subflowNode.id,
              flowId: subflowBp.id,
              flowLabel: subflowBp.label,
              isRootFlow: false,
              parentFlowRunNodeId: ev.parentFlowRunNodeId,
              parentEventRunNodeId: ev.parentEventRunNodeId,
              flowStepNodeId: ev.stepId,
              flowStepLabel: ev.stepLabel,
              isFinalStep: ev.isFinalStep,
              entryData: ev.entryData,
              startPaused: snapshot.at === 'running.paused',
            };
            return {
              data: (d) => {
                d.flows[subflowNode.id] = spec;
              },
            };
          },
          FLOW_COMPLETED: (ev, { data, tell, child, broadcast }) => {
            if (ev.isRootFlow) {
              broadcast('brain', { type: 'BRAIN_KILLED' });
              return { at: 'stopped' };
            }
            if (ev.parentFlowRunNodeId && ev.parentFlowRunNodeId in data.flows && ev.flowStepNodeId && ev.parentEventRunNodeId) {
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
            return {
              data: (d) => {
                delete d.flows[ev.flowRunNodeId];
              },
            };
          },
          FLOW_FIRE_EVENT: (ev, { send }) => {
            send({
              type: 'TRIGGER_BRAIN_EVENT',
              eventType: ev.eventType,
              payload: ev.payload,
              targetFlowId: ev.targetFlowId,
            });
          },
        },
        states: {
          active: {
            on: {
              TRIGGER_BRAIN_EVENT: (ev, { data, tell, child, broadcast }) => {
                broadcast('brain', { type: 'EVENT_PULSE', eventType: ev.eventType });
                routeToFlows(data.flows, ev, tell as never, child);
              },
              HANDLE_BRAIN_EVENT: (ev, { data, tell, child, broadcast }) => {
                broadcast('brain', { type: 'EVENT_PULSE', eventType: ev.eventType });
                routeToFlows(data.flows, ev, tell as never, child);
              },
              PAUSE_BRAIN: (_, { data, tell, child, broadcast }) => {
                for (const flowId of Object.keys(data.flows)) {
                  tell(child('flow', flowId), { type: 'SET_PAUSED', paused: true });
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
              RESUME_BRAIN: (_, { data, tell, child, send, broadcast }) => {
                for (const flowId of Object.keys(data.flows)) {
                  tell(child('flow', flowId), { type: 'SET_PAUSED', paused: false });
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

  return { brainState, flowState, stepState };
}
