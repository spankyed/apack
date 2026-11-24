import { _parseStartupPerformance } from '../../src/runtime/performance.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { startFeTestRuntime, stopFeTestRuntime } from '../../src/testing/fe-runtime.ts';
import { untypedTell, type Message } from '../../src/events/index.ts';
import { _performanceEnvelope, _performanceCarrier, _withPerformanceCarrier, _withPerformanceDelivery, _withPerformanceEvent, type PerformanceExecution } from '../../src/runtime/performance.ts';

afterEach(stopFeTestRuntime);

it('carries diagnostic context on the envelope without changing business event data or routing', () => {
  const messages: Message[] = [];
  const diagnostics: PerformanceExecution = {
    capture: () => ({ traceparent: '00-11111111111111111111111111111111-2222222222222222-01' }),
    withCarrier: (_carrier, fn) => fn(), carryEvent() {}, withEvent: (_event, fn) => fn(), record() {},
  };
  startFeTestRuntime({ diagnostics, client: { send: message => messages.push(message) } });
  const event = { type: 'PING', value: 'business data' };
  untypedTell('pack/system', event);
  expect(messages[0]).toMatchObject({ to: 'pack/system', diagnostics: diagnostics.capture() });
  expect(messages[0]!.event).toBe(event);
  expect(event).toEqual({ type: 'PING', value: 'business data' });
});

it('does not add diagnostic metadata when recording is unavailable', () => {
  const send = vi.fn();
  startFeTestRuntime({ client: { send } });
  untypedTell('pack/system', { type: 'PING' });
  expect(send.mock.calls[0]![0]).not.toHaveProperty('diagnostics');
});

it('keeps idle boundary calls transparent and preserves the original thrown value', () => {
  startFeTestRuntime();
  const message = Object.freeze({ event: { type: 'PING' } });
  expect(_performanceEnvelope(message)).toBe(message);
  expect(_performanceCarrier()).toBeUndefined();
  expect(_withPerformanceCarrier(undefined, () => 42)).toBe(42);
  expect(_withPerformanceEvent(null, () => 43)).toBe(43);
  const failure = Error('business failure');
  expect(() => _withPerformanceDelivery(message.event, undefined, () => { throw failure; })).toThrow(failure);
});
it('restores explicitly carried event causes and clears missing inbound context', () => {
  let current: unknown;
  const causes = new WeakMap<object, unknown>();
  const within = <T>(carrier: unknown, fn: () => T): T => {
    const previous = current; current = carrier;
    try { return fn(); } finally { current = previous; }
  };
  startFeTestRuntime({ diagnostics: { capture: () => ({}), withCarrier: within,
    carryEvent: (event, carrier) => { causes.set(event, carrier); }, withEvent: (event, fn) => within(causes.get(event), fn), record() {} } });
  const cause = { traceparent: 'explicit cause' };
  const event = { type: 'PING' };
  _withPerformanceCarrier(cause, () => {
    expect(current).toBe(cause);
    _withPerformanceDelivery(event, undefined, () => expect(current).toBeUndefined());
    expect(current).toBe(cause);
    _withPerformanceDelivery(event, cause, () => _withPerformanceEvent(event, () => expect(current).toBe(cause)));
  });
  expect(current).toBeUndefined();
  expect(event).toEqual({ type: 'PING' });
});

it('shares strict bounded startup configuration across process owners', () => {
  for (const mode of ['disabled', 'lightweight', 'detailed']) {
    expect(_parseStartupPerformance(JSON.stringify({ mode }))).toEqual({ mode });
    expect(_parseStartupPerformance(JSON.stringify({ mode, carrier: {} }))).toEqual({ mode, carrier: {} });
    const config = { mode, carrier: { traceparent: 'parent', tracestate: 'state' } };
    expect(_parseStartupPerformance(JSON.stringify(config))).toEqual(config);
  }
  const maxCarrier = { mode: 'lightweight', carrier: { traceparent: 'x'.repeat(512), tracestate: 'y'.repeat(512) } };
  expect(_parseStartupPerformance(JSON.stringify(maxCarrier))).toEqual(maxCarrier);
  for (const config of [
    null,
    [],
    'lightweight',
    {},
    { mode: 'unknown' },
    { mode: 1 },
    { mode: 'lightweight', payload: 'private' },
    { mode: 'lightweight', carrier: null },
    { mode: 'lightweight', carrier: [] },
    { mode: 'lightweight', carrier: { traceparent: null } },
    { mode: 'lightweight', carrier: { traceparent: 123 } },
    { mode: 'lightweight', carrier: { traceparent: 'x'.repeat(513) } },
    { mode: 'lightweight', carrier: { tracestate: 'x'.repeat(513) } },
    { mode: 'lightweight', carrier: { extra: true } },
  ]) {
    expect(() => _parseStartupPerformance(JSON.stringify(config))).toThrow();
  }
  expect(() => _parseStartupPerformance('{"mode":"lightweight","__proto__":{"polluted":true}}')).toThrow();
  expect(() => _parseStartupPerformance('{"mode":"lightweight","carrier":{"__proto__":{"polluted":true}}}')).toThrow();
  expect(() => _parseStartupPerformance('x'.repeat(2049))).toThrow(/too large/);
});
