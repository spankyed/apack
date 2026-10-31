import { afterEach, expect, it } from 'vitest';
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import type { PerformanceCarrier } from '@apackdev/sdk/runtime';
import { createViewSubscriptionDiagnostics } from '../../src/transport/diagnostics.ts';

afterEach(stopFeTestRuntime);
it('owns a receipt sequence per subscription and preserves the original view value', () => {
  let current: PerformanceCarrier | undefined;
  startFeTestRuntime({ diagnostics: {
    capture: () => current ?? {}, carryEvent() {}, withEvent: (_event, fn) => fn(),
    withCarrier(carrier, fn) {
      const previous = current; current = carrier as PerformanceCarrier | undefined;
      try { return fn(); } finally { current = previous; }
    },
  } });
  const a = createViewSubscriptionDiagnostics({ traceparent: 'first' });
  const b = createViewSubscriptionDiagnostics({ traceparent: 'second' });
  const value = Object.freeze({ id: 'business row' });
  const update = Object.freeze({ ok: true as const, value, commit: 4 });
  const first = a.within(() => a.update(update));
  const second = b.within(() => b.update(update));
  expect(first.diagnostics).toMatchObject({ carrier: { traceparent: 'first' }, delivery: 1 });
  expect(second.diagnostics).toMatchObject({ carrier: { traceparent: 'second' }, delivery: 1 });
  expect(first.diagnostics!.subscription).not.toBe(second.diagnostics!.subscription);
  expect(a.within(() => a.update(update)).diagnostics?.delivery).toBe(2);
  expect(first.ok && first.value).toBe(value);
  expect(update).not.toHaveProperty('diagnostics');
  expect(a.update(update)).toBe(update);
  expect(current).toBeUndefined();
});
it('preserves a subscription error and restores the prior execution context', () => {
  let current: unknown;
  startFeTestRuntime({ diagnostics: { capture: () => ({}), carryEvent() {}, withEvent: (_event, fn) => fn(),
    withCarrier(carrier, fn) { const previous = current; current = carrier; try { return fn(); } finally { current = previous; } },
  } });
  const observation = createViewSubscriptionDiagnostics({ traceparent: 'request' });
  const failure = Error('subscription refused');
  expect(() => observation.within(() => { throw failure; })).toThrow(failure);
  expect(current).toBeUndefined();
});
