import { createActor, createMachine } from 'xstate';
import { expect, it } from 'vitest';
import { withActorContext } from '../../src/diagnostics/actors.ts';
import { createNodePerformanceController } from '../../src/diagnostics/node.ts';

it('restores each tagged queued event before raw XState actions, independently of the draining sender', async () => {
  const recording = createNodePerformanceController(); recording.start('lightweight');
  const first = recording.begin('app.thread.open')!;
  const second = recording.begin('app.search')!;
  const firstEvent = { type: 'RUN', id: 'first' };
  const secondEvent = { type: 'RUN', id: 'second' };
  recording.execution.carryEvent(firstEvent, first.carrier());
  recording.execution.carryEvent(secondEvent, second.carrier());
  const seen: Array<{ id: string; parent?: string }> = [];
  const machine = createMachine({
    types: {} as { events: typeof firstEvent },
    on: { RUN: { actions: ({ event, self }) => {
      seen.push({ id: event.id, parent: recording.execution.capture().traceparent });
      if (event.id === 'first') self.send(secondEvent);
    } } },
  });
  const actor = createActor(withActorContext(machine, () => recording.execution)).start();
  first.within(() => actor.send(firstEvent));
  expect(seen).toEqual([{ id: 'first', parent: first.carrier().traceparent }, { id: 'second', parent: second.carrier().traceparent }]);
  expect(recording.execution.capture()).toEqual({});
  actor.stop(); first.end(); second.end();
  expect((await recording.stop()).complete).toBe(true);
});
it('preserves machine startup, persisted snapshots and original transition errors', () => {
  const error = Error('business failure');
  const machine = createMachine({ context: { value: 42 }, on: { FAIL: { actions: () => { throw error; } } } });
  const logic = withActorContext(machine, () => undefined);
  const original = createActor(machine).start();
  const actor = createActor(logic, { snapshot: original.getPersistedSnapshot() }).start();
  expect(actor.getSnapshot().context).toEqual({ value: 42 });
  let observed: unknown;
  actor.subscribe({ error: value => { observed = value; } });
  actor.send({ type: 'FAIL' });
  expect(observed).toBe(error);
  expect(actor.getSnapshot().error).toBe(error);
  actor.stop(); original.stop();
});
