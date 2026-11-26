import { given } from '@apackdev/state';
import type { EARS } from '#generated/ears.ts';
import type { ExecutionContext, RunNodeId, StepInput } from '@apackdev/sdk/steps';
import { stepRegistry } from '@apackdev/sdk/steps';
import type { NodeEntity } from '#generated/types.ts';
import { services, servicesForAction as ownServicesForAction } from '#generated/services.ts';
import { state } from '#generated/state.ts';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { executeStep } from './execute-step.ts';

export interface StepSpec {
  readonly runNodeId: RunNodeId;
  readonly flowRunNodeId: RunNodeId;
  readonly step: NodeEntity;
  readonly input: StepInput;
  readonly eventRunNodeId: RunNodeId;
  readonly event: ExecutionContext['event'];
  readonly steps: ExecutionContext['steps'];
  readonly lastStep?: ExecutionContext['lastStep'];
}

export type StepReport =
  | {
      readonly type: 'STEP_COMPLETED';
      readonly runNodeId: RunNodeId;
      readonly stepId: EARS.EntityId;
      readonly stepLabel: string;
      readonly eventRunNodeId: RunNodeId;
      readonly result?: unknown;
      readonly failed: boolean;
      readonly final: boolean;
      readonly killFlowId?: RunNodeId;
    }
  | {
      readonly type: 'KILL_FLOW';
      readonly flowRunNodeId: RunNodeId;
    };

/** Guarded update: never mutates a `'stopped'` or already-finished `RunNode`. */
function updateIfActive(id: RunNodeId, patch: { result?: unknown }): boolean {
  const current = services.runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  services.runHistory.update(id, patch);
  return true;
}

/** Guarded finish: never overwrites a `'stopped'` or already-finished `RunNode`. */
function finishIfActive(id: RunNodeId, status: 'completed' | 'failed'): boolean {
  const current = services.runHistory.get(id);
  if (!current || current.status !== 'active') return false;
  services.runHistory.finish(id, status);
  return true;
}

type StepShape = {
  data: { spec: StepSpec };
  reports: StepReport;
  internal:
    | { type: 'STEP_SUCCEEDED'; result: unknown; killFlowId?: RunNodeId }
    | { type: 'STEP_FAILED'; error: unknown }
    | { type: 'STEP_KILL_FLOW'; flowRunNodeId: RunNodeId };
  states: {
    executing: {};
    done: {};
  };
};

