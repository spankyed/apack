// startTestRuntime's in-memory app: what systems, services and steps call outside the app
import { boundEars as ears } from '@apackdev/sdk/ears';
import * as os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { entityIds, dropAttribute, resetTestData, startTestRuntime, takeSystemErrors, testRootEvents } from '../../src/testing/index.ts';
import { untypedBroadcastToSurface, untypedSendToSystem } from '../../src/events/index.ts';
import { testPacks, testPacksView } from '../../src/testing/packs.ts';
import { getAppVersion } from '../../src/env/index.ts';
import { createLogger, reportError } from '../../src/logger/index.ts';
import { boundHost, unbindHost } from '../../src/runtime/host-runtime.ts';
import { _rootEvents } from '../../src/runtime/root-events.ts';
import { untypedCreate } from '@apackdev/sdk/ears';
import { repository } from '@apackdev/sdk/services';

process.env.APACK_ENV ??= 'test';
process.env.APACK_USER_DATA_DIR ??= os.tmpdir();
startTestRuntime({ entityTypes: ['Memo'] });

describe('the test host', () => {
  it('binds testRootEvents as the bus untypedBroadcastToSurface and untypedSendToSystem send on, which _rootEvents is', () => {
    const toSurfaces: unknown[] = [];
    const incoming: unknown[] = [];
    const stop = [testRootEvents.onSurfaceSend((e) => toSurfaces.push(e)), testRootEvents.onIncoming((e) => incoming.push(e))];
    testPacks.designations.set('brain', 'brain-system');
    try {
      untypedBroadcastToSurface('memos', { type: 'MEMO_ADDED' });
      untypedSendToSystem('memos', { type: 'ADD_MEMO' });
      untypedSendToSystem({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType: 'user.message' });
      _rootEvents.emitIncoming({ to: 'memos', event: { type: 'PING' } });
    } finally {
      stop.forEach((unsubscribe) => unsubscribe());
      testPacks.designations.delete('brain');
    }
    expect(toSurfaces).toEqual([{ to: 'memos', call: expect.any(String), event: { type: 'MEMO_ADDED' } }]);
    expect(incoming).toEqual([
      { to: 'memos', call: expect.any(String), event: { type: 'ADD_MEMO' } },
      { to: 'brain-system', call: expect.any(String), event: { type: 'TRIGGER_BRAIN_EVENT', eventType: 'user.message' } },
      { to: 'memos', event: { type: 'PING' } },
    ]);
  });

  it('records the SYSTEM_ERROR events systems report until taken', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError({ error: new Error('boom'), source: 'memos' });
    expect(takeSystemErrors()).toEqual([expect.objectContaining({ type: 'SYSTEM_ERROR', source: 'memos', message: 'boom' })]);
    expect(takeSystemErrors()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('prints the log events on its bus once each, as the app does', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    createLogger('memos').info('saved', { id: 1 });
    testRootEvents.emitLog({ level: 'info', message: 'from the bus' });
    expect(info.mock.calls).toEqual([['[memos]', 'saved', { id: 1 }], ['[test]', 'from the bus']]);
    vi.restoreAllMocks();
  });

  it('has a test version, the engine, and an appData that resets the database', async () => {
    expect(getAppVersion()).toBe('0.0.0-test');
    const memoQueries = { all: () => [] };
    testPacks.repositories.set('memoQueries', memoQueries);
    const id = untypedCreate('Memo').set('text', 'hello').id();
    expect(ears().getRow(id)?.text).toBe('hello');
    expect(entityIds()).toContain(id);
    dropAttribute(id, 'text');
    expect(ears().getRow(id)?.text).toBeUndefined();
    const before = ears();
    await boundHost().services.appData.reset();
    expect(entityIds()).toEqual([]);
    // A reset replaces the engine, closing the database the one replaced was on; the repositories are the registered
    // packs', which it keeps
    expect(ears()).not.toBe(before);
    expect(repository.memoQueries).toBe(memoQueries);
    expect(() => before.query.ids(id).exists()).toThrow(expect.objectContaining({ code: 'CLOSED' }));
    await expect(boundHost().services.appData.exportBackup('/tmp')).rejects.toThrow("isn't supported in unit tests");
    resetTestData();
    testPacks.repositories.delete('memoQueries');
  });

  it.each(['memoQueries', '__proto__', 'constructor', 'toString'])('reads the repository named %s from the registered packs, and names one nobody declares', (name) => {
    expect(() => repository[name]).toThrow(`[repository] "${name}" is not registered: a pack declares its repositories in apack.json`);
    const value = { owner: name };
    testPacks.repositories.set(name, value);
    try {
      expect(repository[name]).toBe(value);
      expect(() => repository.owner).toThrow('is not registered');
      expect((repository as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    } finally {
      testPacks.repositories.delete(name);
    }
  });

  it('keeps the packs and version it was first started with', () => {
    expect(() => startTestRuntime({ entityTypes: ['Memo'] })).not.toThrow();
    expect(() => startTestRuntime({ appVersion: '2.0.0' })).toThrow('pass appVersion on its first call');
    expect(() => startTestRuntime({ packs: testPacksView() }))
      .toThrow('pass packs on its first call');
    expect(() => startTestRuntime({ onboarding: { isComplete: () => true, complete: () => {} } }))
      .toThrow('pass onboarding on its first call');
  });

  it('binds the test app again once a test unbound it, printing each log event still once', () => {
    unbindHost();
    expect(() => ears()).toThrow();

    startTestRuntime();

    expect(boundHost().transport.rootEvents).toBe(testRootEvents);
    expect(entityIds()).toEqual([]);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    createLogger('memos').info('once');
    expect(info).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('keeps whether the user onboarded in memory by default, until the database is emptied', () => {
    expect(boundHost().services.onboarding.isComplete()).toBe(false);
    boundHost().services.onboarding.complete();
    expect(boundHost().services.onboarding.isComplete()).toBe(true);
    resetTestData();
    expect(boundHost().services.onboarding.isComplete()).toBe(false);
  });
});
