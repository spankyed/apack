import { describe, expect, it, vi } from 'vitest';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createTraceSession } from '../../src/diagnostics/session.ts';

const session = (observations = 100) => createTraceSession({
  mode: 'lightweight', contextManager: () => new AsyncLocalStorageContextManager(),
  names: new Set(['app.action', 'app.delivery']), attributes: new Set(['scenario']),
  limits: { observations, bytes: 100_000 },
});

describe('trace session lifecycle', () => {
  it('propagates overlapping asynchronous actions independently and restores the outer context', async () => {
    const recording = session();
    const first = recording.begin('app.action', { scenario: 'first' });
    const second = recording.begin('app.action', { scenario: 'second' });
    const seen = await Promise.all([first, second].map(action => action.within(async () => {
      const before = recording.capture();
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(recording.capture()).toEqual(before);
      action.end();
      return before;
    })));
    expect(seen[0]!.traceparent).not.toBe(seen[1]!.traceparent);
    expect(recording.capture()).toEqual({});
    expect((await recording.stop()).complete).toBe(true);
  });

  it('uses standard carriers between independent sessions without leaking into unrelated deliveries', async () => {
    const sender = session(); const receiver = session();
    const action = sender.begin('app.action');
    const carrier = action.carrier();
    receiver.withCarrier(carrier, () => {
      const delivery = receiver.begin('app.delivery');
      expect(delivery.carrier().traceparent!.split('-')[1]).toBe(carrier.traceparent!.split('-')[1]);
      delivery.end();
    });
    expect(receiver.capture()).toEqual({});
    action.end();
    expect(action.carrier()).toEqual({});
    expect(action.within(() => sender.capture())).toEqual({});
    expect((await sender.stop()).complete).toBe(true);
    expect((await receiver.stop()).complete).toBe(true);
  });

  it('marks missing completion and recording-budget loss explicitly', async () => {
    const recording = session(1);
    recording.begin('app.action');
    recording.begin('app.action').end();
    const report = await recording.stop();
    expect(report).toMatchObject({ complete: false, unfinished: 1, active: 0, droppedStarts: 1 });
    expect(JSON.parse(report.observations[0]!).attributes['diagnostics.outcome']).toBe('incomplete');
    expect(await recording.stop()).toEqual(report);
  });

  it('records cancellation distinctly and ignores malformed carriers without failing application work', async () => {
    const recording = session();
    expect(recording.withCarrier({ traceparent: 'not a trace' }, () => 42)).toBe(42);
    const action = recording.begin('app.action');
    action.end('cancelled');
    const report = await recording.stop();
    expect(report).toMatchObject({ invalidCarriers: 1, complete: false });
    expect(JSON.parse(report.observations[0]!).attributes['diagnostics.outcome']).toBe('cancelled');
  });

  it('replaces database attachments and detaches both database owners on stop', async () => {
    const recording = session();
    const first = vi.fn(); const replacement = vi.fn(); const history = vi.fn();
    recording.attach({ admin: { observe: () => first } }, 'app');
    const oldDetach = recording.attach({ admin: { observe: () => replacement } }, 'app');
    recording.attach({ admin: { observe: () => history } }, 'runHistory');
    expect(first).toHaveBeenCalledTimes(1);
    oldDetach(); oldDetach();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect((await recording.stop()).complete).toBe(true);
    expect(history).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('reports detach failures without making stop reject', async () => {
    const recording = session();
    recording.attach({ admin: { observe: () => () => { throw Error('detach failed'); } } }, 'app');
    expect(await recording.stop()).toMatchObject({ detachFailures: 1, complete: false });
  });

  it('restores the original event context when another action flushes a queued delivery', async () => {
    const recording = session();
    const first = recording.begin('app.action'); const second = recording.begin('app.action');
    const event = { type: 'QUEUED' };
    recording.carryEvent(event, first.carrier());
    second.within(() => {
      expect(recording.withEvent(event, () => recording.capture())).toEqual(first.carrier());
      expect(recording.capture()).toEqual(second.carrier());
    });
    first.end(); second.end();
    expect((await recording.stop()).complete).toBe(true);
  });

  it('reports event-carrier budget loss instead of growing a retained queue without bound', async () => {
    const recording = session(1);
    recording.carryEvent({}, {});
    recording.carryEvent({}, {});
    expect(await recording.stop()).toMatchObject({ droppedEvents: 1, complete: false });
  });

  it('preserves application work if context installation fails before calling it', async () => {
    const manager = new AsyncLocalStorageContextManager();
    manager.with = () => { throw Error('context unavailable'); };
    const recording = createTraceSession({ mode: 'lightweight', contextManager: () => manager, names: new Set(), attributes: new Set() });
    expect(recording.withCarrier({}, () => 42)).toBe(42);
    expect(await recording.stop()).toMatchObject({ contextFailures: 1, complete: false });
  });

  it('does no context initialization or attribute enumeration while disabled', async () => {
    const recording = createTraceSession({ mode: 'disabled', contextManager: () => { throw Error('must not initialize'); }, names: new Set(), attributes: new Set() });
    const attributes = Object.defineProperty({}, 'payload', { enumerable: true, get() { throw Error('must not inspect'); } });
    const action = recording.begin('app.action', attributes);
    expect(action.within(() => 42)).toBe(42);
    action.end();
    const observe = vi.fn(() => { throw Error('must not attach'); });
    recording.attach({ admin: { observe } }, 'app')();
    expect(observe).not.toHaveBeenCalled();
    expect((await recording.stop()).observations).toEqual([]);
  });
});


it('does not retain a finished local action as the parent of later async work', async () => {
  const recording = session();
  const action = recording.begin('app.action');
  let release!: () => void;
  const pending = action.within(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return recording.capture();
  });
  action.end(); release();
  expect(await pending).toEqual({});
  expect((await recording.stop()).complete).toBe(true);
});

it('rejects unknown names and invalid allowed attributes before the SDK can retain them', async () => {
  const recording = session();
  recording.begin('private name'.repeat(100_000)).end();
  const attributes = Object.defineProperty({}, 'scenario', { get() { throw Error('private getter'); } });
  expect(() => recording.begin('app.action', attributes).end()).not.toThrow();
  recording.begin('app.action', { scenario: ['private array'] }).end();
  const report = await recording.stop();
  expect(report).toMatchObject({ complete: false, rejectedStarts: 1, invalidAttributes: 2 });
  expect(report.observations.join('')).not.toContain('private');
});
