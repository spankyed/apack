import type { TriggerRuntimeNode, TriggerRuntimeContext } from '@apackdev/sdk/steps';
import { services } from '#generated/services.ts';

export function register(node: TriggerRuntimeNode, ctx: TriggerRuntimeContext): void {
  // Through the scheduler service, so unit tests can drive ticks (mockService('scheduler', …))
  services.scheduler.registerSchedule(
    `${ctx.flowRunNodeId}:${node.id}`,
    node.cronExpression as string,
    () => {
      ctx.tell({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', 
        eventType: `schedule.${node.id}`,
        targetFlowId: ctx.flowRunNodeId,
      });
    },
  );
}
