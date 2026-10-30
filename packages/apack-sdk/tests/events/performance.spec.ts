import { afterEach, expect, it, vi } from 'vitest';
import { startFeTestRuntime, stopFeTestRuntime } from '../../src/testing/fe-runtime.ts';
import { untypedSendToSystem, type Message } from '../../src/events/index.ts';
import type { PerformanceExecution } from '../../src/runtime/performance.ts';

afterEach(stopFeTestRuntime);

it('carries diagnostic context on the envelope without changing business event data or routing', () => {
  const messages: Message[] = [];
  const diagnostics: PerformanceExecution = {
    capture: () => ({ traceparent: '00-11111111111111111111111111111111-2222222222222222-01' }),
    withCarrier: (_carrier, fn) => fn(), carryEvent() {}, withEvent: (_event, fn) => fn(),
  };
  startFeTestRuntime({ diagnostics, client: { send: message => messages.push(message) } });
  const event = { type: 'PING', value: 'business data' };
  untypedSendToSystem('pack/system', event);
  expect(messages[0]).toMatchObject({ to: 'pack/system', diagnostics: diagnostics.capture() });
  expect(messages[0]!.event).toBe(event);
  expect(event).toEqual({ type: 'PING', value: 'business data' });
});

it('does not add diagnostic metadata when recording is unavailable', () => {
  const send = vi.fn();
  startFeTestRuntime({ client: { send } });
  untypedSendToSystem('pack/system', { type: 'PING' });
  expect(send.mock.calls[0]![0]).not.toHaveProperty('diagnostics');
});