export const stepState = state<StepShape, never>()({
  data: { spec: given },
  initial: 'executing',
  states: {
    executing: {
      run: async ({ data, signal, send }) => {
        const waits = stepRegistry.get(data.spec.step.nodeType)?.runtime?.waits === true;
        if (waits) {
          // A waiting step (keep-alive) intentionally stays active without blocking `sys.idle()`.
          const executionContext: ExecutionContext = {
            flowRunNodeId: data.spec.flowRunNodeId,
            event: data.spec.event as ExecutionContext['event'],
            steps: [...(data.spec.steps as ExecutionContext['steps'])],
            lastStep: data.spec.lastStep as ExecutionContext['lastStep'],
            runtime: {
              killFlow: (targetFlowRunNodeId) => {
                if (!signal.aborted) {
                  send({ type: 'STEP_KILL_FLOW', flowRunNodeId: targetFlowRunNodeId as RunNodeId });
                }
              },
              servicesForAction: ownServicesForAction,
            },
          };
          executeStep(data.spec.input as StepInput, data.spec.step as NodeEntity, executionContext, { send: () => {} });
          return;
        }

        await new Promise<void>((resolve) => {
          let settled = false;
          let inSyncCall = true;
          let pendingKillFlowId: RunNodeId | undefined;

          const finish = () => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          const onAbort = () => finish();

          if (signal.aborted) {
            finish();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });

          const actorShim = {
            send: (ev: { type: string; result?: unknown; error?: unknown }) => {
              if (settled || signal.aborted) return;
              if (ev.type === 'COMPLETE') {
                const killFlowId = pendingKillFlowId;
                pendingKillFlowId = undefined;
                send({
                  type: 'STEP_SUCCEEDED',
                  result: ev.result,
                  ...(killFlowId ? { killFlowId } : {}),
                });
                finish();
              } else if (ev.type === 'ERROR') {
                pendingKillFlowId = undefined;
                send({ type: 'STEP_FAILED', error: ev.error });
                finish();
              }
            },
          };

          const executionContext: ExecutionContext = {
            flowRunNodeId: data.spec.flowRunNodeId,
            event: data.spec.event as ExecutionContext['event'],
            steps: [...(data.spec.steps as ExecutionContext['steps'])],
            lastStep: data.spec.lastStep as ExecutionContext['lastStep'],
            runtime: {
              killFlow: (targetFlowRunNodeId) => {
                if (settled || signal.aborted) return;
                if (inSyncCall) {
                  pendingKillFlowId = targetFlowRunNodeId as RunNodeId;
                } else {
                  send({ type: 'STEP_KILL_FLOW', flowRunNodeId: targetFlowRunNodeId as RunNodeId });
                }
              },
              servicesForAction: ownServicesForAction,
            },
          };

          try {
            // Zero `runHistory` writes here! Only compute/await, then send an internal event.
            // If this state exited while work was pending (e.g. KILL_BRAIN / RESTART_BRAIN),
            // `@apackdev/state` guarantees internal handlers never run.
            executeStep(data.spec.input as StepInput, data.spec.step as NodeEntity, executionContext, actorShim);
          } catch (error) {
            actorShim.send({ type: 'ERROR', error: errorMessage(error) });
          }

          inSyncCall = false;
          if (!settled && !signal.aborted && pendingKillFlowId) {
            const killFlowId = pendingKillFlowId;
            pendingKillFlowId = undefined;
            send({ type: 'STEP_KILL_FLOW', flowRunNodeId: killFlowId });
          }
        });
      },
      failed: (error, { data, broadcast, report }) => {
        const message = errorMessage(error);
        updateIfActive(data.spec.runNodeId, { result: { error: message } });
        if (finishIfActive(data.spec.runNodeId, 'failed')) {
          broadcast('brain', {
            type: 'RUN_NODE_UPDATED',
            data: {
              runNodeId: data.spec.runNodeId,
              status: 'failed',
              eventRunNodeId: data.spec.eventRunNodeId,
            },
          });
          report({
            type: 'STEP_COMPLETED',
            runNodeId: data.spec.runNodeId,
            stepId: data.spec.step.id,
            stepLabel: data.spec.step.label,
            eventRunNodeId: data.spec.eventRunNodeId,
            result: { error: message },
            failed: true,
            final: false,
          });
        }
        return { at: 'done' };
      },
      internal: {
        STEP_KILL_FLOW: ({ flowRunNodeId }, { report }) => {
          report({ type: 'KILL_FLOW', flowRunNodeId });
        },
        STEP_SUCCEEDED: ({ result, killFlowId }, { data, broadcast, report }) => {
          if (result !== undefined) {
            updateIfActive(data.spec.runNodeId, { result });
          }
          if (finishIfActive(data.spec.runNodeId, 'completed')) {
            broadcast('brain', {
              type: 'RUN_NODE_UPDATED',
              data: {
                runNodeId: data.spec.runNodeId,
                status: 'completed',
                eventRunNodeId: data.spec.eventRunNodeId,
              },
            });
            report({
              type: 'STEP_COMPLETED',
              runNodeId: data.spec.runNodeId,
              stepId: data.spec.step.id,
              stepLabel: data.spec.step.label,
              eventRunNodeId: data.spec.eventRunNodeId,
              result,
              failed: false,
              final: Boolean(data.spec.step.final),
              ...(killFlowId ? { killFlowId } : {}),
            });
          }
          return { at: 'done' };
        },
        STEP_FAILED: ({ error }, { data, broadcast, report }) => {
          if (error !== undefined) {
            updateIfActive(data.spec.runNodeId, { result: { error } });
          }
          if (finishIfActive(data.spec.runNodeId, 'failed')) {
            broadcast('brain', {
              type: 'RUN_NODE_UPDATED',
              data: {
                runNodeId: data.spec.runNodeId,
                status: 'failed',
                eventRunNodeId: data.spec.eventRunNodeId,
              },
            });
            report({
              type: 'STEP_COMPLETED',
              runNodeId: data.spec.runNodeId,
              stepId: data.spec.step.id,
              stepLabel: data.spec.step.label,
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
