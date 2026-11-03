import type { ActorLogic, AnyActorLogic, EmittedFrom, EventFromLogic, InputFrom, SnapshotFrom } from 'xstate';
import { _performanceExecution, type PerformanceExecution } from '@apackdev/sdk/runtime';

/** Restores explicitly carried event context when XState drains a root system/surface mailbox. */
export function withActorContext<T extends AnyActorLogic>(logic: T, execution: () => PerformanceExecution | undefined = _performanceExecution): ActorLogic<SnapshotFrom<T>, EventFromLogic<T>, InputFrom<T>, Parameters<T['transition']>[2]['system'], EmittedFrom<T>> {
  return {
    config: logic.config,
    transition(snapshot, event, scope) {
      const performance = execution();
      const run = () => logic.transition(snapshot, event, scope);
      return performance ? performance.withEvent(event, run) : run();
    },
    getInitialSnapshot: (scope, input) => logic.getInitialSnapshot(scope, input),
    getPersistedSnapshot: (snapshot, options) => logic.getPersistedSnapshot(snapshot, options),
    ...(logic.restoreSnapshot && { restoreSnapshot: (snapshot, scope) => logic.restoreSnapshot!(snapshot, scope) }),
    ...(logic.start && { start: (snapshot, scope) => logic.start!(snapshot, scope) }),
  };
}
